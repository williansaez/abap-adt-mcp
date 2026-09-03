# Roadmap and status

Source: `docs/ANALISE-ECOSSISTEMA-SAP-MCP.md` (research across 30+ SAP MCP projects, 2026-09-02). Status as of 0.3.2.

| # | Item | Status |
|---|---|---|
| 1 | Per-destination security policy (`policy` in systems.json, `MCP_READ_ONLY`) | done |
| 2 | Toolsets (`MCP_TOOLSETS`, `MCP_DISABLED_TOOLSETS`) | done |
| 3 | npm publish, CI, catalog contract test, Docker hygiene | done (publish on tag) |
| 4 | Lock ledger, auto-lock writes, `listLocks`/`forceUnlock`, per-destination serialization | done |
| 5 | Text-anchored `replacements`; `getMethodSource`/`setMethodSource` | done |
| 6 | Library methods exposed, `getObjectSource version`, `debuggerStep` enum | done |
| 7 | `sourceTextSearch`, `grepPackage` | done |
| 8 | Error kinds/hints, session re-authentication, 429/503 retry | done |
| 9 | `systemProfile`, `apiReleaseState` | done |
| 10 | Skills, plugin manifest, `docs/ROUTING.md`, server key `abap-adt-mcp` | done (SAP-name aliases and portal registration open) |
| 11 | Compact `dumps`, `dumpDetails` | done |
| 12 | `runSnippet` | done |
| 13 | `resolveTransport` | done |
| 14 | `objectDiff` | done |
| 15 | HTTP transport hardening (per-session servers, caps, TTL, Origin/Host checks, `/health`) | done |
| 16 | `${env:VAR}` secrets, config validation, file mode check | done |
| 17 | `activatePackage` | done |
| 18 | `packageTree`, `whereUsed`, `cdsViewInfo` | done |
| 19 | JSONL audit trail (`MCP_AUDIT_FILE`) | done |
| 20 | X.509 client certificate / CA file per destination | done |
| 21 | MCP prompts for canonical flows | done |
| 22 | `title`, parameter `examples`, `outputSchema` | done (title, examples); `outputSchema` deliberately not published: paged/variant responses would fail SDK validation |
| 23 | Progress notifications for long runs | done (steps + 10 s heartbeat) |
| 24 | ATC summary by priority, historic ATC results | done (`atcSummary`); historic result listing not built: endpoint undocumented |
| 25 | Source export in abapGit layout, `debugSession` composition | done (`exportPackageSources`); `debugSession` not built: on-prem only, no system to validate |

The earlier plan based on SAP's official documentation (`docs/IMPROVEMENTS.md`) is complete since 0.3.1 and kept for history.

## Review round (2026-09-03)

Three independent reviews (technical, conceptual, release readiness) of everything above produced 40 findings; all were fixed in the same round except the ones listed here as conscious exclusions: `outputSchema` (see item 22), historic ATC results (item 24), `debugSession` (item 25), and `gitPullRepo`/`rapGenGenerate`/service binding publish under `allowedPackages` (refused rather than guessed, documented in docs/AUTH.md). The CHANGELOG entry for 0.3.2 lists the fixes.
