import { belongsToHost, chromiumAuthArgs, cookieHostOf } from '../browserLogin';

describe('browser SSO cookie host matching', () => {
  it('matches cookies against the hostname, never the host with its port', () => {
    expect(cookieHostOf('https://sap.example.com:44300')).toBe('sap.example.com');
    expect(cookieHostOf('https://my000000.s4hana.cloud.sap')).toBe('my000000.s4hana.cloud.sap');
    expect(cookieHostOf('https://10.1.2.3:8443/')).toBe('10.1.2.3');
  });

  it('accepts the exact domain and parent domains, with or without a leading dot', () => {
    const host = cookieHostOf('https://sap.example.com:44300');
    expect(belongsToHost('sap.example.com', host)).toBe(true);
    expect(belongsToHost('.sap.example.com', host)).toBe(true);
    expect(belongsToHost('.example.com', host)).toBe(true);
    expect(belongsToHost('SAP.EXAMPLE.COM', host)).toBe(true);
  });

  it('rejects other hosts and the port-carrying form the old comparison used', () => {
    expect(belongsToHost('sap.example.com', 'other.example.com')).toBe(false);
    expect(belongsToHost('example.com', 'notexample.com')).toBe(false);
    // The regression: host with port never equals a cookie domain.
    expect(belongsToHost('sap.example.com', 'sap.example.com:44300')).toBe(false);
  });
});

describe('Chromium integrated-authentication flags (Secure Login Client / Kerberos)', () => {
  it('allowlists exactly the destination host, never a wildcard', () => {
    expect(chromiumAuthArgs('https://sap.example.com:44300')).toEqual([
      '--auth-server-allowlist=sap.example.com',
      '--auth-negotiate-delegate-allowlist=sap.example.com',
    ]);
  });

  it('drops the port and the path, as Chromium matches on host only', () => {
    expect(chromiumAuthArgs('https://sap.example.com:8443/sap/bc/adt')).toEqual([
      '--auth-server-allowlist=sap.example.com',
      '--auth-negotiate-delegate-allowlist=sap.example.com',
    ]);
  });

  it('yields no flags for an unusable url instead of throwing, so the browser still opens', () => {
    expect(chromiumAuthArgs('not a url')).toEqual([]);
    expect(chromiumAuthArgs('')).toEqual([]);
  });
});
