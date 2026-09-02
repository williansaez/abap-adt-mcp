import { ADTClient } from 'abap-adt-api';
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { AtcProposal } from 'abap-adt-api';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export class AtcHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'atcCustomizing',
                description: 'Retrieves ATC customizing information.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'atcQuickfixProposals',
                description: 'List the quickfix proposals available at an ATC finding location. Pass the source URL and position from an atcWorklists finding. Apply a proposal with atcApplyQuickfix. Read-only.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objectSourceUrl: {
                            type: 'string',
                            description: 'Source URL of the object with the finding, usually the object URL plus /source/main'
                        },
                        line: { type: 'number', description: 'Line of the finding (1-based)' },
                        column: { type: 'number', description: 'Column of the finding (0-based, as reported by ADT)' }
                    },
                    required: ['objectSourceUrl', 'line', 'column']
                }
            },
            {
                name: 'atcApplyQuickfix',
                description: 'Apply a deterministic quickfix at an ATC finding location: recomputes the proposals (see atcQuickfixProposals), applies the chosen one to the source and writes it back with setObjectSource. Requires the object to be locked (lock returns the lockHandle). Activate afterwards with activateByName and re-run ATC to confirm the finding is gone.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objectSourceUrl: {
                            type: 'string',
                            description: 'Source URL of the object with the finding (object URL plus /source/main)'
                        },
                        line: { type: 'number', description: 'Line of the finding (1-based)' },
                        column: { type: 'number', description: 'Column of the finding (0-based)' },
                        proposalIndex: {
                            type: 'number',
                            description: 'Index of the proposal to apply, from atcQuickfixProposals (default 0)'
                        },
                        lockHandle: { type: 'string', description: 'Lock handle from lock' },
                        transport: { type: 'string', description: 'Transport number for transportable packages', optional: true }
                    },
                    required: ['objectSourceUrl', 'line', 'column', 'lockHandle']
                }
            },
            {
                name: 'atcCheckVariant',
                description: 'Retrieves information about an ATC check variant.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        variant: {
                            type: 'string',
                            description: 'The name of the ATC check variant.'
                        }
                    },
                    required: ['variant']
                }
            },
            {
                name: 'createAtcRun',
                description: 'Creates an ATC run. Flow: atcCustomizing (system check variant name) -> atcCheckVariant (returns a worklistId) -> createAtcRun -> atcWorklists (findings). Passing a check variant NAME here also works: it is resolved to a worklistId via atcCheckVariant automatically.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        variant: {
                            type: 'string',
                            description: 'Worklist id returned by atcCheckVariant (32-char hex). A check variant name (e.g. ABAP_CLOUD_DEVELOPMENT_DEFAULT) is accepted and resolved automatically.'
                        },
                        mainUrl: {
                            type: 'string',
                            description: 'The main URL for the ATC run.'
                        },
                        maxResults: {
                            type: 'number',
                            description: 'The maximum number of results to retrieve.',
                            optional: true
                        }
                    },
                    required: ['variant', 'mainUrl']
                }
            },
            {
                name: 'atcWorklists',
                description: 'Retrieves ATC worklists.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        runResultId: {
                            type: 'string',
                            description: 'The ID of the ATC run result.'
                        },
                        timestamp: {
                            type: 'number',
                            description: 'The timestamp.',
                            optional: true
                        },
                        usedObjectSet: {
                            type: 'string',
                            description: 'The used object set.',
                            optional: true
                        },
                        includeExempted: {
                            type: 'boolean',
                            description: 'Whether to include exempted findings.',
                            optional: true
                        }
                    },
                    required: ['runResultId']
                }
            },
            {
                name: 'atcUsers',
                description: 'Retrieves a list of ATC users.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'atcExemptProposal',
                description: 'Retrieves an ATC exemption proposal.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        markerId: {
                            type: 'string',
                            description: 'The ID of the marker.'
                        }
                    },
                    required: ['markerId']
                }
            },
            {
                name: 'atcRequestExemption',
                description: 'Requests an ATC exemption.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        proposal: {
                            type: 'object',
                            description: 'The ATC exemption proposal.'
                        }
                    },
                    required: ['proposal']
                }
            },
            {
                name: 'isProposalMessage',
                description: 'Checks if a given object is a proposal message.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        proposal: {
                            type: 'object',
                            description: 'The ATC exemption proposal.'
                        }
                    },
                    required: ['proposal']
                }
            },
            {
                name: 'atcContactUri',
                description: 'Retrieves the contact URI for an ATC finding.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        findingUri: {
                            type: 'string',
                            description: 'The URI of the ATC finding.'
                        }
                    },
                    required: ['findingUri']
                }
            },
            {
                name: 'atcChangeContact',
                description: 'Changes the contact for an ATC finding.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        itemUri: {
                            type: 'string',
                            description: 'The URI of the item.'
                        },
                        userId: {
                            type: 'string',
                            description: 'The ID of the user.'
                        }
                    },
                    required: ['itemUri', 'userId']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'atcQuickfixProposals':
                return this.handleAtcQuickfixProposals(args);
            case 'atcApplyQuickfix':
                return this.handleAtcApplyQuickfix(args);
            case 'atcCustomizing':
                return this.handleAtcCustomizing(args);
            case 'atcCheckVariant':
                return this.handleAtcCheckVariant(args);
            case 'createAtcRun':
                return this.handleCreateAtcRun(args);
            case 'atcWorklists':
                return this.handleAtcWorklists(args);
            case 'atcUsers':
                return this.handleAtcUsers(args);
            case 'atcExemptProposal':
                return this.handleAtcExemptProposal(args);
            case 'atcRequestExemption':
                return this.handleAtcRequestExemption(args);
            case 'isProposalMessage':
                return this.handleIsProposalMessage(args);
            case 'atcContactUri':
                return this.handleAtcContactUri(args);
            case 'atcChangeContact':
                return this.handleAtcChangeContact(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown ATC tool: ${toolName}`);
        }
    }

    async handleAtcQuickfixProposals(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const source = await this.adtclient.getObjectSource(args.objectSourceUrl);
            const proposals = await this.adtclient.fixProposals(args.objectSourceUrl, source, args.line, args.column);
            this.trackRequest(startTime, true);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        status: 'success',
                        proposals: (proposals || []).map((p: any, index: number) => ({
                            index,
                            name: p['adtcore:name'],
                            description: p['adtcore:description'],
                            type: p['adtcore:type']
                        }))
                    })
                }]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get quickfix proposals: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleAtcApplyQuickfix(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const source = await this.adtclient.getObjectSource(args.objectSourceUrl);
            const proposals = await this.adtclient.fixProposals(args.objectSourceUrl, source, args.line, args.column);
            const index = args.proposalIndex ?? 0;
            const proposal = (proposals || [])[index];
            if (!proposal) {
                throw new McpError(
                    ErrorCode.InvalidParams,
                    `No quickfix proposal at index ${index} (found ${proposals?.length || 0}); list them with atcQuickfixProposals`
                );
            }
            const deltas = await this.adtclient.fixEdits(proposal, source);
            if (!deltas || deltas.length === 0) {
                throw new McpError(ErrorCode.InternalError, 'Quickfix produced no edits');
            }
            // Only apply edits that target the source we fetched; report the rest.
            const applicable = deltas.filter((d: any) => args.objectSourceUrl.includes(d.uri) || d.uri.includes(args.objectSourceUrl.replace(/\/source\/main.*$/, '')));
            const foreign = deltas.filter((d: any) => !applicable.includes(d));
            if (applicable.length === 0) {
                throw new McpError(
                    ErrorCode.InternalError,
                    `Quickfix edits target other objects (${deltas.map((d: any) => d.uri).join(', ')}); apply them manually with setObjectSource`
                );
            }
            const newSource = AtcHandlers.applyDeltas(source, applicable);
            await this.adtclient.setObjectSource(args.objectSourceUrl, newSource, args.lockHandle, args.transport);
            this.trackRequest(startTime, true);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        status: 'success',
                        applied: { name: proposal['adtcore:name'], description: proposal['adtcore:description'] },
                        editsApplied: applicable.length,
                        editsSkipped: foreign.map((d: any) => ({ uri: d.uri, content: d.content })),
                        message: 'Source updated. Activate with activateByName and re-run ATC to confirm.'
                    })
                }]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to apply quickfix: ${this.formatAdtError(error)}`
            );
        }
    }

    /** Apply ADT deltas (1-based lines, 0-based columns) to a source string. */
    private static applyDeltas(source: string, deltas: any[]): string {
        const lines = source.split('\n');
        const offsetOf = (line: number, column: number) => {
            let off = 0;
            for (let i = 0; i < line - 1 && i < lines.length; i++) off += lines[i].length + 1;
            return off + column;
        };
        // Apply bottom-up so earlier offsets stay valid.
        const sorted = [...deltas].sort((a, b) =>
            offsetOf(b.range.start.line, b.range.start.column) - offsetOf(a.range.start.line, a.range.start.column)
        );
        let result = source;
        for (const d of sorted) {
            const start = offsetOf(d.range.start.line, d.range.start.column);
            const end = offsetOf(d.range.end.line, d.range.end.column);
            result = result.slice(0, start) + d.content + result.slice(end);
        }
        return result;
    }

    async handleAtcCustomizing(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcCustomizing();
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
                `Failed to get ATC customizing: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleAtcCheckVariant(args: { variant: string }): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcCheckVariant(args.variant);
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
                `Failed to get ATC check variant: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleCreateAtcRun(args: { variant: string, mainUrl: string, maxResults?: number }): Promise<any> {
        const startTime = performance.now();
        try {
            // The backend wants a worklist id; resolve a check variant NAME
            // (anything that is not a 32-char hex id) via atcCheckVariant first.
            let worklistId = args.variant;
            if (!/^[0-9A-Fa-f]{32}$/.test(worklistId)) {
                worklistId = await this.adtclient.atcCheckVariant(args.variant);
            }
            const result = await this.adtclient.createAtcRun(worklistId, args.mainUrl, args.maxResults);
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
                `Failed to create ATC run: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleAtcWorklists(args: { runResultId: string, timestamp?: number, usedObjectSet?: string, includeExempted?: boolean }): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcWorklists(args.runResultId, args.timestamp || 0, args.usedObjectSet || "", args.includeExempted);
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
                `Failed to get ATC worklists: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleAtcUsers(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcUsers();
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
                `Failed to get ATC users: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleAtcExemptProposal(args: { markerId: string }): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcExemptProposal(args.markerId);
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
                `Failed to get ATC exempt proposal: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleAtcRequestExemption(args: { proposal: AtcProposal }): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcRequestExemption(args.proposal);
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
                `Failed to request ATC exemption: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleIsProposalMessage(args: { proposal: AtcProposal }): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.isProposalMessage(args.proposal);
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
                `Failed to check if proposal message: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleAtcContactUri(args: { findingUri: string }): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcContactUri(args.findingUri);
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
                `Failed to get ATC contact URI: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleAtcChangeContact(args: { itemUri: string, userId: string }): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcChangeContact(args.itemUri, args.userId);
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
                `Failed to change ATC contact: ${this.formatAdtError(error)}`
            );
        }
    }
}
