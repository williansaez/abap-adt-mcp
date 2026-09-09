import { belongsToHost, cookieHostOf } from '../browserLogin';

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
