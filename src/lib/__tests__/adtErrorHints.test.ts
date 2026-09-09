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
});
