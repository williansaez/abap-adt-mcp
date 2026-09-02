import { classifyAdtError } from '../adtErrorHints';

describe('classifyAdtError', () => {
  it('detects expired sessions from status, code and text', () => {
    expect(classifyAdtError({ message: 'Request failed with status code 401' }).kind).toBe('sessionExpired');
    expect(classifyAdtError({ code: 'SESSION_EXPIRED', message: 'SSO session expired: login page' }).kind).toBe('sessionExpired');
    expect(classifyAdtError('Error 400:Session timed out').kind).toBe('sessionExpired');
    expect(classifyAdtError({ message: 'Failed to get object source: Request failed with status code 401' })).toMatchObject({ kind: 'sessionExpired', status: 401, nextTools: ['login', 'lock'] });
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
});
