# Authentication

The server connects to ABAP systems through the ADT (`/sap/bc/adt/...`) endpoints
using the [`abap-adt-api`](https://www.npmjs.com/package/abap-adt-api) client. Four
authentication modes are supported: `sso`, `basic`, `oauth` and `cert`.

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

### Secure Login Client and certificate logon (on-premise)

The same mode is the recommended path for an on-premise system that authenticates
users with **SAP Secure Login Client** (SLC), the desktop component of SAP Single
Sign-On and of the SAP Secure Login Service for SAP GUI. SLC provisions a
short-lived X.509 user certificate into the OS key store (Windows certificate
store, macOS Keychain), normally with a **non-exportable private key**. SAP GUI
uses it over SNC; ADT is HTTP, so the ICM consumes it as a TLS client
certificate. Chromium reads the same OS key store, so the browser login presents
the certificate and the server only ever holds the resulting session cookies, in
memory. Nothing is exported, and no key material reaches this process.

```json
{
  "ONPREM": { "url": "https://sap.example.com:44300", "client": "100", "authType": "sso" }
}
```

What to expect at login time:

- **Certificate picker.** When the ICM requests a client certificate and the key
  store holds a matching one, Chromium shows a picker in the login window. Pick
  the SLC certificate. To skip the picker, set the Chrome policy
  [`AutoSelectCertificateForUrls`](https://chromeenterprise.google/policies/#AutoSelectCertificateForUrls)
  for the SAP host (macOS: a profile under `/Library/Managed Preferences`;
  Windows: `HKLM\SOFTWARE\Policies\Google\Chrome`). This is optional, and
  deliberately not forced by the server: auto-selecting an identity is the
  user's decision, not the tool's.
- **Kerberos / SPNEGO.** The login window is launched with
  `--auth-server-allowlist` and `--auth-negotiate-delegate-allowlist` set to the
  destination's host only, so an SLC Kerberos token or a domain-joined machine
  authenticates without a prompt. Integrated authentication stays off for every
  other host.
- **No identity-provider page.** On-premise the ADT discovery document is
  returned directly once the certificate is accepted; the login completes as
  soon as the session cookie appears, with no HTML in between.
- **Session expiry** on-premise is the ABAP system login form (fields
  `sap-user` / `sap-password`), not an identity provider page. It is recognised
  as an expired session and triggers the automatic re-login.

The ABAP system has to accept client certificates for this to work at all. The
SAP-side checklist (STRUST, `icm/HTTPS/verify_client`, CERTRULE) is below, under
[SAP-side setup for certificate logon](#sap-side-setup-for-certificate-logon).

> A **technical user** whose certificate legitimately lives in a file (CI, an
> unattended runner) does not need a browser: that is `authType: "cert"`, and it
> is the on-premise counterpart of the OAuth mode. Certificates provisioned by
> SLC are not that case: their key cannot be exported, by design.

### SAP-side setup for certificate logon

X.509 logon is a system configuration, not a client setting: without it the ICM
never asks for a certificate and the browser never offers one. Ask Basis to
confirm each item. The right-hand column is what this server reports when the
item is missing.

| Step | What | Symptom when missing |
|---|---|---|
| 1 | The CA that issued the user certificates (SLC / Secure Login Service, or the corporate PKI) is imported into the **SSL server Standard** PSE in **STRUST**, and the ICM was restarted. | The handshake fails, or the certificate is offered and rejected; the server reports `tlsCertificate`. |
| 2 | **`icm/HTTPS/verify_client = 1`** (request a certificate, fall back to another logon procedure) or `= 2` (require one). Per port: `VCLIENT=1` in the `icm/server_port_<n>` entry. | No picker appears and logon falls back to a password prompt. |
| 3 | The certificate is mapped to an ABAP user, rule-based in **CERTRULE** or explicitly in **VUSREXTID** (`EXTID_DN`). | The certificate is accepted by TLS but the logon fails: HTTP 401, classified `sessionExpired`. |
| 4 | The **SICF** service `/sap/bc/adt` has X.509 in its logon procedure list (usually "Standard"), ahead of or alongside basic. | Same as step 3: the TLS layer is happy, ADT still asks for a password. |
| 5 | Behind a **Web Dispatcher or reverse proxy that terminates TLS**, the certificate is forwarded in a header and the backend trusts that hop: `icm/HTTPS/trust_client_with_issuer` / `trust_client_with_subject` on the AS ABAP, `wdisp/ssl_encrypt = 1` on the dispatcher. | The logon works against the ICM directly and fails through the proxy. |

Confirm with a browser first: open `https://<host>:<port>/sap/bc/adt/core/discovery?sap-client=<client>` in the same Chromium profile. If the browser reaches the discovery XML after picking the certificate, this server will too.

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

## Mode cert: X.509 client certificate (on-premise, technical users)

The client certificate *is* the logon: no password, no browser, no token
endpoint. This is the on-premise counterpart of the OAuth mode, for a technical
user whose certificate legitimately lives in a file (a CI job, an unattended
runner, a service account issued by the corporate PKI).

```json
{
  "ONPREM": {
    "url": "https://sap.example.com:44300",
    "client": "100",
    "authType": "cert",
    "user": "TECH_USER",
    "tls": {
      "ca": "/etc/ssl/corp-ca.pem",
      "cert": "/home/me/.abap-adt-mcp/tech.crt",
      "key": "/home/me/.abap-adt-mcp/tech.key"
    }
  }
}
```

A PKCS#12 bundle works instead of the pair, and the passphrase belongs in the
environment rather than the file:

```json
{ "tls": { "pfx": "/home/me/.abap-adt-mcp/tech.p12", "passphrase": "${env:TECH_P12_PW}" } }
```

`x509` is accepted as a spelling of `authType`. The flat single-destination form
uses `SAP_AUTH_TYPE=cert` with `SAP_TLS_CERT` and `SAP_TLS_KEY` (or
`SAP_TLS_PFX`), plus the optional `SAP_TLS_CA`, `SAP_TLS_PASSPHRASE` and
`SAP_TLS_SERVERNAME`. With no `SAP_AUTH_TYPE`, a certificate pair infers `cert`
and says so on stderr.

Behaviour and limits:

- The destination is **refused at startup** without a certificate: `tls.ca`
  alone is not one, because a CA says who to trust, not who you are.
- `user` is optional and is only a label for the session; a `password` on a
  `cert` entry is **not** a fallback and is reported as ignored.
- No `Authorization` header is sent. The ICM tries X.509 before basic, and an
  empty header would push it to offer a password logon instead.
- Certificate **and** password both configured in the flat form reads as
  `basic`, not `cert`: a client certificate is also the transport for a password
  login behind a mutual-TLS proxy, so dropping the password would be the more
  surprising reading. It is reported either way.
- Server verification stays on. `tls.ca` still answers "who signed the
  *server's* certificate", independently of the identity you present.
- **Secure Login Client certificates are not this mode.** Their private key is
  non-exportable by design, so no file can hold it: those users authenticate
  through [mode sso](#secure-login-client-and-certificate-logon-on-premise).

Keep the key file at mode `0600`. A private key pasted inline as PEM text, and a
literal `tls.passphrase`, both count as inline secrets: the server refuses to
start when the configuration file is group- or world-readable and holds either.

When the handshake succeeds but SAP answers **401**, the certificate reached the
ICM and was not accepted as a logon: the mapping is missing, not the session.
The error says so instead of sending the model into a login loop. See
[SAP-side setup for certificate logon](#sap-side-setup-for-certificate-logon).

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
