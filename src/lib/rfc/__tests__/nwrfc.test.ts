/**
 * Tests for the NW RFC SDK binding. They run without the SAP SDK:
 * - pure helpers (path resolution, messages, SAP_UC decoding, names);
 * - the koffi layout of RFC_ERROR_INFO, when koffi is installed;
 * - the full binding against a small mock of the SDK C API compiled at test
 *   time, when koffi and a C compiler are available (not on Windows);
 * - a live call, only when SAPNWRFC_HOME and RFC_TEST_ASHOST are set.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { __test, loadNwRfcConnector, sdkVersionWarning } from '../nwrfc.js';
import { RFC_RC, RfcConnection, RfcError, SadtRequest } from '../types.js';

const T = __test;

function koffiModule(): any | null {
  try {
    return require('koffi');
  } catch {
    return null;
  }
}
const koffi = koffiModule();
const withKoffi = koffi ? describe : describe.skip;

function units(s: string, size: number): Uint16Array {
  const out = new Uint16Array(size);
  for (let i = 0; i < s.length && i < size - 1; i++) out[i] = s.charCodeAt(i);
  return out;
}

function expectRfcError(err: unknown): RfcError {
  expect(err).toBeInstanceOf(RfcError);
  return err as RfcError;
}

describe('SDK location', () => {
  it('uses the platform default when nothing is configured (macOS)', () => {
    const loc = T.resolveSdkLocation({ platform: 'darwin', env: {} });
    expect(loc.source).toBe('default');
    expect(loc.home).toBe('/usr/local/sap/nwrfcsdk');
    expect(loc.candidates[0]).toBe('/usr/local/sap/nwrfcsdk/lib/libsapnwrfc.dylib');
  });

  it('uses SAPNWRFC_HOME on Linux', () => {
    const loc = T.resolveSdkLocation({ platform: 'linux', env: { SAPNWRFC_HOME: '/opt/sap/nwrfcsdk/' } });
    expect(loc.source).toBe('SAPNWRFC_HOME');
    expect(loc.candidates[0]).toBe('/opt/sap/nwrfcsdk/lib/libsapnwrfc.so');
  });

  it('uses Windows paths and the DLL name', () => {
    expect(T.resolveSdkLocation({ platform: 'win32', env: {} }).candidates[0]).toBe('C:\\nwrfcsdk\\lib\\sapnwrfc.dll');
    const loc = T.resolveSdkLocation({ platform: 'win32', env: { SAPNWRFC_HOME: 'D:\\sap\\nwrfcsdk' } });
    expect(loc.candidates[0]).toBe('D:\\sap\\nwrfcsdk\\lib\\sapnwrfc.dll');
  });

  it('prefers the sdkPath argument over SAPNWRFC_HOME, and ignores a blank one', () => {
    const env = { SAPNWRFC_HOME: '/from/env' };
    expect(T.resolveSdkLocation({ platform: 'linux', env, sdkPath: '/from/arg' }).home).toBe('/from/arg');
    expect(T.resolveSdkLocation({ platform: 'linux', env, sdkPath: '  ' }).home).toBe('/from/env');
  });

  it('expands ~ to the home folder', () => {
    const loc = T.resolveSdkLocation({ platform: 'darwin', env: {}, sdkPath: '~/sap/nwrfcsdk', homedir: '/Users/dev' });
    expect(loc.candidates[0]).toBe('/Users/dev/sap/nwrfcsdk/lib/libsapnwrfc.dylib');
  });

  it('accepts the lib folder or the library file itself', () => {
    const lib = '/opt/x/lib/libsapnwrfc.so';
    const fromLibDir = T.locateSdk({ platform: 'linux', env: {}, sdkPath: '/opt/x/lib' }, (f) => f === lib);
    expect(fromLibDir.libraryPath).toBe(lib);
    expect(fromLibDir.libDir).toBe('/opt/x/lib');
    expect(T.resolveSdkLocation({ platform: 'linux', env: {}, sdkPath: lib }).candidates).toEqual([lib]);
  });

  it('names the library per platform', () => {
    expect(T.libraryFileName('darwin')).toBe('libsapnwrfc.dylib');
    expect(T.libraryFileName('linux')).toBe('libsapnwrfc.so');
    expect(T.libraryFileName('win32')).toBe('sapnwrfc.dll');
  });
});

describe('SDK_NOT_FOUND', () => {
  it('says where it looked and how to install the SDK', () => {
    let caught: unknown;
    try {
      T.locateSdk({ platform: 'linux', env: { SAPNWRFC_HOME: '/opt/missing' } }, () => false);
    } catch (err) {
      caught = err;
    }
    const err = expectRfcError(caught);
    expect(err.rfcCode).toBe(-1);
    expect(err.rfcCodeName).toBe('SDK_NOT_FOUND');
    expect(err.message).toContain('/opt/missing/lib/libsapnwrfc.so');
    expect(err.message).toContain('SAPNWRFC_HOME');
    expect(err.message).toContain('rfc.sdkPath');
    expect(err.message).toContain('S-user');
    expect(err.message).toContain('7.50');
    expect(err.message).toContain('licence');
    expect(err.message).toContain('redistribution');
  });

  it('is what loadNwRfcConnector rejects with for an empty folder', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwrfc-empty-'));
    try {
      await expect(loadNwRfcConnector(dir)).rejects.toMatchObject({ rfcCodeName: 'SDK_NOT_FOUND', rfcCode: -1 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('load failure hints', () => {
  it('gives the platform-specific fix', () => {
    expect(T.loadFailureHint('darwin', '/opt/sdk', '/opt/sdk/lib/libsapnwrfc.dylib')).toContain('xattr -dr com.apple.quarantine "/opt/sdk"');
    expect(T.loadFailureHint('win32', 'C:\\nwrfcsdk', 'C:\\nwrfcsdk\\lib\\sapnwrfc.dll')).toContain('Visual C++');
    const linux = T.loadFailureHint('linux', '/opt/sdk', '/opt/sdk/lib/libsapnwrfc.so');
    expect(linux).toContain('libuuid');
    expect(linux).toContain('ldconfig');
  });
});

describe('SAP_UC decoding', () => {
  it('stops at the first NUL of a fixed-size buffer', () => {
    expect(T.decodeSapUc(Uint16Array.from([0x48, 0x69, 0, 0x58, 0x59]))).toBe('Hi');
    expect(T.decodeSapUc(units('RFC_LOGON_FAILURE', 128))).toBe('RFC_LOGON_FAILURE');
  });

  it('decodes the whole array when there is no NUL, and exact lengths', () => {
    expect(T.decodeSapUc(Uint16Array.from([0x41, 0x42]))).toBe('AB');
    expect(T.decodeSapUc(Uint16Array.from([0x41, 0, 0x42]), 3)).toBe('A\u0000B');
  });

  it('handles signed char16_t arrays, non-ASCII and surrogate pairs', () => {
    expect(T.decodeSapUc(Int16Array.from([0x63, 0x61, 0x66, -23, 0]))).toBe('caf\uffe9');
    const s = 'caf\u00e9 \u20ac \ud83d\ude00';
    expect(T.decodeSapUc(units(s, 32))).toBe(s);
  });

  it('decodes long buffers in chunks', () => {
    const s = 'x'.repeat(10000);
    expect(T.decodeSapUc(units(s, 10001))).toBe(s);
  });

  it('reads an SDK-filled SAP_UC buffer by length', () => {
    if (os.endianness() !== 'LE') return;
    expect(T.sapUcBufferToString(Buffer.from('h\u20acllo\u0000junk', 'utf16le'), 5)).toBe('h\u20acllo');
    expect(T.sapUcBufferToString(Buffer.alloc(0), 0)).toBe('');
  });
});

describe('RFC_RC names', () => {
  it('matches every code in types.ts', () => {
    for (const [name, code] of Object.entries(RFC_RC)) expect(T.rfcRcName(code)).toBe(name);
  });

  it('covers 14..25 and falls back for unknown codes', () => {
    expect(T.RFC_RC_NAMES.length).toBeGreaterThanOrEqual(26);
    expect(T.rfcRcName(17)).toBe('RFC_NOT_FOUND');
    expect(T.rfcRcName(20)).toBe('RFC_INVALID_PARAMETER');
    expect(T.rfcRcName(21)).toBe('RFC_CODEPAGE_CONVERSION_FAILURE');
    expect(T.rfcRcName(22)).toBe('RFC_CONVERSION_FAILURE');
    expect(T.rfcRcName(23)).toBe('RFC_BUFFER_TOO_SMALL');
    expect(T.rfcRcName(24)).toBe('RFC_TABLE_MOVE_BOF');
    expect(T.rfcRcName(25)).toBe('RFC_TABLE_MOVE_EOF');
    expect(T.rfcRcName(999)).toBe('RFC_RC_999');
  });
});

describe('errorFromInfo', () => {
  it('builds an RfcError from RFC_ERROR_INFO', () => {
    const err = T.errorFromInfo({
      code: 2, group: 3, key: units('RFC_LOGON_FAILURE', 128), message: units('Name or password is incorrect', 512),
    }, 0, 'RfcOpenConnection failed');
    expect(err.rfcCode).toBe(2);
    expect(err.rfcCodeName).toBe('RFC_LOGON_FAILURE');
    expect(err.logonFailure).toBe(true);
    expect(err.group).toBe(3);
    expect(err.key).toBe('RFC_LOGON_FAILURE');
    expect(err.abapMessage).toBeUndefined();
    expect(err.message).toBe('RfcOpenConnection failed: RFC_LOGON_FAILURE: Name or password is incorrect');
  });

  it('carries the ABAP message and falls back to the return code', () => {
    const err = T.errorFromInfo({
      code: 0, key: units('SADT_REST', 128), message: units('Resource locked', 512),
      abapMsgClass: units('SADT_REST', 21), abapMsgType: units('E', 2), abapMsgNumber: units('001', 4), abapMsgV1: units('ZFOO', 51),
    }, 4, 'call failed');
    expect(err.rfcCode).toBe(4);
    expect(err.rfcCodeName).toBe('RFC_ABAP_MESSAGE');
    expect(err.abapMessage).toEqual({ msgClass: 'SADT_REST', msgType: 'E', msgNumber: '001', v1: 'ZFOO', v2: '', v3: '', v4: '' });
    expect(err.message).toContain('(SADT_REST)');
  });

  it('marks communication failures as connection lost', () => {
    expect(T.errorFromInfo({ code: 1 }, 1, 'x').connectionLost).toBe(true);
    expect(T.errorFromInfo({ code: 8 }, 8, 'x').connectionLost).toBe(true);
    expect(T.errorFromInfo({ code: 4 }, 4, 'x').connectionLost).toBe(false);
  });

  it('keeps the query string out of call errors', () => {
    expect(T.pathOnly('/sap/bc/adt/x?name=secret')).toBe('/sap/bc/adt/x');
  });
});

describe('SDK version', () => {
  it('normalizes what RfcGetVersion reports', () => {
    expect(T.formatSdkVersion(7500, 0, 12)).toBe('7.50.12');
    expect(T.formatSdkVersion(750, 0, 3)).toBe('7.50.3');
    expect(T.formatSdkVersion(7, 50, 12)).toBe('7.50.12');
  });

  it('warns below 7.50 patch level 12 or on another release', () => {
    expect(sdkVersionWarning('7.50.12')).toBeUndefined();
    expect(sdkVersionWarning('7.50.14')).toBeUndefined();
    expect(sdkVersionWarning('7.50.11')).toContain('patch level 12');
    expect(sdkVersionWarning('7.20.0')).toBeDefined();
    expect(sdkVersionWarning('garbage')).toBeDefined();
  });
});

describe('sibling libraries', () => {
  const names = ['libicui18n.so.50', 'libsapnwrfc.so', 'libicudata.so.50', 'libsapucum.so', 'libicuuc.so.50', 'libicudecnumber.so', 'README.txt'];

  it('preloads ICU, then libsapucum, then libicudecnumber on Linux', () => {
    expect(T.preloadCandidates('linux', '/sdk/lib', () => names)).toEqual([
      '/sdk/lib/libicudata.so.50', '/sdk/lib/libicuuc.so.50', '/sdk/lib/libicui18n.so.50', '/sdk/lib/libsapucum.so', '/sdk/lib/libicudecnumber.so',
    ]);
  });

  it('uses dylib names on macOS and nothing on Windows', () => {
    const mac = ['libsapnwrfc.dylib', 'libsapucum.dylib', 'libicudata.50.dylib', 'libicuuc.50.dylib'];
    expect(T.preloadCandidates('darwin', '/sdk/lib', () => mac)).toEqual(['/sdk/lib/libicudata.50.dylib', '/sdk/lib/libicuuc.50.dylib', '/sdk/lib/libsapucum.dylib']);
    expect(T.preloadCandidates('win32', 'C:\\sdk\\lib', () => ['sapucum.dll'])).toEqual([]);
  });

  it('survives an unreadable lib folder', () => {
    expect(T.preloadCandidates('linux', '/nope', () => { throw new Error('ENOENT'); })).toEqual([]);
  });

  it('prepends the SDK lib folder to PATH on Windows once', () => {
    const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows;C:\\Windows\\System32' };
    T.prependWindowsPath('C:\\nwrfcsdk\\lib', env);
    expect(env.PATH).toBe('C:\\nwrfcsdk\\lib;C:\\Windows;C:\\Windows\\System32');
    T.prependWindowsPath('c:\\NWRFCSDK\\lib\\', env);
    expect(env.PATH).toBe('C:\\nwrfcsdk\\lib;C:\\Windows;C:\\Windows\\System32');
    const empty: NodeJS.ProcessEnv = {};
    T.prependWindowsPath('C:\\nwrfcsdk\\lib', empty);
    expect(empty.PATH).toBe('C:\\nwrfcsdk\\lib');
  });
});

describe('koffi', () => {
  it('reports a missing koffi as KOFFI_MISSING with the reinstall hint', async () => {
    const missing = Object.assign(new Error("Cannot find module 'koffi'"), { code: 'MODULE_NOT_FOUND' });
    await expect(T.loadKoffi(() => Promise.reject(missing))).rejects.toMatchObject({ rfcCode: -1, rfcCodeName: 'KOFFI_MISSING' });
    await expect(T.loadKoffi(() => Promise.reject(missing))).rejects.toThrow(/--omit=optional/);
  });

  it('rejects a module without the koffi API', async () => {
    await expect(T.loadKoffi(() => Promise.resolve({ default: {} }))).rejects.toMatchObject({ rfcCodeName: 'KOFFI_MISSING' });
  });
});

withKoffi('RFC_ERROR_INFO layout (koffi)', () => {
  it('is 1750 bytes padded to 1752 with natural alignment', async () => {
    const k = await T.loadKoffi();
    const types = T.defineTypes(k);
    expect(k.sizeof(types.ErrorInfo)).toBe(1752);
    expect(koffi.offsetof(types.ErrorInfo, 'key')).toBe(8);
    expect(koffi.offsetof(types.ErrorInfo, 'message')).toBe(264);
    expect(koffi.offsetof(types.ErrorInfo, 'abapMsgClass')).toBe(1288);
    expect(koffi.offsetof(types.ErrorInfo, 'abapMsgV4')).toBe(1648);
    // Types are anonymous: defining them again must not clash.
    expect(() => T.defineTypes(k)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Mock SDK: the NW RFC C API subset this binding uses, with SADT_REST_RFC_ENDPOINT
// echoing the request. Our own code, compiled into a temp folder.
// ---------------------------------------------------------------------------

const MOCK_SDK_C = String.raw`
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef uint16_t SAP_UC;
typedef unsigned char SAP_RAW;
typedef struct { const SAP_UC *name; const SAP_UC *value; } RFC_CONNECTION_PARAMETER;
typedef struct { int code; int group; SAP_UC key[128]; SAP_UC message[512]; SAP_UC abapMsgClass[21]; SAP_UC abapMsgType[2];
  SAP_UC abapMsgNumber[4]; SAP_UC abapMsgV1[51]; SAP_UC abapMsgV2[51]; SAP_UC abapMsgV3[51]; SAP_UC abapMsgV4[51]; } RFC_ERROR_INFO;

enum { K_STR, K_CHAR, K_XSTR, K_STRUCT, K_TABLE };
typedef struct Node Node;
struct Node { const char *name; int kind; SAP_UC *s; unsigned slen; SAP_RAW *x; unsigned xlen; Node *kids[4]; int nkids;
  Node **rows; unsigned nrows, cap, cur; };
typedef struct { int open; int busy; unsigned calls; unsigned resets; SAP_UC ashost[64]; } Conn;

static int g_mode = 0, g_created = 0, g_destroyed = 0, g_desc;
static SAP_UC g_empty[1] = {0};
void MockSetMode(int m) { g_mode = m; }
int MockCreated(void) { return g_created; }
int MockDestroyed(void) { return g_destroyed; }

static unsigned uclen(const SAP_UC *u) { unsigned n = 0; while (u[n]) n++; return n; }
static int eq(const SAP_UC *u, const char *a) { while (*a) { if (*u++ != (SAP_UC)(unsigned char)*a++) return 0; } return *u == 0; }
static int starts(const SAP_UC *u, const char *a) { while (*a) { if (*u++ != (SAP_UC)(unsigned char)*a++) return 0; } return 1; }
static void put(SAP_UC *d, unsigned cap, const char *s) { unsigned i = 0; while (s[i] && i + 1 < cap) { d[i] = (SAP_UC)(unsigned char)s[i]; i++; } d[i] = 0; }
static int fail(RFC_ERROR_INFO *e, int code, int group, const char *key, const char *msg) {
  memset(e, 0, sizeof *e); e->code = code; e->group = group; put(e->key, 128, key); put(e->message, 512, msg); return code; }
static void ok(RFC_ERROR_INFO *e) { memset(e, 0, sizeof *e); }

static Node *node(const char *name, int kind) { Node *n = calloc(1, sizeof *n); n->name = name; n->kind = kind; return n; }
static Node *add(Node *p, Node *k) { p->kids[p->nkids++] = k; return k; }
static void drop(Node *n) { if (!n) return; for (int i = 0; i < n->nkids; i++) drop(n->kids[i]);
  for (unsigned i = 0; i < n->nrows; i++) drop(n->rows[i]); free(n->rows); free(n->s); free(n->x); free(n); }
static Node *find(Node *c, const SAP_UC *name) { for (int i = 0; c && i < c->nkids; i++) if (eq(name, c->kids[i]->name)) return c->kids[i]; return NULL; }
static Node *kid(Node *c, const char *a) { for (int i = 0; i < c->nkids; i++) if (!strcmp(c->kids[i]->name, a)) return c->kids[i]; return NULL; }
static Node *typed(void *c, const SAP_UC *name, int kind, RFC_ERROR_INFO *e) {
  Node *n = find(c, name);
  if (!n) { fail(e, 20, 5, "RFC_INVALID_PARAMETER", "field not found"); return NULL; }
  if (n->kind != kind && !(kind == K_STR && n->kind == K_CHAR)) { fail(e, 22, 5, "RFC_CONVERSION_FAILURE", "wrong field type"); return NULL; }
  return n; }
static void sets(Node *n, const SAP_UC *v, unsigned len) { free(n->s); n->s = malloc((len + 1) * 2); if (len) memcpy(n->s, v, len * 2); n->s[len] = 0; n->slen = len; }
static void seta(Node *n, const char *a) { unsigned len = (unsigned)strlen(a); free(n->s); n->s = malloc((len + 1) * 2); put(n->s, len + 1, a); n->slen = len; }
static void setx(Node *n, const SAP_RAW *v, unsigned len) { free(n->x); n->x = malloc(len ? len : 1); if (len) memcpy(n->x, v, len); n->xlen = len; }
static Node *row(Node *t) {
  if (t->nrows == t->cap) { t->cap = t->cap ? t->cap * 2 : 8; t->rows = realloc(t->rows, t->cap * sizeof(Node *)); }
  Node *r = node("ROW", K_STRUCT); add(r, node("NAME", K_STR)); add(r, node("VALUE", K_STR));
  t->rows[t->nrows] = r; t->cur = t->nrows++; return r; }
static void hdr(Node *t, const char *name, const SAP_UC *v, unsigned len) { Node *r = row(t); seta(r->kids[0], name); sets(r->kids[1], v, len); }
static void hdra(Node *t, const char *name, const char *v) { Node *r = row(t); seta(r->kids[0], name); seta(r->kids[1], v); }

void *RfcOpenConnection(const RFC_CONNECTION_PARAMETER *p, unsigned n, RFC_ERROR_INFO *e) {
  usleep(20000);
  Conn *c = calloc(1, sizeof *c);
  for (unsigned i = 0; i < n; i++) {
    if (uclen(p[i].value) == 0) { free(c); fail(e, 20, 5, "RFC_INVALID_PARAMETER", "empty parameter value"); return NULL; }
    if (eq(p[i].name, "USER") && eq(p[i].value, "BAD")) { free(c); fail(e, 2, 3, "RFC_LOGON_FAILURE", "Name or password is incorrect (repeat logon)"); return NULL; }
    if (eq(p[i].name, "ASHOST")) { unsigned l = uclen(p[i].value); if (l > 63) l = 63; memcpy(c->ashost, p[i].value, l * 2); c->ashost[l] = 0; }
  }
  c->open = 1; ok(e); return c; }
int RfcCloseConnection(void *h, RFC_ERROR_INFO *e) { Conn *c = h; if (!c) return fail(e, 13, 5, "RFC_INVALID_HANDLE", "null handle"); c->open = 0; ok(e); return 0; }
int RfcResetServerContext(void *h, RFC_ERROR_INFO *e) { Conn *c = h;
  if (!c || !c->open) return fail(e, 13, 4, "RFC_INVALID_HANDLE", "invalid connection handle"); c->resets++; ok(e); return 0; }
void *RfcGetFunctionDesc(void *h, const SAP_UC *name, RFC_ERROR_INFO *e) { Conn *c = h;
  if (!c || !c->open) { fail(e, 13, 4, "RFC_INVALID_HANDLE", "invalid connection handle"); return NULL; }
  if (!eq(name, "SADT_REST_RFC_ENDPOINT")) { fail(e, 5, 1, "FU_NOT_FOUND", "function module not found"); return NULL; }
  ok(e); return &g_desc; }
void *RfcCreateFunction(void *d, RFC_ERROR_INFO *e) {
  if (d != &g_desc) { fail(e, 13, 5, "RFC_INVALID_HANDLE", "bad function description"); return NULL; }
  Node *f = node("FUNCTION", K_STRUCT);
  Node *rq = add(f, node("REQUEST", K_STRUCT));
  Node *rl = add(rq, node("REQUEST_LINE", K_STRUCT)); add(rl, node("METHOD", K_STR)); add(rl, node("URI", K_STR)); add(rl, node("VERSION", K_STR));
  add(rq, node("HEADER_FIELDS", K_TABLE));
  if (g_mode != 1) add(rq, node("MESSAGE_BODY", K_XSTR));
  Node *rs = add(f, node("RESPONSE", K_STRUCT));
  Node *sl = add(rs, node("STATUS_LINE", K_STRUCT)); add(sl, node("VERSION", K_STR)); add(sl, node("STATUS_CODE", K_CHAR)); add(sl, node("REASON_PHRASE", K_STR));
  add(rs, node("HEADER_FIELDS", K_TABLE)); add(rs, node("MESSAGE_BODY", K_XSTR));
  g_created++; ok(e); return f; }
int RfcDestroyFunction(void *f, RFC_ERROR_INFO *e) { drop(f); g_destroyed++; ok(e); return 0; }
int RfcGetStructure(void *c, const SAP_UC *name, void **out, RFC_ERROR_INFO *e) { Node *n = typed(c, name, K_STRUCT, e); if (!n) return e->code; *out = n; ok(e); return 0; }
int RfcGetTable(void *c, const SAP_UC *name, void **out, RFC_ERROR_INFO *e) { Node *n = typed(c, name, K_TABLE, e); if (!n) return e->code; *out = n; ok(e); return 0; }
void *RfcAppendNewRow(void *t, RFC_ERROR_INFO *e) { Node *n = t; if (!n || n->kind != K_TABLE) { fail(e, 13, 5, "RFC_INVALID_HANDLE", "not a table"); return NULL; } ok(e); return row(n); }
int RfcGetRowCount(void *t, unsigned *count, RFC_ERROR_INFO *e) { *count = ((Node *)t)->nrows; ok(e); return 0; }
int RfcMoveTo(void *t, unsigned i, RFC_ERROR_INFO *e) { Node *n = t; if (i >= n->nrows) return fail(e, 25, 5, "RFC_TABLE_MOVE_EOF", "out of range"); n->cur = i; ok(e); return 0; }
void *RfcGetCurrentRow(void *t, RFC_ERROR_INFO *e) { Node *n = t; if (n->cur >= n->nrows) { fail(e, 25, 5, "RFC_TABLE_MOVE_EOF", "no row"); return NULL; } ok(e); return n->rows[n->cur]; }
int RfcSetString(void *c, const SAP_UC *name, const SAP_UC *v, unsigned len, RFC_ERROR_INFO *e) { Node *n = typed(c, name, K_STR, e); if (!n) return e->code; sets(n, v, len); ok(e); return 0; }
int RfcSetXString(void *c, const SAP_UC *name, const SAP_RAW *v, unsigned len, RFC_ERROR_INFO *e) { Node *n = typed(c, name, K_XSTR, e); if (!n) return e->code; setx(n, v, len); ok(e); return 0; }
int RfcGetStringLength(void *c, const SAP_UC *name, unsigned *len, RFC_ERROR_INFO *e) { Node *n = find(c, name);
  if (!n) return fail(e, 20, 5, "RFC_INVALID_PARAMETER", "field not found");
  if (n->kind == K_STR) { *len = n->slen; ok(e); return 0; }
  if (n->kind == K_XSTR) { *len = n->xlen; ok(e); return 0; }
  return fail(e, 22, 5, "RFC_CONVERSION_FAILURE", "not a STRING or XSTRING field"); }
int RfcGetString(void *c, const SAP_UC *name, SAP_UC *buf, unsigned bl, unsigned *len, RFC_ERROR_INFO *e) {
  Node *n = typed(c, name, K_STR, e); if (!n) return e->code;
  *len = n->slen;
  if (bl < n->slen + 1) { if (bl) { if (bl > 1) memcpy(buf, n->s, (bl - 1) * 2); buf[bl - 1] = 0; } return fail(e, 23, 5, "RFC_BUFFER_TOO_SMALL", "buffer too small"); }
  if (n->slen) memcpy(buf, n->s, n->slen * 2); buf[n->slen] = 0; ok(e); return 0; }
int RfcGetXString(void *c, const SAP_UC *name, SAP_RAW *buf, unsigned bl, unsigned *len, RFC_ERROR_INFO *e) {
  Node *n = typed(c, name, K_XSTR, e); if (!n) return e->code;
  *len = n->xlen;
  if (bl < n->xlen) return fail(e, 23, 5, "RFC_BUFFER_TOO_SMALL", "buffer too small");
  if (n->xlen) memcpy(buf, n->x, n->xlen); ok(e); return 0; }
const SAP_UC *RfcGetVersion(unsigned *a, unsigned *b, unsigned *c) { static SAP_UC v[32]; put(v, 32, "mock 7500 PL 12"); *a = 7500; *b = 0; *c = 12; return v; }
int RfcSetIniPath(const SAP_UC *p, RFC_ERROR_INFO *e) { (void)p; ok(e); return 0; }
int RfcSetTraceDir(SAP_UC *p, RFC_ERROR_INFO *e) { (void)p; ok(e); return 0; }

int RfcInvoke(void *h, void *fh, RFC_ERROR_INFO *e) {
  Conn *c = h; Node *f = fh; char num[32];
  if (!c || !c->open) return fail(e, 13, 4, "RFC_INVALID_HANDLE", "invalid connection handle");
  if (c->busy) return fail(e, 19, 5, "RFC_ILLEGAL_STATE", "concurrent calls on one connection");
  c->busy = 1; c->calls++;
  Node *rq = kid(f, "REQUEST"), *rs = kid(f, "RESPONSE"), *rl = kid(rq, "REQUEST_LINE");
  Node *uri = kid(rl, "URI"), *method = kid(rl, "METHOD"), *ver = kid(rl, "VERSION");
  const SAP_UC *u = uri->s ? uri->s : g_empty;
  usleep(starts(u, "/slow") ? 200000 : 20000);
  if (starts(u, "/fail/comm")) { c->busy = 0; c->open = 0; return fail(e, 1, 4, "RFC_COMMUNICATION_FAILURE", "connection to partner broken"); }
  if (starts(u, "/fail/abap")) { c->busy = 0; fail(e, 4, 1, "SADT_REST", "Resource is locked");
    put(e->abapMsgClass, 21, "SADT_REST"); put(e->abapMsgType, 2, "E"); put(e->abapMsgNumber, 4, "001"); put(e->abapMsgV1, 51, "ZFOO"); return 4; }
  Node *sl = kid(rs, "STATUS_LINE");
  sets(kid(sl, "VERSION"), ver->s ? ver->s : g_empty, ver->slen);
  seta(kid(sl, "STATUS_CODE"), "200 ");
  seta(kid(sl, "REASON_PHRASE"), "OK");
  Node *in = kid(rq, "HEADER_FIELDS"), *out = kid(rs, "HEADER_FIELDS");
  for (unsigned i = 0; i < in->nrows; i++) { Node *r = in->rows[i]; Node *o = row(out);
    sets(o->kids[0], r->kids[0]->s ? r->kids[0]->s : g_empty, r->kids[0]->slen); sets(o->kids[1], r->kids[1]->s ? r->kids[1]->s : g_empty, r->kids[1]->slen); }
  hdr(out, "x-mock-method", method->s ? method->s : g_empty, method->slen);
  hdr(out, "x-mock-uri", u, uri->slen);
  hdr(out, "x-mock-ashost", c->ashost, uclen(c->ashost));
  snprintf(num, sizeof num, "%u", c->calls); hdra(out, "x-mock-calls", num);
  snprintf(num, sizeof num, "%u", c->resets); hdra(out, "x-mock-resets", num);
  Node *body = kid(rs, "MESSAGE_BODY"), *inb = kid(rq, "MESSAGE_BODY");
  if (starts(u, "/big")) { unsigned n = 3u * 1024u * 1024u + 7u; SAP_RAW *b = malloc(n); for (unsigned i = 0; i < n; i++) b[i] = (SAP_RAW)(i * 31u); setx(body, b, n); free(b); }
  else if (inb) setx(body, inb->x, inb->xlen);
  c->busy = 0; ok(e); return 0; }
`;

function compile(source: string, outFile: string): boolean {
  if (process.platform === 'win32') return false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwrfc-src-'));
  try {
    const src = path.join(dir, 'mock.c');
    fs.writeFileSync(src, source);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    execFileSync('cc', ['-shared', '-fPIC', '-O1', '-o', outFile, src], { stdio: 'pipe', timeout: 60000 });
    return fs.existsSync(outFile);
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function buildMockSdk(): string | null {
  if (!koffi) return null;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nwrfc-mock-'));
  if (compile(MOCK_SDK_C, path.join(home, 'lib', T.libraryFileName(process.platform)))) return home;
  fs.rmSync(home, { recursive: true, force: true });
  return null;
}

const mockHome = buildMockSdk();
const withMock = mockHome ? describe : describe.skip;

function adtRequest(uri: string, extra: Partial<SadtRequest> = {}): SadtRequest {
  return { method: 'GET', uri, version: 'HTTP/1.1', headers: [], body: Buffer.alloc(0), ...extra };
}

function header(res: { headers: { name: string; value: string }[] }, name: string): string | undefined {
  return res.headers.find((h) => h.name === name)?.value;
}

withMock('binding against a mock SDK', () => {
  const home = mockHome as string;
  const libraryPath = path.join(home, 'lib', T.libraryFileName(process.platform));
  const logon = { ASHOST: 'mockhost', SYSNR: '00', CLIENT: '001', USER: 'DEVELOPER', PASSWD: 'not-a-real-password', LANG: 'EN' };
  const mockLib = () => koffi.load(libraryPath);
  const opened: RfcConnection[] = [];

  afterAll(async () => {
    for (const c of opened) await c.close().catch(() => undefined);
    fs.rmSync(home, { recursive: true, force: true });
  });

  async function open(params: Record<string, string> = logon): Promise<RfcConnection> {
    const connector = await loadNwRfcConnector(home);
    const conn = await connector.open(params);
    opened.push(conn);
    return conn;
  }

  it('loads the library, reads the version and memoizes per path', async () => {
    const connector = await loadNwRfcConnector(home);
    expect(connector.libraryPath).toBe(libraryPath);
    expect(connector.sdkVersion).toBe('7.50.12');
    expect((connector as any).sdkWarning).toBeUndefined();
    expect(await loadNwRfcConnector(path.join(home, 'lib'))).toBe(connector);
  });

  it('rejects a bad logon with RFC_LOGON_FAILURE and never echoes parameter values', async () => {
    const connector = await loadNwRfcConnector(home);
    let caught: unknown;
    try {
      await connector.open({ ...logon, USER: 'BAD', PASSWD: 'S3cret-Value-42' });
    } catch (err) {
      caught = err;
    }
    const err = expectRfcError(caught);
    expect(err.rfcCode).toBe(RFC_RC.RFC_LOGON_FAILURE);
    expect(err.logonFailure).toBe(true);
    expect(err.group).toBe(3);
    expect(err.key).toBe('RFC_LOGON_FAILURE');
    expect(err.message).toContain('Name or password is incorrect');
    expect(err.message).not.toContain('S3cret-Value-42');
  });

  it('skips empty parameters', async () => {
    const conn = await open({ ...logon, SAPROUTER: '', MYSAPSSO2: '' });
    expect(conn.closed).toBe(false);
  });

  it('round-trips a request: line, UTF-16 headers, status, empty body', async () => {
    const conn = await open();
    const unicode = 'caf\u00e9 \u20ac \ud83d\ude00';
    const res = await conn.callAdt(adtRequest('/sap/bc/adt/discovery', {
      headers: [{ name: 'Accept', value: 'application/atomsvc+xml' }, { name: 'X-Unicode', value: unicode }, { name: 'X-Empty', value: '' }],
    }));
    expect(res.version).toBe('HTTP/1.1');
    expect(res.statusCode).toBe('200 ');
    expect(res.reasonPhrase).toBe('OK');
    expect(header(res, 'Accept')).toBe('application/atomsvc+xml');
    expect(header(res, 'X-Unicode')).toBe(unicode);
    expect(header(res, 'X-Empty')).toBe('');
    expect(header(res, 'x-mock-method')).toBe('GET');
    expect(header(res, 'x-mock-uri')).toBe('/sap/bc/adt/discovery');
    expect(header(res, 'x-mock-ashost')).toBe('mockhost');
    expect(res.body.length).toBe(0);
  });

  it('sends and receives binary bodies, including large ones', async () => {
    const conn = await open();
    const body = Buffer.alloc(256 * 1000);
    for (let i = 0; i < body.length; i++) body[i] = i & 0xff;
    const echo = await conn.callAdt(adtRequest('/sap/bc/adt/echo', { method: 'POST', body }));
    expect(Buffer.compare(echo.body, body)).toBe(0);

    const big = await conn.callAdt(adtRequest('/big'));
    expect(big.body.length).toBe(3 * 1024 * 1024 + 7);
    expect(big.body[1]).toBe(31);
    expect(big.body[big.body.length - 1]).toBe(((3 * 1024 * 1024 + 6) * 31) & 0xff);
  });

  it('serializes concurrent calls on one connection', async () => {
    const conn = await open();
    const results = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => conn.callAdt(adtRequest(`/sap/bc/adt/n${i}`))));
    expect(results.map((r) => header(r, 'x-mock-uri'))).toEqual([0, 1, 2, 3, 4, 5].map((i) => `/sap/bc/adt/n${i}`));
    expect(new Set(results.map((r) => header(r, 'x-mock-calls'))).size).toBe(6);
  });

  it('does not block the event loop during RfcInvoke', async () => {
    const conn = await open();
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    try {
      await conn.callAdt(adtRequest('/slow'));
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThanOrEqual(5);
  });

  it('reports ABAP messages and marks the connection closed, as the SDK closes it', async () => {
    const conn = await open();
    let caught: unknown;
    try {
      await conn.callAdt(adtRequest('/fail/abap'));
    } catch (err) {
      caught = err;
    }
    const err = expectRfcError(caught);
    expect(err.rfcCode).toBe(RFC_RC.RFC_ABAP_MESSAGE);
    expect(err.connectionLost).toBe(false);
    expect(err.closesConnection).toBe(true);
    expect(err.abapMessage).toMatchObject({ msgClass: 'SADT_REST', msgType: 'E', msgNumber: '001', v1: 'ZFOO' });
    // sapnwrfc.h, RfcInvoke: after RFC_ABAP_MESSAGE the connection has been closed.
    expect(conn.closed).toBe(true);
    await expect(conn.callAdt(adtRequest('/sap/bc/adt/after'))).rejects.toMatchObject({ rfcCodeName: 'RFC_CLOSED' });
  });

  it('resets the server context', async () => {
    const conn = await open();
    await conn.reset();
    const res = await conn.callAdt(adtRequest('/sap/bc/adt/x'));
    expect(header(res, 'x-mock-resets')).toBe('1');
  });

  it('marks the connection closed on a communication failure', async () => {
    const conn = await open();
    let caught: unknown;
    try {
      await conn.callAdt(adtRequest('/fail/comm?name=secret-query'));
    } catch (err) {
      caught = err;
    }
    const err = expectRfcError(caught);
    expect(err.rfcCode).toBe(RFC_RC.RFC_COMMUNICATION_FAILURE);
    expect(err.connectionLost).toBe(true);
    expect(err.message).not.toContain('secret-query');
    expect(conn.closed).toBe(true);
    await expect(conn.callAdt(adtRequest('/sap/bc/adt/x'))).rejects.toMatchObject({ rfcCode: RFC_RC.RFC_CLOSED, connectionLost: true });
    await expect(conn.reset()).rejects.toMatchObject({ rfcCode: RFC_RC.RFC_CLOSED });
    await expect(conn.close()).resolves.toBeUndefined();
  });

  it('closes idempotently', async () => {
    const conn = await open();
    await conn.close();
    expect(conn.closed).toBe(true);
    await expect(conn.close()).resolves.toBeUndefined();
    await expect(conn.callAdt(adtRequest('/sap/bc/adt/x'))).rejects.toMatchObject({ rfcCodeName: 'RFC_CLOSED' });
  });

  it('fails clearly when SADT_REST_RFC_ENDPOINT has another interface', async () => {
    const setMode = mockLib().func('MockSetMode', 'void', ['int']);
    setMode(1);
    try {
      const conn = await open();
      await expect(conn.callAdt(adtRequest('/sap/bc/adt/x'))).rejects.toMatchObject({ rfcCode: -1, rfcCodeName: 'SADT_INTERFACE_MISMATCH' });
      await expect(conn.callAdt(adtRequest('/sap/bc/adt/x'))).rejects.toThrow(/REQUEST\/MESSAGE_BODY/);
    } finally {
      setMode(0);
    }
  });

  it('destroys every function handle it creates', () => {
    const lib = mockLib();
    const created = lib.func('MockCreated', 'int', [])();
    const destroyed = lib.func('MockDestroyed', 'int', [])();
    expect(created).toBeGreaterThan(0);
    expect(destroyed).toBe(created);
  });
});

withMock('SDK_LOAD_FAILED', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  function sdkDir(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nwrfc-bad-'));
    dirs.push(d);
    return d;
  }

  it('reports a file that is not a loadable library, with the platform fix', async () => {
    const home = sdkDir();
    fs.mkdirSync(path.join(home, 'lib'));
    fs.writeFileSync(path.join(home, 'lib', T.libraryFileName(process.platform)), 'not a shared library');
    const rejection = loadNwRfcConnector(home);
    await expect(rejection).rejects.toMatchObject({ rfcCode: -1, rfcCodeName: 'SDK_LOAD_FAILED' });
    await expect(rejection).rejects.toThrow(process.platform === 'darwin' ? /xattr -dr com\.apple\.quarantine/ : /libuuid/);
  });

  it('reports a library without the SDK functions', async () => {
    const home = sdkDir();
    if (!compile('int unrelated(void) { return 0; }\n', path.join(home, 'lib', T.libraryFileName(process.platform)))) return;
    const rejection = loadNwRfcConnector(home);
    await expect(rejection).rejects.toMatchObject({ rfcCodeName: 'SDK_LOAD_FAILED' });
    await expect(rejection).rejects.toThrow(/RfcOpenConnection/);
  });
});

// ---------------------------------------------------------------------------
// Live system: only with SAPNWRFC_HOME and RFC_TEST_* set (never hardcoded).
// ---------------------------------------------------------------------------

const live = process.env.SAPNWRFC_HOME && process.env.RFC_TEST_ASHOST ? describe : describe.skip;

live('live SAP system (SAPNWRFC_HOME, RFC_TEST_*)', () => {
  it('opens a connection and calls GET /sap/bc/adt/discovery', async () => {
    const env = process.env;
    const connector = await loadNwRfcConnector();
    const conn = await connector.open({
      ASHOST: env.RFC_TEST_ASHOST ?? '',
      SYSNR: env.RFC_TEST_SYSNR ?? '00',
      CLIENT: env.RFC_TEST_CLIENT ?? '',
      USER: env.RFC_TEST_USER ?? '',
      PASSWD: env.RFC_TEST_PASSWD ?? '',
      MYSAPSSO2: env.RFC_TEST_MYSAPSSO2 ?? '',
      LANG: env.RFC_TEST_LANG ?? 'EN',
      SAPROUTER: env.RFC_TEST_SAPROUTER ?? '',
    });
    try {
      const res = await conn.callAdt({
        method: 'GET',
        uri: '/sap/bc/adt/discovery',
        version: 'HTTP/1.1',
        headers: [{ name: 'Accept', value: 'application/atomsvc+xml' }],
        body: Buffer.alloc(0),
      });
      expect(res.statusCode.trim()).toBe('200');
      expect(res.body.toString('utf8')).toContain('<app:service');
    } finally {
      await conn.close();
    }
  }, 60000);
});
