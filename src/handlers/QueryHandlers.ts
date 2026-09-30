import { ADTClient } from 'abap-adt-api';
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { SAFE_OUTPUT_CHARS, shrinkToFit } from '../lib/responseSizing.js';
import { reflowSql, dataPreviewHint } from '../lib/sqlReflow.js';
import { normalizeQueryResult } from '../lib/queryDecode.js';

// SAP-side cap on rows requested from the ADT service itself (tableContents/
// runQuery `rowNumber` param). Independent from the JSON-output-size
// safeguard below: even with a modest row count, wide/large-cell rows can
// still blow past SAFE_OUTPUT_CHARS, so both caps are needed. Applied only
// when the caller omits rowNumber - an explicit rowNumber is still honoured
// SAP-side (the output-size shrink loop below is the backstop for that case).
const DEFAULT_ROW_NUMBER = 100;

export class QueryHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'tableContents',
                description: `Retrieves the contents of an ABAP table or CDS entity by name (no SQL). Reading table data is off unless the destination allows it (policy allowDataPreview or allowFreeSql in systems.json; listSystems shows dataAccess per destination): a refusal is final, tell the user instead of retrying. Works on tables the data preview refuses for runQuery (dataMaintenance restricted); authorization (S_TABU_DIS/S_TABU_NAM) still applies. rowNumber caps how many rows are requested from SAP itself (default ${DEFAULT_ROW_NUMBER} if omitted). For large results, use startRow/maxRows to page through the returned rows instead of retrieving them all at once.`,
                inputSchema: {
                    type: 'object',
                    properties: {
                        ddicEntityName: {
                            type: 'string',
                            description: 'The name of the DDIC entity (table or view).'
                        },
                        rowNumber: {
                            type: 'number',
                            description: `The maximum number of rows to retrieve from SAP. Defaults to ${DEFAULT_ROW_NUMBER} if omitted.`,
                            optional: true
                        },
                        decode: {
                            type: 'boolean',
                            description: 'Default false: every value is the string SAP sent (NUMC keys keep their leading zeros, amounts keep every digit), with the sign of a negative number in front ("-12.34"). true: numeric values become JSON numbers where the number is exact and stay strings otherwise, dates become YYYY-MM-DD; NUMC stays a string.',
                            optional: true
                        },
                        sqlQuery: {
                            type: 'string',
                            description: 'An optional SQL query to filter the data.',
                            optional: true
                        },
                        startRow: {
                            type: 'number',
                            description: '0-based index of the returned row to start from (default 0). Use with maxRows to page through a large result set.',
                            optional: true
                        },
                        maxRows: {
                            type: 'number',
                            description: 'Maximum number of rows to return from startRow. Omit to return the rest of the retrieved rows.',
                            optional: true
                        }
                    },
                    required: ['ddicEntityName']
                }
            },
            {
                name: 'runQuery',
                description: `Runs an ABAP SQL SELECT through the ADT data preview (tables and CDS views, released API views included). Free SQL is off unless the destination allows it (policy allowFreeSql in systems.json; listSystems shows dataAccess per destination): a refusal is final, tell the user instead of retrying. Long statements are wrapped automatically to the preview's 255-character line limit, so wide select lists are fine; a single literal longer than 255 characters is not. Tables whose DDIC dataMaintenance is restricted are refused by the preview: use tableContents for those. Values come back as SAP sent them, as strings: keys keep their internal format (leading zeros, see getDataElementProperties), negative numbers carry the sign in front; decode=true turns exact numbers into JSON numbers. rowNumber caps how many rows are requested from SAP itself (default ${DEFAULT_ROW_NUMBER} if omitted). For large results, use startRow/maxRows to page through the returned rows instead of retrieving them all at once.`,
                inputSchema: {
                    type: 'object',
                    properties: {
                        sqlQuery: {
                            type: 'string',
                            description: 'The SQL query to execute.'
                        },
                        rowNumber: {
                            type: 'number',
                            description: `The maximum number of rows to retrieve from SAP. Defaults to ${DEFAULT_ROW_NUMBER} if omitted.`,
                            optional: true
                        },
                        decode: {
                            type: 'boolean',
                            description: 'Default false: every value is the string SAP sent (NUMC keys keep their leading zeros, amounts keep every digit), with the sign of a negative number in front ("-12.34"). true: numeric values become JSON numbers where the number is exact and stay strings otherwise, dates become YYYY-MM-DD; NUMC stays a string.',
                            optional: true
                        },
                        startRow: {
                            type: 'number',
                            description: '0-based index of the returned row to start from (default 0). Use with maxRows to page through a large result set.',
                            optional: true
                        },
                        maxRows: {
                            type: 'number',
                            description: 'Maximum number of rows to return from startRow. Omit to return the rest of the retrieved rows.',
                            optional: true
                        }
                    },
                    required: ['sqlQuery']
                }
            }
        ];
    }

    async handle(toolName: string, arguments_: any): Promise<any> {
        switch (toolName) {
            case 'tableContents':
                return this.handleTableContents(arguments_);
            case 'runQuery':
                return this.handleRunQuery(arguments_);
            default:
                throw new Error(`Tool ${toolName} not implemented in QueryHandlers`);
        }
    }

    async handleTableContents(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const rowNumber = args.rowNumber !== undefined ? args.rowNumber : DEFAULT_ROW_NUMBER;
            // decode=false: the library's decoder loses signs, leading zeros and digits (src/lib/queryDecode.ts).
            const raw = await this.adtclient.tableContents(
                args.ddicEntityName,
                rowNumber,
                false,
                args.sqlQuery
            );
            const result = normalizeQueryResult(raw, args.decode === true);
            this.trackRequest(startTime, true);
            return this.buildQueryResultResponse(result, args);
        } catch (error: any) {
            this.trackRequest(startTime, false);
            const message = this.formatAdtError(error);
            const hint = dataPreviewHint(message);
            throw Object.assign(new Error(`Failed to retrieve table contents: ${message}${hint ? ' Hint: ' + hint : ''}`), { cause: error });
        }
    }

    async handleRunQuery(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const rowNumber = args.rowNumber !== undefined ? args.rowNumber : DEFAULT_ROW_NUMBER;
            const { sql, reflowed } = reflowSql(String(args.sqlQuery ?? ''));
            const raw = await this.adtclient.runQuery(sql, rowNumber, false);
            const result = normalizeQueryResult(raw, args.decode === true);
            this.trackRequest(startTime, true);
            const response = this.buildQueryResultResponse(result, args);
            if (reflowed) {
                try {
                    const payload = JSON.parse(response.content[0].text);
                    payload.note = 'Statement was wrapped onto short lines for the data preview (255-character line limit); semantics unchanged.';
                    response.content[0].text = JSON.stringify(payload);
                } catch { /* keep as is */ }
            }
            return response;
        } catch (error: any) {
            this.trackRequest(startTime, false);
            const message = this.formatAdtError(error);
            const hint = dataPreviewHint(message);
            throw Object.assign(new Error(`Failed to run query: ${message}${hint ? ` Hint: ${hint}` : ''}`), { cause: error });
        }
    }

    // Shared response shaping for tableContents/runQuery, which both return a
    // QueryResult ({ columns, values }). `values` is the row array that can
    // grow large enough (row count x wide/large cells) to blow past the
    // host's tool-output limit even when the SAP-side rowNumber cap is
    // reasonable, so it gets the same paginate-then-shrink treatment as
    // ObjectSourceHandlers' source lines / ClassHandlers' components.
    private buildQueryResultResponse(result: any, args: any): any {
        const allValues: any[] = Array.isArray(result?.values) ? result.values : [];
        const totalRows = allValues.length;
        const requestedPaging = args.startRow !== undefined || args.maxRows !== undefined;

        if (!requestedPaging) {
            const text = JSON.stringify({ status: 'success', result });
            if (text.length <= SAFE_OUTPUT_CHARS) {
                return { content: [{ type: 'text', text }] };
            }
        }

        const startRow = Math.max(0, Number(args.startRow) || 0);
        const initialMaxRows = args.maxRows !== undefined
            ? Math.max(0, Number(args.maxRows))
            : totalRows - startRow;

        const text = shrinkToFit(initialMaxRows, (count, capped) => {
            const endRow = Math.min(startRow + count, totalRows);
            const pagedResult = { ...result, values: allValues.slice(startRow, endRow) };
            const payload: any = {
                status: 'success',
                result: pagedResult,
                totalRows,
                startRow,
                returnedRows: Math.max(0, endRow - startRow),
                hasMore: endRow < totalRows
            };
            if (!requestedPaging) {
                payload.autoPaged = true;
            }
            if (capped) {
                payload.capped = true;
                payload.note = 'Requested/default range exceeded the safe response size and was shrunk to fit. Pass a smaller maxRows (or a later startRow) to continue.';
            }
            return payload;
        });

        return { content: [{ type: 'text', text }] };
    }
}
