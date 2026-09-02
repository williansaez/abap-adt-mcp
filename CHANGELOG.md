# Changelog

## [0.1.0] - Initial Commit
- Initial project setup.

## [0.1.1] - Better unified response structure
- Improved and unified the response structure.

## [0.3.1] - 2026-09-01 - Live E2E hardening on S/4HANA Public Cloud
Fixes driven by a full live test round against a Public Cloud tenant (95/142 tools exercised, 87 OK; see docs/TESTPLAN.md Layer 3):
- `createObject` supports DEVC/K packages (hand-built ADT body with `pak:recordChanges`, `swcomp`/`transportLayer`/`packagetype`/`abapLanguageVersion` inputs; explicit `responsible` required by cloud backends).
- SSO sessions are pinned to the configured client: `sap-client` is sent on every request (previously the harvested cookies landed on the tenant's default client).
- `getTransportConfiguration` sanitizes the `sap-client` query echoed mid-path in configuration links.
- `renamePreview`/`renameExecute` accept the refactoring as an object or JSON string.
- `classIncludes` fetches the class structure before mapping includes.
- `bindingDetails` resolves plain binding names and degrades gracefully for OData V4 bindings.
- `unitTestEvaluation` accepts a class name by running the tests first.
- `extractMethodEvaluate` retries with a stateless session (stateful sessions reject the selection); full evaluate→preview→execute cycle verified live.
- `createAtcRun` resolves check variant names to worklist ids automatically and documents the ATC flow.
- `codeCompletionFull` documents the patternKey contract (IDENTIFIER of a codeCompletion proposal).

## [Unreleased]
- Package renamed to `abap-adt-mcp` (`mcpName` `io.github.williansaez/abap-adt-mcp`, bin `abap-adt-mcp`) so it no longer collides with the upstream `mcp-abap-abap-adt-api` on npm and the MCP Registry. Upstream author kept in `contributors` and in LICENSE.
- Server version announced to MCP hosts is now read from `package.json` (was hardcoded and had drifted to 0.3.0); `server.json` synced to 0.3.1.
- Tool errors now carry the real SAP exception detail (message, type, namespace, properties) instead of "Request failed with status code NNN"; the raw `<exc:exception>` body is re-parsed when abap-adt-api's own parsing gives up. Port of upstream PR #19, extended to the fork-only handlers. Unit tests added (`npm test`).
