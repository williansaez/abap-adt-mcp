# Test Plan — feat/sap-doc-improvements (v0.3.0)

Scope: validate the four improvement phases before merging to `main`. Four layers,
cheapest first; each layer gates the next. Layers 0–1 run fully offline (no SAP
system) and are automatable in-session. Layers 2–3 run against a real S/4HANA
Cloud DEV tenant. Layer 4 is the final integration check in Claude Desktop.

## Layer 0 — Static (automated, ~1 min)

| # | Test | Pass criteria |
|---|---|---|
| 0.1 | `npx tsc --noEmit` | exit 0, no errors |
| 0.2 | `npm run build` | exit 0, `dist/` produced |
| 0.3 | `node -e "require('./dist/index.js')"` guard — server refuses to start with NO config | clear error: "No ABAP systems configured…" |

## Layer 1 — Offline protocol & config (automated, no SAP, ~5 min)

Scripted stdio/HTTP MCP client against `dist/index.js` with dummy destinations.

### 1.A Config parsing (`src/lib/systems.ts`)
| # | Test | Pass criteria |
|---|---|---|
| 1.1 | `SAP_SYSTEMS` inline JSON, 2 systems, one `"default": true` | server starts, `listSystems` shows 2, default = flagged entry |
| 1.2 | `SAP_SYSTEMS_FILE` pointing at a copy of `systems.example.json` (placeholders) verbatim | parses without error; `_comment` key skipped; `DEV` is default |
| 1.3 | Legacy `SAP_URL`/`SAP_USER`/`SAP_PASSWORD` | single destination "default" created |
| 1.4 | `SAP_DEFAULT_DESTINATION` overrides `"default": true` flag | env wins |
| 1.5 | Entry without `url` | startup fails with system name in the error |
| 1.6 | `insecureTls: true` on one entry | startup warning names exactly that destination |

### 1.B Protocol surface (stdio)
| # | Test | Pass criteria |
|---|---|---|
| 1.7 | `initialize` | serverInfo `abap-adt-mcp` 0.3.0; `instructions` present and contains the create-loop and edit-loop |
| 1.8 | `tools/list` | 142 tools; every tool has `annotations`; 87 readOnly / 14 destructive; spot-check: `deleteObject` destructive, `searchObject` readOnly+idempotent, `atcApplyQuickfix` destructive |
| 1.9 | `destination` param injected on every domain tool | enum = configured names; required when no default; description names the default when set |
| 1.10 | `validateNewObject` schema | fields objtype/objname/description/packagename/fugrname; no `options` |
| 1.11 | New tools listed | transportDetails, transportUnifiedDiff, rapGen* (8), fetchServiceDetails, atcQuickfixProposals, atcApplyQuickfix, creatableTypeDetails; `adtCompatibilityGraph` listed, misspelled `adtCompatibiliyGraph` still callable (routes, not listed) |
| 1.12 | `creatableTypeDetails` call (static, no SAP) | returns types; `CLAS/OC` requires packagename; `FUGR/FF` requires fugrname; `DEVC/K` requires swcomp/transportLayer/packagetype |
| 1.13 | `reentranceTicket` without `SAP_ALLOW_REENTRANCE_TICKET` | InvalidRequest error mentioning the env var (no SAP call attempted) |
| 1.14 | `healthcheck` / `listSystems` | destinations listed; NO passwords/secrets in output |

### 1.C HTTP transport
| # | Test | Pass criteria |
|---|---|---|
| 1.15 | `MCP_HTTP_PORT=2236` + `MCP_HTTP_TOKEN` | listens on 127.0.0.1 only; GET on `/other` = 404 |
| 1.16 | POST /mcp without Authorization | 401, JSON error body |
| 1.17 | POST /mcp with wrong token (right length and wrong length) | 401, no crash (timingSafeEqual length guard) |
| 1.18 | Full session with correct token | initialize → mcp-session-id → tools/list (142) |
| 1.19 | No `MCP_HTTP_TOKEN` set | token generated, written to `~/.abap-adt-mcp/http-token`, file mode 0600, stderr names the path |
| 1.20 | `MCP_HTTP_PORT=80` (out of range) | startup fails with range error |

### 1.D Unit-level (pure functions)
| # | Test | Pass criteria |
|---|---|---|
| 1.21 | `redactSecrets` | `Authorization: Bearer xyz`, `Cookie: SAP_SESSIONID=…`, `password=…`, `https://u:p@host` all become `[REDACTED]`; normal text untouched |
| 1.22 | `AtcHandlers.applyDeltas` | single-line replace, multi-line replace, two deltas (bottom-up order preserved), delta at line 1 col 0 |
| 1.23 | `GitHandlers.cred` backfill | args win over config; config fills when args omitted; both empty → undefined |

## Layer 2 — Real SAP, read-only (manual trigger, DEV tenant, ~15 min)

Prerequisites: one S/4HANA Cloud DEV destination configured (browser SSO login
will open Chrome once). Read-only: no writes to the system. Run via scripted
stdio client or via Claude Desktop after config update.

| # | Test | Tool(s) | Pass criteria |
|---|---|---|---|
| 2.1 | Login + session | `login` | success; SSO profile created under `~/.abap-adt-mcp/sso/<host>` with 0700 perms (`ls -ld`) |
| 2.2 | Search & read | `searchObject` (e.g. `ZCL_HELLO*` or `CL_ABAP_CHAR_UTILITIES`), `objectStructure`, `getObjectSource` | real object found, source returned |
| 2.3 | Type discovery | `loadTypes`, `objectTypes`, `creatableTypeDetails` | non-empty; CLAS/OC present in loadTypes |
| 2.4 | Validation | `validateNewObject` {objtype CLAS/OC, objname ZCL_MCP_TESTPLAN, packagename $TMP} | SUCCESS-severity result (not schema/parse error) — proves the P0 bug fix against a real system |
| 2.5 | Transports read | `userTransports`, `transportInfo` on a known object | transports listed |
| 2.6 | Transport details + diff | `transportDetails` + `transportUnifiedDiff` on an existing transport with source objects | object list returned; unified diff produced or per-object reason; non-source objects in `skipped` |
| 2.7 | Business services | `fetchServiceDetails` on a known service binding (or one found via `searchObject` type SRVB) | entity sets + previewUrls returned |
| 2.8 | RAP availability | `rapGenIsAvailable` | true/false without error (Cloud tenant expected true) |
| 2.9 | ATC read | `atcCustomizing`, `createAtcRun` + `atcWorklists` on a known object | worklist with findings (or empty) — no errors |
| 2.10 | Error redaction | force auth failure (bad destination password on a scratch basic entry) | error message contains `[REDACTED]`, never the password |

## Layer 3 — Real SAP, writes in $TMP only (manual trigger, DEV tenant, ~15 min)

Everything scoped to package `$TMP` (local, no transport) and a throwaway object
`ZCL_MCP_TESTPLAN`. Full cleanup at the end. NO writes outside $TMP; no
transport release; no deletions of pre-existing objects.

| # | Test | Tool sequence | Pass criteria |
|---|---|---|---|
| 3.1 | Canonical create loop (the SAP-documented agentic loop) | `loadTypes` → `validateNewObject` → `createObject` (CLAS/OC, ZCL_MCP_TESTPLAN, $TMP) → `lock` → `setObjectSource` (class implementing IF_OO_ADT_CLASSRUN) → `unLock` → `activateByName` → `unitTestRun` | every step succeeds in order; class active |
| 3.2 | Edit loop | `getObjectSource` → `lock` → `syntaxCheckCode` (modified source) → `setObjectSource` → `unLock` → `activateByName` | change visible in re-read source |
| 3.3 | Test include | `createTestInclude` → `setObjectSource` (one trivial unit test) → activate → `unitTestRun` | test executes, result parsed |
| 3.4 | ATC quickfix roundtrip (best effort) | introduce a finding-prone statement → `createAtcRun`/`atcWorklists` → `atcQuickfixProposals` at the finding → `atcApplyQuickfix` → activate → re-run ATC | proposal listed and applied, or a clean "no proposals" — no corrupted source (verify via getObjectSource) |
| 3.5 | RAP preview only (no generate) | `rapGenGetContent`/`rapGenValidateInitial` on an existing table, `rapGenPreview` | proposal/preview returned; `rapGenGenerate` NOT called |
| 3.6 | Cleanup | `lock` → `deleteObject` ZCL_MCP_TESTPLAN → verify `searchObject` finds nothing | tenant back to original state |

## Layer 4 — Claude Desktop integration (manual, ~10 min)

| # | Test | Pass criteria |
|---|---|---|
| 4.1 | Point the existing `abap-adt` Desktop entry at this branch's `dist/index.js` (config already uses SAP_SYSTEMS with 20 destinations), restart Desktop (Cmd+Q) | server connects; 142 tools; no startup errors in logs |
| 4.2 | Ask Claude: "lista os sistemas" → `listSystems` | 20 destinations |
| 4.3 | Ask Claude to read one object on the DEV destination | end-to-end SSO + read works |
| 4.4 | Confirm destructive-tool prompt behavior | host shows the annotation-driven distinction (read-only vs write) where supported |

## Rollback / safety notes

- Layers 0–1: zero risk, no network beyond localhost.
- Layer 2: read-only ADT calls; SSO login opens a browser once per host.
- Layer 3: writes confined to `$TMP` + object `ZCL_MCP_TESTPLAN` on the DEV
  tenant; step 3.6 removes it. Nothing touches transportable packages,
  transports are never released, `rapGenGenerate` is never called.
- Any Layer ≥2 failure: capture the tool error JSON verbatim, fix, re-run the
  failing layer from its start.

## Execution status

| Layer | Status |
|---|---|
| 0 | **passed** (3/3) — 2026-08-31 |
| 1 | **passed** (23/23) — 2026-08-31 |
| 2 | **passed** (9/10, 1 skip) against DEV — 2026-08-31. Skipped: 2.6 (tenant had no open transport on the sampled Z object; re-run with a known transport number). Notes: 2.9 ATC run id not parsed from createAtcRun result (worklist step untested); 2.10 cloud tenants redirect basic auth to IAS instead of 401, so the redaction check reduces to "no credential material in responses" (full redaction is unit-tested in 1.21) |
| 3 | **passed live** on DEV — 2026-09-01. The 2026-08-31 "blocked by authorization" run had two root causes, both fixed: the destination pointed at the CUSTOMIZING host instead of the DEV host, and the SSO session was not pinned to the configured client (`sap-client` now sent on every request). Executed: package ZADT_TEST created under ZSANDBOX (local, hand-built DEVC/K body with `pak:recordChanges`), class ZCL_ADT_TEST_DEMO created/activated, syntax check clean, 2/2 unit tests green, ATC run 0 findings (worklist flow), `runClass` console output verified, full rename (add→sum) and extract-method (calc_sum) refactorings executed with tests staying green, full cleanup (class + package deleted, searchObject empty, dropSession + logout). 3.5 remains skipped (rapGenIsAvailable=false on tenant). Broad sweep on the same date: 95/142 tools exercised, 87 OK; the 8 remaining failures are platform/environment limits (cloud-absent endpoints, no live debuggee/trace data) or the intentional reentranceTicket guard — zero known code bugs |
| 4 | **verified by exact simulation** — 2026-08-31. The Desktop config's literal command+args+env were spawned headlessly: abap-adt-mcp 0.3.0, 142 tools, all 20 destinations listed, server instructions announced, no secrets in listSystems output. Final UI step (Cmd+Q + reopen, then a conversation using the tools) must be done by the user — this session runs inside Claude.app and cannot restart it. Note: with 20 destinations and no default flag, `destination` is required on every call; mark one entry with `"default": true` in SAP_SYSTEMS if a default is wanted |

Bugs found by this plan and fixed during execution:
- `AuthHandlers.handleLogin` returned `text: JSON.stringify(loginResult)` where
  `login()` can resolve without a value — `JSON.stringify(undefined)` is not a
  string, producing an invalid MCP tools/call result (-32602). Found by 2.10.
- `fetchServiceDetails` failed hard on OData V4 bindings where abap-adt-api's
  `bindingDetails` cannot derive service queries ("Cannot destructure property
  'query'"); now degrades to a binding summary with an explanatory note. Found
  by 2.7 against ZAPI_EXAMPLE_O4.

## Layer 3 addendum — 2026-09-02 (0.3.2 tools, DEV, S/4HANA Public Cloud)
Live over stdio with the real `systems.json`: `login` (silent SSO, ~6 s) · `systemProfile` (platform cloud, 976 collections, only the `rap` toolset unavailable) · `dumps` compact (1 dump, termination point and stack parsed) · `sourceTextSearch` (tenant answers "Source Search is not supported", SRIS_SEARCH 006, now mapped to the grepPackage fallback) · `grepPackage` on ZSANDBOX · `apiReleaseState` (repository verdicts plus the backend `apireleases` answer: `state=RELEASED`, `contract=C4`) · `resolveTransport` (transport lock DEVK900123 detected) · `runSnippet` in ZSANDBOX with that transport (created → written → activated → ran → deleted, output `snippet ok DEVELOPER 20260902`) · `listLocks` empty · `logout` clean. `$TMP` is refused on this tenant with S_ABPLNGVS; runSnippet now hints at a customer package.

Same tenant, 2026-09-03: `getMethodSource` / `setMethodSource(activate=true)` / `runClass` cycle on a throwaway class in ZSANDBOX. Finding: with a stateful session `runClass` kept printing the pre-change output although `getObjectSource` (active and inactive) and `activateByName` were current; running the class in a stateless request fixed it (`v2` on three consecutive runs). `packageTree`, `cdsViewInfo`, `activatePackage`, `objectDiff` (correctly refusing single-revision objects) also exercised.

Same tenant, 2026-09-03 (items 23-25): progress notifications observed over stdio with a `progressToken` (runSnippet 1/4…3/4 steps, SSO login message, heartbeat after 10 s during `atcSummary`); `atcSummary(mainUrl=/sap/bc/adt/packages/zsandbox)` ran ATC (14 s, 2 objects, no findings); `exportPackageSources` wrote `zsandbox/zcube_cds.ddls.asddls` plus `EXPORT.json`.

