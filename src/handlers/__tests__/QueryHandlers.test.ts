import { parseQueryResponse, decodeQueryResult } from 'abap-adt-api/build/api/tablecontents';
import { QueryHandlers } from '../QueryHandlers';

const column = (name: string, type: string, values: string[]) =>
  `<dataPreview:columns><dataPreview:metadata dataPreview:name="${name}" dataPreview:type="${type}" dataPreview:description="d" dataPreview:keyAttribute="false" dataPreview:colType="" dataPreview:isKeyFigure="false" dataPreview:length="10"/>` +
  `<dataPreview:dataSet>${values.map(v => `<dataPreview:data>${v}</dataPreview:data>`).join('')}</dataPreview:dataSet></dataPreview:columns>`;
const XML = '<?xml version="1.0" encoding="utf-8"?><dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">' +
  column('KWERT', 'P', ['12.34-', '1234567890123456.78']) +
  column('KPOSN', 'N', ['000010', '000020']) +
  column('ERDAT', 'D', ['20260929', '00000000']) +
  column('KSCHL', 'C', ['PR00', '']) +
  '</dataPreview:tableData>';

// The client behaves like abap-adt-api: it decodes unless told otherwise.
function make() {
  const answer = (decode: boolean | undefined) => {
    const parsed = parseQueryResponse(XML);
    return decode === false ? parsed : decodeQueryResult(parsed);
  };
  const client: any = {
    tableContents: jest.fn(async (_name: string, _rows: number, decode?: boolean) => answer(decode)),
    runQuery: jest.fn(async (_sql: string, _rows: number, decode?: boolean) => answer(decode)),
  };
  return { client, handler: new QueryHandlers(client) };
}
const rows = (r: any) => JSON.parse(r.content[0].text).result.values;

describe('tableContents and runQuery values', () => {
  it('return what SAP sent: sign kept, leading zeros kept, no rounding, initial date kept', async () => {
    const expected = [
      { KWERT: '-12.34', KPOSN: '000010', ERDAT: '20260929', KSCHL: 'PR00' },
      { KWERT: '1234567890123456.78', KPOSN: '000020', ERDAT: '00000000', KSCHL: '' },
    ];
    const { client, handler } = make();
    expect(rows(await handler.handle('runQuery', { sqlQuery: 'select * from konv' }))).toEqual(expected);
    expect(rows(await handler.handle('tableContents', { ddicEntityName: 'KONV' }))).toEqual(expected);
    // The library's lossy decoder is never asked to run.
    expect(client.runQuery).toHaveBeenCalledWith('select * from konv', 100, false);
    expect(client.tableContents).toHaveBeenCalledWith('KONV', 100, false, undefined);
  });

  it('decode=true gives numbers where they are exact and never touches NUMC', async () => {
    const { client, handler } = make();
    expect(rows(await handler.handle('runQuery', { sqlQuery: 'select * from konv', decode: true }))).toEqual([
      { KWERT: -12.34, KPOSN: '000010', ERDAT: '2026-09-29', KSCHL: 'PR00' },
      { KWERT: '1234567890123456.78', KPOSN: '000020', ERDAT: '00000000', KSCHL: '' },
    ]);
    expect(client.runQuery).toHaveBeenCalledWith('select * from konv', 100, false);
  });

  it('pages the shaped rows', async () => {
    const { handler } = make();
    const payload = JSON.parse((await handler.handle('tableContents', { ddicEntityName: 'KONV', startRow: 1, maxRows: 1 })).content[0].text);
    expect(payload).toMatchObject({ totalRows: 2, startRow: 1, returnedRows: 1, hasMore: false });
    expect(payload.result.values).toEqual([{ KWERT: '1234567890123456.78', KPOSN: '000020', ERDAT: '00000000', KSCHL: '' }]);
  });
});
