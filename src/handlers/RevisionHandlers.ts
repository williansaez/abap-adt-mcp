import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { AbapObjectStructure, classIncludes } from 'abap-adt-api';
import { createTwoFilesPatch } from 'diff';
import { SAFE_OUTPUT_CHARS } from '../lib/responseSizing.js';

export class RevisionHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'revisions',
                description: 'Retrieves revisions for an object.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objectUrl: {
                            type: 'string',
                            description: 'The URL of the object.'
                        },
                        clsInclude: {
                            type: 'string',
                            description: 'The class include.',
                            optional: true
                        }
                    },
                    required: ['objectUrl']
                }
            },
            {
                name: 'objectDiff',
                description: 'Unified diff between two revisions of an object (default: latest against the previous one). Revisions are selected by index in the list returned by revisions (0 = newest), by version string, or by revision URI. Use it to review what a transport or a colleague changed before touching the object.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objectUrl: { type: 'string', description: 'Object URL, e.g. /sap/bc/adt/oo/classes/zcl_demo' },
                        fromRevision: { type: 'string', description: 'Older revision: index (default 1), version string or URI', optional: true },
                        toRevision: { type: 'string', description: 'Newer revision: index (default 0 = current), version string or URI', optional: true },
                        clsInclude: { type: 'string', description: 'Class include for classes (main, definitions, implementations, testclasses)', optional: true },
                        contextLines: { type: 'number', description: 'Context lines around each hunk (default 3)', optional: true }
                    },
                    required: ['objectUrl']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'revisions':
                return this.handleRevisions(args);
            case 'objectDiff':
                return this.handleObjectDiff(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown revision tool: ${toolName}`);
        }
    }

    async handleRevisions(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const revisions = await this.adtclient.revisions(args.objectUrl, args.clsInclude);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            revisions
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get revisions: ${this.formatAdtError(error)}`
            );
        }
    }

    private pickRevision(sorted: any[], selector: unknown, fallbackIndex: number, label: string): any {
        if (selector === undefined || selector === null || selector === '') {
            if (fallbackIndex >= sorted.length) throw new McpError(ErrorCode.InvalidRequest, `Object has only ${sorted.length} revision(s); no ${label} revision to compare`);
            return sorted[fallbackIndex];
        }
        const s = String(selector);
        if (/^\d+$/.test(s)) {
            const i = parseInt(s, 10);
            if (i >= sorted.length) throw new McpError(ErrorCode.InvalidParams, `${label} revision index ${i} out of range (0..${sorted.length - 1})`);
            return sorted[i];
        }
        const hit = sorted.find(r => r.uri === s || r.version === s || String(r.versionTitle || '').includes(s));
        if (!hit) throw new McpError(ErrorCode.InvalidParams, `${label} revision "${s}" not found; use an index, a version or a URI from revisions`);
        return hit;
    }

    async handleObjectDiff(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const revs = await this.adtclient.revisions(args.objectUrl, args.clsInclude);
            if (!revs || revs.length === 0) throw new McpError(ErrorCode.InvalidRequest, 'No revisions available for this object');
            const sorted = [...revs].sort((a: any, b: any) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
            const to = this.pickRevision(sorted, args.toRevision, 0, 'newer');
            const from = this.pickRevision(sorted, args.fromRevision, 1, 'older');
            const older = await this.adtclient.getObjectSource(from.uri);
            const newer = await this.adtclient.getObjectSource(to.uri);
            const context = Math.max(0, Number(args.contextLines ?? 3));
            const name = String(args.objectUrl).split('/').filter(Boolean).pop() || 'object';
            const patch = createTwoFilesPatch(`${name} (${from.version || from.date})`, `${name} (${to.version || to.date})`, older, newer, undefined, undefined, { context });
            let added = 0, removed = 0;
            for (const line of patch.split('\n')) {
                if (line.startsWith('+') && !line.startsWith('+++')) added++;
                else if (line.startsWith('-') && !line.startsWith('---')) removed++;
            }
            this.trackRequest(startTime, true);
            const meta = (r: any) => ({ uri: r.uri, version: r.version, title: r.versionTitle, date: r.date, author: r.author });
            const payload: any = { status: 'success', object: args.objectUrl, from: meta(from), to: meta(to), revisions: sorted.length, linesAdded: added, linesRemoved: removed, identical: added + removed === 0, diff: patch };
            let text = JSON.stringify(payload);
            if (text.length > SAFE_OUTPUT_CHARS) {
                payload.diff = patch.slice(0, SAFE_OUTPUT_CHARS - 800) + '\n… [diff truncated]';
                payload.truncated = true;
                text = JSON.stringify(payload);
            }
            return { content: [{ type: 'text', text }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(ErrorCode.InternalError, `Failed to diff revisions: ${this.formatAdtError(error)}`);
        }
    }
}
