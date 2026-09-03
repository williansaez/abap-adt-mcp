import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { sourceCache } from '../lib/sourceCache.js';
import { shrinkToFit } from '../lib/responseSizing.js';
import { parseTextSearchResponse, GREPPABLE_TYPES, grepSource, buildPattern, mapLimit, GrepHit, TextSearchMatch } from '../lib/textSearch.js';
import { reportProgress } from '../lib/progress.js';

const TEXTSEARCH_PATH = '/sap/bc/adt/repository/informationsystem/textsearch';

/** Find code by content instead of reading whole sources. */
export class SearchHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'sourceTextSearch',
                description: 'Search source code by content using the ADT repository text search index (server-side, fast). Returns matching objects with line and snippet when the backend provides them. Restrict with packages/objectTypes/objectName. Use this before reading whole sources when you need to find where a table, message, method or literal is used. If the backend has no text search (older releases), the call falls back to grepPackage when packages are given.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        searchString: { type: 'string', description: 'Text to search for (the index is word/prefix based; use plain identifiers, not regex)' },
                        packages: { type: 'string', description: 'Comma-separated package names to restrict the search (e.g. ZFIN,ZSD)', optional: true },
                        objectTypes: { type: 'string', description: 'Comma-separated ADT object types to restrict (e.g. CLAS/OC,PROG/P,DDLS/DF)', optional: true },
                        objectName: { type: 'string', description: 'Object name pattern to restrict (e.g. ZCL_*)', optional: true },
                        maxResults: { type: 'number', description: 'Maximum results (default 100)', optional: true }
                    },
                    required: ['searchString']
                }
            },
            {
                name: 'grepPackage',
                description: 'Client-side grep over the sources of a package (classes, interfaces, programs, includes, CDS, behavior definitions, service definitions, function modules): downloads each source once (cached), applies the pattern and returns matches with line numbers and context. Works on every system, including S/4HANA Cloud. Bounded by maxObjects/maxMatches; recursive=true descends into sub-packages.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        packageName: { type: 'string', description: 'Package to scan, e.g. ZFIN' },
                        pattern: { type: 'string', description: 'Text to find (literal by default; set regex=true for a regular expression)' },
                        regex: { type: 'boolean', description: 'Treat pattern as a JavaScript regular expression (default false)', optional: true },
                        caseSensitive: { type: 'boolean', description: 'Case-sensitive match (default false; ABAP is case-insensitive)', optional: true },
                        recursive: { type: 'boolean', description: 'Include sub-packages (default true)', optional: true },
                        objectTypes: { type: 'string', description: 'Comma-separated ADT object types to include (default: all greppable types)', optional: true },
                        contextLines: { type: 'number', description: 'Lines of context around each match (default 1)', optional: true },
                        maxObjects: { type: 'number', description: 'Maximum sources to download (default 200)', optional: true },
                        maxMatches: { type: 'number', description: 'Maximum matches to return (default 200)', optional: true }
                    },
                    required: ['packageName', 'pattern']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'sourceTextSearch':
                return this.handleSourceTextSearch(args);
            case 'grepPackage':
                return this.handleGrepPackage(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown search tool: ${toolName}`);
        }
    }

    private list(v: unknown): string[] {
        if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
        return String(v || '').split(',').map(s => s.trim()).filter(Boolean);
    }

    async handleSourceTextSearch(args: any): Promise<any> {
        const startTime = performance.now();
        const packages = this.list(args.packages);
        const objectTypes = this.list(args.objectTypes);
        const maxResults = Math.max(1, Number(args.maxResults) || 100);
        try {
            const qs: Record<string, any> = {
                searchString: String(args.searchString),
                searchFromIndex: 0,
                searchToIndex: maxResults,
                getAllResults: 'false',
            };
            if (packages.length) qs.packageName = packages;
            if (objectTypes.length) qs.objectType = objectTypes;
            if (args.objectName) qs.objectName = String(args.objectName).toUpperCase();
            const headers = { Accept: 'application/xml, application/*+xml;q=0.9, */*;q=0.5' };
            // The library throws on >= 400, so both the status and the thrown
            // error are checked: some releases answer POST with "Resource
            // controller does not support method POST".
            const attempt = async (method: 'POST' | 'GET') => {
                try {
                    return await this.adtclient.httpClient.request(TEXTSEARCH_PATH, method === 'POST' ? { method, qs, headers, body: '' } : { method, qs, headers });
                } catch (e: any) {
                    const status = Number(e?.status ?? e?.err ?? e?.response?.status);
                    const text = String(e?.message || '');
                    if (status === 405 || /does not support method/i.test(text)) return { status: 405, body: '', headers: {}, statusText: 'Method Not Allowed' } as any;
                    // Tenants can expose the resource but keep source search switched off
                    // ("Source Search is not supported", SRIS_SEARCH 006 on S/4HANA Cloud).
                    if (status === 404 || status === 501 || /search is not supported|SRIS_SEARCH/i.test(text)) return { status: 501, body: '', headers: {}, statusText: 'Not Supported' } as any;
                    throw e;
                }
            };
            let response = await attempt('POST');
            if (response.status === 405) {
                response = await attempt('GET');
            }
            if (response.status === 404 || response.status === 405 || response.status === 501) {
                if (packages.length) {
                    const fallback = await this.handleGrepPackage({ packageName: packages[0], pattern: args.searchString, objectTypes: args.objectTypes, maxMatches: maxResults });
                    const payload = JSON.parse(fallback.content[0].text);
                    payload.fallback = `text search endpoint unavailable (HTTP ${response.status}); grepPackage over ${packages[0]} was used instead`;
                    this.trackRequest(startTime, true);
                    return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
                }
                throw new McpError(ErrorCode.InvalidRequest, `Text search is not available on this system (${response.status === 501 ? 'source search not supported by the backend' : 'HTTP ' + response.status}). Use grepPackage(packageName, pattern) instead, or pass packages to let this tool fall back automatically.`);
            }
            if (response.status >= 400) {
                throw new McpError(ErrorCode.InternalError, `Text search failed (HTTP ${response.status}): ${String(response.body || '').slice(0, 300)}`);
            }
            const results: TextSearchMatch[] = parseTextSearchResponse(String(response.body || ''));
            this.trackRequest(startTime, true);
            const text = shrinkToFit(results.length, (count, capped) => ({
                status: 'success',
                searchString: args.searchString,
                filters: { packages, objectTypes, objectName: args.objectName },
                totalItems: results.length,
                returnedItems: Math.min(count, results.length),
                results: results.slice(0, count),
                capped,
                hint: results.length === 0 ? 'No hits. The index is word-based: try a shorter identifier, or grepPackage for substrings and regex.' : undefined
            }));
            return { content: [{ type: 'text', text }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(ErrorCode.InternalError, `Failed to run text search: ${this.formatAdtError(error)}`);
        }
    }

    /** Collect greppable objects of a package (optionally recursive), bounded by maxObjects. */
    private async collectObjects(packageName: string, recursive: boolean, types: Set<string> | undefined, maxObjects: number): Promise<{ objects: Array<{ objectUrl: string; name: string; type: string; sourceUrl: string }>; packagesScanned: string[]; truncated: boolean }> {
        const objects: Array<{ objectUrl: string; name: string; type: string; sourceUrl: string }> = [];
        const packagesScanned: string[] = [];
        const queue = [packageName.toUpperCase()];
        const seen = new Set<string>();
        let truncated = false;
        while (queue.length && !truncated) {
            const pkg = queue.shift()!;
            if (seen.has(pkg)) continue;
            seen.add(pkg);
            packagesScanned.push(pkg);
            const structure = await this.adtclient.nodeContents('DEVC/K', pkg);
            for (const node of structure.nodes || []) {
                if (node.OBJECT_TYPE === 'DEVC/K') {
                    if (recursive && node.OBJECT_NAME) queue.push(String(node.OBJECT_NAME).toUpperCase());
                    continue;
                }
                const toSource = GREPPABLE_TYPES[node.OBJECT_TYPE];
                if (!toSource || !node.OBJECT_URI) continue;
                if (types && !types.has(node.OBJECT_TYPE)) continue;
                if (objects.length >= maxObjects) { truncated = true; break; }
                objects.push({ objectUrl: node.OBJECT_URI, name: node.OBJECT_NAME, type: node.OBJECT_TYPE, sourceUrl: toSource(node.OBJECT_URI) });
            }
        }
        return { objects, packagesScanned, truncated };
    }

    async handleGrepPackage(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            let re: RegExp;
            try {
                re = buildPattern(String(args.pattern), args.regex === true, args.caseSensitive === true);
            } catch (e: any) {
                throw new McpError(ErrorCode.InvalidParams, `Invalid pattern: ${e.message}`);
            }
            const recursive = args.recursive !== false;
            const typeList = this.list(args.objectTypes);
            const types = typeList.length ? new Set(typeList) : undefined;
            const maxObjects = Math.max(1, Number(args.maxObjects) || 200);
            const maxMatches = Math.max(1, Number(args.maxMatches) || 200);
            const contextLines = Math.max(0, Number(args.contextLines ?? 1));

            const { objects, packagesScanned, truncated } = await this.collectObjects(String(args.packageName), recursive, types, maxObjects);
            reportProgress(`${objects.length} sources to scan in ${packagesScanned.length} package(s)`, 0, objects.length);
            let remaining = maxMatches;
            let scanned = 0;
            const failures: Array<{ objectUrl: string; error: string }> = [];
            const perObject = await mapLimit(objects, 4, async (obj) => {
                if (remaining <= 0) return [] as GrepHit[];
                try {
                    let source = sourceCache.get(obj.sourceUrl);
                    if (source === undefined) {
                        source = await this.adtclient.getObjectSource(obj.sourceUrl);
                        sourceCache.set(obj.sourceUrl, source);
                    }
                    const hits = grepSource(source, re, contextLines, Math.max(0, remaining), { objectUrl: obj.objectUrl, name: obj.name, type: obj.type });
                    remaining -= hits.length;
                    scanned++;
                    if (scanned % 10 === 0) reportProgress(`scanned ${scanned}/${objects.length} sources, ${maxMatches - remaining} matches`, scanned, objects.length);
                    return hits;
                } catch (e: any) {
                    failures.push({ objectUrl: obj.objectUrl, error: this.formatAdtError(e) });
                    return [] as GrepHit[];
                }
            });
            const matches = perObject.flat();
            this.trackRequest(startTime, true);
            const text = shrinkToFit(matches.length, (count, capped) => ({
                status: 'success',
                packageName: String(args.packageName).toUpperCase(),
                pattern: args.pattern,
                packagesScanned,
                objectsScanned: objects.length,
                objectsTruncated: truncated,
                totalMatches: matches.length,
                matchesTruncated: remaining <= 0,
                returnedMatches: Math.min(count, matches.length),
                matches: matches.slice(0, count),
                failures: failures.slice(0, 20),
                capped
            }));
            return { content: [{ type: 'text', text }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(ErrorCode.InternalError, `Failed to grep package: ${this.formatAdtError(error)}`);
        }
    }
}
