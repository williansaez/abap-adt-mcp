# Configuration reference

This is the complete reference for configuring abap-adt-mcp: where configuration comes from, every key of `systems.json`, the policy gates tool by tool, toolsets, every environment variable, the HTTP transport with a reverse proxy and a container in front of it, the audit record, host snippets and the files the server leaves on disk. The [README](../README.md#setup) tells the short story; this document explains each option, its default, its edge cases and the reason it exists. Everything here is taken from the code in `src/`, from [server.json](../server.json) (the registry manifest that declares the environment variables) and from a live handshake against version 0.3.3.

Related documents: [docs/AUTH.md](AUTH.md) (authentication modes and the SAP-side steps), [docs/TOOLS.md](TOOLS.md) (every tool with its parameters), [docs/ROUTING.md](ROUTING.md) (SAP's official tool names mapped to ours), [docs/FIELD-NOTES.md](FIELD-NOTES.md) (what real sessions taught the server), [docs/TESTPLAN.md](TESTPLAN.md) (what was verified live, and against which kind of tenant).

## 1. Configuration sources and precedence

The server reads its destinations once at startup (`src/lib/systems.ts`), in this order; the first source found wins and the others are ignored:

| Order | Source | Notes |
|---|---|---|
| 1 | `SAP_SYSTEMS` | Inline JSON map with the same shape as `systems.json`. Invalid JSON fails with `SAP_SYSTEMS is not valid JSON: ...`. When set, `SAP_SYSTEMS_FILE` is not even looked at. |
| 2 | `SAP_SYSTEMS_FILE` | Path to the JSON file. If the file does not exist the loader falls through silently to the legacy variables (source 4), not to the auto-detected `systems.json`, because the variable replaces that path; a typo in the path therefore ends with `No ABAP systems configured`. |
| 3 | `systems.json` next to the install | Resolved as `../../systems.json` from `dist/lib/` (where the loader lives), that is, the package root: the repository root for a source checkout, the package directory inside the npm cache for an `npx` install (where you will not put it). Useful for source checkouts only. |
| 4 | Legacy single-system variables | `SAP_URL` plus `SAP_CLIENT`, `SAP_LANGUAGE`, `SAP_USER`, `SAP_PASSWORD`, `SAP_TLS_INSECURE` and the `SAP_OAUTH_*` set. One implicit destination named `default` (or the value of `SAP_DEFAULT_DESTINATION`). |

With none of the four the server exits with `[abap-adt-mcp] Fatal: No ABAP systems configured. Provide systems.json, SAP_SYSTEMS, SAP_SYSTEMS_FILE, or SAP_URL.` and status 1. A `.env` file next to `package.json` is loaded with `dotenv` before anything else, so a source checkout can keep the legacy variables there (see [.env.example](../.env.example)); variables already present in the environment are not overridden by `.env`.

**One file per deployment.** A `systems.json` is not portable between a desktop and a headless host, because `sso` entries need a browser and a screen. Ship a separate file per deployment: the desktop file may hold `sso`, `basic` and `oauth` entries; the file for a container or a shared HTTP instance holds `basic` and `oauth` entries only. Section 6 says exactly what happens when an `sso` entry reaches a headless host (nothing at startup, a failure at the first call).

### `${env:VAR}` references

Any string anywhere in the map, at any depth, may contain `${env:VAR}` or the shorter `${VAR}`. Every reference is replaced with the environment value before the entry is validated, so it works for `password`, `oauth.clientSecret`, `gitPassword`, `tls.passphrase`, `tls.key` and even `url` or `client`. A variable that is not set aborts startup with `systems.<entry>.<key>: environment variable NAME referenced by ${env:NAME} is not set`: the message names the variable and the key, never a value. Several references in one string are all resolved; the variable name must match `[A-Za-z_][A-Za-z0-9_]*`.

### Validation at startup

Entries are parsed and validated eagerly so that a broken destination fails the start instead of the first tool call, with the entry name in the message:

| Check | Failure message |
|---|---|
| Entry has no `url` | `System "NAME" is missing "url"` |
| `url` is not an `http:` or `https:` URL | `System "NAME": url "..." is not a valid http(s) URL` |
| `client` present but not exactly three digits | `System "NAME": client must be a 3-digit number, got "..."` (a JSON number such as `100` is converted to the string `"100"` first) |
| `authType: "basic"` without `user` and `password` (after `${env:VAR}` resolution) | `System "NAME": authType=basic requires user and password (use ${env:VAR} to keep them out of the file)` |
| `authType: "oauth"` without `oauth.tokenUrl`, `oauth.clientId` and `oauth.clientSecret` | `System "NAME" authType=oauth requires oauth.tokenUrl/clientId/clientSecret` |
| `tls.cert` without `tls.key` (and no `pfx`), or `tls.key` without `tls.cert` | `System "NAME": tls.cert requires tls.key` / `tls.key requires tls.cert` |
| Map with no entries after skipping `_` keys | `No ABAP systems configured: the systems map is empty` |

Keys that start with `_` (`_comment`, `_notes`) are skipped, which is how [systems.example.json](../systems.example.json) carries its explanation. `auth` is accepted as an alias of `authType`, and `browser` as an alias of `sso`. The legacy single-system variables (source 4) skip these checks entirely: a bad `SAP_URL` or a missing `SAP_PASSWORD` only surfaces on the first call.

**The trap validation does not catch: a forgotten `authType`.** The default is `sso` (or `SAP_AUTH_TYPE`), and an unknown value falls back to that default without an error. An on-prem entry that carries `user` and `password` but no `authType`, or a misspelt one (`"Basic "` with a trailing space, `"basc"`), is loaded as `sso`: the credentials are dropped from the parsed entry, `listSystems` reports `authType: "sso"`, and the first call opens a browser window against a system that has no identity provider, where it sits until the 300-second SSO timeout. Write `authType` explicitly on every entry and read it back with `listSystems` after any edit. Setting `SAP_AUTH_TYPE=basic` on a host that only serves on-prem systems is the belt to that pair of braces.

### Accepted JSON types

Values are coerced leniently; the table says what each key accepts, so a file written by hand or generated by a script does not fail on a type.

| Keys | Accepted | Notes |
|---|---|---|
| `client` | string or number | Converted to a string, then checked for three digits (`80` fails, `"080"` and `80` are not the same thing: write the leading zero). |
| `insecureTls`, `default`, `policy.readOnly`, `policy.allowFreeSql` | JSON `true`; the strings `"1"`, `"true"`, `"yes"` (case-insensitive); the number `1` | Any other present value (`false`, `0`, `"no"`, `"off"`, `null`) counts as `false`. Only an absent key is "unset", which matters for `allowFreeSql`: a present key with any non-true value switches the gate on. |
| `policy.deniedTools`, `deniedTables`, `allowedPackages`, `allowedTransports` | JSON array of strings, or one comma-separated string | `"git*,transportRelease"` and `["git*", "transportRelease"]` are equivalent. |
| `tls.*` | string | A file path, or inline PEM text recognised by a `-----BEGIN ...-----` header. Empty or whitespace-only strings are treated as absent. |
| Everything else | string | |

TLS material named in a `tls` block is read when the destination's HTTPS agent is built: at startup for the first entry of the map (its handlers are used to enumerate the tool schemas) and on the first call for the others. An unreadable file then fails with `tls.ca: cannot read /path: ...`.

### File mode checks

When the map comes from a file (source 2 or 3), the loader looks at its mode on every platform except Windows, where the check is skipped:

- Mode with no group or world bits (`0600`, `0400`): nothing to report.
- Group- or world-readable and no inline secrets: a warning on stderr, `[abap-adt-mcp] /path/systems.json is readable by other users (mode 644); run: chmod 600 /path/systems.json`, and the server starts.
- Group- or world-readable with at least one inline secret: the start is refused with the same text plus `Refusing to start with inline passwords in a shared-readable file (or reference them as ${env:VAR}).`

An inline secret is a non-empty `password`, `gitPassword` or `oauth.clientSecret` whose whole value is not a single `${env:VAR}` reference. An SSO-only file, or one that references every secret from the environment, therefore never blocks the start. `SAP_SYSTEMS` (inline) is not subject to the check, which is one reason the README prefers the file: the environment of a host process is visible to more tools than a `0600` file.

### The default destination

Every tool except `listSystems` and `healthcheck` takes a `destination` argument. It may be omitted when a default exists, resolved in this order: `SAP_DEFAULT_DESTINATION` when it names a configured entry, otherwise the first entry with `"default": true`, otherwise the only entry when there is exactly one. With several entries and no default, the tool schemas mark `destination` as required and a call without it fails with `Missing "destination". Configured systems: DEV, QAS, PRD`.

### `MCP_READ_ONLY` and `readOnly` in the file

`MCP_READ_ONLY=1` (accepted values `1`, `true`, `yes`) is applied after loading and merges `readOnly: true` into every entry's policy, keeping the entry's other keys. When the file already says `readOnly: true` on an entry the variable is redundant for that entry and harmless; its value is that a file edited to drop `readOnly` cannot re-open writes on that host. Use the file for per-destination intent and the variable as the host-level floor of a read-only service. Two consequences of how the loader runs: the environment of a process is fixed when it starts, so `MCP_READ_ONLY` cannot be lifted without a restart; and in HTTP mode every new session constructs a new server instance that re-reads the file, so a changed `readOnly` in the file reaches the next session while the variable stays what it was at process start.

## 2. `systems.json` key by key

One object per destination; the key is the name you will use in `destination` and in chats. It is free text, but `_`-prefixed keys are ignored.

| Key | Type | Required | Meaning |
|---|---|---|---|
| `url` | string | yes | Base URL of the system, scheme and host, port when not the default (`https://sap.example.com:44300`, `https://myXXXXXX.s4hana.cloud.sap`). No path. |
| `client` | string or number | no | SAP client, three digits. How it is sent depends on the mode: in `sso` the cookie client pins `sap-client` on every request (the harvested cookies alone would land in the tenant's default client); in `basic` and `oauth` the ADT library sends `sap-client` on the login request that opens the SAP session (`/sap/bc/adt/compatibility/graph`), and the session cookie carries the client from then on. It is never sent to an OAuth token endpoint. Omitted means the system's default client. |
| `language` | string | no | Logon language (`EN`), sent as `sap-language` with the login. Affects message texts and, when writing message classes with `setObjectSource`, the master language (see [docs/FIELD-NOTES.md](FIELD-NOTES.md)). |
| `authType` | `sso`, `basic`, `oauth` | no, but write it | Defaults to `SAP_AUTH_TYPE`, otherwise `sso`; an unknown value also falls back to that default (see the trap above). `browser` is an alias of `sso`; `auth` an alias of the key. |
| `user`, `password` | string | with `basic` | Both required for `basic`; silently dropped for the other modes (an SSO client is labelled `sso`, an OAuth client with its `clientId`). Use `${env:VAR}` for `password`. |
| `oauth` | object | with `oauth` | `tokenUrl`, `clientId`, `clientSecret` required, `scope` optional. Client-credentials grant: `clientId:clientSecret` go to the token endpoint as HTTP Basic authentication, `scope` in the form body when set. The token is cached until 60 seconds before `expires_in` (3600 seconds when the endpoint omits it), concurrent calls share one token request, and the cache is dropped after a 401 so the retry fetches a fresh one. The token request uses Node's global `fetch`: it is not covered by the destination's `tls` block or by `insecureTls`, and it ignores `HTTPS_PROXY`. |
| `insecureTls` | boolean | no | Disables certificate verification for this destination's ADT calls only. Announced on stderr at every start: `WARNING: TLS certificate verification disabled (insecureTls) for destination(s): NAME`. Use `tls.ca` instead whenever the certificate's names match the host (next section). |
| `tls` | object | no | `ca`, `cert`, `key`, `pfx`, `passphrase`. `cert` and `key` go together; `pfx` (PKCS#12) is the alternative, with `passphrase`. The resulting `https.Agent` (keep-alive) is used for basic, OAuth and SSO API calls; the browser window of an SSO login uses its own trust store. |
| `gitUser`, `gitPassword` | string | no | abapGit remote credentials. Backfilled into `gitExternalRepoInfo`, `gitCreateRepo`, `gitPullRepo`, `stageRepo`, `pushRepo`, `checkRepo`, `remoteRepoInfo` and `switchRepoBranch` when the call omits `user`/`password`, so the token never has to pass through the model. Explicit arguments win. |
| `default` | boolean | no | Marks the entry used when `destination` is omitted. `SAP_DEFAULT_DESTINATION` overrides it. |
| `policy` | object | no | Server-side guard rails, see [section 3](#3-policy-in-depth). A destination without `policy` is fully writable within the SAP user's authorizations. |

`listSystems` reports each entry as `destination`, `url`, `client`, `authType`, the policy summary, a short `tls` description (`custom CA`, `client certificate`, `verification disabled`) and, once a profile has been built, `platform` and `unavailableToolsets`. Credentials and certificate material are never reported.

### `tls.ca`: corporate CA or the server's own self-signed certificate

`tls.ca` is handed to Node's `https.Agent` as its `ca` option, which has two properties worth knowing. It replaces the default trust store for that destination (the Mozilla bundle is not consulted any more, so a `ca` that holds only the corporate root cannot reach a public-CA host through the same destination, which never matters for one SAP system). And a self-signed certificate is its own CA: the server's own certificate, exported as PEM, is a valid value. Verification stays on, hostname checking included, and no warning is printed. Three cases:

| What the SAP system presents | `tls.ca` value |
|---|---|
| A certificate issued by a corporate CA | The corporate root, or root plus intermediates, as one PEM bundle (`/etc/ssl/corp-ca.pem`). |
| A self-signed certificate whose Subject or Subject Alternative Name matches the host in `url` | The certificate itself, as PEM. |
| A self-signed certificate whose names do not match `url` (an IP address, a default `sap-host.local` name) | `tls.ca` cannot help, because hostname verification would still fail. Either fix `url` to the name in the certificate, have Basis reissue it with the right SAN, or use `insecureTls: true` for that sandbox. |

Two ways to obtain the PEM of an on-prem system. From your workstation, `openssl s_client` prints the certificate chain the server sends; the first block is the server certificate (for a corporate-issued one, keep every block instead and hand them all to `tls.ca`):

```bash
openssl s_client -connect sap.example.com:44300 -servername sap.example.com -showcerts </dev/null 2>/dev/null \
  | openssl x509 -outform PEM > ~/.abap-adt-mcp/sap-example.pem
openssl x509 -in ~/.abap-adt-mcp/sap-example.pem -noout -subject -ext subjectAltName -enddate
```

The second command shows the names the certificate carries and its expiry; the host in `url` must be one of them. Or ask Basis to export the own certificate of the SSL server PSE from `STRUST` in Base64 format, which is the same PEM. A destination that uses it:

```json
{
  "DEV": {
    "url": "https://sap.example.com:44300",
    "client": "100",
    "authType": "basic",
    "user": "DEVELOPER",
    "password": "${env:DEV_PASSWORD}",
    "tls": { "ca": "/Users/me/.abap-adt-mcp/sap-example.pem" }
  }
}
```

When the certificate is renewed the file must be replaced; the symptom is the same handshake error as before it was configured. `listSystems` shows `tls: "custom CA"` for such an entry, never the material.

### On-prem, basic auth, corporate CA and Z-only writes

```json
{
  "ECC": {
    "url": "https://sap.example.com:44300",
    "client": "100",
    "language": "EN",
    "authType": "basic",
    "user": "DEVELOPER",
    "password": "${env:ECC_PASSWORD}",
    "default": true,
    "tls": { "ca": "/etc/ssl/corp-ca.pem" },
    "policy": { "allowedPackages": ["Z*", "$*"] }
  }
}
```

`basic` authenticates on the first request; `login` is optional. `$*` covers `$TMP` and other local packages, which on-prem systems accept without a transport.

### On-prem production, read-only, with a dedicated display user

A production destination combines a server-side policy with an SAP user that cannot write even if the policy were removed. Two choices for the user:

| Deployment | User | Why |
|---|---|---|
| stdio, one process per person | The person's own credentials via `${env:VAR}` | SAP's own logs attribute every read to the person; nothing to provision. |
| Shared HTTP instance or container | One dedicated display-only user | Every caller shares one identity anyway; attribution comes from the proxy access log (section 6). A dedicated user can be locked without touching anyone's account. Ask Basis for a user type that does not demand an initial password change on first logon (ADT cannot answer that dialog); a Service-type user is commonly used for technical HTTP access, which is a Basis decision. |

```json
{
  "PRD": {
    "url": "https://prd.example.com:44300",
    "client": "100",
    "authType": "basic",
    "user": "ADT_READ",
    "password": "${env:PRD_READ_PASSWORD}",
    "tls": { "ca": "/etc/ssl/corp-ca.pem" },
    "policy": {
      "readOnly": true,
      "allowFreeSql": false,
      "deniedTables": ["PA*", "HR*", "USR*"],
      "deniedTools": ["exportPackageSources", "runQuery", "tableContents"]
    }
  }
}
```

The server checks none of the SAP authorizations itself; it only refuses tools. A starting point for the display user, to be verified by Basis with `SU53` or `STAUTHTRACE` on your release, is the set Eclipse ADT needs for reading: `S_ADT_RES` (ADT resource access), `S_DEVELOP` with activity `03` (display) for the object types and packages in scope, `S_TRANSPRT` with activity `03` for `transportDetails` and `transportUnifiedDiff`, and, only if data reads are wanted (drop the two data tools from `deniedTools` then), `S_TABU_DIS` or `S_TABU_NAM` with activity `03` for the tables the data preview may read. Without `S_DEVELOP` activity `02` the user cannot lock, so a policy mistake cannot turn into a write. Section 3 explains what `readOnly` alone guarantees and why the recipe closes three more tools.

### S/4HANA Cloud, browser SSO for a named user

```json
{
  "DEV": {
    "url": "https://myXXXXXX.s4hana.cloud.sap",
    "client": "080",
    "authType": "sso",
    "default": true,
    "policy": { "allowedPackages": ["Z*"] }
  },
  "PRD": {
    "url": "https://myYYYYYY.s4hana.cloud.sap",
    "client": "100",
    "authType": "sso",
    "policy": { "readOnly": true, "deniedTables": ["PA*", "HR*", "USR02"], "allowFreeSql": false }
  }
}
```

This is the pair the [README setup](../README.md#1-describe-your-sap-systems) shows. Nothing to configure on the SAP side beyond the developer business role Eclipse ADT already needs (SAP delivers it as the template `SAP_BR_DEVELOPER`; your tenant may use a copy). `client` must be the client the SSO session actually lands on, which can differ from the one you expect ([docs/AUTH.md](AUTH.md) shows `100` where `080` was assumed; the session cookie is named `SAP_SESSIONID_<SID>_<client>`); `listSystems` echoes the configured value, `systemProfile` the system information the tenant reports. Add `$*` to `allowedPackages` only if local objects are part of the workflow on that tenant ([docs/TESTPLAN.md](TESTPLAN.md) records `$TMP` refused on the tested tenant). The `PRD` policy here is the first of the two read-only levels described in section 3: no write reaches SAP, table reads by name are still possible.

### S/4HANA Cloud, OAuth2 for an unattended client

Where this mode stands first, so the prerequisites are read for what they are. The client-credentials implementation (`src/lib/oauth.ts`) follows SAP's documented flow, but it has not been exercised against a live Communication Arrangement: the tenants in [docs/TESTPLAN.md](TESTPLAN.md) were tested with browser SSO, and the same test plan (item 2.10) records that basic authentication for a named user is redirected to the identity provider rather than refused. Neither `basic` with a Communication User nor `oauth` is therefore verified by this repository; both follow SAP's documentation for technical users. Confirm on your tenant before relying on either in production.

```json
{
  "DEV-BOT": {
    "url": "https://myXXXXXX-api.s4hana.cloud.sap",
    "client": "080",
    "authType": "oauth",
    "oauth": {
      "tokenUrl": "https://myXXXXXX-api.s4hana.cloud.sap/sap/bc/sec/oauth2/token",
      "clientId": "${env:DEV_BOT_CLIENT_ID}",
      "clientSecret": "${env:DEV_BOT_CLIENT_SECRET}"
    },
    "policy": { "allowedPackages": ["Z*"], "allowedTransports": ["DEVK9*"] }
  }
}
```

What to collect from the tenant administrator, and where each value goes:

| Ask for | Goes to | Notes |
|---|---|---|
| The Communication Scenario that exposes ADT on your tenant | nowhere in the file | The scenario id is deliberately not named here or in [docs/AUTH.md](AUTH.md): it depends on the tenant's developer-extensibility enablement and was not verified by this repository. Without a scenario that exposes ADT, no Communication Arrangement can be created and OAuth mode is not available on that tenant; the alternatives are `sso` for named users or, if your tenant accepts it, `basic` with the Communication User. |
| Communication User (Maintain Communication Users) | `oauth.clientId`, `oauth.clientSecret` | The user's authorizations come from the scenarios of the arrangements it is assigned to, not from business roles; a Communication User cannot be given `SAP_BR_DEVELOPER`. What ADT operations the scenario grants is SAP's decision, so the policy block is the read-only control you actually own. |
| Communication System with OAuth 2.0 inbound authentication, and the Communication Arrangement for the scenario | `oauth.tokenUrl`, `url` | The arrangement's OAuth 2.0 details show the token endpoint with its host. SAP publishes the inbound services of an arrangement on the tenant's API host, `myXXXXXX-api.s4hana.cloud.sap` by convention, which is why the example above uses it for both `tokenUrl` and `url`; take both from the arrangement rather than from this page. The path is usually `/sap/bc/sec/oauth2/token`, but the arrangement is authoritative. |
| Scopes, if the arrangement defines any | `oauth.scope` | Leave the key out otherwise; an empty string is sent as a scope. |
| The client in which the arrangement was created | `client` | Sent as `sap-client` on the login request, never on the token request. Set it to the arrangement's client (the About entry of the administrator's launchpad shows it); do not copy it from an `sso` entry of the same tenant, whose value is where a browser session lands. Omit it only if the tenant has a single customer client and you accept the system default. |

When both `basic` and `oauth` are possible for a Communication User, prefer `oauth`: the long-lived secret leaves the service host only towards the token endpoint, the ADT calls carry a short-lived bearer token that the server invalidates on a 401 and refreshes by itself, and rotating the secret in the Communication User does not require a session drop. `basic` sends the user's password with the login request of every SAP session and has no rotation story beyond editing the file and restarting. The price of `oauth` is the arrangement: a Communication System with OAuth 2.0 and a scenario that exposes ADT, which is exactly what the table asks for. Both modes suit containers and shared HTTP instances, because neither opens a browser or shares a personal session.

### Mutual TLS in front of an on-prem system

```json
{
  "ECC-MTLS": {
    "url": "https://adt-gateway.example.com",
    "client": "100",
    "authType": "basic",
    "user": "DEVELOPER",
    "password": "${env:ECC_PASSWORD}",
    "tls": {
      "ca": "/etc/ssl/corp-ca.pem",
      "cert": "/home/me/.abap-adt-mcp/dev.crt",
      "key": "/home/me/.abap-adt-mcp/dev.key",
      "passphrase": "${env:DEV_KEY_PASSPHRASE}"
    }
  }
}
```

Or `"pfx": "/home/me/.abap-adt-mcp/dev.p12"` with `passphrase` instead of `cert`/`key`. The certificate authenticates the TLS connection to the proxy or gateway; SAP still needs its own credentials (`basic` here), unless the gateway maps the certificate to a user and the ABAP side accepts the request without a password, which is a gateway question, not a server option.

## 3. Policy in depth

`policy` is evaluated by the server (`src/lib/policy.ts`) inside the destination's call queue, before login and before any SAP request, whatever the MCP host approved. A refusal is final: the error tells the model not to retry.

### What "read-only" means, in two levels

The word covers two different guarantees, and the README, [docs/AUTH.md](AUTH.md) and this document all use both; here is the split.

| Level | Policy | Guarantee | What still happens |
|---|---|---|---|
| No writes to SAP | `"readOnly": true` | No tool that changes SAP state runs: no source write, no `lock`, no create, delete or activation, no transport, no unit test or ATC run, no snippet or class run, no abapGit or RAP write, no refactoring execution, no debugger or trace write. | Reads of any kind, including `runQuery` and `tableContents` (they read business data with the user's display authorizations), `revisions`, `transportUnifiedDiff`, `grepPackage`, refactoring previews, and `exportPackageSources`, which writes to the local disk only. |
| No writes, no data, no source export | `readOnly` plus `allowFreeSql: false`, `deniedTables` and `deniedTools: ["exportPackageSources", "runQuery", "tableContents"]` | The above, and no table content reaches the model or the audit file, and no package is copied to disk. | Source reads, navigation, transport reads, dumps. |

A "production must be read-only" requirement in the sense of "the model cannot change production" is met by `readOnly` alone. A requirement that also covers business data or source leaving SAP is met by the second level, which is the `PRD` recipe below and the on-prem production entry in section 2. The README's `PRD` entry sits in between (`readOnly`, `allowFreeSql: false` and denied tables, but `tableContents` by name still allowed on other tables).

### Keys

| Key | Type | Effect |
|---|---|---|
| `readOnly` | boolean | Only tools annotated read-only (`READ_ONLY_TOOLS` in `src/toolManifest.ts`, the tools marked with a book in [docs/TOOLS.md](TOOLS.md)) may run, plus the always-allowed set below. |
| `deniedTools` | globs | Tool names refused outright. The tools stay listed. |
| `allowFreeSql` | boolean | `false` refuses `runQuery` and `tableContents` when it carries `sqlQuery`. Absent or `true` changes nothing. |
| `deniedTables` | globs | Table names that must not be read or referenced. |
| `allowedPackages` | globs | Closed list: writes are only allowed into packages that match; an unknown package is refused. Reads are never gated. |
| `allowedTransports` | globs | Every transport argument must match; creating transports is refused. |

Types are in section 1 (Accepted JSON types). A `policy` object whose keys are all absent counts as no policy.

### Glob rules

Patterns are matched case-insensitively against the whole value: `*` matches any run of characters, `?` one character, everything else literally. `Z*` matches `ZFIN` and `zfin` but not `/ACME/ZFIN`; a namespace needs its own pattern (`/ACME/*`). `$*` matches `$TMP`. `DEVK9*` matches `DEVK900123`.

### Gate order and what each gate covers

Gates run in a fixed order and the first refusal wins: `readOnly`, `deniedTools`, `allowFreeSql`, `deniedTables`, `allowedPackages`, `allowedTransports`.

**readOnly.** Always allowed regardless of annotation (`ALWAYS_ALLOWED`): `login`, `logout`, `dropSession`, `listSystems`, `healthcheck`, `systemProfile`, `exportPackageSources`. Everything not annotated read-only is refused: source writes, `lock`, create, delete and activation, `createTransport`, `transportRelease`, `unitTestRun`, `createAtcRun`, `atcSummary`, `runClass`, `runSnippet`, abapGit writes, refactoring executions, debugger and trace writes. Still allowed because they are reads: `runQuery`, `tableContents`, `revisions`, `transportUnifiedDiff`, `grepPackage`, refactoring previews.

**deniedTools.** The tool name against each glob.

**allowFreeSql.** Only when set to `false`: `runQuery` (any statement) and `tableContents` with a `sqlQuery` argument.

**deniedTables.** The names collected from the call: `ddicEntityName` of `tableContents`; every `FROM` and `JOIN` target of a `sqlQuery` (`tableContents` or `runQuery`); and, best effort, the `FROM`/`JOIN` targets found in the ABAP text of `runSnippet` (`code`), `setObjectSource` and `setMethodSource` (`source`). The scan is a regular expression over the text, so dynamic table names, `editObjectSource` replacements, CDS views over a denied table and `getObjectSource` of code that reads it are not detected. For data that must not leave SAP, rely on the display authorizations of the connected user and pair `deniedTables` with `allowFreeSql: false` and `deniedTools: ["runSnippet"]` or `readOnly`.

**allowedPackages.** Each write tool contributes a package in one of three ways:

| How the package is found | Tools |
|---|---|
| Package argument checked directly | `createObject` (`parentName`, or the segment after `/packages/` in `parentPath`), `runSnippet` (`packageName`, default `$TMP`), `activatePackage` (`packageName`), `gitCreateRepo` (`packageName`), `changePackageExecute` (the `newPackage` inside its `refactoring` JSON; the object's current package is not checked) |
| Object URL argument resolved to its package through `transportInfo` (`OBJECT_URL_ARGS`) | `setObjectSource`, `editObjectSource`, `atcApplyQuickfix` (`objectSourceUrl`); `setMethodSource` (`classUrl`); `deleteObject`, `lock`, `activateByName`, `setTextElements`, `changePackagePreview` (`objectUrl`; a `changePackagePreview` call that omits `objectUrl` has its `newPackage` checked instead); `setDomainProperties` (`domainUrl`); `setDataElementProperties` (`dataElementUrl`); `createTestInclude` (`clas`); `activateObjects` (each of the first 50 entries by `adtcore:uri` or `uri`); `renameExecute` and `extractMethodExecute` (the object URI inside `refactoring`) |
| Refused whenever `allowedPackages` is set (`UNRESOLVABLE_WRITES`) | `gitPullRepo`, `rapGenGenerate`, `rapGenPublishService`, `publishServiceBinding`, `unPublishServiceBinding`: their arguments do not name a package |

For every object URL argument, a value that does not start with `/` is treated as a class name and turned into `/sap/bc/adt/oo/classes/<name>`. The mode is closed: when the package cannot be determined (`transportInfo` fails, the object does not exist yet, a direct package argument is missing) the call is refused with `could not determine the object package of the object, and allowedPackages is closed`. One edge: an object-URL tool called without its URL argument passes this gate and fails in the handler instead, since there is nothing to resolve. Tools not in the table are not gated by this key at all: `pushRepo`, `stageRepo`, `switchRepoBranch`, `gitUnlinkRepo`, `unitTestRun`, `runClass`, `createTransport`, `transportRelease`, `transportDelete`, `transportSetOwner`, `transportAddUser`, `fixEdits`, ATC exemptions, debugger and trace writes, `unLock`, `forceUnlock`. Use `deniedTools` for those.

**allowedTransports.** `createTransport` and `resolveTransport` with `createIfMissing: true` are refused. Then the transport argument of the call (`TRANSPORT_ARGS`: `transport` on `setObjectSource`, `editObjectSource`, `setMethodSource`, `createObject`, `deleteObject`, `atcApplyQuickfix`, `gitPullRepo`, `gitCreateRepo`, `rapGenGenerate`, `createTestInclude`, `runSnippet`, `setDomainProperties`, `setDataElementProperties`, `setTextElements`, `changePackagePreview`; `transportNumber` on `transportRelease`, `transportDelete`, `transportSetOwner`, `transportAddUser`) must match a glob when present. A call without a transport argument passes this gate (local packages, or the gate has nothing to check), so combine it with `allowedPackages` when writes must stay both in a package and on a transport.

### How packages are resolved and cached

The package of an existing object is read with the ADT `transportInfo` call on the object URL (`/source/main`, include and fragment suffixes are stripped first) and taken from its `DEVCLASS` field. The result is memoised per destination in a map keyed by the lower-cased object URL, so a sequence of edits on one class costs one lookup. The memo is cleared after any tool that can move, create, rename or delete objects: `changePackageExecute`, `deleteObject`, `createObject`, `renameExecute`, `gitPullRepo`, `rapGenGenerate`. A failed lookup is not cached. On an SSO destination the lookup itself triggers the browser login if none exists yet; a refusal by `readOnly` or `deniedTools` happens earlier and opens no browser.

### Error shape

A refusal is an MCP `InvalidRequest` error rendered as a JSON text result with `isError: true`:

```json
{
  "error": "MCP error -32600: Policy: runQuery blocked on destination QAS (allowFreeSql): free SQL (runQuery) is disabled; use tableContents on an allowed table. Configured in systems.json policy; retrying will not help.",
  "code": -32600,
  "kind": "policyDenied",
  "hint": "The server policy for this destination refuses the call. Retrying will not help: pick another destination (listSystems shows each policy) or ask the owner to change the policy in systems.json.",
  "nextTools": ["listSystems"]
}
```

The gate name in parentheses is what the audit log stores as `gate`. `listSystems` shows every destination's policy so the model can pick another one instead of retrying.

### Recipes

Production locked down (the second read-only level: no writes, no data, no source export):

```json
"PRD": {
  "url": "https://myYYYYYY.s4hana.cloud.sap", "client": "100", "authType": "sso",
  "policy": {
    "readOnly": true,
    "allowFreeSql": false,
    "deniedTables": ["PA*", "HR*", "USR*", "ZFIN_SALARY*"],
    "deniedTools": ["exportPackageSources", "runQuery", "tableContents"]
  }
}
```

`readOnly` alone still allows `runQuery`, `tableContents` and `exportPackageSources`; the `deniedTools` line closes them. `deniedTables` and `allowFreeSql` then only matter for the text scan of source writes, which `readOnly` already refuses; they are kept so that relaxing `deniedTools` later does not silently reopen the tables.

Z-only development, local packages allowed, no releases, no abapGit:

```json
"DEV": {
  "url": "https://sap.example.com:44300", "client": "100", "authType": "basic",
  "user": "DEVELOPER", "password": "${env:DEV_PASSWORD}",
  "policy": {
    "allowedPackages": ["Z*", "$*"],
    "deniedTools": ["transportRelease", "transportDelete", "deleteObject", "git*", "rapGen*"]
  }
}
```

One transport only, for a change window:

```json
"policy": { "allowedPackages": ["ZFIN*"], "allowedTransports": ["DEVK900123"] }
```

`resolveTransport` still finds the transport that records an object, but cannot create one; every write must carry `DEVK900123`.

Hide sensitive tables while keeping SQL for everything else:

```json
"policy": { "deniedTables": ["PA0*", "HRP*", "USR02", "T000"], "deniedTools": ["runSnippet", "runClass"] }
```

Snippets and class runs can read any table the SAP user may read, which is why they are denied together with the tables.

## 4. Toolsets

Tools are grouped into 16 toolsets (`TOOLSETS` in `src/toolManifest.ts`). Publishing fewer of them keeps the tool schemas from consuming the chat's context window. The numbers below come from [docs/TOOLS.md](TOOLS.md), which is generated from the live `tools/list` response (173 tools in total):

| Toolset | Tools | Contents | In `focused` |
|---|---|---|---|
| `core` | 6 | `listSystems`, `healthcheck`, `systemProfile`, `login`, `logout`, `dropSession` | always |
| `source` | 16 | read, write, edit source, lock and unlock, pretty printer, revisions, text elements | yes |
| `objects` | 27 | search by name and content, structure, create, delete, activate, navigation, export | yes |
| `transports` | 18 | transport requests, details, diffs, release | yes |
| `analysis` | 16 | syntax check, completion, where-used, fixes, ABAP documentation, `runClass`, `runSnippet`, `apiReleaseState` | yes |
| `tests` | 4 | ABAP Unit runs and evaluation | yes |
| `atc` | 14 | ATC runs, findings, exemptions, quickfixes | yes |
| `data` | 10 | table contents, SQL, DDIC elements, domains, data elements | yes |
| `runtime` | 3 | feeds, short dumps and dump details | yes |
| `discovery` | 7 | ADT discovery, object types, feature details | no |
| `refactoring` | 8 | rename, extract method, change package | no |
| `rap` | 8 | RAP generator | no |
| `services` | 4 | OData service bindings | no |
| `git` | 10 | abapGit repositories | no |
| `debugger` | 13 | ADT debugger | no |
| `traces` | 9 | ABAP runtime traces | no |

Presets: `all` (default, 173 tools) and `focused` (`core` plus the eight toolsets marked yes, 114 tools).

`MCP_TOOLSETS` takes either one preset name or a comma-separated list of toolset names; a preset mixed into a list is an error, because `all` and `focused` are not toolset names. `MCP_DISABLED_TOOLSETS` removes toolsets from whatever was selected. `core` is always on: listing it in `MCP_DISABLED_TOOLSETS` has no effect. Unknown names fail at startup with `MCP_TOOLSETS names unknown toolset(s): debuger. Valid: core, source, ...; presets: all, focused`, so a typo cannot silently hide tools. When fewer than all toolsets are active the server logs `Active toolsets: ... (N tools)` on stderr, and `healthcheck` and `listSystems` report `activeToolsets`.

A call to a tool of a hidden toolset (from a stale host cache, a prompt or a skill) is refused with `Tool debuggerListen belongs to toolset "debugger", which is not enabled (active: core, source, ...). Start the server with MCP_TOOLSETS including "debugger" (or MCP_TOOLSETS=all).`

### The platform gate

Toolsets are a server-wide choice; whether a destination can actually serve a toolset is decided per destination by its profile (`src/lib/systemProfile.ts`). The profile is built from the ADT discovery document plus `/sap/bc/adt/system/information`, and maps ten toolsets to the ADT collection they need (`TOOLSET_FEATURE`): `debugger` needs `/sap/bc/adt/debugger`, `traces` `/sap/bc/adt/runtime/traces`, `git` `/sap/bc/adt/abapgit/repos`, `atc` `/sap/bc/adt/atc`, `rap` `/sap/bc/adt/businessservices/generators`, `services` `/sap/bc/adt/businessservices/bindings`, `runtime` `/sap/bc/adt/feeds`, `tests` `/sap/bc/adt/abapunit`, `data` `/sap/bc/adt/datapreview`, `refactoring` `/sap/bc/adt/refactorings`. The other toolsets are never gated.

`MCP_PROFILE_GATE` controls what happens when a tool of a gated toolset is called:

| Value | Behaviour |
|---|---|
| `enforce` (default) | The profile is built on the first call of a gated toolset if `systemProfile` has not been called yet. A tool the destination lacks is refused before any SAP call: `Tool debuggerListen is not available on destination DEV (S/4HANA Cloud does not expose the ADT debugger collection; see systemProfile). Pick another approach: dumps/dumpDetails instead of the debugger, ATC instead of traces.` |
| `warn` | Same detection; the message goes to stderr and the call proceeds. |
| `off` | No profile is built for gating; calls go straight to SAP and fail there when the endpoint is missing. |

If building the profile fails (network, authorization) the server logs `could not build the system profile (...); <tool> runs unchecked` and lets the call through; the failure is not cached, so the next gated call tries again. A successful profile is cached per destination for the life of the server instance; `systemProfile(refresh=true)` rebuilds it. Three mechanisms, three visibilities:

| Mechanism | Tool listed? | Scope | Refusal names |
|---|---|---|---|
| `MCP_TOOLSETS` / `MCP_DISABLED_TOOLSETS` | no | server | the toolset |
| `policy.deniedTools` (and the other gates) | yes | destination | the gate, `kind: policyDenied` |
| platform gate (`MCP_PROFILE_GATE`) | yes | destination, detected | the missing ADT collection |

## 5. Environment variables

All variables declared in [server.json](../server.json), plus the two the server reads without declaring. Values `1`, `true`, `yes` are equivalent for switches.

**Connection and destinations**

| Variable | Default | Effect |
|---|---|---|
| `SAP_SYSTEMS_FILE` | unset | Path to the destinations file. Recommended; mode `0600`. |
| `SAP_SYSTEMS` | unset | The same map inline. Takes precedence over the file. Secret. |
| `SAP_DEFAULT_DESTINATION` | unset | Name used when a call omits `destination`; must be a configured entry, otherwise ignored. In legacy mode it names the implicit destination. |
| `SAP_AUTH_TYPE` | `sso` | Default `authType` for entries without one (and for unknown values), and the mode of the legacy single-system setup. Set it to `basic` on hosts that only serve on-prem systems. |

**Policy and safety**

| Variable | Default | Effect |
|---|---|---|
| `MCP_READ_ONLY` | off | Adds `readOnly: true` to every destination's policy on top of the file; redundant and harmless where the file already says so, fixed for the life of the process (section 1). |
| `SAP_ALLOW_REENTRANCE_TICKET` | off | Enables the `reentranceTicket` tool, which returns a live logon credential into the conversation; without it the tool answers `reentranceTicket is disabled ...` before calling SAP. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | unset | Not a server option, and it does not work here: `0` would disable certificate verification for every connection of the process, so the server deletes the variable at startup and reports that it was ignored. Use `tls.ca` (also for a self-signed certificate) or `insecureTls` on the destination that needs it. |

**Toolsets and profile gate**

| Variable | Default | Effect |
|---|---|---|
| `MCP_TOOLSETS` | `all` | Preset (`all`, `focused`) or comma list of toolsets to publish. |
| `MCP_DISABLED_TOOLSETS` | unset | Comma list of toolsets to hide; `core` cannot be hidden. |
| `MCP_PROFILE_GATE` | `enforce` | `enforce`, `warn` or `off` for tools the destination does not expose. |

**Response size and caches**

| Variable | Default | Effect |
|---|---|---|
| `MCP_MAX_RESPONSE_CHARS` | `40000` | Character budget of one tool response; results are paged or truncated to fit and report `hasMore`. Values below `5000` or non-numeric are ignored with a stderr message. Raise it when the host accepts larger outputs. |
| `MCP_SOURCE_CACHE_TTL_SECONDS` | `300` | Lifetime of the per-destination, per-session source cache reused by `syntaxCheckCode`, `grepPackage`, `cdsViewInfo`, `typeHierarchy`, `abapDocumentation` and `apiReleaseState(sourceUrl)`. `0` keeps entries until `logout`, `dropSession` or a re-authentication; a negative or non-numeric value falls back to `300`. Read once at process start. |
| `MCP_CACHE_DIR` | `~/.abap-adt-mcp/cache` | Directory of the cloudification repository files downloaded by `apiReleaseState` (24-hour lifetime, 15-second download timeout, cached copy used when the download fails). Not in `server.json`. |
| `MCP_EXPORT_ROOT` | `~/.abap-adt-mcp/exports` | The only directory tree `exportPackageSources` may write into; `targetDir` must be an absolute path inside it, compared on real paths so a symlink cannot escape. |

**Audit**

| Variable | Default | Effect |
|---|---|---|
| `MCP_AUDIT_FILE` | unset (off) | Path of the JSONL audit trail, one record per tool call ([section 7](#7-audit-log-record-format)). The parent directory must be creatable or writable by the user running the server; in a container that user is `node` (section 6). |

**HTTP transport**

| Variable | Default | Effect |
|---|---|---|
| `MCP_HTTP_PORT` | unset (stdio) | Serve Streamable HTTP on `/mcp` instead of stdio. `1024` to `65535`; a number outside that range fails with `MCP_HTTP_PORT must be between 1024 and 65535, got ...`, while a value that is not a number at all counts as unset and the server silently stays on stdio. |
| `MCP_HTTP_HOST` | `127.0.0.1` | Bind address. `127.0.0.1` behind a proxy on the same machine; `0.0.0.0` only inside a container that publishes the port. |
| `MCP_HTTP_TOKEN` | generated | Bearer token. When unset, 32 random bytes in hex are written to `~/.abap-adt-mcp/http-token` (mode `0600`) and the path is printed on stderr. Secret. |
| `MCP_HTTP_MAX_SESSIONS` | `16` | Concurrent MCP sessions; further `initialize` requests get `503` with `Retry-After: 30`. Non-positive or non-numeric values fall back to 16. |
| `MCP_HTTP_SESSION_TTL_MINUTES` | `30` | Idle minutes before a session (with its SAP sessions and locks) is closed. Non-positive or non-numeric values fall back to 30. The sweeper runs every minute at most. |
| `MCP_HTTP_ALLOWED_ORIGINS` | unset | Comma list of `Origin` values allowed; `*` allows any. Loopback origins always pass on a loopback bind; requests without `Origin` (every non-browser client) always pass. |
| `MCP_HTTP_ALLOWED_HOSTS` | unset | Comma list of `Host` header values allowed, with or without port; `*` allows any. Only consulted on a loopback bind, where loopback hosts always pass; on a non-loopback bind every `Host` passes and the variable is never needed. The matrix is in section 6. |

**Browser SSO**

| Variable | Default | Effect |
|---|---|---|
| `SAP_BROWSER_PATH` | auto-detected | Path to a Chromium-based browser executable. Auto-detection only knows the macOS locations of Chrome, Edge and Brave under `/Applications`; on Windows and Linux the variable is required, otherwise the login fails with `No Chrome/Edge/Brave found for SSO login`. |
| `SAP_BROWSER_PROFILE_DIR` | `~/.abap-adt-mcp/sso/<host>` | Directory of the persistent browser profile that keeps the identity-provider session. Created if missing. Chrome's default profile on macOS (`~/Library/Application Support/Google/Chrome`) is rejected explicitly; do not point it at any browser's live profile on other platforms either, Chrome refuses automation on it and the login window would expose every site's cookies. |

**Legacy single-system mode** (used only when none of `SAP_SYSTEMS`, `SAP_SYSTEMS_FILE` or `systems.json` is present)

| Variable | Effect |
|---|---|
| `SAP_URL` | Base URL; its presence switches the mode on. |
| `SAP_CLIENT`, `SAP_LANGUAGE` | Client and logon language. |
| `SAP_USER`, `SAP_PASSWORD` | Basic credentials (with `SAP_AUTH_TYPE=basic`). |
| `SAP_TLS_INSECURE` | Disables certificate verification for that system. |
| `SAP_OAUTH_TOKEN_URL`, `SAP_OAUTH_CLIENT_ID`, `SAP_OAUTH_CLIENT_SECRET`, `SAP_OAUTH_SCOPE` | OAuth2 client. The loader reads them only when `SAP_AUTH_TYPE=oauth`; a missing one fails with `OAuth mode requires environment variables: ...`. |

Legacy mode has no `policy`, `tls` or `gitUser` equivalents (only `MCP_READ_ONLY` applies); moving to `systems.json` is the way to get them.

## 6. HTTP transport

By default the server speaks stdio: one process per host, nothing listening. Setting `MCP_HTTP_PORT` switches to Streamable HTTP (`src/lib/httpTransport.ts`), the model SAP's own ADT MCP Server uses: a loopback endpoint at `/mcp` guarded by a bearer token.

```bash
MCP_HTTP_PORT=2236 SAP_SYSTEMS_FILE=$HOME/.abap-adt-mcp/systems.json npx -y abap-adt-mcp
# stderr: [abap-adt-mcp] Bearer token written to /Users/me/.abap-adt-mcp/http-token
# stderr: MCP ABAP ADT API server running on http://127.0.0.1:2236/mcp (bearer auth, max 16 sessions, idle expiry 30 min) ...
```

### Request handling, in order

1. `GET /health` answers without authentication: `{"status":"ok","version":"0.3.3","sessions":1,"maxSessions":16,"uptimeSeconds":812}`. Block it at the proxy if that disclosure matters.
2. Any path not starting with `/mcp` is `404`.
3. `Host` check (`403` with `Forbidden: Host header not allowed (DNS rebinding protection). Set MCP_HTTP_ALLOWED_HOSTS to permit it.`). The matrix, from `hostAllowed()`:

   | Bind (`MCP_HTTP_HOST`) | `Host` header | Result |
   |---|---|---|
   | loopback (`127.0.0.1`, `localhost`, `::1`) | `127.0.0.1`, `localhost`, `::1`, with or without a port | pass |
   | loopback | anything else | pass only if listed in `MCP_HTTP_ALLOWED_HOSTS` (with or without port) or the list holds `*` |
   | loopback | absent | `403` |
   | non-loopback (`0.0.0.0`, an interface address) | anything, even absent | pass; the check exists to protect loopback binds from DNS rebinding, and a non-loopback bind is expected to sit behind a proxy that owns the name |

4. `Origin` check (`403`): requests without `Origin` (non-browser clients) pass; with one, it must be listed in `MCP_HTTP_ALLOWED_ORIGINS`, be `*`-allowed, or be a loopback origin on a loopback bind.
5. Bearer check (`401`, `Unauthorized: send Authorization: Bearer <token>`): `Authorization: Bearer <token>`, compared in constant time on the UTF-8 bytes.
6. Session routing: a request with `mcp-session-id` goes to that session (unknown or expired id: `404`, `send a new initialize request without mcp-session-id`); without the header only a `POST` whose body contains an `initialize` request may open a session (`400` otherwise); that opening body is capped at 4 MB. `DELETE /mcp` with the session id ends the session.

The server reads no `X-Forwarded-For`, `X-Forwarded-Proto` or `X-Forwarded-Host` header: a proxy may send them, they change nothing, and the audit record has no caller field to receive them (section 7).

### Smoke test from the service host

There is no command-line check flag; the check is an MCP session driven with `curl`. The sequence below was run against 0.3.3 and shows what each step proves. Responses come back as server-sent events (`content-type: text/event-stream`, one `event: message` line and one `data:` line), and the SDK refuses a request whose `Accept` header does not list both `application/json` and `text/event-stream` (`406`, `Not Acceptable: Client must accept both application/json and text/event-stream`).

```bash
MCP=http://127.0.0.1:2236/mcp
TOKEN=$(cat ~/.abap-adt-mcp/http-token)      # or the value of MCP_HTTP_TOKEN
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")

# 1. Open a session; the mcp-session-id response header is the handle for everything after.
SID=$(curl -s -D - -o /dev/null -X POST $MCP "${H[@]}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
  | awk 'tolower($1)=="mcp-session-id:"{print $2}' | tr -d '\r')
curl -s -o /dev/null -w "%{http_code}\n" -X POST $MCP "${H[@]}" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'          # 202

# 2. Server alive, configuration loaded: no SAP contact.
curl -s -X POST $MCP "${H[@]}" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"healthcheck","arguments":{}}}'
curl -s -X POST $MCP "${H[@]}" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"listSystems","arguments":{}}}'

# 3. SAP reachable and the credentials accepted: login contacts SAP in every mode.
curl -s -X POST $MCP "${H[@]}" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"login","arguments":{"destination":"ECC"}}}'

# 4. ADT discovery answered: platform and unavailable toolsets.
curl -s -X POST $MCP "${H[@]}" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"systemProfile","arguments":{"destination":"ECC"}}}'

# 5. Release the session's SAP sessions and locks.
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE $MCP "${H[@]}" -H "mcp-session-id: $SID"   # 200
```

Which tool proves what:

| Tool | Contacts SAP? | What a success proves | Typical failure text |
|---|---|---|---|
| `healthcheck` | no | The process is up, which version, which toolsets, how many tools. | none: it cannot fail on a running server |
| `listSystems` | no | The file was loaded, with the `authType`, `client`, policy and `tls` summary you intended. | none |
| `login` | yes, every mode | `basic`: `GET /sap/bc/adt/compatibility/graph?sap-client=...` answered with the credentials. `oauth`: the token endpoint issued a token (`POST` with the client credentials), then the same ADT request answered with the bearer. `sso`: the browser login completed and the cookies authenticate ADT. | `Login failed: getaddrinfo ENOTFOUND host` (DNS, URL), a TLS handshake error (certificate, section 2), `Login failed: ... 401` (credentials), `OAuth token request failed (400): ...` (client id, secret or scope refused by the token endpoint), `OAuth token endpoint returned non-JSON response` (wrong `tokenUrl`, usually an HTML logon page) |
| `systemProfile` | yes | The discovery document and `/sap/bc/adt/system/information` were read: the destination serves ADT and the user may see it; `platform` says cloud or on-prem and `unavailableToolsets` what is missing. | the same network errors; an authorization error means the user reaches the host but lacks ADT access |

A `login` failure is returned as a tool result with `isError: true`, for example `{"error":"MCP error -32603: Login failed: getaddrinfo ENOTFOUND sap.example.invalid","code":-32603}`; the HTTP status is still `200`, so check the body, not the status. With `MCP_AUDIT_FILE` set the same four calls appear in the audit file with `outcome` `ok` or `error`, which is a convenient way to confirm the audit path is writable at the same time.

### Session model

Every `initialize` creates a new `AbapAdtServer` instance: its own ADT clients, SAP sessions, lock ledger, source cache, package memo and profile per destination, and its own audit `requestId` sequence. Two callers therefore never share a stateful ADT session or a lock. A side effect worth knowing: each new session re-reads the configuration sources, so an edited `systems.json` is seen by the next session while running ones keep theirs (the environment, `MCP_READ_ONLY` included, is that of the process). A session ends on `DELETE` or when idle longer than `MCP_HTTP_SESSION_TTL_MINUTES`; in both cases its instance releases the locks it holds, drops the SAP sessions and closes the keep-alive sockets. `SIGINT`/`SIGTERM` are different in HTTP mode: the handler closes the listening instance (which holds no SAP session of its own) and exits within five seconds, without walking the open sessions, so locks held by a live HTTP session are left to SAP's own session timeout. Send `DELETE` from the clients, or wait for the idle expiry, before stopping a shared instance. Beyond `MCP_HTTP_MAX_SESSIONS` open sessions, `initialize` gets `503`.

### Token file

Without `MCP_HTTP_TOKEN`, the token is generated at every start and overwrites `~/.abap-adt-mcp/http-token` (directory `0700`, file `0600`), so clients must re-read it after a restart. With `MCP_HTTP_TOKEN` the file is not written. There is one token per instance, no per-user tokens and no rotation without a restart. The client side keeps the token in its host configuration, which therefore deserves the same `0600` care as `systems.json`.

### SSO destinations on a shared or headless host

Binding to anything but loopback prints `WARNING: HTTP transport bound to 0.0.0.0, reachable beyond this machine. Keep the bearer token secret, restrict MCP_HTTP_ALLOWED_ORIGINS/HOSTS and put TLS in front.` and, when SSO destinations exist, a second warning naming them: every remote caller would share the browser login of the user running the server, and the browser window opens on that user's screen. That is the shared-instance case; the headless case is stricter. An `sso` entry loaded on a machine without a browser or a display does not fail at startup: the loader accepts it, `listSystems` and `healthcheck` list it, and the two warnings above are the only hint. It fails at the first call that needs the destination (any tool except `listSystems`, `healthcheck`, `logout`, or a call already refused by `readOnly` or `deniedTools`): on Linux or in the container, without `SAP_BROWSER_PATH`, with `No Chrome/Edge/Brave found for SSO login. Set SAP_BROWSER_PATH to a Chromium-based browser executable.`; with `SAP_BROWSER_PATH` set on a host without a display, with the browser's own launch error. The other destinations of the same file keep working. Hence the rule in section 1: a separate `systems.json` per deployment, and `basic` or `oauth` entries only, ideally with `readOnly` or `allowedPackages` policies, for anything shared. The transport provides no TLS, no rate limiting and no caller identity in the audit log: a reverse proxy in front supplies TLS and an access log.

### Reverse proxy with TLS

The server never terminates TLS; a proxy on the same machine does, and the bind stays on loopback so that nothing reaches the server except through the proxy. A worked example with nginx, serving `https://mcp.example.com/mcp`:

```nginx
server {
    listen 443 ssl;
    server_name mcp.example.com;
    ssl_certificate     /etc/ssl/mcp.example.com.pem;
    ssl_certificate_key /etc/ssl/mcp.example.com.key;

    location = /health { return 404; }          # keep the version and session count private

    location /mcp {
        proxy_pass http://127.0.0.1:2236;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;             # forwards mcp.example.com, see below
        proxy_buffering off;                     # responses are server-sent events
        proxy_read_timeout 1h;                   # a long-running tool call keeps one response open
    }
}
```

The server side, on the same machine:

```bash
MCP_HTTP_PORT=2236 MCP_HTTP_HOST=127.0.0.1 MCP_HTTP_TOKEN="$(openssl rand -hex 32)" \
MCP_HTTP_ALLOWED_HOSTS=mcp.example.com \
SAP_SYSTEMS_FILE=/etc/abap-adt-mcp/systems.json MCP_AUDIT_FILE=/var/log/abap-adt-mcp/audit.jsonl \
npx -y abap-adt-mcp
```

Which `Host` the server sees decides whether `MCP_HTTP_ALLOWED_HOSTS` is needed, because the bind is loopback and the matrix above applies:

| Proxy configuration | `Host` received by the server | `MCP_HTTP_ALLOWED_HOSTS` |
|---|---|---|
| nginx with `proxy_set_header Host $host` (as above) | `mcp.example.com` | `mcp.example.com` (a port suffix on the header is stripped before matching, so `mcp.example.com:443` also passes) |
| nginx without that line | its default `$proxy_host`, that is `127.0.0.1:2236` | not needed, it is a loopback host |
| Caddy `reverse_proxy` with its defaults | the client's `Host`, `mcp.example.com` | `mcp.example.com` |

`Origin` needs no configuration for command-line and IDE clients, which send none. `X-Forwarded-*` headers may be added or not; the server ignores them. Caller identity lives in the proxy's access log, keyed by time against the audit file's `ts`. The clients register `https://mcp.example.com/mcp` with the bearer token, exactly as in the HTTP host snippet of section 8, with the URL changed.

In a container the proxy still runs on the host and the container binds `0.0.0.0` on its own network namespace, so the `Host` check passes everything and the variable is not needed; the boundary is the published port on `127.0.0.1` plus the proxy. The next section shows that setup.

### Container deployment

The image (`ghcr.io/williansaez/abap-adt-mcp`, built from `node:22-alpine`) runs `node ./dist/index.js` as the unprivileged `node` user (uid 1000, home `/home/node`). Mount the destinations file read-only, pass the secrets it references, and give the audit log a directory the `node` user can write:

```bash
mkdir -p ./audit && chmod 700 ./audit
sudo chown 1000:1000 ./audit                    # Linux hosts; Docker Desktop on macOS and Windows presents bind mounts writable to any uid
docker run -d --name abap-adt-mcp \
  -v "$PWD/systems.json:/config/systems.json:ro" \
  -v "$PWD/audit:/var/log/abap-adt-mcp" \
  -e SAP_SYSTEMS_FILE=/config/systems.json \
  -e MCP_AUDIT_FILE=/var/log/abap-adt-mcp/audit.jsonl \
  -e ECC_PASSWORD \
  -e MCP_HTTP_PORT=2236 -e MCP_HTTP_HOST=0.0.0.0 -e MCP_HTTP_TOKEN="$(openssl rand -hex 32)" \
  -p 127.0.0.1:2236:2236 \
  ghcr.io/williansaez/abap-adt-mcp:v0.3.3
```

`MCP_HTTP_HOST=0.0.0.0` is needed because the default loopback bind is unreachable through the published port; `-p 127.0.0.1:2236:2236` keeps the port off the network, and the reverse proxy of the previous section points at `127.0.0.1:2236` as before. Without `MCP_HTTP_PORT` the container speaks stdio (`docker run -i`), which is how a desktop host would start it.

**The audit directory.** `MCP_AUDIT_FILE` creates its parent directory with mode `0700` on the first record, as uid 1000. `/var/log` inside the image belongs to root, so without the volume the first tool call prints `[abap-adt-mcp] audit log /var/log/abap-adt-mcp/audit.jsonl not writable: EACCES: permission denied, mkdir '/var/log/abap-adt-mcp'` once on stderr (`docker logs`), every later call is silently unrecorded, and nothing else fails. The bind mount above fixes it; an alternative that needs no `chown` is a path the `node` user already owns, `-e MCP_AUDIT_FILE=/home/node/audit/audit.jsonl` with a volume on `/home/node/audit`. Whichever path you choose, read the file back after the smoke test to be sure it exists.

**The configuration file.** The mode check runs inside the container too, as uid 1000. A `systems.json` owned by your workstation user with mode `0600` is unreadable for `node`, and the start fails with `/config/systems.json is not valid JSON: EACCES: permission denied` (read and parse share one error path). Either `chown 1000` the file and keep `0600`, or make it `0644` and reference every secret as `${env:VAR}` so the check only warns. Secrets passed with `-e` are visible to `docker inspect`; `MCP_HTTP_TOKEN` has no file alternative inside the container (without it the generated token is written to `/home/node/.abap-adt-mcp/http-token` inside the container and printed to `docker logs`). Browser SSO cannot run in a container (no browser, no screen): only `basic` and `oauth` destinations belong in the file you mount, and an `sso` entry that slips in fails at its first call as described above.

## 7. Audit log record format

`MCP_AUDIT_FILE=/path/audit.jsonl` appends one JSON object per line per tool call (`src/lib/audit.ts`). The directory is created with mode `0700`, the file with `0600`; a write failure is reported once on stderr and never fails the call (the container case in section 6 is the common way to hit it). Renaming the file for rotation is safe, the next call creates a new one. `listSystems` and `healthcheck` are audited like every other call.

Fields in the order they are written; optional fields are absent, not null:

| Field | Type | Meaning |
|---|---|---|
| `ts` | ISO 8601 | Time the record was written (end of the call). |
| `requestId` | number | Sequence per server instance, starting at 1 (per HTTP session; per process on stdio). |
| `tool` | string | Tool name as called. |
| `destination` | string | `destination` argument or the default; absent when neither exists. |
| `durationMs` | number | Wall time including policy resolution, login and the retry. |
| `outcome` | `ok`, `error`, `denied`, `unavailable` | `denied` for policy refusals; `unavailable` when the platform gate refused the tool; `error` for everything else, including a refusal because the toolset is not enabled. |
| `retried` | `true` | Present only when SAP answered with an expired session or a CSRF rejection (`kind` `sessionExpired` or `csrf`), the destination was re-authenticated and the call retried once. |
| `args` | object | Redacted summary of the arguments, see below. |
| `errorKind` | string | The `kind` of the error (`policyDenied`, `sessionExpired`, `locked`, `staleLockHandle`, `transportRequired`, `authorization`, `notFound`, ...); absent for `ok` and for unclassified errors. |
| `gate` | string | Policy gate name, parsed from the refusal message. |
| `message` | string | First 300 characters of the error text, after secret redaction. |

`args` keeps every key whose name does not contain `pass`, `secret`, `token`, `authorization`, `cookie` or `lockhandle` (case-insensitive substring match, so `password`, `passphrase`, `lockHandle` and `accessToken` all become `"[REDACTED]"`). Strings up to 200 characters are stored after the same redaction that error messages get (bearer tokens, cookies, `password=` pairs and `user:password@host` URLs are masked); longer strings are cut to 200 characters plus `…[N chars]`. Arrays and objects whose JSON is longer than 200 characters collapse to `[array N chars]` or `[object N chars]`; shorter ones are kept, with nested secret keys redacted and depth capped at 3. An SQL statement or a short snippet with business literals therefore lands in the file: treat it as sensitive.

```json
{"ts":"2026-09-03T10:15:42.117Z","requestId":42,"tool":"editObjectSource","destination":"DEV","durationMs":1834,"outcome":"ok","args":{"objectSourceUrl":"/sap/bc/adt/oo/classes/zcl_example/source/main","replacements":"[array 312 chars]","activate":true,"transport":"DEVK900123"}}
{"ts":"2026-09-03T10:15:58.402Z","requestId":43,"tool":"unitTestRun","destination":"DEV","durationMs":6210,"outcome":"ok","retried":true,"args":{"url":"/sap/bc/adt/oo/classes/zcl_example"}}
{"ts":"2026-09-03T10:16:03.902Z","requestId":44,"tool":"runQuery","destination":"QAS","durationMs":2,"outcome":"denied","args":{"sqlQuery":"SELECT * FROM ztable"},"errorKind":"policyDenied","gate":"allowFreeSql","message":"MCP error -32600: Policy: runQuery blocked on destination QAS (allowFreeSql): free SQL (runQuery) is disabled; use tableContents on an allowed table. Configured in systems.json policy; retrying will not help."}
{"ts":"2026-09-03T10:16:20.115Z","requestId":45,"tool":"debuggerListen","destination":"DEV","durationMs":418,"outcome":"unavailable","args":{"debuggingMode":"user","terminalId":"mcp-terminal-1","ideId":"mcp","user":"DEVELOPER"},"message":"MCP error -32600: Tool debuggerListen is not available on destination DEV (S/4HANA Cloud does not expose the ADT debugger collection; see systemProfile). Pick another approach: dumps/dumpDetails instead of the debugger, ATC instead of traces."}
```

There is no caller identity in a record. On stdio the process belongs to one person; on a shared HTTP instance, run one instance per person or rely on the proxy's access log. [docs/FIELD-NOTES.md](FIELD-NOTES.md#how-to-produce-a-useful-report) explains how to turn the file into a session report.

## 8. Host configuration snippets

The server key `abap-adt-mcp` is the prefix of every tool name in Claude Code (`mcp__abap-adt-mcp__searchObject`) and the name the shipped skills look for; another key works but the skills stop recognising the server.

**Claude Desktop** (Settings > Developer > Edit Config, then quit and reopen). Windows paths use forward slashes:

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "npx",
      "args": ["-y", "abap-adt-mcp@0.3.3"],
      "env": {
        "SAP_SYSTEMS_FILE": "/Users/me/.abap-adt-mcp/systems.json",
        "MCP_TOOLSETS": "focused",
        "MCP_AUDIT_FILE": "/Users/me/.abap-adt-mcp/audit.jsonl"
      }
    }
  }
}
```

If the host cannot find `npx` (`spawn npx ENOENT` in its log), put the absolute path in `command`.

**Where the password of a `basic` entry goes on a desktop.** A host started from the desktop does not inherit your shell variables, so `${env:VAR}` in `systems.json` has nothing to resolve unless the variable is supplied some other way. The README's general advice (prefer `SAP_SYSTEMS_FILE`, keep secrets out of host configs) and the `${env:VAR}` mechanism pull in opposite directions here; the resolution, in order of preference:

| Option | How | Trade-off |
|---|---|---|
| Inline password in the `0600` file | `"password": "s3cret"` in `systems.json`, `chmod 600` | One file, and the only one whose mode the server checks: it refuses to start if the file becomes shared-readable. Recommended for a personal desktop. |
| Launcher script that reads the secret from the OS keychain | `"command": "/Users/me/.abap-adt-mcp/start.sh"`, no `args`, the script below | The password never sits in any file; needs a terminal once to store it (`security add-generic-password -s abap-adt-mcp-ECC -a me -w` on macOS). |
| The variable in the host's `env` block | `"ECC_PASSWORD": "s3cret"` next to `SAP_SYSTEMS_FILE` | Works, but duplicates the secret into `claude_desktop_config.json`, whose mode nobody checks and which other tools read. Last choice. |

```bash
#!/bin/sh
# ~/.abap-adt-mcp/start.sh (chmod 700): pull the secret from the macOS keychain, then run the server
export ECC_PASSWORD="$(security find-generic-password -s abap-adt-mcp-ECC -w)"
export SAP_SYSTEMS_FILE="$HOME/.abap-adt-mcp/systems.json"
export MCP_TOOLSETS=focused
exec npx -y abap-adt-mcp@0.3.3
```

`sso` entries need none of this, which is one more reason they are the default for S/4HANA Cloud.

**Claude Code**, user scope, one line:

```bash
claude mcp add abap-adt-mcp -e SAP_SYSTEMS_FILE=$HOME/.abap-adt-mcp/systems.json -e MCP_TOOLSETS=focused -- npx -y abap-adt-mcp
```

Or a project `.mcp.json` with the same `mcpServers` object as above. The repository's own plugin manifest, [.claude-plugin/plugin.json](../.claude-plugin/plugin.json), registers the server as `npx -y abap-adt-mcp` with `SAP_SYSTEMS_FILE=${HOME}/.abap-adt-mcp/systems.json` and ships the two skills from `skills/`; hosts that install plugins from a repository pick both up, and, at the time of writing, `npx skills add williansaez/abap-adt-mcp` (a third-party installer, not part of this repository) installs the skills alone. Built-in prompts appear as `/mcp__abap-adt-mcp__<prompt>`.

**Cursor, Cline, VS Code and other `mcpServers` hosts**: the Claude Desktop JSON above, in the file each host reads (`.cursor/mcp.json`, the Cline MCP settings file; at the time of writing VS Code's `.vscode/mcp.json` names the map `servers` instead of `mcpServers`). For a host that expects an HTTP endpoint, start the server with `MCP_HTTP_PORT` and register the URL:

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:2236/mcp",
      "headers": { "Authorization": "Bearer <contents of ~/.abap-adt-mcp/http-token>" }
    }
  }
}
```

**Docker as a stdio server** from a desktop host:

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "docker",
      "args": ["run", "-i", "--rm",
               "-v", "/Users/me/.abap-adt-mcp/systems.json:/config/systems.json:ro",
               "-e", "SAP_SYSTEMS_FILE=/config/systems.json",
               "-e", "ECC_PASSWORD",
               "ghcr.io/williansaez/abap-adt-mcp:v0.3.3"],
      "env": { "ECC_PASSWORD": "..." }
    }
  }
}
```

`-e ECC_PASSWORD` without a value forwards the variable from the `env` block into the container. SSO destinations do not work this way (no browser in the container).

**Source checkout**: `"command": "node", "args": ["/absolute/path/abap-adt-mcp/dist/index.js"]` after `npm ci && npm run build`; a `systems.json` in the checkout root is found without `SAP_SYSTEMS_FILE`.

## 9. Operational notes

Everything the server writes lives under `~/.abap-adt-mcp/` unless a variable relocates it:

| Path | Created by | Mode | Contents and when to clean |
|---|---|---|---|
| `~/.abap-adt-mcp/sso/<host>/` | first SSO login to that host | `0700` (and the parent) | The Chromium user-data directory of the login window: identity-provider cookies and local storage set when you tick "stay signed in", nothing the server adds. The harvested SAP session cookie is kept in memory only. Delete the directory to log out of a tenant completely or when a login loops; the next `login` opens a fresh window. `SAP_BROWSER_PROFILE_DIR` replaces it with a profile of your own (created without a mode change). |
| `~/.abap-adt-mcp/http-token` | HTTP transport without `MCP_HTTP_TOKEN` | `0600` | The bearer token; rewritten at every start, so a plain restart already rotates it and nothing has to be deleted first. |
| `~/.abap-adt-mcp/cache/` | `apiReleaseState` | dir `0700`, file `0600` | One JSON file per edition of SAP's cloudification repository (`raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc`), refreshed after 24 hours, reused when the download fails. Delete to force a download; seed it by hand on an air-gapped host. `MCP_CACHE_DIR` relocates it. |
| `~/.abap-adt-mcp/exports/` | `exportPackageSources` | root `0700` | One sub-folder per exported package in abapGit layout plus an `EXPORT.json` manifest. Plain files: delete what you no longer need. `MCP_EXPORT_ROOT` relocates the root. |
| `MCP_AUDIT_FILE` | audit | dir `0700`, file `0600` | Grows without limit; rotate by renaming. |

Things that live only in memory, per destination and per server instance: the SSO cookie jar, the OAuth token, the stateful ADT session, the lock ledger (`listLocks`), the source cache (`MCP_SOURCE_CACHE_TTL_SECONDS`), the objectUrl-to-package memo used by `allowedPackages`, and the capability profile. `logout` and `dropSession` release the locks and clear the source cache for their destination; a session expiry re-authenticates, clears the cache and forgets lock handles (which are invalid anyway, hence `kind: "staleLockHandle"` on the next write); on stdio a `SIGINT`/`SIGTERM` releases everything, and an HTTP session releases everything when it is deleted or expires (see [section 6](#6-http-transport) for what a signal does there).

The SSO login waits up to 300 seconds for a session cookie (`MYSAPSSO2` or `SAP_SESSIONID*`) to appear for the SAP host, polling every 1.5 seconds, then fails with `SSO login timed out`; closing the window early fails with `Browser was closed before the SSO login completed`. Concurrent calls share one in-flight login, so only one window opens. The session is pinned to `client` through `sap-client` on every request; when the identity provider session is still valid the window closes by itself within a few seconds.

Everything operational goes to stderr, which MCP hosts capture in their logs: the config-file mode warning, TLS warnings, `Active toolsets` when reduced, HTTP bind warnings, the audit-file warning, `MCP_PROFILE_GATE=warn` messages, argument renames and re-authentication notices. A fatal configuration error prints `[abap-adt-mcp] Fatal: <message>` and exits with status 1.
