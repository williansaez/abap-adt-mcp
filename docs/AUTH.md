# Authentication

The server connects to an ABAP system through the ADT (`/sap/bc/adt/...`) endpoints
using the [`abap-adt-api`](https://www.npmjs.com/package/abap-adt-api) client. Three
authentication modes are supported.

## Mode SSO — Browser login (S/4HANA Public Cloud, like Eclipse) — recommended

S/4HANA Public Cloud forces interactive SSO (SAML2/OIDC via IAS) on the ADT
endpoints, exactly as Eclipse ADT does. This mode reproduces the Eclipse experience:
it opens a real browser, you complete the SSO login, and the resulting **session
cookies** are harvested and reused for ADT calls. **No SAP-side configuration.**

```env
SAP_URL=https://my411584.s4hana.cloud.sap
SAP_CLIENT=100
SAP_AUTH_TYPE=sso
# SAP_BROWSER_PATH=/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge   # optional
```

Requirements & behaviour:

- A local **Chromium browser** (Chrome, Edge, or Brave) must be installed. Paths are
  auto-detected on macOS; override with `SAP_BROWSER_PATH`. Driven via `puppeteer-core`
  (no browser is downloaded).
- Login is triggered by the `login` tool, and automatically before the first call.
  When the session expires, run `login` again.
- The session cookie (`SAP_SESSIONID_*` / `MYSAPSSO2`) is HttpOnly and is read over
  the Chrome DevTools Protocol; it is held **in memory only**.

> **Client note:** the SSO session is established for the tenant's logon client (for
> `my411584` that was observed to be **100**, not `080`). Set `SAP_CLIENT` to the
> client your SSO session actually lands on. Access to a different client (e.g. a
> separate developer-extensibility client) may require its own login and is not
> guaranteed to be reachable via the same SSO session — verify per tenant.

Verified end-to-end against MDPharma DEV (my411584): browser login → cookie harvest →
`adt.login()` (CSRF ok) → `reentranceTicket()` and `nodeContents('DEVC/K','$TMP')`
returned real data.

## Mode 1 — Basic auth

Works for on-prem AS ABAP and for S/4HANA Cloud **Communication Users** (technical
users that carry their own password).

```env
SAP_URL=https://host:44300
SAP_CLIENT=100
SAP_LANGUAGE=EN
SAP_USER=TECH_USER
SAP_PASSWORD=secret
```

> Named business users on S/4HANA Public Cloud authenticate through SSO (SAML2/OIDC
> via IAS) and **cannot** use Basic auth. For those tenants use Mode 2, or create a
> Communication User.

## Mode 2 — OAuth2 (S/4HANA Public Cloud)

S/4HANA Public Cloud forces interactive SSO on the ADT endpoints, so a stored
password does not work for a normal user. The sanctioned programmatic path is an
OAuth2 client obtained from a **Communication Arrangement**. The ADT ICF node
already has an OAuth authenticator active, so a valid bearer token authenticates.

Enable the mode by setting `SAP_AUTH_TYPE=oauth` (or simply providing
`SAP_OAUTH_CLIENT_ID`). When enabled, `SAP_USER`/`SAP_PASSWORD` are ignored.

```env
SAP_URL=https://my411584.s4hana.cloud.sap
SAP_CLIENT=080
SAP_AUTH_TYPE=oauth
SAP_OAUTH_TOKEN_URL=https://my411584.s4hana.cloud.sap/sap/bc/sec/oauth2/token
SAP_OAUTH_CLIENT_ID=<client id>
SAP_OAUTH_CLIENT_SECRET=<client secret>
# SAP_OAUTH_SCOPE=   # optional, only if the arrangement defines scopes
```

The server fetches a token via the `client_credentials` grant and caches it until
~1 minute before expiry, refreshing automatically.

### SAP-side setup (per tenant, done by an administrator)

1. **Communication User** — *Maintain Communication Users* app → create a user;
   note the generated client id / secret (these become `SAP_OAUTH_CLIENT_ID` /
   `SAP_OAUTH_CLIENT_SECRET`).
2. **Communication System** — pointing at the tenant, using the communication user
   with **OAuth 2.0** as the authentication method.
3. **Communication Arrangement** — for the communication scenario that exposes the
   ABAP development / ADT access your landscape provides; assign the communication
   system from step 2.
4. Read the **OAuth 2.0 token endpoint** from the communication system/arrangement
   and use it as `SAP_OAUTH_TOKEN_URL` (often `.../sap/bc/sec/oauth2/token`, but the
   arrangement is authoritative).

> The exact communication scenario that grants ADT access depends on the tenant
> (developer extensibility / embedded steampunk enablement). Confirm with Basis
> which scenario is available before relying on this in production.

## Example `.mcp.json` entry (OAuth)

```json
{
  "mcpServers": {
    "MDPharma-DEV": {
      "command": "node",
      "args": ["/absolute/path/abap-adt-mcp/dist/index.js"],
      "env": {
        "SAP_URL": "https://my411584.s4hana.cloud.sap",
        "SAP_CLIENT": "080",
        "SAP_AUTH_TYPE": "oauth",
        "SAP_OAUTH_TOKEN_URL": "https://my411584.s4hana.cloud.sap/sap/bc/sec/oauth2/token",
        "SAP_OAUTH_CLIENT_ID": "<client id>",
        "SAP_OAUTH_CLIENT_SECRET": "<client secret>"
      }
    }
  }
}
```

Keep secrets out of version control — add `.mcp.json` to `.gitignore` when it holds
real credentials.
