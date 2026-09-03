import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { ADTClient } from 'abap-adt-api';
import { sourceCache } from '../lib/sourceCache.js';
import { SAFE_OUTPUT_CHARS, shrinkToFit } from '../lib/responseSizing.js';
import { htmlToText, stripAbapDocChrome } from '../lib/htmlText.js';

export class CodeAnalysisHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'syntaxCheckCode',
                description: 'ABAP syntax check of a source against the context of an existing object: url is the source URL of that object (…/source/main), required because the check resolves types and includes in its context; it is not a standalone check of free text. Provide the source in "code" (alias: source), or omit it to reuse the source last read/written for "url" this session. Returns line, offset, severity and text per finding. To try free ABAP without an object, use runSnippet on a development system.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        code: {
                            type: 'string',
                            description: 'The ABAP source to check. Optional if the source for "url" was already read or written this session.',
                            optional: true
                        },
                        url: { type: 'string', description: 'Source URL of the object the code belongs to, e.g. /sap/bc/adt/oo/classes/zcl_x/source/main (aliases accepted: objectSourceUrl, objectUrl)' },
                        mainUrl: { type: 'string', description: 'Main program URL for includes (defaults to url)', optional: true },
                        mainProgram: { type: 'string', optional: true },
                        version: { type: 'string', optional: true }
                    },
                    required: ['url']
                }
            },
            {
                name: 'syntaxCheckCdsUrl',
                description: 'Perform ABAP syntax check with CDS URL',
                inputSchema: {
                    type: 'object',
                    properties: {
                        cdsUrl: { type: 'string' }
                    },
                    required: ['cdsUrl']
                }
            },
            {
                name: 'codeCompletion',
                description: 'Get code completion suggestions',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sourceUrl: { type: 'string' },
                        source: { type: 'string' },
                        line: { type: 'number' },
                        column: { type: 'number' }
                    },
                    required: ['sourceUrl', 'source', 'line', 'column']
                }
            },
            {
                name: 'findDefinition',
                description: 'Find symbol definition',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string' },
                        source: { type: 'string' },
                        line: { type: 'number' },
                        startCol: { type: 'number' },
                        endCol: { type: 'number' },
                        implementation: { type: 'boolean', optional: true },
                        mainProgram: { type: 'string', optional: true }
                    },
                    required: ['url', 'source', 'line', 'startCol', 'endCol']
                }
            },
            {
                name: 'usageReferences',
                description: 'Find symbol references (system-wide "where used"). For widely-used symbols this can return hundreds/thousands of hits; use startIndex/maxItems to page through the result instead of retrieving it all at once.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string' },
                        line: { type: 'number', optional: true },
                        column: { type: 'number', optional: true },
                        startIndex: {
                            type: 'number',
                            description: '0-based index of the first reference to return (default 0). Use with maxItems to page through large result sets.',
                            optional: true
                        },
                        maxItems: {
                            type: 'number',
                            description: 'Maximum number of references to return from startIndex. Omit to return the rest.',
                            optional: true
                        }
                    },
                    required: ['url']
                }
            },
            {
                name: 'syntaxCheckTypes',
                description: 'Retrieves syntax check types.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'codeCompletionFull',
                description: 'Performs full code completion.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sourceUrl: { type: 'string' },
                        source: { type: 'string' },
                        line: { type: 'number' },
                        column: { type: 'number' },
                        patternKey: { type: 'string', description: 'IDENTIFIER of a completion proposal previously returned by codeCompletion at the same position (the insertion endpoint completes that proposal); arbitrary values raise an exception' }
                    },
                    required: ['sourceUrl', 'source', 'line', 'column', 'patternKey']
                }
            },
            {
                name: 'runClass',
                description: 'Runs a class.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        className: { type: 'string' }
                    },
                    required: ['className']
                }
            },
            {
                name: 'codeCompletionElement',
                description: 'Retrieves code completion element information.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sourceUrl: { type: 'string' },
                        source: { type: 'string' },
                        line: { type: 'number' },
                        column: { type: 'number' }
                    },
                    required: ['sourceUrl', 'source', 'line', 'column']
                }
            },
            {
                name: 'usageReferenceSnippets',
                description: 'Retrieves usage reference snippets (source excerpts) for a list of usage references, e.g. from usageReferences. For large input lists the returned snippets can be large; use startIndex/maxItems to page through the result instead of retrieving it all at once.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        references: { type: 'array' },
                        startIndex: {
                            type: 'number',
                            description: '0-based index of the first snippet to return (default 0). Use with maxItems to page through large result sets.',
                            optional: true
                        },
                        maxItems: {
                            type: 'number',
                            description: 'Maximum number of snippets to return from startIndex. Omit to return the rest.',
                            optional: true
                        }
                    },
                    required: ['references']
                }
            },
            {
                name: 'fixProposals',
                description: 'Retrieves fix proposals.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string' },
                        source: { type: 'string' },
                        line: { type: 'number' },
                        column: { type: 'number' }
                    },
                    required: ['url', 'source', 'line', 'column']
                }
            },
            {
                name: 'fixEdits',
                description: 'Applies fix edits.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        proposal: { type: 'string' },
                        source: { type: 'string' }
                    },
                    required: ['proposal', 'source']
                }
            },
            {
                name: 'fragmentMappings',
                description: 'Retrieves fragment mappings.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string' },
                        type: { type: 'string' },
                        name: { type: 'string' }
                    },
                    required: ['url', 'type', 'name']
                }
            },
            {
                name: 'abapDocumentation',
                description: 'ABAP keyword documentation (the F1 help) as plain text. Two ways to ask: (a) keyword: a statement or addition such as "SELECT SINGLE", "WITH PRIVILEGED ACCESS", "LOOP AT GROUP BY" (the server builds the context for you); (b) cursor: objectUri, body (the source; fetched from objectUri when omitted), line and column of the element to explain. Long documents are paged with startLine/maxLines.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        keyword: { type: 'string', description: 'ABAP statement or addition to look up, e.g. "SELECT SINGLE", "WITH PRIVILEGED ACCESS"', optional: true },
                        objectUri: { type: 'string', description: 'Source URL giving the context (…/source/main); optional with keyword', optional: true },
                        body: { type: 'string', description: 'Source text the cursor refers to; omitted: read from objectUri', optional: true },
                        line: { type: 'number', description: '1-based line of the element (cursor mode)', optional: true },
                        column: { type: 'number', description: '1-based column of the element (cursor mode)', optional: true },
                        language: { type: 'string', optional: true },
                        startLine: { type: 'number', description: '1-based first line of the text to return (default 1)', optional: true },
                        maxLines: { type: 'number', description: 'Maximum lines to return (default: as many as fit)', optional: true },
                        raw: { type: 'boolean', description: 'Return the HTML instead of plain text', optional: true }
                    }
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'syntaxCheckCode':
                return this.handleSyntaxCheckCode(args);
            case 'syntaxCheckCdsUrl':
                return this.handleSyntaxCheckCdsUrl(args);
            case 'codeCompletion':
                return this.handleCodeCompletion(args);
            case 'findDefinition':
                return this.handleFindDefinition(args);
            case 'usageReferences':
                return this.handleUsageReferences(args);
            case 'syntaxCheckTypes':
                return this.handleSyntaxCheckTypes(args);
            case 'codeCompletionFull':
                return this.handleCodeCompletionFull(args);
            case 'runClass':
                return this.handleRunClass(args);
            case 'codeCompletionElement':
                return this.handleCodeCompletionElement(args);
            case 'usageReferenceSnippets':
                return this.handleUsageReferenceSnippets(args);
            case 'fixProposals':
                return this.handleFixProposals(args);
            case 'fixEdits':
                return this.handleFixEdits(args);
            case 'fragmentMappings':
                return this.handleFragmentMappings(args);
            case 'abapDocumentation':
                return this.handleAbapDocumentation(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown code analysis tool: ${toolName}`);
        }
    }
    async handleSyntaxCheckCdsUrl(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.syntaxCheck(args.cdsUrl);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Syntax check failed: ${this.formatAdtError(error)}`
            );
        }
    }
    async handleSyntaxCheckCode(args: any): Promise<any> {
        // Reuse the source cached by getObjectSource/setObjectSource for this
        // URL when the caller does not pass it explicitly (issue #2). Resolved
        // before the try so a missing-source error keeps its InvalidParams code.
        let code = args?.code;
        let usedCachedSource = false;
        if (code === undefined || code === null || code === '') {
            const cached = sourceCache.get(this.adtclient, args.url);
            if (cached === undefined) {
                throw new McpError(
                    ErrorCode.InvalidParams,
                    `No source provided and none cached for '${args.url}'. Pass "code", or call getObjectSource/setObjectSource for this URL first.`
                );
            }
            code = cached;
            usedCachedSource = true;
        }

        const startTime = performance.now();
        try {
            // The library's 5-arg overload requires mainUrl; for standalone sources
            // the object's own URL is the correct main context.
            const result = await this.adtclient.syntaxCheck(args.url, args?.mainUrl || args.url, code, args?.mainProgram, args?.version);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            usedCachedSource,
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Syntax check failed: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleCodeCompletion(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.codeCompletion(
                args.sourceUrl,
                args.source,
                args.line,
                args.column
            );
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Code completion failed: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleFindDefinition(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.findDefinition(
                args.url,
                args.source,
                args.line,
                args.startCol,
                args.endCol,
                args.implementation,
                args.mainProgram
            );
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Find definition failed: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleUsageReferences(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.usageReferences(
                args.url,
                args.line,
                args.column
            );
            this.trackRequest(startTime, true);

            const requestedPaging = args.startIndex !== undefined || args.maxItems !== undefined;

            if (!requestedPaging) {
                const text = JSON.stringify({ status: 'success', result });
                if (text.length <= SAFE_OUTPUT_CHARS) {
                    return { content: [{ type: 'text', text }] };
                }
            }

            const totalItems = result.length;
            const startIndex = Math.max(0, Number(args.startIndex) || 0);
            const initialMaxItems = args.maxItems !== undefined
                ? Math.max(0, Number(args.maxItems))
                : totalItems - startIndex;

            const text = shrinkToFit(initialMaxItems, (count, capped) => {
                const endIndex = Math.min(startIndex + count, totalItems);
                const payload: any = {
                    status: 'success',
                    result: result.slice(startIndex, endIndex),
                    totalItems,
                    startIndex,
                    returnedItems: Math.max(0, endIndex - startIndex),
                    hasMore: endIndex < totalItems
                };
                if (!requestedPaging) {
                    payload.autoPaged = true;
                }
                if (capped) {
                    payload.capped = true;
                    payload.note = 'Requested/default range exceeded the safe response size and was shrunk to fit. Pass a smaller maxItems (or a later startIndex) to continue.';
                }
                return payload;
            });

            return { content: [{ type: 'text', text }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Usage references failed: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleSyntaxCheckTypes(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.syntaxCheckTypes();
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Syntax check types failed: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleCodeCompletionFull(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.codeCompletionFull(args.sourceUrl, args.source, args.line, args.column, args.patternKey);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Code completion full failed: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleRunClass(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const { runClassFresh } = await import('../lib/runFresh.js');
            const run = await runClassFresh(this.adtclient, args.className);
            this.trackRequest(startTime, true);
            const payload: any = { status: 'success', result: run.output, runMode: run.mode };
            if (run.locksInvalidated.length) {
                payload.locksInvalidated = run.locksInvalidated;
                payload.note = 'Running with a fresh program load on an SSO destination resets the stateful ADT session; the explicit locks listed were released first. Re-lock before writing again.';
            }
            return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Run class failed: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleCodeCompletionElement(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.codeCompletionElement(args.sourceUrl, args.source, args.line, args.column);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Code completion element failed: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleUsageReferenceSnippets(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            // Note: `args.references` (the input list) is not capped here - it is
            // the caller's choice/responsibility (e.g. it may come straight from
            // usageReferences). Only the OUTPUT (snippets, which can multiply the
            // size further) is paged/shrunk below.
            const result = await this.adtclient.usageReferenceSnippets(args.references);
            this.trackRequest(startTime, true);

            const requestedPaging = args.startIndex !== undefined || args.maxItems !== undefined;

            if (!requestedPaging) {
                const text = JSON.stringify({ status: 'success', result });
                if (text.length <= SAFE_OUTPUT_CHARS) {
                    return { content: [{ type: 'text', text }] };
                }
            }

            const totalItems = result.length;
            const startIndex = Math.max(0, Number(args.startIndex) || 0);
            const initialMaxItems = args.maxItems !== undefined
                ? Math.max(0, Number(args.maxItems))
                : totalItems - startIndex;

            const text = shrinkToFit(initialMaxItems, (count, capped) => {
                const endIndex = Math.min(startIndex + count, totalItems);
                const payload: any = {
                    status: 'success',
                    result: result.slice(startIndex, endIndex),
                    totalItems,
                    startIndex,
                    returnedItems: Math.max(0, endIndex - startIndex),
                    hasMore: endIndex < totalItems
                };
                if (!requestedPaging) {
                    payload.autoPaged = true;
                }
                if (capped) {
                    payload.capped = true;
                    payload.note = 'Requested/default range exceeded the safe response size and was shrunk to fit. Pass a smaller maxItems (or a later startIndex) to continue.';
                }
                return payload;
            });

            return { content: [{ type: 'text', text }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Usage reference snippets failed: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleFixProposals(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.fixProposals(args.url, args.source, args.line, args.column);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Fix proposals failed: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleFixEdits(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.fixEdits(args.proposal, args.source);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Fix edits failed: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleFragmentMappings(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.fragmentMappings(args.url, args.type, args.name);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Fragment mappings failed: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleAbapDocumentation(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            let { objectUri, body, line, column } = args;
            const keyword = args.keyword ? String(args.keyword).trim() : undefined;
            if (keyword) {
                // Any source context works for keyword help; the statement itself is the body.
                objectUri = objectUri || '/sap/bc/adt/oo/classes/cl_abap_char_utilities/source/main';
                body = /\.\s*$/.test(keyword) ? keyword : `${keyword}.`;
                line = 1; column = 1;
            } else {
                if (!objectUri) throw new McpError(ErrorCode.InvalidParams, 'Pass keyword (e.g. "SELECT SINGLE") or objectUri with line and column');
                if (line === undefined || column === undefined) throw new McpError(ErrorCode.InvalidParams, 'Cursor mode needs line and column (1-based); or pass keyword instead');
                if (!body) {
                    const url = /\/source\/main\/?$/i.test(objectUri) || /\/includes\//i.test(objectUri) ? objectUri : `${objectUri.replace(/\/$/, '')}/source/main`;
                    body = sourceCache.get(this.adtclient, url) ?? await this.adtclient.getObjectSource(url);
                }
            }
            const html = await this.adtclient.abapDocumentation(objectUri, body, Number(line), Number(column), args.language);
            this.trackRequest(startTime, true);
            const title = (String(html).match(/<title>([^<]*)<\/title>/i)?.[1] || '').replace(/\s*\|\s*ABAP Keyword Documentation/i, '').trim();
            const fullText = args.raw === true ? String(html) : stripAbapDocChrome(htmlToText(String(html)));
            const lines = fullText.split('\n');
            const totalLines = lines.length;
            const startLine = Math.max(1, Number(args.startLine) || 1);
            const startIndex = startLine - 1;
            const initialMax = args.maxLines !== undefined ? Math.max(0, Number(args.maxLines)) : totalLines - startIndex;
            const text = shrinkToFit(initialMax, (count, capped) => {
                const endIndex = Math.min(startIndex + count, totalLines);
                const payload: any = { status: 'success', title: title || undefined, keyword, text: lines.slice(startIndex, endIndex).join('\n'), totalLines, startLine, returnedLines: Math.max(0, endIndex - startIndex), hasMore: endIndex < totalLines };
                if (capped) payload.capped = true;
                return payload;
            });
            return { content: [{ type: 'text', text }] };
        } catch (error: any) {
            if (error instanceof McpError) throw error;
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `ABAP documentation failed: ${this.formatAdtError(error)}`
            );
        }
    }
}
