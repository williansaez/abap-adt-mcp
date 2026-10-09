/**
 * NW RFC SDK binding through koffi (https://koffi.dev, 3.x).
 *
 * Loads the SAP NetWeaver RFC SDK 7.50 the user installed (never shipped with
 * this package: SAP's licence terms for connectors forbid redistribution) and
 * calls SADT_REST_RFC_ENDPOINT on persistent RFC connections. See types.ts for
 * the contract with the transport.
 *
 * C layout notes (sapnwrfc.h, SDK 7.50):
 * - SAP_UC is a 2-byte UTF-16 code unit on EVERY platform. It is declared here
 *   as koffi char16_t / str16, never wchar_t (4 bytes on Linux and macOS).
 * - SAP_RAW is unsigned char; RFC_RC and RFC_ERROR_GROUP are C enums (int).
 * - All *_HANDLE types are opaque pointers; koffi 3 returns them as BigInt, and
 *   NULL as null.
 * - Lengths passed to and returned by the SDK for strings are in SAP_UC units,
 *   which equal the JS string length (UTF-16 code units).
 *
 * Only RfcOpenConnection, RfcGetFunctionDesc, RfcInvoke, RfcResetServerContext
 * and RfcCloseConnection go to the network; they run on koffi worker threads
 * (fn.async) so the event loop is never blocked. Everything else works on
 * local SDK memory and is called synchronously.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { RFC_RC, RfcConnection, RfcConnector, RfcError, RfcLogonParams, SadtHeader, SadtRequest, SadtResponse } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** RFC_RC names, indexed by value (sapnwrfc.h of SDK 7.50). */
const RFC_RC_NAMES: readonly string[] = [
  'RFC_OK', // 0
  'RFC_COMMUNICATION_FAILURE', // 1
  'RFC_LOGON_FAILURE', // 2
  'RFC_ABAP_RUNTIME_FAILURE', // 3
  'RFC_ABAP_MESSAGE', // 4
  'RFC_ABAP_EXCEPTION', // 5
  'RFC_CLOSED', // 6
  'RFC_CANCELED', // 7
  'RFC_TIMEOUT', // 8
  'RFC_MEMORY_INSUFFICIENT', // 9
  'RFC_VERSION_MISMATCH', // 10
  'RFC_INVALID_PROTOCOL', // 11
  'RFC_SERIALIZATION_FAILURE', // 12
  'RFC_INVALID_HANDLE', // 13
  'RFC_RETRY', // 14
  'RFC_EXTERNAL_FAILURE', // 15
  'RFC_EXECUTED', // 16
  'RFC_NOT_FOUND', // 17
  'RFC_NOT_SUPPORTED', // 18
  'RFC_ILLEGAL_STATE', // 19
  'RFC_INVALID_PARAMETER', // 20
  'RFC_CODEPAGE_CONVERSION_FAILURE', // 21
  'RFC_CONVERSION_FAILURE', // 22
  'RFC_BUFFER_TOO_SMALL', // 23
  'RFC_TABLE_MOVE_BOF', // 24
  'RFC_TABLE_MOVE_EOF', // 25
  // Added in later 7.50 patch levels.
  'RFC_START_SAPGUI_FAILURE', // 26
  'RFC_ABAP_CLASS_EXCEPTION', // 27
  'RFC_UNKNOWN_ERROR', // 28
  'RFC_AUTHORIZATION_FAILURE', // 29
  'RFC_AUTHENTICATION_FAILURE', // 30
  'RFC_CRYPTOLIB_FAILURE', // 31
  'RFC_IO_FAILURE', // 32
  'RFC_LOCKING_FAILURE', // 33
];

const RC_INVALID_PARAMETER = 20;
const RC_NOT_FOUND = 17;
const RC_BUFFER_TOO_SMALL = 23;

const ADT_FUNCTION = 'SADT_REST_RFC_ENDPOINT';

const SDK_INFO_URL = 'https://support.sap.com/en/product/connectors/nwrfcsdk.html';
/** Search of the SAP Software Download Center for the SDK (needs an S-user login). */
const SDK_DOWNLOAD_URL = 'https://me.sap.com/softwarecenter/search/SAP%20NW%20RFC%20SDK%207.50';
const SDK_NOTE = 'SAP Note 2573790';

/** Recommended SDK level; older ones still load, the transport may warn. */
const RECOMMENDED_SDK = { major: 7, minor: 50, patch: 12 };

/** Symbolic name of an RFC_RC value. */
function rfcRcName(code: number): string {
  return RFC_RC_NAMES[code] ?? `RFC_RC_${code}`;
}

// ---------------------------------------------------------------------------
// SDK location
// ---------------------------------------------------------------------------

type SdkSource = 'argument' | 'SAPNWRFC_HOME' | 'default';

interface SdkLocationInput {
  sdkPath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: string;
}

interface SdkLocation {
  platform: NodeJS.Platform;
  source: SdkSource;
  /** SDK folder as configured (absolute, normalized). */
  home: string;
  /** Library file name for the platform. */
  libraryName: string;
  /** Paths tried for the library, in order. */
  candidates: string[];
}

interface LocatedSdk extends SdkLocation {
  libraryPath: string;
  libDir: string;
}

function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

function libraryFileName(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'libsapnwrfc.dylib';
  if (platform === 'win32') return 'sapnwrfc.dll';
  return 'libsapnwrfc.so';
}

function defaultSdkHome(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'C:\\nwrfcsdk' : '/usr/local/sap/nwrfcsdk';
}

/**
 * Where to look for the SDK: sdkPath argument, else SAPNWRFC_HOME, else the
 * platform default. Accepts the SDK folder (containing lib/), the lib folder
 * itself, or the library file.
 */
function resolveSdkLocation(input: SdkLocationInput = {}): SdkLocation {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const p = pathFor(platform);
  const libraryName = libraryFileName(platform);

  let raw: string;
  let source: SdkSource;
  if (input.sdkPath && input.sdkPath.trim()) {
    raw = input.sdkPath.trim();
    source = 'argument';
  } else if (env.SAPNWRFC_HOME && env.SAPNWRFC_HOME.trim()) {
    raw = env.SAPNWRFC_HOME.trim();
    source = 'SAPNWRFC_HOME';
  } else {
    raw = defaultSdkHome(platform);
    source = 'default';
  }
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) {
    raw = p.join(input.homedir ?? os.homedir(), raw.slice(1));
  }
  const home = p.isAbsolute(raw) ? p.normalize(raw) : p.resolve(raw);
  const stripped = home.length > 1 ? home.replace(/[\\/]+$/, '') : home;

  const candidates: string[] = [];
  const caseInsensitive = platform === 'win32' || platform === 'darwin';
  const base = p.basename(stripped);
  if ((caseInsensitive ? base.toLowerCase() : base) === (caseInsensitive ? libraryName.toLowerCase() : libraryName)) {
    candidates.push(stripped);
  } else {
    candidates.push(p.join(stripped, 'lib', libraryName));
    candidates.push(p.join(stripped, libraryName));
  }
  return { platform, source, home: stripped, libraryName, candidates };
}

function sourceDescription(loc: SdkLocation): string {
  switch (loc.source) {
    case 'argument': return 'rfc.sdkPath';
    case 'SAPNWRFC_HOME': return 'the SAPNWRFC_HOME environment variable';
    default: return 'the default location (neither rfc.sdkPath nor SAPNWRFC_HOME is set)';
  }
}

function sdkNotFoundError(loc: SdkLocation): RfcError {
  const lines = [
    `SAP NetWeaver RFC SDK not found: looked for ${loc.candidates.join(' and ')} (SDK folder taken from ${sourceDescription(loc)}).`,
    'The RFC transport needs the SAP NetWeaver RFC SDK 7.50 (latest patch level). Download it from the SAP Software Download Center with your own S-user'
      + ` (${SDK_DOWNLOAD_URL}; product page ${SDK_INFO_URL}, ${SDK_NOTE}), unpack it, and set SAPNWRFC_HOME or rfc.sdkPath in systems.json to the unpacked folder (the one that contains lib/).`,
    'abap-adt-mcp cannot bundle the SDK because SAP\'s licence terms for connectors forbid redistribution.',
  ];
  return new RfcError(lines.join(' '), -1, 'SDK_NOT_FOUND');
}

function locateSdk(input: SdkLocationInput = {}, exists: (file: string) => boolean = isFile): LocatedSdk {
  const loc = resolveSdkLocation(input);
  const found = loc.candidates.find((c) => exists(c));
  if (!found) throw sdkNotFoundError(loc);
  return { ...loc, libraryPath: found, libDir: pathFor(loc.platform).dirname(found) };
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Platform-specific fix for a library that exists but does not load. */
function loadFailureHint(platform: NodeJS.Platform, home: string, libraryPath: string, arch: string = process.arch): string {
  if (platform === 'darwin') {
    return `On macOS check first that the SDK build matches this Node.js architecture (${arch}): MACOS ON ARM64 for arm64, MACOS X 64-BIT for x64.`
      + ` The SAP libraries are notarized; only if the message says the developer cannot be verified, run xattr -dr com.apple.quarantine "${home}" and try again.`;
  }
  if (platform === 'win32') {
    return 'On Windows the SDK needs the Microsoft Visual C++ 2015-2022 runtime (VCRUNTIME140.dll, VCRUNTIME140_1.dll, MSVCP140.dll):'
      + ' install the x64 package from https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist (administrator rights needed).'
      + ` Use the WINDOWS ON X64 SDK build with an x64 Node.js (this one is ${arch}).`;
  }
  return 'On Linux, install libuuid (libuuid1 on Debian, Ubuntu and SUSE, libuuid on RHEL) and run ldconfig;'
    + ` ldd "${libraryPath}" shows which dependency is missing. The SDK build must match this Node.js architecture (${arch}).`;
}

function sdkLoadFailedError(sdk: LocatedSdk, cause: string): RfcError {
  return new RfcError(
    `SAP NetWeaver RFC SDK found at ${sdk.libraryPath} but it could not be loaded: ${cause}. ${loadFailureHint(sdk.platform, sdk.home, sdk.libraryPath)}`,
    -1,
    'SDK_LOAD_FAILED',
  );
}

// ---------------------------------------------------------------------------
// SAP_UC and version helpers
// ---------------------------------------------------------------------------

/**
 * Decode SAP_UC code units to a JS string. Without length, stops at the first
 * NUL (fixed-size SAP_UC arrays of RFC_ERROR_INFO); with length, decodes
 * exactly that many units. Signed arrays (koffi char16_t -> Int16Array) are
 * accepted.
 */
function decodeSapUc(units: ArrayLike<number>, length?: number): string {
  let end: number;
  if (length === undefined) {
    end = 0;
    while (end < units.length && (units[end] & 0xffff) !== 0) end++;
  } else {
    end = Math.min(length, units.length);
  }
  let out = '';
  const CHUNK = 4096;
  for (let start = 0; start < end; start += CHUNK) {
    const stop = Math.min(start + CHUNK, end);
    const codes = new Array<number>(stop - start);
    for (let i = start; i < stop; i++) codes[i - start] = units[i] & 0xffff;
    out += String.fromCharCode(...codes);
  }
  return out;
}

/** Decode a SAP_UC buffer filled by the SDK (native byte order). */
function sapUcBufferToString(buf: Buffer, length: number): string {
  const units = Math.min(length, Math.floor(buf.length / 2));
  if (units <= 0) return '';
  if (os.endianness() === 'LE') return buf.toString('utf16le', 0, units * 2);
  const aligned = buf.byteOffset % 2 === 0 ? buf : Buffer.from(buf);
  return decodeSapUc(new Uint16Array(aligned.buffer, aligned.byteOffset, units), units);
}

interface SdkVersionInfo {
  major: number;
  minor: number;
  patchLevel: number;
  /** The version string RfcGetVersion returns. */
  text: string;
}

/**
 * "major.minor.patch" from RfcGetVersion. The SDK reports 7.50 as major 7500,
 * minor 0; that is normalized to 7.50 so the result reads like the release.
 */
function formatSdkVersion(major: number, minor: number, patchLevel: number): string {
  if (major >= 1000 && minor === 0) {
    return `${Math.floor(major / 1000)}.${String(Math.floor((major % 1000) / 10)).padStart(2, '0')}.${patchLevel}`;
  }
  if (major >= 100 && minor === 0) {
    return `${Math.floor(major / 100)}.${String(major % 100).padStart(2, '0')}.${patchLevel}`;
  }
  return `${major}.${minor}.${patchLevel}`;
}

/** A warning when the SDK is not 7.50 at the recommended patch level or later; undefined otherwise. */
export function sdkVersionWarning(version: string): string | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const rec = RECOMMENDED_SDK;
  const recText = `${rec.major}.${rec.minor} patch level ${rec.patch}`;
  if (!m) return `Unrecognized NW RFC SDK version "${version}"; ${recText} or later is recommended.`;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (major !== rec.major || minor !== rec.minor) {
    return `NW RFC SDK ${version} is not the supported 7.50 release; install ${recText} or later (${SDK_NOTE}).`;
  }
  if (patch < rec.patch) {
    return `NW RFC SDK ${version} is older than the recommended ${recText}; update it from the SAP Software Download Center (${SDK_NOTE}).`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// koffi
// ---------------------------------------------------------------------------

/** The part of the koffi 3.x API this binding uses (kept local so the build does not need koffi's typings). */
interface KoffiFn {
  (...args: unknown[]): unknown;
  async(...args: unknown[]): void;
}
interface KoffiLib {
  func(name: string, result: unknown, args: unknown[]): KoffiFn;
  /** C-like prototype string, e.g. 'void _exit(int status)'. */
  func(prototype: string): KoffiFn;
  unload(): void;
}
interface KoffiModule {
  load(path: string, options?: { lazy?: boolean; global?: boolean; deep?: boolean }): KoffiLib;
  struct(def: Record<string, unknown>): unknown;
  array(type: unknown, length: number, hint?: 'Array' | 'Typed' | 'Buffer' | 'String'): unknown;
  pointer(type: unknown): unknown;
  opaque(): unknown;
  out(type: unknown): unknown;
  sizeof(type: unknown): number;
  config?(settings?: Record<string, number>): Record<string, number>;
  version?: string;
}

const KOFFI_MODULE = 'koffi';

async function loadKoffi(importer: () => Promise<unknown> = () => import(KOFFI_MODULE)): Promise<KoffiModule> {
  let mod: any;
  try {
    mod = await importer();
  } catch (err) {
    const cause = err instanceof Error ? err.message.split('\n')[0] : String(err);
    throw new RfcError(
      `The RFC transport needs the optional dependency koffi (a native FFI module), which is not installed or has no build for ${process.platform}-${process.arch}`
        + ` (${cause}). npm skipped optional dependencies: check npm config get omit (a company .npmrc often sets omit=optional), remove that setting,`
        + ' then delete the npx cache (~/.npm/_npx, or %LOCALAPPDATA%\\npm-cache\\_npx on Windows) and restart the host; a global install needs npm install -g abap-adt-mcp without --omit=optional.',
      -1,
      'KOFFI_MISSING',
    );
  }
  const koffi = mod && typeof mod.load === 'function' ? mod : mod?.default;
  if (!koffi || typeof koffi.load !== 'function' || typeof koffi.struct !== 'function') {
    throw new RfcError('The installed koffi module does not expose the expected API (koffi 3.x is required). Reinstall abap-adt-mcp.', -1, 'KOFFI_MISSING');
  }
  configureKoffi(koffi as KoffiModule);
  return koffi as KoffiModule;
}

let koffiConfigured = false;

/**
 * The network calls (RfcOpenConnection, RfcInvoke, ...) run as koffi async
 * calls, whose stack is 128 KiB by default; an RFC logon (CPIC, code page and
 * crypto setup) can need more. Calls are serialized per connection, so a
 * larger stack costs little. koffi accepts this only before the first library
 * is loaded; a refusal keeps the defaults.
 */
function configureKoffi(koffi: KoffiModule): void {
  if (koffiConfigured || typeof koffi.config !== 'function') return;
  koffiConfigured = true;
  try {
    koffi.config({ ...koffi.config(), async_stack_size: 1024 * 1024, async_heap_size: 256 * 1024 });
  } catch { /* already configured or a library already loaded: keep the defaults */ }
}

let exitHookInstalled = false;

/**
 * Once the SDK is loaded the process cannot end on its own: at exit the SDK
 * closes file descriptors 0, 1 and 2, and koffi's exit-time flush of stdout
 * then blocks on its own lock, so neither a natural end nor process.exit()
 * returns. The last 'exit' listener therefore ends the process directly with
 * the C runtime's immediate exit (POSIX _exit, Windows TerminateProcess),
 * which skips the exit-time handlers that hang. Everything Node runs on exit
 * has run by then; RFC connections close with the process, and SAP ends their
 * sessions (and releases their locks) when the connection drops.
 */
function installExitHook(koffi: KoffiModule, platform: NodeJS.Platform): void {
  if (exitHookInstalled) return;
  let hardExit: ((code: number) => void) | undefined;
  try {
    if (platform === 'win32') {
      const k32 = koffi.load('kernel32.dll');
      const getCurrentProcess = k32.func('void * __stdcall GetCurrentProcess()') as (...a: unknown[]) => unknown;
      const terminateProcess = k32.func('bool __stdcall TerminateProcess(void *hProcess, uint32_t uExitCode)') as (...a: unknown[]) => unknown;
      hardExit = (code) => { terminateProcess(getCurrentProcess(), code >>> 0); };
    } else {
      const candidates = platform === 'darwin' ? ['/usr/lib/libSystem.B.dylib'] : ['libc.so.6', 'libc.so'];
      for (const name of candidates) {
        try {
          const libc = koffi.load(name);
          const exitNow = libc.func('void _exit(int status)') as (...a: unknown[]) => unknown;
          hardExit = (code) => { exitNow(code | 0); };
          break;
        } catch { /* try the next name */ }
      }
    }
  } catch { hardExit = undefined; }
  exitHookInstalled = true;
  if (!hardExit) {
    console.error('[abap-adt-mcp] The SAP NW RFC SDK is loaded but the C runtime exit could not be bound; this process may not end by itself and may need to be stopped by the host.');
    return;
  }
  const exitNow = hardExit;
  const onExit = (code: number) => {
    const status = typeof code === 'number' ? code : (typeof process.exitCode === 'number' ? process.exitCode : 0);
    // Listeners registered after this one (a browser login window that must be
    // closed, for example) would never run after the immediate exit: run them first.
    const listeners = process.listeners('exit');
    for (const listener of listeners.slice(listeners.indexOf(onExit) + 1)) {
      try { (listener as (c: number) => void).call(process, status); } catch { /* keep going */ }
    }
    try { exitNow(status); } catch { /* fall back to the normal exit path */ }
  };
  process.on('exit', onExit);
}

/**
 * koffi types for the SDK. All anonymous (type objects, not names), so they
 * can be created more than once per process without "Duplicate type name".
 */
function defineTypes(koffi: KoffiModule) {
  // const SAP_UC*: str16, i.e. NUL-terminated UTF-16 converted from/to JS strings.
  const UC_STR = 'const char16_t *';
  const sapUc = (n: number) => koffi.array('char16_t', n, 'Typed');
  // typedef struct { RFC_RC code; RFC_ERROR_GROUP group; SAP_UC key[128]; SAP_UC message[512];
  //   SAP_UC abapMsgClass[21]; SAP_UC abapMsgType[2]; SAP_UC abapMsgNumber[4];
  //   SAP_UC abapMsgV1[51]; ... abapMsgV4[51]; } RFC_ERROR_INFO;
  // 8 + 871 * 2 = 1750 bytes, padded to 1752 by the 4-byte alignment of the
  // enums: natural alignment (koffi.struct), not packed.
  const ErrorInfo = koffi.struct({
    code: 'int',
    group: 'int',
    key: sapUc(128),
    message: sapUc(512),
    abapMsgClass: sapUc(21),
    abapMsgType: sapUc(2),
    abapMsgNumber: sapUc(4),
    abapMsgV1: sapUc(51),
    abapMsgV2: sapUc(51),
    abapMsgV3: sapUc(51),
    abapMsgV4: sapUc(51),
  });
  // typedef struct { const SAP_UC* name; const SAP_UC* value; } RFC_CONNECTION_PARAMETER;
  const ConnectionParameter = koffi.struct({ name: UC_STR, value: UC_STR });
  // RFC_*_HANDLE / DATA_CONTAINER_HANDLE: pointers to opaque SDK objects.
  const Handle = koffi.pointer(koffi.opaque());
  return {
    UC_STR,
    ErrorInfo,
    ConnectionParameter,
    /** const RFC_CONNECTION_PARAMETER*: a JS array of { name, value } objects. */
    CONNECTION_PARAMS: koffi.pointer(ConnectionParameter),
    Handle,
    RC: 'int',
    UINT: 'unsigned int',
    /** SAP_UC* output buffer; a Buffer is passed and written in place. */
    UC_BUF: 'char16_t *',
    /** SAP_RAW* (unsigned char); a Buffer is passed directly. */
    RAW_IN: 'const uint8_t *',
    RAW_BUF: 'uint8_t *',
    OUT_ERROR: koffi.out(koffi.pointer(ErrorInfo)),
    OUT_UINT: koffi.out(koffi.pointer('unsigned int')),
    OUT_HANDLE: koffi.out(koffi.pointer(Handle)),
  };
}

type SdkHandle = bigint;

interface ErrorInfoJs {
  code?: number;
  group?: number;
  key?: ArrayLike<number>;
  message?: ArrayLike<number>;
  abapMsgClass?: ArrayLike<number>;
  abapMsgType?: ArrayLike<number>;
  abapMsgNumber?: ArrayLike<number>;
  abapMsgV1?: ArrayLike<number>;
  abapMsgV2?: ArrayLike<number>;
  abapMsgV3?: ArrayLike<number>;
  abapMsgV4?: ArrayLike<number>;
}

/** RfcError from an RFC_ERROR_INFO. Never includes connection parameter values. */
function errorFromInfo(info: ErrorInfoJs, rc: number, context: string): RfcError {
  const code = typeof info.code === 'number' && info.code !== 0 ? info.code : rc;
  const name = rfcRcName(code);
  const dec = (u?: ArrayLike<number>) => (u ? decodeSapUc(u).trim() : '');
  const key = dec(info.key);
  const message = dec(info.message);
  const msgClass = dec(info.abapMsgClass);
  const msgType = dec(info.abapMsgType);
  const msgNumber = dec(info.abapMsgNumber);
  const abapMessage = msgClass || msgType || msgNumber
    ? { msgClass, msgType, msgNumber, v1: dec(info.abapMsgV1), v2: dec(info.abapMsgV2), v3: dec(info.abapMsgV3), v4: dec(info.abapMsgV4) }
    : undefined;
  let text = `${context}: ${name}`;
  if (key && key !== name) text += ` (${key})`;
  if (message) text += `: ${message}`;
  if (abapMessage) text += ` [ABAP message ${abapMessage.msgType}${abapMessage.msgNumber}(${abapMessage.msgClass})]`;
  return new RfcError(text, code, name, typeof info.group === 'number' ? info.group : undefined, key || undefined, abapMessage);
}

function bindingError(context: string, err: unknown): RfcError {
  if (err instanceof RfcError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  return new RfcError(`${context}: ${msg}`, -1, 'BINDING_ERROR');
}

function callAsync(fn: KoffiFn, args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      fn.async(...args, (err: unknown, res: unknown) => (err ? reject(err) : resolve(res)));
    } catch (err) {
      reject(err);
    }
  });
}

/** Names of the SDK functions this binding needs, for the symbol check. */
const SDK_FUNCTIONS = [
  'RfcOpenConnection', 'RfcCloseConnection', 'RfcResetServerContext', 'RfcGetFunctionDesc', 'RfcCreateFunction',
  'RfcDestroyFunction', 'RfcInvoke', 'RfcGetStructure', 'RfcGetTable', 'RfcAppendNewRow', 'RfcGetRowCount', 'RfcMoveTo',
  'RfcGetCurrentRow', 'RfcSetString', 'RfcSetXString', 'RfcGetStringLength', 'RfcGetString', 'RfcGetXString', 'RfcGetVersion',
  'RfcSetIniPath', 'RfcSetTraceDir',
] as const;
type SdkFunctionName = typeof SDK_FUNCTIONS[number];
/** Bound when the SDK has them; a patch level without them still loads. */
const OPTIONAL_SDK_FUNCTIONS: ReadonlySet<string> = new Set(['RfcSetIniPath', 'RfcSetTraceDir']);

/** The loaded SDK: koffi functions plus the libraries kept referenced (koffi unloads a library once unreferenced). */
interface SdkApi {
  fn: Record<SdkFunctionName, KoffiFn>;
  libs: KoffiLib[];
  types: ReturnType<typeof defineTypes>;
}

function bindFunctions(lib: KoffiLib, t: ReturnType<typeof defineTypes>): { fn: Partial<Record<SdkFunctionName, KoffiFn>>; missing: string[]; errors: string[] } {
  const H = t.Handle;
  const signatures: Record<SdkFunctionName, [unknown, unknown[]]> = {
    // RFC_CONNECTION_HANDLE RfcOpenConnection(const RFC_CONNECTION_PARAMETER* connectionParams, unsigned paramCount, RFC_ERROR_INFO* errorInfo)
    RfcOpenConnection: [H, [t.CONNECTION_PARAMS, t.UINT, t.OUT_ERROR]],
    // RFC_RC RfcCloseConnection(RFC_CONNECTION_HANDLE rfcHandle, RFC_ERROR_INFO* errorInfo)
    RfcCloseConnection: [t.RC, [H, t.OUT_ERROR]],
    // RFC_RC RfcResetServerContext(RFC_CONNECTION_HANDLE rfcHandle, RFC_ERROR_INFO* errorInfo)
    RfcResetServerContext: [t.RC, [H, t.OUT_ERROR]],
    // RFC_FUNCTION_DESC_HANDLE RfcGetFunctionDesc(RFC_CONNECTION_HANDLE rfcHandle, const SAP_UC* funcName, RFC_ERROR_INFO* errorInfo)
    RfcGetFunctionDesc: [H, [H, t.UC_STR, t.OUT_ERROR]],
    // RFC_FUNCTION_HANDLE RfcCreateFunction(RFC_FUNCTION_DESC_HANDLE funcDescHandle, RFC_ERROR_INFO* errorInfo)
    RfcCreateFunction: [H, [H, t.OUT_ERROR]],
    // RFC_RC RfcDestroyFunction(RFC_FUNCTION_HANDLE funcHandle, RFC_ERROR_INFO* errorInfo)
    RfcDestroyFunction: [t.RC, [H, t.OUT_ERROR]],
    // RFC_RC RfcInvoke(RFC_CONNECTION_HANDLE rfcHandle, RFC_FUNCTION_HANDLE funcHandle, RFC_ERROR_INFO* errorInfo)
    RfcInvoke: [t.RC, [H, H, t.OUT_ERROR]],
    // RFC_RC RfcGetStructure(DATA_CONTAINER_HANDLE dataHandle, const SAP_UC* name, RFC_STRUCTURE_HANDLE* structHandle, RFC_ERROR_INFO* errorInfo)
    RfcGetStructure: [t.RC, [H, t.UC_STR, t.OUT_HANDLE, t.OUT_ERROR]],
    // RFC_RC RfcGetTable(DATA_CONTAINER_HANDLE dataHandle, const SAP_UC* name, RFC_TABLE_HANDLE* tableHandle, RFC_ERROR_INFO* errorInfo)
    RfcGetTable: [t.RC, [H, t.UC_STR, t.OUT_HANDLE, t.OUT_ERROR]],
    // RFC_STRUCTURE_HANDLE RfcAppendNewRow(RFC_TABLE_HANDLE tableHandle, RFC_ERROR_INFO* errorInfo)
    RfcAppendNewRow: [H, [H, t.OUT_ERROR]],
    // RFC_RC RfcGetRowCount(RFC_TABLE_HANDLE tableHandle, unsigned* rowCount, RFC_ERROR_INFO* errorInfo)
    RfcGetRowCount: [t.RC, [H, t.OUT_UINT, t.OUT_ERROR]],
    // RFC_RC RfcMoveTo(RFC_TABLE_HANDLE tableHandle, unsigned index, RFC_ERROR_INFO* errorInfo)
    RfcMoveTo: [t.RC, [H, t.UINT, t.OUT_ERROR]],
    // RFC_STRUCTURE_HANDLE RfcGetCurrentRow(RFC_TABLE_HANDLE tableHandle, RFC_ERROR_INFO* errorInfo)
    RfcGetCurrentRow: [H, [H, t.OUT_ERROR]],
    // RFC_RC RfcSetString(DATA_CONTAINER_HANDLE dataHandle, const SAP_UC* name, const SAP_UC* value, unsigned valueLength, RFC_ERROR_INFO* errorInfo)
    RfcSetString: [t.RC, [H, t.UC_STR, t.UC_STR, t.UINT, t.OUT_ERROR]],
    // RFC_RC RfcSetXString(DATA_CONTAINER_HANDLE dataHandle, const SAP_UC* name, const SAP_RAW* value, unsigned valueLength, RFC_ERROR_INFO* errorInfo)
    RfcSetXString: [t.RC, [H, t.UC_STR, t.RAW_IN, t.UINT, t.OUT_ERROR]],
    // RFC_RC RfcGetStringLength(DATA_CONTAINER_HANDLE dataHandle, const SAP_UC* name, unsigned* stringLength, RFC_ERROR_INFO* errorInfo)
    RfcGetStringLength: [t.RC, [H, t.UC_STR, t.OUT_UINT, t.OUT_ERROR]],
    // RFC_RC RfcGetString(DATA_CONTAINER_HANDLE dataHandle, const SAP_UC* name, SAP_UC* stringBuffer, unsigned bufferLength, unsigned* stringLength, RFC_ERROR_INFO* errorInfo)
    RfcGetString: [t.RC, [H, t.UC_STR, t.UC_BUF, t.UINT, t.OUT_UINT, t.OUT_ERROR]],
    // RFC_RC RfcGetXString(DATA_CONTAINER_HANDLE dataHandle, const SAP_UC* name, SAP_RAW* byteBuffer, unsigned bufferLength, unsigned* xstringLength, RFC_ERROR_INFO* errorInfo)
    RfcGetXString: [t.RC, [H, t.UC_STR, t.RAW_BUF, t.UINT, t.OUT_UINT, t.OUT_ERROR]],
    // const SAP_UC* RfcGetVersion(unsigned* majorVersion, unsigned* minorVersion, unsigned* patchLevel)
    RfcGetVersion: [t.UC_STR, [t.OUT_UINT, t.OUT_UINT, t.OUT_UINT]],
    // RFC_RC RfcSetIniPath(const SAP_UC* pathName, RFC_ERROR_INFO* errorInfo)
    RfcSetIniPath: [t.RC, [t.UC_STR, t.OUT_ERROR]],
    // RFC_RC RfcSetTraceDir(SAP_UC* traceDir, RFC_ERROR_INFO* errorInfo)
    RfcSetTraceDir: [t.RC, [t.UC_STR, t.OUT_ERROR]],
  };
  const fn: Partial<Record<SdkFunctionName, KoffiFn>> = {};
  const missing: string[] = [];
  const errors: string[] = [];
  for (const name of SDK_FUNCTIONS) {
    const [result, args] = signatures[name];
    try {
      fn[name] = lib.func(name, result, args);
    } catch (err) {
      // Settings the transport can live without do not make an SDK unusable.
      if (OPTIONAL_SDK_FUNCTIONS.has(name)) continue;
      const msg = err instanceof Error ? err.message : String(err);
      if (/cannot find|not find|symbol/i.test(msg)) missing.push(name);
      else errors.push(`${name}: ${msg}`);
    }
  }
  return { fn, missing, errors };
}

// ---------------------------------------------------------------------------
// Library loading
// ---------------------------------------------------------------------------

/**
 * Sibling libraries to load by absolute path before the main one, so that its
 * dependencies (libsapucum, the bundled ICU) resolve without LD_LIBRARY_PATH
 * or DYLD_LIBRARY_PATH: a dependency whose name is already loaded is reused.
 * Linux needs this; on macOS it is a harmless best effort; Windows uses PATH.
 */
function preloadCandidates(platform: NodeJS.Platform, libDir: string, readdir: (dir: string) => string[] = (d) => fs.readdirSync(d)): string[] {
  if (platform === 'win32') return [];
  let names: string[];
  try {
    names = readdir(libDir);
  } catch {
    return [];
  }
  const mac = platform === 'darwin';
  const icuRe = mac ? /^libicu[a-z0-9]*(\.\d+)*\.dylib$/ : /^libicu[a-z0-9]*\.so(\.\d+)*$/;
  const sapucum = mac ? 'libsapucum.dylib' : 'libsapucum.so';
  const rank = (n: string) => (n.startsWith('libicudata') ? 0 : n.startsWith('libicuuc') ? 1 : n.startsWith('libicui18n') ? 2 : 3);
  const icu = names.filter((n) => icuRe.test(n) && !n.startsWith('libicudecnumber'))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const ordered = [...icu];
  if (names.includes(sapucum)) ordered.push(sapucum);
  ordered.push(...names.filter((n) => n.startsWith('libicudecnumber') && icuRe.test(n)).sort());
  return ordered.map((n) => path.posix.join(libDir, n));
}

/** Loads the given files, retrying the ones that failed once others are in (unknown dependency order). */
function preload(koffi: KoffiModule, files: string[]): { libs: KoffiLib[]; failed: string[] } {
  const libs: KoffiLib[] = [];
  const lastError = new Map<string, string>();
  let pending = files;
  for (let pass = 0; pass < 3 && pending.length > 0; pass++) {
    const next: string[] = [];
    for (const file of pending) {
      try {
        libs.push(koffi.load(file));
      } catch (err) {
        next.push(file);
        lastError.set(file, firstLine(err));
      }
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  return { libs, failed: pending.map((f) => `${path.basename(f)} (${lastError.get(f)})`) };
}

/** Windows: the SDK DLL finds its sibling DLLs (sapucum.dll, ICU) through PATH. */
function prependWindowsPath(libDir: string, env: NodeJS.ProcessEnv = process.env): void {
  const current = env.PATH ?? '';
  const norm = (s: string) => s.trim().replace(/[\\/]+$/, '').toLowerCase();
  if (current.split(';').some((part) => norm(part) === norm(libDir))) return;
  env.PATH = current ? `${libDir};${current}` : libDir;
}

function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const line = msg.split('\n')[0].trim();
  return line.length > 1000 ? `${line.slice(0, 1000)}...` : line;
}

/**
 * Folder for the SDK's own files: dev_rfc.log, rfc*.trc and a sapnwrfc.ini a
 * user may want to place there. Without it the SDK writes its log into, and
 * reads sapnwrfc.ini from, the current working directory, which for an MCP
 * host is often the user's project (a log to be committed by accident, or an
 * ini file in a cloned repository turning on full RFC traces).
 */
export function rfcWorkDir(homedir: string = os.homedir()): string {
  return path.join(homedir, '.abap-adt-mcp', 'rfc');
}

function ensurePrivateDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(dir, 0o700);
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function loadSdk(koffi: KoffiModule, sdk: LocatedSdk): { api: SdkApi; version: SdkVersionInfo } {
  // The SDK reads sapnwrfc.ini and opens dev_rfc.log in the current working
  // directory while it initialises, so the load runs with the working
  // directory switched to a private folder (synchronously: no other JS runs
  // until it is switched back), and the SDK is then told to keep using it.
  const workDir = rfcWorkDir();
  const previousCwd = process.cwd();
  let switched = false;
  if (ensurePrivateDir(workDir)) {
    try { process.chdir(workDir); switched = true; } catch { switched = false; }
  }
  try {
    const loaded = loadSdkInCwd(koffi, sdk);
    if (switched) {
      const info = {};
      try { loaded.api.fn.RfcSetIniPath?.(workDir, info); } catch { /* keep the default */ }
      try { loaded.api.fn.RfcSetTraceDir?.(workDir, info); } catch { /* keep the default */ }
    }
    return loaded;
  } finally {
    if (switched) {
      try { process.chdir(previousCwd); } catch { /* the previous folder vanished; stay in the private one */ }
    }
  }
}

function loadSdkInCwd(koffi: KoffiModule, sdk: LocatedSdk): { api: SdkApi; version: SdkVersionInfo } {
  if (sdk.platform === 'win32') prependWindowsPath(sdk.libDir);
  const pre = preload(koffi, preloadCandidates(sdk.platform, sdk.libDir));
  let lib: KoffiLib;
  try {
    lib = koffi.load(sdk.libraryPath);
  } catch (err) {
    let cause = firstLine(err);
    if (pre.failed.length > 0) cause += `; sibling libraries that did not load: ${pre.failed.join(', ')}`;
    throw sdkLoadFailedError(sdk, cause);
  }
  // Loading the library is what makes the exit hang, whether or not the SDK
  // then passes the checks below.
  installExitHook(koffi, sdk.platform);
  const types = defineTypes(koffi);
  const bound = bindFunctions(lib, types);
  if (bound.missing.length > 0 || bound.errors.length > 0) {
    const parts: string[] = [];
    if (bound.missing.length > 0) parts.push(`it does not export ${bound.missing.join(', ')}`);
    if (bound.errors.length > 0) parts.push(`binding failed for ${bound.errors.join('; ')}`);
    throw new RfcError(
      `The library at ${sdk.libraryPath} is not a usable SAP NetWeaver RFC SDK 7.50: ${parts.join('; ')}.`
        + ' Point SAPNWRFC_HOME or rfc.sdkPath at the NW RFC SDK 7.50 folder (not the classic RFC SDK).',
      -1,
      'SDK_LOAD_FAILED',
    );
  }
  const fn = bound.fn as Record<SdkFunctionName, KoffiFn>;
  const major = [0];
  const minor = [0];
  const patch = [0];
  let text = '';
  try {
    text = (fn.RfcGetVersion(major, minor, patch) as string | null) ?? '';
  } catch (err) {
    throw sdkLoadFailedError(sdk, `RfcGetVersion failed: ${firstLine(err)}`);
  }
  return {
    api: { fn, libs: [...pre.libs, lib], types },
    version: { major: major[0], minor: minor[0], patchLevel: patch[0], text },
  };
}

// ---------------------------------------------------------------------------
// Data container access (local SDK memory, synchronous)
// ---------------------------------------------------------------------------

const RFC_UNKNOWN_ERROR = 28;

class SdkOps {
  constructor(private readonly api: SdkApi) {}

  private get fn() {
    return this.api.fn;
  }

  private check(rc: unknown, info: ErrorInfoJs, context: string): void {
    if (rc !== RFC_RC.RFC_OK) throw errorFromInfo(info, typeof rc === 'number' ? rc : RFC_UNKNOWN_ERROR, context);
  }

  private handle(result: unknown, info: ErrorInfoJs, context: string): SdkHandle {
    if (!result) throw errorFromInfo(info, RFC_UNKNOWN_ERROR, context);
    return result as SdkHandle;
  }

  createFunction(desc: SdkHandle): SdkHandle {
    const info: ErrorInfoJs = {};
    return this.handle(this.fn.RfcCreateFunction(desc, info), info, `RfcCreateFunction ${ADT_FUNCTION} failed`);
  }

  destroyFunction(fnHandle: SdkHandle): void {
    try {
      this.fn.RfcDestroyFunction(fnHandle, {});
    } catch {
      // Nothing useful to do: the handle is gone either way.
    }
  }

  getStructure(container: SdkHandle, name: string, at: string): SdkHandle {
    const out: unknown[] = [null];
    const info: ErrorInfoJs = {};
    this.check(this.fn.RfcGetStructure(container, name, out, info), info, `RfcGetStructure ${at} failed`);
    return this.handle(out[0], info, `RfcGetStructure ${at} returned no handle`);
  }

  getTable(container: SdkHandle, name: string, at: string): SdkHandle {
    const out: unknown[] = [null];
    const info: ErrorInfoJs = {};
    this.check(this.fn.RfcGetTable(container, name, out, info), info, `RfcGetTable ${at} failed`);
    return this.handle(out[0], info, `RfcGetTable ${at} returned no handle`);
  }

  appendRow(table: SdkHandle, at: string): SdkHandle {
    const info: ErrorInfoJs = {};
    return this.handle(this.fn.RfcAppendNewRow(table, info), info, `RfcAppendNewRow ${at} failed`);
  }

  rowCount(table: SdkHandle, at: string): number {
    const out = [0];
    const info: ErrorInfoJs = {};
    this.check(this.fn.RfcGetRowCount(table, out, info), info, `RfcGetRowCount ${at} failed`);
    return out[0];
  }

  currentRowAt(table: SdkHandle, index: number, at: string): SdkHandle {
    const info: ErrorInfoJs = {};
    this.check(this.fn.RfcMoveTo(table, index, info), info, `RfcMoveTo ${at}[${index}] failed`);
    const rowInfo: ErrorInfoJs = {};
    return this.handle(this.fn.RfcGetCurrentRow(table, rowInfo), rowInfo, `RfcGetCurrentRow ${at}[${index}] failed`);
  }

  /** RfcSetString; valueLength in SAP_UC units = JS string length. Works for STRING and CHAR fields. */
  setString(container: SdkHandle, name: string, value: string, at: string): void {
    const info: ErrorInfoJs = {};
    this.check(this.fn.RfcSetString(container, name, value, value.length, info), info, `RfcSetString ${at} failed`);
  }

  setXString(container: SdkHandle, name: string, value: Uint8Array, at: string): void {
    const info: ErrorInfoJs = {};
    this.check(this.fn.RfcSetXString(container, name, value, value.length, info), info, `RfcSetXString ${at} failed`);
  }

  /** RfcGetStringLength: SAP_UC units for STRING, bytes for XSTRING; undefined when the SDK refuses (e.g. not a STRING field). */
  private stringLength(container: SdkHandle, name: string): { length?: number; rc: number; info: ErrorInfoJs } {
    const out = [0];
    const info: ErrorInfoJs = {};
    const rc = this.fn.RfcGetStringLength(container, name, out, info) as number;
    return rc === RFC_RC.RFC_OK ? { length: out[0], rc, info } : { rc, info };
  }

  getString(container: SdkHandle, name: string, at: string): string {
    const known = this.stringLength(container, name).length;
    let size = known !== undefined ? known + 1 : 256;
    for (let attempt = 0; attempt < 4; attempt++) {
      // bufferLength counts SAP_UC units and includes room for the terminating zero.
      const buf = Buffer.alloc(size * 2);
      const out = [0];
      const info: ErrorInfoJs = {};
      const rc = this.fn.RfcGetString(container, name, buf, size, out, info) as number;
      if (rc === RFC_RC.RFC_OK) return sapUcBufferToString(buf, Math.min(out[0], size - 1));
      if (rc !== RC_BUFFER_TOO_SMALL) throw errorFromInfo(info, rc, `RfcGetString ${at} failed`);
      size = Math.max(out[0] + 1, size * 2);
    }
    throw new RfcError(`RfcGetString ${at}: buffer still too small after resizing`, RC_BUFFER_TOO_SMALL, rfcRcName(RC_BUFFER_TOO_SMALL));
  }

  getXString(container: SdkHandle, name: string, at: string): Buffer {
    const known = this.stringLength(container, name).length;
    if (known === 0) return Buffer.alloc(0);
    let size = known !== undefined ? known : 64 * 1024;
    for (let attempt = 0; attempt < 4; attempt++) {
      const buf = Buffer.alloc(size);
      const out = [0];
      const info: ErrorInfoJs = {};
      const rc = this.fn.RfcGetXString(container, name, buf, size, out, info) as number;
      if (rc === RFC_RC.RFC_OK) return buf.subarray(0, Math.min(out[0], size));
      if (rc !== RC_BUFFER_TOO_SMALL) throw errorFromInfo(info, rc, `RfcGetXString ${at} failed`);
      size = Math.max(out[0], size * 2);
    }
    throw new RfcError(`RfcGetXString ${at}: buffer still too small after resizing`, RC_BUFFER_TOO_SMALL, rfcRcName(RC_BUFFER_TOO_SMALL));
  }

  /**
   * Whether a STRING, CHAR or XSTRING field exists. RfcGetStringLength only
   * accepts STRING/XSTRING, so a refusal falls back to a small RfcGetString
   * and RfcGetXString read; only "not found" on all of them means missing.
   */
  fieldExists(container: SdkHandle, name: string): { exists: boolean; error?: RfcError } {
    const len = this.stringLength(container, name);
    if (len.rc === RFC_RC.RFC_OK) return { exists: true };
    const missing = (rc: number) => rc === RC_INVALID_PARAMETER || rc === RC_NOT_FOUND;
    if (!missing(len.rc)) return { exists: true };
    const s = this.fn.RfcGetString(container, name, Buffer.alloc(16), 8, [0], {}) as number;
    if (s === RFC_RC.RFC_OK || s === RC_BUFFER_TOO_SMALL) return { exists: true };
    const x = this.fn.RfcGetXString(container, name, Buffer.alloc(8), 8, [0], {}) as number;
    if (x === RFC_RC.RFC_OK || x === RC_BUFFER_TOO_SMALL) return { exists: true };
    return { exists: false, error: errorFromInfo(len.info, len.rc, `RfcGetStringLength ${name}`) };
  }
}

// ---------------------------------------------------------------------------
// Connector and connection
// ---------------------------------------------------------------------------

/** STRUCTURE/sub-structure/fields of REQUEST and RESPONSE (see types.ts). */
const ADT_INTERFACE = [
  { param: 'REQUEST', line: 'REQUEST_LINE', lineFields: ['METHOD', 'URI', 'VERSION'] },
  { param: 'RESPONSE', line: 'STATUS_LINE', lineFields: ['VERSION', 'STATUS_CODE', 'REASON_PHRASE'] },
] as const;

function interfaceMismatch(at: string, cause?: RfcError): RfcError {
  return new RfcError(
    `${ADT_FUNCTION} on this system does not have the interface the RFC transport expects: ${at} is missing or has another type`
      + `${cause ? ` (${cause.message})` : ''}.`,
    -1,
    'SADT_INTERFACE_MISMATCH',
    cause?.group,
    cause?.key,
  );
}

class NwRfcConnection implements RfcConnection {
  private handle: SdkHandle | null;
  private broken = false;
  private queue: Promise<unknown> = Promise.resolve();
  private functionDesc: SdkHandle | null = null;
  private interfaceChecked = false;
  private readonly ops: SdkOps;

  constructor(private readonly api: SdkApi, handle: SdkHandle) {
    this.handle = handle;
    this.ops = new SdkOps(api);
  }

  get closed(): boolean {
    return this.handle === null || this.broken;
  }

  callAdt(request: SadtRequest): Promise<SadtResponse> {
    return this.serialize(() => this.doCallAdt(request));
  }

  reset(): Promise<void> {
    return this.serialize(() => this.doReset());
  }

  close(): Promise<void> {
    return this.serialize(() => this.doClose());
  }

  /** Promise-chain mutex: one SDK call at a time per connection (the SDK forbids concurrent use of a handle). */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private requireOpen(): SdkHandle {
    if (this.handle === null || this.broken) {
      throw new RfcError(
        this.broken ? 'RFC connection is broken (the SDK reported it lost); open a new one' : 'RFC connection is closed',
        RFC_RC.RFC_CLOSED,
        'RFC_CLOSED',
      );
    }
    return this.handle;
  }

  /** Calls that go to the backend run on a koffi worker thread. */
  private async network(name: 'RfcGetFunctionDesc' | 'RfcInvoke' | 'RfcResetServerContext', args: unknown[]): Promise<unknown> {
    try {
      return await callAsync(this.api.fn[name], args);
    } catch (err) {
      throw bindingError(`${name} failed`, err);
    }
  }

  /**
   * COMMUNICATION_FAILURE, CLOSED, INVALID_HANDLE and TIMEOUT leave the
   * connection unusable, and so do ABAP_MESSAGE and ABAP_RUNTIME_FAILURE: the
   * SDK closes the connection after them (sapnwrfc.h, RfcInvoke).
   */
  private fail(err: RfcError): RfcError {
    if (err.closesConnection) this.broken = true;
    return err;
  }

  private async getFunctionDesc(h: SdkHandle): Promise<SdkHandle> {
    if (this.functionDesc) return this.functionDesc;
    const info: ErrorInfoJs = {};
    const desc = await this.network('RfcGetFunctionDesc', [h, ADT_FUNCTION, info]);
    if (!desc) {
      const err = errorFromInfo(info, RFC_UNKNOWN_ERROR, `Cannot read the interface of ${ADT_FUNCTION}`);
      if (err.connectionLost) throw this.fail(err);
      throw new RfcError(
        `${err.message}. The function module comes with ADT; the RFC user needs RFC authorization (S_RFC) for it.`,
        err.rfcCode, err.rfcCodeName, err.group, err.key, err.abapMessage,
      );
    }
    this.functionDesc = desc as SdkHandle;
    return this.functionDesc;
  }

  /** First use: the REQUEST/RESPONSE layout must match, checked on a throwaway function handle. */
  private checkInterface(desc: SdkHandle): void {
    const ops = this.ops;
    const probe = <T>(at: string, f: () => T): T => {
      try {
        return f();
      } catch (err) {
        throw interfaceMismatch(at, err instanceof RfcError ? err : undefined);
      }
    };
    const field = (container: SdkHandle, name: string, at: string) => {
      const r = ops.fieldExists(container, name);
      if (!r.exists) throw interfaceMismatch(at, r.error);
    };
    const fnHandle = ops.createFunction(desc);
    try {
      for (const spec of ADT_INTERFACE) {
        const s = probe(spec.param, () => ops.getStructure(fnHandle, spec.param, spec.param));
        const lineAt = `${spec.param}/${spec.line}`;
        const line = probe(lineAt, () => ops.getStructure(s, spec.line, lineAt));
        for (const f of spec.lineFields) field(line, f, `${lineAt}/${f}`);
        const tabAt = `${spec.param}/HEADER_FIELDS`;
        const tab = probe(tabAt, () => ops.getTable(s, 'HEADER_FIELDS', tabAt));
        const row = probe(tabAt, () => ops.appendRow(tab, tabAt));
        field(row, 'NAME', `${tabAt}/NAME`);
        field(row, 'VALUE', `${tabAt}/VALUE`);
        field(s, 'MESSAGE_BODY', `${spec.param}/MESSAGE_BODY`);
      }
    } finally {
      ops.destroyFunction(fnHandle);
    }
  }

  private writeRequest(fnHandle: SdkHandle, req: SadtRequest): void {
    const ops = this.ops;
    const request = ops.getStructure(fnHandle, 'REQUEST', 'REQUEST');
    const line = ops.getStructure(request, 'REQUEST_LINE', 'REQUEST/REQUEST_LINE');
    ops.setString(line, 'METHOD', req.method, 'REQUEST/REQUEST_LINE/METHOD');
    ops.setString(line, 'URI', req.uri, 'REQUEST/REQUEST_LINE/URI');
    ops.setString(line, 'VERSION', req.version, 'REQUEST/REQUEST_LINE/VERSION');
    const headers = ops.getTable(request, 'HEADER_FIELDS', 'REQUEST/HEADER_FIELDS');
    for (const h of req.headers ?? []) {
      const row = ops.appendRow(headers, 'REQUEST/HEADER_FIELDS');
      ops.setString(row, 'NAME', String(h.name), 'REQUEST/HEADER_FIELDS/NAME');
      ops.setString(row, 'VALUE', String(h.value), 'REQUEST/HEADER_FIELDS/VALUE');
    }
    // A fresh function handle has an empty XSTRING; only non-empty bodies are set.
    if (req.body && req.body.length > 0) ops.setXString(request, 'MESSAGE_BODY', req.body, 'REQUEST/MESSAGE_BODY');
  }

  private readResponse(fnHandle: SdkHandle): SadtResponse {
    const ops = this.ops;
    const response = ops.getStructure(fnHandle, 'RESPONSE', 'RESPONSE');
    const status = ops.getStructure(response, 'STATUS_LINE', 'RESPONSE/STATUS_LINE');
    const version = ops.getString(status, 'VERSION', 'RESPONSE/STATUS_LINE/VERSION');
    const statusCode = ops.getString(status, 'STATUS_CODE', 'RESPONSE/STATUS_LINE/STATUS_CODE');
    const reasonPhrase = ops.getString(status, 'REASON_PHRASE', 'RESPONSE/STATUS_LINE/REASON_PHRASE');
    const table = ops.getTable(response, 'HEADER_FIELDS', 'RESPONSE/HEADER_FIELDS');
    const count = ops.rowCount(table, 'RESPONSE/HEADER_FIELDS');
    const headers: SadtHeader[] = [];
    for (let i = 0; i < count; i++) {
      const row = ops.currentRowAt(table, i, 'RESPONSE/HEADER_FIELDS');
      headers.push({
        name: ops.getString(row, 'NAME', 'RESPONSE/HEADER_FIELDS/NAME'),
        value: ops.getString(row, 'VALUE', 'RESPONSE/HEADER_FIELDS/VALUE'),
      });
    }
    const body = ops.getXString(response, 'MESSAGE_BODY', 'RESPONSE/MESSAGE_BODY');
    return { version, statusCode, reasonPhrase, headers, body };
  }

  private async doCallAdt(req: SadtRequest): Promise<SadtResponse> {
    const h = this.requireOpen();
    const desc = await this.getFunctionDesc(h);
    if (!this.interfaceChecked) {
      this.checkInterface(desc);
      this.interfaceChecked = true;
    }
    const fnHandle = this.ops.createFunction(desc);
    try {
      this.writeRequest(fnHandle, req);
      const info: ErrorInfoJs = {};
      const rc = await this.network('RfcInvoke', [h, fnHandle, info]);
      if (rc !== RFC_RC.RFC_OK) {
        throw this.fail(errorFromInfo(info, typeof rc === 'number' ? rc : RFC_UNKNOWN_ERROR, `${ADT_FUNCTION} ${req.method} ${pathOnly(req.uri)} failed`));
      }
      return this.readResponse(fnHandle);
    } finally {
      this.ops.destroyFunction(fnHandle);
    }
  }

  private async doReset(): Promise<void> {
    const h = this.requireOpen();
    const info: ErrorInfoJs = {};
    const rc = await this.network('RfcResetServerContext', [h, info]);
    if (rc !== RFC_RC.RFC_OK) throw this.fail(errorFromInfo(info, typeof rc === 'number' ? rc : RFC_UNKNOWN_ERROR, 'RfcResetServerContext failed'));
  }

  private async doClose(): Promise<void> {
    if (this.handle === null) return;
    const h = this.handle;
    const wasBroken = this.broken;
    this.handle = null;
    this.functionDesc = null;
    const info: ErrorInfoJs = {};
    let rc: unknown;
    try {
      rc = await callAsync(this.api.fn.RfcCloseConnection, [h, info]);
    } catch (err) {
      if (wasBroken) return;
      throw bindingError('RfcCloseConnection failed', err);
    }
    // Closing a connection the SDK already reported lost may fail; it is closed either way.
    if (rc !== RFC_RC.RFC_OK && !wasBroken) throw errorFromInfo(info, typeof rc === 'number' ? rc : RFC_UNKNOWN_ERROR, 'RfcCloseConnection failed');
  }
}

/** The URI without its query string, for error messages (query values may carry names the user typed). */
function pathOnly(uri: string): string {
  const q = uri.indexOf('?');
  return q >= 0 ? uri.slice(0, q) : uri;
}

class NwRfcConnector implements RfcConnector {
  /** Set when the SDK is not 7.50 at the recommended patch level; the transport may show it. */
  readonly sdkWarning: string | undefined;

  constructor(
    private readonly api: SdkApi,
    readonly libraryPath: string,
    readonly sdkVersion: string,
    readonly sdkVersionInfo: SdkVersionInfo,
  ) {
    this.sdkWarning = sdkVersionWarning(sdkVersion);
  }

  async open(params: RfcLogonParams): Promise<RfcConnection> {
    // RFC_CONNECTION_PARAMETER[]; empty values are skipped. Values never appear in messages.
    const list = Object.entries(params ?? {})
      .filter(([name, value]) => name && value !== undefined && value !== null && String(value) !== '')
      .map(([name, value]) => ({ name, value: String(value) }));
    const info: ErrorInfoJs = {};
    let handle: unknown;
    try {
      handle = await callAsync(this.api.fn.RfcOpenConnection, [list, list.length, info]);
    } catch (err) {
      throw bindingError('RfcOpenConnection failed', err);
    }
    if (!handle) throw errorFromInfo(info, RFC_UNKNOWN_ERROR, 'RfcOpenConnection failed');
    return new NwRfcConnection(this.api, handle as SdkHandle);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const connectors = new Map<string, Promise<RfcConnector>>();

function realPath(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

/**
 * Load the SAP NetWeaver RFC SDK the user installed and return a connector.
 * sdkPath is the SDK folder (containing lib/); when omitted, SAPNWRFC_HOME is
 * used, then the platform default. Memoized per resolved library path; a
 * failed load is not memoized, so installing the SDK and retrying works.
 */
export async function loadNwRfcConnector(sdkPath?: string): Promise<RfcConnector> {
  const sdk = locateSdk({ sdkPath });
  const key = realPath(sdk.libraryPath);
  let pending = connectors.get(key);
  if (!pending) {
    const created = (async () => {
      const koffi = await loadKoffi();
      const { api, version } = loadSdk(koffi, sdk);
      return new NwRfcConnector(api, sdk.libraryPath, formatSdkVersion(version.major, version.minor, version.patchLevel), version);
    })();
    pending = created;
    connectors.set(key, created);
    created.catch(() => {
      if (connectors.get(key) === created) connectors.delete(key);
    });
  }
  return pending;
}

/** Internals exposed for unit tests only. */
export const __test = {
  RFC_RC_NAMES,
  rfcRcName,
  libraryFileName,
  defaultSdkHome,
  resolveSdkLocation,
  locateSdk,
  sdkNotFoundError,
  loadFailureHint,
  decodeSapUc,
  sapUcBufferToString,
  formatSdkVersion,
  loadKoffi,
  defineTypes,
  errorFromInfo,
  preloadCandidates,
  prependWindowsPath,
  pathOnly,
  clearCache: () => connectors.clear(),
};
