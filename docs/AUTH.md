# Authentication

The server connects to ABAP systems through the ADT (`/sap/bc/adt/...`) endpoints
using the [`abap-adt-api`](https://www.npmjs.com/package/abap-adt-api) client. Four
authentication modes are supported.

## Multiple systems (destinations)

One server instance serves **many** ABAP systems. Each system is a named
*destination*; every tool except `listSystems` and `healthcheck` takes an optional
`destination` argument to pick one, so a single MCP entry exposes one set of tools
for all systems, instead of one server per system.

Configure destinations in a **`systems.json`** named by `SAP_SYSTEMS_FILE` (the
recommended path is `~/.abap-adt-mcp/systems.json`; a `systems.json` next to the
package is picked up as well for a source checkout, and both are gitignored, see
`systems.example.json`), or inline via `SAP_SYSTEMS`:

```json
{
  "ACME-DEV":         { "url": "https://myXXXXXX.s4hana.cloud.sap", "client": "080" },
  "ACME-CUSTOMIZING": { "url": "https://myXXXXXX.s4hana.cloud.sap", "client": "100" }
}
```

Secrets can be referenced instead of stored: any string may contain `${env:VAR}` (resolved at startup; a missing variable fails with its name, never its value). Keep the file at mode `0600`: a group/world-readable file is warned about, and refused when it holds inline passwords. Entries default to `authType: "sso"` (override per entry). Resolution order:
`SAP_SYSTEMS` → `SAP_SYSTEMS_FILE` → `systems.json` next to the package → single
implicit destination from the flat `SAP_URL`/`SAP_CLIENT`/… variables (back-compat).
`destination` may be omitted whenever a default exists, resolved in this order:
`SAP_DEFAULT_DESTINATION` when it names a configured entry, otherwise the first entry
marked `"default": true`, otherwise the only entry when exactly one is configured.
With several entries and no default it is required on each call. `listSystems`
returns the configured destinations.

The MCP client config is then a single server:

```json
{ "mcpServers": { "abap-adt-mcp": {
  "command": "/opt/homebrew/bin/node",
  "args": ["/absolute/path/abap-adt-mcp/dist/index.js"]
} } }
```

Each authentication mode below can be set per destination (`authType` in the entry).

## TLS: custom CA and client certificates

Per destination, `tls` supplies the material the HTTPS connection needs (paths to PEM/CRT/KEY files, or inline PEM text; `${env:VAR}` works here too):

```json
{
  "ECC": { "url": "https://sap.example.com:44300", "client": "100", "authType": "basic",
           "user": "DEVELOPER", "password": "${env:ECC_PW}",
           "tls": { "ca": "/etc/ssl/corp-ca.pem", "cert": "/home/me/.abap-adt-mcp/dev.crt", "key": "/home/me/.abap-adt-mcp/dev.key", "passphrase": "${env:DEV_KEY_PW}" } }
}
```

| Key | Purpose |
|---|---|
| `ca` | Extra CA bundle for self-signed or corporate certificates (keeps verification on, unlike `insecureTls`). |
| `cert` + `key` | X.509 client certificate for mutual TLS (reverse proxies, SNC-like gateways). |
| `pfx` + `passphrase` | PKCS#12 alternative to cert/key. |

The agent applies to basic, OAuth and SSO API calls; the browser used for SSO login manages its own certificates. `listSystems` reports `tls` as a short description, never the material.

## Per-destination policy (server-side guard rails)

Tool annotations only *advise* the MCP host. The `policy` block of a destination is
enforced by the server itself, before authentication and before any SAP call, so a
production system stays safe even if the host auto-approves everything.

```json
{
  "DEV": { "url": "https://myXXXXXX.s4hana.cloud.sap", "client": "080",
           "policy": { "allowedPackages": ["Z*", "$*"], "allowedTransports": ["DEVK9*"] } },
  "PRD": { "url": "https://myYYYYYY.s4hana.cloud.sap", "client": "100",
           "policy": { "readOnly": true, "deniedTables": ["PA*", "HR*", "USR02"], "allowFreeSql": false } }
}
```

| Key | Effect |
|---|---|
| `readOnly` | Only tools annotated read-only may run, plus the always-allowed set `login`, `logout`, `dropSession`, `listSystems`, `healthcheck`, `systemProfile` and `exportPackageSources` (which writes locally only). `lock`, `unitTestRun`, `createAtcRun` and `atcSummary` count as writes; `runQuery` and `tableContents` are reads and stay allowed. |
| `deniedTools` | Tool names, globs or `toolset:<name>` refused outright (`toolset:git`, `transportRelease`). |
| `allowFreeSql` | `false` refuses `runQuery` and `tableContents` with `sqlQuery`. |
| `deniedTables` | Glob list; applies to `tableContents`, to every table in a `runQuery` `FROM`/`JOIN`, and (best effort, by scanning the ABAP text) to `runSnippet` code and `setObjectSource`/`setMethodSource` sources. Dynamic SQL and views over the table are not detected. |
| `allowedPackages` | Closed list of globs. `createObject` (`parentName` or `parentPath`), `gitCreateRepo`, `runSnippet` and `activatePackage` check their package argument; source writes, `lock`, `deleteObject`, `activateByName`, `activateObjects` (each object), `renameExecute`/`extractMethodExecute` (the refactored object), DDIC/text writes resolve the object's package through `transportInfo` (cached until an object is created, deleted, renamed or moved); an unresolvable package is refused. `gitPullRepo`, `rapGenGenerate`, `rapGenPublishService`, `publishServiceBinding`/`unPublishServiceBinding` cannot derive their target package from their arguments and are refused whenever `allowedPackages` is set. |
| `allowedTransports` | Globs for every `transport`/`transportNumber` argument; `createTransport` and `resolveTransport(createIfMissing)` are refused. |

`MCP_READ_ONLY=1` in the environment makes every destination `readOnly` on top of its own
policy. Refusals come back as errors with `kind: "policyDenied"` and name the gate, so the
agent does not retry; `listSystems` shows each destination's policy.

## Mode sso: browser login (S/4HANA Public Cloud, like Eclipse), recommended

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
  with `0700` permissions: delete that directory to fully log out.

> **Client note:** the SSO session is established for the tenant's logon client
> (which may differ from the client you expect, for example **100** instead of `080`).
> Set `SAP_CLIENT` to the client your SSO session actually lands on. Access to a
> different client (e.g. a separate developer-extensibility client) may require
> its own login and is not guaranteed to be reachable via the same SSO session:
> verify per tenant.

Verified end-to-end against a real S/4HANA Cloud DEV tenant: browser login →
cookie harvest → `adt.login()` (CSRF ok) → `reentranceTicket()` and
`nodeContents('DEVC/K','$TMP')` returned real data. Since then `reentranceTicket`
is refused unless the server is started with `SAP_ALLOW_REENTRANCE_TICKET=1`,
because it returns a live logon credential into the conversation.

## Mode sso2: headless ticket provider (on-prem, opt-in)

This mode adds a narrow adapter for environments that already authenticate a named
user headlessly through SNC. A trusted local program obtains a short-lived SAP
logon or assertion ticket and prints exactly one JSON object to stdout. The server
uses the ticket as the `MYSAPSSO2` cookie for ADT HTTP requests:

```json
{
  "ONPREM-QAS": {
    "url": "https://sap.example.com:44300",
    "client": "100",
    "authType": "sso2",
    "sso2": {
      "command": "/opt/company/bin/sap-sso2-provider",
      "args": ["--system", "QAS", "--user", "DEVELOPER"],
      "timeoutMs": 30000
    },
    "policy": {
      "readOnly": true,
      "allowFreeSql": false,
      "deniedTools": ["exportPackageSources"]
    }
  }
}
```

Provider contract and security properties:

- stdout must contain only `{"ticket":"<value>"}`. The ticket must already be a
  valid cookie value; the server never rewrites signed ticket bytes.
- `command` must be an absolute path. It is run directly with `shell: false`, a
  128 KiB output limit and a configurable 1–300 second timeout. Arguments remain
  separate strings, so shell metacharacters are not evaluated.
- The provider is trusted local code and inherits the server environment. Do not
  point it at scripts from writable/shared locations. It must never persist or log
  the ticket.
- Provider stdout and stderr are discarded on errors. The ticket is held only in
  the in-memory cookie jar, is never returned by a tool or written to the audit log,
  and a fresh ticket is requested once if the ADT session expires.
- This is opt-in per destination. Existing `sso`, `basic` and `oauth` destinations
  do not invoke the provider and keep their previous behaviour.
- The destination URL must use HTTPS. Configuration loading rejects `http://`
  for `authType: "sso2"`, and the cookie client rejects any request URL that
  resolves outside the configured SAP origin before attaching `MYSAPSSO2`.

A provider based on SAP NW RFC SDK can open an RFC client connection through SNC
with `SNC_SSO=1` and `GETSSO2=1`, then call `RfcGetPartnerSSOTicket()`. Issuance is
backend- and policy-dependent: Basis must confirm the relevant profile parameters,
user mapping and ICF logon procedure. SAP recommends assertion tickets for ADT and
documents `login/create_sso2_ticket=3` plus `login/accept_sso2_ticket=1` for that
scenario in its [ADT back-end configuration guide](https://help.sap.com/doc/2e65ad9a26c84878b1413009f8ac07c3/202210.000/en-US/config_guide_system_backend_abap_development_tools.pdf).
The target ADT ICF service must accept the `MYSAPSSO2` ticket and HTTPS must remain
enabled. See SAP's [HTTP logon check order](https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_FOR_SOH_740/753088fc00704d0a80e7fbd6803c8adb/48d65106553b3e49e10000000a421937.html)
and [ticket profile parameters](https://help.sap.com/docs/ABAP_PLATFORM_NEW/e815bb97839a4d83be6c4fca48ee5777/09adc1073ccf4a838d4d241c49384955.html).

The repository deliberately does not bundle SAP's proprietary SDK or a provider
binary. Build and review that bridge in the environment that owns the SDK and SNC
credentials. A provider failure affects only its `sso2` destination.

## Mode basic: basic auth

Works for on-prem AS ABAP and for S/4HANA Cloud **Communication Users** (technical
users that carry their own password).

```env
SAP_URL=https://host:44300
SAP_CLIENT=100
SAP_LANGUAGE=EN
SAP_AUTH_TYPE=basic
SAP_USER=TECH_USER
SAP_PASSWORD=secret
```

`SAP_AUTH_TYPE=basic` is what makes the password count. Since 2.0.1 the legacy
single-system loader infers `basic` when `SAP_USER` and `SAP_PASSWORD` are set and
`SAP_AUTH_TYPE` is absent (and reports the inference on stderr); an explicit
`SAP_AUTH_TYPE=sso` with a password set is reported as unused credentials instead
of silently opening a browser. In `systems.json` the per-entry default stays `sso`,
so write `"authType": "basic"` on every password entry there.

> Named business users on S/4HANA Public Cloud authenticate through SSO (SAML2/OIDC
> via IAS) and **cannot** use Basic auth. For those tenants use mode `sso`, or create a
> Communication User.

## Mode oauth: OAuth2 (S/4HANA Public Cloud)

S/4HANA Public Cloud forces interactive SSO on the ADT endpoints, so a stored
password does not work for a normal user. The sanctioned programmatic path is an
OAuth2 client obtained from a **Communication Arrangement**. The ADT ICF node
already has an OAuth authenticator active, so a valid bearer token authenticates.

Enable the mode by setting `SAP_AUTH_TYPE=oauth`. In the legacy single-system
setup the loader also infers it when `SAP_AUTH_TYPE` is unset and
`SAP_OAUTH_TOKEN_URL`, `SAP_OAUTH_CLIENT_ID` and `SAP_OAUTH_CLIENT_SECRET` are all
present. When enabled, `SAP_USER`/`SAP_PASSWORD` are ignored (and reported as unused).

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

1. **Communication User**: *Maintain Communication Users* app, create a user;
   note the generated client id / secret (these become `SAP_OAUTH_CLIENT_ID` /
   `SAP_OAUTH_CLIENT_SECRET`).
2. **Communication System**: pointing at the tenant, using the communication user
   with **OAuth 2.0** as the authentication method.
3. **Communication Arrangement**: for the communication scenario that exposes the
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

Keep secrets out of version control: add `.mcp.json` to `.gitignore` when it holds
real credentials.
