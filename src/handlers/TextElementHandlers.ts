import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { ADTClient, session_types, TextElement, TextElementCategory } from 'abap-adt-api';
import { httpStatusOf } from '../lib/adtErrorHints.js';

/** Text symbols, selection texts and list headings of programs, classes and function groups. */
export class TextElementHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'getTextElements',
                description: 'Read the text elements of an object: text symbols (TEXT-001), selection texts or list headings. Pass the object URL (e.g. /sap/bc/adt/programs/programs/zreport or /sap/bc/adt/oo/classes/zcl_demo).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objectUrl: { type: 'string', description: 'Object URL of the program, class or function group' },
                        category: { type: 'string', enum: ['symbols', 'selections', 'headings'], description: 'Text element category (default symbols)', optional: true }
                    },
                    required: ['objectUrl']
                }
            },
            {
                name: 'setTextElements',
                description: 'Write text elements (text symbols, selection texts or list headings) of a locked object. Pass the full list for the category: elements missing from the list are removed. Requires lock (lockHandle) and, for transportable packages, a transport. Not available on SAP_BASIS 7.40 and older (no text element resources in ADT).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objectUrl: { type: 'string', description: 'Object URL of the program, class or function group' },
                        category: { type: 'string', enum: ['symbols', 'selections', 'headings'], description: 'Text element category' },
                        elements: { type: 'string', description: 'JSON array of {id, text, maxLength?} entries, e.g. [{"id":"001","text":"Hello","maxLength":40}]' },
                        lockHandle: { type: 'string', description: 'Lock handle from the lock tool' },
                        transport: { type: 'string', description: 'Transport request for transportable packages', optional: true }
                    },
                    required: ['objectUrl', 'category', 'elements', 'lockHandle']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'getTextElements':
                return this.handleGet(args);
            case 'setTextElements':
                return this.handleSet(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown text element tool: ${toolName}`);
        }
    }

    async handleGet(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const category = (args.category || 'symbols') as TextElementCategory;
            const url = textElementsBaseUrl(args.objectUrl);
            // abap-adt-api answers a 404 with an empty list; probe first so the
            // caller learns when SAP has no such resource instead of reading "no texts".
            try {
                await this.adtclient.httpClient.request(`${url}/source/${category}`, { headers: { Accept: `application/vnd.sap.adt.textelements.${category}.v1` } });
            } catch (probe: any) {
                if (httpStatusOf(probe) !== 404) throw probe;
                this.trackRequest(startTime, true);
                return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', category, textElements: [], url, note: `SAP answered 404 for ${url}/source/${category}: the object has no ${category} yet, or this system has no text element resources in ADT (SAP_BASIS 7.40 and older: maintain them in SAP GUI, Goto > Text Elements).` }) }] };
            }
            const result = await this.adtclient.getTextElements(url, category);
            this.trackRequest(startTime, true);
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', category, ...result, url }) }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw this.adtFailure(`Failed to get text elements`, error);
        }
    }

    async handleSet(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            let elements: TextElement[];
            if (Array.isArray(args.elements)) {
                elements = args.elements;
            } else {
                try {
                    elements = JSON.parse(String(args.elements));
                } catch {
                    throw new McpError(ErrorCode.InvalidParams, 'elements must be a JSON array of {id, text}');
                }
            }
            if (!Array.isArray(elements) || elements.some(e => !e || typeof e.id !== 'string' || typeof e.text !== 'string')) {
                throw new McpError(ErrorCode.InvalidParams, 'elements must be an array of {id: string, text: string}');
            }
            const url = textElementsBaseUrl(args.objectUrl);
            this.adtclient.stateful = session_types.stateful;
            try {
                await this.adtclient.setTextElements(url, args.category as TextElementCategory, elements, args.lockHandle, args.transport);
            } catch (error: any) {
                if (httpStatusOf(error) === 404) {
                    throw new McpError(ErrorCode.InvalidRequest, `Text elements are not available here: SAP answered 404 for ${url}/source/${args.category}. SAP_BASIS 7.40 and older have no text element resources in ADT; maintain them in SAP GUI (Goto > Text Elements). Nothing was written.`);
                }
                throw error;
            }
            this.trackRequest(startTime, true);
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', updated: true, category: args.category, count: elements.length, url }) }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw this.adtFailure(`Failed to set text elements`, error);
        }
    }
}

const OBJECT_TYPES: Array<[RegExp, string]> = [
    [/^\/sap\/bc\/adt\/programs\/programs\/([^/?#]+)/i, 'PROG/P'],
    [/^\/sap\/bc\/adt\/oo\/classes\/([^/?#]+)/i, 'CLAS/OC'],
    [/^\/sap\/bc\/adt\/functions\/groups\/([^/?#]+)/i, 'FUGR/F']
];

/**
 * Text elements live under /sap/bc/adt/textelements/{programs|classes|functiongroups}/<name>,
 * not under the object. abap-adt-api appends /source/<category> to whatever it is
 * given, so the object URL itself must never reach it: on SAP_BASIS 7.40 the
 * program resource serves .../source/symbols as the main source, and a write
 * there replaced the program code (live test on P03).
 */
export function textElementsBaseUrl(objectUrl: string): string {
    const url = String(objectUrl || '').trim();
    const own = url.match(/^(\/sap\/bc\/adt\/textelements\/(?:programs|classes|functiongroups)\/[^/?#]+)/i);
    if (own) return own[1].toLowerCase();
    for (const [pattern, type] of OBJECT_TYPES) {
        const m = url.match(pattern);
        if (m) return ADTClient.textElementsUrl(type, decodeURIComponent(m[1]));
    }
    throw new McpError(ErrorCode.InvalidParams, `Text elements belong to programs, classes and function groups: pass /sap/bc/adt/programs/programs/<name>, /sap/bc/adt/oo/classes/<name> or /sap/bc/adt/functions/groups/<name> (got "${url}")`);
}
