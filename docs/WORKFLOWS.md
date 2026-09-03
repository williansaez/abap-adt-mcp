# Workflows

End-to-end development workflows with abap-adt-mcp: the exact tool sequence, the arguments that matter and what each answer contains. The [README](../README.md#workflows-in-detail) has the short version; this document is the long one. Parameter names below are the ones the schemas declare (the full per-tool reference is [docs/TOOLS.md](TOOLS.md)); setup and authentication are in the README and [docs/AUTH.md](AUTH.md); what real sessions taught the server is in [docs/FIELD-NOTES.md](FIELD-NOTES.md).

Conventions used throughout:

- Every tool except `listSystems` and `healthcheck` takes an optional `destination`. It is omitted from the examples; pass it whenever more than one system is configured and none is marked `default` (or named in `SAP_DEFAULT_DESTINATION`); with a single system it is implied.
- **Logging in is implicit.** On SSO destinations the dispatcher performs the browser login before the first call of the session (a browser window opens once; later logins are silent, see [README, Say hello](../README.md#3-say-hello)); `basic` and `oauth` destinations authenticate on their first request. No recipe below starts with `login`. Call `login` explicitly only to force a fresh browser login (it answers `{status: "logged in to <destination> via browser SSO"}`) or, on `basic`/`oauth`, to prove the credentials before doing anything else (`{status: "success", result}`). An expired session is re-authenticated and the failing call retried once; a `sessionExpired` error you still see means the retry failed too, and then `login` is the fix.
- Calls are written as `tool(param=value, ...)`. Arguments that the schema declares as JSON strings (`replacements`, `elements`, `flags`, `properties`, `metaData`, `content`, `range`, `proposal` and `refactoring` among them) may be passed as a string or, on hosts that allow it, as the parsed object. `objects` (for `activateObjects`) must be a JSON string.
- Parameter names are tolerant: the dispatcher maps case variants (`TransportNumber`) and known aliases onto what each tool declares. All URL-shaped names form one alias group (`objectUrl`, `objectSourceUrl`, `objSourceUrl`, `objectUri`, `sourceUrl`, `uri`, `url`, `classUrl`, `mainUrl`, `cdsUrl`, `domainUrl`, `dataElementUrl`), so `resolveTransport(objectUrl=...)` and `resolveTransport(objSourceUrl=...)` are the same call; other groups include `transport`/`transportNumber`, `packageName`/`DEVCLASS`/`parentName`, `description`/`REQUEST_TEXT`, `code`/`source` and `clsInclude`/`include`. Aliases rename parameters; they do not rewrite values. `getObjectSource` strips or appends `/source/main` where the URL needs it (section 2) and the method tools accept a class name or any class URL form (section 2); every other tool takes the URL form its schema names. The names in this document are the canonical ones.
- Placeholders: `ZCL_EXAMPLE` (class), `ZEXAMPLE` (package), `DEVK900123` (transport), `DEVELOPER` (user). Object URLs look like `/sap/bc/adt/oo/classes/zcl_example`; source URLs add `/source/main`; transport URLs are `/sap/bc/adt/cts/transportrequests/DEVK900123`; package URLs `/sap/bc/adt/packages/zexample`.
- Every error is JSON with `error` and `code`; when the server can classify it, `kind`, `httpStatus`, `hint` and `nextTools` are added. The kinds are `policyDenied`, `sessionExpired`, `csrf`, `locked`, `staleLockHandle`, `transportRequired`, `authorization`, `notFound`, `rateLimited`, `ambiguous400` and `serverError` (an unclassified error carries only the message). Follow the hint rather than retrying.

### Your SAP user name

Several tools want your real SAP user: `createObject(responsible)` and `runSnippet(responsible)` on cloud backends, `activatePackage(user)`, `dumps(user)`, `userTransports(user)` and the trace tools. On `basic` destinations the server knows it (the configured `user`). On SSO and OAuth destinations it does not: the ADT client carries a placeholder (`sso`, or the OAuth client id), `systems.json` reads `user` only for `authType: "basic"` (src/lib/systems.ts), and `listSystems` never reports a user for any destination. Where to get it:

| Source | How |
|---|---|
| The browser login | On a logon form served by the SAP system itself you type the SAP user; behind an identity provider the name you type is the IdP user, which need not be the SAP business user. |
| A transport you own | `resolveTransport(objSourceUrl=<any object of your package>)`: `candidates[].owner` lists the owner of the modifiable requests of the current user; `transportDetails(transportNumber)` shows the owner of one request. |
| An object you changed | `revisions(objectUrl)` lists `author` per revision; `objectStructure(objectUrl)` returns `structure.metaData["adtcore:changedBy"]` and `["adtcore:responsible"]`. |
| Your dumps | Every `dumps` summary carries `user`. |
| On-prem development system | `runSnippet(code="out->write( sy-uname ).")` prints it. On S/4HANA Cloud `runSnippet` itself needs `responsible`, so it cannot be the first step there. |

## 1. Orientation on an unknown system

Goal: know which destinations exist, what each backend can serve, and where the code you care about lives.

| Step | Call | What comes back |
|---|---|---|
| 1 | `listSystems()` | `systems`: one entry per destination with `destination`, `url`, `client`, `authType`, the `policy` summary and `tls` when configured (no credentials, no user), plus `platform` and `unavailableToolsets` once a profile has been built; top level `default` (the destination used when you omit it) and `activeToolsets`. Pick the destination name you will pass everywhere else. |
| 2 | `systemProfile(refresh=false)` | `platform` (`cloud`, `onprem`, `unknown`) with `platformReason`, `systemInformation`, the number of ADT `collections`, a `features` map (`debugger`, `traces`, `abapGit`, `atc`, `rapGenerator`, `serviceBindings`, `textSearch`, `apiReleases`, `feeds`, `dataPreview`, `unitTests`, `refactorings`, ...) and the derived `unavailableToolsets` and `unavailableTools`. Cached per destination; `refresh=true` rebuilds it. |
| 3 | `packageTree(packageName="ZEXAMPLE", maxDepth=2, objectTypes="CLAS/OC,INTF/OI,DDLS/DF")` | `packages` and `objects` counts, `byType`, `objectsTruncated`, and `tree`: sub-packages to `maxDepth` (default 2, `0` = root only) with each object's name, type, URL and description. `maxObjects` defaults to 500. A tree too large for one response comes back as a flat paged `list` with a note to narrow with `objectTypes` or `maxDepth`. |
| 4 | `searchObject(query="ZCL_EXAMPLE*", objType="CLAS/OC", max=20)` | `results`: `adtcore:name`, `adtcore:type`, `adtcore:uri`, `adtcore:packageName`, description. The `adtcore:uri` is the object URL every other tool accepts. |
| 5 | `findObjectPath(objectUrl="/sap/bc/adt/oo/classes/zcl_example")` | `path`: the package chain from the root down to the object, for objects found by name whose package you do not know. |
| 6 | `nodeContents(parent_type="DEVC/K", parent_name="ZEXAMPLE", startIndex=0, maxItems=200)` | The raw repository tree node (`nodeContents.nodes` with `OBJECT_TYPE`, `OBJECT_NAME`, `OBJECT_URI`; `result.nodes` plus `totalItems`/`hasMore` when paged). Use it when you need something `packageTree` filters out, such as function groups (`FUGR/F`) whose members live under the group node (`nodeContents(parent_type="FUGR/F", parent_name="ZFG")`). |

Why `systemProfile` first: tools of a toolset whose ADT collection the backend does not expose are refused before any SAP call (`MCP_PROFILE_GATE=enforce`, the default; `warn` only logs, `off` disables the gate). The profile is built automatically on the first call of a gated toolset, so calling it yourself only saves you a surprise. On the tested S/4HANA Cloud tenant only `rap` was missing; `debugger`, `traces` and `git` depend on the tenant and the user's authorizations.

`healthcheck()` is the server-side view (version, destinations, active toolsets, tool count). A refusal saying "belongs to toolset ... which is not enabled" comes from `MCP_TOOLSETS` (the `focused` preset leaves out `debugger`, `traces`, `git`, `rap`, `services`, `refactoring` and `discovery`); "not available on destination" is the platform gate.

## 2. Reading code efficiently

### Whole sources, paged

`getObjectSource(objectSourceUrl="/sap/bc/adt/oo/classes/zcl_example/source/main")` returns `source`, `totalLines`, `startLine`, `returnedLines` and `hasMore`. Omit `startLine`/`maxLines` and the server returns as much as fits the response budget (about 40,000 characters, `MCP_MAX_RESPONSE_CHARS`); larger sources are paged automatically (`autoPaged: true`) and you continue with `startLine=<last returned line + 1>`. When a requested range is still too big it is shrunk and flagged `capped: true` with a `note`. The server always downloads the whole source and caches it before paging, so a paged read still leaves the complete text in the session cache (see below).

`version` selects what you read: omit it to get what ADT serves by default (the inactive version when one exists, otherwise the active one), `active` to force the activated version, `inactive` to require the unactivated one (fails when there is none); `workingArea` is the third value the schema accepts. Read `version=inactive` to verify what you wrote before activating.

Two URL rules from FIELD-NOTES the server now applies for you: a `/source/main` appended to a class include URL is stripped (includes are read as `classIncludes` returns them), and a bare object URL that answers metadata XML is retried with `/source/main` (when the retry fails, the metadata answer is kept). Message classes (`/sap/bc/adt/messageclass/<name>`) return the ADT XML on purpose.

Sources you read or write are cached per destination and session (`MCP_SOURCE_CACHE_TTL_SECONDS`, default 300; `0` keeps entries until logout) so `syntaxCheckCode`, `typeHierarchy`, `cdsViewInfo`, `grepPackage`, `abapDocumentation` and `apiReleaseState(sourceUrl)` can reuse them. `editObjectSource` and `setMethodSource` never read from the cache: they always re-fetch from SAP.

### One method instead of the class

```text
getMethodSource(classUrl="ZCL_EXAMPLE", methodName="GET_DATA")
getMethodSource(classUrl="ZCL_EXAMPLE", methodName="IF_OO_ADT_CLASSRUN~MAIN")
getMethodSource(classUrl="ZCL_EXAMPLE", methodName="SETUP", include="testclasses", className="LTC_EXAMPLE")
```

`classUrl` accepts the class name or its URL (a source or include suffix is stripped). `include` selects `main` (default: definition and implementations), `implementations` (local classes), `testclasses`, `definitions` or `macros`. The answer carries `sourceUrl` (the include URL you would write back to), `method`, `className`, `startLine`, `endLine`, `lines`, `amdp` and `source` (the `METHOD ... ENDMETHOD` block). When the method is not found the answer is an error listing `methodsInInclude` (qualified as `CLASS=>METHOD` when the include holds several classes) with a hint to try `include=implementations` or `testclasses`; when the name is ambiguous it lists `candidates` with their line ranges and asks for `className`.

### Class includes

`classIncludes(clas="ZCL_EXAMPLE")` answers `result`: a map from include name to URL, built from the includes the class actually has. A complete class has `main`, `definitions`, `implementations`, `testclasses` and `macros`; an include that does not exist is simply **absent from the map** (no key, no null, no URL). That is the decision rule for tests: `result.testclasses` missing means "create it with `createTestInclude` first"; present means "write into it". Pass the URLs to `getObjectSource` and `editObjectSource` unchanged (no `/source/main`).

### Finding code by content

| Tool | Use when | Answer |
|---|---|---|
| `sourceTextSearch(searchString="ZTABLE", packages="ZEXAMPLE,ZOTHER", objectTypes="CLAS/OC,PROG/P", objectName="ZCL_*", maxResults=100)` | The backend has the ADT text index (server-side, fast). The index is word or prefix based: plain identifiers, not regex or substrings. | `results` with object, line and snippet where the backend provides them, `totalItems`, `filters`, and a `hint` when nothing matched. When the tenant answers that source search is not supported (some S/4HANA Cloud tenants) and `packages` were given, the call falls back to `grepPackage` per package and says so in `fallback`; without `packages` it tells you to call `grepPackage` yourself. |
| `grepPackage(packageName="ZEXAMPLE", pattern="SELECT .* FROM ztable", regex=true, caseSensitive=false, recursive=true, objectTypes="CLAS/OC", contextLines=2, maxObjects=200, maxMatches=200)` | Any system, substrings and regular expressions, context lines (`contextLines` default 1). Downloads each source once (cached) and greps client-side: classes, interfaces, programs, includes, CDS, access controls, metadata extensions, behavior and service definitions, function modules and function group includes (`CLAS/OC`, `INTF/OI`, `PROG/P`, `PROG/I`, `DDLS/DF`, `DCLS/DL`, `DDLX/EX`, `BDEF/BDO`, `SRVD/SRV`, `FUGR/FF`, `FUGR/I`). | `matches` (`objectUrl`, `name`, `type`, `line`, `text`, `context`), `packagesScanned`, `objectsScanned`, `objectsTruncated`, `totalMatches`, `matchesTruncated`, `failures`. Sequential downloads on one stateful session, so a wide package takes a while; progress notifications go to hosts that pass a `progressToken`. |

### Navigation: who uses what

Two where-used tools, for two different questions:

- **Who uses this object?** `whereUsed(name="ZCL_EXAMPLE", objType="CLAS/OC", maxResults=200)`: resolves the name with `searchObject` (exact name match; asks for `objType` when the name is ambiguous across types) and returns `target`, `totalReferences`, `references` (`object`, `uri`, `parentUri`, `usage`, `canHaveChildren`), `groups` (first 50) and a `hint`. It answers at object level: the classes, programs and CDS entities that reference the class, not which method they call.
- **Who uses this method (or attribute, or type)?** `usageReferences(url="/sap/bc/adt/oo/classes/zcl_example/source/main", line=<line of the method name in the definition>, column=<column of the name>)`: the where-used list of the symbol at a source position, the way Eclipse does it from the editor. `url` is the source URL, `line` and `column` are numbers the server passes through to ADT unchanged; take the line from `getObjectSource` (1-based numbering) and the column of the first character of the method name in the `METHODS get_data ...` line of the public, protected or private section. Without `line`/`column` it is the object-level list again. Results are objects with `uri`, `objectIdentifier`, `parentUri`, `adtcore:name`, `adtcore:type`, `usageInformation`, `packageRef`, paged with `startIndex`/`maxItems`; pass them to `usageReferenceSnippets(references=[...])` for the exact lines and code excerpts. `whereUsed`'s `hint` sends you here when only grouping nodes came back.

Other navigation:

- `typeHierarchy(objectSourceUrl=".../zcl_example/source/main", line=12, offset=6, superTypes=false)`: `line` is 1-based, `offset` is the 0-based column of the type name; `superTypes=true` walks up the inheritance chain, the default lists subclasses and implementers. Returns `direction`, `count`, `hierarchy`. Pass `source` to analyse text you have not written yet.
- `cdsViewInfo(name="ZI_EXAMPLE", includeSource=true, getTargetForAssociation=false, getExtensionViews=false)`: entity `type`, `description`, `sqlViewName`, `fields` count and `elements` (`name`, `type`, `dataType`, `length`, `description`, `isKey`), plus the DDL `source` (or `sourceError` when the DDL cannot be read, for example on a released SAP view). Name, not URL.
- `objectStructureElements(objectUrl, version, startIndex, maxItems)`: a flat outline of methods, attributes, events, types and fields with visibility and flags; cheaper than `objectStructure` or `classComponents` when you need names only. Unlike `getObjectSource`, `version` defaults to `active` here: omit it on a fully active class, and pass `version="inactive"` only after a write you have not activated yet.
- `objectStructure(objectUrl)`: the raw ADT header of an object, `structure.metaData` with every attribute the backend sends (`adtcore:name`, `adtcore:type`, `adtcore:changedBy`, `adtcore:responsible`, `adtcore:version`, `abapsource:*`, `class:*` and whatever else the release adds), `links`, and for classes `includes` with their URLs.
- `objectEnhancements(objectSourceUrl, contextUri, includeSource=true)`: `count` and `implementations` of enhancement points active on the source. Read it before editing code next to SAP standard to see what already hooks in.

## 3. Changing code safely

### Step 1: which transport

```text
resolveTransport(objSourceUrl="/sap/bc/adt/oo/classes/zcl_example")
```

`objSourceUrl` takes the object URL or its source URL (the schema says "URL of the object (or its source URL)"; both go to the ADT transport check as they are). One call replaces interpreting `transportInfo` yourself. The decision order is: (1) the transport that already records or locks the object (a transport lock; `reason` says it must be used, `tasks` lists its tasks), (2) `transport: null` with `needsTransport: false` for local packages (`$TMP`, `DLVUNIT` `LOCAL` or a non-recording package without locks), (3) `preferTransport` when it is among the modifiable candidates, (4) the newest modifiable transport of the current user for that package, (5) with `createIfMissing=true` a new request described by `requestText` (`created: true`). Without `createIfMissing` and without a candidate you get `transport: null`, `needsTransport: true` and a reason telling you to call `createTransport` or rerun with `createIfMissing=true`. `devClass`, `recording`, `candidates` (each with `transport`, `description`, `status`, `owner`, `target`, `date`, `time`) and the raw `messages` are always included; a message of severity `E`, `A` or `X` aborts with "Transport check failed".

A policy with `allowedTransports` refuses `createIfMissing=true` and `createTransport` outright (see [README, Keeping it safe](../README.md#keeping-it-safe)).

### Step 2: check before you write

`syntaxCheckCode(url=".../zcl_example/source/main", code="<intended full source>")` returns `result` entries with `line`, `offset`, `severity` and `text`; an empty `result` is clean. `url` is required because the check runs in the context of an existing object (types and includes are resolved there); it is not a standalone check of free text. Free ABAP without an object is what `runSnippet` is for.

`code` must be the complete intended source of that URL, not a fragment. Three ways to get there:

- Omit `code` to check the source last read or written for that URL in this session (`usedCachedSource: true`). The cache holds the whole source even when `getObjectSource` paged it, so "read, then check without `code`" verifies the current state of a large class in two calls.
- For a patch you intend to apply with `editObjectSource`, apply it mentally to the full text: read all pages (`startLine` until `hasMore` is false), assemble, patch, and pass the result as `code`. For a class larger than the response budget this costs several reads; it is worth it for signature changes and anything that touches the definition.
- Or skip the check: `editObjectSource(..., activate=true)` writes and activates in one call, and a failed activation returns the backend's messages with line numbers in `activation` while leaving the source written but inactive (step 4). For a one-line change inside a method this is the cheaper route.

`mainUrl` is for includes. `url` is the artifact being checked; `mainUrl` is the source URL of the compilation unit it belongs to, which the backend uses as the context (it defaults to `url`). For a program include: `url="/sap/bc/adt/programs/includes/zinc_example/source/main"`, `mainUrl="/sap/bc/adt/programs/programs/zexample_report/source/main"`, optionally `mainProgram="ZEXAMPLE_REPORT"`. For a class include: `url=<include URL from classIncludes>` (for example `/sap/bc/adt/oo/classes/zcl_example/includes/testclasses`) and `mainUrl="/sap/bc/adt/oo/classes/zcl_example/source/main"`.

### Step 3: write

Three write tools, all of which lock, write and unlock by themselves and activate when `activate=true`:

**Targeted replacements** (preferred for existing objects):

```text
editObjectSource(
  objectSourceUrl="/sap/bc/adt/oo/classes/zcl_example/source/main",
  replacements=[
    {"oldText": "  METHOD get_data.\n    SELECT * FROM ztable INTO TABLE rt_data.",
     "newText": "  METHOD get_data.\n    IF iv_key IS INITIAL.\n      RETURN.\n    ENDIF.\n    SELECT * FROM ztable INTO TABLE rt_data."}
  ],
  activate=true,
  transport="DEVK900123")
```

The server re-reads the current source from SAP first (never from its cache), so the edit lands on the latest remote version. Each `oldText` must match exactly once: 0 matches fails with "oldText was not found in the current source on SAP (0 matches). Re-read the object with getObjectSource and copy the exact current text, including indentation", several matches fail with "oldText matches N locations (lines ...). Include more surrounding lines so it matches exactly once"; either way nothing is written, and the replacements are applied in order, atomically. The answer: `mode: "replacements"`, `replacementsApplied`, `applied` (per entry: `index`, `line`, `linesRemoved`, `linesAdded`), `totalLinesBefore`, `totalLinesAfter`, `lockMode`, and `activation` when requested.

Anchors in a class main source: `ENDCLASS.` always occurs twice (definition and implementation) and `ENDMETHOD.` once per method, so anchor on a line that is unique by construction: the section keyword you are extending (`  PROTECTED SECTION.` when adding to the public section, since it follows it), or the last method's `ENDMETHOD.` together with the closing `ENDCLASS.` (the recipe in section 14 shows both).

**Line range with a guard**:

```text
editObjectSource(objectSourceUrl="...", startLine=42, endLine=44,
  newText="    rv_total = lines( it_items ).",
  expectedText="    rv_total = 0.\n    LOOP AT it_items INTO DATA(ls_item).\n      rv_total += 1.",
  activate=true, transport="DEVK900123")
```

Replaces lines 42 to 44 (inclusive, 1-based). `endLine = startLine - 1` inserts before `startLine`; an empty `newText` deletes the range. `expectedText` is the exact current content of the range joined with `\n`; when SAP has something else the edit is rejected and the actual text is returned, which is the protection against a stale read. The answer adds `linesReplaced` and `linesInserted`.

**One method**:

```text
setMethodSource(classUrl="ZCL_EXAMPLE", methodName="GET_DATA",
  source="    IF iv_key IS INITIAL.\n      RETURN.\n    ENDIF.\n    SELECT * FROM ztable INTO TABLE rt_data.",
  activate=true, transport="DEVK900123")
```

Re-reads the include, swaps the `METHOD ... ENDMETHOD` block and writes the include back. Pass the whole block or only the body (`bodyWrapped: true` means the existing header and footer were kept). `include` and `className` work as in `getMethodSource`; an unknown method is refused with the methods present, an ambiguous one with the candidates and nothing written. The answer reports `replaced` and `now` line ranges. The definition part is untouched, so signature changes need `editObjectSource` on the definition too.

**Full rewrite**: `setObjectSource(objectSourceUrl, source, activate=true, transport)` for new objects and small ones. Writing a message class this way rewrites the whole ADT XML, records every message in the transport and resets `masterLanguage` to the logon language (FIELD-NOTES session A).

Policies with `deniedTables` scan the ABAP text of `setObjectSource`, `setMethodSource` and `runSnippet` for the listed tables (best effort).

### Locks: automatic versus explicit

`lockMode` in every source write answer (`setObjectSource`, `editObjectSource`, `setMethodSource`) says what happened: `auto` (locked and unlocked in this call), `reused` (the server held a lock it recorded earlier) or `explicit` (you passed `lockHandle`). You only need the lock tools to hold one lock across several writes:

```text
lock(objectUrl="/sap/bc/adt/oo/classes/zcl_example")      -> lockHandle, recorded: true
editObjectSource(... no lockHandle needed while the lock is recorded ...)
createTestInclude(clas="ZCL_EXAMPLE", transport="DEVK900123")
unLock(objectUrl="/sap/bc/adt/oo/classes/zcl_example")    -> lockHandle optional, taken from the ledger
```

`listLocks()` shows what this server holds on the destination (`objectUrl`, `lockHandle`, `accessMode`, `acquiredAt`, `auto`). `forceUnlock(objectUrl?, dropSession=false)` releases every recorded lock or one object and reports `released`, `failed`, `sessionDropped`, `remaining`; `dropSession=true` also drops the SAP session, which frees locks whose handles are already invalid. A write whose unlock failed still succeeds and says so with `unlockError` (`setObjectSource` adds a `hint` pointing at `forceUnlock`).

Two situations from FIELD-NOTES:

- **Session expiry.** A session that expires between calls (`sessionExpired` or `csrf`) is re-authenticated and the call retried exactly once (the audit record carries `retried: true`). Lock handles from the old session are gone: the retry of a write that carried an explicit `lockHandle` fails with `kind: "staleLockHandle"`, and the fix is `lock` again. If `sessionExpired` keeps surfacing, call `login`.
- **Foreign locks.** `kind: "locked"` with the object absent from `listLocks` means another session holds it (an open Eclipse window of the same user, or another user; the message names them). `dropSession` and `forceUnlock` cannot release it: only that session or `SM12` can. Do not retry the write.

`setTextElements`, `setDomainProperties` and `setDataElementProperties` still require an explicit `lockHandle`; `deleteObject`, `createTestInclude` and `atcApplyQuickfix` lock automatically when none is passed.

### Step 4: activation

`activate=true` on the write returns an `activation` object: `success` plus the backend messages (with line numbers and severity) when it failed. A failed activation does not fail the call: the source is written and inactive. The object activated is always the **whole object**: for a write to a class include URL (`.../includes/testclasses`, `.../includes/implementations`) the server strips the include part and activates the class, and activating a class activates all its includes. So `activate=true` on the test include write is enough; there is no separate activation of an include. Fix and write again, or activate later:

| Tool | When |
|---|---|
| `activateByName(objectName="ZCL_EXAMPLE", objectUrl="/sap/bc/adt/oo/classes/zcl_example", mainInclude?, preauditRequested?)` | One object. `objectName` is the object name, `objectUrl` the object URL (no `/source/main`, no include suffix). `mainInclude` is the context for program includes: the main program, appended to the object URL as `?context=`, so an include is activated within its main program (`activateByName(objectName="ZINC_EXAMPLE", objectUrl="/sap/bc/adt/programs/includes/zinc_example", mainInclude="ZEXAMPLE_REPORT")`); leave it out for classes, interfaces, programs and DDIC objects. `preauditRequested` asks the backend to run its pre-activation audit (syntax and consistency checks) before activating; it defaults to true and is only worth switching off when the audit itself is the problem. Returns `success`, `messages` (`objDescr`, `type`, `line`, `href`, `shortText`) and `inactive`; read `messages` even on success, warnings live there. |
| `activateObjects(objects='[{"adtcore:uri": "...", "adtcore:type": "CLAS/OC", "adtcore:name": "ZCL_EXAMPLE", "adtcore:parentUri": "/sap/bc/adt/packages/zexample"}]', preauditRequested?)` | Several objects in one activation request; `objects` must be a JSON string and every entry needs the four `adtcore:` fields, so the `object` entries from `inactiveObjects(startIndex, maxItems)` can be passed as they are. |
| `activatePackage(packageName="ZEXAMPLE", recursive=true, user="DEVELOPER", allUsers=false, preauditRequested=true)` | Everything inactive in a package tree at once, the way RAP stacks (CDS, behavior definition, service definition, classes) must be activated together. By default only the connected user's objects; other users' unfinished work is listed in `otherUsers` and left alone. On SSO and OAuth destinations the user name is unknown (see "Your SAP user name" above), so pass `user` or accept the `warning` that every user's objects are activated. Returns `requested`, `success`, `messages` and `stillInactive`. |

### Step 5: verify and show

`unitTestRun(url="/sap/bc/adt/oo/classes/zcl_example")` after every change (section 5), then `objectDiff(objectUrl="/sap/bc/adt/oo/classes/zcl_example")` to show what changed.

**How `objectDiff` and `revisions` count.** `revisions(objectUrl, clsInclude?)` returns `revisions[]` with `uri`, `date`, `author`, `version` and `versionTitle` in backend order; `version` is the name of the transport request the revision was saved under (`DEVK900123`), taken from the revision's transport link, and `versionTitle` its description. `objectDiff` sorts them by `date`, newest first, and then **index 0 is the newest revision, 1 the one before**; `fromRevision` defaults to `1`, `toRevision` to `0`, so the default call shows the last change. A selector can be that index, a `version` string (the first, newest revision carrying it wins when several saves went into the same transport), a revision `uri`, or a substring of `versionTitle`. `clsInclude` selects which include's history to read: `main` (the default), `definitions`, `implementations`, `testclasses` or `macros`; the include must exist. `contextLines` defaults to 3. The answer has `from` and `to` metadata (`uri`, `version`, `title`, `date`, `author`), `revisions` (how many exist), `linesAdded`, `linesRemoved`, `identical` and the unified `diff` (truncated with `truncated: true` when huge). An object with a single revision is refused with "Object has only 1 revision(s)": a freshly created object has nothing to diff against, and its whole source is what the transport adds (section 6). Revisions come from SAP version management, so an unactivated write is not in the list yet.

## 4. Creating objects

### Type, name, package

`loadTypes()` lists the object types creatable on this system (version-aware); `creatableTypeDetails(typeId="CLAS/OC")` adds per type the `label`, `maxNameLength`, `requiredValidationFields` and a `createWith` hint. `validateNewObject` checks name, package and type before anything is created and returns field-level messages:

```text
validateNewObject(objtype="CLAS/OC", objname="ZCL_EXAMPLE", description="Example class", packagename="ZEXAMPLE")
validateNewObject(objtype="FUGR/FF", objname="Z_EXAMPLE_FM", description="Example FM", fugrname="ZFG_EXAMPLE")
validateNewObject(objtype="DEVC/K", objname="ZEXAMPLE_SUB", description="Sub package", packagename="ZEXAMPLE", swcomp="ZCUSTOM_DEVELOPMENT", transportLayer="", packagetype="development")
```

### Transport for an object that does not exist yet

The object has no URL, so resolve on the package: `resolveTransport(objSourceUrl="/sap/bc/adt/packages/zexample", devClass="ZEXAMPLE", createIfMissing=true, requestText="Example class")`. The alternative is `createTransport(objSourceUrl="/sap/bc/adt/packages/zexample", REQUEST_TEXT="Example class", DEVCLASS="ZEXAMPLE", transportLayer?)`, which returns `transportNumber` (the aliases `description` and `packageName` are accepted). On a plain on-prem system `$TMP` needs neither; the tested S/4HANA Cloud tenant refused `$TMP` (authorization object `S_ABPLNGVS`: objects in `$TMP` get the Standard language version), so there you name a customer package and its transport.

### createObject, per type

| Type | Call |
|---|---|
| Class | `createObject(objtype="CLAS/OC", name="ZCL_EXAMPLE", parentName="ZEXAMPLE", description="Example class", parentPath="/sap/bc/adt/packages/zexample", responsible="DEVELOPER", transport="DEVK900123")` |
| Interface | `createObject(objtype="INTF/OI", name="ZIF_EXAMPLE", parentName="ZEXAMPLE", description="...", parentPath="/sap/bc/adt/packages/zexample", responsible, transport)` |
| Program | `createObject(objtype="PROG/P", name="ZEXAMPLE_REPORT", parentName="ZEXAMPLE", description="...", parentPath="/sap/bc/adt/packages/zexample", transport)` |
| Package | `createObject(objtype="DEVC/K", name="ZEXAMPLE_SUB", parentName="ZEXAMPLE", description="...", parentPath="/sap/bc/adt/packages/zexample", swcomp="ZCUSTOM_DEVELOPMENT", transportLayer="", packagetype="development", recordChanges=true, abapLanguageVersion="5", responsible="DEVELOPER", transport)` |

`parentName` is the package, `parentPath` its ADT path (lower case name, `$TMP` as `/sap/bc/adt/packages/$TMP`). Cloud backends expect `responsible`; the SSO flow logs in with a placeholder user name that SAP rejects as responsible, so pass your real SAP user there (when omitted on a package, the server leaves the attribute out and the backend defaults to the session user). Packages need `swcomp`; `recordChanges` defaults to `true` when a `transportLayer` is given and cloud systems require it (the server builds the package body itself because the library's body omits that attribute); `packagetype` is `development` (default), `structure` or `main`; `abapLanguageVersion="5"` requests ABAP for Cloud Development for the package (written as the `pak:languageVersion` attribute), omit it to let the system decide. The answer is `{status: "success"}`: ADT answers the creation with no body, so there is no metadata to read back; the object URL follows the usual pattern.

Then write the source with `setObjectSource(objectSourceUrl="<object url>/source/main", source, activate=true, transport)` and read the `activation` field.

### Tests, text elements, DDIC

- `createTestInclude(clas="ZCL_EXAMPLE", lockHandle?, transport="DEVK900123")` creates the empty test classes include (auto-lock on the class; `lockHandle` only when you hold one; `transport` for transportable packages). It has no `responsible` parameter and needs none. The server does not check whether the include exists before posting, and what the backend answers for a class that already has one was not tested: call `classIncludes` first and create only when `testclasses` is absent. The answer is `{status, message}` (the ADT call returns no body). Then write the tests with `setObjectSource` on the include URL from `classIncludes` (`.../includes/testclasses`) with `activate=true` (this activates the class, section 3 step 4), then `unitTestRun`.
- `getTextElements(objectUrl="/sap/bc/adt/programs/programs/zexample_report", category="symbols")` (`symbols` default, `selections`, `headings`) reads text elements; `setTextElements(objectUrl, category, elements='[{"id":"001","text":"Hello","maxLength":40}]', lockHandle, transport)` writes the full list for the category (missing entries are removed), needs an explicit `lock` first and answers `updated: true` with the `count` written.
- Domains and data elements are read, modified and written back as JSON:

```text
getDomainProperties(domainUrl="/sap/bc/adt/ddic/domains/zdom_example", version="active")   -> properties, metaData
lock(objectUrl="/sap/bc/adt/ddic/domains/zdom_example")                                    -> lockHandle
setDomainProperties(domainUrl="...", properties=<modified properties JSON>, metaData=<metaData JSON>, lockHandle, transport)
activateByName(objectName="ZDOM_EXAMPLE", objectUrl="/sap/bc/adt/ddic/domains/zdom_example")
unLock(objectUrl="/sap/bc/adt/ddic/domains/zdom_example")
```

`getDataElementProperties(dataElementUrl="/sap/bc/adt/ddic/dataelements/zde_example")` and `setDataElementProperties(dataElementUrl, properties, metaData, lockHandle, transport)` follow the same shape (domain or built-in type, length, field labels, search help). Both set tools answer `updated: true, next: "activateByName"`.

## 5. Quality: unit tests and ATC

### Unit tests

```text
unitTestRun(url="/sap/bc/adt/oo/classes/zcl_example")
unitTestRun(url="/sap/bc/adt/oo/classes/zcl_example", flags='{"harmless":true,"dangerous":false,"critical":false,"short":true,"medium":true,"long":false}')
```

`url` is an object URL (a class, a program or a package). When `flags` is omitted the run uses the library defaults: `harmless: true`, `dangerous: false`, `critical: false`, `short: true`, `medium: false`, `long: false`, so only harmless, short tests run; a test class declared `RISK LEVEL DANGEROUS` or `DURATION MEDIUM` is skipped silently. To include it pass `flags` with **all six keys** (the object is forwarded to the ADT run configuration as it is). `startIndex`/`maxItems` page the test-class list of large runs.

The answer is `result[]`: one entry per test class (`adtcore:name`, `adtcore:uri`, `riskLevel`, `durationCategory`) with `testmethods[]` (`adtcore:name`, `executionTime`, `unit`) and `alerts[]` on both levels. **A passed method has an empty `alerts` array**; a failed one carries alerts with `kind` (`failedAssertion`, `exception`, `warning`), `severity` (`critical`, `fatal`, `tolerable`, `tolerant`), `title`, `details[]` and a `stack` trimmed to 15 frames (`stackTruncated`). Class-level `alerts` report problems outside a method (a failing `class_setup`, a class that cannot be executed). An empty `result` means no test classes were found, typically because the object is not active or has no test include. `unitTestEvaluation(clas="ZCL_EXAMPLE", flags)` takes a class name or URL, runs the tests and evaluates the first test class, paging the method list. `unitTestOccurrenceMarkers(url, source)` maps test coverage markers onto a source. `unitTestRun` is not in the read-only set, so `readOnly` destinations refuse it.

### ATC

```text
createAtcRun(variant="ABAP_CLOUD_DEVELOPMENT_DEFAULT", mainUrl="/sap/bc/adt/oo/classes/zcl_example", maxResults=100)
```

`variant` is **required** on `createAtcRun`: a check variant name (resolved to a worklist id through `atcCheckVariant` for you) or the 32-character hexadecimal worklist id itself. `mainUrl` is an object URL, a package URL (`/sap/bc/adt/packages/zexample`) or a transport URL (`/sap/bc/adt/cts/transportrequests/DEVK900123`). The answer is `result` with the run `id` (the `runResultId` of the next calls) and `infos`.

**Which variant to pass.** There is no tool that lists the check variants of a system. The rule:

| Situation | Pass |
|---|---|
| S/4HANA Cloud tenant | `ABAP_CLOUD_DEVELOPMENT_DEFAULT`, the variant every tenant ships; it is what the prompts use and what `atcSummary` assumes when `variant` is omitted. |
| On-prem, unknown project conventions | `atcCustomizing()` first: `result.properties[]` is a list of `{name, value}` pairs, one of them the system's default check variant; pass that value as `variant`. `result.excemptions[]` lists the exemption reasons the system accepts. |
| On-prem, the project has its own variant | Pass its name. `atcCheckVariant(variant="ZPROJECT_VARIANT")` alone tells you whether the name exists (it answers the worklist id, or fails); the same applies to `ABAP_CLOUD_READINESS`, which the `clean-core-check` prompt suggests "if present". |

`atcSummary(mainUrl=..., variant=...)` is the only ATC entry point with a default: omitted `variant` means `ABAP_CLOUD_DEVELOPMENT_DEFAULT`, which fails on an on-prem system that does not have that variant, so pass the value from `atcCustomizing` there.

- `atcWorklists(runResultId=<id>, includeExempted=false, startIndex, maxItems)`: `result.objects[]`, each with `findings[]` (`checkId`, `checkTitle`, `messageTitle`, `priority`, `uri`, `location` with line and column, `quickfixInfo`, documentation `link`). Paged per object.
- `atcSummary(runResultId=<id>)` or `atcSummary(mainUrl="/sap/bc/adt/packages/zexample", variant="...", includeExempted, topFindings=30)`: runs ATC when no `runResultId` is given and aggregates `totals` (`objectsChecked`, `objectsWithFindings`, `findings`, `exempted`, `quickfixable`), `byPriority`, `byCheck`, `byObject` (first 50), `topFindings` (priority, check, message, object, `line`, `quickfix`), `clean` and a `hint`. `atcSummary(mainUrl=<transport URL>)` and `createAtcRun(mainUrl=<transport URL>)` followed by `atcWorklists` run the same check; the first gives the digest, the second the raw findings.
- `atcQuickfixProposals(objectSourceUrl=".../source/main", line=57, column=4)`: `proposals` with `index`, `name`, `description`, `type`. `line` is 1-based, `column` 0-based, both as ATC reports them.
- `atcApplyQuickfix(objectSourceUrl, line, column, proposalIndex=0, lockHandle?, transport?)`: recomputes the proposals, applies the chosen one and writes the source back under an automatic lock; the answer names the proposal in `applied` with `editsApplied`. Edits that target other objects are listed in `editsSkipped` for you to apply by hand; when every edit targets another object nothing is written and the call fails with their URIs. It does not activate: follow with `activateByName` (or a write with `activate=true`) and re-run ATC.
- `atcDocumentation(docUri=<link from a finding>)` returns the check documentation as plain text.
- Exemptions: `atcExemptProposal(markerId)` then `atcRequestExemption(proposal)`; `atcContactUri(findingUri)` and `atcChangeContact(itemUri, userId)` for the contact person. Only with the user's approval.

`prettyPrinter(source, startLine, maxLines)` formats a source with the system's pretty printer (read `prettyPrinterSetting()`, change with `setPrettyPrinterSetting(indent, style)`); write the result back with `setObjectSource`.

## 6. Transports

| Tool | Answer |
|---|---|
| `transportInfo(objSourceUrl, devClass?, operation?)` | The raw ADT transport check: `DEVCLASS`, `RECORDING`, `LOCKS` (the recording transport), `TRANSPORTS` (candidates with `TRKORR`, `AS4TEXT`, `TRSTATUS`, owner, target), `MESSAGES`. `resolveTransport` is the interpreted version. Also used internally by the `allowedPackages` policy to learn an object's package. |
| `userTransports(user="DEVELOPER", targets=false, startIndex, maxItems)` | `transports` with `workbench` and `customizing` targets, each holding `modifiable` and `released` requests; large results are flattened into one paged list of `{category, targetName, listType, request}`. `transportsByConfig(configUri, targets)` does the same for a saved transport configuration. |
| `transportDetails(transportNumber="DEVK900123")` | `details`: owner, status, `tasks` with their owners, and the objects of the request and every task (`tm:pgmid`, `tm:type`, `tm:name`). |
| `transportUnifiedDiff(transportNumber="DEVK900123", maxObjects=20)` | See below. |
| `transportRelease(transportNumber, ignoreLocks=false, IgnoreATC=false)` | Releases the request. Destructive; the prompts never call it on their own. |
| `transportDelete(transportNumber)` | Deletes a request. Destructive. |
| `transportSetOwner(transportNumber, targetuser)`, `transportAddUser(transportNumber, user)`, `systemUsers(startIndex, maxItems)` | Ownership and tasks. |
| `transportReference(pgmid="R3TR", obj_wbtype="CLAS", obj_name="ZCL_EXAMPLE", tr_number?)` | The transport reference of one object. |
| `hasTransportConfig()`, `transportConfigurations()`, `getTransportConfiguration(url)`, `createTransportsConfig()`, `setTransportsConfig(uri, etag, config)` | The saved configurations of the ADT Transport Organizer view. |

**What `transportUnifiedDiff` diffs.** For every object recorded on the request and its tasks it locates the object with `searchObject`, reads its revisions (newest first) and compares the current source against the newest revision that predates the transport: the revision just older than the oldest one whose `version` or `versionTitle` carries the transport number. When none is tagged it falls back to the previous revision and says `exactTransportMatch: false`. Whole objects (`R3TR` `CLAS`, `PROG`, `INTF`, `FUGR`, `DDLS`, `BDEF`, `DCLS`, `DDLX`, `SRVD`) and sub-objects are covered: `LIMU CINC` class includes are mapped to the include (`CCDEF` definitions, `CCIMP` implementations such as the local handler classes of a RAP behavior pool, `CCAU` test classes, `CCMAC` macros), `METH`, `CLSD`, `CPUB`, `CPRO`, `CPRI` and `CLSI` parts to the class main source, `REPS`/`REPO` to the include, `FUNC` to the function module. Several parts of one class collapse into one diff.

Each `diffs[]` entry carries `pgmid`, `transportType`, `transportName`, `type`, `name`, `uri`, `include` (when a class include), `baselineRevision`, `exactTransportMatch` and the unified `diff`. Three cases to read correctly:

- **Changed object**: `baselineRevision` is `{version, date, title}` of the revision the diff starts from (no URI, no index). To isolate exactly this change with `objectDiff`, pass its `version` as `fromRevision` when it names a transport no other revision shares, or look the `date` up in `revisions(objectUrl)` (sorted newest first, as `objectDiff` counts) and pass that index; `toRevision=0` is the current version.
- **Newly created object** (a single revision, or no revision older than the transport's own): `baselineRevision: null`, the diff header reads `(new object)` and the whole current source appears as added lines. `objectDiff` refuses such objects ("only 1 revision"), so the transport diff is the review of a new object.
- **Skipped**: `skipped[]` lists what could not be diffed with the reason: messages (`LIMU MESS`, `MSAD`) have no source history (read the message class with `getObjectSource`), DDIC and customizing entries are not source objects, an object that no longer exists ("deleted after being recorded"), parts already covered by another part's diff, and entries beyond `maxObjects` (default 20), named so you can raise the limit.

Because the comparison is against the current source, an already released transport also shows later changes to the same objects; use `objectDiff` with explicit revisions to isolate one change.

## 7. Data

`runQuery(sqlQuery="SELECT carrid, connid, fldate FROM sflight WHERE carrid = 'LH' ORDER BY fldate DESCENDING", rowNumber=100, decode, startRow, maxRows)` runs an ABAP SQL `SELECT` through the ADT data preview over tables and CDS entities (released API views included). `rowNumber` caps what SAP returns (default 100); `startRow`/`maxRows` page the returned rows (`totalRows`, `returnedRows`, `hasMore`). The answer is `result` with `columns` (name, type, description) and `values`.

Pitfalls, each with its own hint in the error text:

- **255-character lines.** The preview reads the statement in 255-character lines; the server wraps long statements before sending (`note: "Statement was wrapped..."`). A statement that still fails has a single literal or identifier longer than 255 characters, or a genuine syntax error at the named token.
- **Restricted tables.** Tables whose DDIC `dataMaintenance` is restricted, or API views not allowed for display, are refused by the preview ("is not permitted"). `tableContents(ddicEntityName="ZTABLE", rowNumber=100, sqlQuery?, decode, startRow, maxRows)` reads them by name (an optional `sqlQuery` filters); `S_TABU_DIS`/`S_TABU_NAM` still apply.
- **Key format.** Keys come back in internal format: leading zeros, no conversion exit applied. A `WHERE` on a padded key with an unpadded literal returns 0 rows. `getDataElementProperties(dataElementUrl="/sap/bc/adt/ddic/dataelements/<name>")` and `getDomainProperties(domainUrl="/sap/bc/adt/ddic/domains/<name>")` tell the length, type and output settings (FIELD-NOTES session A).
- **Policies.** `allowFreeSql: false` refuses `runQuery` and `tableContents` with `sqlQuery`; `deniedTables` are matched against `tableContents` and every `FROM`/`JOIN` target; `readOnly` still allows both, since they are reads.

Structure before data: `ddicElement(path="ZTABLE", getTargetForAssociation, getExtensionViews, getSecondaryObjects, startIndex, maxItems)` describes a table, structure or CDS entity (paged `children`); `ddicRepositoryAccess(path)` lists repository references.

## 8. Runtime and diagnosis

### Dumps

```text
dumps(from="2026-09-01", to="20260903235959", user="DEVELOPER", contains="ZCL_EXAMPLE", maxItems=5)
```

`from`/`to` accept `YYYYMMDDHHMMSS`, `YYYYMMDD`, `YYYY-MM-DD` or ISO 8601 (values without a zone are system time, with a zone they are converted to UTC); `user` and `contains` (runtime error, exception, program or short text) are case-insensitive. Each summary has `dumpId`, `timestamp`, `user`, `runtimeError`, `exception`, `shortText`, `program`, `applicationComponent`, `client`, `host`, `terminatedAt` (`objectSourceUrl`, `line`), `whatHappened`, `errorAnalysis`, `whereTerminated` and `stack` (`no`, `event`, `program`, `include`, `line`, `sourceUrl`). `includeHtml=true` adds the raw HTML. `dumpDetails(dumpId, startLine, maxLines)` returns the full analysis as paged plain `text`.

**The window.** `dumps` reads the ADT dump feed (`/sap/bc/adt/runtime/dumps`), and the backend decides how far back it reaches: the server applies `from`/`to`/`user`/`contains` to whatever the feed returned, never to the whole history, and `totalInFeed` tells how many entries that was. The window size is not a fixed number of hours or entries on the server side; it is the feed's default query. When the dump you are after is older than that:

1. `feeds()` (toolset `runtime`, no parameters) lists every feed the backend publishes with, per feed, `title`, `href`, `refresh`, the `attributes` you may filter on (each with its `dataType`), the `operators` each data type supports, and `queryVariants` (`queryString`, `title`, `isDefault`); the variant marked `isDefault` is what `dumps` runs without `query`.
2. `dumps(query="<a query string composed from the feed's attributes and operators>")` passes the string through unchanged as the feed's `$query` parameter; the server-side filters still apply on top of the answer. Copy a non-default variant's `queryString` or adapt it.
3. When you already hold a dump's link (from an email, a monitoring tool, a colleague's Eclipse), `dumpDetails(dumpId=<full self link>)` reads it directly without going through the feed.

From a summary: `getObjectSource(objectSourceUrl=terminatedAt.objectSourceUrl, startLine=<line - 20>, maxLines=40)` for the termination point, then walk up the `stack` with each frame's `sourceUrl`. `terminatedAt.objectSourceUrl` is already the right URL for the include the code lives in (a class include URL for local classes and test classes, a program include URL for includes), so pass it as it is. For the callers use `whereUsed` (object level) or `usageReferences` with a position (method level), section 2.

### Running code

`runClass(className="ZCL_EXAMPLE")` runs a class implementing `IF_OO_ADT_CLASSRUN` and returns its console output in `result`. It always runs with a fresh program load, because a stateful ADT session keeps the load of a class it already executed and would print the old output after a write and activate (observed live; [docs/TESTPLAN.md](TESTPLAN.md) addendum). `runMode` says how: `clone` (a stateless clone, available for `basic` and `oauth` destinations, locks untouched) or `stateless` (the session itself is reset, which ends every lock it held; the explicit locks released first are listed in `locksInvalidated` with a `note`, and you re-lock before writing again). SSO destinations always use `stateless`.

```text
runSnippet(code="SELECT COUNT(*) FROM ztable INTO @DATA(lv_count).\nout->write( |rows: { lv_count }| ).",
  packageName="ZEXAMPLE", transport="DEVK900123", responsible="DEVELOPER", keep=false)
```

Wraps the statements in a temporary `IF_OO_ADT_CLASSRUN` class (`ZCL_MCP_SNIP_xxxxxx`, or `className`), creates it, writes, activates, runs (with the same fresh program load as `runClass`) and deletes it again unless `keep=true`. A complete `CLASS ... DEFINITION/IMPLEMENTATION` implementing `if_oo_adt_classrun` is accepted as well (its name is replaced by the temporary one). The answer: `className`, `packageName`, `wrapped`, `kept`, `output`, `runMode`, `steps` (`created`, `source written`, `activated`, `ran`, `deleted`) and `cleanupError` when the delete failed. An activation error returns `phase: "activation"` with the messages and the hint that the snippet body starts at line 8 of the generated class; the class is deleted anyway. `packageName` defaults to `$TMP`, which the tested cloud tenant refuses (the error hints at a customer package): on S/4HANA Cloud pass a customer package, its `transport` and `responsible`, and the create and delete are recorded on that transport. `runSnippet` creates and deletes a repository object, so it needs development authorization (`S_DEVELOP`): development systems only; on test and production systems read data with `runQuery`/`tableContents` instead.

### Debugger

Available when the `debugger` toolset is published (not in `focused`) and the destination exposes `/sap/bc/adt/debugger` (`systemProfile` says; refused before calling SAP otherwise). The parameters mirror Eclipse: `debuggingMode` is `user` or `terminal`, `terminalId` and `ideId` identify this client, `user` is the SAP user whose sessions are debugged.

```text
debuggerSetBreakpoints(debuggingMode="user", terminalId="<uuid>", ideId="<uuid>", clientId="<uuid>",
  breakpoints=["/sap/bc/adt/oo/classes/zcl_example/source/main#start=57"], user="DEVELOPER", scope="external")
debuggerListen(debuggingMode="user", terminalId="<uuid>", ideId="<uuid>", user="DEVELOPER", checkConflict=true)
    -> a debuggee (with debuggeeId) once a session of that user hits a breakpoint, or a listener conflict
debuggerAttach(debuggingMode="user", debuggeeId="<from listen>", user="DEVELOPER", dynproDebugging=false)
debuggerStackTrace(semanticURIs=true)
debuggerVariables(parents=["SY", "LT_DATA"], startIndex, maxItems)
debuggerChildVariables(parent=["LT_DATA"], startIndex, maxItems)
debuggerStep(steptype="stepOver")        stepInto | stepOver | stepReturn | stepContinue | stepRunToLine | stepJumpToLine (both with url="...#start=<line>") | terminateDebuggee | detachDebugger
debuggerGoToStack(urlOrPosition="<stack entry url>")
debuggerSetVariableValue(variableName="LV_FLAG", value="X")
debuggerDeleteBreakpoints(breakpoint=<object from set>, debuggingMode, terminalId, ideId, requestUser)
debuggerDeleteListener(debuggingMode, terminalId, ideId, user)
```

`scope` is `external` or `debugger`. `debuggerListeners(debuggingMode, terminalId, ideId, user, checkConflict)` shows existing listeners (`checkConflict=true` reports one held by another IDE); `debuggerSaveSettings(settings)` stores settings. `debuggerListen` blocks until a debuggee arrives, so trigger the code after it starts. Without the toolset, the paths are the dump feed, `runSnippet`/`runClass` with their output, and traces where served.

### Traces

Gated on `/sap/bc/adt/runtime/traces`. `tracesList(user)` and `tracesListRequests(user)` list existing traces and trace requests; for one trace `id`, `tracesHitList(id, withSystemEvents, startIndex, maxItems)`, `tracesDbAccess(id, ...)` and `tracesStatements(id, options, ...)` page through hits, database accesses and statements. `tracesSetParameters(parameters)` and `tracesCreateConfiguration(config)` set up new traces; `tracesDeleteConfiguration(id)` and `tracesDelete(id)` clean up (destructive). `user` is optional but on SSO and OAuth destinations the library would send the placeholder, so pass your SAP user.

## 9. ABAP Cloud readiness

`apiReleaseState` answers "may cloud code use this SAP object?" from SAP's official cloudification repository (one JSON per edition plus the object classifications from `github.com/SAP/abap-atc-cr-cv-s4hc`, downloaded from `raw.githubusercontent.com`, cached in memory and on disk under `~/.abap-adt-mcp/cache` for 24 hours; `MCP_CACHE_DIR`, an env var read by the code but not listed in `server.json`, relocates the disk cache; `refresh=true` re-downloads; a stale cache beats a failed download) plus, when `objectUrl` is given, the backend's own `/sap/bc/adt/apireleases` answer in `backendApiRelease`. Four input forms, combinable:

```text
apiReleaseState(names="CL_ABAP_CHAR_UTILITIES, TABL:MARA, FUGR:BAPI_MATERIAL_SAVEDATA", edition="cloud")
apiReleaseState(objectUrl="/sap/bc/adt/ddic/tables/mara")
apiReleaseState(source="<pasted ABAP>")
apiReleaseState(sourceUrl="/sap/bc/adt/oo/classes/zcl_example/source/main")
apiReleaseState(sourceUrl="/sap/bc/adt/oo/classes/zcl_example/includes/testclasses")
```

`names` are comma-separated, optionally prefixed with the TADIR type (`CLAS:`, `INTF:`, `TABL:`, `DDLS:`, `FUGR:`, `FUNC:`); `source` and `sourceUrl` scan every referenced object (`SELECT`/`UPDATE` targets, `TYPE` and `LIKE` references, `CL_`/`IF_`/`CX_` names, `CALL FUNCTION`, `INTERFACES`, `INHERITING FROM`), skipping names declared in the source itself and customer names. `edition` is `cloud` (S/4HANA Cloud Public Edition, default), `btp`, `pce2023` or `pce2022`.

`sourceUrl` is read through the session cache or, on a miss, straight from ADT as plain text with no URL rewriting: `.../source/main` for global sources and the include URLs from `classIncludes` (`.../includes/implementations`, `.../includes/testclasses`, without `/source/main`) both work, and each include is a separate scan. A bare object URL is not rewritten here (that rule belongs to `getObjectSource`): it would return the object's metadata XML and the scan would run over that text, so always pass a source or include URL. `objectUrl` is different: it is parsed for the object's name and TADIR type (`oo/classes` to `CLAS`, `ddic/tables` to `TABL`, `ddic/ddl` to `DDLS`, `functions/groups` to `FUGR`, `packages` to `DEVC`, and so on) and is the only form that also asks the backend.

Verdict `state` per object and what it means:

| `state` | `cloudReady` | Meaning |
|---|---|---|
| `released` | true | Listed as released for the edition. |
| `deprecated` | false | Released once, now deprecated; `successors` lists the replacements. |
| `classicAPI` | false | Usable in classic ABAP and, with care, the 3-tier extensibility model; not in ABAP Cloud. |
| `noAPI` | false | Classified as not an API. |
| `customer` | true | Y/Z or customer namespace: not an SAP API; its own ABAP language version decides. |
| `unknown` | false | Not in the repository at all (the repository lists objects with a release decision, not every SAP object, and the source scan is heuristic): verify in the system before treating it as a blocker. |

The answer groups them: `summary` (`checked`, `cloudReady`, `notCloudReady`, `unknown`, `customerObjects`), `blockers` (name, type, state, successors), `unknown` with `unknownNote`, `results` (every verdict with `note`, `softwareComponent`, `applicationComponent`), `scannedIdentifiers`. The tool is the only one that leaves the machine for something other than SAP (`openWorldHint: true`).

**Verifying an `unknown` name in the system.** The backend's own release information is reachable only through the `objectUrl` form: `apiReleaseState(objectUrl="/sap/bc/adt/functions/groups/<group>")` or `.../oo/classes/<name>`, `.../ddic/tables/<name>` adds `backendApiRelease`: `available: true` with the `attributes` the backend states (the server keeps `state`/`releaseState`, `contract`, `successor`, `useInCloudDevelopment`, `releaseDate` and a few more; the tested tenant answered `state=RELEASED` and `contract=C4` for a released class), or `available: false` with an `httpStatus` when the backend has no `/sap/bc/adt/apireleases` for that object, which on a cloud tenant is itself the answer (not released). Before that, `searchObject(query="<name>")` tells you what the name is and gives the URL; `ddicElement(path="<name>")` describes a DDIC name and `abapDocumentation(keyword="<name>")` explains a keyword that the heuristic scan mistook for an object. Most `unknown` entries are scan noise (a local type, a keyword, a field name) rather than SAP objects.

**Language version of existing objects.** The server has no tool that returns the ABAP language version (ABAP for Cloud Development versus Standard) as a field. `abapLanguageVersion` exists only as the `createObject` argument that sets it on a new package (section 4). What you can do: `objectStructure(objectUrl)` returns `structure.metaData` with every attribute of the object's ADT header exactly as the backend sends it, so on releases that expose the language version there it is in that map (the attribute name depends on the backend and is not normalized by the server); and the behavioural check is unambiguous on any release: `createAtcRun(variant="ABAP_CLOUD_DEVELOPMENT_DEFAULT", mainUrl=<object or package URL>)` reports every statement and object that ABAP for Cloud Development forbids, and `apiReleaseState(sourceUrl)` every SAP object the source uses that is not released. An object that passes both is cloud-ready whatever its attribute says; an object in a package created with `abapLanguageVersion="5"` cannot even be activated otherwise.

The `clean-core-check` prompt combines it with ATC: `packageTree` to enumerate sources, `apiReleaseState(sourceUrl, edition="cloud")` per source, `createAtcRun(variant="ABAP_CLOUD_DEVELOPMENT_DEFAULT")` plus `atcWorklists` for the syntax-level checks, and a per-object report without changing code. `runSnippet` on a cloud tenant is the practical proof: a snippet that activates under ABAP for Cloud Development in a customer package (with `transport` and `responsible`) only compiles against released objects.

## 10. Refactoring

Rename and extract method are evaluate, preview, execute; change package is preview and execute. The object returned by one step is passed unchanged to the next. The `refactoring` toolset is not in `focused` and needs `/sap/bc/adt/refactorings` on the backend.

```text
renameEvaluate(uri="/sap/bc/adt/oo/classes/zcl_example/source/main", line=12, startColumn=11, endColumn=19)   -> result (the rename proposal; set its new name)
renamePreview(renameRefactoring=<proposal with newName>, transport="DEVK900123")                                -> result (the refactoring with affected objects)
renameExecute(refactoring=<preview result>)
```

```text
extractMethodEvaluate(uri="/sap/bc/adt/oo/classes/zcl_example/source/main", range='{"start":{"line":30,"column":0},"end":{"line":38,"column":14}}')   -> proposal (set name, visibility, parameters)
extractMethodPreview(proposal=<edited proposal JSON>)                                                                                                  -> refactoring
extractMethodExecute(refactoring=<preview result JSON>)
```

`extractMethodEvaluate` is retried once in a stateless request when the backend answers "No selection supplied" in the stateful session (a live finding). Both executes run under the transport carried in the refactoring.

```text
changePackagePreview(objectUrl="/sap/bc/adt/oo/classes/zcl_example", oldPackage="ZEXAMPLE", newPackage="ZEXAMPLE_SUB", transport="DEVK900123")   -> refactoring, next: changePackageExecute
changePackageExecute(refactoring=<preview result>)
```

The transport is required when the target package is transportable. All three executes are destructive. After `changePackageExecute` and `renameExecute` (as after `createObject`, `deleteObject`, `gitPullRepo` and `rapGenGenerate`) the server clears the object-to-package memo that `allowedPackages` relies on, so the next policy check sees the new package. Run `unitTestRun` after every execute, as the live test plan did.

## 11. abapGit and local exports

The `git` toolset needs `/sap/bc/adt/abapgit/repos` on the backend. Remote credentials come from the destination's `gitUser`/`gitPassword` in `systems.json` whenever a call omits `user`/`password`, so tokens never pass through the conversation; arguments win when given. A destination with `allowedPackages` refuses `gitPullRepo`, because the pull cannot tell which packages it will write.

| Step | Call | Answer |
|---|---|---|
| List | `gitRepos()` | `repos`: linked repositories with their id, package, URL, branch. |
| Inspect a remote | `gitExternalRepoInfo(repourl="https://github.com/org/repo.git")` | `repoInfo`: branches and access type before linking. |
| Link | `gitCreateRepo(packageName="ZEXAMPLE", repourl="...", branch="refs/heads/main", transport="DEVK900123")` | Creates the link (the online repository object). |
| Pull | `gitPullRepo(repoId="<id>", branch="refs/heads/main", transport="DEVK900123", startIndex, maxItems)` | The imported and changed objects; the pull has already happened when the list is paged, so paging only limits the report. Follow with `activatePackage` (section 3, step 4; the recipe in section 14). |
| Check | `checkRepo(repo="<id>")`, `remoteRepoInfo(repo="<id>")` | Consistency check and remote branches. |
| Stage and push | `stageRepo(repo=<repo object from gitRepos>, startIndex, maxItems)` then `pushRepo(repo=<repo object>, staging=<staging object with commit message and author>)` | `staged`, `unstaged`, `ignored` lists (paged); edit the staging object (what to commit, message, author) and pass it to `pushRepo`. |
| Branch | `switchRepoBranch(repo="<id>", branch="refs/heads/feature", create=true)` | Switches or creates the branch. |
| Unlink | `gitUnlinkRepo(repoId="<id>")` | Removes the link, keeps the objects. Destructive. |

**Export without git.** `exportPackageSources(packageName="ZEXAMPLE", targetDir="/Users/me/.abap-adt-mcp/exports/zexample", overwrite=false, recursive=true, objectTypes?, maxObjects=500)` reads a package tree and writes it to disk in abapGit file layout so local tools (grep, editors, review pipelines) can work on it. It is read-only on SAP and works on `readOnly` destinations. `targetDir` must be absolute and inside the export root (`MCP_EXPORT_ROOT`, default `~/.abap-adt-mcp/exports`, checked against symlinks). Layout: one folder per package (lower case, `/` in namespaces becomes `#`); `zcl_example.clas.abap` plus `.clas.locals_def.abap`, `.clas.locals_imp.abap`, `.clas.testclasses.abap` and `.clas.macros.abap` when those includes have content; `zif_example.intf.abap`, `zexample_report.prog.abap`, `zi_example.ddls.asddls`, `.dcls.asdcls`, `.ddlx.asddlxs`, `.bdef.asbdef`, `.srvd.srvdsrv`; `zfg_example.fugr.z_example_fm.abap` for function modules; an `EXPORT.json` manifest with `skipped` (not exportable, or existing when `overwrite=false`) and `failed`. The answer carries `targetDir`, `packages`, `objects`, `objectsTruncated`, `filesWritten`, `bytes`, `exportableTypes`, the first 50 `skipped`, the first 20 `failed` and the first 200 file names in `files`. Add the tool to `deniedTools` on destinations whose source must not leave SAP.

## 12. RAP generator and service bindings

The `rap` toolset needs `/sap/bc/adt/businessservices/generators` (absent on the tested cloud tenant, `rapGenIsAvailable` said `false`); `services` needs `/sap/bc/adt/businessservices/bindings`.

```text
rapGenIsAvailable(genId="uiservice")                                                        -> true/false
rapGenValidateInitial(genId="uiservice", refObjectUri="/sap/bc/adt/ddic/tables/ztravel", packageName="ZEXAMPLE")
rapGenGetSchema(genId, refObjectUri, packageName)                                            -> JSON schema of the content
rapGenGetContent(genId, refObjectUri, packageName)                                           -> proposed names (CDS entities, behavior class, service definition and binding)
rapGenValidateContent(genId, refObjectUri, content=<adjusted content JSON>)
rapGenPreview(genId, refObjectUri, content)                                                  -> objects that would be created, nothing created yet
rapGenGenerate(genId, refObjectUri, transport="DEVK900123", content)                         -> generated objects
activatePackage(packageName="ZEXAMPLE")                                                      -> activates the stack together
rapGenPublishService(srvbName="ZUI_TRAVEL_O4")
```

`genId` is `uiservice` (OData UI service) or `webapiservice`; `content` follows the schema from `rapGenGetSchema` (`general`, `businessObject` with `dataModelEntity` and `behavior`, `serviceProjection`, `businessService` with `serviceDefinition` and `serviceBinding`). `rapGenGenerate` requires a transport.

Service bindings: `fetchServiceDetails(name="ZUI_TRAVEL_O4", index=0)` resolves a binding by name (`searchObject` with type `SRVB`) and returns `binding` (name, published, type, version, services) and `details` with service URLs, entity sets, navigations and `previewUrls` (OData V4 bindings the library cannot fully derive degrade to `details: null` with a `note`); `bindingDetails(binding=<parsed binding object or name>, index)` does the same from an object you already have; `publishServiceBinding(name, version="0001")` and `unPublishServiceBinding(name, version)` publish and unpublish. `rapGenGenerate`, `rapGenPublishService`, `publishServiceBinding` and `unPublishServiceBinding` are refused on destinations with `allowedPackages` (no package to check).

## 13. The six MCP prompts

Each prompt renders a user message that names the tools in order and says where it stops. `destination` is the first argument of every prompt and optional (the default destination is used); the rest are positional in the order shown. In Claude Code they are slash commands `/mcp__abap-adt-mcp__<prompt>`.

| Prompt | Arguments (in order) | Sequence it runs |
|---|---|---|
| `create-object` | `destination`, `objectType` (required, e.g. `CLAS/OC`, `INTF/OI`, `PROG/P`, `DDLS/DF`), `name` (required), `package` (required), `purpose` | `systemProfile` if unfamiliar, `loadTypes`, `validateNewObject`, `resolveTransport` on the package URL unless the package is local, `apiReleaseState` on the planned SAP objects (cloud), `createObject` (with `responsible` on cloud), `syntaxCheckCode`, `setObjectSource(activate=true)`, `createTestInclude`, tests via `setObjectSource` on the test include, `unitTestRun`, `createAtcRun` with the project's check variant and quickfixes for priority 1 and 2. Reports object URL, transport, activation and test results. |
| `safe-edit` | `destination`, `object` (name or URL), `change` | `searchObject`/`findObjectPath`, `getObjectSource` or `getMethodSource`, `whereUsed` when a signature or behaviour changes, `resolveTransport`, `editObjectSource(replacements, activate=true)` or `setMethodSource`, fix on activation errors, `unitTestRun`, `apiReleaseState(sourceUrl)` on cloud, `objectDiff` for the report. Stops and asks before `deleteObject`, `transportRelease` or `forceUnlock`. |
| `review-transport` | `destination`, `transport` | `transportDetails`, `transportUnifiedDiff`, `objectDiff` for objects with several revisions, per object: risk notes, `apiReleaseState` on cloud, `unitTestRun`, `createAtcRun(mainUrl="/sap/bc/adt/cts/transportrequests/<transport>", variant=<project variant>)` plus `atcWorklists` (the same run `atcSummary(mainUrl=<transport URL>)` does in one call, section 5). Produces summary, per-object findings, blockers and a go/no-go. Never calls `transportRelease`. |
| `fix-atc` | `destination`, `target` (object URL, package name or transport), `variant` | `createAtcRun` then `atcWorklists`; per finding `atcDocumentation`, `atcQuickfixProposals`/`atcApplyQuickfix` or `editObjectSource`; activate, `unitTestRun`, re-run until priority 1 and 2 are clean. Exemptions (`atcRequestExemption`) only with approval. `variant` is described as "cloud default ABAP_CLOUD_DEVELOPMENT_DEFAULT"; on-prem pass the value from `atcCustomizing`. |
| `clean-core-check` | `destination`, `target` (object name or URL, or package) | `packageTree(objectTypes="CLAS/OC,PROG/P,INTF/OI,DDLS/DF")` or `searchObject`, `apiReleaseState(sourceUrl, edition="cloud")` per source, `createAtcRun(variant="ABAP_CLOUD_DEVELOPMENT_DEFAULT")` (or `ABAP_CLOUD_READINESS` where `atcCheckVariant` confirms it exists) and `atcWorklists`. Reports cloudReady per object, blockers with successors, ATC findings, effort. Changes no code. |
| `debug-dump` | `destination`, `filter` (user, program, exception or time window) | `dumps(maxItems=5)` with the filter mapped to `contains`, `user` or `from`, `dumpDetails`, `getObjectSource` around `terminatedAt.line`, the stack frames' `sourceUrl`, `whereUsed`/`usageReferences`. Explains the root cause and proposes `editObjectSource` replacements without applying them; says whether `resolveTransport` will be needed. |

The prompts assume the variant conventions of section 5: `ABAP_CLOUD_DEVELOPMENT_DEFAULT` on cloud tenants, the system or project variant from `atcCustomizing` on-prem.

## 14. Recipes

Every recipe assumes the implicit login of the conventions section: on an SSO destination the browser opens on the first call, nothing else is needed.

**Fix a bug from a dump**

1. `dumps(user="DEVELOPER", contains="ZCL_EXAMPLE", maxItems=5)`; pick the `dumpId`. Nothing in the window: `feeds()` and `dumps(query=...)`, section 8.
2. `dumpDetails(dumpId)` for the variables and the full stack.
3. `getObjectSource(objectSourceUrl=terminatedAt.objectSourceUrl, startLine=<line-20>, maxLines=40)` to see the termination point; walk the `stack` frames' `sourceUrl` as needed. The URL is already the right include (a class include URL when the crash is in a local or test class).
4. Impact: `whereUsed(name="ZCL_EXAMPLE", objType="CLAS/OC")` for the objects that use the class; when the fix changes the behaviour of one method, `usageReferences(url="<class>/source/main", line=<line of the METHODS declaration>, column=<column of the method name>)` and `usageReferenceSnippets(references=...)` for the call sites of that method only.
5. `resolveTransport(objSourceUrl=<object url>)`.
6. Check, one of: (a) for a small change inside one method, skip the check and rely on `activate=true` in the next step; (b) for anything touching the definition, read the full source (all pages, `startLine` until `hasMore` is false), apply the patch to the assembled text and `syntaxCheckCode(url=<source url>, code=<patched full source>)`; for a class include also pass `mainUrl=<class>/source/main`.
7. `editObjectSource(objectSourceUrl=<the URL from step 3>, replacements=[...], activate=true, transport)`; read `activation`: `success: false` returns the messages with line numbers and leaves the source written but inactive; fix with another `editObjectSource` (activate again).
8. `unitTestRun(url=<class url>)`, `objectDiff(objectUrl=<class url>)` for the report (add `clsInclude="implementations"` or `"testclasses"` when the fix was in an include).
9. Reproduce once with `runSnippet` on a development system when the trigger is reproducible.

**Add a method with tests**

1. `getObjectSource(objectSourceUrl="/sap/bc/adt/oo/classes/zcl_example/source/main")` for the definition and the last method; `objectStructureElements(objectUrl="/sap/bc/adt/oo/classes/zcl_example")` (no `version`: the class is active) when the class is long and you only need the member names.
2. `resolveTransport(objSourceUrl="/sap/bc/adt/oo/classes/zcl_example")`.
3. One `editObjectSource` with two anchors that are unique by construction: the section keyword that follows the public section, and the last method's `ENDMETHOD.` together with the closing `ENDCLASS.` (`ENDCLASS.` alone matches twice, definition and implementation, and fails with the two line numbers):

```text
editObjectSource(
  objectSourceUrl="/sap/bc/adt/oo/classes/zcl_example/source/main",
  replacements=[
    {"oldText": "  PROTECTED SECTION.",
     "newText": "    METHODS new_method\n      IMPORTING iv_key        TYPE string\n      RETURNING VALUE(rv_ok) TYPE abap_bool.\n  PROTECTED SECTION."},
    {"oldText": "  ENDMETHOD.\nENDCLASS.",
     "newText": "  ENDMETHOD.\n\n  METHOD new_method.\n    rv_ok = xsdbool( iv_key IS NOT INITIAL ).\n  ENDMETHOD.\nENDCLASS."}
  ],
  activate=true, transport="DEVK900123")
```

   The second anchor is the only place where `ENDMETHOD.` is directly followed by `ENDCLASS.`; when the class has no protected section, anchor the first replacement on `  PRIVATE SECTION.` or on the `ENDCLASS.` of the definition together with its preceding line. Read `activation`.

4. `classIncludes(clas="ZCL_EXAMPLE")`: when `result.testclasses` is absent, `createTestInclude(clas="ZCL_EXAMPLE", transport="DEVK900123")`; when present, keep its URL.
5. New include: `setObjectSource(objectSourceUrl="/sap/bc/adt/oo/classes/zcl_example/includes/testclasses", source=<test class>, activate=true, transport)`. Existing include: `getObjectSource` on it, then `editObjectSource` with anchors inside the test class (its `ENDCLASS.` is unique when the include holds one local test class; otherwise anchor on the last `ENDMETHOD.` plus `ENDCLASS.` as above), `activate=true`. Either way `activate=true` activates the class with all its includes; no separate activation is needed.
6. `unitTestRun(url="/sap/bc/adt/oo/classes/zcl_example")` (default flags: harmless and short tests; add `flags` with all six keys for medium or dangerous tests). A method with an empty `alerts` array passed; on failures `getMethodSource(classUrl="ZCL_EXAMPLE", methodName=<test method>, include="testclasses", className="LTC_EXAMPLE")` to read and `setMethodSource(..., include="testclasses", className="LTC_EXAMPLE", activate=true, transport)` to adjust.
7. `createAtcRun(variant=<"ABAP_CLOUD_DEVELOPMENT_DEFAULT" on cloud, the atcCustomizing value on-prem>, mainUrl="/sap/bc/adt/oo/classes/zcl_example")` then `atcSummary(runResultId=<id>)`.

**Review a transport before release**

1. `transportDetails(transportNumber="DEVK900123")`: owner, tasks, status, object list.
2. `transportUnifiedDiff(transportNumber="DEVK900123", maxObjects=50)`; read the three cases of section 6: changed objects with `baselineRevision`, new objects shown in full with `baselineRevision: null`, and the `skipped` reasons.
3. For a changed object whose transport diff mixes in later changes (`exactTransportMatch: false`, or a released transport), isolate the change: `revisions(objectUrl)`, find the entry whose `date` equals `baselineRevision.date` in the list sorted newest first, and `objectDiff(objectUrl, fromRevision=<that index>, toRevision=<index of the newest revision whose version is DEVK900123>)`; `clsInclude="testclasses"` for the test include of a class that also appears as `LIMU CINC ... CCAU`.
4. `apiReleaseState(sourceUrl=<each changed source or include URL>)` on cloud.
5. `unitTestRun(url=<each class>)`.
6. `atcSummary(mainUrl="/sap/bc/adt/cts/transportrequests/DEVK900123", variant=<"ABAP_CLOUD_DEVELOPMENT_DEFAULT" on cloud, the project or atcCustomizing variant on-prem>)`, or `createAtcRun(mainUrl=<same URL>, variant=...)` plus `atcWorklists` for the raw findings; same run, two views.
7. Write the go/no-go; `transportRelease(transportNumber)` only on explicit approval (a `deniedTools: ["transportRelease"]` policy keeps it out of reach on shared systems).

**Migrate classic code to cloud-ready APIs**

1. `packageTree(packageName, objectTypes="CLAS/OC,INTF/OI,PROG/P,DDLS/DF", maxDepth=5)` to enumerate.
2. `apiReleaseState(sourceUrl=<source>, edition="cloud")` per object (and per class include that holds local classes); collect `blockers` with their `successors`; for each `unknown` name, `searchObject` to see what it is, then `apiReleaseState(objectUrl=<its URL>)` for the backend's `backendApiRelease`, `ddicElement`/`abapDocumentation` to classify the rest as scan noise.
3. `atcSummary(mainUrl=<package url>, variant="ABAP_CLOUD_DEVELOPMENT_DEFAULT")` (this variant exists on cloud tenants and on on-prem releases that ship the cloud checks; `atcCheckVariant(variant="ABAP_CLOUD_DEVELOPMENT_DEFAULT")` confirms it before the run).
4. Per blocker: `whereUsed(name=<blocker>)` for the call sites, then `editObjectSource` replacements switching to the successor, `activate=true`, `resolveTransport` first.
5. `runSnippet(code=<smoke test of the successor API>, packageName, transport, responsible)` on the cloud development tenant.
6. Re-run `apiReleaseState` and `atcSummary` until `blockers` is empty and priority 1 and 2 are clean; `unitTestRun` throughout.

**Bulk activate after a git pull**

1. `gitRepos()` for the `repoId`; `resolveTransport(objSourceUrl="/sap/bc/adt/packages/<pkg>", devClass, createIfMissing=true)` when the package is transportable.
2. `gitPullRepo(repoId, branch, transport)`.
3. `activatePackage(packageName, recursive=true, user="DEVELOPER")` (pass `user` on SSO and OAuth destinations, or `allUsers=true` knowingly); read `messages` and `stillInactive`.
4. For leftovers, `inactiveObjects()` and `activateObjects(objects=<the entries>)` in dependency order, or fix the source with `editObjectSource(activate=true)`.
5. `unitTestRun` on the pulled classes and `atcSummary(mainUrl=<package url>, variant=...)`.
