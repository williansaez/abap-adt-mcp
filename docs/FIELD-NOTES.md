# Field notes

What real development sessions with this server taught us, in the agent's own words where possible, anonymised (no customer names, tenants, transport numbers or business objects). Each entry says which release fixed it. Add to this file whenever a session report surfaces something the unit tests and the live test plan did not.

## Session A, 0.3.1: RAP price check (78 calls, 6 hard failures)

Task: add a validation to a draft-enabled RAP app on S/4HANA Cloud (message class changed, one global class created, two behavior pools changed) plus data diagnosis with `runQuery`.

| Finding | Fixed in |
|---|---|
| `getObjectSource` on a class include with `/source/main` appended returns 404; includes use the URL from `classIncludes` as is | 0.3.3: suffix stripped automatically, descriptions say so |
| `classIncludes` parameter is `clas`; `revisions` calls the same thing `clsInclude`; `getObjectSource` uses `objectSourceUrl`, `transportInfo` `objSourceUrl`, `lock` `objectUrl`: four names for one concept, impossible to guess | 0.3.3: the dispatcher maps case variants and known aliases onto each tool's schema (`className`, `objectSourceUrl`, `uri`, `source`, `description`, `packageName`, ...) |
| Session expired mid-flow; no automatic re-login, error text only | 0.3.2: expired sessions are re-authenticated and the call retried once; errors carry `kind` and `hint` |
| `runQuery` with 16 columns: "substring access ... size 256 out of bounds"; with 9 columns: "A Boolean expression was expected in MATERIAL". The data preview reads the statement in 255-character lines and cut the SQL mid-clause; two calls wasted on correct SQL | 0.3.3: statements are wrapped onto short lines before sending; errors get a hint naming the limit |
| `transportUnifiedDiff` returned `diffs: []` for a transport made of `LIMU CINC` (behavior pool include) and `LIMU MESS` entries; every RAP behavior change records as CINC | 0.3.3: LIMU class parts (CINC, METH, CLSD, CPUB, CPRO, CPRI), REPS and FUNC are mapped to the object and include and diffed; messages are skipped with a reason |
| `setObjectSource` rewrote 400-line includes in full three times; `editObjectSource` existed but the host had deferred it; server instructions still described lock -> set -> unLock | 0.3.2: instructions and the README describe `editObjectSource`/`setMethodSource` with auto-lock and `activate=true`; 0.3.3 adds `objectDiff` to the flow |
| Writing a message class through `setObjectSource` reset `masterLanguage` to the logon language and recorded every message in the transport | 0.3.3: documented on `setObjectSource`; no dedicated message-class tool yet |
| No tool told the internal format of a key (leading zeros), one `runQuery` returned 0 rows | `getDataElementProperties`/`getDomainProperties` exist since 0.3.2; instructions now point at them |

Positive: `runQuery` read a view with `@AccessControl.authorizationCheck: #MANDATORY` without a DCL block; `syntaxCheckCode` with `code` + `url` + `mainUrl` reported line/offset/severity correctly.

## Session B, 0.3.1: supplier invoice job diagnosis (~40 calls, ~11 wasted)

Task: understand a custom job on a test system, read its data, try to run and debug it.

| Finding | Fixed in |
|---|---|
| `transportDetails { TransportNumber }` rejected: only camelCase accepted | 0.3.3: case-insensitive parameter names |
| `getObjectSource` on an application job template URL returned the ADT metadata XML; `/source/main` was needed | 0.3.3: a bare object URL that answers metadata is retried with `/source/main` |
| `runQuery` blocked on a custom table with DDIC `dataMaintenance: #RESTRICTED` ("element ... of Table ... is not permitted"), even after switching it to `#ALLOWED`; `tableContents` read it | 0.3.3: hint on the error pointing at `tableContents`; both descriptions explain the difference |
| `syntaxCheckCode { code }` rejected: `url` is required and the description did not say why | 0.3.3: description explains the check needs an object context; `source`/`objectSourceUrl` accepted as aliases |
| `abapDocumentation { query: "WITH PRIVILEGED ACCESS" }` rejected: the tool wanted objectUri/body/line/column (hover help), and returned raw HTML | 0.3.3: `keyword` mode, `body` fetched when omitted, HTML converted to paged plain text |
| `createTransport` mixes `REQUEST_TEXT`/`DEVCLASS` (BAPI style) with `objSourceUrl` | 0.3.3: `description` and `packageName` accepted as aliases; names kept for compatibility |
| `lock` failed with a foreign ENQUEUE lock (same SAP user, Eclipse session); `dropSession` and `forceUnlock` cannot release it and nothing said whose lock it was | 0.3.3: the `locked` hint explains how to tell the server's own locks (`listLocks`) from foreign sessions and that only SM12 or the other session can release those |
| `runSnippet` on a test system: S_DEVELOP refused | 0.3.3: description says development systems only |

Tools loaded but never called in either session: the whole `debugger` toolset, `forceUnlock`, `listLocks`, `objectDiff`. The debugger plan was not executed because the job could not be started from the agent.

## How to produce a useful report

Enable `MCP_AUDIT_FILE` on the server (one JSONL record per call: tool, destination, duration, outcome, error kind, retries, redacted argument summary) and ask the agent, at the end of the session, for: every failed or repeated call with its exact arguments and error text, what it did next, whether the description or schema misled it; wasted calls; truncated answers; steps done by hand that a tool should have done; practical limits found; and a final table of tools, calls and failures. Customer names and transport numbers stay out.
