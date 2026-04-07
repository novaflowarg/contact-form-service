-- Clean data import for contact-form-service (public schema only)
begin;
-- slack_webhook_url: placeholder; reemplazar en BD o vía SQL con el webhook real (no commitear secretos).
INSERT INTO public.tenant_contact_settings (tenant_slug, allowed_origins, slack_webhook_url, rate_limit_per_hour, enabled, created_at, updated_at) VALUES ('novaflow2', '{https://novaflow.com.ar}', 'https://hooks.slack.com/services/XXX/YYY/ZZZ', 10, true, '2026-01-28 22:46:03.416578+00', '2026-01-28 22:46:03.416578+00');
INSERT INTO public.tenant_contact_settings (tenant_slug, allowed_origins, slack_webhook_url, rate_limit_per_hour, enabled, created_at, updated_at) VALUES ('cfobras', '{https://cf-obras-civiles-web-kplb.bolt.host,https://cf-obras-civiles.bolt.host,http://localhost:5173,https://localhost:5173}', 'https://hooks.slack.com/services/XXX/YYY/ZZZ', 10, true, '2026-01-28 15:18:37.240217+00', '2026-01-28 15:18:37.240217+00');
INSERT INTO public.tenant_contact_settings (tenant_slug, allowed_origins, slack_webhook_url, rate_limit_per_hour, enabled, created_at, updated_at) VALUES ('novaflow', '{https://novaflow.com.ar,http://localhost:5173,https://localhost:5173,http://localhost:5174,https://localhost:5174}', 'https://hooks.slack.com/services/XXX/YYY/ZZZ', 10, true, '2026-01-28 22:46:03.416578+00', '2026-01-28 22:46:03.416578+00');
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('cfobras', '148.222.130.19', '2026-01-28 22:00:00+00', 1);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('novaflow', '148.222.130.19', '2026-01-28 22:00:00+00', 1);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('novaflow', '143.105.135.220', '2026-02-13 14:00:00+00', 2);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('novaflow', '143.105.135.220', '2026-02-13 15:00:00+00', 3);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('novaflow', '143.105.135.192', '2026-02-18 14:00:00+00', 2);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('cfobras', '143.105.135.192', '2026-02-18 14:00:00+00', 1);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('cfobras', '143.105.97.238', '2026-02-24 00:00:00+00', 2);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('cfobras', '143.105.97.238', '2026-02-24 01:00:00+00', 1);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('cfobras', '104.28.47.31', '2026-02-24 01:00:00+00', 1);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('novaflow', '148.222.130.155', '2026-03-02 14:00:00+00', 1);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('novaflow', '148.222.130.155', '2026-03-02 15:00:00+00', 6);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('novaflow', '148.222.130.155', '2026-03-02 16:00:00+00', 1);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('cfobras', '148.222.130.155', '2026-03-02 16:00:00+00', 5);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('novaflow', '148.222.130.155', '2026-03-02 17:00:00+00', 1);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('cfobras', '148.222.130.155', '2026-03-02 17:00:00+00', 1);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('novaflow', '148.222.130.155', '2026-03-02 18:00:00+00', 1);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('novaflow', '148.222.130.155', '2026-03-02 23:00:00+00', 1);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('novaflow', '143.105.135.32', '2026-03-05 20:00:00+00', 1);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('novaflow', '148.222.130.87', '2026-03-05 22:00:00+00', 1);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('novaflow', '138.84.62.0', '2026-03-15 13:00:00+00', 1);
INSERT INTO public.rate_limit_counters (tenant_slug, ip, bucket_hour, count) VALUES ('novaflow', '138.84.62.24', '2026-03-31 19:00:00+00', 1);
commit;
