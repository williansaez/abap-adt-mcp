# abap-adt-mcp

**Let Claude read, write, test and check ABAP code on your SAP systems.**

[![npm version](https://img.shields.io/npm/v/abap-adt-mcp)](https://www.npmjs.com/package/abap-adt-mcp)
[![CI](https://github.com/williansaez/abap-adt-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/williansaez/abap-adt-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

abap-adt-mcp is a [Model Context Protocol](https://modelcontextprotocol.io) server. Run it next to Claude Desktop, Claude Code or any other MCP host, point it at one or more SAP systems, and the model gets the same ADT REST endpoints Eclipse uses: search objects, read and edit source, create transports, activate, run ABAP Unit and ATC, read short dumps, query tables. One server exposes **173 tools** over as many SAP systems as you configure, S/4HANA Cloud and on-prem alike.

> Use it deliberately, and prefer development systems. A destination without a `policy` block is fully writable within your SAP authorizations. Per-destination guard rails (read-only, allowed packages, denied tables) are enforced by the server itself, whatever the host approves, so a careless prompt cannot reach the wrong system.

## Table of contents

- [Setup](#setup)
- [What to ask the model](#what-to-ask-the-model)
- [Workflows in detail](#workflows-in-detail)
- [Built-in prompts](#built-in-prompts)
- [Other ways to install](#other-ways-to-install)
- [Authentication](#authentication)
- [Keeping it safe](#keeping-it-safe)
- [Audit log](#audit-log)
- [S/4HANA Cloud versus on-prem](#s4hana-cloud-versus-on-prem)
- [Configuration reference](#configuration-reference)
- [HTTP transport (optional)](#http-transport-optional)
- [Tool catalog (all 173 tools, by toolset)](#tool-catalog-all-173-tools-by-toolset)
- [Compared with SAP's official ADT MCP Server](#compared-with-saps-official-adt-mcp-server)
- [Skills and plugin](#skills-and-plugin)
- [Troubleshooting](#troubleshooting)
- [Testing and contributing](#testing-and-contributing)
- [License](#license)

## Setup

Three things before you start:

- **Node.js 18 or newer** (22 recommended). Download the LTS installer from [nodejs.org](https://nodejs.org); it bundles `npm` and `npx`, which is all the host needs. No terminal is required to check: if Node is missing, the host's log says `spawn npx ENOENT` when it tries to start the server (see [step 2](#2-register-the-server-in-your-host)).
- **Access to the SAP system.** On S/4HANA Cloud (public edition) there is nothing to configure on the SAP side for named users: your user needs the business role that allows Eclipse ADT on the tenant (`SAP_BR_DEVELOPER` in the standard delivery); if Eclipse ADT works for you, this server works too. On-prem, the `/sap/bc/adt` service must be active in transaction `SICF` (a Basis task) and your user needs the usual ADT development authorizations. Only unattended `oauth` clients need a Communication Arrangement, see [Authentication](#authentication).
- **A Chromium browser** (Chrome, Edge or Brave) on the machine when you use browser SSO.

### 1. Describe your SAP systems

Create a folder `.abap-adt-mcp` in your home directory and a file `systems.json` inside it, one entry per system (a "destination"). Without a terminal: on macOS open Finder, press Shift-Cmd-G, enter `~`, create the folder (Finder asks you to confirm a name starting with a dot; Shift-Cmd-. shows hidden folders), then save the file there from any text editor. On Windows the folder is `C:\Users\<you>\.abap-adt-mcp`, created in File Explorer like any other. One S/4HANA Cloud tenant with browser SSO needs exactly this:

```json
{
  "DEV": {
    "url": "https://myXXXXXX.s4hana.cloud.sap",
    "client": "080",
    "authType": "sso",
    "default": true
  }
}
```

`url` is mandatory; `client` is the client your SSO session lands on (on the tested tenants the development system logged on to `080` and the customizing and test systems to `100`; the About entry in the launchpad's user menu shows it); `authType` defaults to `sso` and `"default": true` lets you omit the destination name in every call. The key (`DEV`) is your choice and is the name you will use in chats. Several systems, with guard rails, look like this (or copy [systems.example.json](systems.example.json)):

```json
{
  "DEV": {
    "url": "https://myXXXXXX.s4hana.cloud.sap",
    "client": "080",
    "authType": "sso",
    "default": true,
    "policy": { "allowedPackages": ["Z*"] }
  },
  "PRD": {
    "url": "https://myYYYYYY.s4hana.cloud.sap",
    "client": "100",
    "authType": "sso",
    "policy": { "readOnly": true, "deniedTables": ["PA*", "HR*", "USR02"], "allowFreeSql": false }
  },
  "ONPREM": {
    "url": "https://sap.example.com:44300",
    "client": "100",
    "authType": "basic",
    "user": "DEVELOPER",
    "password": "${env:ONPREM_PASSWORD}",
    "policy": { "allowedPackages": ["Z*", "$*"] },
    "tls": { "ca": "/etc/ssl/corp-ca.pem" }
  }
}
```

The pattern for any productive or test system is the `PRD` entry: add `"policy": { "readOnly": true }` and the server refuses every write there, whatever the model is asked. `sso` opens a real browser once for S/4HANA Cloud named users; `basic` is for on-prem users and Communication Users; `oauth` is for unattended clients. `${env:VAR}` pulls a secret from the environment so it never sits in the file, `policy` is enforced by the server, and `tls.ca` adds a corporate CA with verification kept on. `$*` (local packages) is listed only on the on-prem entry because the tested Public Cloud tenant refuses `$TMP`.

If you have a terminal, restrict the file to your user:

```bash
chmod 600 ~/.abap-adt-mcp/systems.json
```

You can skip this step when the file holds no inline passwords (an SSO-only file, or secrets referenced as `${env:VAR}`): the server then only prints a warning if the file is readable by others. It refuses to start only when a shared-readable file contains inline passwords, client secrets or git passwords. Windows has no file modes; the check is skipped there.

### 2. Register the server in your host

The package is on npm as [`abap-adt-mcp`](https://www.npmjs.com/package/abap-adt-mcp) (published through trusted publishing with provenance), so `npx` is all you need.

**Claude Code**, one line:

```bash
claude mcp add abap-adt-mcp -e SAP_SYSTEMS_FILE=$HOME/.abap-adt-mcp/systems.json -- npx -y abap-adt-mcp
```

**Claude Desktop** (Settings > Developer > Edit Config, then quit and reopen the app). Replace `me` with your own user name; on Windows write the path as `C:/Users/<you>/.abap-adt-mcp/systems.json`:

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "npx",
      "args": ["-y", "abap-adt-mcp"],
      "env": { "SAP_SYSTEMS_FILE": "/Users/me/.abap-adt-mcp/systems.json", "MCP_TOOLSETS": "focused" }
    }
  }
}
```

`MCP_TOOLSETS=focused` publishes the 114 development tools instead of all 173, which keeps the tool schemas from eating the chat's context window; drop it when you need the debugger, traces, abapGit, RAP or refactoring toolsets. The same JSON works in Cursor, Cline and other hosts that read an `mcpServers` map; VS Code names the map `servers` instead, so rename the top-level key there ([docs/HOSTS.md](docs/HOSTS.md) has the per-host form). The key `abap-adt-mcp` is the name the host shows for the server and the prefix of every tool (`mcp__abap-adt-mcp__searchObject` in Claude Code); public ABAP skills written for this server look for that name, so a different key only stops those skills from recognising the server, nothing else breaks.

After the restart, Claude Desktop lists `abap-adt-mcp` with a status under Settings > Developer, and the tools menu below the chat input (the sliders icon) shows the server with its tools. If nothing appears, read the host's log: at the time of writing Claude Desktop writes `mcp.log` and `mcp-server-abap-adt-mcp.log` to `~/Library/Logs/Claude` on macOS and `%APPDATA%\Claude\logs` on Windows, and Claude Code shows the state with `/mcp`. Everything the server prints (startup warnings, the audit-file warning, `MCP_PROFILE_GATE=warn` messages) goes to stderr and lands in that log. Both Claude Desktop and Claude Code ask before running a tool you have not approved permanently; that dialog is host behaviour and independent of the `destructiveHint` annotation, so treat it as a courtesy and the `policy` block as the guarantee.

### 3. Say hello

Open a new chat and type (replace `DEV` with the key you chose in `systems.json`):

> List my SAP systems, log in to DEV and show me the source of class CL_ABAP_CHAR_UTILITIES.

The model calls `listSystems`, `login` (a browser window appears for SSO destinations; tick "stay signed in" and later logins are silent), `searchObject` and `getObjectSource`. When the source comes back, you are done. `login` is optional in every mode: the dispatcher performs the browser login before the first call on an SSO destination, and `basic` and `oauth` destinations authenticate on their first request. Call it explicitly only to force a fresh login or to prove the credentials before anything else. Asking for `healthcheck` returns the server version, the destination names, the default destination, the active toolsets and the tool count; `systemProfile` tells whether a destination is S/4HANA Cloud or on-prem and which toolsets it cannot serve.

## What to ask the model

The server is a toolbox the model picks from: ask in plain language and it chooses the sequence. Things that work well from the first session:

| Ask | Tools the model reaches for |
|---|---|
| "Explain what method GET_DATA of ZCL_ORDER_SERVICE does." | `searchObject`, `getMethodSource` |
| "Where is table ZTABLE still used, and by which programs?" | `whereUsed`, `sourceTextSearch`, `grepPackage` |
| "Show me the fields and associations of CDS view ZI_PRODUCT." | `cdsViewInfo`, `objectStructureElements` |
| "Add a null check at the top of GET_DATA, activate and run the unit tests." | `resolveTransport`, `syntaxCheckCode`, `editObjectSource` (with `activate=true`), `unitTestRun`, `objectDiff` |
| "Create class ZCL_HELLO in package ZDEMO that prints Hello World, with a unit test." | `validateNewObject`, `resolveTransport`, `createObject`, `setObjectSource`, `createTestInclude`, `unitTestRun` |
| "Run ATC on package ZFIN and apply every quickfix that is safe." | `createAtcRun`, `atcWorklists`, `atcQuickfixProposals`, `atcApplyQuickfix`, `atcSummary` |
| "What changed in transport `DEVK900123`? Review it and tell me if it is safe to release." | `transportDetails`, `transportUnifiedDiff` |
| "Why did the last short dump of user DEVELOPER happen? Propose a fix." | `dumps`, `dumpDetails`, `getObjectSource` |
| "Is ZCL_ORDER_SERVICE ready for ABAP Cloud? Which SAP objects block it?" | `apiReleaseState`, `createAtcRun` |
| "Select the ten newest rows of ZTABLE where STATUS = 'X'." | `runQuery` (or `tableContents` when the data preview refuses a table) |
| "Try this snippet and show me the output." | `runSnippet` |
| "Which toolsets does DEV support? Is the debugger available there?" | `systemProfile` |

On a plain on-prem system the create example also works with `$TMP` and no transport; the tested S/4HANA Cloud tenant refused `$TMP`, so there you name a customer package and its transport (see [S/4HANA Cloud versus on-prem](#s4hana-cloud-versus-on-prem)).

Habits the server bakes in, so you do not have to spell them out: write tools lock and unlock by themselves; `activate=true` activates in the same call; every error is JSON with `kind`, `hint` and `nextTools`, so the model recovers instead of retrying blindly; expired sessions are re-authenticated and the call retried once; large results are paged inside a 40,000-character budget (`MCP_MAX_RESPONSE_CHARS`) and report `hasMore`; long calls send MCP progress notifications to hosts that pass a `progressToken` (plus a heartbeat every 10 seconds). The canonical create and edit flows travel in the MCP `instructions` field, and every tool carries `readOnlyHint`/`destructiveHint` annotations so hosts that gate approval by annotation can ask only on writes.

## Workflows in detail

The full tool-by-tool sequences, argument shapes and recipes are in [docs/WORKFLOWS.md](docs/WORKFLOWS.md); this section is the short version.

Every tool except `listSystems` and `healthcheck` takes an optional `destination`; it is required when several systems are configured and none is marked `default` (or named in `SAP_DEFAULT_DESTINATION`).

**URLs and names.** `searchObject` returns the object URL, for example `/sap/bc/adt/oo/classes/zcl_example`; the source URL is that plus `/source/main`; class includes (implementations, test classes) use the URLs from `classIncludes` as they are. The tools inherited from several upstream generations name that URL differently (`objSourceUrl`, `objectSourceUrl`, `objectUrl`, `classUrl`, `url`, `mainUrl`), so the dispatcher maps the names onto each tool's schema and strips or appends `/source/main` where needed: the value from `searchObject` can be passed to any of them. Class-level tools (`getMethodSource`, `setMethodSource`, `whereUsed`, `cdsViewInfo`) also accept the plain name.

**Find and read code.** `searchObject` finds objects by name. By content, `sourceTextSearch` uses the ADT text index and `grepPackage` greps package sources client-side with context lines (the fallback when a tenant has no text index). `packageTree`, `whereUsed`, `cdsViewInfo`, `typeHierarchy` and `classComponents` give IDE-style navigation. `getObjectSource` reads a source (paged with `startLine`/`maxLines`, `version=inactive` for unactivated code), `getMethodSource` one method, and `exportPackageSources` writes a package tree to disk in abapGit layout for local tools.

**Edit safely.** Writes lock, write and unlock by themselves and activate when you pass `activate=true`:

1. `resolveTransport(objSourceUrl)` returns the transport that already records the object, the newest modifiable one for its package, or `needsTransport: false` for local packages; `createIfMissing=true` creates one when none exists.
2. `syntaxCheckCode` on the intended source: optional for a one-line change, cheap insurance for anything larger.
3. `editObjectSource(objectSourceUrl, replacements=[{oldText, newText}], activate=true, transport)` for targeted changes (the server re-reads SAP first; each `oldText` must match exactly once, otherwise the call fails with "0 matches" or the line numbers of every match and nothing is written), `setMethodSource(classUrl, methodName, source, activate=true, transport)` to swap one `METHOD ... ENDMETHOD` block in the implementation (pass the full block or only the body; the definition part stays as it is; `include` and `className` select local or test classes; an unknown method is refused with the list of methods present), `setObjectSource` for full rewrites.
4. Read the `activation` field of the result; fix and write again, or `activateByName` / `activatePackage` later.
5. `unitTestRun(url)`, then `objectDiff(objectUrl)` to show what changed against the previous revision.

`lock`/`unLock` only hold a lock across several writes; `listLocks` and `forceUnlock` recover from a failed write. A lock held by another session (an open Eclipse window, for example) is reported as foreign: `dropSession` and `forceUnlock` cannot release it, only that session or `SM12` can.

**Create objects and transports.** `loadTypes` (pick the `objtype`, for example `CLAS/OC`), `validateNewObject`, then `resolveTransport(objSourceUrl="/sap/bc/adt/packages/<pkg>", devClass="<pkg>")` for the package itself, since the object has no URL yet (or `createTransport`), then `createObject(objtype, name, parentName=<pkg>, description, parentPath="/sap/bc/adt/packages/<pkg>", responsible, transport)`, `setObjectSource` with `activate=true`, `createTestInclude`, `unitTestRun`. `creatableTypeDetails` tells which fields each type requires; packages (`DEVC/K`) need `swcomp`, and cloud backends need `responsible`.

**Unit tests and ATC.** `unitTestRun` after every change (paged with `startIndex`/`maxItems`); `unitTestEvaluation` drills into results. ATC: `createAtcRun(mainUrl, variant)` on an object, package or transport (a variant name such as `ABAP_CLOUD_DEVELOPMENT_DEFAULT` is resolved to a worklist for you), then `atcWorklists` or `atcSummary` (totals by priority, check and object), `atcQuickfixProposals` and `atcApplyQuickfix` for deterministic fixes, `atcDocumentation` for unfamiliar checks; exemptions go through `atcExemptProposal` and `atcRequestExemption`.

**Review a transport.** `transportDetails` lists objects, owner, tasks and status; `transportUnifiedDiff` compares every source object recorded on the transport against the version predating it, including `LIMU` class includes and methods, `REPS` includes and `FUNC` modules (messages and DDIC are skipped with a reason). The comparison is against the current source, so on an already released transport later changes to the same objects show up too. It runs on S/4HANA Cloud tenants (the `LIMU` coverage came out of a RAP session there, see [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md)). `objectDiff` covers objects with several revisions. `userTransports`, `transportRelease`, `transportSetOwner` and `transportAddUser` complete the picture.

**Data.** `runQuery(sqlQuery)` runs an ABAP SQL `SELECT` through the ADT data preview over tables and CDS views (by entity name, released API views included), for example `SELECT carrid, connid, fldate FROM sflight WHERE carrid = 'LH' ORDER BY fldate DESCENDING`. `rowNumber` caps how many rows SAP returns (default 100) and `startRow`/`maxRows` page the result. Statements are wrapped to the preview's 255-character line limit before sending (a single literal longer than that still fails). Tables whose DDIC `dataMaintenance` is restricted are refused by the preview: `tableContents(ddicEntityName)` reads them (S_TABU_DIS/S_TABU_NAM still apply). Keys come back in internal format, so `getDataElementProperties` and `getDomainProperties` tell you about leading zeros and conversion exits.

**Dumps and debugger.** `dumps(from, to, user, contains)` returns compact summaries (runtime error, exception, program, termination point with source URL and line, top of the stack) and `dumpDetails(dumpId)` the full analysis; `getObjectSource` around `terminatedAt.line` and `whereUsed` find the cause. The `debugger` and `traces` toolsets exist only where the backend exposes them (`systemProfile` tells) and only when the toolset is published (`focused` leaves both out). Without a debugger the paths are: a dump (`dumps`), reproducing the bug with `runSnippet` or `runClass` on a development system and reading the output, and `traces` where the backend serves them. When the debugger is available, `debuggerListen` needs `debuggingMode`, `terminalId`, `ideId` and `user`, as in Eclipse.

**ABAP Cloud readiness.** `apiReleaseState` takes one of four inputs: `names` (comma-separated, optionally typed such as `TABL:MARA`), `objectUrl`, `source` (pasted ABAP text) or `sourceUrl` (a `.../source/main` URL the server reads and scans). It checks the SAP objects against SAP's official cloudification repository (released, deprecated with successors, classicAPI, noAPI; editions `cloud`, `btp`, `pce2023`, `pce2022`) plus the backend's `/sap/bc/adt/apireleases` answer, so the model never recalls release states from memory.

**Run code.** `runSnippet(code, packageName)` wraps throwaway ABAP in a temporary `IF_OO_ADT_CLASSRUN` class, creates, activates and runs it, returns the console output and deletes the class again, also when activation or the run fails (a failed deletion is reported as `cleanupError`; `keep=true` keeps it). On-prem `packageName` defaults to `$TMP`; on S/4HANA Cloud pass a customer package, its `transport` and `responsible`, and the create and delete are recorded on that transport. `runClass` runs an existing class. Both need S_DEVELOP, so development systems only.

**abapGit, RAP generator, refactoring, services.** abapGit: `gitRepos`, `gitCreateRepo`, `gitPullRepo`, `stageRepo`, `pushRepo`, `checkRepo`, `switchRepoBranch`, with per-destination `gitUser`/`gitPassword` keeping remote credentials out of the conversation. RAP generator: `rapGenIsAvailable`, `rapGenGetContent`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate` (transport required), then `activateObjects` on the generated objects and `rapGenPublishService`. Refactoring: `renameEvaluate`, `renamePreview`, `renameExecute`; the same triple for `extractMethod*`; `changePackagePreview` and `changePackageExecute`. Business services: `fetchServiceDetails(name)`, `bindingDetails`, `publishServiceBinding`, `unPublishServiceBinding`.

## Built-in prompts

Six ready-made workflows travel as MCP prompts. Each names the exact tools to call, in order, and says where it must stop and ask:

| Prompt | Arguments | What it does | Where it stops |
|---|---|---|---|
| `create-object` | optional `destination`, then `objectType` (ADT type id such as `CLAS/OC`, `INTF/OI`, `PROG/P`, `DDLS/DF`), `name`, `package`, optional `purpose` | Validate, create, write, activate, unit-test and ATC-check a new object in the right package and transport. | Creates and activates; never deletes or releases. |
| `safe-edit` | optional `destination`, then `object` (name or URL), `change` | Read, change with text-anchored replacements, activate, test and show the diff. | Never reaches `deleteObject`, `transportRelease` or `forceUnlock` on its own; if a foreign lock or a release question comes up it stops and asks. |
| `review-transport` | optional `destination`, then `transport` (request number) | Diff every object on a transport and produce a go/no-go review. | Never calls `transportRelease`. |
| `fix-atc` | optional `destination`, then `target` (object URL, package name or transport), optional `variant` | Run ATC, apply deterministic quickfixes, fix the rest with edits, re-run until priority 1 and 2 are clean. | Applies quickfixes and edits; exemptions only with approval. |
| `clean-core-check` | optional `destination`, then `target` (object name or URL, or package name) | Assess ABAP Cloud readiness: released APIs, deprecated objects, successors, cloud ATC checks. | Changes no code. |
| `debug-dump` | optional `destination`, then optional `filter` (user, program, exception or time window) | Find the root cause of a short dump and propose the fix at the exact line. | Proposes replacements; does not apply them without approval. |

How you invoke them depends on the host. Claude Code exposes MCP prompts as slash commands named `/mcp__<server>__<prompt>`, with the arguments given positionally in the order the prompt declares them (`destination` comes first in every prompt, as in the table):

```text
/mcp__abap-adt-mcp__safe-edit DEV ZCL_ORDER_SERVICE "return early when the input table is empty"
```

Claude Desktop offers them from the chat's attachment (plus) menu under the server name at the time of writing; hosts without prompt support simply do not show them, and the same flows still reach the model through the server's `instructions` field.

## Other ways to install

**Pin the version.** `npx -y abap-adt-mcp` fetches the newest release at every start. For a controlled rollout pin it (`npx -y abap-adt-mcp@0.3.3`, or the `vX.Y.Z` container tag) and verify the provenance attestation that trusted publishing attaches with `npm audit signatures` in a directory where the package is installed.

**Claude Code plugin manifest.** `.claude-plugin/plugin.json` declares the server as `npx -y abap-adt-mcp` with `SAP_SYSTEMS_FILE=${HOME}/.abap-adt-mcp/systems.json`; the two skills live in `skills/` next to it, where hosts that install plugins from a repository pick them up. The skills alone install, at the time of writing, with `npx skills add williansaez/abap-adt-mcp` (a third-party installer, not part of this repository) or by copying the two directories into `~/.claude/skills/`.

**Container.** Images are built from `node:22-alpine`, run as the unprivileged `node` user (uid 1000) and are published to GHCR on every release (tags `latest` and `vX.Y.Z`). Mount your `systems.json` read-only and pass referenced secrets through:

```bash
docker run -i --rm \
  -v "$PWD/systems.json:/config/systems.json:ro" \
  -e SAP_SYSTEMS_FILE=/config/systems.json \
  -e ONPREM_PASSWORD \
  ghcr.io/williansaez/abap-adt-mcp:latest
```

The file-mode check runs inside the container as well: a mounted file with mode `0600` owned by another uid cannot be read by the `node` user at all (the start fails with `is not valid JSON: EACCES`, since the read and the parse share one error path), and a file readable by others only warns unless it holds inline secrets. Either own the file by uid 1000 and keep `0600`, or reference every secret as `${env:VAR}` and accept the warning. Secrets passed with `-e` are visible to `docker inspect`; there is no file-based alternative for `MCP_HTTP_TOKEN`, so treat the container's environment as confidential. For Streamable HTTP inside the container add `-e MCP_HTTP_PORT=2236 -e MCP_HTTP_HOST=0.0.0.0 -e MCP_HTTP_TOKEN=<token> -p 127.0.0.1:2236:2236`. Browser SSO needs a local browser, so run SSO destinations from npm on the workstation; `basic` and `oauth` destinations work inside the container.

**MCP registry.** Listed as `io.github.williansaez/abap-adt-mcp` for hosts that browse the registry; [server.json](server.json) is the registry manifest.

**From source.**

```bash
git clone https://github.com/williansaez/abap-adt-mcp.git
cd abap-adt-mcp
npm ci
npm run build
```

Then point the host at `node /absolute/path/abap-adt-mcp/dist/index.js`. A `systems.json` next to the checkout is picked up automatically; `.env` (see [.env.example](.env.example)) works for single-system setups. Both are git-ignored.

## Authentication

Every destination picks its own `authType` (`sso` unless `SAP_AUTH_TYPE` says otherwise). Details and SAP-side steps are in [docs/AUTH.md](docs/AUTH.md).

| Mode | Use it for | What you configure | SAP-side setup |
|---|---|---|---|
| `sso` (default) | S/4HANA Cloud named users, exactly like Eclipse ADT (SAML2/OIDC via IAS) | A Chromium browser (Chrome, Edge, Brave) opens once per host; the session cookies are read over the DevTools protocol and kept in memory, with `sap-client` pinned on every request. The identity-provider session lives in a dedicated profile under `~/.abap-adt-mcp/sso/<host>` (mode `0700`). `SAP_BROWSER_PATH` overrides the browser, `SAP_BROWSER_PROFILE_DIR` reuses a custom profile with saved passkeys (the browser's default profile is rejected on purpose). | None beyond the developer business role your user already needs for Eclipse ADT |
| `basic` | On-prem AS ABAP, S/4HANA Cloud Communication Users | `user` and `password` (use `${env:VAR}`). Authenticates on the first call, `login` is optional. | A user with ADT authorizations |
| `oauth` | S/4HANA Cloud unattended clients | `oauth.tokenUrl`, `oauth.clientId`, `oauth.clientSecret`, optional `oauth.scope` (client credentials grant; the token is cached until shortly before expiry and invalidated on a 401). | A Communication User, a Communication System with OAuth 2.0, and a Communication Arrangement for the scenario that exposes ADT on your tenant (it varies by tenant and is not listed here; the arrangement gives the token endpoint). The tools then run with the Communication User's authorizations. |

Named business users on S/4HANA Cloud cannot use basic auth; they log in through `sso` or you create a Communication User. The SSO session is created for the tenant's logon client, which may differ from the one you expect (`100` instead of `080`, for example): set `client` to the one the session actually uses. A wrong client shows up as authorization or not-found errors on objects you can open in Eclipse, after a login that itself succeeded. The SSO profile directory is an ordinary Chromium user-data directory: it holds the cookies and local storage the identity provider sets when you tick "stay signed in", nothing the server adds, and it is protected by file permissions and by whatever Chromium does on your OS, not encrypted by the server; how long the session stays valid is the identity provider's policy, and deleting the directory is the only way to end it early (the harvested SAP session cookie itself is never written to disk). Per-destination `tls` adds a corporate CA (`ca`) or an X.509 client certificate (`cert` + `key`, or `pfx` + `passphrase`) with verification kept on; the SSO browser window manages its own trust store. Optional `gitUser`/`gitPassword` supply abapGit credentials so they never pass through the model. Expired sessions in any mode are re-established once and the call retried; if that fails the error says `kind: "sessionExpired"`.

## Keeping it safe

This server gives a language model read and write access to SAP. A few rules make that comfortable:

- **Guard rails live in the server, not in the host.** A destination's `policy` block is evaluated in the server before the tool's own SAP call, whatever the host approves; `allowedPackages` is the one gate that may need a lookup (`transportInfo`, cached) to learn an existing object's package first. Refusals come back as `kind: "policyDenied"` naming the gate, and `listSystems` shows each policy. A destination without a `policy` block is fully writable.

  | Key | Type | Effect |
  |---|---|---|
  | `readOnly` | boolean | Only tools annotated read-only may run, plus `login`, `logout`, `dropSession`, `listSystems`, `healthcheck`, `systemProfile` and `exportPackageSources` (which writes locally only). Blocked as writes: every source write, `lock`, `runSnippet`, `runClass`, `unitTestRun`, `createAtcRun` and `atcSummary`. Still allowed: `runQuery` and `tableContents` (they are reads; deny them with `allowFreeSql: false` or `deniedTools`). |
  | `deniedTools` | globs | Tool names refused outright on this destination, for example `["transportRelease", "git*"]`. The tools stay listed. |
  | `allowFreeSql` | boolean | `false` refuses `runQuery` and `tableContents` with `sqlQuery`. |
  | `deniedTables` | globs | Applied to `tableContents`, to every `FROM`/`JOIN` target of a `runQuery`, and (best effort, by scanning the ABAP text) to `runSnippet`, `setObjectSource` and `setMethodSource`. Dynamic SQL and views over the table are not detected: for data that must not leave SAP, rely on the SAP display authorizations of the connected user and combine `allowFreeSql: false` with `deniedTools: ["runSnippet"]` or `readOnly`. |
  | `allowedPackages` | globs, closed list | Gates writes only; reads and navigation of any object (SAP objects included) are never gated. Package arguments are checked directly; object writes resolve the object's package through `transportInfo`; an unresolvable package is refused. `gitPullRepo`, `rapGenGenerate`, `rapGenPublishService`, `publishServiceBinding` and `unPublishServiceBinding` cannot derive a package and are refused whenever this key is set. |
  | `allowedTransports` | globs | Every `transport`/`transportNumber` argument must match; `createTransport` and `resolveTransport(createIfMissing=true)` are refused. |

  Server-wide switches are `MCP_READ_ONLY=1` (adds `readOnly` to every destination) and `MCP_DISABLED_TOOLSETS` (hides whole toolsets from every destination); there is no global `deniedTools`, `deniedTables` or `allowedPackages`, those are repeated per entry. Hidden and refused differ: a toolset left out by `MCP_TOOLSETS`/`MCP_DISABLED_TOOLSETS` is absent from the tool list and a call by name (from a prompt, a host that cached an older list, or a skill) is refused with the toolset name; `deniedTools` keeps the tool listed and refuses it on that destination; tools a destination cannot serve (detected by `systemProfile`) stay listed and are refused before calling SAP (`MCP_PROFILE_GATE=enforce|warn|off`).
- **Secrets stay out of files and chats.** `${env:VAR}` works in every string of `systems.json` (`password`, `oauth.clientSecret`, `gitPassword`, `tls.passphrase`, even `url`); a missing variable fails at startup by name, never by value. Keep `systems.json` at mode `0600`: a group- or world-readable file is warned about and refused when it holds an inline `password`, `oauth.clientSecret` or `gitPassword`. Prefer `SAP_SYSTEMS_FILE` over inline `SAP_SYSTEMS` in host configs. `MCP_HTTP_TOKEN` is an environment variable, not a file entry; the client side of the HTTP transport has to carry the token in its host config, so keep that file at `0600` too. `listSystems` and `healthcheck` report no credentials, error messages pass through a redaction step that masks bearer tokens, cookies, passwords and `user:password@host` URLs, and `exportPackageSources` may only write inside `MCP_EXPORT_ROOT` (default `~/.abap-adt-mcp/exports`, checked against symlinks). `reentranceTicket` stays disabled unless `SAP_ALLOW_REENTRANCE_TICKET=1`, because it returns a live logon credential into the conversation.
- **TLS stays on, and cannot be turned off for everything at once.** `NODE_TLS_REJECT_UNAUTHORIZED=0` is removed from the environment before the first connection, and the server says so at startup: one destination's problem never silences verification for the others, for the OAuth token request or for the cloudification download. For a corporate or self-signed certificate use `tls.ca` on that destination (verification stays on, no warning), or as a last resort `insecureTls: true` on that destination only (announced at startup).
- **Content from SAP is untrusted input.** Comments, table rows and feeds can carry text that tries to steer the model. Use a host that asks before tool calls and review destructive ones (`deleteObject`, `transportRelease`, `transportDelete`, `setObjectSource`, `editObjectSource`, `setMethodSource`, `pushRepo`, `forceUnlock`) before approving them.
- **Least privilege, and what "read-only" still reads.** Connect with users that have only the authorizations the task needs. `runQuery` and `tableContents` read real business data, so configure only destinations where that is acceptable, and `exportPackageSources` copies whole packages of source to local disk even on a `readOnly` destination: add it to `deniedTools` where source must not leave SAP.
- **What leaves the machine.** The server talks to the configured SAP hosts, to the identity provider during browser SSO, and to GitHub for SAP's cloudification repository when `apiReleaseState` runs (one JSON file per edition from `raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc`, 15-second timeout, cached for 24 hours under `~/.abap-adt-mcp/cache`, relocatable with `MCP_CACHE_DIR`; a cached copy is used when the download fails). There is no offline switch, mirror URL or proxy support for that download (it uses Node's built-in `fetch`, which ignores `HTTPS_PROXY`): on an air-gapped host seed the cache directory once, or leave that single tool to fail. Nothing else is sent anywhere: no telemetry, no update checks. `npx` itself contacts the npm registry.

## Audit log

Set `MCP_AUDIT_FILE=/var/log/abap-adt-mcp/audit.jsonl` to append one JSON line per tool call. The directory is created with mode `0700` and the file with `0600`; a write failure is reported once on stderr and never breaks a call. Each record is appended by path, so rotating the file by renaming it is safe (the next call creates a fresh one); the server keeps no retention of its own. [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md) explains how to turn the file into a useful session report.

```json
{"ts":"2026-09-03T10:15:42.117Z","requestId":42,"tool":"editObjectSource","destination":"DEV","durationMs":1834,"outcome":"ok","args":{"objectSourceUrl":"/sap/bc/adt/oo/classes/zcl_example/source/main","replacements":"[array 312 chars]","activate":true,"transport":"DEVK900123"}}
{"ts":"2026-09-03T10:16:03.902Z","requestId":43,"tool":"runQuery","destination":"QAS","durationMs":2,"outcome":"denied","args":{"sqlQuery":"SELECT * FROM ztable"},"errorKind":"policyDenied","gate":"allowFreeSql","message":"MCP error -32600: Policy: runQuery blocked on destination QAS (allowFreeSql): free SQL (runQuery) is disabled; use tableContents on an allowed table. Configured in systems.json policy; retrying will not help."}
```

Fields: `ts`, `requestId`, `tool`, `destination`, `durationMs`, `outcome` (`ok`, `error`, `denied` for policy refusals, `unavailable` for toolset or platform gates), `errorKind`, `gate` (the policy key), `message` (the error text, first 300 characters), `args` and `retried` (set when the call was re-authenticated and retried). What `args` keeps: argument keys containing `pass` (so `password` and `passphrase`), `secret`, `token`, `authorization`, `cookie` or `lockHandle` become `[REDACTED]`; string values up to 200 characters are stored verbatim after the same redaction as error messages (so an SQL statement or a short snippet with business literals is in the file), longer strings are truncated, and arrays or objects over 200 characters collapse to `[array N chars]` or `[object N chars]`. Treat the file as sensitive. There is no caller identity in a record (no remote address, MCP session id or token id): on stdio the process belongs to one person, and on a shared HTTP instance attribution has to come from running one instance per person or from the access log of the reverse proxy in front.

## S/4HANA Cloud versus on-prem

`systemProfile(destination)` reports whether a destination is cloud or on-prem (host domain, system information and discovery document) and which toolsets the backend lacks; those tools are refused before calling SAP. If you only have an S/4HANA Cloud tenant, the middle column is yours. What [docs/TESTPLAN.md](docs/TESTPLAN.md) and [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md) recorded on a Public Cloud tenant:

| Topic | S/4HANA Cloud (public edition) | On-prem / private |
|---|---|---|
| Authentication | Named users: browser SSO only. Unattended: OAuth2 from a Communication Arrangement, or basic auth with a Communication User. | Basic auth; client certificates through `tls`. |
| Local objects | `$TMP` was refused on the tested tenant (authorization object S_ABPLNGVS: objects in `$TMP` get the Standard language version); use a customer package with ABAP for Cloud Development and its transport, `resolveTransport` picks it. `runSnippet` needs `packageName`, `transport` and `responsible` there. | `$TMP` available, no transport needed; `runSnippet` defaults to `$TMP`. |
| Toolsets | RAP generator absent on the tested tenant; debugger, traces and abapGit depend on the tenant and authorizations. `dumps`/`dumpDetails` are the root-cause path when the debugger is missing. `sourceTextSearch` falls back to `grepPackage` when the tenant answers "Source Search is not supported". | Full ADT collection set on a current release. |
| Released APIs | `apiReleaseState` checks names, an object URL or a whole source; ATC variant `ABAP_CLOUD_DEVELOPMENT_DEFAULT`. `createObject` needs `responsible`. | Optional. |
| Business data | `runQuery`/`tableContents` respect display authorizations; deny tables per policy. `runSnippet` needs S_DEVELOP, so development systems only. | Same. |

Lessons that apply everywhere: `runQuery` statements are wrapped to the data preview's 255-character line limit; tables with restricted `dataMaintenance` are read with `tableContents`; a lock held by an open Eclipse session is foreign and only `SM12` or that session can release it; writing a message class through `setObjectSource` rewrites the whole class and resets `masterLanguage` to the logon language.

## Configuration reference

Every option with its default, the policy gates tool by tool, host snippets and operational notes are in [docs/CONFIGURATION.md](docs/CONFIGURATION.md); this section is the summary.

Configuration sources, in order of precedence: `SAP_SYSTEMS` (inline JSON), `SAP_SYSTEMS_FILE`, a `systems.json` next to the install, then the legacy single-system variables (`SAP_URL`, `SAP_CLIENT`, `SAP_USER`, `SAP_PASSWORD`, `SAP_LANGUAGE`, `SAP_TLS_INSECURE`, `SAP_OAUTH_TOKEN_URL`, `SAP_OAUTH_CLIENT_ID`, `SAP_OAUTH_CLIENT_SECRET`, `SAP_OAUTH_SCOPE`, see [.env.example](.env.example)).

Per-destination keys in `systems.json`: `url`, `client`, `language`, `authType`, `default`, `user`/`password` (basic), `oauth` (`tokenUrl`, `clientId`, `clientSecret`, `scope`), `insecureTls`, `gitUser`/`gitPassword`, `policy` and `tls` (`ca`, `cert` + `key`, `pfx` + `passphrase`). Any string value may be `${env:VAR}`. Keys starting with `_` are ignored, so `_comment` entries are fine. All operational output (startup warnings, gate messages, the audit-file warning) goes to stderr, which MCP hosts capture in their logs.

Every variable declared in [server.json](server.json):

| Variable | Purpose | Default / notes |
|---|---|---|
| `SAP_SYSTEMS_FILE` | Path to the destinations file | Recommended; keep mode `0600` |
| `SAP_SYSTEMS` | The same map inline | Contains credentials, prefer the file |
| `SAP_DEFAULT_DESTINATION` | Destination used when a call omits `destination` | Or mark an entry `"default": true` |
| `SAP_AUTH_TYPE` | Default auth type for entries without one, and the mode of the legacy single-system setup | `sso`; `basic` or `oauth` |
| `MCP_TOOLSETS` | Toolsets to publish: preset `all` or `focused`, or a comma list | `all` |
| `MCP_DISABLED_TOOLSETS` | Toolsets to hide, comma list | `core` cannot be disabled |
| `MCP_READ_ONLY` | `1` makes every destination read-only, server-side | Off |
| `MCP_MAX_RESPONSE_CHARS` | Character budget of one tool response before paging or truncation | 40000, minimum 5000 |
| `MCP_PROFILE_GATE` | Gate for toolsets the destination does not expose | `enforce`; `warn` logs only, `off` disables |
| `MCP_SOURCE_CACHE_TTL_SECONDS` | Lifetime of the per-session source cache used by `syntaxCheckCode`, `grepPackage`, `cdsViewInfo`, `typeHierarchy`, `abapDocumentation` and `apiReleaseState(sourceUrl)` | 300; `0` keeps entries until logout |
| `MCP_EXPORT_ROOT` | Directory `exportPackageSources` may write into | `~/.abap-adt-mcp/exports` |
| `MCP_AUDIT_FILE` | JSONL audit trail path | Off when unset |
| `SAP_ALLOW_REENTRANCE_TICKET` | `1` enables the `reentranceTicket` tool | Disabled |
| `SAP_BROWSER_PATH` | SSO: path to a Chromium, Chrome or Edge binary | Auto-detected |
| `SAP_BROWSER_PROFILE_DIR` | SSO: persistent browser profile holding the identity-provider session | `~/.abap-adt-mcp/sso/<host>` |
| `MCP_HTTP_PORT` | Serve Streamable HTTP on `http://127.0.0.1:<port>/mcp` with bearer auth instead of stdio | Unset (stdio); accepts 1024 to 65535 |
| `MCP_HTTP_HOST` | Bind address of the HTTP transport | `127.0.0.1`; `0.0.0.0` only in containers |
| `MCP_HTTP_TOKEN` | Bearer token for the HTTP transport | Generated into `~/.abap-adt-mcp/http-token` |
| `MCP_HTTP_MAX_SESSIONS` | Maximum concurrent MCP sessions; further `initialize` requests get `503` | 16 |
| `MCP_HTTP_SESSION_TTL_MINUTES` | Idle minutes after which an HTTP session (and its SAP sessions and locks) is closed | 30 |
| `MCP_HTTP_ALLOWED_ORIGINS` | Comma-separated `Origin` values allowed; `*` allows any | Loopback origins always allowed on a loopback bind |
| `MCP_HTTP_ALLOWED_HOSTS` | Comma-separated `Host` header values allowed (DNS-rebinding protection) | Loopback hosts always allowed on a loopback bind; any host on a non-loopback bind |
| `SAP_URL` | Legacy single-system mode: base URL, for example `https://host:44300` | |
| `SAP_CLIENT` | Legacy single-system mode: client, for example `100` | |
| `SAP_LANGUAGE` | Legacy single-system mode: logon language, for example `EN` | |
| `SAP_USER` | Legacy single-system mode: SAP user | |
| `SAP_PASSWORD` | Legacy single-system mode: SAP password | Secret |
| `SAP_TLS_INSECURE` | Legacy single-system mode: `1` skips certificate verification for that system only | Sandboxes only |
| `SAP_OAUTH_TOKEN_URL` | Legacy single-system mode with `SAP_AUTH_TYPE=oauth`: token endpoint | |
| `SAP_OAUTH_CLIENT_ID` | Legacy single-system mode: OAuth2 client id | |
| `SAP_OAUTH_CLIENT_SECRET` | Legacy single-system mode: OAuth2 client secret | Secret |
| `SAP_OAUTH_SCOPE` | Legacy single-system mode: optional OAuth2 scope | |

Read at runtime but not part of the registry manifest: `MCP_CACHE_DIR` relocates the cloudification repository cache (default `~/.abap-adt-mcp/cache`), and `NODE_TLS_REJECT_UNAUTHORIZED=0` is removed at startup so it cannot disable certificate verification for the whole process.

## HTTP transport (optional)

By default the server speaks stdio: one process per user, nothing listening on the network. For hosts that expect an HTTP endpoint (Eclipse, another machine, a container, a shared team instance), start it with a port:

```bash
MCP_HTTP_PORT=2236 npx -y abap-adt-mcp
```

It listens on `http://127.0.0.1:2236/mcp` (loopback only unless `MCP_HTTP_HOST` says otherwise) and requires `Authorization: Bearer <token>` on every request. The token is generated at startup and written to `~/.abap-adt-mcp/http-token` (mode `0600`); `MCP_HTTP_TOKEN` sets your own. Host config:

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:2236/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

What the front door enforces:

- Ports below 1024 are refused; the bearer token is compared in constant time; `GET /health` is the only unauthenticated route and answers with version, session count, the session cap and uptime (block it at the proxy if that disclosure matters). Everything else outside `/mcp` is `404`.
- DNS-rebinding protection: on a loopback bind only loopback `Host` and `Origin` values pass, extendable with `MCP_HTTP_ALLOWED_HOSTS` and `MCP_HTTP_ALLOWED_ORIGINS` (`*` allows any). On a non-loopback bind every `Host` header passes (the Host check only guards loopback binds), while an `Origin` header still has to be listed in `MCP_HTTP_ALLOWED_ORIGINS` (browser callers); requests without an `Origin` header (non-browser clients) pass on either bind.
- One server instance per MCP session: separate SAP sessions, lock ledger and caches per caller. Idle sessions expire after `MCP_HTTP_SESSION_TTL_MINUTES` (default 30); beyond `MCP_HTTP_MAX_SESSIONS` (default 16) new `initialize` requests get `503` with `Retry-After`; a closed or expired session releases its locks and SAP sessions. On SIGINT/SIGTERM the process closes the listening instance and exits without walking the open sessions, so send `DELETE /mcp` from the clients before stopping a shared instance. The `initialize` body is capped at 4 MB; requests that already carry an `mcp-session-id` go straight to the MCP SDK, which applies no size limit of its own.
- Warnings at startup when the bind reaches beyond loopback, and again when an SSO destination is exposed that way: every remote caller would share the browser login of the user running the server.

What it does not provide: TLS (put a reverse proxy in front), rate limiting, per-user tokens or token rotation without a restart (a restart without `MCP_HTTP_TOKEN` already generates a new token and overwrites `http-token`; when you set the variable yourself, change it and restart; open sessions end with the process). A shared instance therefore means one token and, for each destination, one set of SAP credentials for every caller. Prefer one instance per person, or `basic`/`oauth` destinations with a `readOnly` policy, keep the token secret and put TLS in front.

## Tool catalog (all 173 tools, by toolset)

The per-tool reference (description, parameters, read-only/destructive annotations) is [docs/TOOLS.md](docs/TOOLS.md), generated from the live `tools/list` response by `npm run tools:docs` and verified by a contract test in CI. Every tool except `listSystems` and `healthcheck` accepts an optional `destination`; without it the default destination is used.

Tool schemas cost context. Set `MCP_TOOLSETS` to a preset (`all`, the default, or `focused` = 114 development tools) or to a comma list of the names below; `MCP_DISABLED_TOOLSETS` removes some. `core` is always published. Unknown names fail at startup.

| Toolset | In `focused` | Tools |
|---|---|---|
| `core` · Destinations, health & session (6) | yes | `login`, `logout`, `dropSession`, `listSystems`, `healthcheck`, `systemProfile` |
| `source` · Source code (16) | yes | `lock`, `unLock`, `listLocks`, `forceUnlock`, `getObjectSource`, `setObjectSource`, `editObjectSource`, `getMethodSource`, `setMethodSource`, `prettyPrinterSetting`, `setPrettyPrinterSetting`, `prettyPrinter`, `revisions`, `objectDiff`, `getTextElements`, `setTextElements` |
| `objects` · Objects & navigation (27) | yes | `objectStructure`, `searchObject`, `findObjectPath`, `objectTypes`, `reentranceTicket`, `classIncludes`, `classComponents`, `deleteObject`, `activateObjects`, `activateByName`, `activatePackage`, `inactiveObjects`, `objectRegistrationInfo`, `creatableTypeDetails`, `validateNewObject`, `createObject`, `nodeContents`, `mainPrograms`, `typeHierarchy`, `objectStructureElements`, `objectEnhancements`, `packageTree`, `exportPackageSources`, `whereUsed`, `cdsViewInfo`, `sourceTextSearch`, `grepPackage` |
| `transports` · Transports (18) | yes | `transportDetails`, `transportUnifiedDiff`, `transportInfo`, `resolveTransport`, `createTransport`, `hasTransportConfig`, `transportConfigurations`, `getTransportConfiguration`, `setTransportsConfig`, `createTransportsConfig`, `userTransports`, `transportsByConfig`, `transportDelete`, `transportRelease`, `transportSetOwner`, `transportAddUser`, `systemUsers`, `transportReference` |
| `analysis` · Syntax & code analysis (16) | yes | `syntaxCheckCode`, `syntaxCheckCdsUrl`, `codeCompletion`, `findDefinition`, `usageReferences`, `syntaxCheckTypes`, `codeCompletionFull`, `runClass`, `codeCompletionElement`, `usageReferenceSnippets`, `fixProposals`, `fixEdits`, `fragmentMappings`, `abapDocumentation`, `apiReleaseState`, `runSnippet` |
| `tests` · Unit tests (4) | yes | `unitTestRun`, `unitTestEvaluation`, `unitTestOccurrenceMarkers`, `createTestInclude` |
| `atc` · ATC (14) | yes | `atcCustomizing`, `atcQuickfixProposals`, `atcApplyQuickfix`, `atcCheckVariant`, `atcSummary`, `createAtcRun`, `atcWorklists`, `atcUsers`, `atcExemptProposal`, `atcRequestExemption`, `isProposalMessage`, `atcContactUri`, `atcChangeContact`, `atcDocumentation` |
| `data` · Data access & DDIC (10) | yes | `annotationDefinitions`, `ddicElement`, `ddicRepositoryAccess`, `packageSearchHelp`, `getDomainProperties`, `setDomainProperties`, `getDataElementProperties`, `setDataElementProperties`, `tableContents`, `runQuery` |
| `discovery` · Discovery & metadata (7) | no | `featureDetails`, `collectionFeatureDetails`, `findCollectionByUrl`, `loadTypes`, `adtDiscovery`, `adtCoreDiscovery`, `adtCompatibilityGraph` |
| `runtime` · Runtime errors (3) | yes | `feeds`, `dumps`, `dumpDetails` |
| `refactoring` · Refactoring (8) | no | `renameEvaluate`, `renamePreview`, `renameExecute`, `extractMethodEvaluate`, `extractMethodPreview`, `extractMethodExecute`, `changePackagePreview`, `changePackageExecute` |
| `rap` · RAP generation (8) | no | `rapGenIsAvailable`, `rapGenGetSchema`, `rapGenGetContent`, `rapGenValidateInitial`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate`, `rapGenPublishService` |
| `services` · Business services (4) | no | `publishServiceBinding`, `unPublishServiceBinding`, `fetchServiceDetails`, `bindingDetails` |
| `git` · abapGit (10) | no | `gitRepos`, `gitExternalRepoInfo`, `gitCreateRepo`, `gitPullRepo`, `gitUnlinkRepo`, `stageRepo`, `pushRepo`, `checkRepo`, `remoteRepoInfo`, `switchRepoBranch` |
| `debugger` · Debugger (13) | no | `debuggerListeners`, `debuggerListen`, `debuggerDeleteListener`, `debuggerSetBreakpoints`, `debuggerDeleteBreakpoints`, `debuggerAttach`, `debuggerSaveSettings`, `debuggerStackTrace`, `debuggerVariables`, `debuggerChildVariables`, `debuggerStep`, `debuggerGoToStack`, `debuggerSetVariableValue` |
| `traces` · Traces (9) | no | `tracesList`, `tracesListRequests`, `tracesHitList`, `tracesDbAccess`, `tracesStatements`, `tracesSetParameters`, `tracesCreateConfiguration`, `tracesDeleteConfiguration`, `tracesDelete` |

Destructive tools (`deleteObject`, `transportRelease`, `transportDelete`, `setObjectSource`, `editObjectSource`, `setMethodSource`, `atcApplyQuickfix`, `runClass`, `runSnippet`, `pushRepo`, `forceUnlock` and others) carry `destructiveHint: true` for hosts that gate approval by annotation. A tool can be missing for two reasons: its toolset is not published (the `focused` preset leaves out `debugger`, `traces`, `git`, `rap`, `services`, `refactoring` and `discovery`; the refusal names the toolset), or the destination cannot serve it (`systemProfile` reports what is missing; the refusal says "not available on destination").

## Compared with SAP's official ADT MCP Server

SAP's ADT MCP Server ships with ADT for VS Code and Eclipse and publishes under the server key `abap-adt` with its own tool names, which public skills such as `claude-abap-skills` route by. This project publishes under `abap-adt-mcp`, serves many destinations from one process over stdio or HTTP, enforces policies server-side, and adds compositions such as `resolveTransport`, `editObjectSource`, `grepPackage`, `apiReleaseState`, `runSnippet` and `objectDiff`. The two can be registered side by side in the same host, since keys and tool names do not collide. This README does not catalogue what SAP's server offers beyond this one; [docs/ROUTING.md](docs/ROUTING.md) maps SAP's names to ours where an equivalent exists. A few rows:

| SAP official tool / capability | abap-adt-mcp tool(s) |
|---|---|
| `abap_lists_destinations` | `listSystems`, `systemProfile` |
| `SAPRead` / `abap_get_source` | `getObjectSource` (`version=inactive` for unactivated code) |
| `SAPSearch` / `abap_search_objects` | `searchObject`; by content `sourceTextSearch`, `grepPackage` |
| `abap_write_source` / `SAPWrite` | `setObjectSource` (`activate=true`), targeted `editObjectSource` |
| `abap_activate_objects` / `ActivatePackage` | `activateByName`, `activateObjects`, `inactiveObjects` |
| `abap_run_unit_tests` | `unitTestRun`, `unitTestEvaluation` |
| `abap_atc_run` / `abap_atc_findings` | `createAtcRun`, `atcWorklists`, `atcQuickfixProposals`, `atcApplyQuickfix`, `atcDocumentation` |
| `abap_transport-unifiedDifference` | `transportUnifiedDiff`, `transportDetails` |
| `abap_generators-*` | `rapGenIsAvailable`, `rapGenGetSchema`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate`, `rapGenPublishService` |
| `abap_lock` / `abap_unlock` | Not needed for single writes (auto-lock); `lock`, `unLock`, `listLocks`, `forceUnlock` |
| `abap_dumps` | `dumps`, `dumpDetails` |
| released-API / Clean Core check | `apiReleaseState` |

## Skills and plugin

Two agent skills ship under `skills/`: `abap-adt-mcp` teaches the model how to develop ABAP with these tools (session start, finding code, the change flow, cloud readiness, errors, safety) and `abap-adt-mcp-setup` walks through installation, configuration and a first health check. They reach the host through the plugin manifest, through the third-party `npx skills add williansaez/abap-adt-mcp` installer, or by copying the two directories into `~/.claude/skills/`; a plain `npx` registration of the server installs no skill, and the essential flows still arrive through the server's `instructions` field and the [built-in prompts](#built-in-prompts).

What real sessions taught the server is in [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md), the live test plan in [docs/TESTPLAN.md](docs/TESTPLAN.md), the roadmap in [docs/ROADMAP.md](docs/ROADMAP.md) and releases in [CHANGELOG.md](CHANGELOG.md).

## Troubleshooting

- **The server never appears in the host.** Read the host's MCP log (locations in [step 2](#2-register-the-server-in-your-host)). `spawn npx ENOENT`: Node.js is not installed or not on the PATH the app sees; install it or put the absolute path to `npx` in `command` (`/usr/local/bin/npx` for the macOS installer, `/opt/homebrew/bin/npx` for Homebrew). `No ABAP systems configured`: `SAP_SYSTEMS_FILE` points at a missing file. `is not valid JSON`: a stray comma or a Windows path with single backslashes. Claude Desktop reads the config only at start, so quit and reopen it after every change.
- **No browser window, or SSO fails.** A Chromium browser must be installed; `SAP_BROWSER_PATH` points at it when auto-detection fails. The browser's default profile is rejected on purpose; `SAP_BROWSER_PROFILE_DIR` names a dedicated one. Delete `~/.abap-adt-mcp/sso/<host>` to log out of a tenant completely.
- **Login works, then everything is "not authorized" or "not found".** The SSO session landed on another client than `client` says: set `client` to the tenant's logon client (the About entry of the launchpad user menu shows it).
- **`kind: "sessionExpired"` keeps coming back.** The server already re-authenticated and retried once; ask the model to call `login` for that destination. Lock handles from the old session are invalid (`kind: "staleLockHandle"`): lock again.
- **`kind: "locked"` by another session.** `listLocks` shows the server's own locks; if the object is not there the lock belongs to another session (Eclipse or another user) and only that session or `SM12` releases it.
- **`editObjectSource` reports 0 matches, or several.** Nothing was written. The anchor must be the exact current text on SAP, indentation included: re-read with `getObjectSource` and copy it; for several matches include more surrounding lines.
- **Tool refused as not available or not enabled.** "Not available on destination": run `systemProfile`, the tenant lacks that ADT collection (`MCP_PROFILE_GATE=warn` only logs, `off` disables the gate). "Belongs to toolset ... which is not enabled": the toolset is missing from `MCP_TOOLSETS` (the `focused` preset has no `debugger` or `traces`); add it or use `MCP_TOOLSETS=all`. Without a debugger, `dumps` and `dumpDetails` are the root-cause path.
- **`kind: "policyDenied"`.** The destination's `policy` (or `MCP_READ_ONLY`) forbids the call and the message names the gate: the guard rail is working. Adjust the policy if the call was intended.
- **Startup refuses the config file.** It is readable by other users and holds inline passwords: `chmod 600` it or reference the secrets as `${env:VAR}`.
- **Certificate errors on-prem.** Give the destination its CA bundle with `tls.ca`; `insecureTls: true` (or `SAP_TLS_INSECURE=1` in legacy mode) disables verification for that destination only. `NODE_TLS_REJECT_UNAUTHORIZED=0` will not help: the server removes it.
- **Connection errors.** Check URL and client, ADT authorizations, and on-prem that `/sap/bc/adt` is active in `SICF`.
- **`runQuery` fails on a table the user can display.** The data preview refuses tables with restricted `dataMaintenance`; use `tableContents`. A statement that still fails after the 255-character reflow has a single literal longer than that, or a real syntax error at the named token.
- **Tool schemas eat the context window.** Start with `MCP_TOOLSETS=focused`, or hide toolsets (`MCP_DISABLED_TOOLSETS=debugger,traces`).

## Testing and contributing

```bash
git clone https://github.com/williansaez/abap-adt-mcp.git
cd abap-adt-mcp
npm ci
npm run build
npm test
```

Jest suites cover handlers, error hints, response sizing, toolsets and the catalog contract against `docs/tools.snapshot.json`; CI runs them on Node 18, 20 and 22, builds the container image and checks that it starts and lists tools. After changing a tool description or schema, run `npm run tools:docs` and commit the regenerated `docs/TOOLS.md`, snapshot and README counts, or CI flags them as stale. Releases are tag-driven: npm through trusted publishing (GitHub OIDC, provenance attached) plus the GHCR image. Fork, branch, open a pull request. Session reports for [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md) are welcome, without customer names, tenants or transport numbers.

## License

[MIT](LICENSE). Built on [abap-adt-api](https://github.com/marcellourbani/abap-adt-api) by Marcello Urbani. If the project saves you time, you can [buy the author a coffee](https://www.buymeacoffee.com/williansaez).
