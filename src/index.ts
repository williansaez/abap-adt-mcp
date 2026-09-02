#!/usr/bin/env node

import { config } from 'dotenv';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from 'http';
import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import { ADTClient, session_types } from "abap-adt-api";
import path from 'path';
import { makeBearerFetcher } from './lib/oauth.js';
import { CookieHttpClient } from './lib/cookieHttpClient.js';
import { browserLogin } from './lib/browserLogin.js';
import { readSystems, defaultDestination, SystemConfig } from './lib/systems.js';
import { classifyAdtError } from './lib/adtErrorHints.js';
import { AuthHandlers } from './handlers/AuthHandlers.js';
import { TransportHandlers } from './handlers/TransportHandlers.js';
import { ObjectHandlers } from './handlers/ObjectHandlers.js';
import { ClassHandlers } from './handlers/ClassHandlers.js';
import { CodeAnalysisHandlers } from './handlers/CodeAnalysisHandlers.js';
import { ObjectLockHandlers } from './handlers/ObjectLockHandlers.js';
import { ObjectSourceHandlers } from './handlers/ObjectSourceHandlers.js';
import { ObjectDeletionHandlers } from './handlers/ObjectDeletionHandlers.js';
import { ObjectManagementHandlers } from './handlers/ObjectManagementHandlers.js';
import { ObjectRegistrationHandlers } from './handlers/ObjectRegistrationHandlers.js';
import { NodeHandlers } from './handlers/NodeHandlers.js';
import { DiscoveryHandlers } from './handlers/DiscoveryHandlers.js';
import { UnitTestHandlers } from './handlers/UnitTestHandlers.js';
import { PrettyPrinterHandlers } from './handlers/PrettyPrinterHandlers.js';
import { GitHandlers } from './handlers/GitHandlers.js';
import { DdicHandlers } from './handlers/DdicHandlers.js';
import { ServiceBindingHandlers } from './handlers/ServiceBindingHandlers.js';
import { QueryHandlers } from './handlers/QueryHandlers.js';
import { FeedHandlers } from './handlers/FeedHandlers.js';
import { DebugHandlers } from './handlers/DebugHandlers.js';
import { RenameHandlers } from './handlers/RenameHandlers.js';
import { AtcHandlers } from './handlers/AtcHandlers.js';
import { TraceHandlers } from './handlers/TraceHandlers.js';
import { RefactorHandlers } from './handlers/RefactorHandlers.js';
import { RevisionHandlers } from './handlers/RevisionHandlers.js';
import { RapGeneratorHandlers } from './handlers/RapGeneratorHandlers.js';
import { NavigationHandlers } from './handlers/NavigationHandlers.js';
import { TextElementHandlers } from './handlers/TextElementHandlers.js';

// Single source of truth for the version announced to MCP hosts (dist/ sits one level below package.json).
const PACKAGE_VERSION: string = require("../package.json").version;

config({ path: path.resolve(__dirname, '../.env') });

/**
 * Strip credential material from error text before it reaches the model/host.
 * Upstream HTTP errors can echo request headers or URLs with embedded secrets.
 */
function redactSecrets(text: string): string {
  return String(text)
    .replace(/(authorization\s*[:=]\s*)(?:basic|bearer)?\s*[^\s,;"']+/gi, '$1[REDACTED]')
    .replace(/((?:cookie|set-cookie)\s*[:=]\s*)[^\n"']+/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|client_secret|clientsecret|sap-password)\s*[=:]\s*)[^\s&,;"']+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\/\s:@]+:[^\/\s:@]+@/gi, '$1[REDACTED]@');
}

/** All per-domain handlers, one set bound to a single system's ADTClient. */
interface HandlerSet {
  auth: AuthHandlers;
  transport: TransportHandlers;
  object: ObjectHandlers;
  class: ClassHandlers;
  codeAnalysis: CodeAnalysisHandlers;
  objectLock: ObjectLockHandlers;
  objectSource: ObjectSourceHandlers;
  objectDeletion: ObjectDeletionHandlers;
  objectManagement: ObjectManagementHandlers;
  objectRegistration: ObjectRegistrationHandlers;
  node: NodeHandlers;
  discovery: DiscoveryHandlers;
  unitTest: UnitTestHandlers;
  prettyPrinter: PrettyPrinterHandlers;
  git: GitHandlers;
  ddic: DdicHandlers;
  serviceBinding: ServiceBindingHandlers;
  query: QueryHandlers;
  feed: FeedHandlers;
  debug: DebugHandlers;
  rename: RenameHandlers;
  atc: AtcHandlers;
  trace: TraceHandlers;
  refactor: RefactorHandlers;
  revision: RevisionHandlers;
  rapGenerator: RapGeneratorHandlers;
  navigation: NavigationHandlers;
  textElements: TextElementHandlers;
}

/** A live, per-destination connection: its client, handlers and login state. */
interface Destination {
  system: SystemConfig;
  adtClient: ADTClient;
  cookieClient?: CookieHttpClient;
  handlers: HandlerSet;
  loggedIn: boolean;
}

// tool name -> HandlerSet key
const TOOL_ROUTES: Record<keyof HandlerSet, string[]> = {
  auth: ['login', 'logout', 'dropSession'],
  transport: ['transportInfo', 'createTransport', 'hasTransportConfig', 'transportConfigurations',
    'getTransportConfiguration', 'setTransportsConfig', 'createTransportsConfig', 'userTransports',
    'transportsByConfig', 'transportDelete', 'transportRelease', 'transportSetOwner', 'transportAddUser',
    'systemUsers', 'transportReference', 'transportDetails', 'transportUnifiedDiff', 'resolveTransport'],
  objectLock: ['lock', 'unLock'],
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
const READ_ONLY_TOOLS = new Set([
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
  'revisions', 'rapGenIsAvailable', 'rapGenGetSchema', 'rapGenGetContent', 'rapGenValidateInitial',
  'rapGenValidateContent', 'rapGenPreview', 'listSystems', 'healthcheck',
]);

const DESTRUCTIVE_TOOLS = new Set([
  'deleteObject', 'transportDelete', 'transportRelease', 'setObjectSource', 'editObjectSource', 'atcApplyQuickfix', 'gitUnlinkRepo',
  'pushRepo', 'runClass', 'renameExecute', 'extractMethodExecute', 'debuggerSetVariableValue',
  'tracesDelete', 'tracesDeleteConfiguration', 'unPublishServiceBinding', 'dropSession',
]);

function toolAnnotations(name: string) {
  const readOnly = READ_ONLY_TOOLS.has(name);
  return {
    readOnlyHint: readOnly,
    destructiveHint: DESTRUCTIVE_TOOLS.has(name),
    idempotentHint: readOnly,
    openWorldHint: false,
  };
}

export class AbapAdtServer extends Server {
  private systems: Map<string, SystemConfig>;
  private defaultDest?: string;
  private pool = new Map<string, Destination>();
  private toolToHandlerKey = new Map<string, keyof HandlerSet>();
  private schemaHandlers: HandlerSet;

  constructor() {
    super(
      { name: "abap-adt-mcp", version: PACKAGE_VERSION },
      {
        capabilities: { tools: {} },
        instructions: [
          'ABAP ADT MCP server. Every tool accepts an optional `destination` parameter selecting the target SAP system; call listSystems first to see the configured destinations.',
          '',
          'Creating a new object: loadTypes (pick objtype, e.g. CLAS/OC) -> validateNewObject (check name/package) -> createTransport (if package is not $TMP) -> createObject -> lock -> setObjectSource -> unLock -> activateByName -> unitTestRun.',
          '',
          'Editing an existing object: searchObject / findObjectPath -> getObjectSource -> transportInfo (find or create a transport for non-local packages) -> lock -> setObjectSource (source URL usually ends in /source/main; pass the lockHandle from lock) -> syntaxCheckCode -> unLock -> activateByName -> unitTestRun. For a small change in a large object use editObjectSource (line-range edit, pass expectedText) instead of resending the whole source.',
          '',
          'Always run unit tests after adding tests or changing source code. Unit tests belong in the testclass include (createTestInclude). Use $TMP for local throwaway development; transportable packages require a transport request.',
        ].join('\n'),
      }
    );

    this.systems = readSystems();
    this.defaultDest = defaultDestination(this.systems);

    // Surface TLS-verification bypasses loudly: they silently apply to every request.
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
      console.error('[abap-adt-mcp] WARNING: NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS certificate verification for ALL destinations. Prefer per-system "insecureTls" for individual on-prem systems with self-signed certificates.');
    }
    const insecure = [...this.systems.entries()].filter(([, s]) => s.insecureTls).map(([name]) => name);
    if (insecure.length > 0) {
      console.error(`[abap-adt-mcp] WARNING: TLS certificate verification disabled (insecureTls) for destination(s): ${insecure.join(', ')}`);
    }

    for (const key of Object.keys(TOOL_ROUTES) as (keyof HandlerSet)[]) {
      for (const tool of TOOL_ROUTES[key]) this.toolToHandlerKey.set(tool, key);
    }

    // Handlers used only to enumerate tool schemas (never connected).
    const firstSystem = [...this.systems.values()][0];
    this.schemaHandlers = this.buildHandlers(this.makeClient(firstSystem).adtClient);

    this.setupToolHandlers();
  }

  // --- connection / destination management -------------------------------

  private makeClient(sys: SystemConfig): { adtClient: ADTClient; cookieClient?: CookieHttpClient } {
    const client = sys.client || '';
    const language = sys.language || '';
    let adtClient: ADTClient;
    let cookieClient: CookieHttpClient | undefined;

    if (sys.authType === 'sso') {
      cookieClient = new CookieHttpClient(sys.url, [], !!sys.insecureTls, client || undefined);
      adtClient = new ADTClient(cookieClient as any, sys.user || 'sso', '', client, language);
    } else if (sys.authType === 'oauth') {
      adtClient = new ADTClient(sys.url, sys.oauth!.clientId || 'oauth', makeBearerFetcher(sys.oauth!), client, language);
    } else {
      adtClient = new ADTClient(sys.url, sys.user || '', sys.password || '', client, language);
    }
    adtClient.stateful = session_types.stateful;
    return { adtClient, cookieClient };
  }

  private buildHandlers(adtClient: ADTClient, system?: SystemConfig): HandlerSet {
    return {
      auth: new AuthHandlers(adtClient),
      transport: new TransportHandlers(adtClient),
      object: new ObjectHandlers(adtClient),
      class: new ClassHandlers(adtClient),
      codeAnalysis: new CodeAnalysisHandlers(adtClient),
      objectLock: new ObjectLockHandlers(adtClient),
      objectSource: new ObjectSourceHandlers(adtClient),
      objectDeletion: new ObjectDeletionHandlers(adtClient),
      objectManagement: new ObjectManagementHandlers(adtClient),
      objectRegistration: new ObjectRegistrationHandlers(adtClient),
      node: new NodeHandlers(adtClient),
      discovery: new DiscoveryHandlers(adtClient),
      unitTest: new UnitTestHandlers(adtClient),
      prettyPrinter: new PrettyPrinterHandlers(adtClient),
      git: new GitHandlers(adtClient, { user: system?.gitUser, password: system?.gitPassword }),
      ddic: new DdicHandlers(adtClient),
      serviceBinding: new ServiceBindingHandlers(adtClient),
      query: new QueryHandlers(adtClient),
      feed: new FeedHandlers(adtClient),
      debug: new DebugHandlers(adtClient),
      rename: new RenameHandlers(adtClient),
      atc: new AtcHandlers(adtClient),
      trace: new TraceHandlers(adtClient),
      refactor: new RefactorHandlers(adtClient),
      revision: new RevisionHandlers(adtClient),
      rapGenerator: new RapGeneratorHandlers(adtClient),
      navigation: new NavigationHandlers(adtClient),
      textElements: new TextElementHandlers(adtClient),
    };
  }

  private getDestination(name: string): Destination {
    let dest = this.pool.get(name);
    if (!dest) {
      const system = this.systems.get(name)!;
      const { adtClient, cookieClient } = this.makeClient(system);
      dest = { system, adtClient, cookieClient, handlers: this.buildHandlers(adtClient, system), loggedIn: false };
      this.pool.set(name, dest);
    }
    return dest;
  }

  /** Ensure the destination is authenticated. SSO opens a browser; other modes
   *  authenticate lazily on the first request, so this is a no-op for them. */
  private async ensureLogin(name: string, force: boolean): Promise<void> {
    const dest = this.getDestination(name);
    if (dest.system.authType !== 'sso') return;
    if (dest.loggedIn && !force) return;
    const cookies = await browserLogin(dest.system.url, dest.system.client);
    dest.cookieClient!.setCookies(cookies);
    await dest.adtClient.login();
    dest.loggedIn = true;
  }

  // --- serialization helpers (unchanged) ---------------------------------

  private serializeResult(result: any) {
    try {
      if (result && Array.isArray(result.content)) {
        return result;
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
          )
        }]
      };
    } catch (error) {
      return this.handleError(new McpError(ErrorCode.InternalError, 'Failed to serialize result'));
    }
  }

  private handleError(error: unknown) {
    if (!(error instanceof Error)) {
      error = new Error(String(error));
    }
    const cls = classifyAdtError(error);
    const extra = cls.kind === 'unknown' ? {} : { kind: cls.kind, httpStatus: cls.status, hint: cls.hint, nextTools: cls.nextTools };
    if (error instanceof McpError) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: redactSecrets(error.message), code: error.code, ...extra }) }],
        isError: true
      };
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: redactSecrets((error as Error).message || 'Internal server error'), code: ErrorCode.InternalError, ...extra })
      }],
      isError: true
    };
  }

  /**
   * Re-establish the SAP session of a destination after it expired mid-flow:
   * SSO re-runs the browser login (silent with a persistent profile), OAuth
   * drops the cached bearer so a fresh token is fetched, basic simply logs in
   * again. The stateful flag is restored because dropSession resets it.
   */
  private async reauthenticate(name: string): Promise<void> {
    const dest = this.getDestination(name);
    if (dest.system.authType === 'sso') {
      dest.loggedIn = false;
      await this.ensureLogin(name, true);
    } else {
      try { await dest.adtClient.dropSession(); } catch { /* best effort */ }
      if (dest.system.authType === 'oauth') {
        (dest.adtClient.httpClient as any).bearer = undefined;
      }
      await dest.adtClient.login();
    }
    dest.adtClient.stateful = session_types.stateful;
  }

  // --- tool registration --------------------------------------------------

  /** Add a `destination` parameter to a tool's input schema. */
  private withDestination(tool: any) {
    const destNames = [...this.systems.keys()];
    const schema = tool.inputSchema || { type: 'object', properties: {} };
    const properties = {
      destination: {
        type: 'string',
        enum: destNames,
        description: this.defaultDest
          ? `Target ABAP system. Defaults to "${this.defaultDest}" if omitted.`
          : 'Target ABAP system (one of the configured destinations). Required.',
      },
      ...(schema.properties || {}),
    };
    const required = Array.isArray(schema.required) ? [...schema.required] : [];
    if (!this.defaultDest && !required.includes('destination')) required.unshift('destination');
    return {
      ...tool,
      annotations: tool.annotations ?? toolAnnotations(tool.name),
      inputSchema: { ...schema, type: schema.type || 'object', properties, required }
    };
  }

  private allDomainTools(): any[] {
    const h = this.schemaHandlers;
    const sets: HandlerSet[keyof HandlerSet][] = [
      h.auth, h.transport, h.object, h.class, h.codeAnalysis, h.objectLock, h.objectSource,
      h.objectDeletion, h.objectManagement, h.objectRegistration, h.node, h.discovery, h.unitTest,
      h.prettyPrinter, h.git, h.ddic, h.serviceBinding, h.query, h.feed, h.debug, h.rename, h.atc,
      h.trace, h.refactor, h.revision, h.rapGenerator, h.navigation, h.textElements,
    ];
    return sets.flatMap((s) => s.getTools());
  }

  private setupToolHandlers() {
    this.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.allDomainTools().map((t) => this.withDestination(t));
      tools.push({
        name: 'listSystems',
        description: 'List the configured ABAP systems (destinations) this server can reach. Call this first to pick the destination to pass to all other tools.',
        inputSchema: { type: 'object', properties: {} },
        annotations: toolAnnotations('listSystems'),
      });
      tools.push({
        name: 'healthcheck',
        description: 'Check server health and list configured destinations.',
        inputSchema: { type: 'object', properties: {} },
        annotations: toolAnnotations('healthcheck'),
      });
      return { tools };
    });

    this.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const name = request.params.name;
        const rawArgs: any = request.params.arguments || {};

        if (name === 'listSystems') {
          return this.serializeResult({
            systems: [...this.systems.values()].map((s) => ({
              destination: s.name, url: s.url, client: s.client, authType: s.authType,
            })),
            default: this.defaultDest,
          });
        }
        if (name === 'healthcheck') {
          return this.serializeResult({
            status: 'healthy',
            destinations: [...this.systems.keys()],
            default: this.defaultDest,
          });
        }

        // Resolve destination.
        const destination = rawArgs.destination || this.defaultDest;
        if (!destination) {
          throw new McpError(ErrorCode.InvalidParams,
            `Missing "destination". Configured systems: ${[...this.systems.keys()].join(', ')}`);
        }
        if (!this.systems.has(destination)) {
          throw new McpError(ErrorCode.InvalidParams,
            `Unknown destination "${destination}". Configured: ${[...this.systems.keys()].join(', ')}`);
        }

        const dest = this.getDestination(destination);
        const { destination: _d, ...args } = rawArgs;

        // Explicit login for SSO destinations.
        if (name === 'login' && dest.system.authType === 'sso') {
          await this.ensureLogin(destination, true);
          return this.serializeResult({ status: `logged in to ${destination} via browser SSO` });
        }
        // Otherwise ensure the SSO session exists before the call.
        if (name !== 'logout') {
          await this.ensureLogin(destination, false);
        }

        const handlerKey = this.toolToHandlerKey.get(name);
        if (!handlerKey) {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
        let result: any;
        try {
          result = await dest.handlers[handlerKey].handle(name, args);
        } catch (error) {
          // A session that expired between calls means SAP never executed this
          // request: re-authenticate and retry exactly once. Any lockHandle from
          // the old session is gone; the retry then fails with a staleLockHandle
          // hint, which is the honest outcome.
          const cls = classifyAdtError(error);
          if (cls.kind !== 'sessionExpired' && cls.kind !== 'csrf') throw error;
          console.error(`[abap-adt-mcp] session for ${destination} expired during ${name} (${cls.kind}); re-authenticating and retrying once`);
          await this.reauthenticate(destination);
          result = await dest.handlers[handlerKey].handle(name, args);
        }
        return this.serializeResult(result);
      } catch (error) {
        return this.handleError(error);
      }
    });
  }

  async run() {
    const httpPort = parseInt(process.env.MCP_HTTP_PORT || '', 10);
    if (httpPort) {
      await this.runHttp(httpPort);
    } else {
      const transport = new StdioServerTransport();
      await this.connect(transport);
      console.error(`MCP ABAP ADT API server running on stdio — ${this.systems.size} destination(s): ${[...this.systems.keys()].join(', ')}`);
    }

    process.on('SIGINT', async () => { await this.close(); process.exit(0); });
    process.on('SIGTERM', async () => { await this.close(); process.exit(0); });
    this.onerror = (error) => { console.error('[MCP Error]', error); };
  }

  /**
   * Streamable HTTP transport, mirroring SAP's official ADT MCP Server model:
   * localhost-only endpoint at /mcp guarded by a bearer token. The token comes
   * from MCP_HTTP_TOKEN or is generated at startup and written to
   * ~/.abap-adt-mcp/http-token with 0600 permissions.
   */
  private async runHttp(port: number) {
    if (port < 1024 || port > 65535) {
      throw new Error(`MCP_HTTP_PORT must be between 1024 and 65535, got ${port}`);
    }
    let token = process.env.MCP_HTTP_TOKEN;
    if (!token) {
      token = crypto.randomBytes(32).toString('hex');
      const dir = path.join(os.homedir(), '.abap-adt-mcp');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tokenFile = path.join(dir, 'http-token');
      fs.writeFileSync(tokenFile, token, { mode: 0o600 });
      console.error(`[abap-adt-mcp] Bearer token written to ${tokenFile}`);
    }
    const expected = token;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    await this.connect(transport);

    const httpServer = http.createServer(async (req, res) => {
      if (!req.url || !req.url.startsWith('/mcp')) {
        res.writeHead(404).end();
        return;
      }
      const auth = req.headers.authorization || '';
      const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const ok = provided.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
      if (!ok) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: 'Unauthorized: send Authorization: Bearer <token>' }));
        return;
      }
      try {
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error('[abap-adt-mcp] HTTP request error:', error);
        if (!res.headersSent) res.writeHead(500).end();
      }
    });

    // Bind to loopback only; this transport is for local MCP hosts, never the network.
    await new Promise<void>((resolve) => httpServer.listen(port, '127.0.0.1', resolve));
    console.error(
      `MCP ABAP ADT API server running on http://127.0.0.1:${port}/mcp (bearer auth) — ` +
      `${this.systems.size} destination(s): ${[...this.systems.keys()].join(', ')}`
    );
  }
}

// Create and run server instance
const server = new AbapAdtServer();
server.run().catch((error) => {
  console.error('Fatal error running server:', error);
  process.exit(1);
});
