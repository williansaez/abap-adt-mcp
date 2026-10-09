import { classifyAdtError } from '../adtErrorHints';

describe('classifyAdtError', () => {
  it('detects expired sessions from status, code and text', () => {
    expect(classifyAdtError({ message: 'Request failed with status code 401' }).kind).toBe('sessionExpired');
    expect(classifyAdtError({ code: 'SESSION_EXPIRED', message: 'SSO session expired: login page' }).kind).toBe('sessionExpired');
    expect(classifyAdtError('Error 400:Session timed out').kind).toBe('sessionExpired');
    expect(classifyAdtError({ message: 'Failed to get object source: Request failed with status code 401' })).toMatchObject({ kind: 'sessionExpired', status: 401, nextTools: ['login', 'lock'] });
  });

  it('classifies the cause a handler attached, not the wrapper text', () => {
    // An ordinary not-found error whose text mentions SAML: the wrapper alone
    // used to read as an expired session and trigger re-auth plus a lock wipe.
    const cause: any = new Error('Object ZCL_SAML_HANDLER not found'); cause.status = 404;
    const wrapped: any = new Error('Failed to get object source: Object ZCL_SAML_HANDLER not found'); wrapped.cause = cause;
    expect(classifyAdtError(wrapped)).toMatchObject({ kind: 'notFound', status: 404 });
    // The cause keeps the status the wrapper text lost.
    const c401: any = new Error('SAP says no'); c401.status = 401;
    const w401: any = new Error('Failed to read: SAP says no'); w401.cause = c401;
    expect(classifyAdtError(w401)).toMatchObject({ kind: 'sessionExpired', status: 401 });
    // Names containing saml or lockhandle are not session or lock errors.
    expect(classifyAdtError({ message: 'Class ZCL_SAML_UTIL does not exist' }).kind).toBe('notFound');
    expect(classifyAdtError({ message: 'Method GET_LOCKHANDLE not found' }).kind).toBe('notFound');
    // Real session and lock wording still classifies.
    expect(classifyAdtError({ message: 'Login page returned by the identity provider' }).kind).toBe('sessionExpired');
    expect(classifyAdtError({ message: 'Redirected to SAMLRequest endpoint' }).kind).toBe('sessionExpired');
    expect(classifyAdtError({ message: 'Error 423: invalid lockhandle' }).kind).toBe('staleLockHandle');
  });

  it('detects CSRF resets', () => {
    expect(classifyAdtError({ status: 403, message: 'CSRF token validation failed' }).kind).toBe('csrf');
  });

  it('separates stale lock handles from foreign locks', () => {
    expect(classifyAdtError({ message: 'Failed to set object source: Error 423:Invalid Lock Handle' })).toMatchObject({ kind: 'staleLockHandle', status: 423 });
    expect(classifyAdtError({ message: 'Object ZCL_X is locked by user DEVELOPER | type: ExceptionResourceNoAccess' })).toMatchObject({ kind: 'locked', nextTools: ['unLock', 'lock'] });
    expect(classifyAdtError({ message: 'x', properties: { ideUser: 'OTHER' } }).kind).toBe('locked');
  });

  it('detects transport, authorization, not found and throttling', () => {
    expect(classifyAdtError({ message: 'Object is not assigned to a transport request' }).kind).toBe('transportRequired');
    expect(classifyAdtError({ message: 'Request failed with status code 409' }).kind).toBe('transportRequired');
    expect(classifyAdtError({ message: 'You are not authorized to change objects in package ZPKG' })).toMatchObject({ kind: 'authorization' });
    expect(classifyAdtError({ message: 'Request failed with status code 403' }).kind).toBe('authorization');
    expect(classifyAdtError({ message: 'Resource /sap/bc/adt/x not found | HTTP 404' })).toMatchObject({ kind: 'notFound', status: 404 });
    expect(classifyAdtError({ status: 429, message: 'Too many requests' }).kind).toBe('rateLimited');
    expect(classifyAdtError({ response: { status: 503 }, message: 'x' }).kind).toBe('rateLimited');
  });

  it('flags ambiguous 400s and server errors without inventing hints for the rest', () => {
    expect(classifyAdtError({ message: 'Request failed with status code 400' })).toMatchObject({ kind: 'ambiguous400' });
    expect(classifyAdtError({ err: 500, message: 'Internal error' })).toMatchObject({ kind: 'serverError', nextTools: ['dumps'] });
    expect(classifyAdtError({ message: 'something odd' })).toEqual({ kind: 'unknown', status: undefined });
    expect(classifyAdtError(undefined).kind).toBe('unknown');
  });

  describe('certificate failures', () => {
    const ctx = { destination: 'ECC', url: 'https://10.1.2.3:44300' };

    it('recognises an untrusted issuer by code and by the message a handler rethrows', () => {
      for (const code of ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']) {
        const cls = classifyAdtError({ code, message: 'x' }, ctx);
        expect(cls.kind).toBe('tlsCertificate');
        expect(cls.hint).toContain('openssl s_client -connect 10.1.2.3:44300 -servername 10.1.2.3');
        expect(cls.hint).toContain('tls.ca');
        expect(cls.hint).toContain('Destination ECC');
        expect(cls.nextTools).toEqual(['listSystems']);
      }
      // Text only, the way an McpError carries it after formatting.
      expect(classifyAdtError('Failed to get object source: self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca').kind).toBe('tlsCertificate');
      expect(classifyAdtError('Login failed: unable to verify the first certificate').kind).toBe('tlsCertificate');
      // The code may sit on the wrapped axios error.
      expect(classifyAdtError({ message: 'Request failed', parent: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } }).kind).toBe('tlsCertificate');
    });

    it('answers a name mismatch with tls.servername and quotes the names Node reported', () => {
      const msg = "Hostname/IP does not match certificate's altnames: IP: 10.1.2.3 is not in the cert's list: DNS:sap.example.com";
      const cls = classifyAdtError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID', message: msg }, ctx);
      expect(cls.kind).toBe('tlsCertificate');
      expect(cls.hint).toContain('"servername"');
      expect(cls.hint).toContain("IP: 10.1.2.3 is not in the cert's list: DNS:sap.example.com");
      expect(cls.hint).not.toContain('openssl');
      expect(classifyAdtError(msg).hint).toContain('servername');
    });

    it('says plainly that an expired certificate has no client-side fix', () => {
      const cls = classifyAdtError({ code: 'CERT_HAS_EXPIRED', message: 'certificate has expired' }, ctx);
      expect(cls.kind).toBe('tlsCertificate');
      expect(cls.hint).toContain('has expired');
      expect(cls.hint).toContain('STRUST');
      expect(cls.hint).not.toContain('tls.ca');
    });

    it('mentions insecureTls last and names what it does', () => {
      const hint = classifyAdtError({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT', message: 'self-signed certificate' }, ctx).hint!;
      expect(hint.indexOf('tls.ca')).toBeLessThan(hint.indexOf('insecureTls'));
      expect(hint).toMatch(/insecureTls: true turns verification off/);
    });

    it('still helps without a destination context, with placeholders instead of a host', () => {
      const cls = classifyAdtError({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: 'unable to verify the first certificate' });
      expect(cls.hint).toContain('<host>:<port>');
      expect(cls.hint).toContain('The destination');
    });

    it('wins over status-based rules: a handshake failure has no HTTP status', () => {
      expect(classifyAdtError({ code: 'CERT_HAS_EXPIRED', message: 'certificate has expired | status code 401' }).kind).toBe('tlsCertificate');
    });
  });

  // What reaches the classifier on a cookie destination (sso, sso2): abap-adt-api
  // wraps every error it does not recognise as an AdtErrorException with err 500.
  describe('errors abap-adt-api wrapped as 500', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { fromException } = require('abap-adt-api/build/AdtException');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AxiosError } = require('axios');
    const wrapped = (message: string, code: string) => fromException(new AxiosError(message, code, {}, {}, undefined));

    it('calls a connection failure what it is: SAP never answered, there is no status and no dump to look for', () => {
      for (const [code, message] of [
        ['ECONNRESET', 'socket hang up'],
        ['ETIMEDOUT', 'connect ETIMEDOUT 10.0.0.1:443'],
        ['ENOTFOUND', 'getaddrinfo ENOTFOUND sap.example.invalid'],
        ['ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:44300'],
        ['ECONNABORTED', 'timeout of 30000ms exceeded'],
        ['EAI_AGAIN', 'getaddrinfo EAI_AGAIN sap.example.invalid'],
      ]) {
        const e = wrapped(message, code);
        expect(e.err).toBe(500);
        const c = classifyAdtError(e);
        expect({ code, kind: c.kind, status: c.status }).toEqual({ code, kind: 'network', status: undefined });
        expect(c.hint).toMatch(/did not answer/);
        expect(c.hint).not.toMatch(/dump/i);
        expect(c.nextTools).not.toContain('dumps');
      }
    });

    it('recognises the same failure by code, unwrapped and through a handler wrapper', () => {
      expect(classifyAdtError(new AxiosError('socket hang up', 'ECONNRESET', {}, {}, undefined)).kind).toBe('network');
      expect(classifyAdtError({ message: 'x', parent: { code: 'ETIMEDOUT' } }).kind).toBe('network');
      const handler: any = new Error('Failed to get object source: AxiosError: socket hang up'); handler.cause = wrapped('socket hang up', 'ECONNRESET');
      expect(classifyAdtError(handler).kind).toBe('network');
      expect(classifyAdtError({ message: 'Failed to read: connect ETIMEDOUT 10.0.0.1:443' }).kind).toBe('network');
    });

    it('names the destination and its host when it knows them', () => {
      const c = classifyAdtError(wrapped('getaddrinfo ENOTFOUND sap.example.invalid', 'ENOTFOUND'), { destination: 'DEV', url: 'https://sap.example.invalid:44300' });
      expect(c.hint).toMatch(/^Destination DEV \(sap\.example\.invalid:44300\) did not answer/);
    });

    it('warns that a write may have reached SAP', () => {
      expect(classifyAdtError(wrapped('socket hang up', 'ECONNRESET')).hint).toMatch(/may or may not have reached SAP/);
    });

    it('does not report the wrapper\'s 500 as the HTTP status of an expired SSO session', () => {
      const loginPage: any = new Error('SSO session expired: the identity provider returned a login page instead of an ADT response. Re-authenticate (login) and retry.');
      loginPage.code = 'SESSION_EXPIRED'; loginPage.status = 401;
      const e = fromException(loginPage);
      expect(e.err).toBe(500);
      expect(classifyAdtError(e)).toMatchObject({ kind: 'sessionExpired', status: undefined });
    });

    it('does not call a wrapped client-side error an SAP server error', () => {
      const e = fromException(new TypeError("Cannot read properties of undefined (reading 'type')"));
      expect(e.err).toBe(500);
      expect(classifyAdtError(e)).toEqual({ kind: 'unknown', status: undefined });
    });

    it('still reports a 500 that SAP sent', () => {
      const xml = '<?xml version="1.0"?><exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionInternalError"/><message lang="EN">Internal error</message><localizedMessage lang="EN">Internal error</localizedMessage><properties/></exc:exception>';
      expect(classifyAdtError(fromException({ status: 500, statusText: 'Internal Server Error', headers: {}, body: xml }))).toMatchObject({ kind: 'serverError', status: 500, nextTools: ['dumps'] });
      expect(classifyAdtError(fromException({ status: 500, statusText: 'Internal Server Error', headers: {}, body: '' }))).toMatchObject({ kind: 'serverError', status: 500 });
      expect(classifyAdtError(fromException({ status: 500, statusText: 'Internal Server Error', headers: {}, body: '<html><body>500 Internal Server Error</body></html>' }))).toMatchObject({ kind: 'serverError', status: 500 });
    });

    it('does not mistake SAP wording about time for a connection failure', () => {
      expect(classifyAdtError('Error 400:Session timed out').kind).toBe('sessionExpired');
      expect(classifyAdtError({ status: 404, message: 'Class ZCL_NETWORK_TIMEOUT does not exist' }).kind).toBe('notFound');
      expect(classifyAdtError({ status: 500, message: 'Time limit exceeded' }).kind).toBe('serverError');
    });
  });

  describe('RFC transport', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HttpClientException } = require('abap-adt-api/build/AdtHTTP');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { fromException } = require('abap-adt-api/build/AdtException');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RfcError, RFC_RC } = require('../rfc/types');
    // As the transport throws it and as a handler wraps it after abap-adt-api mapped it.
    const viaLibrary = (message: string, rfc: any, status?: number) => {
      const e = new HttpClientException(message, rfc.rfcCodeName, status, undefined, { url: '/x' }, undefined, rfc);
      e.cause = rfc;
      const wrapped: any = new Error(`Failed to get object source: ${message}`);
      wrapped.cause = fromException(e);
      return wrapped;
    };

    it('points a missing or unloadable NW RFC SDK at the download, never a generic unknown', () => {
      const sdk = new RfcError('SAP NW RFC SDK not found: looked for /usr/local/sap/nwrfcsdk/lib/libsapnwrfc.dylib; set SAPNWRFC_HOME', -1, 'SDK_NOT_FOUND');
      const c = classifyAdtError(viaLibrary(sdk.message, sdk));
      expect(c.kind).toBe('rfcSdkMissing');
      expect(c.hint).toMatch(/SAP Software Download Center/);
      expect(c.hint).toMatch(/S-user/);
      expect(c.hint).toMatch(/SAPNWRFC_HOME .*rfc\.sdkPath/);
      expect(c.hint).toMatch(/licence forbids redistribution/);
      // by code alone, and by text alone
      expect(classifyAdtError(viaLibrary('dlopen failed', new RfcError('dlopen failed', -1, 'SDK_LOAD_FAILED'))).kind).toBe('rfcSdkMissing');
      expect(classifyAdtError({ message: 'Failed to read: SAP NetWeaver RFC SDK could not be loaded' }, { transport: 'rfc' }).kind).toBe('rfcSdkMissing');
      // koffi missing is not a missing SDK: its own hint, no download
      const koffi = classifyAdtError({ message: 'The RFC transport needs the optional dependency koffi (a native FFI module), which is not installed' }, { transport: 'rfc' });
      expect(koffi.kind).toBe('rfcSdkMissing');
      expect(koffi.hint).toMatch(/npm config get omit/);
      expect(koffi.hint).not.toMatch(/Download/);
      // a binding error that is neither falls through with its own message
      expect(classifyAdtError(viaLibrary('SADT_REST_RFC_ENDPOINT has another interface', new RfcError('SADT_REST_RFC_ENDPOINT has another interface', -1, 'SADT_INTERFACE_MISMATCH'))).kind).not.toBe('rfcSdkMissing');
    });

    it('says that locks are gone when the RFC session ended', () => {
      const lost = new RfcError('partner not reached', RFC_RC.RFC_COMMUNICATION_FAILURE, 'RFC_COMMUNICATION_FAILURE');
      const c = classifyAdtError(viaLibrary('RFC connection to OLD lost (RFC_COMMUNICATION_FAILURE): partner not reached. The RFC session ended: locks held in the RFC session are gone; lock the objects again before writing.', lost));
      expect(c).toMatchObject({ kind: 'rfcSessionLost', nextTools: ['lock', 'listLocks'] });
      expect(c.hint).toMatch(/locks held in the RFC session are gone/);
      expect(c.hint).toMatch(/lock again/);
      // the work connection dropped: the locks are still held
      const work = classifyAdtError({ message: 'RFC connection to OLD lost (RFC_TIMEOUT): timeout. The server reconnects on the next call.' }, { transport: 'rfc' });
      expect(work.kind).toBe('network');
      expect(work.hint).toMatch(/locks are still held/);
    });

    it('sends an unreachable gateway to the RFC settings, not to url', () => {
      const down = new RfcError('partner old.example.com:3300 not reached', RFC_RC.RFC_COMMUNICATION_FAILURE, 'RFC_COMMUNICATION_FAILURE');
      const c = classifyAdtError(viaLibrary('RFC connection to OLD could not be opened (RFC_COMMUNICATION_FAILURE): partner old.example.com:3300 not reached', down), { destination: 'OLD', url: 'https://old.example.com:44300' });
      expect(c.kind).toBe('network');
      expect(c.hint).toMatch(/rfc\.ashost and rfc\.sysnr/);
      expect(c.hint).toMatch(/33<sysnr>/);
    });

    it('treats a refused ticket as an expired session, a refused password as final, and a short dump as a server error', () => {
      const logon = new RfcError('Name or password is incorrect', RFC_RC.RFC_LOGON_FAILURE, 'RFC_LOGON_FAILURE');
      expect(classifyAdtError(viaLibrary('RFC logon to OLD failed: Name or password is incorrect', logon, 401))).toMatchObject({ kind: 'sessionExpired', status: 401 });
      expect(classifyAdtError({ message: 'Failed: RFC logon to OLD failed: ticket expired' }, { transport: 'rfc' }).kind).toBe('sessionExpired');
      // a refused password is not retried: retries could lock the SAP user
      const refused = classifyAdtError({ message: 'RFC logon to OLD was refused: Name or password is incorrect. The server makes no further logon attempt' }, { transport: 'rfc' });
      expect(refused.kind).toBe('authorization');
      expect(refused.hint).toMatch(/no further password logon/);
      expect(refused.hint).toMatch(/Do not call this destination again until the password is fixed/);
      // a short dump that also ended the lock session is still SAP's error: dumps first
      const dumpLost = classifyAdtError({ message: 'RFC call to OLD failed (RFC_ABAP_RUNTIME_FAILURE): SYSTEM_FAILURE. The RFC session ended with this error: locks held in the RFC session are gone', status: 500 }, { transport: 'rfc' });
      expect(dumpLost).toMatchObject({ kind: 'serverError', nextTools: ['dumps'] });
      // "No RFC authorization" is an authorization problem over RFC only
      expect(classifyAdtError({ message: 'No RFC authorization for function module SADT_REST_RFC_ENDPOINT' }, { transport: 'rfc' }).kind).toBe('authorization');
      expect(classifyAdtError({ message: 'No RFC authorization for function module Z_REMOTE_CHECK', status: 500 }, { transport: 'http' }).kind).toBe('serverError');
      const dump = new RfcError('SYSTEM_FAILURE', RFC_RC.RFC_ABAP_RUNTIME_FAILURE, 'RFC_ABAP_RUNTIME_FAILURE');
      expect(classifyAdtError(viaLibrary('RFC call to OLD failed (RFC_ABAP_RUNTIME_FAILURE): SYSTEM_FAILURE', dump, 500))).toMatchObject({ kind: 'serverError', nextTools: ['dumps'] });
    });

    it('leaves HTTP classifications alone', () => {
      expect(classifyAdtError({ message: 'Object ZCL_RFC_HELPER does not exist' }).kind).toBe('notFound');
      expect(classifyAdtError({ message: 'Function module RFC_READ_TABLE is locked by user X' }).kind).toBe('locked');
      // RFC wording in an HTTP destination's SAP error text never triggers the RFC rules
      expect(classifyAdtError({ message: 'Error 403: RFC logon to Q01 failed', status: 403 }, { transport: 'http' }).kind).toBe('authorization');
      expect(classifyAdtError({ message: 'Error 400: invalid entry in sapnwrfc.ini', status: 400 }, { transport: 'http' }).kind).toBe('ambiguous400');
      expect(classifyAdtError({ message: 'Error 404: RFC connection to ZDEST could not be opened: gateway timeout', status: 404 }, { transport: 'http' }).kind).toBe('notFound');
    });
  });

  it('explains "wrong input data" on an object created earlier in the same session', () => {
    const e: any = new Error('Resource  ZCL_NEW: wrong input data for processing'); e.err = 400; e.type = 'ExceptionResourceWrongData'; e.namespace = 'com.sap.adt';
    const c = classifyAdtError(e);
    expect(c).toMatchObject({ kind: 'wrongInputData', status: 400 });
    expect(c.hint).toMatch(/created earlier in this same session/);
    expect(c.hint).toMatch(/setObjectSource/);
    expect(c.nextTools).toEqual(expect.arrayContaining(['setObjectSource', 'dropSession']));
    expect(classifyAdtError({ message: 'Failed to get object structure: Resource  ZCL_NEW: wrong input data for processing' }).kind).toBe('wrongInputData');
    // A plain 400 keeps its own kind.
    expect(classifyAdtError({ message: 'Request failed with status code 400' }).kind).toBe('ambiguous400');
  });
});
