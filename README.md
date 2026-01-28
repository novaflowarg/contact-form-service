# Contact Form Service (Multi-tenant)

Servicio backend multi-tenant para formularios de contacto públicos, construido con Supabase Edge Functions y PostgreSQL.

## Características

- **Multi-tenant**: Soporta múltiples clientes (tenants) con configuraciones aisladas.
- **Notificaciones Sincrónicas**: Notifica a Slack inmediatamente vía Incoming Webhooks.
- **Seguridad**:
  - **Origin Allowlist**: Validación de CORS por tenant.
  - **Rate Limiting**: Límite de envíos por IP y tenant por hora (atómico en base de datos).
  - **Honeypot**: Campo oculto para prevenir spam de bots simples.
- **Modo Stealth**: Devuelve siempre `200 OK` incluso ante bloqueos (opcional) para no dar pistas a bots.

## Estructura del Proyecto

- `supabase/functions/contact`: Edge Function en Deno/TypeScript.
- `supabase/migrations/ddl.sql`: Esquema de base de datos, funciones RPC y políticas RLS.

## Configuración del Tenant

Cada tenant se configura en la tabla `tenant_contact_settings`:

| Campo | Descripción |
| :--- | :--- |
| `tenant_slug` | Identificador único (ej: `cfobras`). |
| `allowed_origins` | Array de dominios permitidos (ej: `['https://mi-sitio.com']`). |
| `slack_webhook_url` | URL del webhook de Slack para notificaciones. |
| `rate_limit_per_hour` | Máximo de envíos por IP por hora (default 10). |
| `enabled` | Switch para activar/desactivar el servicio para el tenant. |

## Ejemplo de Uso (POST)

El frontend debe enviar un JSON a la URL de la Edge Function.

### Endpoint
`POST https://<project-ref>.supabase.co/functions/v1/contact`

### Payload (JSON)

```json
{
  "tenant": "cfobras",
  "name": "Juan Pérez",
  "email": "juan@ejemplo.com",
  "phone": "+54 11 1234 5678",
  "company_name": "Construcciones S.A.",
  "contact_type": "budget_request",
  "message": "Hola, me gustaría solicitar un presupuesto para una obra civil.",
  "company_website": "" 
}
```

El campo contact_type acepta los siguientes valores (si se envía otro, por defecto será general_query):
- budget_request
- general_query
- commercial_proposal
- other

> **Importante**: El campo `company_website` es el **honeypot**. Debe estar presente pero **siempre vacío**. Si contiene algún valor, la solicitud será ignorada silenciosamente (200 OK).

### Ejemplo con cURL

```bash
curl -X POST https://webngfbglewttiolegwk.supabase.co/functions/v1/contact \
  -H "Content-Type: application/json" \
  -H "Origin: https://cf-obras-civiles-web-kplb.bolt.host" \
  -d '{
    "tenant": "cfobras",
    "name": "Test User",
    "email": "test@example.com",
    "company_name": "Test Corp",
    "contact_type": "general_query",
    "message": "Este es un mensaje de prueba con nuevos campos",
    "company_website": ""
  }'

```

### Respuesta Exitosa

```json
{
  "ok": true
}
```
> **Importante**: El header Origin debe estar en la tabla tenant_contact_settings.allowed_origins.

## Despliegue

1. Aplicar migraciones: `supabase db push` (o ejecutar `ddl.sql` en el SQL Editor).
2. Configurar variables de entorno en Supabase:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Deploy de la función:
   ```bash
   supabase functions deploy contact
   ```

## Notas de Desarrollo

- El servicio usa `service_role` para interactuar con la DB, ignorando RLS para las operaciones de validación y guardado.
- Los envíos se guardan en la tabla `form_submissions` para auditoría.
- El CV no se maneja por este servicio (se recomienda usar `mailto:` en el frontend).
