import { CookieHttpClient } from '../cookieHttpClient';

const LOGIN_HTML = '<!DOCTYPE html><html><body><form id="logOnForm" method="post" action="/saml2/idp/sso"><input name="j_username"/><input name="SAMLRequest"/></form></body></html>';

function makeClient(responses: Array<{ status: number; data?: string; headers?: Record<string, any> }>) {
  const client = new CookieHttpClient('https://sap.example', [{ name: 'SAP_SESSIONID', value: 'abc' }], false, '100');
  const request = jest.fn(async (_config: any) => {
    const r = responses.shift()!;
    return { status: r.status, statusText: 'x', data: r.data ?? '', headers: r.headers ?? {} };
  });
  (client as any).axiosInstance = { request };
  return { client, request };
}

describe('CookieHttpClient', () => {
  it('sends the jar cookies and pins sap-client', async () => {
    const { client, request } = makeClient([{ status: 200, data: '<xml/>', headers: { 'content-type': 'application/xml' } }]);
    const res = await client.request({ url: '/sap/bc/adt/x' });
    expect(res.body).toBe('<xml/>');
    expect(request.mock.calls[0][0]).toMatchObject({ headers: { Cookie: 'SAP_SESSIONID=abc' }, params: { 'sap-client': '100' } });
  });

  it('turns an IAS login page into a SESSION_EXPIRED error', async () => {
    const { client } = makeClient([{ status: 200, data: LOGIN_HTML, headers: { 'content-type': 'text/html;charset=utf-8' } }]);
    await expect(client.request({ url: '/sap/bc/adt/oo/classes/zcl/source/main' })).rejects.toMatchObject({ code: 'SESSION_EXPIRED', status: 401 });
  });

  it('lets the logoff redirect page through instead of flagging an expired session', async () => {
    const { client } = makeClient([{ status: 200, data: LOGIN_HTML, headers: { 'content-type': 'text/html' } }]);
    const res = await client.request({ url: '/sap/public/bc/icf/logoff' });
    expect(res.status).toBe(200);
  });

  it('does not mistake ADT HTML payloads (dump text, docs) for a login page', () => {
    expect(CookieHttpClient.looksLikeLoginPage(200, 'text/html', '<html><body><h4>Header Information</h4><table><tr><td>Runtime Error</td></tr></table></body></html>')).toBe(false);
    expect(CookieHttpClient.looksLikeLoginPage(401, 'text/html', LOGIN_HTML)).toBe(false);
    expect(CookieHttpClient.looksLikeLoginPage(200, 'application/xml', LOGIN_HTML)).toBe(true);
  });

  it('retries once on 503 honouring a small Retry-After', async () => {
    const { client, request } = makeClient([
      { status: 503, data: 'busy', headers: { 'retry-after': '0' } },
      { status: 200, data: 'ok', headers: { 'content-type': 'text/plain' } }
    ]);
    const res = await client.request({ url: '/x' });
    expect(res.status).toBe(200);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('gives up after the single retry', async () => {
    const { client, request } = makeClient([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } }
    ]);
    const res = await client.request({ url: '/x' });
    expect(res.status).toBe(429);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('merges rotated Set-Cookie values into the jar', async () => {
    const { client, request } = makeClient([
      { status: 200, data: 'a', headers: { 'set-cookie': ['SAP_SESSIONID=new; path=/'] } },
      { status: 200, data: 'b', headers: {} }
    ]);
    await client.request({ url: '/x' });
    await client.request({ url: '/y' });
    expect(request.mock.calls[1][0].headers.Cookie).toBe('SAP_SESSIONID=new');
  });
});
