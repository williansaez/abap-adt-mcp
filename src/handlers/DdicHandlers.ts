import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { ADTClient, PackageValueHelpType, session_types } from 'abap-adt-api';
import { SAFE_OUTPUT_CHARS, shrinkToFit, hardTruncateJson } from '../lib/responseSizing.js';

export class DdicHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'annotationDefinitions',
                description: 'Retrieves the CDS annotation catalog for the system. This can be large; use startIndex/maxItems to page through it instead of retrieving it all at once.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        startIndex: {
                            type: 'number',
                            description: '0-based index of the first entry to return (default 0). Only applies when the result contains a pageable list. Use with maxItems to page through a large catalog.',
                            optional: true
                        },
                        maxItems: {
                            type: 'number',
                            description: 'Maximum number of entries to return from startIndex. Omit to return the rest.',
                            optional: true
                        }
                    }
                }
            },
            {
                name: 'ddicElement',
                description: 'Retrieves information about a DDIC element. For complex objects the child element list (fields/associations/secondary objects) can be large; use startIndex/maxItems to page through it instead of retrieving it all at once.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'The path to the DDIC element.'
                        },
                        getTargetForAssociation: {
                            type: 'boolean',
                            description: 'Whether to get the target for association.',
                            optional: true
                        },
                        getExtensionViews: {
                            type: 'boolean',
                            description: 'Whether to get extension views.',
                            optional: true
                        },
                        getSecondaryObjects: {
                            type: 'boolean',
                            description: 'Whether to get secondary objects.',
                            optional: true
                        },
                        startIndex: {
                            type: 'number',
                            description: '0-based index of the first child element to return (default 0). Use with maxItems to page through a large children list.',
                            optional: true
                        },
                        maxItems: {
                            type: 'number',
                            description: 'Maximum number of child elements to return from startIndex. Omit to return the rest.',
                            optional: true
                        }
                    },
                    required: ['path']
                }
            },
            {
                name: 'ddicRepositoryAccess',
                description: 'Accesses the DDIC repository. This can return a large list of object references; use startIndex/maxItems to page through it instead of retrieving it all at once.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'The path to the DDIC element.'
                        },
                        startIndex: {
                            type: 'number',
                            description: '0-based index of the first reference to return (default 0). Use with maxItems to page through a large result set.',
                            optional: true
                        },
                        maxItems: {
                            type: 'number',
                            description: 'Maximum number of references to return from startIndex. Omit to return the rest.',
                            optional: true
                        }
                    },
                    required: ['path']
                }
            },
            {
                name: 'packageSearchHelp',
                description: 'Performs a package search help.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        type: {
                            type: 'string',
                            description: 'The package value help type.'
                        },
                        name: {
                            type: 'string',
                            description: 'The package name.',
                            optional: true
                        },
                        startIndex: {
                            type: 'number',
                            description: '0-based index of the first result to return (default 0). Use with maxResults to page through a large result set.',
                            optional: true
                        },
                        maxResults: {
                            type: 'number',
                            description: 'Maximum number of results to return from startIndex. Omit to return the rest (still subject to the safe response size backstop).',
                            optional: true
                        }
                    },
                    required: ['type']
                }
            },
            {
                name: 'getDomainProperties',
                description: 'Read a DDIC domain: data type, length, decimals, output settings and fixed values / value table. Pass the domain URL (/sap/bc/adt/ddic/domains/zdom) and optionally version=inactive.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        domainUrl: { type: 'string', description: 'Domain URL, e.g. /sap/bc/adt/ddic/domains/zmy_domain' },
                        version: { type: 'string', enum: ['active', 'inactive', 'workingArea'], description: 'Object version (default active)', optional: true }
                    },
                    required: ['domainUrl']
                }
            },
            {
                name: 'setDomainProperties',
                description: 'Write a DDIC domain (type, length, fixed values, value table…). Read it first with getDomainProperties, modify the returned properties/metaData objects and pass them back as JSON. Requires lock (lockHandle) and a transport for transportable packages; activate afterwards with activateByName.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        domainUrl: { type: 'string', description: 'Domain URL' },
                        properties: { type: 'string', description: 'JSON object: the "properties" returned by getDomainProperties, modified as needed' },
                        metaData: { type: 'string', description: 'JSON object: the "metaData" returned by getDomainProperties (description, package, responsible…)' },
                        lockHandle: { type: 'string', description: 'Lock handle from the lock tool' },
                        transport: { type: 'string', description: 'Transport request for transportable packages', optional: true }
                    },
                    required: ['domainUrl', 'properties', 'metaData', 'lockHandle']
                }
            },
            {
                name: 'getDataElementProperties',
                description: 'Read a DDIC data element: type (domain or built-in), length, field labels (short/medium/long/heading), search help and flags. Pass the data element URL (/sap/bc/adt/ddic/dataelements/zde).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        dataElementUrl: { type: 'string', description: 'Data element URL, e.g. /sap/bc/adt/ddic/dataelements/zmy_element' },
                        version: { type: 'string', enum: ['active', 'inactive', 'workingArea'], description: 'Object version (default active)', optional: true }
                    },
                    required: ['dataElementUrl']
                }
            },
            {
                name: 'setDataElementProperties',
                description: 'Write a DDIC data element (type, field labels, search help…). Read it first with getDataElementProperties, modify the returned properties/metaData objects and pass them back as JSON. Requires lock (lockHandle) and a transport for transportable packages; activate afterwards with activateByName.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        dataElementUrl: { type: 'string', description: 'Data element URL' },
                        properties: { type: 'string', description: 'JSON object: the "properties" returned by getDataElementProperties, modified as needed' },
                        metaData: { type: 'string', description: 'JSON object: the "metaData" returned by getDataElementProperties' },
                        lockHandle: { type: 'string', description: 'Lock handle from the lock tool' },
                        transport: { type: 'string', description: 'Transport request for transportable packages', optional: true }
                    },
                    required: ['dataElementUrl', 'properties', 'metaData', 'lockHandle']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'annotationDefinitions':
                return this.handleAnnotationDefinitions(args);
            case 'ddicElement':
                return this.handleDdicElement(args);
            case 'ddicRepositoryAccess':
                return this.handleDdicRepositoryAccess(args);
            case 'packageSearchHelp':
                return this.handlePackageSearchHelp(args);
            case 'getDomainProperties':
                return this.handleGetDomainProperties(args);
            case 'setDomainProperties':
                return this.handleSetDomainProperties(args);
            case 'getDataElementProperties':
                return this.handleGetDataElementProperties(args);
            case 'setDataElementProperties':
                return this.handleSetDataElementProperties(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown DDIC tool: ${toolName}`);
        }
    }

    async handleAnnotationDefinitions(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            // The library types this as Promise<string>, but the underlying XML
            // is parsed to an object before being returned, so the actual shape
            // observed at runtime can be a nested object (or array) rather than a
            // literal string. Handle defensively: page over a top-level array if
            // one is found, otherwise fall back to a hard character truncation.
            const result: any = await this.adtclient.annotationDefinitions();
            this.trackRequest(startTime, true);

            const requestedPaging = args.startIndex !== undefined || args.maxItems !== undefined;

            if (!requestedPaging) {
                const text = JSON.stringify({ status: 'success', result });
                if (text.length <= SAFE_OUTPUT_CHARS) {
                    return { content: [{ type: 'text', text }] };
                }
            }

            const arrayField: string | undefined = Array.isArray(result)
                ? undefined
                : (result && typeof result === 'object'
                    ? Object.keys(result).find(k => Array.isArray(result[k]))
                    : undefined);
            const items: any[] | undefined = Array.isArray(result)
                ? result
                : (arrayField ? result[arrayField] : undefined);

            if (!items) {
                // No pageable list found (e.g. a plain string/object) - last
                // resort hard character cut.
                const text = hardTruncateJson({ status: 'success', result });
                return { content: [{ type: 'text', text }] };
            }

            const totalItems = items.length;
            const startIndex = Math.max(0, Number(args.startIndex) || 0);
            const initialMaxItems = args.maxItems !== undefined
                ? Math.max(0, Number(args.maxItems))
                : totalItems - startIndex;

            const text = shrinkToFit(initialMaxItems, (count, capped) => {
                const endIndex = Math.min(startIndex + count, totalItems);
                const pagedItems = items.slice(startIndex, endIndex);
                const pagedResult = Array.isArray(result) ? pagedItems : { ...result, [arrayField as string]: pagedItems };
                const payload: any = {
                    status: 'success',
                    result: pagedResult,
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
                `Failed to get annotation definitions: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleDdicElement(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.ddicElement(
                args.path,
                args.getTargetForAssociation,
                args.getExtensionViews,
                args.getSecondaryObjects
            );
            this.trackRequest(startTime, true);

            const requestedPaging = args.startIndex !== undefined || args.maxItems !== undefined;

            if (!requestedPaging) {
                const text = JSON.stringify({ status: 'success', result });
                if (text.length <= SAFE_OUTPUT_CHARS) {
                    return { content: [{ type: 'text', text }] };
                }
            }

            // `children` is the top-level array that scales with object
            // complexity (fields/associations/secondary objects merged in by
            // getTargetForAssociation/getExtensionViews/getSecondaryObjects).
            const allChildren: any[] = Array.isArray(result?.children) ? result.children : [];
            const totalItems = allChildren.length;
            const startIndex = Math.max(0, Number(args.startIndex) || 0);
            const initialMaxItems = args.maxItems !== undefined
                ? Math.max(0, Number(args.maxItems))
                : totalItems - startIndex;

            let text = shrinkToFit(initialMaxItems, (count, capped) => {
                const endIndex = Math.min(startIndex + count, totalItems);
                const payload: any = {
                    status: 'success',
                    result: { ...result, children: allChildren.slice(startIndex, endIndex) },
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

            // Defense-in-depth: if even a single child (or the element itself
            // with no children) is too large to fit, fall back to a hard
            // character cut instead of returning an oversized payload.
            if (text.length > SAFE_OUTPUT_CHARS) {
                text = hardTruncateJson({ status: 'success', result });
            }

            return { content: [{ type: 'text', text }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get DDIC element: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleDdicRepositoryAccess(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.ddicRepositoryAccess(args.path);
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
                `Failed to access DDIC repository: ${this.formatAdtError(error)}`
            );
        }
    }

    async handlePackageSearchHelp(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            // this.adtclient.packageSearchHelp() has no max/limit parameter in
            // the underlying library, so maxResults/startIndex are applied
            // client-side here; shrinkToFit is still applied unconditionally as
            // a hard backstop regardless of whether paging args were given.
            const result = await this.adtclient.packageSearchHelp(args.type, args.name);
            this.trackRequest(startTime, true);

            const requestedPaging = args.startIndex !== undefined || args.maxResults !== undefined;

            if (!requestedPaging) {
                const text = JSON.stringify({ status: 'success', result });
                if (text.length <= SAFE_OUTPUT_CHARS) {
                    return { content: [{ type: 'text', text }] };
                }
            }

            const totalItems = result.length;
            const startIndex = Math.max(0, Number(args.startIndex) || 0);
            const initialMaxItems = args.maxResults !== undefined
                ? Math.max(0, Number(args.maxResults))
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
                    payload.note = 'Requested/default range exceeded the safe response size and was shrunk to fit. Pass a smaller maxResults (or a later startIndex) to continue.';
                }
                return payload;
            });

            return { content: [{ type: 'text', text }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get package search help: ${this.formatAdtError(error)}`
            );
        }
    }

    private parseJsonArg<T>(value: unknown, name: string): T {
        if (value && typeof value === 'object') return value as T;
        try {
            return JSON.parse(String(value)) as T;
        } catch {
            throw new McpError(ErrorCode.InvalidParams, `Parameter '${name}' must be a JSON object`);
        }
    }

    async handleGetDomainProperties(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.getDomainProperties(args.domainUrl, args.version);
            this.trackRequest(startTime, true);
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', ...result }) }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(ErrorCode.InternalError, `Failed to get domain properties: ${this.formatAdtError(error)}`);
        }
    }

    async handleSetDomainProperties(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const properties = this.parseJsonArg<any>(args.properties, 'properties');
            const metaData = this.parseJsonArg<any>(args.metaData, 'metaData');
            this.adtclient.stateful = session_types.stateful;
            await this.adtclient.setDomainProperties(args.domainUrl, properties, metaData, args.lockHandle, args.transport);
            this.trackRequest(startTime, true);
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', updated: true, next: 'activateByName' }) }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(ErrorCode.InternalError, `Failed to set domain properties: ${this.formatAdtError(error)}`);
        }
    }

    async handleGetDataElementProperties(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.getDataElementProperties(args.dataElementUrl, args.version);
            this.trackRequest(startTime, true);
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', ...result }) }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(ErrorCode.InternalError, `Failed to get data element properties: ${this.formatAdtError(error)}`);
        }
    }

    async handleSetDataElementProperties(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const properties = this.parseJsonArg<any>(args.properties, 'properties');
            const metaData = this.parseJsonArg<any>(args.metaData, 'metaData');
            this.adtclient.stateful = session_types.stateful;
            await this.adtclient.setDataElementProperties(args.dataElementUrl, properties, metaData, args.lockHandle, args.transport);
            this.trackRequest(startTime, true);
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', updated: true, next: 'activateByName' }) }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(ErrorCode.InternalError, `Failed to set data element properties: ${this.formatAdtError(error)}`);
        }
    }
}
