import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { ADTClient } from "abap-adt-api";
import { createTwoFilesPatch } from 'diff';
import { SAFE_OUTPUT_CHARS, shrinkToFit } from '../lib/responseSizing.js';

export class TransportHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'transportDetails',
                description: 'Get the contents of a transport request: tasks, owners, status and the full list of objects it records. Use transportInfo / userTransports to find transport numbers first.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        transportNumber: {
                            type: 'string',
                            description: 'Transport request number, e.g. DEVK900123'
                        }
                    },
                    required: ['transportNumber']
                }
            },
            {
                name: 'transportUnifiedDiff',
                description: 'Generate a unified diff of the source-code objects recorded on a transport request: for each object it compares the version predating the transport against the current source. Useful for reviewing what a transport changes. Non-source objects (tables, customizing) are listed but not diffed.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        transportNumber: {
                            type: 'string',
                            description: 'Transport request number, e.g. DEVK900123'
                        },
                        maxObjects: {
                            type: 'number',
                            description: 'Maximum number of objects to diff (default 20)',
                            optional: true
                        }
                    },
                    required: ['transportNumber']
                }
            },
            {
                name: 'transportInfo',
                description: 'Get transport information for an object source',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objSourceUrl: {
                            type: 'string',
                            description: 'URL of the object source'
                        },
                        devClass: {
                            type: 'string',
                            description: 'Development class',
                            optional: true
                        },
                        operation: {
                            type: 'string',
                            description: 'Transport operation',
                            optional: true
                        }
                    },
                    required: ['objSourceUrl']
                }
            },
            {
                name: 'resolveTransport',
                description: 'Decide which transport request to use for changing an object, in one call: (1) the transport that already records/locks the object, else (2) the newest modifiable transport of the current user for that package, else (3) none for local ($TMP / non-recording) packages, else (4) create one when createIfMissing=true. Returns {transport, needsTransport, reason, candidates}. Call before lock/setObjectSource/createObject instead of interpreting transportInfo yourself.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objSourceUrl: { type: 'string', description: 'URL of the object (or its source URL) you are about to change' },
                        devClass: { type: 'string', description: 'Package name; required when the object does not exist yet (createObject)', optional: true },
                        preferTransport: { type: 'string', description: 'Use this transport if it is among the modifiable candidates', optional: true },
                        createIfMissing: { type: 'boolean', description: 'Create a new transport when the package needs one and no modifiable transport exists (default false)', optional: true },
                        requestText: { type: 'string', description: 'Description for the transport created when createIfMissing=true', optional: true }
                    },
                    required: ['objSourceUrl']
                }
            },
            {
                name: 'createTransport',
                description: 'Create a new transport request. Required before creating or changing objects in transportable (non-$TMP) packages; pass the returned transport number to createObject / setObjectSource. Use transportInfo to find existing transports for an object first.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objSourceUrl: {
                            type: 'string',
                            description: 'URL of the object source'
                        },
                        REQUEST_TEXT: {
                            type: 'string',
                            description: 'Description of the transport request'
                        },
                        DEVCLASS: {
                            type: 'string',
                            description: 'Development class (the ABAP package, e.g. ZPACKAGE)'
                        },
                        transportLayer: {
                            type: 'string',
                            description: 'Transport layer',
                            optional: true
                        }
                    },
                    required: ['objSourceUrl', 'REQUEST_TEXT', 'DEVCLASS']
                }
            },
            {
                name: 'hasTransportConfig',
                description: 'Check if transport configuration exists',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'transportConfigurations',
                description: 'Retrieves transport configurations.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'getTransportConfiguration',
                description: 'Retrieves a specific transport configuration.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'The URL of the transport configuration.'
                        }
                    },
                    required: ['url']
                }
            },
            {
                name: 'setTransportsConfig',
                description: 'Sets transport configurations.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uri: {
                            type: 'string',
                            description: 'The URI for the transport configuration.'
                        },
                        etag: {
                            type: 'string',
                            description: 'The ETag for the transport configuration.'
                        },
                        config: {
                            type: 'string',
                            description: 'The transport configuration.'
                        }
                    },
                    required: ['uri', 'etag', 'config']
                }
            },
            {
                name: 'createTransportsConfig',
                description: 'Creates transport configurations.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'userTransports',
                description: 'Retrieves transports for a user. For large results (many transports/tasks), use startIndex/maxItems to page through the flattened list of transport requests instead of retrieving them all at once.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        user: {
                            type: 'string',
                            description: 'The user.'
                        },
                        targets: {
                            type: 'boolean',
                            description: 'Whether to include target systems.',
                            optional: true
                        },
                        startIndex: {
                            type: 'number',
                            description: '0-based index of the flattened transport-request list to start from (default 0). Use with maxItems to page through large result sets.',
                            optional: true
                        },
                        maxItems: {
                            type: 'number',
                            description: 'Maximum number of transport requests to return from startIndex. Omit to return the rest.',
                            optional: true
                        }
                    },
                    required: ['user']
                }
            },
            {
                name: 'transportsByConfig',
                description: 'Retrieves transports by configuration. For large results (many transports/tasks), use startIndex/maxItems to page through the flattened list of transport requests instead of retrieving them all at once.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        configUri: {
                            type: 'string',
                            description: 'The configuration URI.'
                        },
                        targets: {
                            type: 'boolean',
                            description: 'Whether to include target systems.',
                            optional: true
                        },
                        startIndex: {
                            type: 'number',
                            description: '0-based index of the flattened transport-request list to start from (default 0). Use with maxItems to page through large result sets.',
                            optional: true
                        },
                        maxItems: {
                            type: 'number',
                            description: 'Maximum number of transport requests to return from startIndex. Omit to return the rest.',
                            optional: true
                        }
                    },
                    required: ['configUri']
                }
            },
            {
                name: 'transportDelete',
                description: 'Deletes a transport.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        transportNumber: {
                            type: 'string',
                            description: 'The transport number.'
                        }
                    },
                    required: ['transportNumber']
                }
            },
            {
                name: 'transportRelease',
                description: 'Releases a transport.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        transportNumber: {
                            type: 'string',
                            description: 'The transport number.'
                        },
                        ignoreLocks: {
                            type: 'boolean',
                            description: 'Whether to ignore locks.',
                            optional: true
                        },
                        IgnoreATC: {
                            type: 'boolean',
                            description: 'Whether to ignore ATC checks.',
                            optional: true
                        }
                    },
                    required: ['transportNumber']
                }
            },
            {
                name: 'transportSetOwner',
                description: 'Sets the owner of a transport.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        transportNumber: {
                            type: 'string',
                            description: 'The transport number.'
                        },
                        targetuser: {
                            type: 'string',
                            description: 'The target user.'
                        }
                    },
                    required: ['transportNumber', 'targetuser']
                }
            },
            {
                name: 'transportAddUser',
                description: 'Adds a user to a transport.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        transportNumber: {
                            type: 'string',
                            description: 'The transport number.'
                        },
                        user: {
                            type: 'string',
                            description: 'The user to add.'
                        }
                    },
                    required: ['transportNumber', 'user']
                }
            },
            {
                name: 'systemUsers',
                description: 'Retrieves a list of system users. For large results, use startIndex/maxItems to page through the user list instead of retrieving it all at once.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        startIndex: {
                            type: 'number',
                            description: '0-based index of the user list to start from (default 0). Use with maxItems to page through a large user list.',
                            optional: true
                        },
                        maxItems: {
                            type: 'number',
                            description: 'Maximum number of users to return from startIndex. Omit to return the rest.',
                            optional: true
                        }
                    }
                }
            },
            {
                name: 'transportReference',
                description: 'Retrieves a transport reference.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        pgmid: {
                            type: 'string',
                            description: 'The program ID.'
                        },
                        obj_wbtype: {
                            type: 'string',
                            description: 'The object type.'
                        },
                        obj_name: {
                            type: 'string',
                            description: 'The object name.'
                        },
                        tr_number: {
                            type: 'string',
                            description: 'The transport number.',
                            optional: true
                        }
                    },
                    required: ['pgmid', 'obj_wbtype', 'obj_name']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'transportDetails':
                return this.handleTransportDetails(args);
            case 'transportUnifiedDiff':
                return this.handleTransportUnifiedDiff(args);
            case 'transportInfo':
                return this.handleTransportInfo(args);
            case 'createTransport':
                return this.handleCreateTransport(args);
            case 'resolveTransport':
                return this.handleResolveTransport(args);
            case 'hasTransportConfig':
                return this.handleHasTransportConfig(args);
            case 'transportConfigurations':
                return this.handleTransportConfigurations(args);
            case 'getTransportConfiguration':
                return this.handleGetTransportConfiguration(args);
            case 'setTransportsConfig':
                return this.handleSetTransportsConfig(args);
            case 'createTransportsConfig':
                return this.handleCreateTransportsConfig(args);
            case 'userTransports':
                return this.handleUserTransports(args);
            case 'transportsByConfig':
                return this.handleTransportsByConfig(args);
            case 'transportDelete':
                return this.handleTransportDelete(args);
            case 'transportRelease':
                return this.handleTransportRelease(args);
            case 'transportSetOwner':
                return this.handleTransportSetOwner(args);
            case 'transportAddUser':
                return this.handleTransportAddUser(args);
            case 'systemUsers':
                return this.handleSystemUsers(args);
            case 'transportReference':
                return this.handleTransportReference(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown transport tool: ${toolName}`);
        }
    }

    async handleTransportDetails(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const details = await this.adtclient.transportDetails(args.transportNumber);
            this.trackRequest(startTime, true);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ status: 'success', details })
                }]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get transport details: ${this.formatAdtError(error)}`
            );
        }
    }

    // R3TR object types whose main source can be fetched and diffed as text.
    private static readonly DIFFABLE_TYPES: Record<string, string> = {
        CLAS: 'CLAS', PROG: 'PROG', INTF: 'INTF', FUGR: 'FUGR',
        DDLS: 'DDLS', BDEF: 'BDEF', DCLS: 'DCLS', DDLX: 'DDLX', SRVD: 'SRVD'
    };

    async handleTransportUnifiedDiff(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const transportNumber: string = args.transportNumber;
            const maxObjects: number = args.maxObjects || 20;
            const details = await this.adtclient.transportDetails(transportNumber);

            // Collect objects from the request itself and all of its tasks.
            const seen = new Set<string>();
            const objects: any[] = [];
            const collect = (objs: any[] = []) => {
                for (const o of objs) {
                    const key = `${o['tm:pgmid']}|${o['tm:type']}|${o['tm:name']}`;
                    if (!seen.has(key)) { seen.add(key); objects.push(o); }
                }
            };
            collect((details as any).objects);
            for (const task of (details as any).tasks || []) collect(task.objects);

            const diffs: any[] = [];
            const skipped: any[] = [];
            let diffed = 0;
            for (const obj of objects) {
                const type = obj['tm:type'];
                const name = obj['tm:name'];
                if (obj['tm:pgmid'] !== 'R3TR' || !TransportHandlers.DIFFABLE_TYPES[type]) {
                    skipped.push({ pgmid: obj['tm:pgmid'], type, name, reason: 'not a diffable source object' });
                    continue;
                }
                if (diffed >= maxObjects) {
                    skipped.push({ pgmid: obj['tm:pgmid'], type, name, reason: `maxObjects (${maxObjects}) reached` });
                    continue;
                }
                diffed++;
                try {
                    diffs.push(await this.diffObjectAgainstTransport(type, name, transportNumber));
                } catch (error: any) {
                    diffs.push({ type, name, error: this.formatAdtError(error) });
                }
            }

            this.trackRequest(startTime, true);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        status: 'success',
                        transport: transportNumber,
                        totalObjects: objects.length,
                        diffs,
                        skipped
                    })
                }]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to build transport diff: ${this.formatAdtError(error)}`
            );
        }
    }

    /**
     * Diff one object: current source vs the newest revision that predates the
     * transport (identified by revisions tagged with the transport number).
     */
    private async diffObjectAgainstTransport(type: string, name: string, transportNumber: string) {
        const search = await this.adtclient.searchObject(name, type, 5);
        const hit = (search || []).find(
            (r: any) => (r['adtcore:name'] || '').toUpperCase() === name.toUpperCase()
        ) || (search || [])[0];
        if (!hit) return { type, name, error: 'object not found via searchObject' };
        const uri = hit['adtcore:uri'];

        const revs = await this.adtclient.revisions(uri);
        if (!revs || revs.length === 0) return { type, name, uri, error: 'no revisions available' };
        // Newest first, defensively.
        const sorted = [...revs].sort((a, b) => (a.date < b.date ? 1 : -1));

        // Baseline: first revision older than the newest one tagged with this transport.
        const inTransport = (r: any) =>
            (r.version || '').includes(transportNumber) || (r.versionTitle || '').includes(transportNumber);
        let baseline = null as any;
        const lastIdx = sorted.map(inTransport).lastIndexOf(true);
        if (lastIdx >= 0 && lastIdx + 1 < sorted.length) {
            baseline = sorted[lastIdx + 1];
        } else if (lastIdx < 0 && sorted.length > 1) {
            // Transport tag not found in revision metadata; fall back to previous revision.
            baseline = sorted[1];
        }

        const current = await this.adtclient.getObjectSource(sorted[0].uri);
        const previous = baseline ? await this.adtclient.getObjectSource(baseline.uri) : '';
        const patch = createTwoFilesPatch(
            `${name} (${baseline ? baseline.version || baseline.date : 'new object'})`,
            `${name} (current)`,
            previous,
            current
        );
        return {
            type,
            name,
            uri,
            baselineRevision: baseline ? { version: baseline.version, date: baseline.date, title: baseline.versionTitle } : null,
            exactTransportMatch: lastIdx >= 0,
            diff: patch
        };
    }

    async handleTransportInfo(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const transportInfo = await this.adtclient.transportInfo(
                args.objSourceUrl,
                args.devClass,
                args.operation
            );
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            transportInfo
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get transport info: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleCreateTransport(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const transportResult = await this.adtclient.createTransport(
                args.objSourceUrl,
                args.REQUEST_TEXT,
                args.DEVCLASS,
                args.transportLayer
            );
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            transportNumber: transportResult,
                            message: 'Transport created successfully'
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to create transport: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleHasTransportConfig(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const hasConfig = await this.adtclient.hasTransportConfig();
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            hasConfig
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to check transport config: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleTransportConfigurations(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const configurations = await this.adtclient.transportConfigurations();
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            configurations
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get transport configurations: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleGetTransportConfiguration(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            // Links returned by transportConfigurations can carry the echoed
            // sap-client query mid-path (".../configurations?sap-client=NNN/<id>"),
            // which lands the GET on the list endpoint. Strip it.
            const url = String(args.url).replace(/\?sap-client=[^/]*(?=\/)/, '');
            const configuration = await this.adtclient.getTransportConfiguration(url);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            configuration
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get transport configuration: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleSetTransportsConfig(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.setTransportsConfig(args.uri, args.etag, args.config);
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
                `Failed to set transports config: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleCreateTransportsConfig(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.createTransportsConfig();
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
                `Failed to create transports config: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleUserTransports(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const transports = await this.adtclient.userTransports(args.user, args.targets);
            this.trackRequest(startTime, true);
            return this.buildTransportsOfUserResponse(transports, args);
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get user transports: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleTransportsByConfig(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const transports = await this.adtclient.transportsByConfig(args.configUri, args.targets);
            this.trackRequest(startTime, true);
            return this.buildTransportsOfUserResponse(transports, args);
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get transports by config: ${this.formatAdtError(error)}`
            );
        }
    }

    // Shared response shaping for userTransports/transportsByConfig, which both
    // return a TransportsOfUser ({ workbench: TransportTarget[], customizing:
    // TransportTarget[] }) - there is no single flat array field, the actual
    // volume is nested two levels down in each target's modifiable/released
    // TransportRequest[] lists. When the full structure is small it is
    // returned as-is (old shape); otherwise it is flattened into one list of
    // { category, targetName, targetDesc, listType, request } entries so it
    // can be paged/shrunk like the other handlers' top-level arrays.
    private buildTransportsOfUserResponse(result: any, args: any): any {
        const requestedPaging = args.startIndex !== undefined || args.maxItems !== undefined;

        if (!requestedPaging) {
            const text = JSON.stringify({ status: 'success', transports: result });
            if (text.length <= SAFE_OUTPUT_CHARS) {
                return { content: [{ type: 'text', text }] };
            }
        }

        const flattened: any[] = [];
        for (const category of ['workbench', 'customizing'] as const) {
            const targets = Array.isArray(result?.[category]) ? result[category] : [];
            for (const target of targets) {
                for (const listType of ['modifiable', 'released'] as const) {
                    const requests = Array.isArray(target?.[listType]) ? target[listType] : [];
                    for (const request of requests) {
                        flattened.push({
                            category,
                            targetName: target?.['tm:name'],
                            targetDesc: target?.['tm:desc'],
                            listType,
                            request
                        });
                    }
                }
            }
        }

        const totalItems = flattened.length;
        const startIndex = Math.max(0, Number(args.startIndex) || 0);
        const initialMaxItems = args.maxItems !== undefined
            ? Math.max(0, Number(args.maxItems))
            : totalItems - startIndex;

        const text = shrinkToFit(initialMaxItems, (count, capped) => {
            const endIndex = Math.min(startIndex + count, totalItems);
            const payload: any = {
                status: 'success',
                transports: flattened.slice(startIndex, endIndex),
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
    }

    async handleTransportDelete(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.transportDelete(args.transportNumber);
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
                `Failed to delete transport: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleTransportRelease(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.transportRelease(args.transportNumber, args.ignoreLocks, args.IgnoreATC);
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
                `Failed to release transport: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleTransportSetOwner(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.transportSetOwner(args.transportNumber, args.targetuser);
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
                `Failed to set transport owner: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleTransportAddUser(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.transportAddUser(args.transportNumber, args.user);
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
                `Failed to add user to transport: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleSystemUsers(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const users = await this.adtclient.systemUsers();
            this.trackRequest(startTime, true);

            const requestedPaging = args.startIndex !== undefined || args.maxItems !== undefined;

            if (!requestedPaging) {
                const text = JSON.stringify({ status: 'success', users });
                if (text.length <= SAFE_OUTPUT_CHARS) {
                    return { content: [{ type: 'text', text }] };
                }
            }

            const totalItems = users.length;
            const startIndex = Math.max(0, Number(args.startIndex) || 0);
            const initialMaxItems = args.maxItems !== undefined
                ? Math.max(0, Number(args.maxItems))
                : totalItems - startIndex;

            const text = shrinkToFit(initialMaxItems, (count, capped) => {
                const endIndex = Math.min(startIndex + count, totalItems);
                const payload: any = {
                    status: 'success',
                    users: users.slice(startIndex, endIndex),
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
                `Failed to get system users: ${this.formatAdtError(error)}`
            );
        }
    }

    async handleTransportReference(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const reference = await this.adtclient.transportReference(args.pgmid, args.obj_wbtype, args.obj_name, args.tr_number);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            reference
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get transport reference: ${this.formatAdtError(error)}`
            );
        }
    }

    /**
     * Deterministic transport choice for a write: recorded lock > preferred
     * modifiable candidate > newest modifiable candidate > none for local
     * packages > create on request.
     */
    async handleResolveTransport(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const info: any = await this.adtclient.transportInfo(args.objSourceUrl, args.devClass);
            const messages: any[] = Array.isArray(info?.MESSAGES) ? info.MESSAGES : [];
            const errors = messages.filter(m => /^[EAX]$/i.test(String(m.SEVERITY || '')));
            const devClass = info?.DEVCLASS || args.devClass || undefined;
            const recording = String(info?.RECORDING || '').toUpperCase() === 'X';
            const local = String(info?.DLVUNIT || '').toUpperCase() === 'LOCAL' || /^\$/.test(String(devClass || '')) || (!recording && !info?.LOCKS);
            const modifiable = (t: any): boolean => /^[DL]$/i.test(String(t?.TRSTATUS || ''));
            const candidates: any[] = (Array.isArray(info?.TRANSPORTS) ? info.TRANSPORTS : [])
                .filter(modifiable)
                .map((t: any) => ({ transport: t.TRKORR, description: t.AS4TEXT, status: t.TRSTATUS, owner: t.AS4USER, target: t.TARSYSTEM, date: t.AS4DATE, time: t.AS4TIME }))
                .sort((a: any, b: any) => String(b.date + b.time).localeCompare(String(a.date + a.time)));

            const done = (payload: any) => {
                this.trackRequest(startTime, true);
                return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', devClass, recording, candidates, messages, ...payload }) }] };
            };

            if (errors.length > 0) {
                throw new McpError(ErrorCode.InvalidRequest, `Transport check failed: ${errors.map(m => m.TEXT).join('; ')}`);
            }
            const lockTr = info?.LOCKS?.HEADER?.TRKORR;
            if (lockTr) {
                return done({
                    transport: lockTr, needsTransport: true,
                    reason: 'object is already recorded in this modifiable transport (transport lock); it must be used',
                    tasks: (info.LOCKS.TASKS || []).map((t: any) => t.TRKORR)
                });
            }
            if (local) {
                return done({ transport: null, needsTransport: false, reason: 'local (non-transportable) package: no transport request needed' });
            }
            if (args.preferTransport) {
                const hit = candidates.find(c => c.transport === String(args.preferTransport).toUpperCase());
                if (hit) return done({ transport: hit.transport, needsTransport: true, reason: 'preferred transport is modifiable and assigned to the current user' });
            }
            if (candidates.length > 0) {
                return done({ transport: candidates[0].transport, needsTransport: true, reason: 'newest modifiable transport of the current user for this package' + (args.preferTransport ? ' (preferTransport was not among the candidates)' : '') });
            }
            if (args.createIfMissing === true) {
                const text = args.requestText || `abap-adt-mcp: changes in ${devClass || 'package'}`;
                const created = await this.adtclient.createTransport(args.objSourceUrl, text, devClass);
                return done({ transport: created, needsTransport: true, created: true, reason: 'no modifiable transport existed; a new one was created' });
            }
            return done({ transport: null, needsTransport: true, reason: 'transportable package but no modifiable transport for the current user: call createTransport or rerun with createIfMissing=true' });
        } catch (error: any) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            throw new McpError(ErrorCode.InternalError, `Failed to resolve transport: ${this.formatAdtError(error)}`);
        }
    }
}
