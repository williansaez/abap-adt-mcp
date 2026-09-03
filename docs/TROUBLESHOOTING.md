# Troubleshooting

The [README](../README.md#troubleshooting) lists the symptoms people hit first. This page goes one level down: how the server classifies an error, what each message means, where to look, and what the agent (or you) should do next. Options are in [docs/CONFIGURATION.md](CONFIGURATION.md), tool flows in [docs/WORKFLOWS.md](WORKFLOWS.md), the per-tool reference in [docs/TOOLS.md](TOOLS.md), authentication in [docs/AUTH.md](AUTH.md).

## How an error reaches the model

A failed call returns a text content item with `isError: true` whose text is a JSON object:

```json
{"error":"MCP error -32603: Failed to lock object: Object ZCL_EXAMPLE is currently being processed by user DEVELOPER | type: ExceptionResourceNoAccess | details: [ideUser: DEVELOPER]",
 "code":-32603,"kind":"locked",
 "hint":"The object is locked. listLocks shows the locks this server holds: ...",
 "nextTools":["unLock","lock"]}
```

`error` is the handler message (`Failed to lock object:`, `Login failed:`, `Failed to run query:`) plus the SAP exception (message, `type:`, `namespace:`, `details: [...]`) rendered by `formatAdtError` in `src/lib/adtErrorFormatting.ts`, which re-parses the raw `<exc:exception>` body when `abap-adt-api` only produced "Request failed with status code NNN"; the SDK prefixes it with `MCP error <code>: ` whenever the handler wrapped it in an `McpError`, which most do (`runQuery` and `tableContents` throw a plain `Error`, hence no prefix in the data-preview example below). `code` is `-32603` for SAP failures, `-32602` for invalid params (a missing or unknown `destination`, and handler-side argument errors such as the `editObjectSource` anchor failures), `-32601` for an unknown tool or disabled toolset, `-32600` for policy, platform-gate and `reentranceTicket` refusals. `kind`, `httpStatus`, `hint` and `nextTools` come from `classifyAdtError` in `src/lib/adtErrorHints.ts` and are omitted for `unknown`. Every message passes through `redactSecrets` in `src/index.ts` (tokens, cookies, passwords, credential URLs).

The server instructions and the `abap-adt-mcp` skill tell the agent to follow `hint` and `nextTools` instead of retrying; an agent that retries a `policyDenied` error five times has ignored them.

## Error kinds

Rules are tried in this order and the first match wins; "Detected" lists the HTTP status and text patterns matched against the error fields, message and SAP `properties`. The hint column is the text shipped in `src/lib/adtErrorHints.ts`.

| Kind | Detected | Hint as shipped | nextTools | What the agent should do |
|---|---|---|---|---|
| `policyDenied` | `code = POLICY_DENIED`, message starting `Policy:`, or "blocked by the destination policy" | The server policy for this destination refuses the call. Retrying will not help: pick another destination (listSystems shows each policy) or ask the owner to change the policy in systems.json. | `listSystems` | Stop; report the gate named in the message. |
| `sessionExpired` | `code = SESSION_EXPIRED`, HTTP 401, or session-expired, login-page, identity-provider, SAML or logon-ticket wording | The SAP session expired or was never established. The server re-authenticates and retries once automatically; if this error still surfaces, call login for the destination and lock the object again before writing. | `login`, `lock` | The retry already happened; call `login`. On `basic` a persistent 401 is a wrong password. |
| `csrf` | "csrf" with HTTP 403 or "token" | CSRF token rejected: the session was reset. Re-authenticate (login) and re-acquire any lockHandle before retrying writes. | `login`, `lock` | Same automatic retry; old lock handles are gone. |
| `staleLockHandle` | HTTP 412 or 423, or invalid/expired lock handle wording | The lockHandle is no longer valid (the session changed, the object was unlocked, or the handle belongs to another object). Call lock again on the object URL and pass the new lockHandle. | `lock` | `lock` again, or omit the handle and let the write tool lock by itself. |
| `locked` | `ExceptionResourceNoAccess`, "locked by", "being edited/processed by", "enqueue", "sm12", "already locked", or an `ideUser` property | The object is locked. listLocks shows the locks this server holds: if the object is there, unLock/forceUnlock and retry. If it is not there, the lock belongs to another session (Eclipse/ADT of the same or another user, named in the message); dropSession and forceUnlock cannot release it: wait for that session to end or ask the user to release it (SM12). | `unLock`, `lock` | `listLocks` first. Foreign lock: do not retry, tell the user who holds it. |
| `transportRequired` | HTTP 409, or transport-request, "recording of changes", "is not modifiable", "already in another request" wording | A transport request is required, or the object is already recorded in a different one. Call resolveTransport for the object and pass the returned transport. | `resolveTransport`, `createTransport` | `resolveTransport(objSourceUrl)`, then pass its `transport`. |
| `authorization` | HTTP 403 (not csrf), or "not authorized", "no/missing authorization", "su53" | The SAP user lacks authorization for this action. Check SU53 for the user, or use a destination whose user has a development role. Retrying will not help. | `listSystems` | Stop. On SSO also check `client`: a wrong client looks like missing authorization. |
| `notFound` | HTTP 404, or "not found", "does not exist", "resource ... unknown" | Object or endpoint not found. Resolve the URL with searchObject / findObjectPath (sources need /source/main). On S/4HANA Cloud some ADT endpoints do not exist: check systemProfile for the destination. | `searchObject`, `findObjectPath`, `systemProfile` | Resolve the URL; class includes take the URL from `classIncludes` as is. |
| `rateLimited` | HTTP 429 or 503 | SAP throttled the request (429/503). The server already retried once; wait a few seconds before calling again. | none | Wait, then call once more. |
| `ambiguous400` | HTTP 400 with no better match | SAP rejected the request as invalid (400). Do not retry login. Check the parameters: ADT object URLs (not names), /source/main for source tools, a lockHandle from lock, JSON where the schema asks for it. | `searchObject` | Check the schema in [docs/TOOLS.md](TOOLS.md#tool-details); most 400s are a name where a URL was expected. |
| `serverError` | HTTP 5xx other than 503 | SAP-side failure (5xx), often a short dump. Check dumps for the root cause before retrying; do not blindly retry writes. | `dumps` | `dumps` with a narrow `from`, then `dumpDetails`. |
| `unknown` | nothing matched | none | none | Read `error`; it still carries the SAP text. |

Because of the ordering, a 401 from a wrong `basic` password is reported as `sessionExpired`, and a 403 that mentions a CSRF token is `csrf`, not `authorization`.

`classifyAdtError` only has an HTTP status to work with when one survives into the final error text or object: a status field on the error (`err.status`, `err.response.status`, ...), which is only present for errors raised outside the handlers (the SSO login-page detection sets `status: 401` on its own error), or one of the literal substrings `status code NNN`, `Error NNN:`, `HTTP NNN` in the message. Handlers catch the original error, keep only its formatted text and rethrow that text as an `McpError` (`runQuery` and `tableContents` as a plain `Error`); neither carries the `.status` the original had. And `formatAdtError` itself replaces the generic `Request failed with status code NNN` wording with the clean SAP message the moment it can parse a `<exc:exception>` body, which is exactly when a real SAP exception, including most data-preview syntax errors, is available. The practical effect: an error that was a genuine HTTP 400 at the SAP side can still classify as `unknown` by the time it reaches the model, because no digits matching those patterns remain in the text. See the data-preview example below for a case this happens in.

## Startup failures

A configuration error ends the process with `[abap-adt-mcp] Fatal: <message>` on stderr and exit code 1; the host shows the server as failed or missing. Messages from `src/lib/systems.ts` (full table in [docs/CONFIGURATION.md](CONFIGURATION.md#validation-at-startup)):

| Message | Cause |
|---|---|
| `No ABAP systems configured. Provide systems.json, SAP_SYSTEMS, SAP_SYSTEMS_FILE, or SAP_URL.` | Nothing found; a `SAP_SYSTEMS_FILE` pointing at a missing file is skipped silently. |
| `<path> is not valid JSON: ...`, `No ABAP systems configured: the systems map is empty` | Stray comma or single backslashes in a Windows path; a file with no entries (keys starting with `_` are ignored). |
| `System "DEV" is missing "url"`, `... url "..." is not a valid http(s) URL`, `... client must be a 3-digit number, got "80"` | Entry validation; `client` must be `"080"`. |
| `System "DEV": authType=basic requires user and password (use ${env:VAR} to keep them out of the file)`, `System "DEV" authType=oauth requires oauth.tokenUrl/clientId/clientSecret` | Credentials missing after `${env:VAR}` resolution. |
| `systems.DEV.password: environment variable DEV_PW referenced by ${env:DEV_PW} is not set` | The host did not pass the variable; names are reported, never values. |
| `<path> is readable by other users (mode 644); run: chmod 600 <path>. Refusing to start with inline passwords in a shared-readable file (or reference them as ${env:VAR}).` | [File mode check](CONFIGURATION.md#file-mode-checks), skipped on Windows; without inline secrets it is only a warning. |
| `MCP_TOOLSETS names unknown toolset(s): debuger. Valid: core, source, ...; presets: all, focused` | Typo in `MCP_TOOLSETS` or `MCP_DISABLED_TOOLSETS` (`src/toolManifest.ts`). |
| `MCP_HTTP_PORT must be between 1024 and 65535, got 80` | Privileged or invalid port (`src/lib/httpTransport.ts`). Raised when the HTTP transport starts, after the constructor, so this one prints as `Fatal error running server: ...`. |

Non-fatal warnings cover `NODE_TLS_REJECT_UNAUTHORIZED=0`, `insecureTls` destinations and reduced `Active toolsets`; a good stdio start prints `MCP ABAP ADT API server running on stdio` and the destination names. An entry with `user` and `password` but no `authType: "basic"` passes validation, defaults to `sso` and opens a browser on the first call.

## Login problems by auth type

### Browser SSO

`login` (or the first tool call) opens a Chromium window on `<url>/sap/bc/adt/core/discovery?sap-client=<client>` and polls the DevTools cookie store for a `MYSAPSSO2` or `SAP_SESSIONID*` cookie of that host. Failures from `src/lib/browserLogin.ts`: `No Chrome/Edge/Brave found for SSO login. Set SAP_BROWSER_PATH to a Chromium-based browser executable.` (auto-detection knows three macOS paths); `SAP_BROWSER_PROFILE_DIR must not point at the browser's default profile directory` (refused by design: it holds every site's cookies); `Browser was closed before the SSO login completed.`; `SSO login timed out after 300s` (the login stalled at the identity provider, landed on another host, or a second factor was never completed); a puppeteer launch error means `SAP_BROWSER_PATH` is not a Chromium binary or the profile directory is open in another browser.

An expired SSO session does not produce a 401: the identity provider answers with its HTML login page and HTTP 200. `CookieHttpClient.looksLikeLoginPage` in `src/lib/cookieHttpClient.ts` recognises a 2xx/3xx HTML body carrying `SAMLRequest`, `j_username`, `sap-idp`, `accounts.sap.com`, "Identity Authentication" or a logon form and raises `SSO session expired: the identity provider returned a login page instead of an ADT response.` with `code = SESSION_EXPIRED`, which triggers the automatic re-login below.

Login succeeds but every object is "not authorized" or "not found": the session landed on the tenant's logon client and `client` names a different one; `sap-client` is sent on every request, so the value has to match ([docs/AUTH.md](AUTH.md#mode-sso-browser-login-s4hana-public-cloud-like-eclipse-recommended)).

### OAuth

Errors from `src/lib/oauth.ts` surface inside `Login failed:` or the first tool's message: `OAuth token request failed (401): ...` (wrong `clientId`/`clientSecret`, or a locked Communication User); `OAuth token request failed (404): ...` or `OAuth token endpoint returned non-JSON response` (wrong `tokenUrl`; take it from the Communication Arrangement); `OAuth token response did not contain access_token` (not an OAuth2 token endpoint). A valid token followed by `authorization` on `/sap/bc/adt/...` means the arrangement does not expose ADT ([docs/AUTH.md](AUTH.md#mode-oauth-oauth2-s4hana-public-cloud)).

### Basic

Basic destinations authenticate on the first call; `login` is optional. A 401 is classified `sessionExpired`, the server logs in again once, and if that fails the same error surfaces: the password, a user lock or an expired password. On S/4HANA Public Cloud a named business user with `basic` gets no 401 at all, only the identity provider's HTML: use `sso` or a Communication User ([README: Authentication](../README.md#authentication)).

## Session expiry and the automatic retry

When a handler call fails as `sessionExpired` or `csrf` (and the tool is not `logout`), the dispatcher logs `session for <destination> expired during <tool> (<kind>); re-authenticating and retrying once`, marks the audit record `retried: true`, calls `reauthenticate` and runs the handler again. SSO re-runs the browser login (silent when the persistent browser profile still holds the identity-provider session), OAuth invalidates the cached bearer, basic logs in again. In every mode the source cache is cleared and the lock ledger emptied, because handles from the dead session are invalid: a write carrying an explicit `lockHandle` fails after the retry with `staleLockHandle`, and `lock` again is the fix.

**Was the retry already tried, or never attempted?** The retry wraps only the handler call itself (`dest.handlers[...].handle(name, args)`), inside the per-destination queue in `src/index.ts`. A `sessionExpired`/`csrf` classification that comes out of that call is retried once, silently, before the model ever sees it: if the retry then succeeds, the model gets a normal result; only a second failure is returned as an error. So in practice, "the retry already happened; call login" is the correct reading for almost every `sessionExpired`/`csrf` error the model actually receives, including the very first call of a session, because for `basic` and `oauth` the real login attempt happens lazily inside that same handler call. Two cases escape it: `logout`, for which the dispatcher explicitly skips the retry (`if (name === 'logout' || ...) throw error;`), and a failure raised by the SSO browser login in `ensureLogin`, which runs before the handler call and outside the retry; both reflect a single, unretried attempt. The hint text's "if this error still surfaces" is fixed wording shipped with the `sessionExpired` hint for every caller; it is not a signal that the retry might have been skipped. With `MCP_AUDIT_FILE` set, the audit record for the failing `requestId` settles it directly: `retried: true` means the automatic retry ran and failed again; a record with no `retried` field at all for a `sessionExpired`/`csrf` outcome means the retry never ran, that is one of the two cases above.

## Locks

The server keeps a ledger per destination (`src/lib/lockLedger.ts`). Write tools lock, write and unlock by themselves when no handle is given (`lockMode: "auto"`), reuse a ledger entry when `lock` was called earlier (`"reused"`), or use an explicit `lockHandle` (`"explicit"`) ([docs/WORKFLOWS.md](WORKFLOWS.md#locks-automatic-versus-explicit)). `unLock` without a handle and without a ledger entry answers `No lockHandle given and the server holds no recorded lock for this object (see listLocks)`. `forceUnlock` releases every ledger entry (or one `objectUrl`) and returns `{released, failed, sessionDropped, remaining}`; `dropSession: true` also drops the SAP session, which frees locks whose handles are already invalid. `dropSession` and `logout` release recorded locks first and report `locksReleased`; `AbapAdtServer.close()` does the same on SIGINT/SIGTERM and when an HTTP session ends.

None of them can release an enqueue held by another session. A `locked` error whose `ideUser` is your own SAP user and whose object is not in `listLocks` is an Eclipse window or another MCP session; only that session or `SM12` releases it.

The next step differs by who holds the lock, even though the server can release neither case itself. When `ideUser` names the same SAP user this destination logs in as, the object is open in a second Eclipse/ADT window of yours, or a second concurrent MCP session pointed at the same destination: that is self-serve, close the other window or stop the other session, and no one else needs to be involved. When `ideUser` names a different user, only that person, or Basis through `SM12`, can release it: report who holds it (the message names them) and stop retrying, since neither `dropSession` nor `forceUnlock` on this server instance reaches their session.

## Policy refusals

A refusal is an MCP error `-32600` with one text pattern:

```text
Policy: setObjectSource blocked on destination PRD (readOnly): setObjectSource is a write tool and the destination is readOnly. Configured in systems.json policy; retrying will not help.
```

The gate in parentheses is one of `readOnly`, `deniedTools`, `allowFreeSql`, `deniedTables`, `allowedPackages`, `allowedTransports`, evaluated in that order (`src/lib/policy.ts`); the audit record stores it as `gate` with `outcome: "denied"`. Typical reasons: `table USR02 is in deniedTables`, `package ZLEGACY is not in allowedPackages (Z*, $*)`. `allowedPackages` resolves an existing object's package through `transportInfo`; when that lookup fails the write is refused with `could not determine the object package of the object, and allowedPackages is closed`, so confirm the URL with `searchObject`. `MCP_READ_ONLY=1` adds `readOnly` everywhere. See [README: Keeping it safe](../README.md#keeping-it-safe) and [docs/CONFIGURATION.md](CONFIGURATION.md#error-shape).

`listSystems`, the `nextTools` suggestion for `policyDenied`, returns the full policy object (`readOnly`, `deniedTools`, `allowFreeSql`, `deniedTables`, `allowedPackages`, `allowedTransports`) for every destination in `systems.json` that has one (`summarizePolicy` in `src/lib/policy.ts`); it reports the configuration, it does not try the call against each destination. That is enough to check the static gates, `readOnly`, `deniedTools`, `allowFreeSql`, `deniedTables`, against another already-configured destination without calling anything else: compare the blocked tool name and table against the lists shown. `allowedPackages` and `allowedTransports` need the object's actual package or transport as well, which the same object normally carries on every system of a landscape, so a package already known from `resolveTransport` or an earlier call can be checked against each destination's glob list the same way. What `listSystems` cannot do is find a destination nobody configured: it only ever lists entries already in `systems.json`, so a policy that blocks the call on every configured destination means asking the owner to change one, or add another, in `systems.json`.

## Transports

`transportRequired` means the package records changes and no transport was passed, or the object is already locked in another modifiable request. `resolveTransport(objSourceUrl)` returns `{transport, needsTransport, reason, candidates}` with reasons such as `object is already recorded in this modifiable transport (transport lock); it must be used`, `local (non-transportable) package: no transport request needed` and `transportable package but no modifiable transport for the current user: call createTransport or rerun with createIfMissing=true`; pass the returned `transport` (`DEVK900123` form) to the write ([docs/WORKFLOWS.md](WORKFLOWS.md#step-1-which-transport)). With `allowedTransports` set, `createTransport` and `resolveTransport(createIfMissing=true)` are refused, and any `transport`/`transportNumber` outside the globs fails with `transport DEVK900123 is not in allowedTransports (...)`.

## Data preview

`runQuery` and `tableContents` go through the ADT data preview, which reads the statement in 255-character lines. `reflowSql` in `src/lib/sqlReflow.ts` wraps a `runQuery` statement with a line over 200 characters at token boundaries (`tableContents` sends its optional `sqlQuery` unchanged), keeps string literals whole and adds a `note` saying so; a single token over 255 characters is refused before SAP (`SQL token longer than 255 characters ...`). `dataPreviewHint` appends a hint to preview errors: "is not permitted" or "dataMaintenance" point at `tableContents(ddicEntityName)` or a released CDS view; "255", "256", "Boolean expression was expected" or "Substring access" explain the line limit (a remaining failure is a literal over 255 characters or a real syntax error at the named token); "not authorized" or "S_TABU" name the missing S_TABU_DIS/S_TABU_NAM authorization.

`dataPreviewHint` is a separate mechanism from the `kind`/`hint`/`nextTools` classification described above, and runs first: `handleRunQuery` and `handleTableContents` in `src/handlers/QueryHandlers.ts` call it on the formatted SAP message and append its text straight into the `error` string as a trailing `Hint: ...` sentence, before the error is ever passed to `classifyAdtError`. It does not require, and does not produce, `kind: "ambiguous400"`; nothing in the code ties the two together. A worked example, with the exact SAP wording from a field report of a 9-column `runQuery` hitting the line limit (`docs/FIELD-NOTES.md`):

```json
{"error":"Failed to run query: A Boolean expression was expected in MATERIAL Hint: The data preview reads the statement in 255-character lines. The server already wraps long statements; if this still fails, a single literal or identifier is longer than 255 characters, or the SQL has a real syntax error at the named token.",
 "code":-32603}
```

No `kind`, `httpStatus`, top-level `hint` or `nextTools`: `handleRunQuery` catches the original SAP error, keeps only its formatted text, and throws a fresh plain `Error` from it; that text carries no HTTP status number once `formatAdtError` has substituted the clean SAP message for the generic "Request failed with status code NNN" wording, so `classifyAdtError` has nothing to match and returns `unknown` (fields omitted, see "Error kinds" above). The only diagnosis available is the inline `Hint:` sentence.

This error shape also never carries the `note` field: `note` is added only to a *successful* response, after `reflowSql` has already wrapped the statement (see above); a query that fails after being reflowed and one that fails because every line was already short produce the identical JSON above, and the audit record carries no flag for it either. There is no way to tell the two apart from the response alone. To tell them apart, check the `sqlQuery` you sent for any line over 200 characters yourself, or read the exact SAP wording: `dataPreviewHint` matches "255", "256", "Boolean expression was expected" and "Substring access" as a single family, covering both a genuine leftover cut and a real syntax error at a named token, and does not distinguish between them either; only the token or field name in the raw message (`MATERIAL` above) points at which one it is.

Both tools request at most `rowNumber` rows from SAP (default 100), then page the returned rows to fit the response budget: `totalRows`, `startRow`, `returnedRows`, `hasMore`, `autoPaged: true` when the server paged on its own, `capped: true` when the range was shrunk. Zero rows on a key you know exists usually means the internal format (leading zeros): see `getDataElementProperties` and [docs/WORKFLOWS.md](WORKFLOWS.md#7-data).

## Activation and syntax errors

`activate: true` on `setObjectSource`, `editObjectSource` and `setMethodSource` never fails the write. The result carries `activation: {success, messages, inactive}` or `activation: {success: false, error}`; an agent that does not read it assumes an active object. `activatePackage` returns messages plus what stays inactive and is marked `isError` when activation failed; `getObjectSource(version="inactive")` shows what was written, `inactiveObjects` what still needs activation ([docs/WORKFLOWS.md](WORKFLOWS.md#step-4-activation)). `syntaxCheckCode` needs `url` (the object's `/source/main`) because the check resolves types in that object's context; `code` may be omitted to check the source last read or written for that URL. `runSnippet` returns activation errors with `phase: "activation"` (the snippet body starts at line 8 of the generated class); a `$TMP` refusal on S/4HANA Cloud (S_ABPLNGVS) gets the hint to pass a customer package and its transport.

`editObjectSource` rejects instead of guessing, and nothing is written: `replacements[0]: oldText was not found in the current source on SAP (0 matches)`, `oldText matches N locations (lines ...)`, `expectedText did not match the current content of lines A-B on SAP` (the actual text follows), `startLine N is beyond the end of the source`. Re-read with `getObjectSource` and copy the exact text, indentation included.

## Response size and paging

Responses that can grow (sources, rows, findings, listings, discovery documents: 22 of the 31 handler classes) are measured against `MCP_MAX_RESPONSE_CHARS` (default 40000, minimum 5000). `shrinkToFit` in `src/lib/responseSizing.ts` reduces the page (lines, rows, items) until the JSON fits; payloads report `hasMore` and the cursor to continue: `startLine`/`maxLines` for `getObjectSource`, `startRow`/`maxRows` for the data tools, `startIndex`/`maxItems` for `inactiveObjects` and other lists. `capped: true` means the requested or default range was shrunk. When a single item exceeds the budget the answer is `truncated: true` with a raw `preview` that may not parse as JSON; scope the request instead. Raise the budget only when the host's limit is known.

## Progress and heartbeat

Notifications exist only when the host sends a `progressToken`. Handlers then report steps (`runSnippet` phases, `grepPackage` and `exportPackageSources` scan counts, ATC and unit test start, the SSO login message) and `withHeartbeat` in `src/lib/progress.ts` sends `<tool> still running (Ns)` every 10 s while a SAP call is pending, with strictly increasing values as MCP requires. A host that times out despite heartbeats has a hard limit of its own; run `atcSummary` on a smaller `mainUrl`.

## HTTP transport errors

With `MCP_HTTP_PORT` set, `src/lib/httpTransport.ts` answers JSON errors:

| Status | Body | Cause |
|---|---|---|
| 401 | `Unauthorized: send Authorization: Bearer <token>` | Token missing or wrong; the generated one is in `~/.abap-adt-mcp/http-token`. |
| 403 | `Forbidden: Host header not allowed (DNS rebinding protection). Set MCP_HTTP_ALLOWED_HOSTS to permit it.` | Loopback bind reached through a non-loopback hostname (a proxy, a container name). |
| 403 | `Forbidden: Origin not allowed. Set MCP_HTTP_ALLOWED_ORIGINS to permit it.` | Browser caller from an unlisted origin; `*` allows any. |
| 404 | empty, or `Unknown or expired session; send a new initialize request without mcp-session-id.` | Path outside `/mcp` (the unauthenticated `GET /health` excepted), or a session idle longer than `MCP_HTTP_SESSION_TTL_MINUTES` (default 30) or lost in a restart. |
| 400 | `Missing mcp-session-id header`, `Missing mcp-session-id header; only initialize may open a session.`, `Invalid JSON body: ...` | Client protocol error, or an `initialize` body over 4 MB (only that body is capped). |
| 503 | `Too many sessions (16/16); retry later or raise MCP_HTTP_MAX_SESSIONS.` with `Retry-After: 30` | Session limit; idle sessions are swept every minute. |

Request order and session model: [docs/CONFIGURATION.md](CONFIGURATION.md#request-handling-in-order) and [README: HTTP transport](../README.md#http-transport-optional).

## Platform and toolset gate refusals

`Tool debuggerListen belongs to toolset "debugger", which is not enabled (active: core, source, ...). Start the server with MCP_TOOLSETS including "debugger" (or MCP_TOOLSETS=all).` The tool is not published; a host with a cached list, a prompt or a skill can still call it by name. Restart with the toolset enabled. Audited as `outcome: "error"`.

`Tool tracesList is not available on destination DEV (S/4HANA Cloud does not expose the ADT traces collection; see systemProfile). Pick another approach: dumps/dumpDetails instead of the debugger, ATC instead of traces.` The platform gate, audited as `outcome: "unavailable"`. The profile is built on the first call of a gated toolset (`TOOLSET_FEATURE` in `src/lib/systemProfile.ts`), so the outcome does not depend on calling `systemProfile` first. `MCP_PROFILE_GATE=warn` logs and lets the call through, `off` disables the check. If the profile cannot be built, stderr says `could not build the system profile (...); <tool> runs unchecked` ([docs/CONFIGURATION.md](CONFIGURATION.md#the-platform-gate)).

## Node version and puppeteer

`package.json` declares `engines.node >= 18`; CI runs 18, 20 and 22. `puppeteer-core` is ESM-only and loaded through a dynamic import at the first SSO login, so a server without SSO destinations never touches it and an unsupported Node fails at login time, not at startup. `node --version` in the environment the host uses settles it (Claude Desktop starts the server with a minimal `PATH` and does not inherit your shell environment, see [docs/HOSTS.md](HOSTS.md#claude-desktop)). The browser login needs a display: on a headless server or in a container use `basic` or `oauth` destinations.

## Where the logs are

**stderr** carries everything the server prints (`src/lib/logger.ts` routes every level there; stdout is the JSON-RPC stream). Dispatcher lines start with `[abap-adt-mcp]`: argument renames, re-authentication, locks released on close, gate warnings, the audit-file warning. **Host logs**: at the time of writing Claude Desktop writes `mcp.log` and `mcp-server-abap-adt-mcp.log` under `~/Library/Logs/Claude` (macOS) or `%APPDATA%\Claude\logs` (Windows); Claude Code shows server state and the last startup error with `/mcp`. **Audit file**: `MCP_AUDIT_FILE=<path>` appends one JSON line per call (`src/lib/audit.ts`) with `ts`, `requestId`, `tool`, `destination`, `durationMs`, `outcome` (`ok`, `error`, `denied`, `unavailable`), `errorKind`, `gate`, `message`, redacted `args` and `retried`; field semantics in [docs/CONFIGURATION.md](CONFIGURATION.md#7-audit-log-record-format), what the file may contain in [README: Audit log](../README.md#audit-log).

Reconstructing a failed sequence with `jq`:

```bash
# every failure, in order, with what the model tried
jq -c 'select(.outcome != "ok") | {requestId, tool, destination, errorKind, gate, message}' audit.jsonl
# the calls before a given failure (requestId 42)
jq -c 'select(.requestId >= 32 and .requestId <= 42) | {requestId, tool, outcome, args}' audit.jsonl
# calls per tool and outcome
jq -r '"\(.tool) \(.outcome)"' audit.jsonl | sort | uniq -c | sort -rn
```

`requestId` restarts at 1 for every server instance (one per stdio process, one per HTTP session), so pair it with `ts` when several instances share a file.

## Reporting a problem

Open an issue at https://github.com/williansaez/abap-adt-mcp/issues with: `healthcheck` and `systemProfile` output, the host and its version, `node --version`; the error JSON verbatim, the arguments that produced it and what the model did next; the matching stderr lines and audit records; and which description, schema or hint misled the agent (most 0.3.3 fixes in [CHANGELOG.md](../CHANGELOG.md) came from such reports).

Anonymise first: tenant hostnames become `myXXXXXX.s4hana.cloud.sap`, transport numbers `DEVK900123`, object names `ZCL_EXAMPLE`; remove customer names, user ids and business data from `runQuery` results and `args`. For a whole session, follow the template in [docs/FIELD-NOTES.md](FIELD-NOTES.md#how-to-produce-a-useful-report): failed or repeated calls with arguments and error text, wasted calls, truncated answers, steps done by hand, practical limits, and a closing table of tools, calls and failures.
