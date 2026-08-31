import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { ADTClient, ServiceBinding, parseServiceBinding, servicePreviewUrl } from "abap-adt-api";

export class ServiceBindingHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'publishServiceBinding',
                description: 'Publishes a service binding.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'The name of the service binding.'
                        },
                        version: {
                            type: 'string',
                            description: 'The version of the service binding.'
                        }
                    },
                    required: ['name', 'version']
                }
            },
            {
                name: 'unPublishServiceBinding',
                description: 'Unpublishes a service binding.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'The name of the service binding.'
                        },
                        version: {
                            type: 'string',
                            description: 'The version of the service binding.'
                        }
                    },
                    required: ['name', 'version']
                }
            },
            {
                name: 'fetchServiceDetails',
                description: 'Fetch the OData services of a service binding BY NAME: service URLs, entity sets, navigations and preview URLs. Resolves the binding internally, so no prior objectStructure call is needed (name-based equivalent of bindingDetails).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Name of the service binding, e.g. ZUI_TRAVEL_O4'
                        },
                        index: {
                            type: 'number',
                            description: 'Index of the service to inspect when the binding has several (default 0)',
                            optional: true
                        }
                    },
                    required: ['name']
                }
            },
            {
                name: 'bindingDetails',
                description: 'Retrieves details of a service binding from an already-parsed ServiceBinding object. If you only have the binding name, use fetchServiceDetails instead.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        binding: {
                            type: 'object',
                            description: 'The service binding.'
                        },
                        index: {
                            type: 'number',
                            description: 'The index of the service binding.',
                            optional: true
                        }
                    },
                    required: ['binding']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'publishServiceBinding':
                return this.handlePublishServiceBinding(args);
            case 'unPublishServiceBinding':
                return this.handleUnPublishServiceBinding(args);
            case 'fetchServiceDetails':
                return this.handleFetchServiceDetails(args);
            case 'bindingDetails':
                return this.handleBindingDetails(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown service binding tool: ${toolName}`);
        }
    }

    async handlePublishServiceBinding(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.publishServiceBinding(args.name, args.version);
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
                `Failed to publish service binding: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleUnPublishServiceBinding(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.unPublishServiceBinding(args.name, args.version);
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
                `Failed to unpublish service binding: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleFetchServiceDetails(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            // Resolve the binding by name via search, fetch its XML and parse it.
            const search = await this.adtclient.searchObject(args.name, 'SRVB', 5);
            const hit = (search || []).find(
                (r: any) => (r['adtcore:name'] || '').toUpperCase() === String(args.name).toUpperCase()
            ) || (search || [])[0];
            if (!hit) {
                throw new McpError(ErrorCode.InvalidParams, `Service binding '${args.name}' not found (searchObject SRVB)`);
            }
            const resp = await this.adtclient.httpClient.request(hit['adtcore:uri'], {
                headers: {
                    Accept: 'application/vnd.sap.adt.businessservices.servicebinding.v4+xml, application/vnd.sap.adt.businessservices.servicebinding.v2+xml, application/xml'
                }
            });
            const binding: ServiceBinding = parseServiceBinding(resp.body as string);
            const bindingSummary = {
                name: binding.name,
                published: binding.published,
                type: binding.binding?.type,
                version: binding.binding?.version,
                services: binding.services
            };
            // bindingDetails indexes into the binding's service queries and throws
            // when the library cannot derive them (seen with OData V4 bindings) —
            // degrade to the binding summary instead of failing the whole call.
            let details: any;
            try {
                if (!binding.services || binding.services.length === 0) {
                    throw new Error('no service entries parsed from binding');
                }
                details = await this.adtclient.bindingDetails(binding, args.index);
            } catch (detailErr: any) {
                this.trackRequest(startTime, true);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            binding: bindingSummary,
                            details: null,
                            note: `Binding resolved but service details are unavailable (${detailErr.message}); this can happen with OData V4 bindings not fully supported by abap-adt-api`
                        })
                    }]
                };
            }
            // Enrich each service's entity sets with a ready-to-open preview URL.
            const services = (details.services || []).map((service: any) => ({
                ...service,
                previewUrls: (service.serviceInformation?.collection || []).map((c: any) => ({
                    collection: c.name,
                    url: servicePreviewUrl(service, c.name)
                }))
            }));
            this.trackRequest(startTime, true);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        status: 'success',
                        binding: bindingSummary,
                        details: { ...details, services }
                    })
                }]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to fetch service details: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleBindingDetails(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            // bindingDetails needs a parsed ServiceBinding; resolve a plain
            // binding name the same way fetchServiceDetails does.
            let binding = args.binding;
            if (typeof binding === 'string') {
                const search = await this.adtclient.searchObject(binding, 'SRVB', 5);
                const hit = (search || []).find(
                    (r: any) => (r['adtcore:name'] || '').toUpperCase() === String(binding).toUpperCase()
                ) || (search || [])[0];
                if (!hit) {
                    throw new McpError(ErrorCode.InvalidParams, `Service binding '${binding}' not found (searchObject SRVB)`);
                }
                const resp = await this.adtclient.httpClient.request(hit['adtcore:uri'], {
                    headers: {
                        Accept: 'application/vnd.sap.adt.businessservices.servicebinding.v4+xml, application/vnd.sap.adt.businessservices.servicebinding.v2+xml, application/xml'
                    }
                });
                binding = parseServiceBinding(resp.body as string);
            }
            let details: any = null;
            let note: string | undefined;
            try {
                details = await this.adtclient.bindingDetails(binding, args.index);
            } catch (detailErr: any) {
                // abap-adt-api cannot derive service queries for some bindings
                // (seen with OData V4): degrade to the binding summary.
                note = `Binding resolved but service details are unavailable (${detailErr.message}); this can happen with OData V4 bindings not fully supported by abap-adt-api`;
            }
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            binding: typeof args.binding === 'string' ? {
                                name: (binding as any).name,
                                published: (binding as any).published,
                                type: (binding as any).binding?.type,
                                version: (binding as any).binding?.version,
                                services: (binding as any).services
                            } : undefined,
                            details,
                            ...(note ? { note } : {})
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get binding details: ${error.message || 'Unknown error'}`
            );
        }
    }
}
