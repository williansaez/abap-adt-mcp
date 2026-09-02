import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { SAFE_OUTPUT_CHARS, shrinkToFit } from '../lib/responseSizing.js';
import { summarizeDump, normalizeDumpId, toCompactTimestamp } from '../lib/dumpParsing.js';

export class FeedHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'feeds',
                description: 'Retrieves a list of feeds.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'dumps',
                description: 'List recent ABAP short dumps (runtime errors). By default returns a compact summary per dump (runtime error, exception, program, user, time, where it terminated with source URL and line, top of the call stack) instead of the raw HTML. Filter with from/to (timestamps), user, or a substring in program/runtime error. Use dumpDetails(dumpId) for the full analysis of one dump. This is the root-cause path on S/4HANA Cloud where the debugger is not available.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Optional ADT feed query string passed through to the server.',
                            optional: true
                        },
                        from: {
                            type: 'string',
                            description: 'Only dumps at or after this time: YYYYMMDDHHMMSS, YYYYMMDD, YYYY-MM-DD or ISO 8601 (system time).',
                            optional: true
                        },
                        to: {
                            type: 'string',
                            description: 'Only dumps at or before this time (same formats as from).',
                            optional: true
                        },
                        user: {
                            type: 'string',
                            description: 'Only dumps of this SAP user (case-insensitive).',
                            optional: true
                        },
                        contains: {
                            type: 'string',
                            description: 'Only dumps whose runtime error, exception, program or short text contains this text (case-insensitive).',
                            optional: true
                        },
                        includeHtml: {
                            type: 'boolean',
                            description: 'Return the raw HTML text of each dump as well (large). Default false.',
                            optional: true
                        },
                        startIndex: {
                            type: 'number',
                            description: '0-based index of the dump to start from (default 0). Use with maxItems to page through a large dump list.',
                            optional: true
                        },
                        maxItems: {
                            type: 'number',
                            description: 'Maximum number of dumps to return from startIndex. Omit to return the rest.',
                            optional: true
                        }
                    }
                }
            },
            {
                name: 'dumpDetails',
                description: 'Full formatted analysis of one ABAP short dump as plain text (header, what happened, error analysis, where terminated, source extract, variables, call stack). Pass the dumpId from dumps (or the full self link). Page long dumps with startLine/maxLines.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        dumpId: { type: 'string', description: 'dumpId as returned by dumps, or its self/id link' },
                        startLine: { type: 'number', description: '1-based first line of the text to return (default 1)', optional: true },
                        maxLines: { type: 'number', description: 'Maximum number of lines to return', optional: true }
                    },
                    required: ['dumpId']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'feeds':
                return this.handleFeeds(args);
            case 'dumps':
                return this.handleDumps(args);
            case 'dumpDetails':
                return this.handleDumpDetails(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown feed tool: ${toolName}`);
        }
    }

    async handleFeeds(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const feeds = await this.adtclient.feeds();
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            feeds
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get feeds: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleDumps(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            let from: string | undefined, to: string | undefined;
            try {
                from = toCompactTimestamp(args.from);
                to = toCompactTimestamp(args.to);
            } catch (e: any) {
                throw new McpError(ErrorCode.InvalidParams, e.message);
            }
            const user = args.user ? String(args.user).toUpperCase() : undefined;
            const contains = args.contains ? String(args.contains).toLowerCase() : undefined;

            // Resolves to a DumpsFeed: { href, title, updated, dumps: Dump[] }.
            const dumpsFeed = await this.adtclient.dumps(args.query);
            this.trackRequest(startTime, true);

            const rawDumps: any[] = Array.isArray(dumpsFeed?.dumps) ? dumpsFeed.dumps : [];
            const summaries = rawDumps.map(d => ({ summary: summarizeDump(d), raw: d }));
            const filtered = summaries.filter(({ summary }) => {
                const ts = decodeURIComponent(summary.dumpId).slice(0, 14);
                if (from && /^\d{14}$/.test(ts) && ts < from) return false;
                if (to && /^\d{14}$/.test(ts) && ts > to) return false;
                if (user && String(summary.user || '').toUpperCase() !== user) return false;
                if (contains) {
                    const hay = [summary.runtimeError, summary.exception, summary.program, summary.shortText]
                        .filter(Boolean).join(' ').toLowerCase();
                    if (!hay.includes(contains)) return false;
                }
                return true;
            });

            const items = filtered.map(({ summary, raw }) => args.includeHtml === true ? { ...summary, html: raw.text } : summary);
            const totalItems = items.length;
            const startIndex = Math.max(0, Number(args.startIndex) || 0);
            const requestedPaging = args.startIndex !== undefined || args.maxItems !== undefined;
            const initialMaxItems = args.maxItems !== undefined
                ? Math.max(0, Number(args.maxItems))
                : totalItems - startIndex;

            const text = shrinkToFit(initialMaxItems, (count, capped) => {
                const endIndex = Math.min(startIndex + count, totalItems);
                const payload: any = {
                    status: 'success',
                    feed: { href: dumpsFeed?.href, title: dumpsFeed?.title, updated: dumpsFeed?.updated },
                    totalInFeed: rawDumps.length,
                    totalItems,
                    startIndex,
                    returnedItems: Math.max(0, endIndex - startIndex),
                    hasMore: endIndex < totalItems,
                    dumps: items.slice(startIndex, endIndex)
                };
                if (from || to || user || contains) payload.filters = { from, to, user, contains };
                if (!requestedPaging && capped) payload.autoPaged = true;
                if (capped) {
                    payload.capped = true;
                    payload.note = 'Requested/default range exceeded the safe response size and was shrunk to fit. Pass a smaller maxItems (or a later startIndex) to continue.';
                }
                return payload;
            });

            return { content: [{ type: 'text', text }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get dumps: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleDumpDetails(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const id = normalizeDumpId(args.dumpId);
            if (!id) throw new McpError(ErrorCode.InvalidParams, 'dumpId is required');
            const response = await this.adtclient.httpClient.request(`/sap/bc/adt/runtime/dump/${id}`, {
                method: 'GET',
                headers: { Accept: 'text/plain' }
            });
            this.trackRequest(startTime, true);
            const fullText = String(response.body ?? '').replace(/\r\n/g, '\n');
            const lines = fullText.split('\n');
            const totalLines = lines.length;
            const startLine = Math.max(1, Number(args.startLine) || 1);
            const startIndex = startLine - 1;
            const initialMaxLines = args.maxLines !== undefined ? Math.max(0, Number(args.maxLines)) : totalLines - startIndex;
            const text = shrinkToFit(initialMaxLines, (count, capped) => {
                const endIndex = Math.min(startIndex + count, totalLines);
                const payload: any = {
                    status: 'success',
                    dumpId: id,
                    text: lines.slice(startIndex, endIndex).join('\n'),
                    totalLines, startLine,
                    returnedLines: Math.max(0, endIndex - startIndex),
                    hasMore: endIndex < totalLines
                };
                if (capped) payload.capped = true;
                return payload;
            });
            return { content: [{ type: 'text', text }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get dump details: ${this.formatAdtError(error)}`
            );
        }
    }
}
