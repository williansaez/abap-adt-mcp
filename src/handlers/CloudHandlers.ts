import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { getReleaseIndex, lookup, parseObjectRef, objectRefFromUrl, candidatesFromSource, ReleaseEdition, Loader, ReleaseVerdict } from '../lib/apiReleases.js';
import { sourceCache } from '../lib/sourceCache.js';
import { shrinkToFit } from '../lib/responseSizing.js';

/** ABAP Cloud readiness: release state of SAP objects and of everything a source references. */
export class CloudHandlers extends BaseHandler {
    constructor(adtclient: any, private loader?: Loader) { super(adtclient); }

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'apiReleaseState',
                description: 'Release state of SAP objects for ABAP Cloud / Clean Core, from SAP\'s official cloudification repository (released, deprecated with successors, classicAPI, noAPI) plus, when objectUrl is given, the backend\'s own /sap/bc/adt/apireleases answer. Check APIs before writing cloud code instead of recalling from memory. Pass names as "CL_X", "TABL:MARA", "FUGR:BAPI_..." (comma-separated) or a source to scan every referenced object.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        names: { type: 'string', description: 'Comma-separated object names, optionally prefixed with the TADIR type (CLAS:, INTF:, TABL:, DDLS:, FUGR:, FUNC:)', optional: true },
                        objectUrl: { type: 'string', description: 'ADT object URL to check (also queried on the backend when it exposes apireleases)', optional: true },
                        source: { type: 'string', description: 'ABAP source to scan: every referenced SAP object (SELECT targets, TYPE references, CL_/IF_/CX_ classes, function modules) is checked', optional: true },
                        sourceUrl: { type: 'string', description: 'Source URL (…/source/main) to read and scan instead of passing the text', optional: true },
                        edition: { type: 'string', enum: ['cloud', 'btp', 'pce2023', 'pce2022'], description: 'Target edition: cloud (S/4HANA Cloud Public Edition, default), btp (BTP ABAP Environment), pce2023/pce2022 (Private Cloud 3-tier)', optional: true },
                        refresh: { type: 'boolean', description: 'Re-download the repository data (default: 24h cache)', optional: true }
                    }
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        if (toolName !== 'apiReleaseState') throw new McpError(ErrorCode.MethodNotFound, `Unknown cloud tool: ${toolName}`);
        return this.handleApiReleaseState(args);
    }

    private async adtRelease(objectUrl: string): Promise<any> {
        try {
            const res = await this.adtclient.httpClient.request(`/sap/bc/adt/apireleases/${encodeURIComponent(objectUrl)}`, { method: 'GET', headers: { Accept: 'application/xml, */*;q=0.5' } });
            if (res.status >= 400) return { available: false, httpStatus: res.status };
            const body = String(res.body || '');
            const attrs: Record<string, string> = {};
            const re = /\b([\w.-]+:)?(releaseState|state|apiState|contract|successor|successorName|compatibilityContract|useInCloudDevelopment|useInKeyUserApps|releaseDate|name|type)="([^"]*)"/gi;
            let m: RegExpExecArray | null;
            while ((m = re.exec(body)) && Object.keys(attrs).length < 40) attrs[m[2]] = m[3];
            return { available: true, attributes: attrs, raw: body.length > 2000 ? body.slice(0, 2000) + '…' : body };
        } catch (e: any) {
            return { available: false, error: this.formatAdtError(e) };
        }
    }

    async handleApiReleaseState(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const edition = (args.edition || 'cloud') as ReleaseEdition;
            const refs: Array<{ name: string; type?: string }> = [];
            for (const n of String(args.names || '').split(',').map((s: string) => s.trim()).filter(Boolean)) refs.push(parseObjectRef(n));
            if (args.objectUrl) {
                const r = objectRefFromUrl(String(args.objectUrl));
                if (r) refs.push(r);
            }
            let scanned: string[] | undefined;
            if (args.source || args.sourceUrl) {
                let source = args.source ? String(args.source) : (sourceCache.get(this.adtclient, String(args.sourceUrl)) ?? '');
                if (!source && args.sourceUrl) {
                    source = await this.adtclient.getObjectSource(String(args.sourceUrl));
                    sourceCache.set(this.adtclient, String(args.sourceUrl), source);
                }
                scanned = candidatesFromSource(source);
                for (const n of scanned) refs.push({ name: n });
            }
            if (refs.length === 0) {
                throw new McpError(ErrorCode.InvalidParams, 'Pass names, objectUrl, source or sourceUrl');
            }
            let index;
            try {
                index = await getReleaseIndex(edition, this.loader, args.refresh === true);
            } catch (e: any) {
                throw new McpError(ErrorCode.InternalError, `Could not load SAP's cloudification repository (needs internet access to raw.githubusercontent.com): ${e.message}`);
            }
            const seen = new Set<string>();
            const verdicts: ReleaseVerdict[] = [];
            for (const r of refs) {
                const key = `${r.type || ''}:${r.name.toUpperCase()}`;
                if (seen.has(key)) continue;
                seen.add(key);
                verdicts.push(lookup(index, r));
            }
            const adt = args.objectUrl ? await this.adtRelease(String(args.objectUrl)) : undefined;
            this.trackRequest(startTime, true);
            const notReady = verdicts.filter(v => !v.cloudReady && v.state !== 'customer' && v.state !== 'unknown');
            const unknown = verdicts.filter(v => v.state === 'unknown');
            const text = shrinkToFit(verdicts.length, (count, capped) => ({
                status: 'success',
                edition,
                repository: { loadedAt: index.loadedAt, releasedEntries: index.counts.released, classificationEntries: index.counts.classifications },
                summary: { checked: verdicts.length, cloudReady: verdicts.filter(v => v.cloudReady).length, notCloudReady: notReady.length, unknown: unknown.length, customerObjects: verdicts.filter(v => v.state === 'customer').length },
                ...(unknown.length ? { unknown: unknown.slice(0, 50).map(v => v.name), unknownNote: 'Not in the SAP cloudification repository: verify in the system before treating as blockers.' } : {}),
                blockers: notReady.slice(0, 50).map(v => ({ name: v.name, type: v.type, state: v.state, successors: v.successors })),
                results: verdicts.slice(0, count),
                ...(scanned ? { scannedIdentifiers: scanned.length } : {}),
                ...(adt ? { backendApiRelease: adt } : {}),
                capped
            }));
            return { content: [{ type: 'text', text }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(ErrorCode.InternalError, `Failed to check API release state: ${this.formatAdtError(error)}`);
        }
    }
}
