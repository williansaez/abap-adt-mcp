# Improvement Plan — Based on SAP Official Documentation

Source: SAP Help Portal, "ABAP Development Tools for Visual Studio Code" (deliverable 40559577, 18 pages, generated 2026-08-30). The document describes SAP's own official **ADT MCP Server** (shipped inside ADT for VS Code): its tool catalog (~20 tools in toolsets), the canonical agentic workflow, agent-configuration guidance (`agents.md`), and security considerations. This plan compares that against this project and lists concrete improvements, prioritized by value vs. effort.

## P0 — Bug fix

### 1. `validateNewObject` is unusable (breaks SAP's canonical validate-before-create step)
`src/handlers/ObjectRegistrationHandlers.ts:20-29, 86-107` declares the input as `options: string`, but `abap-adt-api`'s `validateNewObject()` expects a `ValidateOptions` object (`objtype`, `objname`, `packagename`, `description`). No `JSON.parse` is performed, so any call fails and agents skip validation entirely.
**Fix:** replace the schema with real fields mirroring `ValidateOptions` and build the object in the handler. Effort: small.

## P1 — High value

### 2. Expose the RAP generator framework (SAP's headline capability, already in the library)
SAP: `abap_generators-list_generators` / `get_schema` / `generate_objects` — "generating complete RAP applications" (tables, CDS views, behavior definitions, service definitions/bindings).
The `abap-adt-api` library already ships the full API, unused by this server: `rapGenIsAvailable`, `rapGenGetSchema`, `rapGenValidateInitial`, `rapGenGetContent`, `rapGenGetUiConfig`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate`, `rapGenPublishService` (`node_modules/abap-adt-api/build/AdtClient.d.ts:339-347`).
**Fix:** new `RapGeneratorHandlers.ts` with ~9 tools. Pure wrapper work, no new REST plumbing. Effort: medium (mechanical).

### 3. MCP tool annotations (`readOnlyHint` / `destructiveHint`)
SAP's design leans on per-tool approval in the host. This server's ~128 tools carry no annotations (`src/types/tools.ts:1-13` has no `annotations` field), so hosts cannot distinguish `searchObject` from `deleteObject`.
**Fix:** extend `ToolDefinition` with `title` + `annotations`, annotate all handlers (~60% are read-only), pass through in `withDestination` (`src/index.ts:267-283`). Destructive set includes: `deleteObject`, `transportRelease`, `transportDelete`, `setObjectSource`, `gitUnlinkRepo`, `pushRepo`, `runClass`, `runQuery`, `debuggerSetVariableValue`, `tracesDelete`, `unPublishServiceBinding`, `dropSession`. Effort: medium.

### 4. Encode SAP's canonical workflow in tool descriptions + server instructions
SAP's documented agentic loop: list destinations → discover creatable types → get required fields → validate → create transport → create object → edit source → activate → run unit tests.
Today, on-path tool descriptions are bare one-liners with zero sequencing (`createObject`, `validateNewObject`, `loadTypes` vs `objectTypes` indistinguishable, `createTransport`, `setObjectSource`, `activateByName`, `unitTestRun`).
**Fix:**
- Rewrite the 9 on-path descriptions with cross-references (e.g. `createObject`: "call `loadTypes` for valid objtype values (e.g. CLAS/OC), `validateNewObject` first, `createTransport` for non-$TMP packages; afterwards `lock` + `setObjectSource`, then `activateByName`").
- Add the MCP server-level `instructions` string to the `Server` constructor (`src/index.ts:132-136`) with the create-loop and edit-loop.
Effort: small (text only).

### 5. Ship an `agents.md` template (SAP page-12 guidance)
SAP recommends providing agent context files with rules: cloud-compliant ABAP syntax, `$TMP`/local package conventions, class-prefix conventions, "always run unit tests after changing source", "add unit tests to the testclass include".
**Fix:** add `docs/agents.template.md` encoding this server's loop (`listSystems` → `validateNewObject` → `transportInfo`/`createTransport` → `lock` → `setObjectSource` → `syntaxCheckCode` → `activateByName` → `unitTestRun` → `unLock`), with `destination` handling. Also fix the stale README "Custom Instruction" block: it references a nonexistent `activate` tool (README.md:195,210 — real names `activateObjects`/`activateByName`), omits creation flow and `destination`. Effort: small.

### 6. Security hardening (from SAP's Security Considerations + audit findings)

- **SSO browser profile in world-readable tmp dir:** `src/lib/browserLogin.ts:57-58` persists long-lived IAS session cookies under `os.tmpdir()` with default permissions. Move to `~/.abap-adt-mcp/sso/<host>` with mode `0700`; correct the "in memory only" claim in docs/AUTH.md:61-63. Effort: small.
- **`reentranceTicket` returns live credential material into model context:** `src/handlers/ObjectHandlers.ts:218-234` serializes the ticket into the tool result (lands in host logs/transcripts, readable by injected prompts). Gate behind env opt-in or remove. Effort: small.
- **No security documentation:** add a `## Security` README section covering prompt-injection risk, per-tool approval / enterprise allowlist (GitHub Copilot MCP allowlist policy), least-privilege SAP users, DEV-system recommendation, and that `runQuery`/`tableContents` read business data. Effort: small.
- **Error redaction:** defensive pass in `handleError` (`src/index.ts:245-262`) so upstream errors can never echo `Authorization`/`Cookie` headers. Effort: small.
- **TLS bypass hygiene:** README recommends process-wide `NODE_TLS_REJECT_UNAUTHORIZED=0`; scope the advice to per-system `insecureTls` and log a startup warning when active (`src/lib/cookieHttpClient.ts:51`). Effort: small.
- **Customer data in public docs:** docs/AUTH.md:18,70-71 embeds a real customer tenant hostname — replace with placeholders. Effort: trivial.

## P2 — Functional parity gaps

### 7. Expose `transportDetails` + transport unified diff
SAP: `abap_transport-get` (covered by `transportInfo`/`userTransports`) and `abap_transport-unifiedDifference` (missing).
Library has `transportDetails(transportNumber)` (`AdtClient.d.ts:188`, unexposed) returning the transport's object list. A `transportUnifiedDiff` tool is composable today: `transportDetails` → `revisions` per object → fetch two versions → unified diff via npm `diff`. No new REST work. Effort: medium.

### 8. Name-based business-service inspection
SAP: `abap_business_services-fetch_services` / `fetch_service_information`. `bindingDetails` (`src/handlers/ServiceBindingHandlers.ts:46`) functionally covers both but requires a raw parsed `ServiceBinding` object as input. Add a name-resolving wrapper (resolve binding by name internally, return `BindingServiceResult` + `servicePreviewUrl`). Effort: small.

### 9. ATC deterministic quickfix orchestration
SAP: `abap_atc_execute_deterministic_quickfixes`. This repo has the ATC pipeline and a generic `fixProposals`/`fixEdits` engine, but nothing connects ATC findings (which carry `quickfixInfo`) to fix execution. Composite tool (finding → fixProposals → fixEdits → setObjectSource) is doable with existing calls; full fidelity needs a new REST wrapper in the library. Effort: medium (composite) / large (faithful).

### 10. Creatable-type details tool
SAP: `abap_creation-get_object_type_details` (per-type required fields) and version-aware `get_all_creatable_objects`. Add a thin composite exposing creatable types + required-field metadata; note the library's `CreatableTypeIds` union (~20 types) caps `createObject` coverage. Effort: small (composite) / large (beyond union).

## P3 — Platform / docs

### 11. Optional Streamable HTTP transport with bearer token
SAP's server: localhost HTTP `/mcp`, port default 2236, auto-generated bearer token — the format GitHub Copilot / Amazon Q configs expect. This server is stdio-only (`src/index.ts:369-372`), and README currently suggests an **unauthenticated** FLUJO proxy for HTTP (worse). Add `StreamableHTTPServerTransport` behind `MCP_HTTP_PORT`, bind 127.0.0.1, auto-generate token (0600 file), reject unauthenticated requests; retire the FLUJO advice. Effort: medium-large.

### 12. README rewrite + config hygiene
README still largely inherited from upstream (mario-andreschak branding, FLUJO, basic-auth only); no multi-destination quick start, no tool catalog, no workflow example. `server.json` is stale (missing `SAP_SYSTEMS*` vars, wrong version/repo URL). Prefer `SAP_SYSTEMS_FILE` (0600) over inline `SAP_SYSTEMS` in docs; support env-var indirection for secrets in systems.json. Also: `checkRateLimit` in `BaseHandler.ts:45-58` is dead code; git tools accept passwords as tool args (`GitHandlers.ts`) — backfill from per-destination config instead. Fix typo `adtCompatibiliyGraph` (`src/index.ts:103`). Effort: medium.

## Not applicable (from the doc)

- SAP Joule predictive code completion, `APPLDESTCC`/`AIC_ADT_PROXY_CERTIFICATE` mTLS proxy config, `S_AIQADTLO` authorizations: Joule editor/licensing features, not ADT REST/MCP capabilities. The AI-based ATC quickfix tools (`abap_atc_apply_ai_fix`) require a Joule license and are not replicable.

## Suggested execution order

| Phase | Items | Effort | Status |
|---|---|---|---|
| 1 | #1 bug fix, #4 descriptions+instructions, #5 agents.md, #6 security smalls | small | done |
| 2 | #3 annotations, #2 RAP generators, #7 transportDetails+diff | medium | done |
| 3 | #8, #9, #10 parity composites | small-medium | done |
| 4 | #11 HTTP transport, #12 README rewrite | medium-large | done |

All four phases are implemented on this branch (v0.3.0, 142 tools). Remaining
open items beyond the original plan: expose per-object-type creation beyond the
library's CreatableTypeIds union (library change), and a faithful server-side
ATC quickfix REST wrapper (library change).
