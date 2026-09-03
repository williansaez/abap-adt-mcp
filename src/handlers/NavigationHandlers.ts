import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { sourceCache } from '../lib/sourceCache.js';
import { SAFE_OUTPUT_CHARS, shrinkToFit, hardTruncateJson } from '../lib/responseSizing.js';
import { walkPackage } from '../lib/packageWalk.js';
import { abapgitFileName, CLASS_INCLUDES, EXPORTABLE_TYPES, resolveExportDir } from '../lib/abapgitExport.js';
import { reportProgress } from '../lib/progress.js';
import fs from 'fs';
import path from 'path';

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
            },
            {
                name: 'packageTree',
                description: 'Package hierarchy with its objects in one call: sub-packages (to maxDepth) and, per package, the objects with name, type, URL and description. Cheaper than repeated nodeContents calls; use objectTypes to keep only e.g. CLAS/OC,DDLS/DF.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        packageName: { type: 'string', description: 'Root package, e.g. ZFIN' },
                        maxDepth: { type: 'number', description: 'Sub-package depth to descend (default 2; 0 = only the root)', optional: true },
                        includeObjects: { type: 'boolean', description: 'List objects per package (default true)', optional: true },
                        objectTypes: { type: 'string', description: 'Comma-separated ADT object types to keep', optional: true },
                        maxObjects: { type: 'number', description: 'Maximum objects to collect (default 500)', optional: true }
                    },
                    required: ['packageName']
                }
            },
            {
                name: 'exportPackageSources',
                description: 'Write the sources of a package (and sub-packages) to a local directory in abapGit file layout (zcl_x.clas.abap, zcl_x.clas.testclasses.abap, zi_x.ddls.asddls, zrep.prog.abap …) so local tools (grep, editors, code review, documentation pipelines) can work on them. Read-only on SAP; writes only to the given directory (must be absolute; restricted to MCP_EXPORT_ROOT when set). Classes, interfaces, programs/includes, CDS, access controls, metadata extensions, behavior and service definitions are exported; other types are listed as skipped.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        packageName: { type: 'string', description: 'Package to export' },
                        targetDir: { type: 'string', description: 'Absolute local directory inside the export root (MCP_EXPORT_ROOT, default ~/.abap-adt-mcp/exports); a sub-folder per package is created' },
                        overwrite: { type: 'boolean', description: 'Overwrite files that already exist (default false: existing files are reported and left untouched)', optional: true },
                        recursive: { type: 'boolean', description: 'Include sub-packages (default true)', optional: true },
                        objectTypes: { type: 'string', description: 'Comma-separated ADT object types to include (default: all exportable)', optional: true },
                        maxObjects: { type: 'number', description: 'Maximum objects (default 500)', optional: true }
                    },
                    required: ['packageName', 'targetDir']
                }
            },
            {
                name: 'whereUsed',
                description: 'Where-used list by object name: resolves the name with searchObject and returns the usage references (using object, its URL, kind of usage). No URL or source position needed.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Object name, e.g. ZCL_DEMO or ZI_PRODUCT' },
                        objType: { type: 'string', description: 'ADT object type to disambiguate, e.g. CLAS/OC, DDLS/DF, TABL/DT', optional: true },
                        maxResults: { type: 'number', description: 'Maximum references to return (default 200)', optional: true }
                    },
                    required: ['name']
                }
            },
            {
                name: 'cdsViewInfo',
                description: 'CDS entity by name in one call: element info (fields with types, associations, extension views, secondary objects) and optionally the DDL source. Pass the entity name (ZI_PRODUCT), not a URL.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'CDS entity name' },
                        includeSource: { type: 'boolean', description: 'Also return the DDL source (default true)', optional: true },
                        getTargetForAssociation: { type: 'boolean', description: 'Resolve association targets (default false)', optional: true },
                        getExtensionViews: { type: 'boolean', description: 'Include extension views (default false)', optional: true }
                    },
                    required: ['name']
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
            case 'packageTree':
                return this.handlePackageTree(args);
            case 'exportPackageSources':
                return this.handleExportPackageSources(args);
            case 'whereUsed':
                return this.handleWhereUsed(args);
            case 'cdsViewInfo':
                return this.handleCdsViewInfo(args);
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
                : (sourceCache.get(this.adtclient, args.objectSourceUrl) ?? await this.adtclient.getObjectSource(args.objectSourceUrl));
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

    async handlePackageTree(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const types = String(args.objectTypes || '').split(',').map((t: string) => t.trim()).filter(Boolean);
            const walk = await walkPackage(this.adtclient as any, String(args.packageName), {
                maxDepth: args.maxDepth !== undefined ? Math.max(0, Number(args.maxDepth)) : 2,
                includeObjects: args.includeObjects !== false,
                objectTypes: types.length ? new Set(types) : undefined,
                maxObjects: Math.max(1, Number(args.maxObjects) || 500),
            });
            this.trackRequest(startTime, true);
            const byType: Record<string, number> = {};
            for (const o of walk.objects) byType[o.type] = (byType[o.type] || 0) + 1;
            const payload = { status: 'success', packages: walk.packages.length, objects: walk.objects.length, objectsTruncated: walk.truncated, byType, tree: walk.tree };
            const text = JSON.stringify(payload);
            if (text.length <= SAFE_OUTPUT_CHARS) return { content: [{ type: 'text', text }] };
            // Too big as a tree: fall back to a flat, paged object list.
            const flat = shrinkToFit(walk.objects.length, (count, capped) => ({
                status: 'success', packages: walk.packages, objects: walk.objects.length, objectsTruncated: walk.truncated, byType,
                note: 'Tree too large for one response; flat object list returned. Narrow with objectTypes or maxDepth.',
                list: walk.objects.slice(0, count), returned: Math.min(count, walk.objects.length), capped
            }));
            return { content: [{ type: 'text', text: flat }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(ErrorCode.InternalError, `Failed to build package tree: ${this.formatAdtError(error)}`);
        }
    }

    async handleWhereUsed(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const name = String(args.name).toUpperCase();
            const hits: any[] = await this.adtclient.searchObject(name, args.objType, 10);
            const exact = hits.filter(h => String(h['adtcore:name'] || '').toUpperCase() === name);
            if (exact.length === 0) {
                throw new McpError(ErrorCode.InvalidRequest, `No object named ${name}${args.objType ? ' of type ' + args.objType : ''} found (searchObject returned ${hits.length} candidates${hits.length ? ': ' + hits.slice(0, 5).map(h => h['adtcore:name'] + ' ' + h['adtcore:type']).join(', ') : ''})`);
            }
            if (exact.length > 1 && !args.objType) {
                throw new McpError(ErrorCode.InvalidRequest, `${name} is ambiguous: ${exact.map(h => h['adtcore:type']).join(', ')}. Pass objType.`);
            }
            const target = exact[0];
            const refs: any[] = await this.adtclient.usageReferences(target['adtcore:uri']);
            this.trackRequest(startTime, true);
            const toRow = (r: any) => ({ object: r.objectIdentifier, uri: r.uri, parentUri: r.parentUri, usage: r.usageInformation, canHaveChildren: r.canHaveChildren });
            const results = refs.filter(r => r.isResult !== false).map(toRow);
            const groups = refs.filter(r => r.isResult === false).map(toRow);
            const max = Math.max(1, Number(args.maxResults) || 200);
            const text = shrinkToFit(Math.min(max, results.length), (count, capped) => ({
                status: 'success',
                target: { name: target['adtcore:name'], type: target['adtcore:type'], uri: target['adtcore:uri'], packageName: target['adtcore:packageName'] },
                totalReferences: results.length, returned: Math.min(count, results.length), references: results.slice(0, count),
                groups: groups.slice(0, 50), capped,
                hint: results.length ? 'Use usageReferenceSnippets with these references for the exact lines.' : (groups.length ? 'Only grouping nodes came back; call usageReferences with the object URL and a line/column inside the definition for the detailed list.' : 'No usages found.')
            }));
            return { content: [{ type: 'text', text }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(ErrorCode.InternalError, `Failed to compute where-used: ${this.formatAdtError(error)}`);
        }
    }

    async handleCdsViewInfo(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const name = String(args.name).toUpperCase();
            const element: any = await this.adtclient.ddicElement(name, args.getTargetForAssociation === true, args.getExtensionViews === true, false);
            let source: string | undefined;
            let sourceError: string | undefined;
            if (args.includeSource !== false) {
                const sourceUrl = `/sap/bc/adt/ddic/ddl/sources/${encodeURIComponent(name.toLowerCase())}/source/main`;
                try {
                    source = sourceCache.get(this.adtclient, sourceUrl) ?? await this.adtclient.getObjectSource(sourceUrl);
                    sourceCache.set(this.adtclient, sourceUrl, source);
                } catch (e: any) {
                    sourceError = this.formatAdtError(e);
                }
            }
            this.trackRequest(startTime, true);
            const fields = Array.isArray(element?.children) ? element.children.map((c: any) => ({
                name: c.name, type: c.type, dataType: c.properties?.elementProps?.ddicDataType || c.properties?.ddicDataType, length: c.properties?.elementProps?.ddicLength, description: c.properties?.elementProps?.ddicHeading || c.properties?.description, isKey: c.properties?.elementProps?.ddicIsKey
            })) : [];
            const payload: any = {
                status: 'success', name, type: element?.type, description: element?.properties?.description,
                sqlViewName: element?.properties?.elementProps?.sqlViewName, fields: fields.length, elements: fields, source, sourceError
            };
            const text = JSON.stringify(payload);
            return { content: [{ type: 'text', text: text.length <= SAFE_OUTPUT_CHARS ? text : hardTruncateJson(payload) }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(ErrorCode.InternalError, `Failed to read CDS view ${args.name}: ${this.formatAdtError(error)}`);
        }
    }

    async handleExportPackageSources(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            let dir: string;
            try { dir = resolveExportDir(String(args.targetDir || ''), process.env.MCP_EXPORT_ROOT); }
            catch (e: any) { throw new McpError(ErrorCode.InvalidParams, e.message); }
            const types = String(args.objectTypes || '').split(',').map((t: string) => t.trim()).filter(Boolean);
            const walk = await walkPackage(this.adtclient as any, String(args.packageName), {
                maxDepth: args.recursive === false ? 0 : 99, includeObjects: true, expandFunctionGroups: true,
                objectTypes: types.length ? new Set(types) : undefined, maxObjects: Math.max(1, Number(args.maxObjects) || 500),
            });
            const written: Array<{ file: string; object: string; type: string; bytes: number }> = [];
            const skipped: Array<{ object: string; type: string; reason: string }> = [];
            const failed: Array<{ object: string; error: string }> = [];
            let done = 0;
            for (const obj of walk.objects) {
                done++;
                if (done % 10 === 0) reportProgress(`exported ${done}/${walk.objects.length} objects`, done, walk.objects.length);
                if (obj.type === 'FUGR/F') continue; // exported through its function modules and includes
                const fileName = abapgitFileName(obj.name, obj.type, undefined, obj.functionGroup);
                if (!fileName) { skipped.push({ object: obj.name, type: obj.type, reason: 'type not exportable' }); continue; }
                const pkgDir = path.join(dir, obj.package.toLowerCase().replace(/\//g, '#'));
                fs.mkdirSync(pkgDir, { recursive: true });
                try {
                    const file = path.join(pkgDir, fileName);
                    if (fs.existsSync(file) && args.overwrite !== true) { skipped.push({ object: obj.name, type: obj.type, reason: `exists: ${path.relative(dir, file)} (pass overwrite=true)` }); continue; }
                    const source = await this.adtclient.getObjectSource(`${obj.objectUrl}/source/main`);
                    fs.writeFileSync(file, source);
                    written.push({ file, object: obj.name, type: obj.type, bytes: Buffer.byteLength(source) });
                    if (obj.type === 'CLAS/OC') {
                        for (const inc of CLASS_INCLUDES) {
                            try {
                                const text = await this.adtclient.getObjectSource(`${obj.objectUrl}/includes/${inc.adtInclude}`);
                                if (text && text.trim()) {
                                    const f = path.join(pkgDir, abapgitFileName(obj.name, obj.type, inc.include)!);
                                    if (fs.existsSync(f) && args.overwrite !== true) continue;
                                    fs.writeFileSync(f, text);
                                    written.push({ file: f, object: obj.name, type: `${obj.type}/${inc.adtInclude}`, bytes: Buffer.byteLength(text) });
                                }
                            } catch { /* include absent */ }
                        }
                    }
                } catch (e: any) {
                    failed.push({ object: obj.name, error: this.formatAdtError(e) });
                }
            }
            const manifest = { package: String(args.packageName).toUpperCase(), exportedAt: new Date().toISOString(), packages: walk.packages, files: written.length, skipped, failed };
            fs.writeFileSync(path.join(dir, 'EXPORT.json'), JSON.stringify(manifest, null, 2));
            this.trackRequest(startTime, true);
            return { content: [{ type: 'text', text: JSON.stringify({
                status: failed.length && !written.length ? 'error' : 'success', targetDir: dir, packages: walk.packages, objects: walk.objects.length, objectsTruncated: walk.truncated,
                filesWritten: written.length, bytes: written.reduce((n, w) => n + w.bytes, 0), exportableTypes: EXPORTABLE_TYPES,
                skipped: skipped.slice(0, 50), failed: failed.slice(0, 20), files: written.slice(0, 200).map(w => path.relative(dir, w.file))
            }) }] };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(ErrorCode.InternalError, `Failed to export package sources: ${this.formatAdtError(error)}`);
        }
    }
}
