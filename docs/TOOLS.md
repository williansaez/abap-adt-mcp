# Tool reference (142 tools)

Generated from the live `tools/list` response of the built server (v0.3.0).

Every tool (except `listSystems`/`healthcheck`) also accepts an optional `destination` parameter naming the configured system to target; without it, the default destination is used.

Legend: 📖 read-only · ✏️ writes · ⚠️ destructive (flags come from the MCP tool annotations the server publishes, so hosts can gate approvals).


## Destinations & health (2)

| Tool | What it does | Key parameters |
|---|---|---|
| 📖 `listSystems` | List the configured ABAP systems (destinations) this server can reach. Call this first to pick the destination to pass to all other tools. | — |
| 📖 `healthcheck` | Check server health and list configured destinations. | — |

## Auth & session (4)

| Tool | What it does | Key parameters |
|---|---|---|
| ✏️ `login` | Authenticate with ABAP system | — |
| ✏️ `logout` | Terminate ABAP session | — |
| ⚠️ `dropSession` | Clear local session cache | — |
| 📖 `reentranceTicket` | Retrieves an SAP reentrance ticket. WARNING: the ticket is a live logon credential and will appear in the conversation/host logs. Disabled unless the server is started with SAP_ALLOW_REENTRANCE_TICKET=1. | — |

## Discovery & metadata (13)

| Tool | What it does | Key parameters |
|---|---|---|
| 📖 `loadTypes` | List the ABAP object types creatable on this system (version-aware). Use BEFORE createObject to pick a valid objtype value such as CLAS/OC. For the raw ADT type catalog see objectTypes. | — |
| 📖 `objectTypes` | Retrieve the ADT object type catalog reported by the system. For picking an objtype to pass to createObject, prefer loadTypes (creatable types). | — |
| 📖 `creatableTypeDetails` | List the object types createObject supports, with per-type required fields, label and max name length (SAP-style get_object_type_details). Filter with typeId. For the system-reported creatable catalog see loadTypes. | `typeId` |
| 📖 `adtDiscovery` | Performs ADT discovery. | — |
| 📖 `adtCoreDiscovery` | Performs ADT core discovery. | — |
| 📖 `adtCompatibilityGraph` | Retrieves the ADT compatibility graph. | — |
| 📖 `featureDetails` | Retrieves details for a given feature. | `title`* |
| 📖 `collectionFeatureDetails` | Retrieves details for a given collection feature. | `url`* |
| 📖 `findCollectionByUrl` | Finds a collection by its URL. | `url`* |
| 📖 `objectRegistrationInfo` | Get registration information for an ABAP object | `objectUrl`* |
| 📖 `feeds` | Retrieves a list of feeds. | — |
| 📖 `dumps` | Retrieves a list of dumps. | `query` |
| 📖 `systemUsers` | Retrieves a list of system users. | — |

## Object navigation (9)

| Tool | What it does | Key parameters |
|---|---|---|
| 📖 `searchObject` | Search for objects | `query`*, `objType`, `max` |
| 📖 `objectStructure` | Get object structure details | `objectUrl`*, `version` |
| 📖 `findObjectPath` | Find path for an object | `objectUrl`* |
| 📖 `nodeContents` | Retrieves the contents of a node in the ABAP repository tree. | `parent_type`*, `parent_name`, `user_name`, `parent_tech_name`, `rebuild_tree`, `parentnodes` |
| 📖 `mainPrograms` | Retrieves the main programs for a given include. | `includeUrl`* |
| 📖 `classIncludes` | Get class includes structure | `clas`* |
| 📖 `classComponents` | List class components | `url`* |
| 📖 `packageSearchHelp` | Performs a package search help. | `type`*, `name` |
| 📖 `annotationDefinitions` | Retrieves annotation definitions. | — |

## Object creation & deletion (4)

| Tool | What it does | Key parameters |
|---|---|---|
| 📖 `validateNewObject` | Validate name, package and type for a new ABAP object BEFORE calling createObject. Returns field-level validation errors. Use loadTypes to discover valid objtype values first. | `objtype`*, `objname`*, `description`*, `packagename`, `fugrname` |
| ✏️ `createObject` | Create a new ABAP object skeleton. Recommended flow: loadTypes to pick objtype (e.g. CLAS/OC) -> validateNewObject to check name/package -> createTransport if the package is not local ($TMP) -> createObject. Afterward... | `objtype`*, `name`*, `parentName`*, `description`*, `parentPath`*, `responsible`, `transport` |
| ✏️ `createTestInclude` | Creates a test include for a class. | `clas`*, `lockHandle`*, `transport` |
| ⚠️ `deleteObject` | Deletes an ABAP object from the system | `objectUrl`*, `lockHandle`*, `transport` |

## Source code (8)

| Tool | What it does | Key parameters |
|---|---|---|
| 📖 `getObjectSource` | Retrieves source code for ABAP objects. For large objects, use startLine/maxLines to page through the source instead of retrieving it all at once. | `objectSourceUrl`*, `options`, `startLine`, `maxLines` |
| ⚠️ `setObjectSource` | Write source code of an ABAP object. Flow: lock the object first (lock returns the lockHandle), setObjectSource, then unLock and activate with activateByName. Run syntaxCheckCode before writing to catch errors early. | `objectSourceUrl`*, `source`*, `lockHandle`*, `transport` |
| ✏️ `lock` | Lock an ABAP object for editing. Returns the lockHandle required by setObjectSource, deleteObject and unLock. Always unLock when done. | `objectUrl`*, `accessMode` |
| ✏️ `unLock` | Unlock an ABAP object previously locked with lock (requires its lockHandle). | `objectUrl`*, `lockHandle`* |
| 📖 `prettyPrinter` | Formats ABAP code using the pretty printer. | `source`* |
| 📖 `prettyPrinterSetting` | Retrieves the pretty printer settings. | — |
| ✏️ `setPrettyPrinterSetting` | Sets the pretty printer settings. | `indent`*, `style`* |
| 📖 `revisions` | Retrieves revisions for an object. | `objectUrl`*, `clsInclude` |

## Activation (3)

| Tool | What it does | Key parameters |
|---|---|---|
| ✏️ `activateObjects` | Activate ABAP objects using object references. Run after setObjectSource; the entries returned by inactiveObjects can be passed here directly. For a single object, activateByName is simpler. | `objects`*, `preauditRequested` |
| ✏️ `activateByName` | Activate a single ABAP object by name and URL. Run after setObjectSource (and unLock); after activation run unitTestRun to verify behavior. | `objectName`*, `objectUrl`*, `mainInclude`, `preauditRequested` |
| 📖 `inactiveObjects` | Get list of inactive objects | — |

## Transports (16)

| Tool | What it does | Key parameters |
|---|---|---|
| 📖 `transportInfo` | Get transport information for an object source | `objSourceUrl`*, `devClass`, `operation` |
| ✏️ `createTransport` | Create a new transport request. Required before creating or changing objects in transportable (non-$TMP) packages; pass the returned transport number to createObject / setObjectSource. Use transportInfo to find existi... | `objSourceUrl`*, `REQUEST_TEXT`*, `DEVCLASS`*, `transportLayer` |
| 📖 `transportDetails` | Get the contents of a transport request: tasks, owners, status and the full list of objects it records. Use transportInfo / userTransports to find transport numbers first. | `transportNumber`* |
| 📖 `transportUnifiedDiff` | Generate a unified diff of the source-code objects recorded on a transport request: for each object it compares the version predating the transport against the current source. Useful for reviewing what a transport cha... | `transportNumber`*, `maxObjects` |
| 📖 `userTransports` | Retrieves transports for a user. | `user`*, `targets` |
| 📖 `transportsByConfig` | Retrieves transports by configuration. | `configUri`*, `targets` |
| ⚠️ `transportRelease` | Releases a transport. | `transportNumber`*, `ignoreLocks`, `IgnoreATC` |
| ⚠️ `transportDelete` | Deletes a transport. | `transportNumber`* |
| ✏️ `transportAddUser` | Adds a user to a transport. | `transportNumber`*, `user`* |
| ✏️ `transportSetOwner` | Sets the owner of a transport. | `transportNumber`*, `targetuser`* |
| 📖 `transportReference` | Retrieves a transport reference. | `pgmid`*, `obj_wbtype`*, `obj_name`*, `tr_number` |
| 📖 `transportConfigurations` | Retrieves transport configurations. | — |
| 📖 `getTransportConfiguration` | Retrieves a specific transport configuration. | `url`* |
| ✏️ `setTransportsConfig` | Sets transport configurations. | `uri`*, `etag`*, `config`* |
| ✏️ `createTransportsConfig` | Creates transport configurations. | — |
| 📖 `hasTransportConfig` | Check if transport configuration exists | — |

## Syntax & code analysis (13)

| Tool | What it does | Key parameters |
|---|---|---|
| 📖 `syntaxCheckCode` | Perform ABAP syntax check. Provide the source in "code", or omit it to reuse the source last read/written for "url" via getObjectSource/setObjectSource (cached this session). | `code`, `url`*, `mainUrl`, `mainProgram`, `version` |
| 📖 `syntaxCheckCdsUrl` | Perform ABAP syntax check with CDS URL | `cdsUrl`* |
| 📖 `syntaxCheckTypes` | Retrieves syntax check types. | — |
| 📖 `codeCompletion` | Get code completion suggestions | `sourceUrl`*, `source`*, `line`*, `column`* |
| 📖 `codeCompletionFull` | Performs full code completion. | `sourceUrl`*, `source`*, `line`*, `column`*, `patternKey`* |
| 📖 `codeCompletionElement` | Retrieves code completion element information. | `sourceUrl`*, `source`*, `line`*, `column`* |
| 📖 `findDefinition` | Find symbol definition | `url`*, `source`*, `line`*, `startCol`*, `endCol`*, `implementation`, `mainProgram` |
| 📖 `usageReferences` | Find symbol references | `url`*, `line`, `column` |
| 📖 `usageReferenceSnippets` | Retrieves usage reference snippets. | `references`* |
| 📖 `fixProposals` | Retrieves fix proposals. | `url`*, `source`*, `line`*, `column`* |
| ✏️ `fixEdits` | Applies fix edits. | `proposal`*, `source`* |
| 📖 `fragmentMappings` | Retrieves fragment mappings. | `url`*, `type`*, `name`* |
| 📖 `abapDocumentation` | Retrieves ABAP documentation. | `objectUri`*, `body`*, `line`*, `column`*, `language` |

## Unit tests (3)

| Tool | What it does | Key parameters |
|---|---|---|
| ✏️ `unitTestRun` | Run ABAP unit tests for an object. ALWAYS run after adding tests or changing and activating source code. Tests live in the testclass include (see createTestInclude). | `url`*, `flags` |
| 📖 `unitTestEvaluation` | Evaluates unit test results. | `clas`*, `flags` |
| 📖 `unitTestOccurrenceMarkers` | Retrieves unit test occurrence markers. | `url`*, `source`* |

## ATC (ABAP Test Cockpit) (12)

| Tool | What it does | Key parameters |
|---|---|---|
| 📖 `atcCustomizing` | Retrieves ATC customizing information. | — |
| 📖 `atcCheckVariant` | Retrieves information about an ATC check variant. | `variant`* |
| ✏️ `createAtcRun` | Creates an ATC run. | `variant`*, `mainUrl`*, `maxResults` |
| 📖 `atcWorklists` | Retrieves ATC worklists. | `runResultId`*, `timestamp`, `usedObjectSet`, `includeExempted` |
| 📖 `atcUsers` | Retrieves a list of ATC users. | — |
| ✏️ `atcExemptProposal` | Retrieves an ATC exemption proposal. | `markerId`* |
| ✏️ `atcRequestExemption` | Requests an ATC exemption. | `proposal`* |
| 📖 `isProposalMessage` | Checks if a given object is a proposal message. | `proposal`* |
| 📖 `atcContactUri` | Retrieves the contact URI for an ATC finding. | `findingUri`* |
| ✏️ `atcChangeContact` | Changes the contact for an ATC finding. | `itemUri`*, `userId`* |
| 📖 `atcQuickfixProposals` | List the quickfix proposals available at an ATC finding location. Pass the source URL and position from an atcWorklists finding. Apply a proposal with atcApplyQuickfix. Read-only. | `objectSourceUrl`*, `line`*, `column`* |
| ⚠️ `atcApplyQuickfix` | Apply a deterministic quickfix at an ATC finding location: recomputes the proposals (see atcQuickfixProposals), applies the chosen one to the source and writes it back with setObjectSource. Requires the object to be l... | `objectSourceUrl`*, `line`*, `column`*, `proposalIndex`, `lockHandle`*, `transport` |

## RAP generation (8)

| Tool | What it does | Key parameters |
|---|---|---|
| 📖 `rapGenIsAvailable` | Check whether RAP repository-object generators are available on this system. Call before the other rapGen* tools. | `genId` |
| 📖 `rapGenGetSchema` | Get the JSON schema describing the input content of a RAP generator. Use it to build the content for rapGenValidateContent / rapGenPreview / rapGenGenerate. | `genId`*, `refObjectUri`*, `packageName`* |
| 📖 `rapGenGetContent` | Get the proposed default generator content (names for CDS entities, behavior class, service definition/binding) for a reference object. Adjust and pass to rapGenValidateContent / rapGenGenerate. | `genId`*, `refObjectUri`*, `packageName`* |
| 📖 `rapGenValidateInitial` | Validate that generation can start from the given reference object and package (run before rapGenGetContent). | `genId`*, `refObjectUri`*, `packageName`* |
| 📖 `rapGenValidateContent` | Validate a full generator content (names, package, conflicts) BEFORE generating. Recommended flow: rapGenGetContent -> adjust -> rapGenValidateContent -> rapGenPreview -> rapGenGenerate. | `genId`*, `refObjectUri`*, `content`* |
| 📖 `rapGenPreview` | Preview the list of repository objects a generation would create (CDS views, behavior definition, service definition/binding) without creating anything. | `genId`*, `refObjectUri`*, `content`* |
| ✏️ `rapGenGenerate` | Generate the RAP repository objects (CDS views, behavior definition, service definition/binding) on the system. Requires a transport (createTransport). Validate with rapGenValidateContent and inspect rapGenPreview fir... | `genId`*, `refObjectUri`*, `transport`*, `content`* |
| ✏️ `rapGenPublishService` | Publish a generated service binding so its OData service becomes callable (alternative to publishServiceBinding for rapGen-created bindings). | `srvbName`* |

## Business services (OData) (4)

| Tool | What it does | Key parameters |
|---|---|---|
| 📖 `fetchServiceDetails` | Fetch the OData services of a service binding BY NAME: service URLs, entity sets, navigations and preview URLs. Resolves the binding internally, so no prior objectStructure call is needed (name-based equivalent of bin... | `name`*, `index` |
| 📖 `bindingDetails` | Retrieves details of a service binding from an already-parsed ServiceBinding object. If you only have the binding name, use fetchServiceDetails instead. | `binding`*, `index` |
| ✏️ `publishServiceBinding` | Publishes a service binding. | `name`*, `version`* |
| ⚠️ `unPublishServiceBinding` | Unpublishes a service binding. | `name`*, `version`* |

## Refactoring (6)

| Tool | What it does | Key parameters |
|---|---|---|
| 📖 `renameEvaluate` | Evaluates a rename refactoring. | `uri`*, `line`*, `startColumn`*, `endColumn`* |
| 📖 `renamePreview` | Previews a rename refactoring. | `renameRefactoring`*, `transport` |
| ⚠️ `renameExecute` | Executes a rename refactoring. | `refactoring`* |
| 📖 `extractMethodEvaluate` | Evaluates an extract method refactoring. | `uri`*, `range`* |
| 📖 `extractMethodPreview` | Previews an extract method refactoring. | `proposal`* |
| ⚠️ `extractMethodExecute` | Executes an extract method refactoring. | `refactoring`* |

## Data access (4)

| Tool | What it does | Key parameters |
|---|---|---|
| 📖 `tableContents` | Retrieves the contents of an ABAP table. | `ddicEntityName`*, `rowNumber`, `decode`, `sqlQuery` |
| 📖 `runQuery` | Runs a SQL query on the target system. | `sqlQuery`*, `rowNumber`, `decode` |
| 📖 `ddicElement` | Retrieves information about a DDIC element. | `path`*, `getTargetForAssociation`, `getExtensionViews`, `getSecondaryObjects` |
| 📖 `ddicRepositoryAccess` | Accesses the DDIC repository. | `path`* |

## Run & execute (1)

| Tool | What it does | Key parameters |
|---|---|---|
| ⚠️ `runClass` | Runs a class. | `className`* |

## abapGit (10)

| Tool | What it does | Key parameters |
|---|---|---|
| 📖 `gitRepos` | Retrieves a list of Git repositories. | — |
| ✏️ `gitCreateRepo` | Creates a new Git repository. | `packageName`*, `repourl`*, `branch`, `transport`, `user`, `password` |
| ✏️ `gitPullRepo` | Pulls changes from a Git repository. | `repoId`*, `branch`, `transport`, `user`, `password` |
| ⚠️ `gitUnlinkRepo` | Unlinks a Git repository. | `repoId`* |
| 📖 `checkRepo` | Checks a Git repository. | `repo`*, `user`, `password` |
| ⚠️ `pushRepo` | Pushes changes to a Git repository. | `repo`*, `staging`*, `user`, `password` |
| ✏️ `stageRepo` | Stages changes in a Git repository. | `repo`*, `user`, `password` |
| ✏️ `switchRepoBranch` | Switches the branch of a Git repository. | `repo`*, `branch`*, `create`, `user`, `password` |
| 📖 `remoteRepoInfo` | Retrieves information about a remote Git repository. | `repo`*, `user`, `password` |
| 📖 `gitExternalRepoInfo` | Retrieves information about an external Git repository. | `repourl`*, `user`, `password` |

## Debugger (13)

| Tool | What it does | Key parameters |
|---|---|---|
| ✏️ `debuggerListen` | Listens for debugging events. | `debuggingMode`*, `terminalId`*, `ideId`*, `user`*, `checkConflict`, `isNotifiedOnConflict` |
| 📖 `debuggerListeners` | Retrieves a list of debugger listeners. | `debuggingMode`*, `terminalId`*, `ideId`*, `user`*, `checkConflict` |
| ✏️ `debuggerDeleteListener` | Stops a debug listener. | `debuggingMode`*, `terminalId`*, `ideId`*, `user`* |
| ✏️ `debuggerSetBreakpoints` | Sets breakpoints. | `debuggingMode`*, `terminalId`*, `ideId`*, `clientId`*, `breakpoints`*, `user`*, `scope`, `systemDebugging`, `deactivated`, `syncScupeUrl` |
| ✏️ `debuggerDeleteBreakpoints` | Deletes breakpoints. | `breakpoint`*, `debuggingMode`*, `terminalId`*, `ideId`*, `requestUser`*, `scope` |
| ✏️ `debuggerAttach` | Attaches the debugger. | `debuggingMode`*, `debuggeeId`*, `user`*, `dynproDebugging` |
| ✏️ `debuggerSaveSettings` | Saves debugger settings. | `settings`* |
| 📖 `debuggerStackTrace` | Retrieves the debugger stack trace. | `semanticURIs` |
| 📖 `debuggerVariables` | Retrieves debugger variables. | `parents`* |
| 📖 `debuggerChildVariables` | Retrieves child variables of a debugger variable. | `parent` |
| ✏️ `debuggerStep` | Performs a debugger step. | `steptype`*, `url` |
| ✏️ `debuggerGoToStack` | Navigates to a specific stack entry in the debugger. | `urlOrPosition`* |
| ⚠️ `debuggerSetVariableValue` | Sets the value of a debugger variable. | `variableName`*, `value`* |

## Traces (9)

| Tool | What it does | Key parameters |
|---|---|---|
| 📖 `tracesList` | Retrieves a list of traces. | `user` |
| 📖 `tracesListRequests` | Retrieves a list of trace requests. | `user` |
| 📖 `tracesHitList` | Retrieves the hit list for a trace. | `id`*, `withSystemEvents` |
| 📖 `tracesDbAccess` | Retrieves database access information for a trace. | `id`*, `withSystemEvents` |
| 📖 `tracesStatements` | Retrieves statements for a trace. | `id`*, `options` |
| ✏️ `tracesSetParameters` | Sets trace parameters. | `parameters`* |
| ✏️ `tracesCreateConfiguration` | Creates a trace configuration. | `config`* |
| ⚠️ `tracesDeleteConfiguration` | Deletes a trace configuration. | `id`* |
| ⚠️ `tracesDelete` | Deletes a trace. | `id`* |

`*` = required. Full JSON schemas come from the MCP `tools/list` call at runtime.

