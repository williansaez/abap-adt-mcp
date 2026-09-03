import { listMethods, findMethod, replaceMethod, classUrlOf, includeSourceUrl } from '../methodSource';

const SRC = `CLASS zcl_a DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS get_data.
ENDCLASS.

CLASS zcl_a IMPLEMENTATION.
* comment with ENDMETHOD. inside
  METHOD get_data.
    " ENDMETHOD. in a comment line
    DATA x TYPE i.
  ENDMETHOD.

  METHOD if_oo_adt_classrun~main.
    out->write( 'hi' ).
  ENDMETHOD.

  METHOD calc BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT.
    select 1 from dummy;
  ENDMETHOD.
ENDCLASS.`;

describe('methodSource', () => {
  it('lists blocks with line ranges, ignoring comments and handling interface and AMDP methods', () => {
    const blocks = listMethods(SRC);
    expect(blocks.map(b => [b.name, b.startLine, b.endLine, b.amdp])).toEqual([
      ['GET_DATA', 8, 11, false], ['IF_OO_ADT_CLASSRUN~MAIN', 13, 15, false], ['CALC', 17, 19, true]
    ]);
    expect(findMethod(SRC, 'get_data')!.text).toContain('DATA x TYPE i.');
    expect(findMethod(SRC, 'nope')).toBeUndefined();
  });

  it('replaces a full block or wraps a body with the existing header/footer', () => {
    const block = findMethod(SRC, 'GET_DATA')!;
    const full = replaceMethod(SRC, block, 'METHOD get_data.\n    DATA y TYPE i.\n  ENDMETHOD.');
    expect(full.wrapped).toBe(false);
    expect(full.source).toContain('DATA y TYPE i.');
    expect(full.source).not.toContain('DATA x TYPE i.');
    expect(listMethods(full.source).map(b => b.name)).toEqual(['GET_DATA', 'IF_OO_ADT_CLASSRUN~MAIN', 'CALC']);
    const body = replaceMethod(SRC, block, '    DATA z TYPE i.\n    z = 1.');
    expect(body.wrapped).toBe(true);
    const nb = findMethod(body.source, 'GET_DATA')!;
    expect(nb.text.split('\n')).toEqual(['  METHOD get_data.', '    DATA z TYPE i.', '    z = 1.', '  ENDMETHOD.']);
    expect(findMethod(body.source, 'CALC')!.startLine).toBe(nb.endLine + 6);
  });

  it('builds class and include URLs from names or URLs', () => {
    expect(classUrlOf('ZCL_Demo')).toBe('/sap/bc/adt/oo/classes/zcl_demo');
    expect(classUrlOf('/sap/bc/adt/oo/classes/zcl_demo/source/main')).toBe('/sap/bc/adt/oo/classes/zcl_demo');
    expect(classUrlOf('/sap/bc/adt/oo/classes/zcl_demo/includes/testclasses')).toBe('/sap/bc/adt/oo/classes/zcl_demo');
    expect(includeSourceUrl('/sap/bc/adt/oo/classes/zcl_demo')).toBe('/sap/bc/adt/oo/classes/zcl_demo/source/main');
    expect(includeSourceUrl('/sap/bc/adt/oo/classes/zcl_demo', 'testclasses')).toBe('/sap/bc/adt/oo/classes/zcl_demo/includes/testclasses');
  });
});
