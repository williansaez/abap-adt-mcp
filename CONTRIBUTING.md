# Contributing to abap-adt-mcp

Thank you for helping. This document is for people who change the code, the tool catalog, the docs or the release. If you only want to use the server, the [README](README.md) and [docs/CONFIGURATION.md](docs/CONFIGURATION.md) are the right place; if you want to report what a real session taught you, jump to [Field reports](#field-reports).

The short version: `npm ci`, `npm run build`, `npm test`, make your change, regenerate the tool docs, open a pull request. That fits a bug fix or a docs-only change. Adding, renaming or reshaping a tool pulls in the extra steps in [Adding a tool](#adding-a-tool), manifest, policy, `tool-notes.json`, a changelog line. Only the manifest routing and the regenerated docs are machine-checked, by the catalog contract test and CI's docs-freshness step; the rest is caught in review; everything below explains why each step exists.

## Table of contents

- [Git workflow](#git-workflow)
- [Development setup](#development-setup)
- [Repository layout](#repository-layout)
- [Adding a tool](#adding-a-tool)
- [Adding a prompt](#adding-a-prompt)
- [Coding conventions](#coding-conventions)
- [Commit messages](#commit-messages)
- [Pull request checklist](#pull-request-checklist)
- [Live checks against a real system](#live-checks-against-a-real-system)
- [Field reports](#field-reports)
- [Release process](#release-process)
- [Code of conduct](#code-of-conduct)

## Git workflow

The repository carries no pull request template and the README's only line on this is "Fork, branch, open a pull request" ([Testing and contributing](README.md#testing-and-contributing)); this section is the rest of the story.

1. Fork the repository on GitHub and clone your fork.
2. Branch from `main`. It is the only long-lived branch: there is no `develop` and no hotfix branch (see [Release process](#release-process)), and releases are cut from `main` by tag.
3. Name the branch after the [commit prefix](#commit-messages) you will use, `type/short-description`. The project's own history does this (`feat/browser-sso-auth`); `feat/…` for a new tool or capability, `fix/…` for a bug, `docs/…` for documentation only, `test/…` for test-only changes.
4. Commit using the [Commit messages](#commit-messages) convention.
5. Push the branch to your fork and open a pull request against `main`. There is no PR template to fill in; use the [Pull request checklist](#pull-request-checklist) as your description outline.

No CLA or DCO is required: opening a pull request is taken as agreement to license the contribution under the repository's [MIT License](LICENSE). Reviews come from the maintainer named as `author` in [package.json](package.json); there is no team and no posted turnaround time.

## Development setup

The server runs on Node.js 18 or newer (`engines` in `package.json`); CI tests on 18, 20 and 22 and the container image is built from `node:22-alpine`, so develop on 22 and keep the code free of APIs that 18 lacks. There is no `.nvmrc`; `engines` is the only floor the repository states. `src/lib/browserLogin.ts` loads `puppeteer-core` through a real dynamic import (built with `new Function` so `tsc` cannot downlevel it to `require()`), which keeps the package out of every server start and pulls it in only when an SSO login runs.

```bash
git clone https://github.com/williansaez/abap-adt-mcp.git
cd abap-adt-mcp
npm ci                                   # exact versions from package-lock.json
npm run build                            # tsc -p tsconfig.json, output in dist/
npx tsc --noEmit -p tsconfig.test.json   # type-check the tests (they are excluded from the build)
npm test                                 # jest with coverage (npm test -- --coverage=false is faster)
npm run tools:docs                       # rebuild and regenerate docs/TOOLS.md and the snapshot
```

`npm run build` first removes `dist/` (the `prebuild` script), compiles `src/` with `strict: true` and leaves `src/**/__tests__/**` out, so nothing from the test tree reaches the npm package (`files` in `package.json` excludes `dist/**/__tests__` as a second guard). `tsconfig.test.json` extends the main config with `noEmit` and the `jest` and `node` types, and CI runs it separately: a test that no longer compiles fails the build even though `npm run build` ignores it.

`npm test` uses `ts-jest` with `roots: ['<rootDir>/src']` and `testMatch: ['**/__tests__/**/*.test.ts']`. Most sources import siblings with a `.js` suffix (`./lib/cookieHttpClient.js`); `moduleNameMapper` in [jest.config.js](jest.config.js) maps that suffix back to the `.ts` file, which is what makes `../lib/lockLedger.js` resolve; an extensionless import such as `../ObjectSourceHandlers` (what the tests use) resolves through `moduleFileExtensions` and needs no mapper. `collectCoverage` is on by default, but the config sets no `coverageThreshold`, so a change that lowers the printed coverage percentage does not fail the build; treat the numbers as information, not a gate. `npm run test:watch` and `npm run test:coverage` exist for longer sessions; to run one suite instead of the whole tree, `npx jest src/handlers/__tests__/ObjectSourceHandlers.test.ts` (or `npm test -- <path>`, which forwards to the same Jest CLI).

To exercise the built server without an MCP host, `npm run dev` starts the MCP Inspector on `dist/index.js`. It needs at least one destination; a placeholder such as `SAP_SYSTEMS='{"DEV":{"url":"https://example.invalid","authType":"basic","user":"u","password":"p"}}'` is the shape the CI Docker smoke test uses. `tools/list`, `listSystems`, `healthcheck` and the prompts work without a reachable system; everything else needs a real one (see [Live checks](#live-checks-against-a-real-system)). `npm run tools:docs` needs no environment setup from you either: `scripts/gen-tools-docs.js` sets `SAP_SYSTEMS` to a placeholder of the same shape itself when the variable is unset, so it runs the same way locally and in CI.

## Repository layout

| Path | What lives there |
|---|---|
| `src/index.ts` | `AbapAdtServer`: reads the destinations, builds one `ADTClient` and one handler set per destination, publishes the catalog (`getToolCatalog`), dispatches calls (destination, argument aliases, toolset gate, then inside the per-destination queue: policy, login, platform gate, handler, one-shot re-authentication), serializes results and errors. Also the `instructions` text hosts show the model, `PARAM_EXAMPLES` and `redactSecrets`. |
| `src/toolManifest.ts` | The static catalog: `HANDLER_KEYS`, `SERVER_TOOLS`, `TOOL_ROUTES` (handler key to tool names), `READ_ONLY_TOOLS`, `DESTRUCTIVE_TOOLS`, `toolAnnotations`, `TOOLSETS`, `TOOLSET_PRESETS` and `resolveToolsets` for `MCP_TOOLSETS` / `MCP_DISABLED_TOOLSETS`. |
| `src/prompts.ts` | The MCP prompts (`PROMPTS`, `listPrompts`, `getPrompt`). |
| `src/handlers/*.ts` | One class per domain, all extending `BaseHandler` (`getTools()` returns the schemas, `handle(command, args)` runs them). `AuthHandlers`, `TransportHandlers`, `ObjectSourceHandlers`, `AtcHandlers`, `SearchHandlers`, `CloudHandlers`, `SnippetHandlers` and so on, mirroring the handler keys, see the full table in [Adding a tool](#1-pick-or-create-the-handler). |
| `src/lib/*.ts` | Shared building blocks: `systems.ts` (configuration, `${env:VAR}`, file-mode checks), `policy.ts` (per-destination gates), `lockLedger.ts` (`withLock`, `listLocks`, `releaseAll`), `responseSizing.ts` (`shrinkToFit`, `SAFE_OUTPUT_CHARS`), `progress.ts` (`reportProgress`, heartbeat), `adtErrorHints.ts` (`classifyAdtError`, error kinds and hints), `adtErrorFormatting.ts` (`formatAdtError`), `argAliases.ts` (`normalizeArgs`), `audit.ts` (JSONL trail), `sourceCache.ts`, `systemProfile.ts` (platform and unavailable toolsets), `sqlReflow.ts`, `runFresh.ts`, `apiReleases.ts`, `oauth.ts`, `browserLogin.ts`, `cookieHttpClient.ts`, `tls.ts`, `httpTransport.ts`, `logger.ts`, plus the parsers and walkers behind single tools (`methodSource.ts`, `packageWalk.ts`, `textSearch.ts`, `dumpParsing.ts`, `htmlText.ts`, `abapgitExport.ts`). |
| `src/types/tools.ts` | `ToolDefinition` and `ToolAnnotations`. |
| `src/__tests__`, `src/lib/__tests__`, `src/handlers/__tests__` | Jest suites: dispatcher, catalog contract, prompts, HTTP transport, the manifest, most lib modules (policy, lock ledger, response sizing, progress, aliases, audit, hints, formatting, systems, TLS, SQL reflow, source cache, system profile, API releases, run-fresh, method source, package walk, cookie client, HTML text) and handler suites with a stubbed client. |
| `scripts/gen-tools-docs.js` | Generates `docs/TOOLS.md` and `docs/tools.snapshot.json` from the built server and syncs the tool counts in `README.md`, `skills/abap-adt-mcp-setup/SKILL.md` and `.claude-plugin/plugin.json`. |
| `docs/` | `TOOLS.md` (generated), `tools.snapshot.json` (generated, contract-tested), `tool-notes.json` (curated usage notes merged into TOOLS.md), `ARCHITECTURE.md`, `CONFIGURATION.md`, `WORKFLOWS.md`, `HOSTS.md`, `CLOUD.md`, `TROUBLESHOOTING.md`, `AUTH.md`, `ROUTING.md`, `TESTPLAN.md`, `FIELD-NOTES.md`, `ROADMAP.md`, `IMPROVEMENTS.md`, `agents.template.md` (a starting point for a project's agent instructions). |
| `skills/` | The two agent skills, `abap-adt-mcp` and `abap-adt-mcp-setup`; `.claude-plugin/plugin.json` is the plugin manifest that ships them. |
| `server.json` | MCP registry manifest; `package.json` holds the npm metadata (`mcpName` ties the two together); `Dockerfile` the two-stage image. |
| `.github/workflows/ci.yml`, `release.yml` | Tests on three Node versions, docs freshness, version agreement, Docker smoke test; tag-driven publish to npm and GHCR. There is no other file under `.github/`, no PR template, no issue templates. |

## Adding a tool

A tool is a schema in a handler's `getTools()`, a `case` in that handler's `handle()`, a route and an annotation in the manifest, policy coverage when it writes, a unit test, regenerated docs and a usage note. Miss the manifest or the docs and the contract test tells you.

### 1. Pick or create the handler

Add the tool to the handler whose domain it belongs to. A new domain means a new class in `src/handlers/` extending `BaseHandler`, a new key in `HANDLER_KEYS`, an entry in the `HandlerSet` interface, in `buildHandlers()` and in `allDomainTools()` in `src/index.ts` (the `_handlerSetCheck` line fails to compile until the manifest and the interface agree), and a place in one of the `TOOLSETS` (`toolManifest.test.ts` checks that every handler key belongs to a toolset). Prefer an existing handler; every handler key today, its class and its toolset:

| Handler key | Class | Toolset |
|---|---|---|
| `auth` | `AuthHandlers` | `core` |
| `transport` | `TransportHandlers` | `transports` |
| `object` | `ObjectHandlers` | `objects` |
| `class` | `ClassHandlers` | `objects` |
| `codeAnalysis` | `CodeAnalysisHandlers` | `analysis` |
| `objectLock` | `ObjectLockHandlers` | `source` |
| `objectSource` | `ObjectSourceHandlers` | `source` |
| `objectDeletion` | `ObjectDeletionHandlers` | `objects` |
| `objectManagement` | `ObjectManagementHandlers` | `objects` |
| `objectRegistration` | `ObjectRegistrationHandlers` | `objects` |
| `node` | `NodeHandlers` | `objects` |
| `discovery` | `DiscoveryHandlers` | `discovery` |
| `unitTest` | `UnitTestHandlers` | `tests` |
| `prettyPrinter` | `PrettyPrinterHandlers` | `source` |
| `git` | `GitHandlers` | `git` |
| `ddic` | `DdicHandlers` | `data` |
| `serviceBinding` | `ServiceBindingHandlers` | `services` |
| `query` | `QueryHandlers` | `data` |
| `feed` | `FeedHandlers` | `runtime` |
| `debug` | `DebugHandlers` | `debugger` |
| `rename` | `RenameHandlers` | `refactoring` |
| `atc` | `AtcHandlers` | `atc` |
| `trace` | `TraceHandlers` | `traces` |
| `refactor` | `RefactorHandlers` | `refactoring` |
| `revision` | `RevisionHandlers` | `source` |
| `rapGenerator` | `RapGeneratorHandlers` | `rap` |
| `navigation` | `NavigationHandlers` | `objects` |
| `textElements` | `TextElementHandlers` | `source` |
| `search` | `SearchHandlers` | `objects` |
| `cloud` | `CloudHandlers` | `analysis` |
| `snippet` | `SnippetHandlers` | `analysis` |

(`buildHandlers()` in `src/index.ts` is the source of the class column; `TOOLSETS` in `src/toolManifest.ts` the source of the toolset column.)

### 2. Write the schema

`getTools()` returns `ToolDefinition` objects. Conventions the existing tools follow:

- **Names** are lowerCamelCase verbs or nouns that read like the ADT operation (`getObjectSource`, `createAtcRun`, `transportRelease`). The name is the public API: renaming breaks prompts and skills, which is why the dispatcher tolerates argument aliases instead of tool aliases.
- **Parameters** reuse the names that already exist for the same concept: `objectSourceUrl` for a `/source/main` URL, `objectUrl` for the bare object URL, `objSourceUrl` where inherited tools use it, `transport` on write tools, `transportNumber` on transport tools, `packageName`, `clas`, `methodName`, `ddicEntityName`, `sqlQuery`. New parameters that fit an alias group in `src/lib/argAliases.ts` should use the group's canonical name so `normalizeArgs` keeps working; extend `GROUPS` only for a genuinely new concept.
- **Every parameter has a `description`**, as house style, and **optional parameters** carry `optional: true` and stay out of `required`. The two are independent and both need to be set by hand: `optional: true` is read by nothing in the server (it exists in the `ToolDefinition` type for humans reading the schema) and is checked by no test, while `required` is the actual JSON-Schema field MCP hosts honor. The catalog contract test (`toolCatalog.test.ts`) checks that `def.type` is set and any `enum` is non-empty for every parameter of every tool, that every name listed in `required` exists in `properties`, and, narrowly, not universally, that `description` is set for every parameter of `getObjectSource`, `editObjectSource`, `setObjectSource` and `debuggerStep` specifically. A missing description on any other tool fails review, not CI, so write one anyway.
- **Descriptions** say when to use the tool, what comes back and what to do next, in the tone of the existing ones: `getObjectSource` explains the paging (`hasMore`, `startLine`) and `version=inactive`; `setObjectSource` says it locks, writes and unlocks by itself and points at `editObjectSource`, `setMethodSource` and `objectDiff`. Name the related tools; the model reads only this text. Put pitfalls learned in the field here, not in a comment.
- **Enums** for closed value sets (`version`, `include`, `steptype`), never free strings the handler then validates by hand.
- **Examples** for URL and name-style parameters come from `PARAM_EXAMPLES` in `src/index.ts` (`objectUrl`, `objectSourceUrl`, `objSourceUrl`, `classUrl`, `transport`, `transportNumber`, `objtype`, `packageName`, `methodName`, `sqlQuery` and others) and are attached by `withDestination()` to every parameter of that name. The `ToolDefinition` property type has no `examples` field, so add an entry to `PARAM_EXAMPLES` for a new parameter name that agents are likely to get wrong.
- **Titles** are derived from the name by `titleFromName` (`getObjectSource` becomes "Get Object Source"); the type has no `title` field, so pick a name whose derived title reads well.
- Do not add a `destination` parameter; `withDestination()` injects it with the configured names as `enum`.

### 3. Implement `handle()`

Route the command in the `switch` of `handle()`, throw `McpError(ErrorCode.MethodNotFound, ...)` in the `default`, and put the body in a `handleXxx(args)` method (`handleGetObjectSource`, `handleEditObjectSource`). Inside:

- Validate arguments early and throw `McpError(ErrorCode.InvalidParams, ...)` with a message that tells the model how to fix the call (`editObjectSource needs either "replacements" (array of {oldText, newText}) or the line-range trio startLine/endLine/newText`).
- Wrap the ADT call in `try/catch`; rethrow `McpError` unchanged and convert everything else with `this.formatAdtError(error)` into an `McpError(ErrorCode.InternalError, 'Failed to <verb>: ...')`. `formatAdtError` recovers the real SAP exception text when abap-adt-api only reports a status code; the dispatcher's `handleError` then adds `kind`, `httpStatus`, `hint` and `nextTools` from `classifyAdtError`. If your tool produces a new failure mode worth a hint, add a kind to `AdtErrorKind` and its entry to `HINTS` in `src/lib/adtErrorHints.ts` with a test.
- Writes that need a lock go through `withLock(this.adtclient, objectUrl, args.lockHandle, async (handle) => ...)` from `src/lib/lockLedger.ts`, as the source writes, `deleteObject`, `createTestInclude`, `atcApplyQuickfix` and `runSnippet` do today. It reuses an explicit or recorded handle, otherwise switches the session to stateful, locks, runs your function, unlocks (also on failure) and reports `lockMode` (`explicit`, `reused`, `auto`) and `unlockError`. Return those fields; the model needs to know when an unlock failed. Use `keepOnSuccess` only when the object no longer exists afterwards (`deleteObject`, the cleanup inside `runSnippet`). Do not lock by hand in new code.
- Anything that can be large (source, rows, findings, lists) is built through `shrinkToFit(initialCount, (count, capped) => payload)` from `src/lib/responseSizing.ts`, which shrinks the page until the serialized payload fits `SAFE_OUTPUT_CHARS` (`MCP_MAX_RESPONSE_CHARS`, default 40,000, minimum 5,000). Add `capped: true` and a `note` telling the model how to continue (`startLine`, `maxRows`, a filter) when `capped` is set; `buildPagedSourcePayload` in `ObjectSourceHandlers.ts` is the pattern.
- Calls that take more than a few seconds report steps with `reportProgress(message, progress, total)` from `src/lib/progress.ts` (`SnippetHandlers` reports steps 1 to 3 of 4: created, written, activated). It is a no-op when the client sent no `progressToken`; when one was sent, the dispatcher also emits a "still running" heartbeat every ten seconds on its own.
- When the tool needs an ADT endpoint `abap-adt-api` does not wrap, call it directly through `this.adtclient.httpClient.request(path, { method, headers, qs?, body? })`, which resolves to `{ status, body, headers }` and rejects with `abap-adt-api`'s own exception when the status is 400 or more, so wrap it in `try`/`catch` (checking `res.status` as well costs nothing and is what `CloudHandlers` does). `apiReleaseState` (`CloudHandlers.ts`), `dumpDetails` (`FeedHandlers.ts`), `sourceTextSearch` (`SearchHandlers.ts`) and the DEVC/K package-creation call inside `createObject` (`ObjectRegistrationHandlers.ts`) are existing examples. Stub the same call in a handler test by giving the fake client an `httpClient: { request: jest.fn(async () => ({ status: 200, body: '<xml .../>', headers: {} })) }` (see `CloudSnippetHandlers.test.ts`, `FeedHandlers.test.ts`, `SearchHandlers.test.ts`).
- Build and return the MCP content shape yourself: `{ content: [{ type: 'text', text: JSON.stringify({ status: 'success', ... }) }] }`. That is the convention every existing `handleXxx` follows, not an exception to reach for occasionally: none of the handlers in `src/handlers/*.ts` return a bare object from a top-level `handleXxx` method today. `serializeResult` in the dispatcher (`src/index.ts`) does accept a bare object too and wraps it the same way, but that path exists for the server's own tools (`listSystems`, `healthcheck`, `systemProfile`, none of which go through a handler) and as a fallback, not as the pattern to write new handler code against. Writing the wrapper yourself also means the shape your unit test asserts on (`r.content[0].text`, see step 6) is exactly what `handle()` returns, with nothing left to the dispatcher.
- Use `this.logger` (stderr, JSON) for diagnostics; never `console.log`, which corrupts the stdio protocol.

#### A minimal read-only tool, start to finish

`listLocks` (in `src/handlers/ObjectLockHandlers.ts`) is the smallest complete example: no parameters, one line of logic, nothing to lock or activate.

The imports every handler file needs, plus what `BaseHandler` gives you for free:

```ts
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
```

`BaseHandler`'s constructor takes the shared client (`constructor(adtclient: ADTClient)`) and every subclass calls it implicitly through `extends BaseHandler`; it exposes `this.logger` (a per-class stderr JSON logger from `createLogger`) and `this.formatAdtError(error)`. `ObjectLockHandlers` additionally imports the lock ledger it needs: `import { recordLock, forgetLock, listLocks, releaseAll, clearLedger } from '../lib/lockLedger.js';`.

The schema, one entry from `getTools()`:

```ts
{
  name: 'listLocks',
  description: 'List the ADT locks this server currently holds on the destination (object, lockHandle, when, whether acquired automatically). Use it when a write fails with a lock/lockHandle error or before forceUnlock.',
  inputSchema: { type: 'object', properties: {} }
}
```

The `case` in `handle()`:

```ts
case 'listLocks':
  return this.handleListLocks();
```

And the body, no `try/catch` needed because `listLocks()` from the lock ledger cannot throw:

```ts
async handleListLocks(): Promise<any> {
  const locks = listLocks(this.adtclient);
  return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', count: locks.length, locks }) }] };
}
```

`listLocks` is also in `READ_ONLY_TOOLS` (step 4) and touches no object URL, transport or table argument, so it needs nothing further in `policy.ts` (step 5) beyond that one listing.

### 4. Register in the manifest

In `src/toolManifest.ts`:

- add the name to the handler's list in `TOOL_ROUTES`, which also places it in that handler's toolset;
- add it to `READ_ONLY_TOOLS` if it never changes SAP state, or to `DESTRUCTIVE_TOOLS` if it can destroy or overwrite work (source writes, deletes, releases, refactoring executes, `runClass`, `runSnippet`, `forceUnlock`), or to neither for recoverable writes such as `createObject` or `lock`. `toolAnnotations` derives `readOnlyHint`, `destructiveHint` and `idempotentHint` from these sets (and `openWorldHint` for `apiReleaseState`, which downloads from GitHub); hosts use them to decide what to ask the user about, so be honest. A tool in both sets fails `src/lib/__tests__/toolManifest.test.ts`.

### 5. Policy coverage for writes

`src/lib/policy.ts` decides before any SAP call. A write tool must be reachable by the gates:

- `readOnly` refuses everything outside `READ_ONLY_TOOLS` and `ALWAYS_ALLOWED` (`login`, `logout`, `dropSession`, the three server tools `listSystems`/`healthcheck`/`systemProfile`, and `exportPackageSources`), so step 4 already covers it;
- `allowedPackages` needs to find the target package: add the tool to `OBJECT_URL_ARGS` (which argument holds the object URL; the package is then resolved through `transportInfo` and memoized per destination), handle it explicitly in `evaluatePolicy` when the package comes from somewhere else (`createObject`, `runSnippet`, `activatePackage`, `activateObjects`), or list it in `UNRESOLVABLE_WRITES` if the package cannot be derived, which refuses it in closed mode;
- `allowedTransports` needs the argument that carries the transport in `TRANSPORT_ARGS`;
- `deniedTables` inspects `sqlQuery`, `ddicEntityName` and, best effort, the ABAP text of `runSnippet`, `setObjectSource` and `setMethodSource`; extend it if your tool reads tables through another parameter.

A plain read tool that takes none of those (no object URL argument named in `OBJECT_URL_ARGS`, no transport argument, no `sqlQuery`/`ddicEntityName`) needs nothing beyond `READ_ONLY_TOOLS` in step 4: `allowedPackages` and `allowedTransports` only branch on tool names hardcoded into `evaluatePolicy`, `OBJECT_URL_ARGS` and `TRANSPORT_ARGS`, and `deniedTables` only inspects the parameters named above, so a tool matching none of them passes every gate unconditionally, `listLocks` above is exactly this case. Add a case to `src/lib/__tests__/policy.test.ts` only for the gate(s) you actually touched; there is nothing to test for a tool that touches none.

Tools that create, delete, rename or move objects also belong in `PACKAGE_CACHE_INVALIDATORS` in `src/index.ts`, so the objectUrl-to-package memo is not stale afterwards.

### 6. Unit test with a stubbed client

Handler tests never talk to SAP. They build the handler with a hand-made client object whose methods are `jest.fn` stubs and assert on calls and results; `src/handlers/__tests__/ObjectSourceHandlers.test.ts` shows the shape:

```ts
const URL = '/sap/bc/adt/oo/classes/zcl_demo/source/main';

function makeHandler(initialSource: string) {
  const client: any = {
    stateful: 'stateless',
    source: initialSource,
    getObjectSource: jest.fn(async () => client.source),
    setObjectSource: jest.fn(async (_url: string, source: string) => { client.source = source; }),
    lock: jest.fn(async () => ({ LOCK_HANDLE: 'AUTO1' })),
    unLock: jest.fn(async () => undefined),
    activate: jest.fn(async () => ({ success: true, messages: [] }))
  };
  return { client, handler: new ObjectSourceHandlers(client) };
}

const parse = (r: any) => JSON.parse(r.content[0].text);
const res = parse(await handler.handle('editObjectSource', { objectSourceUrl: URL, startLine: 2, endLine: 3, newText: 'B', lockHandle: 'LH' }));
```

`r.content[0].text` works because `handle()` returns the `{ content: [...] }` shape the handler built itself (see step 3); nothing between the test and the handler wraps it further. Cover the happy path, each `InvalidParams` branch, the lock behaviour with and without `lockHandle`, and the `capped` output for paged tools. Dispatcher behaviour (policy, toolsets, retries) is tested in `src/__tests__/dispatch.test.ts` by replacing `dest.handlers[handlerKey].handle` with a `jest.fn`; add a case there when you change `src/index.ts`. Tests that load `src/index.ts` (`dispatch`, `toolCatalog`, `httpTransport`) start with `jest.mock('puppeteer-core', () => ({}))` so the suites never load the real browser package.

### 7. Regenerate the docs and add a usage note

Run `npm run tools:docs` **before** `npm test`, not after, if you touched a tool's schema, name, or annotations. `npm test` runs `src/__tests__/toolCatalog.test.ts`, and its last case compares the live catalog against the committed `docs/tools.snapshot.json`, for a new or changed tool that snapshot is stale until you regenerate it, so `npm test` fails first with `matches docs/tools.snapshot.json (run npm run tools:docs after changing tools)`. That failure is expected, not a sign something is wrong with your change; run `npm run tools:docs` and test again. CI (`.github/workflows/ci.yml`) runs build, type-check, `npm test`, then a separate docs-freshness step, so it hits the same failure for the same reason.

`npm run tools:docs` rebuilds, regenerates `docs/TOOLS.md` and `docs/tools.snapshot.json`, and rewrites, in `README.md`: the `exposes **N tools**` count, the `## Tool catalog (all N tools, by toolset)` heading (its anchor moves with it, since GitHub derives anchors from headings), the `` `focused` = N development tools `` count, and the toolset table itself, the rows between the `| Toolset | In \`focused\` | Tools |` header and the next blank line, each with its own `(N)` count and full tool list. It does **not** touch the "Destructive tools" paragraph that follows the table (a hand-written, comma-separated list of tool names) or the "Compared with SAP's official ADT MCP Server" section: update those by hand when a tool becomes destructive, stops being destructive, or gains an equivalent in SAP's official server. Commit everything the generator touched: `src/__tests__/toolCatalog.test.ts` compares the live catalog (names, count, read-only and destructive flags, required parameters) with the snapshot, and CI runs `git diff --exit-code` on the generated files.

Then add an entry for the tool in `docs/tool-notes.json`, keyed by tool name. Every field is a plain string except `seeAlso`, an array of existing tool names; `pitfalls` is the only one of the four ever omitted in practice (14 of the 173 current entries skip it, mostly discovery tools with nothing sharp to say), and the generator treats a missing entry entirely as fine, so nothing enforces the shape beyond what you write. A real entry, verbatim from `docs/tool-notes.json`:

```json
"activateByName": {
  "when": "Activate one object after a write that did not use activate=true (or after createObject plus setObjectSource). RAP stacks whose objects depend on each other belong to activatePackage.",
  "returns": "`{success, messages: [{objDescr, type, line, href, forceSupported, shortText}], inactive: [...]}`; read `messages` even when `success` is true, warnings show up there.",
  "pitfalls": "`objectName` is the object name (ZCL_EXAMPLE) and `objectUrl` the object URL (no /source/main). Activation of a class activates all its includes. Run unitTestRun afterwards.",
  "seeAlso": ["activatePackage", "activateObjects", "setObjectSource", "unitTestRun"]
}
```

The generator merges these into the "Tool details" section of `docs/TOOLS.md`, and they survive regeneration, unlike anything typed into `TOOLS.md` by hand. If the tool changes a workflow, update the `instructions` text in `src/index.ts`, the relevant skill under `skills/`, `docs/WORKFLOWS.md` and, when SAP's official server has an equivalent, `docs/ROUTING.md`.

The `CHANGELOG.md` entry itself is the maintainer's job, not yours: every existing entry is headed `## [X.Y.Z] - YYYY-MM-DD - <theme>` (see [Release process](#release-process)); this repository's history has no `## [Unreleased]` section, and a contributor cannot know X.Y.Z in advance since the version bump happens at release time. Instead, put the one-line, backtick-quoted bullet you would want in the changelog into your pull request description; the maintainer folds it into the entry for the release that ships it.

## Adding a prompt

Prompts live in `PROMPTS` in `src/prompts.ts` as `{ name, title, description, arguments, render }`. `arguments` lists `{ name, description, required }`; `render(args)` returns the instruction text and every step names a real tool with the real parameter names, in the style of `safe-edit` and `review-transport`. Keep `destination` optional and use the `dest(a)` helper so the text falls back to "the destination from listSystems".

`src/__tests__/prompts.test.ts` checks the exact list of names (six today), that required arguments are enforced by `getPrompt`, and that every `toolName(` mentioned in a rendered prompt exists in `docs/tools.snapshot.json`; extend the expected name list and the sample arguments when you add one. Document the prompt in the README section [Built-in prompts](README.md#built-in-prompts) and in `docs/WORKFLOWS.md`.

## Coding conventions

- TypeScript with `strict: true`, CommonJS output, ES2016 target. Keep `any` at the edges where abap-adt-api's own types are loose (`args: any` in `handle`), type everything you create, and prefer small exported functions in `src/lib` that can be tested without a client.
- Errors that the model should read are `McpError`s with the right `ErrorCode`: `InvalidParams` for bad arguments, `InvalidRequest` for refused calls (policy, platform gate, a stale `expectedText`, an ambiguous method), `MethodNotFound` for unknown or disabled tools, `InternalError` for SAP failures wrapped with `formatAdtError`. Messages say what to do next, not only what went wrong.
- Never log or return secrets. `redactSecrets` in `src/index.ts` scrubs `Authorization` headers, cookies, `password=` and `client_secret=` fragments and `user:pass@` URLs from every error text and from the audit summary, and `audit.ts` blanks argument keys matching `SECRET_KEYS` (`pass`, so `password` and `passphrase`, plus `secret`, `token`, `authorization`, `cookie`, `lockhandle`); both are pattern-based, so do not add code paths that echo `password`, `clientSecret`, bearer tokens or `MCP_HTTP_TOKEN` in other shapes, and keep `listSystems` free of credential material (TESTPLAN 1.14 and 2.10 check exactly that).
- Everything diagnostic goes to stderr through `createLogger` or `console.error` prefixed `[abap-adt-mcp]`; stdout belongs to the JSON-RPC stream.
- Calls to SAP for one destination are serialized by the dispatcher's queue; do not add your own locking or shared mutable state across destinations. Per-client caches use a `WeakMap` keyed by the `ADTClient` (see `lockLedger.ts`, `sourceCache.ts`).
- Stateful versus stateless sessions matter: locks need `session_types.stateful`; a class run after a write needs a fresh load (`runFresh.ts`). Read the comments there before touching session handling.
- No new runtime dependencies without a reason in the pull request; the package starts through `npx` on many machines. `puppeteer-core` must remain lazily loaded.
- Docs and comments are in English, GitHub-flavored Markdown, without customer names, tenant hostnames, transport numbers or business object names; use `ZCL_EXAMPLE`, `DEVK900123`, `myXXXXXX`.

## Commit messages

The history uses a conventional prefix with an optional scope: `feat(source): ...`, `fix(errors): ...`, `docs: ...`, `test(search): ...`, `ci(release): ...`, `build: ...`, `chore(registry): ...`. The subject is imperative and lower case after the prefix. Keep it under about 80 characters where you can; 18 of the current 108 subjects do not, so this is a preference, not a gate, and says what changed and why when the why is not obvious (`fix: keep the release repository cache out of tests`). Group unrelated changes into separate commits; one commit per tool or fix reviews better than one commit per file.

Scopes are short, free-text topic words picked per commit, not a required handler, toolset or file name to match against, the history uses `source`, `errors`, `search`, `registry`, `http`, `locks`, `atc`, `sso`, `run`, `security`, `bindings`, `class`, `refactor`, `rename`, `unit` and `transports` among others, and plenty of commits (most `docs:`, `chore:`, `test:` and `build:` ones) carry no scope at all. Pick whatever short word names the area you touched; there is no fixed list.

## Pull request checklist

Before you open the pull request, run locally what CI runs, with one deliberate difference from CI's order: regenerate the docs before you test, not after, or a new tool's expected `toolCatalog.test.ts` failure will look like a bug instead of the reminder it is (see step 7 of [Adding a tool](#7-regenerate-the-docs-and-add-a-usage-note)):

```bash
npm ci && npm run build
npx tsc --noEmit -p tsconfig.test.json
npm run tools:docs                         # regenerate before testing if a tool changed
npm test -- --coverage=false
git status --short                         # nothing generated should be left uncommitted
```

Then confirm:

- [ ] New or changed tools are routed in `TOOL_ROUTES`, annotated in `READ_ONLY_TOOLS` or `DESTRUCTIVE_TOOLS` when applicable, and covered in `policy.ts` if they write.
- [ ] Writes use `withLock`; large answers use `shrinkToFit`; long calls report progress.
- [ ] Unit tests added or extended; no test needs a live SAP system.
- [ ] `docs/TOOLS.md`, `docs/tools.snapshot.json`, README counts and `docs/tool-notes.json` updated (regenerated, not hand-edited, per step 7).
- [ ] The pull request description includes the one-line changelog bullet you'd want in `CHANGELOG.md`; the maintainer adds it to the entry for the release that ships the change (see step 7).
- [ ] Descriptions, `instructions`, skills and prompts still name tools and parameters that exist.
- [ ] No secrets, hostnames, customer names or transport numbers in code, tests, fixtures or docs.
- [ ] `package.json` version untouched unless the pull request is the release itself.
- [ ] The pull request description says what was verified live, if anything, and on which platform (S/4HANA Cloud or on-prem), without identifying the tenant, or says plainly that no development system was available, so a maintainer knows to run that layer before merging (see [Live checks](#live-checks-against-a-real-system)).

Small, focused pull requests merge faster; open an issue first when unsure whether a change fits ([docs/ROADMAP.md](docs/ROADMAP.md) lists what is planned).

## Live checks against a real system

Unit tests prove the server speaks MCP and behaves under stubbed answers; only a real ADT backend proves a tool works. [docs/TESTPLAN.md](docs/TESTPLAN.md) is the live plan, in layers: Layers 0 and 1 are automated (`npm test` plus a scripted stdio or HTTP client against `dist/index.js` with dummy destinations); Layer 2 reads from a development system; Layer 3 writes, confined to a throwaway package and a throwaway object; Layer 4 is the host integration (Claude Desktop). Run the layer your change touches and record the result in the pull request.

Layers 0 and 1 need no SAP system and CI already runs them on every pull request; if you have no development destination for Layers 2 through 4, say so plainly in the pull request description ("no development system available") rather than guessing what a live run would show. A maintainer runs the layer your change needs before merging.

Rules for live runs:

- **Never a production system, never a customizing or test tenant with real data.** Use a development destination, and give it a policy while you test: `"allowedPackages": ["$*", "ZADT_TEST*"]` and `"deniedTools": ["transportRelease", "transportDelete", "gitPullRepo"]` in `systems.json` make the server itself refuse anything outside the sandbox (see [Keeping it safe](README.md#keeping-it-safe) and [docs/CONFIGURATION.md](docs/CONFIGURATION.md)). `MCP_READ_ONLY=1` for Layer 2.
- **Throwaway objects only.** Create in `$TMP` or a local test package such as `ZADT_TEST`, name objects so they are obviously disposable (`ZCL_MCP_TESTPLAN`), never touch pre-existing objects, and delete everything at the end (TESTPLAN 3.6). Some S/4HANA Cloud tenants refuse `$TMP` with S_ABPLNGVS; then use a customer test package and a transport you own, and never release it.
- **Do not call** `rapGenGenerate`, `transportRelease`, `pushRepo` or `forceUnlock` on objects you did not create during the run.
- **Record the evidence** with `MCP_AUDIT_FILE` set: one JSONL line per call with tool, destination, duration, outcome (`ok`, `error`, `denied`, `unavailable`), policy gate, error kind, whether the call was retried and a redacted argument summary. Attach the relevant lines to the pull request after checking they contain no hostnames.
- **Prefer stdio** through `npm run dev` or a scripted client over a host, so failures are reproducible; test the host (Layer 4) last. Authentication for the test destination follows [docs/AUTH.md](docs/AUTH.md).

When a live run finds a bug, capture the tool's error JSON verbatim (it carries `kind`, `httpStatus`, `hint` and `nextTools`), fix, and re-run the layer from its start.

## Field reports

Sessions with real users are the best test the project has; two of them, run on the 0.3.1 build, produced the whole 0.3.3 release. [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md) collects them and its last section, "How to produce a useful report", is the template:

1. Run the session with `MCP_AUDIT_FILE` set.
2. At the end ask the agent for every failed or repeated call with its exact arguments and error text, what it did next and whether the description or schema misled it; wasted calls; truncated answers; steps done by hand that a tool should have done; practical limits found; and a closing table of tools, calls and failures.
3. Anonymise before you submit: no customer names, no tenant hostnames (`my4xxxxx`), no transport numbers, no business object names, no user ids. Replace them with `ZCL_EXAMPLE`, `DEVK900123`, `myXXXXXX` or a plain description ("a draft-enabled RAP object"). Keep the tool names, parameters and error texts exact; they are what we need.
4. Open an issue titled `field report: <task in five words>` with the table, or a pull request that adds a `## Session X, <version>: <task> (<calls>, <failures>)` entry to `docs/FIELD-NOTES.md` in the same two-column format (Finding, Fixed in). Note the platform (S/4HANA Cloud or on-prem) and the server version from `healthcheck`.

Positive findings are welcome too; they tell us which descriptions work.

## Release process

Releases are tag-driven and published by `.github/workflows/release.yml`. The maintainer does the following from `main` (the short form is in [docs/ROADMAP.md](docs/ROADMAP.md)):

1. **Bump the version in four files** to the same value: `package.json`, `package-lock.json` (`npm version --no-git-tag-version X.Y.Z` updates both), `server.json` (both `version` and `packages[0].version`) and `.claude-plugin/plugin.json`. CI fails when `package.json` and `server.json` disagree, and the release job refuses a tag that differs from them.
2. **Write the CHANGELOG entry** `## [X.Y.Z] - YYYY-MM-DD - <theme>` with one bullet per user-visible change, tool names in backticks and the new tool count when it changed. This is where the changelog bullets contributors put in their pull request descriptions (see step 7 of [Adding a tool](#7-regenerate-the-docs-and-add-a-usage-note)) get folded in.
3. **Regenerate the docs** with `npm run tools:docs`; the version appears in the header of `docs/TOOLS.md` and in `docs/tools.snapshot.json`.
4. **Run the full check** (`npm ci`, build, test type-check, `npm test`, `npm pack --dry-run` to confirm no `__tests__` in the tarball) and commit as `chore(release): X.Y.Z`.
5. **Tag and push**: `git tag vX.Y.Z && git push origin main --tags`.
6. The workflow verifies the tag against the version files, runs the tests, the docs check and the tarball check, then publishes to npm through **trusted publishing**: GitHub's OIDC token (`id-token: write`) is exchanged for a short-lived credential, the workflow references no `NPM_TOKEN` secret, and a provenance attestation is attached (`npm publish --provenance --access public`). The trusted publisher has to be configured on npmjs.com for `williansaez/abap-adt-mcp`, workflow `release.yml`, which is not something the repository can check; the job installs npm 11.5.1 or newer because older CLIs do not support it. It then builds the image and pushes `ghcr.io/williansaez/abap-adt-mcp:vX.Y.Z` and `:latest`.
7. **Update the MCP registry** with `mcp-publisher publish` from the repository root once the npm package is visible; `server.json` is the manifest and its description must stay within the registry's 100-character limit.
8. **Create the GitHub release** for the tag with the CHANGELOG section as body.
9. Verify from a clean directory: `npx -y abap-adt-mcp@X.Y.Z` starts and `healthcheck` reports the new `version`.

Patch releases follow the same path; there is no hotfix branch.

## Code of conduct

Be kind and precise. Reviews discuss code and evidence, never people; disagreement about SAP behaviour is settled with a live check or a unit test, not with volume. The project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) version 2.1; report unacceptable behaviour privately to the maintainer named as `author` in [package.json](package.json), through the GitHub profile behind the repository, and it will be handled confidentially.
