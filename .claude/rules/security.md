# Security rules (always loaded)

- Validate all external input at the boundary (request, webhook, CSV import); never trust client-side validation alone.
- SQL: prepared statements / query builder only. No string-concatenated queries.
- Output escaping by context (HTML, attribute, JS, URL). No raw `echo $var` / `innerHTML` with user data.
- Tracking & marketing data: hash PII (email/phone, SHA-256, normalized) before sending to Meta CAPI / Google Enhanced Conversions. Never log raw PII or tokens.
- Webhooks: verify signatures (e.g. `X-Hub-Signature-256`) before processing.
- New config values go to `.env.example` with a placeholder, read via environment variables.
