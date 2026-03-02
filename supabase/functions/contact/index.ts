// supabase/functions/contact/index.ts
//
// Edge Function: recibe POST JSON desde sitio estático (Neolo), valida tenant + Origin allowlist,
// honeypot + rate limit (RPC), guarda auditoría en form_submissions y notifica SINCRÓNICAMENTE a Slack.
//
// ✅ Cambios (Opción A - "Libre pero saneado"):
// - Se guarda contact_type SANEADO en DB (estable para reporting).
// - Se envía a Slack el contact_type RAW (más humano / tal cual viene del front).
//
// ✅ Cambio pedido (se mantiene):
// - Rechazos "de servicio/config/origin/tenant/etc" => 503 { error: "CONTACT_REJECTED" }
// - Stealth para spam/validaciones de payload => 200 { ok:true }
// - Loggear SIEMPRE el motivo interno del rechazo (sin exponerlo al cliente).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// =====================
// DDL MAPPING (AJUSTAR SI TU DDL CAMBIA)
// =====================
const SETTINGS_TABLE = "tenant_contact_settings";
const SETTINGS_SELECT =
  "tenant_slug, allowed_origins, slack_webhook_url, rate_limit_per_hour, enabled";
const RATE_LIMIT_RPC = "check_and_increment_rate_limit";
const SUBMISSIONS_TABLE = "form_submissions";

// =====================
// CONFIG
// =====================
const MAX_TENANT_LEN = 64;

const MAX_NAME_LEN = 120;
const MAX_EMAIL_LEN = 180;
const MAX_PHONE_LEN = 50;
const MAX_COMPANY_NAME_LEN = 160;

const MAX_CONTACT_TYPE_RAW_LEN = 80; // visual para Slack
const MAX_CONTACT_TYPE_LEN = 60; // key normalizada para DB

const MAX_MESSAGE_LEN = 4000;

const HONEYPOT_FIELD = "company_website";

// =====================
// TYPES
// =====================
type ContactPayload = {
  tenant?: string;
  name?: string;
  email?: string;
  phone?: string;
  company_name?: string;
  contact_type?: string;
  message?: string;
  [HONEYPOT_FIELD]?: string;
};

type TenantSettings = {
  tenant_slug: string;
  allowed_origins: string[];
  slack_webhook_url: string;
  rate_limit_per_hour: number;
  enabled: boolean;
};

// =====================
// HELPERS
// =====================
function jsonResponse(
  status: number,
  body: unknown,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function getRequestOrigin(req: Request): string {
  return req.headers.get("origin") ?? "";
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "0.0.0.0";
}

function getUserAgent(req: Request): string {
  return req.headers.get("user-agent") ?? "";
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeTenantSlug(s: string): string {
  return s.trim().toLowerCase();
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function okStealth(origin: string): Response {
  return jsonResponse(200, { ok: true }, origin ? corsHeaders(origin) : {});
}

/**
 * Rechazo en "modo stealth": 200 {ok:true}, pero deja trazabilidad en logs.
 */
function rejectStealth(
  origin: string,
  reason: string,
  meta?: Record<string, unknown>,
): Response {
  console.warn("CONTACT_REJECTED_STEALTH:", reason, meta ?? {});
  return okStealth(origin);
}

/**
 * Rechazo "de servicio": 503 { error: "CONTACT_REJECTED" } (front: "Servicio no disponible...")
 */
function rejectService(
  origin: string,
  reason: string,
  meta?: Record<string, unknown>,
): Response {
  console.error("CONTACT_REJECTED:", reason, meta ?? {});
  return jsonResponse(
    503,
    { error: "CONTACT_REJECTED" },
    origin ? corsHeaders(origin) : {},
  );
}

/**
 * RAW para Slack: humano y tal cual viene del front (acotado a longitud).
 * No “limpia” agresivo: solo trim + colapsa whitespace + corta.
 */
function normalizeContactTypeRawForSlack(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "General";

  // 1) Reemplaza separadores comunes por espacio
  const withSpaces = raw.replace(/[_\-.]+/g, " ");

  // 2) Colapsa espacios múltiples
  const compact = withSpaces.replace(/\s+/g, " ").trim();

  // 3) Capitaliza cada palabra
  const capitalized = compact
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

  // 4) Limita longitud visual
  return capitalized.slice(0, MAX_CONTACT_TYPE_RAW_LEN) || "General";
}

/**
 * Key para DB: estable para reporting.
 * - lowercase
 * - trim
 * - espacios -> "_"
 * - allow chars (a-z, 0-9, _, -, .)
 * - limita longitud
 * - fallback
 */
function normalizeContactTypeForDb(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "general_query";

  const spaced = raw.replace(/\s+/g, "_");
  const cleaned = spaced.replace(/[^a-z0-9_.-]/g, "");
  const collapsed = cleaned
    .replace(/_+/g, "_")
    .replace(/-+/g, "-")
    .replace(/\.+/g, ".");

  const out = collapsed.slice(0, MAX_CONTACT_TYPE_LEN);
  return out || "general_query";
}

async function postToSlack(webhookUrl: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error("Slack webhook failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("Slack webhook error:", e);
    return false;
  }
}

// =====================
// MAIN
// =====================
Deno.serve(async (req) => {
  const origin = getRequestOrigin(req);

  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return rejectService(origin, "server_misconfigured_missing_env");
  }

  const sb = createClient(supabaseUrl, serviceRoleKey);

  let payload: ContactPayload;
  try {
    payload = await req.json();
  } catch (e) {
    return rejectStealth(origin, "invalid_json", { err: String(e) });
  }

  const tenant = normalizeTenantSlug(String(payload.tenant ?? ""));
  const name = String(payload.name ?? "").trim();
  const email = String(payload.email ?? "").trim().toLowerCase();
  const phone = String(payload.phone ?? "").trim();
  const company_name = String(payload.company_name ?? "").trim();

  // 👇 dual: raw para Slack, key para DB
  const contact_type_raw = normalizeContactTypeRawForSlack(payload.contact_type);
  const contact_type_db = normalizeContactTypeForDb(payload.contact_type);

  const message = String(payload.message ?? "").trim();
  const honeypot = String(payload[HONEYPOT_FIELD] ?? "").trim();

  // Honeypot (stealth)
  if (honeypot.length > 0) {
    return rejectStealth(origin, "honeypot_triggered", { tenant });
  }

  // Basic validation (stealth + log)
  if (!tenant || tenant.length > MAX_TENANT_LEN) {
    return rejectStealth(origin, "invalid_tenant", { tenant });
  }
  if (!name || name.length > MAX_NAME_LEN) {
    return rejectStealth(origin, "invalid_name", { tenant });
  }
  if (!email || email.length > MAX_EMAIL_LEN || !isValidEmail(email)) {
    return rejectStealth(origin, "invalid_email", { tenant });
  }
  if (phone.length > MAX_PHONE_LEN) {
    return rejectStealth(origin, "invalid_phone", { tenant });
  }
  if (company_name.length > MAX_COMPANY_NAME_LEN) {
    return rejectStealth(origin, "invalid_company_name", { tenant });
  }
  if (!message || message.length > MAX_MESSAGE_LEN) {
    return rejectStealth(origin, "invalid_message", { tenant });
  }

  // Load tenant settings
  const { data: settingsData, error: settingsErr } = await sb
    .from(SETTINGS_TABLE)
    .select(SETTINGS_SELECT)
    .eq("tenant_slug", tenant)
    .maybeSingle();

  if (settingsErr) {
    return rejectService(origin, "settings_query_failed", { tenant });
  }

  const settings = settingsData as TenantSettings | null;

  if (!settings) {
    return rejectService(origin, "tenant_not_found", { tenant });
  }

  if (settings.enabled !== true) {
    return rejectService(origin, "tenant_disabled", { tenant });
  }

  // Origin allowlist (servicio)
  const allowedOrigins = settings.allowed_origins ?? [];

  if (!origin) {
    return rejectService(origin, "missing_origin", { tenant });
  }

  if (!allowedOrigins.includes(origin)) {
    return rejectService(origin, "forbidden_origin", { tenant, origin });
  }

  // Rate limit via RPC (atomic)
  const ip = getClientIp(req);
  const user_agent = getUserAgent(req);

  const { data: allowed, error: rlErr } = (await sb.rpc(RATE_LIMIT_RPC, {
    p_tenant_slug: tenant,
    p_ip: ip,
    p_limit: settings.rate_limit_per_hour ?? 10,
  })) as { data: boolean | null; error: unknown };

  if (rlErr) {
    return rejectService(origin, "rate_limit_rpc_error", { tenant, ip });
  }

  if (allowed !== true) {
    console.warn("CONTACT_RATE_LIMITED:", { tenant, ip });
    return jsonResponse(429, { error: "rate_limited" }, corsHeaders(origin));
  }

  // Persist audit row (best-effort)
  try {
    const { error: insertErr } = await sb.from(SUBMISSIONS_TABLE).insert({
      tenant_slug: tenant,
      name,
      email,
      phone: phone || null,
      company_name: company_name || null,
      contact_type: contact_type_db, // ✅ DB estable
      message,
      ip: ip === "0.0.0.0" ? null : ip,
      user_agent: user_agent || null,
    });

    if (insertErr) console.error("Insert form_submissions failed:", insertErr);
  } catch (e) {
    console.error("Insert form_submissions threw:", e);
  }

  // Slack message (RAW humano)
  const slackText =
    `🟦 *Nuevo contacto*\n` +
    `• *Tipo:* ${contact_type_raw}\n` +
    (company_name ? `• *Compañía:* ${company_name}\n` : "") +
    `• *Nombre:* ${name}\n` +
    `• *Correo electrónico:* ${email}\n` +
    (phone ? `• *Teléfono:* ${phone}\n` : "") +
    `• *Mensaje:* ${message}\n`;

  const slackOk = await postToSlack(String(settings.slack_webhook_url), slackText);

  if (!slackOk) {
    return rejectService(origin, "slack_webhook_failed", { tenant });
  }

  return jsonResponse(200, { ok: true }, corsHeaders(origin));
});