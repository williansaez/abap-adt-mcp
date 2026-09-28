import { belongsToHost, cookieHostOf, redirectedOrigin } from '../browserLogin';

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

describe('browser SSO login redirected to another host', () => {
  const session = { name: 'SAP_SESSIONID_S4D_100', domain: 'sap.example.com' };
  const configured = 'http://10.1.2.3:8000/sap/bc/adt/core/discovery?sap-client=100';
  const target = 'https://sap.example.com:44300/sap/bc/adt/core/discovery?sap-client=100';

  it('names the origin to configure when an http://IP URL was redirected to the FQDN', () => {
    expect(redirectedOrigin([session], '10.1.2.3', [configured, target])).toBe('https://sap.example.com:44300');
  });

  it('stays quiet while the redirect target has no session cookie yet', () => {
    const noSession = [{ name: 'sap-usercontext', domain: 'sap.example.com' }];
    expect(redirectedOrigin(noSession, '10.1.2.3', [configured, target])).toBeUndefined();
  });

  it('stays quiet when every navigation stayed on the configured host', () => {
    expect(redirectedOrigin([session], 'sap.example.com', [target])).toBeUndefined();
  });

  it('does not end a SAML login on an ABAP identity provider that sets its own session cookie', () => {
    const idp = { name: 'SAP_SESSIONID_IDP_001', domain: 'idp.example.com' };
    const idpPage = 'https://idp.example.com/sap/saml2/idp/sso?saml2=disabled';
    expect(redirectedOrigin([idp], 'sap.example.com', [target, idpPage])).toBeUndefined();
  });

  it('ignores navigations without a usable URL', () => {
    expect(redirectedOrigin([session], '10.1.2.3', ['about:blank', 'chrome-error://chromewebdata/', ''])).toBeUndefined();
  });
});
