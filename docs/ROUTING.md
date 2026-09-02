# Routing table: SAP official ADT MCP Server names → abap-adt-mcp tools

Public skills written for SAP's ADT MCP Server (ADT for VS Code / Eclipse) call tools by SAP's names under the server key `abap-adt`. This server publishes under the key `abap-adt-mcp` with its own names; use this table when adapting such skills or agent instructions. Names on the left follow the SAP documentation and the `claude-abap-skills` routing; parameters differ, so read `docs/TOOLS.md` for ours.

| SAP official tool / capability | abap-adt-mcp tool(s) |
|---|---|
| `abap_lists_destinations` | `listSystems` (plus `systemProfile` for platform and capabilities) |
| `SAPRead` / `abap_get_source` | `getObjectSource` (`version=inactive` for unactivated code) |
| `SAPSearch` / `abap_search_objects` | `searchObject`; by content: `sourceTextSearch`, `grepPackage` |
| `SAPDiagnose action=syntax` / `abap_check_syntax` | `syntaxCheckCode`, `syntaxCheckCdsUrl` |
| `abap_write_source` / `SAPWrite` | `setObjectSource` (`activate=true`), targeted: `editObjectSource` (`replacements`) |
| `abap_activate_objects` / `ActivatePackage` | `activateByName`, `activateObjects` (+ `inactiveObjects`) |
| `abap_run_unit_tests` | `unitTestRun`, `unitTestEvaluation` |
| `abap_atc_run` / `abap_atc_findings` | `createAtcRun`, `atcWorklists`, `atcQuickfixProposals`, `atcApplyQuickfix`, `atcDocumentation` |
| `abap_transport-create` / `abap_transport-list` | `createTransport`, `resolveTransport`, `transportInfo`, `userTransports` |
| `abap_transport-unifiedDifference` | `transportUnifiedDiff`, `transportDetails` |
| `abap_generators-*` (RAP generator) | `rapGenIsAvailable`, `rapGenGetSchema`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate`, `rapGenPublishService` |
| `abap_service_binding-*` | `fetchServiceDetails`, `bindingDetails`, `publishServiceBinding` |
| `abap_create_object` / `abap_validate_object` | `validateNewObject`, `createObject`, `creatableTypeDetails` |
| `abap_lock` / `abap_unlock` | not needed for single writes (auto-lock); `lock`, `unLock`, `listLocks`, `forceUnlock` |
| `abap_dumps` / runtime errors | `dumps`, `dumpDetails` |
| `abap_run_class` | `runClass`; throwaway code: `runSnippet` |
| released-API / Clean Core check | `apiReleaseState` |
| `abap_abapgit-*` | `gitRepos`, `gitPullRepo`, `stageRepo`, `pushRepo`, `checkRepo`, ... |
| `abap_debugger-*` | `debuggerListen`, `debuggerAttach`, `debuggerStep`, `debuggerVariables`, ... (on-prem; refused on cloud by `systemProfile`) |
