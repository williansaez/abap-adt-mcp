# Routing table: SAP official ADT MCP Server names → abap-adt-mcp tools

Public skills written for SAP's ADT MCP Server (ADT for VS Code / Eclipse) call tools by SAP's names under the server key `abap-adt`. This server publishes under the key `abap-adt-mcp` with its own names; use this table when adapting such skills or agent instructions. Names on the left follow the SAP documentation and the `claude-abap-skills` routing; parameters differ, so read `docs/TOOLS.md` for ours.

Names as the SAP Help page "Model Context Protocol Tools" lists them (September 2026); a running server may spell one or two slightly differently. SAP's server creates, activates, tests, checks and transports; it does not read or search source, write source, lock, or show dumps: those come only from this server.

| SAP official tool | abap-adt-mcp tool(s) |
|---|---|
| `abap_lists_destinations` | `listSystems`, `systemProfile` |
| `abap_creation-get_all_creatable_objects`, `abap_creation-get_object_type_details` | `objectTypes`, `creatableTypeDetails` |
| `abap_creation-run_validation`, `abap_creation-create_object` | `validateNewObject`, `createObject` |
| `abap_activate_objects` | `activateByName`, `activateObjects`, `activatePackage` |
| `abap_run_unit_tests` | `unitTestRun`, `unitTestEvaluation` |
| `abap_transport-create`, `abap_transport-get` | `createTransport`, `resolveTransport`, `transportInfo`, `transportDetails`, `userTransports` |
| `abap_transport-unifiedDifference` | `transportUnifiedDiff` |
| `abap_generators-list_generators`, `abap_generators-get_schema`, `abap_generators-generate_objects` | `rapGenIsAvailable`, `rapGenGetSchema`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate` |
| `abap_business_services-fetch_services`, `abap_business_services-fetch_service_information` | `fetchServiceDetails`, `bindingDetails` |
| `abap_atc_run`, `abap_atc_get_result` | `createAtcRun`, `atcWorklists`, `atcSummary` |
| `abap_atc_execute_deterministic_quickfixes` | `atcQuickfixProposals`, `atcApplyQuickfix` |
| `abap_atc_apply_ai_fix`, `abap_atc_get_ai_fix_result` (Joule licence) | No equivalent: the model reads the finding (`atcDocumentation`) and edits the source itself (`editObjectSource`) |
| Not in SAP's server: read and search source, write source, locks, dumps, data, where-used, debugger, abapGit, Clean Core check | `getObjectSource`, `searchObject`, `sourceTextSearch`, `grepPackage`, `setObjectSource`, `editObjectSource`, `lock`, `dumps`, `runQuery`, `whereUsed`, the debugger and abapGit toolsets, `apiReleaseState` |

The names in the left column are the ones the SAP Help page "Model Context Protocol Tools" documents for the ADT MCP Server (ABAP Development Tools for VS Code and for Eclipse), read on 2026-09-29. A running server has been seen to report `abap_list_destinations` and `abap_atc_run` where the page says `abap_lists_destinations` and `abap_run_atc`, so a skill that routes by name should accept both spellings. Earlier versions of this table also carried the tool names of a third-party server and a few names that exist in neither; they are gone.
