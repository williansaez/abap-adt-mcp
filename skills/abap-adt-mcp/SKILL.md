---
name: abap-adt-mcp
description: Develop ABAP through the abap-adt-mcp MCP server (server key `abap-adt-mcp`): read, search, edit, activate, test, check and transport ABAP objects on S/4HANA Cloud and on-prem systems. Use whenever a task touches ABAP code, CDS, RAP, transports, ATC, unit tests, dumps or abapGit and the abap-adt-mcp tools are available.
---

# ABAP development with abap-adt-mcp

Tool names below are the real names published by the server (`mcp__abap-adt-mcp__<tool>` in Claude Code). They are not the SAP official ADT MCP server names; see `docs/ROUTING.md` in the repository for the mapping.

## Start of every session
1. `listSystems`: pick the `destination` (every tool takes it; omit only when a default is configured). Each entry shows its `policy` (readOnly, allowedPackages, ...). Never write to a destination whose name or policy says production.
2. `systemProfile(destination)` once per unfamiliar system: tells whether it is S/4HANA Cloud or on-prem and which toolsets are unavailable there (on the tested S/4HANA Cloud tenant only the RAP generator was missing; debugger, traces and abapGit depend on the tenant and authorizations). Tools of missing toolsets are refused before calling SAP (the profile is built on the first call of such a toolset; `MCP_PROFILE_GATE=warn|off` relaxes this).

## Finding code (do this before reading whole sources)
- `searchObject(query, objType)` finds objects by name; the result gives the object URL.
- `sourceTextSearch(searchString, packages)` uses the server-side text index; `grepPackage(packageName, pattern, regex?)` greps sources client-side with context lines and works everywhere.
- `usageReferences` / `usageReferenceSnippets` for where-used from a position; `typeHierarchy` for sub/supertypes; `objectStructureElements` for a member outline; `classComponents`/`classIncludes` for class layout.
- Read with `getObjectSource(objectSourceUrl)` (object URL + `/source/main`); large sources page automatically (`hasMore`, `startLine`/`maxLines`). `version=inactive` reads what you wrote before activation.

## Changing code (short flow)
1. `resolveTransport(objSourceUrl)` for objects outside `$TMP`: returns the transport to pass, or `needsTransport:false` for local packages, or asks for `createIfMissing=true`.
2. `syntaxCheckCode` on the intended source when the change is not trivial.
3. Write with `editObjectSource(objectSourceUrl, replacements=[{oldText,newText}], activate=true, transport?)` for targeted changes (each `oldText` must match exactly once; the server re-reads SAP first), or `setObjectSource(objectSourceUrl, source, activate=true, transport?)` for full rewrites. Both lock and unlock by themselves; `lock`/`unLock` are only for holding a lock across several writes, `listLocks`/`forceUnlock` to recover after a failed write.
4. Read the `activation` field of the result: `success:false` lists messages with lines. Fix and write again.
5. `unitTestRun(url)` after every change; tests live in the test include (`createTestInclude`).
6. `createAtcRun` (variant `ABAP_CLOUD_DEVELOPMENT_DEFAULT` on cloud) → `atcWorklists` → `atcQuickfixProposals`/`atcApplyQuickfix` for deterministic fixes; `atcDocumentation(docUri)` explains a finding.

## Creating objects
`loadTypes` → `validateNewObject` → `resolveTransport` (non-local package) → `createObject(objtype, name, parentName, description, parentPath=/sap/bc/adt/packages/<pkg>, responsible on cloud)` → `setObjectSource(..., activate=true)` → `unitTestRun`. Packages: `createObject` with `objtype=DEVC/K` needs `swcomp`.

## ABAP Cloud / Clean Core
- Before using an SAP object in cloud code, `apiReleaseState(names="CL_X, TABL:MARA")` or `apiReleaseState(sourceUrl=...)` to scan a whole source: released / deprecated (with successors) / classicAPI / noAPI. Do not recall release states from memory.
- Try ideas with `runSnippet(code)`: it runs statements in a temporary `IF_OO_ADT_CLASSRUN` class in `$TMP` (`out->write( ... )`) and deletes it.

## Runtime errors and data
- `dumps(from, user, contains)` returns compact dump summaries (error, exception, program, termination point with source URL and line, stack); `dumpDetails(dumpId)` gives the full analysis. This is the root-cause path when the debugger toolset is unavailable on the destination (check `systemProfile`; availability depends on the tenant and the user's authorizations).
- `tableContents(ddicEntityName, rowNumber)` and `runQuery(sqlQuery)` read business data: keep results in the conversation, never copy them to external services; policies may deny tables or free SQL.

## Errors
Every error JSON has `kind`, `hint` and `nextTools`. Follow them: `staleLockHandle` → lock again; `locked` by another user → do not retry the write; `transportRequired` → `resolveTransport`; `policyDenied` → stop, the destination forbids it; `sessionExpired` → the server already re-authenticated and retried once, call `login` if it persists; `notFound` on cloud → `systemProfile`.

## Safety
- Confirm with the user before `deleteObject`, `transportRelease`, `transportDelete`, `forceUnlock(dropSession=true)`, `pushRepo`, `gitUnlinkRepo`.
- Prefer `$TMP` for experiments; prefer `editObjectSource` with `replacements` over full rewrites of large objects.
