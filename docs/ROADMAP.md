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
| 23 | Progress notifications for long runs | open |
| 24 | ATC summary by priority, historic ATC results | open |
| 25 | Source export in abapGit layout, `debugSession` composition | open |

The earlier plan based on SAP's official documentation (`docs/IMPROVEMENTS.md`) is complete since 0.3.1 and kept for history.
