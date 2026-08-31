# Authentication

The server connects to ABAP systems through the ADT (`/sap/bc/adt/...`) endpoints
using the [`abap-adt-api`](https://www.npmjs.com/package/abap-adt-api) client. Three
authentication modes are supported.

## Multiple systems (destinations)

One server instance serves **many** ABAP systems. Each system is a named
*destination*; every tool takes a `destination` argument to pick one — so a single
MCP entry exposes one set of tools for all systems, instead of one server per system.

Configure destinations in **`systems.json`** at the repo root (gitignored — see
`systems.example.json`), or inline via `SAP_SYSTEMS` / a path in `SAP_SYSTEMS_FILE`:

```json
{
  "ACME-DEV":         { "url": "https://myXXXXXX.s4hana.cloud.sap", "client": "080" },
  "ACME-CUSTOMIZING": { "url": "https://myXXXXXX.s4hana.cloud.sap", "client": "100" }
}
```

Entries default to `authType: "sso"` (override per entry). Resolution order:
`SAP_SYSTEMS` → `SAP_SYSTEMS_FILE` → `systems.json` → single implicit destination from
the flat `SAP_URL`/`SAP_CLIENT`/… variables (back-compat). With more than one system,
`destination` is required on each call; with exactly one (or `SAP_DEFAULT_DESTINATION`
set) it may be omitted. `listSystems` returns the configured destinations.

The MCP client config is then a single server:

```json
{ "mcpServers": { "abap-adt": {
  "command": "/opt/homebrew/bin/node",
  "args": ["/absolute/path/abap-adt-mcp/dist/index.js"]
} } }
```

Each authentication mode below can be set per destination (`authType` in the entry).

## Mode SSO — Browser login (S/4HANA Public Cloud, like Eclipse) — recommended

S/4HANA Public Cloud forces interactive SSO (SAML2/OIDC via IAS) on the ADT
endpoints, exactly as Eclipse ADT does. This mode reproduces the Eclipse experience:
it opens a real browser, you complete the SSO login, and the resulting **session
cookies** are harvested and reused for ADT calls. **No SAP-side configuration.**

```env
SAP_URL=https://myXXXXXX.s4hana.cloud.sap
SAP_CLIENT=100
SAP_AUTH_TYPE=sso
# SAP_BROWSER_PATH=/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge   # optional
```

Requirements & behaviour:

- A local **Chromium browser** (Chrome, Edge, or Brave) must be installed. Paths are
  auto-detected on macOS; override with `SAP_BROWSER_PATH`. Driven via `puppeteer-core`
  (no browser is downloaded).
- The login window is **not incognito**: it uses a dedicated persistent profile per
  host (`~/.abap-adt-mcp/sso/<host>`), so ticking "stay signed in" at the IdP makes
  subsequent logins silent. It only *looks* empty on first use. To reuse a custom
  browser profile (e.g. a separate Chrome profile with saved SAP passwords/passkeys),
  set `SAP_BROWSER_PROFILE_DIR` to its directory. The browser's *default* profile is
  rejected on purpose: Chrome 136+ blocks automation on it, it is locked while your
  browser is open, and the cookie harvest would see every site's cookies in it.
- Login is triggered by the `login` tool, and automatically before the first call.
  When the session expires, run `login` again.
- The session cookie (`SAP_SESSIONID_*` / `MYSAPSSO2`) is HttpOnly and is read over
  the Chrome DevTools Protocol; the harvested cookie jar is held **in memory only**.
  Note that the dedicated browser profile (kept so "stay signed in" works across
  restarts) persists the IdP session on disk under `~/.abap-adt-mcp/sso/<host>/`
  with `0700` permissions — delete that directory to fully log out.

> **Client note:** the SSO session is established for the tenant's logon client
> (which may differ from the client you expect — e.g. **100** instead of `080`).
> Set `SAP_CLIENT` to the client your SSO session actually lands on. Access to a
> different client (e.g. a separate developer-extensibility client) may require
> its own login and is not guaranteed to be reachable via the same SSO session —
> verify per tenant.

Verified end-to-end against a real S/4HANA Cloud DEV tenant: browser login →
cookie harvest → `adt.login()` (CSRF ok) → `reentranceTicket()` and
`nodeContents('DEVC/K','$TMP')` returned real data.

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
SAP_URL=https://myXXXXXX.s4hana.cloud.sap
SAP_CLIENT=080
SAP_AUTH_TYPE=oauth
SAP_OAUTH_TOKEN_URL=https://myXXXXXX.s4hana.cloud.sap/sap/bc/sec/oauth2/token
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
    "ACME-DEV": {
      "command": "node",
      "args": ["/absolute/path/abap-adt-mcp/dist/index.js"],
      "env": {
        "SAP_URL": "https://myXXXXXX.s4hana.cloud.sap",
        "SAP_CLIENT": "080",
        "SAP_AUTH_TYPE": "oauth",
        "SAP_OAUTH_TOKEN_URL": "https://myXXXXXX.s4hana.cloud.sap/sap/bc/sec/oauth2/token",
        "SAP_OAUTH_CLIENT_ID": "<client id>",
        "SAP_OAUTH_CLIENT_SECRET": "<client secret>"
      }
    }
  }
}
```

Keep secrets out of version control — add `.mcp.json` to `.gitignore` when it holds
real credentials.
