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
                description: 'Write text elements (text symbols, selection texts or list headings) of a locked object. Pass the full list for the category: elements missing from the list are removed. Requires lock (lockHandle) and, for transportable packages, a transport. Not supported on very old releases.',
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
            const result = await this.adtclient.getTextElements(args.objectUrl, category);
            this.trackRequest(startTime, true);
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', category, ...result }) }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(ErrorCode.InternalError, `Failed to get text elements: ${this.formatAdtError(error)}`);
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
            await this.adtclient.setTextElements(args.objectUrl, args.category as TextElementCategory, elements, args.lockHandle, args.transport);
            this.trackRequest(startTime, true);
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', updated: true, category: args.category, count: elements.length }) }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(ErrorCode.InternalError, `Failed to set text elements: ${this.formatAdtError(error)}`);
        }
    }
}
