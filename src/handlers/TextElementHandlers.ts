import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { session_types, TextElement, TextElementCategory } from 'abap-adt-api';

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
                description: 'Write text elements (text symbols, selection texts or list headings) of a locked object. Pass the full list for the category: elements missing from the list are removed. Requires lock (lockHandle) and, for transportable packages, a transport. Not available on SAP_BASIS 7.40 and older: the tool refuses there instead of writing.',
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
            await this.assertTextElementsServed(args.objectUrl, category);
            const result = await this.adtclient.getTextElements(args.objectUrl, category);
            this.trackRequest(startTime, true);
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', category, ...result }) }] };
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
            this.adtclient.stateful = session_types.stateful;
            await this.assertTextElementsServed(args.objectUrl, args.category as TextElementCategory);
            await this.adtclient.setTextElements(args.objectUrl, args.category as TextElementCategory, elements, args.lockHandle, args.transport);
            this.trackRequest(startTime, true);
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', updated: true, category: args.category, count: elements.length }) }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw this.adtFailure(`Failed to set text elements`, error);
        }
    }

    /**
     * SAP_BASIS 7.40 has no text element resources: it serves .../source/symbols
     * (and selections, headings) as the main source, and a PUT there replaces the
     * program code with the text lines. A category resource that answers exactly
     * the main source is how that release shows up, so the call stops before
     * reading ABAP code as text elements or overwriting it.
     */
    private async assertTextElementsServed(objectUrl: string, category: TextElementCategory): Promise<void> {
        const base = String(objectUrl || '').replace(/\/source\/[^/]*$/, '').replace(/\/+$/, '');
        const normalize = (body: unknown) => String(body ?? '').replace(/\r\n/g, '\n').trimEnd();
        let main: string;
        let part: string;
        try {
            main = normalize((await this.adtclient.httpClient.request(`${base}/source/main`, { headers: { Accept: 'text/plain' } })).body);
            part = normalize((await this.adtclient.httpClient.request(`${base}/source/${category}`, { headers: { Accept: `application/vnd.sap.adt.textelements.${category}.v1` } })).body);
        } catch {
            // No main source or no text elements yet: nothing to compare, the
            // regular call reports what the system answers.
            return;
        }
        if (main && main === part) {
            throw new McpError(ErrorCode.InvalidRequest, `Text elements are not available on this system: ${base}/source/${category} answers the main source of the object (SAP_BASIS 7.40 and older have no text element resources in ADT). Nothing was read or written; maintain the text elements in SE38/SE24 (Goto > Text Elements).`);
        }
    }
}
