import { formatAdtError } from '../adtErrorFormatting';

const SAP_XML = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <namespace id="com.sap.adt"/>
  <type id="ExceptionResourceNoAccess"/>
  <message lang="EN">Object ZCL_FOO is locked by user DEVELOPER &amp; co</message>
  <localizedMessage lang="EN">Objekt gesperrt</localizedMessage>
  <properties>
    <entry key="lockUser">DEVELOPER</entry>
    <entry key="empty"></entry>
  </properties>
</exc:exception>`;

describe('formatAdtError', () => {
  it('returns Unknown error for nullish input', () => {
    expect(formatAdtError(undefined)).toBe('Unknown error');
    expect(formatAdtError(null)).toBe('Unknown error');
  });

  it('passes a plain string through', () => {
    expect(formatAdtError('boom')).toBe('boom');
  });

  it('keeps a specific Error message untouched', () => {
    expect(formatAdtError(new Error('Object not found'))).toBe('Object not found');
  });

  it('appends type, namespace and properties parsed by abap-adt-api', () => {
    const err = Object.assign(new Error('Locked'), {
      type: 'ExceptionResourceNoAccess',
      namespace: 'com.sap.adt',
      properties: { lockUser: 'DEVELOPER' }
    });
    expect(formatAdtError(err)).toBe(
      'Locked | type: ExceptionResourceNoAccess | namespace: com.sap.adt | details: [lockUser: DEVELOPER]'
    );
  });

  it('recovers the SAP message from the raw response when abap-adt-api fell back to the axios message', () => {
    const err = Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: SAP_XML }
    });
    expect(formatAdtError(err)).toBe(
      'Object ZCL_FOO is locked by user DEVELOPER & co | details: [lockUser: DEVELOPER]'
    );
  });

  it('walks cause/parent chains and body fields to find the exception XML', () => {
    const err = Object.assign(new Error('Request failed with status code 500'), {
      cause: { parent: { response: { body: SAP_XML } } }
    });
    expect(formatAdtError(err)).toContain('Object ZCL_FOO is locked');
  });

  it('survives circular error graphs', () => {
    const err: any = new Error('Request failed with status code 403');
    err.response = { data: 'no xml here', parent: err };
    expect(formatAdtError(err)).toBe('Request failed with status code 403');
  });
});
