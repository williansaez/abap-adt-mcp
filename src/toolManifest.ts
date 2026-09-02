/**
 * Static catalog metadata shared by the server, the contract test and the
 * docs generator: which handler serves each tool, how tools are annotated,
 * and how they group into toolsets that can be switched on/off per host.
 */

export const HANDLER_KEYS = [
  'auth', 'transport', 'object', 'class', 'codeAnalysis', 'objectLock', 'objectSource', 'objectDeletion',
  'objectManagement', 'objectRegistration', 'node', 'discovery', 'unitTest', 'prettyPrinter', 'git', 'ddic',
  'serviceBinding', 'query', 'feed', 'debug', 'rename', 'atc', 'trace', 'refactor', 'revision', 'rapGenerator',
  'navigation', 'textElements',
] as const;
export type HandlerKey = typeof HANDLER_KEYS[number];

/** Tools served by the server itself (no destination handler). */
export const SERVER_TOOLS = ['listSystems', 'healthcheck', 'systemProfile'] as const;

// tool name -> handler key
export const TOOL_ROUTES: Record<HandlerKey, string[]> = {
  auth: ['login', 'logout', 'dropSession'],
  transport: ['transportInfo', 'createTransport', 'hasTransportConfig', 'transportConfigurations',
    'getTransportConfiguration', 'setTransportsConfig', 'createTransportsConfig', 'userTransports',
    'transportsByConfig', 'transportDelete', 'transportRelease', 'transportSetOwner', 'transportAddUser',
    'systemUsers', 'transportReference', 'transportDetails', 'transportUnifiedDiff', 'resolveTransport'],
  objectLock: ['lock', 'unLock', 'listLocks', 'forceUnlock'],
  object: ['objectStructure', 'searchObject', 'findObjectPath', 'objectTypes', 'reentranceTicket'],
  class: ['classIncludes', 'classComponents'],
  codeAnalysis: ['syntaxCheckCode', 'syntaxCheckCdsUrl', 'codeCompletion', 'findDefinition',
    'usageReferences', 'syntaxCheckTypes', 'codeCompletionFull', 'runClass', 'codeCompletionElement',
    'usageReferenceSnippets', 'fixProposals', 'fixEdits', 'fragmentMappings', 'abapDocumentation'],
  objectSource: ['getObjectSource', 'setObjectSource', 'editObjectSource'],
  objectDeletion: ['deleteObject'],
  objectManagement: ['activateObjects', 'activateByName', 'inactiveObjects'],
  objectRegistration: ['objectRegistrationInfo', 'validateNewObject', 'createObject', 'creatableTypeDetails'],
  node: ['nodeContents', 'mainPrograms'],
  discovery: ['featureDetails', 'collectionFeatureDetails', 'findCollectionByUrl', 'loadTypes',
    'adtDiscovery', 'adtCoreDiscovery', 'adtCompatibilityGraph', 'adtCompatibiliyGraph'],
  unitTest: ['unitTestRun', 'unitTestEvaluation', 'unitTestOccurrenceMarkers', 'createTestInclude'],
  prettyPrinter: ['prettyPrinterSetting', 'setPrettyPrinterSetting', 'prettyPrinter'],
  git: ['gitRepos', 'gitExternalRepoInfo', 'gitCreateRepo', 'gitPullRepo', 'gitUnlinkRepo', 'stageRepo',
    'pushRepo', 'checkRepo', 'remoteRepoInfo', 'switchRepoBranch'],
  ddic: ['annotationDefinitions', 'ddicElement', 'ddicRepositoryAccess', 'packageSearchHelp',
    'getDomainProperties', 'setDomainProperties', 'getDataElementProperties', 'setDataElementProperties'],
  serviceBinding: ['publishServiceBinding', 'unPublishServiceBinding', 'bindingDetails', 'fetchServiceDetails'],
  query: ['tableContents', 'runQuery'],
  feed: ['feeds', 'dumps', 'dumpDetails'],
  debug: ['debuggerListeners', 'debuggerListen', 'debuggerDeleteListener', 'debuggerSetBreakpoints',
    'debuggerDeleteBreakpoints', 'debuggerAttach', 'debuggerSaveSettings', 'debuggerStackTrace',
    'debuggerVariables', 'debuggerChildVariables', 'debuggerStep', 'debuggerGoToStack',
    'debuggerSetVariableValue'],
  rename: ['renameEvaluate', 'renamePreview', 'renameExecute'],
  atc: ['atcCustomizing', 'atcCheckVariant', 'createAtcRun', 'atcWorklists', 'atcUsers',
    'atcExemptProposal', 'atcRequestExemption', 'isProposalMessage', 'atcContactUri', 'atcChangeContact',
    'atcQuickfixProposals', 'atcApplyQuickfix', 'atcDocumentation'],
  trace: ['tracesList', 'tracesListRequests', 'tracesHitList', 'tracesDbAccess', 'tracesStatements',
    'tracesSetParameters', 'tracesCreateConfiguration', 'tracesDeleteConfiguration', 'tracesDelete'],
  refactor: ['extractMethodEvaluate', 'extractMethodPreview', 'extractMethodExecute', 'changePackagePreview', 'changePackageExecute'],
  revision: ['revisions'],
  rapGenerator: ['rapGenIsAvailable', 'rapGenGetSchema', 'rapGenGetContent', 'rapGenValidateInitial',
    'rapGenValidateContent', 'rapGenPreview', 'rapGenGenerate', 'rapGenPublishService'],
  navigation: ['typeHierarchy', 'objectStructureElements', 'objectEnhancements'],
  textElements: ['getTextElements', 'setTextElements'],
};

// MCP tool annotations (readOnlyHint/destructiveHint) so hosts can gate approval.
// Tools absent from both sets are writes that create or modify state but are
// recoverable (annotated readOnlyHint:false, destructiveHint:false).
export const READ_ONLY_TOOLS = new Set([
  // transport
  'transportInfo', 'hasTransportConfig', 'transportConfigurations', 'getTransportConfiguration',
  'userTransports', 'transportsByConfig', 'systemUsers', 'transportReference', 'transportDetails',
  'transportUnifiedDiff',
  // object / class / source
  'objectStructure', 'searchObject', 'findObjectPath', 'objectTypes', 'reentranceTicket',
  'classIncludes', 'classComponents', 'getObjectSource', 'inactiveObjects', 'objectRegistrationInfo',
  'validateNewObject', 'creatableTypeDetails',
  // code analysis
  'syntaxCheckCode', 'syntaxCheckCdsUrl', 'codeCompletion', 'findDefinition', 'usageReferences',
  'syntaxCheckTypes', 'codeCompletionFull', 'codeCompletionElement', 'usageReferenceSnippets',
  'fixProposals', 'fragmentMappings', 'abapDocumentation',
  // node / discovery
  'nodeContents', 'mainPrograms', 'featureDetails', 'collectionFeatureDetails', 'findCollectionByUrl',
  'loadTypes', 'adtDiscovery', 'adtCoreDiscovery', 'adtCompatibilityGraph', 'adtCompatibiliyGraph',
  // unit test evaluation (read of results), pretty printer read
  'unitTestEvaluation', 'unitTestOccurrenceMarkers', 'prettyPrinterSetting', 'prettyPrinter',
  // git reads
  'gitRepos', 'gitExternalRepoInfo', 'checkRepo', 'remoteRepoInfo',
  // ddic / services / data
  'annotationDefinitions', 'ddicElement', 'ddicRepositoryAccess', 'packageSearchHelp',
  'getDomainProperties', 'getDataElementProperties', 'typeHierarchy', 'objectStructureElements', 'objectEnhancements',
  'getTextElements', 'atcDocumentation', 'changePackagePreview',
  'bindingDetails', 'fetchServiceDetails', 'tableContents', 'runQuery', 'feeds', 'dumps', 'dumpDetails',
  // debug reads
  'debuggerListeners', 'debuggerStackTrace', 'debuggerVariables', 'debuggerChildVariables',
  // refactoring previews
  'renameEvaluate', 'renamePreview', 'extractMethodEvaluate', 'extractMethodPreview',
  // atc reads
  'atcCustomizing', 'atcCheckVariant', 'atcWorklists', 'atcUsers', 'isProposalMessage', 'atcContactUri',
  'atcQuickfixProposals',
  // traces reads
  'tracesList', 'tracesListRequests', 'tracesHitList', 'tracesDbAccess', 'tracesStatements',
  // misc
  'revisions', 'listLocks', 'rapGenIsAvailable', 'rapGenGetSchema', 'rapGenGetContent', 'rapGenValidateInitial',
  'rapGenValidateContent', 'rapGenPreview', 'listSystems', 'healthcheck', 'systemProfile',
]);

export const DESTRUCTIVE_TOOLS = new Set([
  'deleteObject', 'transportDelete', 'transportRelease', 'setObjectSource', 'editObjectSource', 'atcApplyQuickfix', 'gitUnlinkRepo',
  'pushRepo', 'runClass', 'renameExecute', 'extractMethodExecute', 'changePackageExecute', 'debuggerSetVariableValue',
  'tracesDelete', 'tracesDeleteConfiguration', 'unPublishServiceBinding', 'dropSession',
  'setDomainProperties', 'setDataElementProperties', 'setTextElements', 'forceUnlock',
]);

export function toolAnnotations(name: string) {
  const readOnly = READ_ONLY_TOOLS.has(name);
  return {
    readOnlyHint: readOnly,
    destructiveHint: DESTRUCTIVE_TOOLS.has(name),
    idempotentHint: readOnly,
    openWorldHint: false,
  };
}

/**
 * Toolsets: named groups of handlers a host can enable. `core` is always on.
 * Names follow the domains of docs/TOOLS.md.
 */
export const TOOLSETS: Record<string, { title: string; handlers: HandlerKey[]; description: string }> = {
  core:        { title: 'Destinations, health & session', handlers: ['auth'], description: 'listSystems, healthcheck, systemProfile, login/logout/dropSession (always enabled)' },
  source:      { title: 'Source code', handlers: ['objectSource', 'objectLock', 'prettyPrinter', 'revision', 'textElements'], description: 'read/write/edit source, lock/unlock, pretty printer, revisions, text elements' },
  objects:     { title: 'Objects & navigation', handlers: ['object', 'class', 'node', 'navigation', 'objectRegistration', 'objectDeletion', 'objectManagement'], description: 'search, structure, create/delete/activate objects, class components, hierarchy, enhancements' },
  transports:  { title: 'Transports', handlers: ['transport'], description: 'transport requests, diffs, release' },
  analysis:    { title: 'Syntax & code analysis', handlers: ['codeAnalysis'], description: 'syntax check, completion, where-used, fixes, ABAP docs, runClass' },
  tests:       { title: 'Unit tests', handlers: ['unitTest'], description: 'ABAP Unit runs and evaluation' },
  atc:         { title: 'ATC', handlers: ['atc'], description: 'ATC runs, findings, exemptions, quickfixes' },
  data:        { title: 'Data access & DDIC', handlers: ['query', 'ddic'], description: 'table contents, SQL queries, DDIC elements, domains, data elements' },
  discovery:   { title: 'Discovery & metadata', handlers: ['discovery'], description: 'ADT discovery, object types, feature details' },
  runtime:     { title: 'Runtime errors', handlers: ['feed'], description: 'feeds, short dumps and dump details' },
  refactoring: { title: 'Refactoring', handlers: ['rename', 'refactor'], description: 'rename, extract method, change package' },
  rap:         { title: 'RAP generation', handlers: ['rapGenerator'], description: 'RAP generator framework' },
  services:    { title: 'Business services', handlers: ['serviceBinding'], description: 'OData service bindings' },
  git:         { title: 'abapGit', handlers: ['git'], description: 'abapGit repositories, pull/push/stage' },
  debugger:    { title: 'Debugger', handlers: ['debug'], description: 'ADT debugger listeners, breakpoints, stepping, variables' },
  traces:      { title: 'Traces', handlers: ['trace'], description: 'ABAP runtime traces' },
};

export const TOOLSET_PRESETS: Record<string, string[]> = {
  all: Object.keys(TOOLSETS),
  focused: ['core', 'source', 'objects', 'transports', 'analysis', 'tests', 'atc', 'data', 'runtime'],
};

export interface ToolsetSelection {
  active: string[];
  disabled: string[];
  enabledTools: Set<string>;
  toolsetOf: Map<string, string>;
}

function splitList(v: string | undefined): string[] {
  return String(v || '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Resolve MCP_TOOLSETS (comma list or a preset name: all, focused) and
 * MCP_DISABLED_TOOLSETS into the set of enabled tool names. Throws on unknown
 * names so a typo does not silently hide tools. `core` cannot be disabled.
 */
export function resolveToolsets(env: NodeJS.ProcessEnv = process.env): ToolsetSelection {
  const valid = Object.keys(TOOLSETS);
  const check = (names: string[], what: string) => {
    const bad = names.filter(n => !valid.includes(n));
    if (bad.length) throw new Error(`${what} names unknown toolset(s): ${bad.join(', ')}. Valid: ${valid.join(', ')}; presets: ${Object.keys(TOOLSET_PRESETS).join(', ')}`);
  };
  let active: string[];
  const requested = splitList(env.MCP_TOOLSETS);
  if (requested.length === 0) {
    active = TOOLSET_PRESETS.all;
  } else if (requested.length === 1 && TOOLSET_PRESETS[requested[0]]) {
    active = [...TOOLSET_PRESETS[requested[0]]];
  } else {
    check(requested, 'MCP_TOOLSETS');
    active = requested;
  }
  const disabled = splitList(env.MCP_DISABLED_TOOLSETS);
  check(disabled, 'MCP_DISABLED_TOOLSETS');
  active = Array.from(new Set(['core', ...active.filter(a => !disabled.includes(a))]));

  const toolsetOf = new Map<string, string>();
  for (const [name, def] of Object.entries(TOOLSETS)) {
    for (const key of def.handlers) for (const tool of TOOL_ROUTES[key]) toolsetOf.set(tool, name);
  }
  for (const t of SERVER_TOOLS) toolsetOf.set(t, 'core');
  const enabledTools = new Set<string>();
  for (const [tool, ts] of toolsetOf) if (active.includes(ts)) enabledTools.add(tool);
  return { active, disabled: disabled.filter(d => d !== 'core'), enabledTools, toolsetOf };
}
