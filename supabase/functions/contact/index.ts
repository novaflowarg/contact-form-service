// supabase/functions/contact/index.ts
//
// Edge Function: recibe POST JSON desde sitio estático (Neolo), valida tenant + Origin allowlist,
// honeypot + rate limit (RPC), guarda auditoría en form_submissions y notifica SINCRÓNICAMENTE a Slack.
//
// Stealth: al cliente siempre responde 200 {ok:true}, pero LOGGEA el motivo interno de cualquier rechazo.
//
// Alineación esperada con DDL:
// - tenant_contact_settings: tenant_slug, allowed_origins, slack_webhook_url, rate_limit_per_hour, enabled
// - form_submissions: tenant_slug, name, email, phone, company_name, contact_type, message, ip, user_agent, created_at
// - RPC: check_and_increment_rate_limit(p_tenant_slug text, p_ip inet, p_limit int) returns boolean

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
const STEALTH_MODE_ALWAYS_200 = true;

const MAX_NAME_LEN = 120;
const MAX_EMAIL_LEN = 180;
const MAX_PHONE_LEN = 50;
const MAX_COMPANY_NAME_LEN = 160;
const MAX_MESSAGE_LEN = 4000;

const HONEYPOT_FIELD = "company_website";

const CONTACT_TYPES = [
  "budget_request",
  "general_query",
  "commercial_proposal",
  "other",
] as const;

type ContactType = (typeof CONTACT_TYPES)[number];

// =====================
// TYPES
// =====================
type ContactPayload = {
  tenant?: string;
  name?: string;
  email?: string;
  phone?: string;
  company_name?: string;
  contact_type?: ContactType | string;
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
 * Siempre devuelve 200 {ok:true}, pero deja trazabilidad en logs.
 * Útil para no filtrar señales a bots, manteniendo debug operativo.
 */
function rejectStealth(origin: string, reason: string, meta?: Record<string, unknown>): Response {
  // No loggear PII sensible innecesaria (mensaje completo, etc). Metadatos acotados.
  console.warn("CONTACT_REJECTED:", reason, meta ?? {});
  return okStealth(origin);
}

function normalizeContactType(value: unknown): ContactType {
  const raw = String(value ?? "").trim().toLowerCase();
  if ((CONTACT_TYPES as readonly string[]).includes(raw)) return raw as ContactType;
  return "general_query";
}

function formatContactType(ct: ContactType): string {
  switch (ct) {
    case "budget_request":
      return "Solicitud de presupuesto";
    case "general_query":
      return "Consulta general";
    case "commercial_proposal":
      return "Propuesta comercial";
    case "other":
      return "Otro";
  }
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
    // Para métodos inválidos no hace falta stealth (no es un bot signal relevante),
    // pero si querés 100% stealth, reemplazá por rejectStealth(...)
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    // Esto es un error de server (sí conviene devolver 500 real)
    return jsonResponse(500, { error: "server_misconfigured" });
  }

  const sb = createClient(supabaseUrl, serviceRoleKey);

  let payload: ContactPayload;
  try {
    payload = await req.json();
  } catch {
    // Stealth con log
    return rejectStealth(origin, "invalid_json");
  }

  const tenant = normalizeTenantSlug(String(payload.tenant ?? ""));
  const name = String(payload.name ?? "").trim();
  const email = String(payload.email ?? "").trim().toLowerCase();
  const phone = String(payload.phone ?? "").trim();
  const company_name = String(payload.company_name ?? "").trim();
  const contact_type = normalizeContactType(payload.contact_type);
  const message = String(payload.message ?? "").trim();
  const honeypot = String(payload[HONEYPOT_FIELD] ?? "").trim();

  // Honeypot (siempre stealth)
  if (honeypot.length > 0) {
    return rejectStealth(origin, "honeypot_triggered", { tenant });
  }

  // Basic validation (stealth + log)
  if (!tenant || tenant.length > 64) {
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
    console.error("CONTACT_SETTINGS_ERROR:", settingsErr);
    return rejectStealth(origin, "settings_query_failed", { tenant });
  }

  const settings = settingsData as TenantSettings | null;

  if (!settings) {
    return rejectStealth(origin, "tenant_not_found", { tenant });
  }

  if (settings.enabled !== true) {
    return rejectStealth(origin, "tenant_disabled", { tenant });
  }

  // Origin allowlist (stealth + log)
  const allowedOrigins = settings.allowed_origins ?? [];

  if (!origin) {
    return rejectStealth(origin, "missing_origin", { tenant });
  }

  if (!allowedOrigins.includes(origin)) {
    return rejectStealth(origin, "forbidden_origin", {
      tenant,
      origin,
      // útil para debug, pero si te preocupa filtrar en logs, removelo:
      allowedOrigins,
    });
  }

  // Rate limit via RPC (atomic)
  const ip = getClientIp(req);
  const user_agent = getUserAgent(req);

  const { data: allowed, error: rlErr } = await sb.rpc(RATE_LIMIT_RPC, {
    p_tenant_slug: tenant,
    p_ip: ip,
    p_limit: settings.rate_limit_per_hour ?? 10,
  }) as { data: boolean | null; error: unknown };

  if (rlErr) {
    console.error("RATE_LIMIT_RPC_ERROR:", rlErr);
    return rejectStealth(origin, "rate_limit_failed", { tenant, ip });
  }

  if (allowed !== true) {
    return rejectStealth(origin, "rate_limited", { tenant, ip });
  }

  // Persist audit row (best-effort; do not block user if insert fails)
  try {
    const { error: insertErr } = await sb.from(SUBMISSIONS_TABLE).insert({
      tenant_slug: tenant,
      name,
      email,
      phone: phone || null,
      company_name: company_name || null,
      contact_type,
      message,
      ip: ip === "0.0.0.0" ? null : ip,
      user_agent: user_agent || null,
    });

    if (insertErr) console.error("Insert form_submissions failed:", insertErr);
  } catch (e) {
    console.error("Insert form_submissions threw:", e);
  }

  // Slack message (include new fields)
  const slackText =
    `🟦 *Nuevo contacto*\n` +
    `• *Tipo:* ${formatContactType(contact_type)}\n` +
    (company_name ? `• *Compañía:* ${company_name}\n` : "") +
    `• *Nombre:* ${name}\n` +
    `• *Correo electrónico:* ${email}\n` +
    (phone ? `• *Teléfono:* ${phone}\n` : "") +
    `• *Mensaje:* ${message}\n`;

  await postToSlack(String(settings.slack_webhook_url), slackText);

  return jsonResponse(200, { ok: true }, corsHeaders(origin));
});
