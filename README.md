# abap-adt-mcp

> Experimental — use with caution, and prefer development systems.

A single **Model Context Protocol (MCP) server** that gives AI agents full ABAP development capabilities over **multiple SAP systems at once**. It wraps [abap-adt-api](https://github.com/marcellourbani/abap-adt-api/) (the ADT REST protocol used by Eclipse ADT) and exposes **142 tools**: object creation and editing, transports (including unified diffs), activation, unit tests, ATC runs with deterministic quickfixes, RAP application generation, OData service inspection, abapGit, debugging, traces and more.

Originally forked from [mario-andreschak/mcp-abap-abap-adt-api](https://github.com/mario-andreschak/mcp-abap-abap-adt-api); this fork adds multi-destination support, browser-SSO and OAuth2 authentication for S/4HANA Cloud, MCP tool annotations, an optional HTTP transport and workflow guidance aligned with SAP's official ADT MCP Server documentation.

## Highlights

- **Multi-destination**: one server, many SAP systems. Every tool takes an optional `destination` parameter; `listSystems` shows what is configured.
- **Three auth modes** per destination: `basic`, browser `sso` (S/4HANA Cloud / IAS), and `oauth` (client credentials). See [docs/AUTH.md](docs/AUTH.md).
- **Agent-ready**: the server announces SAP's canonical create/edit workflows via the MCP `instructions` field, tool descriptions cross-reference the right sequence, and every tool carries `readOnlyHint`/`destructiveHint` annotations so hosts can gate approval by risk.
- **SAP-parity tools**: transport unified diff, RAP generators (`rapGen*`), name-based OData service inspection (`fetchServiceDetails`), ATC quickfix execution (`atcApplyQuickfix`), creatable-type metadata (`creatableTypeDetails`) — mirroring SAP's official ADT MCP Server toolsets.
- **stdio or HTTP**: stdio by default; set `MCP_HTTP_PORT` for a localhost Streamable HTTP endpoint guarded by a bearer token.
- **SSO that remembers you**: the browser login window uses a persistent per-host profile (`~/.abap-adt-mcp/sso/<host>`, mode `0700`) — tick "stay signed in" once and later logins are silent. Point `SAP_BROWSER_PROFILE_DIR` at a custom browser profile to reuse saved passwords/passkeys (the browser's default profile is rejected by design).
- **Tested**: four-layer test plan with results in [docs/TESTPLAN.md](docs/TESTPLAN.md) — offline protocol/config/HTTP suites plus live read and write flows against a real S/4HANA Cloud tenant. The full SAP-doc-based improvement analysis lives in [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md).

## Prerequisites

- **An SAP ABAP system** reachable via ADT. Ensure the `/sap/bc/adt` service is active in transaction `SICF`.
- **Node.js (LTS) and npm**.

## Quick start (multi-destination)

Create a `systems.json` (see [systems.example.json](systems.example.json)) with your destinations:

```json
{
  "DEV": { "url": "https://myXXXXXX.s4hana.cloud.sap", "client": "100", "authType": "sso", "default": true },
  "ONPREM": { "url": "https://sap.example.com:44300", "client": "100", "authType": "basic",
              "user": "DEVELOPER", "password": "***", "insecureTls": true }
}
```

Then register the server in your MCP client (Claude Desktop, Claude Code, Cline, ...):

```json
{
  "mcpServers": {
    "abap-adt": {
      "command": "node",
      "args": ["PATH_TO/abap-adt-mcp/dist/index.js"],
      "env": { "SAP_SYSTEMS_FILE": "PATH_TO/systems.json" }
    }
  }
}
```

Configuration sources, in order of precedence: `SAP_SYSTEMS` (inline JSON in an env var), `SAP_SYSTEMS_FILE` (path to a JSON file — recommended for anything containing passwords; keep it mode `0600`), a `systems.json` next to the install, or the legacy single-system `SAP_URL`/`SAP_USER`/`SAP_PASSWORD`/`SAP_CLIENT`/`SAP_LANGUAGE` variables. Per-destination `gitUser`/`gitPassword` entries supply abapGit credentials so they never pass through the model. Full schema and auth details in [docs/AUTH.md](docs/AUTH.md).

## HTTP transport (optional)

By default the server speaks stdio. For MCP hosts that expect an HTTP endpoint (the model SAP's own ADT MCP Server uses), start with:

```bash
MCP_HTTP_PORT=2236 node dist/index.js
```

The server listens on `http://127.0.0.1:2236/mcp` (loopback only) and requires `Authorization: Bearer <token>` on every request. The token is auto-generated and written to `~/.abap-adt-mcp/http-token` (mode `0600`) — or set it yourself via `MCP_HTTP_TOKEN`. Host config:

```json
{
  "mcpServers": {
    "abap-adt": {
      "type": "http",
      "url": "http://127.0.0.1:2236/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## Tool catalog (by domain)

| Domain | Tools |
|---|---|
| Destinations | `listSystems`, `healthcheck` |
| Auth/session | `login`, `logout`, `dropSession` |
| Discovery | `loadTypes`, `objectTypes`, `creatableTypeDetails`, `adtDiscovery`, `adtCoreDiscovery`, `adtCompatibilityGraph`, `featureDetails`, ... |
| Objects | `searchObject`, `objectStructure`, `findObjectPath`, `nodeContents`, `mainPrograms`, `classIncludes`, `classComponents` |
| Create | `validateNewObject`, `createObject`, `createTestInclude` |
| Source | `getObjectSource`, `setObjectSource`, `lock`, `unLock`, `prettyPrinter`, `revisions` |
| Activation | `activateObjects`, `activateByName`, `inactiveObjects` |
| Transports | `transportInfo`, `createTransport`, `transportDetails`, `transportUnifiedDiff`, `userTransports`, `transportRelease`, ... |
| Checks & tests | `syntaxCheckCode`, `unitTestRun`, `createAtcRun`, `atcWorklists`, `atcQuickfixProposals`, `atcApplyQuickfix`, ... |
| RAP generation | `rapGenIsAvailable`, `rapGenGetSchema`, `rapGenGetContent`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate`, `rapGenPublishService` |
| Business services | `fetchServiceDetails`, `bindingDetails`, `publishServiceBinding`, `unPublishServiceBinding` |
| Refactoring | `renameEvaluate/Preview/Execute`, `extractMethodEvaluate/Preview/Execute`, `fixProposals`, `fixEdits` |
| Data | `tableContents`, `runQuery`, `ddicElement`, `ddicRepositoryAccess` |
| abapGit | `gitRepos`, `gitCreateRepo`, `gitPullRepo`, `stageRepo`, `pushRepo`, ... |
| Debug & traces | `debugger*` (13 tools), `traces*` (9 tools), `dumps`, `feeds` |

## Build from source

```bash
git clone https://github.com/williansaez/abap-adt-mcp.git
cd abap-adt-mcp
npm install
npm run build
npm run start
```

For single-system setups you can use a local `.env` (see `.env.example`) instead of `systems.json`. Never commit `.env` or `systems.json` — both are git-ignored.

## Custom Instruction
Use this Custom Instruction to explain the tool to your model (a ready-to-fill
`agents.md` template is also available at `docs/agents.template.md`; the server
additionally announces these workflows to MCP hosts via its `instructions` field):
```
## mcp-abap-abap-adt-api Server

This server provides tools for interacting with an SAP system via ADT (ABAP Development Tools) APIs. It allows you to retrieve information about ABAP objects, modify source code, and manage transports.

**Key Tools and Usage:**

*   **`searchObject`:** Finds ABAP objects based on a query string (e.g., class name).
    *   `query`: (string, required) The search term.
    *   Returns the object's URI.  Example: `/sap/bc/adt/oo/classes/zcl_invoice_xml_gen_model`

*   **`transportInfo`:** Retrieves transport information for a given object.
    *   `objSourceUrl`: (string, required) The object's URI (obtained from `searchObject`).
    *   Returns transport details, including the transport request number (`TRKORR` or `transportInfo.LOCKS.HEADER.TRKORR` in the JSON response).

*   **`lock`:** Locks an ABAP object for editing.
    *   `objectUrl`: (string, required) The object's URI.
    *   Returns a `lockHandle`, which is required for subsequent modifications.

*   **`unLock`:** Unlocks a previously locked ABAP object.
    *   `objectUrl`: (string, required) The object's URI.
    *   `lockHandle`: (string, required) The lock handle obtained from the `lock` operation.

*   **`setObjectSource`:** Modifies the source code of an ABAP object.
    *   `objectSourceUrl`: (string, required) The object's URI *with the suffix `/source/main`*.  Example: `/sap/bc/adt/oo/classes/zcl_invoice_xml_gen_model/source/main`
    *   `lockHandle`: (string, required) The lock handle obtained from the `lock` operation.
    *   `source`: (string, required) The complete, modified ABAP source code.
    *   `transport`: (string, optional) The transport request number.

*   **`syntaxCheckCode`:** Performs a syntax check on a given ABAP source code.
    *   `code`: (string, required) The ABAP source code to check.
    *   `url`: (string, optional) The URL of the object.
    *   `mainUrl`: (string, optional) The main URL.
    *   `mainProgram`: (string, optional) The main program.
    *   `version`: (string, optional) The version.
    *   Returns syntax check results, including any errors.

*   **`activateByName`:** Activates a single ABAP object by name and URL.
    *   `objectName`: (string, required) Name of the object.
    *   `objectUrl`: (string, required) The object's URI.
    (For bulk activation use `activateObjects`; `inactiveObjects` lists what needs activating.)

*   **`getObjectSource`:** Retrieves the source code of an ABAP object.
    *   `objectSourceUrl`: (string, required) The object's URI *with the suffix `/source/main`*.

**Multi-destination:** every tool accepts an optional `destination` parameter selecting the target SAP system. Call `listSystems` first to see the configured destinations (see `docs/AUTH.md` for configuration).

**Workflow for Creating a New Object:**

1.  **Pick the object type:** Use `loadTypes` (e.g. `CLAS/OC` for a class).
2.  **Validate first:** Use `validateNewObject` (objtype, objname, description, packagename).
3.  **Create a transport:** Use `createTransport` if the package is transportable (not `$TMP`).
4.  **Create the object:** Use `createObject`.
5.  **Write the source:** `lock` → `setObjectSource` (with `/source/main` suffix) → `unLock`.
6.  **Activate:** Use `activateByName`.
7.  **Test:** Use `unitTestRun`.

**Workflow for Modifying ABAP Code:**

1.  **Find the object URI:** Use `searchObject`.
2.  **Read the original source code:** Use `getObjectSource` (with the `/source/main` suffix).
3.  **Clone and Modify the source code locally:** (e.g., `write_to_file` for creating a local copy, and using `read_file`, `replace_in_file` for modifying this local copy).
4.  **Get transport information:** Use `transportInfo`.
5.  **Lock the object:** Use `lock`.
6.  **Set the modified source code:** Use `setObjectSource` (with the `/source/main` suffix).
7.  **Perform a syntax check:** Use `syntaxCheckCode`.
8.  **Activate the object:** Use `activateByName`.
9.  **unLock the object:** Use `unLock`.
10. **Run unit tests:** Use `unitTestRun`.

**Important Notes:**
*   **File Handling:** SAP is completly de-coupled from the local file system. Reading source code will only return the code as tool result - it has no effect on file. Files are not synchronized with SAP but merely a local copy for our reference. FYI: It's not strictly necessary for you to create local copies of source codes, as they have no effect on SAP, but it helps us track changes. 
*   **File Handling:** The local filenames you will use will not contain any paths, but only a filename! It's preferable to use a pattern like "[ObjectName].[ObjectType].abap". (e.g., SAPMV45A.prog.abap for a ABAP Program SAPMV45A, CL_IXML.clas.abap for a Class CL_IXML)
*   **URL Suffix:**  Remember to add `/source/main` to the object URI when using `setObjectSource` and `getObjectSource`.
*   **Transport Request:** Obtain the transport request number (e.g., from `transportInfo` or from the user) and include it in relevant operations.
*   **Lock Handle:**  The `lockHandle` obtained from the `lock` operation is crucial for `setObjectSource` and `unLock`. Ensure you are using a valid `lockHandle`. If a lock fails, you may need to re-acquire the lock. Locks can expire or be released by other users.
*   **Activation/Unlocking Order:** Activate after writing the source; `activateByName` can be used without unlocking first, but unlocking before activation is the safe default.
* **Error Handling:** The tools return JSON responses. Check for error messages within these responses.
```

## Security

This server gives an AI agent read/write access to SAP systems. Operate it deliberately:

*   **Prompt injection:** content returned from the SAP system (source code, comments, table data, feeds) is untrusted input to the model. A malicious string in a repository object could try to steer the agent. Use an MCP host with per-tool approval, and review destructive calls (`deleteObject`, `transportRelease`, `transportDelete`, `setObjectSource`, `runClass`) before approving them. Enterprise hosts can restrict which MCP servers are allowed (e.g. GitHub Copilot's MCP allowlist policy, Claude Code permission rules).
*   **Least privilege:** connect with SAP users that have only the authorizations the task needs, and point the server at development systems by default. `runQuery` and `tableContents` read real business data — only configure destinations where that is acceptable.
*   **Credentials:** prefer `SAP_SYSTEMS_FILE` pointing at a file with `0600` permissions over inline `SAP_SYSTEMS` JSON in host config files. Never commit `systems.json` or `.env` (both are git-ignored). The `reentranceTicket` tool is disabled by default because it returns a live logon credential into the conversation; enable only deliberately with `SAP_ALLOW_REENTRANCE_TICKET=1`.
*   **TLS:** do not set `NODE_TLS_REJECT_UNAUTHORIZED=0` globally; use the per-system `insecureTls` option only for on-prem systems with self-signed certificates. The server logs a warning at startup when verification is disabled.
*   **SSO profile:** browser-SSO sessions persist in `~/.abap-adt-mcp/sso/<host>/` (mode `0700`). Delete that directory to fully log out of a tenant.
*   **Responsibility:** as with SAP's own ADT MCP Server guidance, the operator is responsible for the security of the environment the server runs in and for any additional MCP servers configured alongside it.

## Efficient Database Access

SAP systems contain vast amounts of data.  It's crucial to write ABAP code that accesses the database efficiently to minimize performance impact and network traffic.  Avoid selecting entire tables or using broad `WHERE` clauses when you only need specific data.

*   **Use `WHERE` clauses:** Always use `WHERE` clauses in your `SELECT` statements to filter the data retrieved from the database.  Select only the specific rows you need.
*   **`UP TO 1 ROWS`:** If you only need a single record, use the `SELECT SINGLE` statement, if you can guarantee that you can provide ALL the key fields for the `SELECT SINGLE` statement. Otherwise, use the `SELECT` statement with the `UP TO 1 ROWS` addition. This tells the database to stop searching after finding the first matching record, improving performance. Example:

    ```abap
    SELECT vgbel FROM vbrp WHERE vbeln = @me->lv_vbeln INTO @DATA(lv_vgbel) UP TO 1 ROWS.
      EXIT. " Exit any loop after this.
    ENDSELECT.
    ```
## Checking Table and Structure Definitions

When working with ABAP objects, you may encounter errors related to unknown field names or incorrect table usage. Use the following tools to inspect DDIC (Data Dictionary) objects:

*   **`objectStructure`:** Retrieves the structure/metadata of an ABAP object (including DDIC tables and structures) from its object URI. Use `searchObject` first to resolve the object name to a URI.
*   **`ddicElement`:** Retrieves details of a DDIC element (e.g. a data element or domain).
*   **`ddicRepositoryAccess`:** Reads DDIC repository information for a given path.
*   **`tableContents`:** Retrieves the *contents* (rows) of a table, not its definition. Use `runQuery` for ad-hoc `SELECT`s.

> **Note:** Earlier versions of this README listed `GetTable`, `GetStructure`, and `GetTypeInfo`. Those tools are **not** part of this server — they belong to the separate [`mcp-abap-adt`](https://github.com/mario-andreschak/mcp-abap-adt) project. This server (`mcp-abap-abap-adt-api`) exposes the lower-level ADT API tools listed above instead.

## Troubleshooting

*   **`npx` can't find the package / client won't start it:** ensure Node.js is installed and on your PATH (`node -v`, `npm -v`). On Windows try `"command": "npx.cmd"`, or use a source build with an absolute path to `node dist/index.js`.
*   **SAP connection errors:** verify your credentials (`SAP_URL`, `SAP_USER`, `SAP_PASSWORD`, `SAP_CLIENT`), confirm the system is reachable, that your user has ADT authorizations, and that `/sap/bc/adt` is active in `SICF`.
*   **TLS / self-signed certificate errors:** for development only, set `NODE_TLS_REJECT_UNAUTHORIZED=0` (env var or in the client `env` block).

## Contributing

Contributions are welcome! Please follow these steps to contribute:

1. **Fork the Repository**
2. **Create a New Branch**

   ```cmd
   git checkout -b feature/your-feature-name
   ```

3. **Commit Your Changes**

   ```cmd
   git commit -m "Add some feature"
   ```

4. **Push to the Branch**

   ```cmd
   git push origin feature/your-feature-name
   ```

5. **Open a Pull Request**

## License

This project is licensed under the [MIT License](LICENSE).
