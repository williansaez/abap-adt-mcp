#!/usr/bin/env node

import { config } from 'dotenv';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startHttpServer, readHttpOptions, HttpHandle } from './lib/httpTransport.js';
import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import { ADTClient, session_types } from "abap-adt-api";
import path from 'path';
import { makeBearerFetcher, BearerFetcher } from './lib/oauth.js';
import https from 'https';
import { CookieHttpClient } from './lib/cookieHttpClient.js';
import { browserLogin } from './lib/browserLogin.js';
import { readSystems, defaultDestination, SystemConfig } from './lib/systems.js';
import { classifyAdtError } from './lib/adtErrorHints.js';
import { TOOL_ROUTES, HandlerKey, toolAnnotations, resolveToolsets, ToolsetSelection, TOOLSETS } from './toolManifest.js';
import { buildSystemProfile, SystemProfile } from './lib/systemProfile.js';
import { evaluatePolicy, objectUrlOf, summarizePolicy } from './lib/policy.js';
import { clearLedger, releaseAll } from './lib/lockLedger.js';
import { sourceCache } from './lib/sourceCache.js';
import { normalizeArgs } from './lib/argAliases.js';
import { TOOLSET_FEATURE } from './lib/systemProfile.js';
import { AuditLog, summarizeArgs } from './lib/audit.js';
import { buildHttpsAgent, describeTls, enforceTlsVerification } from './lib/tls.js';
import { listPrompts, getPrompt } from './prompts.js';
import { createReporter, withProgress, withHeartbeat, reportProgress, ProgressReporter } from './lib/progress.js';
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
import { SearchHandlers } from './handlers/SearchHandlers.js';
import { CloudHandlers } from './handlers/CloudHandlers.js';
import { SnippetHandlers } from './handlers/SnippetHandlers.js';

// Single source of truth for the version announced to MCP hosts (dist/ sits one level below package.json).
const PACKAGE_VERSION: string = require("../package.json").version;

config({ path: path.resolve(__dirname, '../.env') });

/**
 * Before anything opens a connection: certificate verification is the default and
 * cannot be switched off for the whole process. Reported once from the
 * constructor, where stderr is already redacted.
 */
const tlsBypassRemoved = enforceTlsVerification();

/**
 * Strip credential material from error text before it reaches the model/host.
 * Upstream HTTP errors can echo request headers or URLs with embedded secrets.
 */
function redactSecrets(text: string): string {
  return String(text)
    .replace(/(authorization\s*[:=]\s*)(?:basic|bearer)?\s*[^\s,;"']+/gi, '$1[REDACTED]')
    .replace(/((?:cookie|set-cookie)\s*[:=]\s*)[^\n"']+/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|passphrase|client_secret|clientsecret|sap-password|token|api[_-]?key|secret|lock_?handle)\s*[=:]\s*)[^\s&,;"']+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\/\s:@]+:[^\/\s:@]+@/gi, '$1[REDACTED]@');
}

/**
 * Every diagnostic this process prints goes through the same redaction as tool
 * results and the audit log. Startup and error diagnostics echo upstream error
 * text (a JSON parse error can quote the file it failed on), so nothing may
 * reach stderr unredacted.
 */
const rawConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  rawConsoleError(...args.map(a => typeof a === 'string' ? redactSecrets(a) : (a instanceof Error ? redactSecrets(a.stack || a.message) : a)));
};

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
  search: SearchHandlers;
  cloud: CloudHandlers;
  snippet: SnippetHandlers;
}

/** A live, per-destination connection: its client, handlers and login state. */
type AuditRecordLike = { errorKind?: string; gate?: string; message?: string };

interface Destination {
  system: SystemConfig;
  adtClient: ADTClient;
  cookieClient?: CookieHttpClient;
  bearerFetcher?: BearerFetcher;
  httpsAgent: https.Agent;
  handlers: HandlerSet;
  loggedIn: boolean;
  /** In-flight SSO login, shared by concurrent callers so only one browser opens. */
  loginInFlight?: Promise<void>;
  profile?: Promise<SystemProfile>;
  /** objectUrl -> package (DEVCLASS), filled lazily for allowedPackages checks. */
  packageCache: Map<string, string>;
  /** Serializes tool calls per destination: one stateful ADT session is not concurrency-safe. */
  queue: Promise<unknown>;
}

/** Tools after which the objectUrl -> package memo of a destination is stale. */
const PACKAGE_CACHE_INVALIDATORS = new Set(['changePackageExecute', 'deleteObject', 'createObject', 'renameExecute', 'gitPullRepo', 'rapGenGenerate']);

/** Human-readable tool title from its camelCase name (getObjectSource -> Get Object Source). */
function titleFromName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b(Atc|Adt|Ddic|Rap|Cds|Api|Sql|Http|Url|Odata|Amdp|Abap)\b/gi, (m) => m.toUpperCase())
    .replace(/^./, (c) => c.toUpperCase());
}

/** Example values for the parameters agents most often get wrong (URL vs name, which URL). */
const PARAM_EXAMPLES: Record<string, any[]> = {
  objectUrl: ['/sap/bc/adt/oo/classes/zcl_order_service', '/sap/bc/adt/programs/programs/zreport', '/sap/bc/adt/ddic/ddl/sources/zi_product'],
  objectSourceUrl: ['/sap/bc/adt/oo/classes/zcl_order_service/source/main', '/sap/bc/adt/programs/programs/zreport/source/main'],
  objSourceUrl: ['/sap/bc/adt/oo/classes/zcl_order_service', '/sap/bc/adt/programs/programs/zreport'],
  classUrl: ['ZCL_ORDER_SERVICE', '/sap/bc/adt/oo/classes/zcl_order_service'],
  domainUrl: ['/sap/bc/adt/ddic/domains/zdom_status'],
  dataElementUrl: ['/sap/bc/adt/ddic/dataelements/zde_status'],
  packageName: ['$TMP', 'ZFIN'],
  parentName: ['$TMP', 'ZFIN'],
  parentPath: ['/sap/bc/adt/packages/$tmp', '/sap/bc/adt/packages/zfin'],
  transport: ['DEVK900123'],
  transportNumber: ['DEVK900123'],
  objtype: ['CLAS/OC', 'INTF/OI', 'PROG/P', 'DDLS/DF', 'DEVC/K'],
  objType: ['CLAS/OC', 'PROG/P', 'DDLS/DF', 'TABL/DT'],
  methodName: ['GET_DATA', 'IF_OO_ADT_CLASSRUN~MAIN'],
  ddicEntityName: ['T000', 'I_PRODUCT'],
  sqlQuery: ["SELECT matnr, mtart FROM mara WHERE mtart = 'FERT'"],
};

// Compile-time check: every handler key in the manifest exists in HandlerSet.
const _handlerSetCheck: Record<HandlerKey, unknown> = {} as HandlerSet;
void _handlerSetCheck;

export class AbapAdtServer extends Server {
  private static warnedOnce = false;
  private systems: Map<string, SystemConfig>;
  private defaultDest?: string;
  private pool = new Map<string, Destination>();
  private toolToHandlerKey = new Map<string, keyof HandlerSet>();
  private toolSchemas?: Map<string, any>;
  private schemaHandlers: HandlerSet;
  private toolsets: ToolsetSelection;
  private audit = new AuditLog(process.env.MCP_AUDIT_FILE, redactSecrets);

  constructor() {
    super(
      { name: "abap-adt-mcp", version: PACKAGE_VERSION },
      {
        capabilities: { tools: {}, prompts: {} },
        instructions: [
          'ABAP ADT MCP server. Every tool accepts an optional `destination` parameter selecting the target SAP system; call listSystems first to see the configured destinations.',
          '',
          'Creating a new object: loadTypes (pick objtype, e.g. CLAS/OC) -> validateNewObject (check name/package) -> resolveTransport (if package is not $TMP) -> createObject -> setObjectSource with activate=true -> unitTestRun.',
          '',
          'Editing an existing object: searchObject / findObjectPath -> getObjectSource -> resolveTransport (for non-local packages) -> editObjectSource (replacements or line range), setMethodSource (one method) or setObjectSource (whole source), with activate=true -> unitTestRun -> objectDiff to review what changed. Never resend a whole source to change a few lines. Write tools lock and unlock by themselves; call lock/unLock only to hold a lock across several writes, and listLocks/forceUnlock if a write left an object locked. syntaxCheckCode before writing catches errors early. Class includes (implementations, testclasses, definitions) are read with getObjectSource on the URL from classIncludes, without /source/main.',
          '',
          'Always run unit tests after adding tests or changing source code. Unit tests belong in the testclass include (createTestInclude). Use $TMP for local throwaway development; transportable packages require a transport request (resolveTransport picks it for you).',
          '',
          'ABAP Cloud: apiReleaseState(names or source) checks SAP objects against the official cloudification repository before you use them; runSnippet executes throwaway ABAP in $TMP and returns the console output.',
          '',
          'Finding code: sourceTextSearch (server index) or grepPackage (client grep with context) locate usages of tables, messages, methods or literals; read whole sources only for the hits. Data: runQuery for SQL over tables and CDS views (statements are wrapped to the 255-character line limit of the data preview), tableContents when the preview refuses a table, getDataElementProperties/getDomainProperties for the internal format of a key (leading zeros, conversion exits).',
          '',
          'Errors carry kind/hint/nextTools: follow the hint instead of retrying blindly. systemProfile(destination) tells which toolsets the backend supports (S/4HANA Cloud lacks some); dumps/dumpDetails are the root-cause path when the debugger toolset is unavailable on a destination.',
        ].join('\n'),
      }
    );

    this.systems = readSystems();
    this.defaultDest = defaultDestination(this.systems);

    // Surface TLS-verification bypasses loudly: they silently apply to every request.
    if (!AbapAdtServer.warnedOnce) {
    AbapAdtServer.warnedOnce = true;
    if (tlsBypassRemoved) {
      console.error('[abap-adt-mcp] WARNING: NODE_TLS_REJECT_UNAUTHORIZED=0 was ignored. It disables TLS certificate verification for every connection of this process, including destinations that never asked for it, the OAuth token request and the cloudification repository download. Set "insecureTls": true on the one destination that needs it.');
    }
    const insecure = [...this.systems.entries()].filter(([, s]) => s.insecureTls).map(([name]) => name);
    if (insecure.length > 0) {
      console.error(`[abap-adt-mcp] WARNING: TLS certificate verification disabled (insecureTls) for destination(s): ${insecure.join(', ')}`);
    }
    }

    for (const key of Object.keys(TOOL_ROUTES) as (keyof HandlerSet)[]) {
      for (const tool of TOOL_ROUTES[key]) this.toolToHandlerKey.set(tool, key);
    }

    this.toolsets = resolveToolsets();

    // Handlers used only to enumerate tool schemas (never connected).
    const firstSystem = [...this.systems.values()][0];
    this.schemaHandlers = this.buildHandlers(this.makeClient(firstSystem).adtClient);
    if (this.toolsets.active.length < Object.keys(TOOLSETS).length) {
      console.error(`[abap-adt-mcp] Active toolsets: ${this.toolsets.active.join(', ')} (${this.getToolCatalog().length} tools). Change with MCP_TOOLSETS / MCP_DISABLED_TOOLSETS.`);
    }

    this.setupToolHandlers();
  }

  // --- connection / destination management -------------------------------

  private makeClient(sys: SystemConfig): { adtClient: ADTClient; cookieClient?: CookieHttpClient; bearerFetcher?: BearerFetcher; httpsAgent: https.Agent } {
    const client = sys.client || '';
    const language = sys.language || '';
    let adtClient: ADTClient;
    let cookieClient: CookieHttpClient | undefined;
    let bearerFetcher: BearerFetcher | undefined;

    const agent = buildHttpsAgent(sys.tls, sys.insecureTls);
    const options = { httpsAgent: agent };
    if (sys.authType === 'sso') {
      cookieClient = new CookieHttpClient(sys.url, [], !!sys.insecureTls, client || undefined, agent);
      adtClient = new ADTClient(cookieClient as any, sys.user || 'sso', '', client, language);
    } else if (sys.authType === 'oauth') {
      bearerFetcher = makeBearerFetcher(sys.oauth!);
      adtClient = new ADTClient(sys.url, sys.oauth!.clientId || 'oauth', bearerFetcher, client, language, options);
    } else {
      adtClient = new ADTClient(sys.url, sys.user || '', sys.password || '', client, language, options);
    }
    adtClient.stateful = session_types.stateful;
    return { adtClient, cookieClient, bearerFetcher, httpsAgent: agent };
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
      search: new SearchHandlers(adtClient),
      cloud: new CloudHandlers(adtClient),
      snippet: new SnippetHandlers(adtClient),
    };
  }

  private getDestination(name: string): Destination {
    let dest = this.pool.get(name);
    if (!dest) {
      const system = this.systems.get(name)!;
      const { adtClient, cookieClient, bearerFetcher, httpsAgent } = this.makeClient(system);
      dest = { system, adtClient, cookieClient, bearerFetcher, httpsAgent, handlers: this.buildHandlers(adtClient, system), loggedIn: false, packageCache: new Map(), queue: Promise.resolve() };
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
    if (dest.loginInFlight && !force) return dest.loginInFlight;
    dest.loginInFlight = (async () => {
      reportProgress(`opening the browser for SSO login to ${name}; complete the login if a window appears`);
      const cookies = await browserLogin(dest.system.url, dest.system.client);
      dest.cookieClient!.setCookies(cookies);
      await dest.adtClient.login();
      dest.loggedIn = true;
    })().finally(() => { dest.loginInFlight = undefined; });
    return dest.loginInFlight;
  }

  /**
   * Release everything this server instance holds on SAP: explicit locks in
   * the ledgers, the stateful sessions and the keep-alive sockets. Called on
   * SIGINT/SIGTERM for stdio and when an HTTP MCP session closes or expires.
   */
  async close(): Promise<void> {
    for (const [name, dest] of this.pool) {
      try {
        const { released, failed } = await releaseAll(dest.adtClient);
        if (released.length || failed.length) console.error(`[abap-adt-mcp] ${name}: released ${released.length} lock(s) on close${failed.length ? `, ${failed.length} failed` : ''}`);
      } catch (e: any) { console.error(`[abap-adt-mcp] ${name}: releasing locks on close failed: ${e?.message || e}`); }
      sourceCache.clear(dest.adtClient);
      if (dest.adtClient.loggedin) {
        try { await dest.adtClient.dropSession(); } catch { /* best effort */ }
      }
      dest.httpsAgent.destroy();
      dest.loggedIn = false;
    }
    this.pool.clear();
    await super.close();
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
        dest.bearerFetcher?.invalidate();
        (dest.adtClient.httpClient as any).bearer = undefined;
      }
      await dest.adtClient.login();
    }
    dest.adtClient.stateful = session_types.stateful;
    sourceCache.clear(dest.adtClient);
    // Handles from the dead session are invalid: forget them rather than reuse them.
    clearLedger(dest.adtClient);
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
    for (const [pname, def] of Object.entries<any>(properties)) {
      if (def && typeof def === 'object' && !def.examples && PARAM_EXAMPLES[pname]) def.examples = PARAM_EXAMPLES[pname];
    }
    const title = tool.title ?? titleFromName(tool.name);
    return {
      ...tool,
      title,
      annotations: { title, ...(tool.annotations ?? toolAnnotations(tool.name)) },
      inputSchema: { ...schema, type: schema.type || 'object', properties, required }
    };
  }

  private allDomainTools(): any[] {
    const h = this.schemaHandlers;
    const sets: HandlerSet[keyof HandlerSet][] = [
      h.auth, h.transport, h.object, h.class, h.codeAnalysis, h.objectLock, h.objectSource,
      h.objectDeletion, h.objectManagement, h.objectRegistration, h.node, h.discovery, h.unitTest,
      h.prettyPrinter, h.git, h.ddic, h.serviceBinding, h.query, h.feed, h.debug, h.rename, h.atc,
      h.trace, h.refactor, h.revision, h.rapGenerator, h.navigation, h.textElements, h.search, h.cloud, h.snippet,
    ];
    return sets.flatMap((s) => s.getTools());
  }

  /** The tools/list payload: domain tools of the active toolsets plus the server's own tools. */
  getToolCatalog(): any[] {
    const tools = this.allDomainTools()
      .filter((t) => this.toolsets.enabledTools.has(t.name))
      .map((t) => this.withDestination(t));
    tools.push({
      name: 'listSystems',
      title: 'List Systems',
      description: 'List the configured ABAP systems (destinations) this server can reach. Call this first to pick the destination to pass to all other tools.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'List Systems', ...toolAnnotations('listSystems') },
    });
    tools.push({
      name: 'healthcheck',
      title: 'Healthcheck',
      description: 'Check server health and list configured destinations.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Healthcheck', ...toolAnnotations('healthcheck') },
    });
    tools.push(this.withDestination({
      name: 'systemProfile',
      description: 'Capability profile of a destination: platform (S/4HANA Cloud vs on-prem), system information, which ADT features the backend exposes (debugger, traces, abapGit, ATC, RAP generator, text search, API releases…) and therefore which toolsets/tools will not work there. Cached per destination; pass refresh=true to rebuild. Call it once before using debugger/traces/abapGit/RAP tools on an unfamiliar system.',
      inputSchema: {
        type: 'object',
        properties: { refresh: { type: 'boolean', description: 'Rebuild the cached profile (default false)', optional: true } },
      },
      annotations: toolAnnotations('systemProfile'),
    }));
    return tools;
  }

  /** Active toolsets and their tool names (for diagnostics and docs). */
  getToolsets(): ToolsetSelection {
    return this.toolsets;
  }

  private toolsOfToolset(toolset: string): string[] {
    const def = TOOLSETS[toolset];
    return def ? def.handlers.flatMap((k) => TOOL_ROUTES[k]) : [];
  }

  /** Package (DEVCLASS) of an existing object, via transportInfo, cached per destination. */
  private async resolvePackage(name: string, objectUrl: string): Promise<string | undefined> {
    const dest = this.getDestination(name);
    const key = objectUrlOf(objectUrl).toLowerCase();
    if (!key) return undefined;
    const cached = dest.packageCache.get(key);
    if (cached) return cached;
    try {
      await this.ensureLogin(name, false);
      const info: any = await dest.adtClient.transportInfo(key);
      const pkg = info?.DEVCLASS ? String(info.DEVCLASS).toUpperCase() : undefined;
      if (pkg) dest.packageCache.set(key, pkg);
      return pkg;
    } catch {
      return undefined;
    }
  }

  /** Build (once) the capability profile of a destination from ADT discovery. */
  private getProfile(name: string, refresh = false): Promise<SystemProfile> {
    const dest = this.getDestination(name);
    if (!dest.profile || refresh) {
      dest.profile = (async () => {
        const discovery = await dest.adtClient.adtDiscovery();
        let systemInformationBody: string | undefined;
        try {
          const res = await dest.adtClient.httpClient.request('/sap/bc/adt/system/information', { method: 'GET', headers: { Accept: '*/*' } });
          systemInformationBody = res.status < 400 ? String(res.body || '') : undefined;
        } catch { systemInformationBody = undefined; }
        return buildSystemProfile({
          destination: name, url: dest.system.url, client: dest.system.client, authType: dest.system.authType,
          discovery, systemInformationBody, toolsOfToolset: (ts) => this.toolsOfToolset(ts),
        });
      })();
      dest.profile.catch(() => { dest.profile = undefined; });
    }
    return dest.profile;
  }

  private setupToolHandlers() {
    this.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.getToolCatalog() }));
    this.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: listPrompts() }));
    this.setRequestHandler(GetPromptRequestSchema, async (request) => {
      try {
        const prompt = getPrompt(request.params.name, (request.params.arguments || {}) as Record<string, string>);
        if (!prompt) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${request.params.name}`);
        return prompt;
      } catch (e: any) {
        if (e instanceof McpError) throw e;
        throw new McpError(ErrorCode.InvalidParams, e.message);
      }
    });

    this.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const name = request.params.name;
      const rawArgs: any = request.params.arguments || {};
      const progressToken = (request.params as any)._meta?.progressToken;
      const reporter: ProgressReporter | undefined = progressToken !== undefined
        ? createReporter((params) => extra.sendNotification({ method: 'notifications/progress', params: { progressToken, ...params } } as any))
        : undefined;
      const requestId = this.audit.nextId();
      const startedAt = Date.now();
      let retried = false;
      const audited = (outcome: 'ok' | 'error' | 'denied' | 'unavailable', extra: Partial<AuditRecordLike> = {}) => {
        if (!this.audit.enabled) return;
        this.audit.write({
          requestId, tool: name, destination: rawArgs.destination || this.defaultDest,
          durationMs: Date.now() - startedAt, outcome, retried: retried || undefined,
          args: summarizeArgs(rawArgs, redactSecrets), ...extra,
        });
      };
      try {
        const response = await withProgress(reporter, () => withHeartbeat(reporter, name, () => this.dispatch(name, rawArgs, () => { retried = true; })));
        audited('ok');
        return response;
      } catch (error) {
        const cls = classifyAdtError(error);
        const message = redactSecrets(String((error as any)?.message || error)).slice(0, 300);
        const gate = message.match(/^(?:MCP error -?\d+: )?Policy: \w+ blocked on destination [^ ]+ \((\w+)\)/)?.[1];
        audited(cls.kind === 'policyDenied' ? 'denied' : (/is not available on destination/.test(message) ? 'unavailable' : 'error'),
          { errorKind: cls.kind === 'unknown' ? undefined : cls.kind, gate, message });
        return this.handleError(error);
      }
    });
  }

  /** Run one tool call end to end (destination, policy, login, toolset and platform gates, handler, re-auth retry). */
  private async dispatch(name: string, rawArgs: any, onRetry: () => void): Promise<any> {

    if (name === 'listSystems') {
      const systems = await Promise.all([...this.systems.values()].map(async (s) => {
        const dest = this.pool.get(s.name);
        const profile = dest?.profile ? await dest.profile.catch(() => undefined) : undefined;
        return {
          destination: s.name, url: s.url, client: s.client, authType: s.authType,
          ...(s.policy ? { policy: summarizePolicy(s.policy) } : {}),
          ...(describeTls(s.tls, s.insecureTls) ? { tls: describeTls(s.tls, s.insecureTls) } : {}),
          ...(profile ? { platform: profile.platform, unavailableToolsets: profile.unavailableToolsets } : {}),
        };
      }));
      return this.serializeResult({ systems, default: this.defaultDest, activeToolsets: this.toolsets.active });
    }
    if (name === 'healthcheck') {
      return this.serializeResult({
        status: 'healthy',
        version: PACKAGE_VERSION,
        destinations: [...this.systems.keys()],
        default: this.defaultDest,
        activeToolsets: this.toolsets.active,
        tools: this.getToolCatalog().length,
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
    const { destination: _d, ...rawToolArgs } = rawArgs;
    // Tolerate the parameter names agents guess (TransportNumber, objectSourceUrl
    // for objSourceUrl, source for code, ...): map them onto the schema.
    if (!this.toolSchemas) this.toolSchemas = new Map(this.getToolCatalog().map((t: any) => [t.name, t.inputSchema]));
    const { args, renamed } = normalizeArgs(this.toolSchemas.get(name), rawToolArgs);
    if (Object.keys(renamed).length) console.error(`[abap-adt-mcp] ${name}: argument(s) renamed ${Object.entries(renamed).map(([a, b]) => `${a}->${b}`).join(', ')}`);

    // Checks that need no SAP round trip come first and are protocol errors.
    const handlerKey = name === 'systemProfile' ? undefined : this.toolToHandlerKey.get(name);
    if (!handlerKey && name !== 'systemProfile') {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    if (handlerKey && !this.toolsets.enabledTools.has(name)) {
      const ts = this.toolsets.toolsetOf.get(name);
      throw new McpError(ErrorCode.MethodNotFound,
        `Tool ${name} belongs to toolset "${ts}", which is not enabled (active: ${this.toolsets.active.join(', ')}). Start the server with MCP_TOOLSETS including "${ts}" (or MCP_TOOLSETS=all).`);
    }

    // Everything from here on may talk to SAP through the destination's single
    // stateful session, so it runs inside the per-destination queue: policy
    // resolution (transportInfo), login, profile discovery, the handler and
    // the re-authentication retry never interleave with another call.
    const work = async (): Promise<any> => {
      // Server-side policy gate, before any authentication or SAP call.
      if (dest.system.policy) {
        const decision = await evaluatePolicy(dest.system.policy, name, args, {
          resolvePackage: async (objectUrl) => this.resolvePackage(destination, objectUrl),
        });
        if (!decision.allowed) {
          throw new McpError(ErrorCode.InvalidRequest,
            `Policy: ${name} blocked on destination ${destination} (${decision.gate}): ${decision.reason}. Configured in systems.json policy; retrying will not help.`);
        }
      }

      // Explicit login for SSO destinations.
      if (name === 'login' && dest.system.authType === 'sso') {
        await this.ensureLogin(destination, true);
        return { status: `logged in to ${destination} via browser SSO` };
      }
      // Otherwise ensure the SSO session exists before the call.
      if (name !== 'logout') {
        await this.ensureLogin(destination, false);
      }

      if (name === 'systemProfile') {
        return this.getProfile(destination, args.refresh === true);
      }

      // Platform gate: tools whose ADT collection the backend does not expose
      // are refused before touching SAP. The profile is built on the first
      // call of a gated toolset (debugger, traces, git, ...) so the outcome
      // does not depend on whether systemProfile was called earlier.
      // MCP_PROFILE_GATE=enforce (default) | warn | off.
      const gateMode = (process.env.MCP_PROFILE_GATE || 'enforce').toLowerCase();
      const ts = this.toolsets.toolsetOf.get(name);
      if (gateMode !== 'off' && ts && TOOLSET_FEATURE[ts] && !dest.profile) {
        try { await this.getProfile(destination); } catch (e: any) {
          console.error(`[abap-adt-mcp] ${destination}: could not build the system profile (${e?.message || e}); ${name} runs unchecked`);
        }
      }
      if (gateMode !== 'off' && dest.profile) {
        const profile = await dest.profile.catch(() => undefined);
        if (profile?.unavailableTools.includes(name)) {
          const msg = `Tool ${name} is not available on destination ${destination} (${profile.platform === 'cloud' ? 'S/4HANA Cloud' : 'this system'} does not expose the ADT ${ts} collection; see systemProfile). Pick another approach: dumps/dumpDetails instead of the debugger, ATC instead of traces.`;
          if (gateMode === 'warn') console.error(`[abap-adt-mcp] ${msg}`);
          else throw new McpError(ErrorCode.InvalidRequest, msg);
        }
      }

      let result: any;
      try {
        result = await dest.handlers[handlerKey!].handle(name, args);
      } catch (error) {
        // A session that expired between calls means SAP never executed this
        // request: re-authenticate and retry exactly once. Any lockHandle from
        // the old session is gone; the retry then fails with a staleLockHandle
        // hint, which is the honest outcome.
        const cls = classifyAdtError(error);
        if (name === 'logout' || (cls.kind !== 'sessionExpired' && cls.kind !== 'csrf')) throw error;
        console.error(`[abap-adt-mcp] session for ${destination} expired during ${name} (${cls.kind}); re-authenticating and retrying once`);
        onRetry();
        await this.reauthenticate(destination);
        result = await dest.handlers[handlerKey!].handle(name, args);
      }
      // Objects moved, renamed, created or deleted: the objectUrl -> package
      // memo used by allowedPackages must not answer from before the change.
      if (PACKAGE_CACHE_INVALIDATORS.has(name)) dest.packageCache.clear();
      return result;
    };
    const run = dest.queue.then(work);
    dest.queue = run.catch(() => undefined);
    return this.serializeResult(await run);
  }

  async run() {
    const httpPort = parseInt(process.env.MCP_HTTP_PORT || '', 10);
    if (httpPort) {
      await this.startHttp();
    } else {
      const transport = new StdioServerTransport();
      await this.connect(transport);
      console.error(`MCP ABAP ADT API server running on stdio — ${this.systems.size} destination(s): ${[...this.systems.keys()].join(', ')}`);
    }

    const shutdown = async (signal: string) => {
      console.error(`[abap-adt-mcp] ${signal}: releasing locks and sessions`);
      await Promise.race([this.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
      process.exit(0);
    };
    process.on('SIGINT', () => { void shutdown('SIGINT'); });
    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    this.onerror = (error) => { console.error('[MCP Error]', error); };
  }

  /**
   * Streamable HTTP transport, mirroring SAP's official ADT MCP Server model:
   * localhost-only endpoint at /mcp guarded by a bearer token, one server
   * instance (and therefore one set of SAP sessions and locks) per MCP session,
   * Origin/Host validation, session limits and idle expiry. The token comes
   * from MCP_HTTP_TOKEN or is generated at startup and written to
   * ~/.abap-adt-mcp/http-token with 0600 permissions.
   */
  async startHttp(env: NodeJS.ProcessEnv = process.env): Promise<HttpHandle> {
    const opts = readHttpOptions(env, PACKAGE_VERSION);
    if (!opts.token) {
      opts.token = crypto.randomBytes(32).toString('hex');
      const dir = path.join(os.homedir(), '.abap-adt-mcp');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tokenFile = path.join(dir, 'http-token');
      fs.writeFileSync(tokenFile, opts.token, { mode: 0o600 });
      console.error(`[abap-adt-mcp] Bearer token written to ${tokenFile}`);
    }
    if (!['127.0.0.1', 'localhost', '::1'].includes(opts.host)) {
      console.error(`[abap-adt-mcp] WARNING: HTTP transport bound to ${opts.host}, reachable beyond this machine. Keep the bearer token secret, restrict MCP_HTTP_ALLOWED_ORIGINS/HOSTS and put TLS in front.`);
      const sso = [...this.systems.values()].filter(s => s.authType === 'sso').map(s => s.name);
      if (sso.length) console.error(`[abap-adt-mcp] WARNING: destination(s) ${sso.join(', ')} use browser SSO: every remote caller shares the browser login of the user running this server. Prefer basic/oauth destinations for a shared HTTP server.`);
    }
    // Every MCP session gets its own server instance: separate SAP sessions,
    // lock ledgers and caches per caller.
    const handle = await startHttpServer(() => new AbapAdtServer(), opts);
    console.error(
      `MCP ABAP ADT API server running on http://${opts.host}:${handle.port}/mcp (bearer auth, max ${opts.maxSessions} sessions, idle expiry ${Math.round(opts.sessionTtlMs / 60000)} min) — ` +
      `${this.systems.size} destination(s): ${[...this.systems.keys()].join(', ')}`
    );
    return handle;
  }
}

// Start only when executed directly (tests and tooling import the class).
if (require.main === module) {
  let server: AbapAdtServer;
  try {
    server = new AbapAdtServer();
  } catch (error: any) {
    console.error(`[abap-adt-mcp] Fatal: ${error?.message || error}`);
    process.exit(1);
  }
  server.run().catch((error) => {
    console.error('Fatal error running server:', error);
    process.exit(1);
  });
}
