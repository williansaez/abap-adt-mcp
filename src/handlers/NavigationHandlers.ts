import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { sourceCache } from '../lib/sourceCache.js';
import { SAFE_OUTPUT_CHARS, shrinkToFit } from '../lib/responseSizing.js';

/**
 * Navigation helpers that abap-adt-api already implements but were never
 * exposed as tools: type hierarchy, flat structure elements and enhancement
 * implementations of an object.
 */
export class NavigationHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'typeHierarchy',
                description: 'Type hierarchy (subtypes or supertypes) of the class/interface at a given source position. Pass the source URL (…/source/main) and the 1-based line/column of the type name; the current source is re-read from SAP unless you pass it in "source". superTypes=true lists the inheritance chain upwards, false (default) lists implementers/subclasses.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objectSourceUrl: { type: 'string', description: 'Source URL of the object, usually the object URL plus /source/main' },
                        line: { type: 'number', description: '1-based line of the type name in the source' },
                        offset: { type: 'number', description: '0-based column of the type name in that line' },
                        superTypes: { type: 'boolean', description: 'true = supertypes (upwards), false = subtypes/implementers (default)', optional: true },
                        source: { type: 'string', description: 'Optional: the source text to analyse. Omit to re-read the current source from SAP.', optional: true }
                    },
                    required: ['objectSourceUrl', 'line', 'offset']
                }
            },
            {
                name: 'objectStructureElements',
                description: 'Flat list of the members (methods, attributes, events, types, fields…) of an object with name, type, visibility and flags, cheaper than objectStructure/classComponents when you only need an outline. version=inactive reads the inactive version.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objectUrl: { type: 'string', description: 'Object URL, e.g. /sap/bc/adt/oo/classes/zcl_demo' },
                        version: { type: 'string', enum: ['active', 'inactive', 'workingArea'], description: 'Object version to read (default active)', optional: true },
                        startIndex: { type: 'number', description: '0-based index of the first element to return (default 0)', optional: true },
                        maxItems: { type: 'number', description: 'Maximum number of elements to return', optional: true }
                    },
                    required: ['objectUrl']
                }
            },
            {
                name: 'objectEnhancements',
                description: 'Enhancement implementations (implicit/explicit enhancement points, BAdI-free source enhancements) active on an ABAP source object, with optional source of each implementation. Use before editing standard-adjacent code to see what customer enhancements already hook in.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objectSourceUrl: { type: 'string', description: 'Source URL of the object (…/source/main)' },
                        contextUri: { type: 'string', description: 'Optional context URI (main program) for includes', optional: true },
                        includeSource: { type: 'boolean', description: 'Include the source of each enhancement implementation (default false)', optional: true }
                    },
                    required: ['objectSourceUrl']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'typeHierarchy':
                return this.handleTypeHierarchy(args);
            case 'objectStructureElements':
                return this.handleObjectStructureElements(args);
            case 'objectEnhancements':
                return this.handleObjectEnhancements(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown navigation tool: ${toolName}`);
        }
    }

    private ok(payload: any) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', ...payload }) }] };
    }

    async handleTypeHierarchy(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const source = typeof args.source === 'string' && args.source.length > 0
                ? args.source
                : (sourceCache.get(args.objectSourceUrl) ?? await this.adtclient.getObjectSource(args.objectSourceUrl));
            const nodes = await this.adtclient.typeHierarchy(
                args.objectSourceUrl, source, Number(args.line), Number(args.offset), args.superTypes === true
            );
            this.trackRequest(startTime, true);
            return this.ok({ direction: args.superTypes === true ? 'supertypes' : 'subtypes', count: nodes.length, hierarchy: nodes });
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(ErrorCode.InternalError, `Failed to get type hierarchy: ${this.formatAdtError(error)}`);
        }
    }

    async handleObjectStructureElements(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const elements = await this.adtclient.objectStructureElements(args.objectUrl, args.version);
            this.trackRequest(startTime, true);
            const totalItems = elements.length;
            const startIndex = Math.max(0, Number(args.startIndex) || 0);
            const initialMax = args.maxItems !== undefined ? Math.max(0, Number(args.maxItems)) : totalItems - startIndex;
            const text = shrinkToFit(initialMax, (count, capped) => {
                const endIndex = Math.min(startIndex + count, totalItems);
                const payload: any = {
                    status: 'success',
                    elements: elements.slice(startIndex, endIndex),
                    totalItems, startIndex,
                    returnedItems: Math.max(0, endIndex - startIndex),
                    hasMore: endIndex < totalItems
                };
                if (capped) payload.capped = true;
                return payload;
            });
            return { content: [{ type: 'text', text }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(ErrorCode.InternalError, `Failed to get object structure elements: ${this.formatAdtError(error)}`);
        }
    }

    async handleObjectEnhancements(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.objectEnhancements(args.objectSourceUrl, args.contextUri, args.includeSource === true);
            this.trackRequest(startTime, true);
            const text = JSON.stringify({ status: 'success', count: result.implementations.length, ...result });
            if (text.length <= SAFE_OUTPUT_CHARS) return { content: [{ type: 'text', text }] };
            const impls = result.implementations;
            const paged = shrinkToFit(impls.length, (count, capped) => ({
                status: 'success', count: impls.length, implementations: impls.slice(0, count), returnedItems: Math.min(count, impls.length), capped
            }));
            return { content: [{ type: 'text', text: paged }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(ErrorCode.InternalError, `Failed to get object enhancements: ${this.formatAdtError(error)}`);
        }
    }
}
