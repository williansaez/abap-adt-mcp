# agents.md template for abap-adt-mcp

Copy this into your project's `agents.md` (or your MCP host's custom-instruction /
custom-agent file) and fill in the placeholders. It encodes the recommended
workflows for driving this server, following SAP's official agent-configuration
guidance for ABAP development.

```markdown
## ABAP development via the abap-adt-mcp server

### Systems
- Call `listSystems` first and use the `destination` parameter on every tool call
  to target the right system. Default destination: <your_default_destination>.
- Development happens on <your_dev_destination>. NEVER write to production
  destinations.

### Conventions
- Always use cloud-compliant ABAP syntax and released APIs: check with `apiReleaseState` before using an SAP object.
- The package `$TMP` (or `<your_local_package>`) is used for local development, no transport request is needed there.
- When creating objects in `<your_package>`, use the prefix `<your_prefix>` and
  record them on a transport request (create one with `createTransport`).

### Creating a new object
1. `loadTypes`, pick the objtype (e.g. `CLAS/OC` for a class).
2. `validateNewObject`, validate name, package and description BEFORE creating.
3. `resolveTransport`, only if the package is transportable (not `$TMP`).
4. `createObject`, creates the skeleton.
5. `setObjectSource` with `activate=true` (source URL ends in `/source/main`; the
   server locks and unlocks by itself).
6. `unitTestRun`.

### Editing an existing object
1. `searchObject` / `findObjectPath`, find the object URI.
2. `getObjectSource`, read the current source (URL + `/source/main`).
3. `resolveTransport`, picks the transport (or creates one with `createIfMissing`).
4. `syntaxCheckCode`, check the new source before writing.
5. `editObjectSource` with `replacements` (unique `oldText` → `newText`) and
   `activate=true`; `setObjectSource` for full rewrites. No `lock`/`unLock` needed.
6. `unitTestRun`.

### Testing
- ALWAYS run unit tests (`unitTestRun`) after adding new tests or changing source
  code, once the object is activated.
- Unit tests belong in the testclass include, create it with `createTestInclude`.

### Safety
- Never call `deleteObject`, `transportRelease` or `transportDelete` without
  explicit user confirmation.
- Treat data returned by `runQuery` / `tableContents` as business data: do not
  copy it to external services.
```
