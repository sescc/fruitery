# Service-token access: what Cloudflare Access sends

Change `desktop-sync`, task 1.1. Researched 2026-10-20 in the Cloudflare developer docs. Anything the
docs do not state is marked **unverified**; the deny reason codes on the real deployment show the
outcome (see `STATUS.md`, "Diagnosing a 403").

## Sources
- Application token (claims and `get-identity` fields): https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
- Validating the JWT: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- Worker-level Access (`ctx.access`): https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- Service tokens: https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/

## Findings
| Where | Fields for a service-token request | Status |
|---|---|---|
| `Cf-Access-Jwt-Assertion` payload | `type` ("app"), `aud`, `exp`, `iss`, `common_name`, `iat`, `sub` | documented |
| `common_name` | the token's Client ID (the `CF-Access-Client-Id` value); the docs sample shows the form `<hex>.access` | documented; the `.access` suffix is shown in a sample, not stated as a rule |
| `sub` / `email` | `sub` is an empty string; there is **no** `email` claim (identity logins carry `email`, `identity_nonce`, `sub`, `country`) | documented |
| `/cdn-cgi/access/get-identity` | adds `service_token_id` (Client ID of the token used) and `service_token_status` (true when a service token was used), next to `common_name` and `email` | documented; this shape differs from the JWT |
| `ctx.access.getIdentity()` | the Workers page lists no fields ("email, groups, device posture, and more"); it never mentions service tokens | **unverified**: probably mirrors `get-identity` |
| Service-token JWT lifetime fields | the sample has no `nbf`; the Worker already treats `nbf` as optional | documented sample |

Other facts used by the setup walkthrough:
- The caller sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers.
- The Access policy action must be **Service Auth**, otherwise Access prompts for a login.
- The lifetime is chosen at creation (for example `8760h`, one year); refresh extends it by a year;
  rotating the secret keeps the Client ID.

## How the Worker uses this (`apps/web/src/auth.js:authorize`)
- New secret `SERVICE_TOKEN_IDS`: comma-separated Client IDs, whitespace trimmed, empty entries
  ignored, compared **exactly and case-sensitively** (`apps/web/src/auth.js:parseServiceTokenIds`).
  Enter each id as the dashboard shows it (probably including `.access`); the Worker does not strip
  or add the suffix.
- JWT path: signature, issuer, audience and expiry are validated exactly as for the owner. The
  identity is the `email` claim when present, else `service_token_id` or `common_name`.
- `ctx.access` path: `getIdentity()` is read for `email`; without an email, `service_token_id` is used,
  with `common_name` as the fallback (the unverified part).
- An identity with an email is checked only against `OWNER_EMAIL`; one without an email only against
  `SERVICE_TOKEN_IDS`. Neither list can admit the other kind.
- Result: `{serviceToken: <clientId>}`. Denials add two reason codes (codes only, no ids logged):
  `service-token-not-allowed` (a service token that is not listed) and `service-token-ids-missing`
  (a service token and no list configured).
- If both `OWNER_EMAIL` and `SERVICE_TOKEN_IDS` are empty, the request is refused as
  `owner-email-missing` before any network call or `getIdentity()` call.
- A present `Cf-Access-Jwt-Assertion` header still decides alone: an invalid one is never rescued by
  `ctx.access`.
