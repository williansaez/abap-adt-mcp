import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { ADTClient, Range, ExtractMethodProposal, GenericRefactoring, session_types } from 'abap-adt-api';
type ChangePackageRefactoring = Parameters<ADTClient['changePackageExecute']>[0];

export class RefactorHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'extractMethodEvaluate',
                description: 'Evaluates an extract method refactoring.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uri: {
                            type: 'string',
                            description: 'The URI of the object.'
                        },
                        range: {
                            type: 'string',
                            description: 'The range to extract, as a JSON string, e.g. {"start":{"line":1,"column":0},"end":{"line":5,"column":10}}'
                        }
                    },
                    required: ['uri', 'range']
                }
            },
            {
                name: 'extractMethodPreview',
                description: 'Previews an extract method refactoring.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        proposal: {
                            type: 'string',
                            description: 'The extract method proposal returned by extractMethodEvaluate, as a JSON string.'
                        }
                    },
                    required: ['proposal']
                }
            },
            {
                name: 'extractMethodExecute',
                description: 'Executes an extract method refactoring.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        refactoring: {
                            type: 'string',
                            description: 'The refactoring returned by extractMethodPreview, as a JSON string.'
                        }
                    },
                    required: ['refactoring']
                }
            },
            {
                name: 'changePackagePreview',
                description: 'Preview moving an object to another package (change package refactoring). Returns the refactoring proposal with affected objects; pass it unchanged to changePackageExecute. Needs a transport when the target package is transportable.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objectUrl: { type: 'string', description: 'URL of the object to move, e.g. /sap/bc/adt/oo/classes/zcl_demo' },
                        oldPackage: { type: 'string', description: 'Current package name' },
                        newPackage: { type: 'string', description: 'Target package name' },
                        transport: { type: 'string', description: 'Transport request (required for transportable target packages)', optional: true }
                    },
                    required: ['objectUrl', 'oldPackage', 'newPackage']
                }
            },
            {
                name: 'changePackageExecute',
                description: 'Execute a change package refactoring previewed with changePackagePreview. Pass the refactoring returned by the preview as JSON.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        refactoring: { type: 'string', description: 'The refactoring object returned by changePackagePreview, as JSON' }
                    },
                    required: ['refactoring']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'extractMethodEvaluate':
                return this.handleExtractMethodEvaluate(args);
            case 'extractMethodPreview':
                return this.handleExtractMethodPreview(args);
            case 'extractMethodExecute':
                return this.handleExtractMethodExecute(args);
            case 'changePackagePreview':
                return this.handleChangePackagePreview(args);
            case 'changePackageExecute':
                return this.handleChangePackageExecute(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown refactor tool: ${toolName}`);
        }
    }

    // Schemas declare these params as JSON strings, but the abap-adt-api methods
    // expect deserialized objects; also accept plain objects for forward compatibility
    private parseObjectArg<T>(value: unknown, name: string): T {
        if (typeof value !== 'string') return value as T;
        try {
            return JSON.parse(value) as T;
        } catch {
            throw new McpError(ErrorCode.InvalidParams, `Parameter '${name}' is not valid JSON`);
        }
    }

    async handleExtractMethodEvaluate(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const range = this.parseObjectArg<Range>(args.range, 'range');
            // The evaluation misbehaves in the stateful session ("No selection
            // supplied") while the identical request succeeds stateless; retry
            // once with the session temporarily switched to stateless.
            // (statelessClone cannot be used: it does not inherit the SSO
            // cookie authentication and fails with "Not logged in".)
            let result;
            try {
                result = await this.adtclient.extractMethodEvaluate(args.uri, range);
            } catch (firstErr: any) {
                if (!/no selection/i.test(firstErr?.message || '')) throw firstErr;
                const prev = this.adtclient.stateful;
                this.adtclient.stateful = session_types.stateless;
                try {
                    result = await this.adtclient.extractMethodEvaluate(args.uri, range);
                } finally {
                    this.adtclient.stateful = prev;
                }
            }
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
                `Failed to evaluate extract method: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleExtractMethodPreview(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const proposal = this.parseObjectArg<ExtractMethodProposal>(args.proposal, 'proposal');
            const result = await this.adtclient.extractMethodPreview(proposal);
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
                `Failed to preview extract method: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleExtractMethodExecute(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const refactoring = this.parseObjectArg<GenericRefactoring>(args.refactoring, 'refactoring');
            const result = await this.adtclient.extractMethodExecute(refactoring);
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
                `Failed to execute extract method: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleChangePackagePreview(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const proposal: any = {
                oldPackage: args.oldPackage,
                newPackage: args.newPackage,
                transport: args.transport || '',
                adtObjectUri: args.objectUrl,
                ignoreSyntaxErrorsAllowed: false,
                ignoreSyntaxErrors: false,
                userContent: '',
                affectedObjects: undefined
            };
            const result = await this.adtclient.changePackagePreview(proposal as ChangePackageRefactoring, args.transport);
            this.trackRequest(startTime, true);
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', refactoring: result, next: 'changePackageExecute' }) }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(ErrorCode.InternalError, `Failed to preview change package: ${this.formatAdtError(error)}`);
        }
    }

    async handleChangePackageExecute(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const refactoring = this.parseObjectArg<ChangePackageRefactoring>(args.refactoring, 'refactoring');
            this.adtclient.stateful = session_types.stateful;
            const result = await this.adtclient.changePackageExecute(refactoring);
            this.trackRequest(startTime, true);
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', result }) }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(ErrorCode.InternalError, `Failed to execute change package: ${this.formatAdtError(error)}`);
        }
    }
}
