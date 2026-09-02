import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { session_types } from 'abap-adt-api';
import { withLock } from '../lib/lockLedger.js';
import { hardTruncateJson } from '../lib/responseSizing.js';

/** Build an IF_OO_ADT_CLASSRUN class around a snippet, or accept a full class. */
export function buildSnippetClass(className: string, code: string): { source: string; wrapped: boolean } {
    const name = className.toLowerCase();
    if (/\bCLASS\s+\S+\s+DEFINITION\b/i.test(code) && /\bENDCLASS\b/i.test(code)) {
        // Full class: force its name to the temporary one so create/run/delete agree.
        const source = code.replace(/\bCLASS\s+\S+\s+(DEFINITION|IMPLEMENTATION)\b/gi, `CLASS ${name} $1`);
        return { source, wrapped: false };
    }
    const body = code.split(/\r?\n/).map(l => (l.trim() ? '    ' + l : l)).join('\n');
    const source = [
        `CLASS ${name} DEFINITION PUBLIC FINAL CREATE PUBLIC.`,
        '  PUBLIC SECTION.',
        '    INTERFACES if_oo_adt_classrun.',
        'ENDCLASS.',
        '',
        `CLASS ${name} IMPLEMENTATION.`,
        '  METHOD if_oo_adt_classrun~main.',
        body,
        '  ENDMETHOD.',
        'ENDCLASS.',
        ''
    ].join('\n');
    return { source, wrapped: true };
}

export function snippetClassName(seed: string): string {
    const clean = seed.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
    return `ZCL_MCP_SNIP_${clean.padEnd(6, '0')}`;
}

export class SnippetHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'runSnippet',
                description: 'Run a piece of ABAP once and return its console output: wraps the code in a temporary IF_OO_ADT_CLASSRUN class (the "out" parameter is available: out->write( ... )), creates it in packageName (default $TMP; on S/4HANA Cloud use a customer package with ABAP for Cloud Development plus its transport, $TMP is refused there), activates, runs it, and deletes it again unless keep=true. A full CLASS … DEFINITION/IMPLEMENTATION implementing if_oo_adt_classrun is accepted as well. Activation errors are returned with messages instead of running. Pass responsible (your SAP user) on cloud systems.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        code: { type: 'string', description: 'ABAP statements for the main method (or a complete class implementing if_oo_adt_classrun)' },
                        packageName: { type: 'string', description: 'Package for the temporary class (default $TMP)', optional: true },
                        className: { type: 'string', description: 'Name of the temporary class (default ZCL_MCP_SNIP_xxxxxx)', optional: true },
                        transport: { type: 'string', description: 'Transport request, only for transportable packages', optional: true },
                        responsible: { type: 'string', description: 'SAP user set as responsible (required by some cloud systems)', optional: true },
                        keep: { type: 'boolean', description: 'Keep the class after running (default false: it is deleted)', optional: true }
                    },
                    required: ['code']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        if (toolName !== 'runSnippet') throw new McpError(ErrorCode.MethodNotFound, `Unknown snippet tool: ${toolName}`);
        return this.handleRunSnippet(args);
    }

    async handleRunSnippet(args: any): Promise<any> {
        const startTime = performance.now();
        const packageName = String(args.packageName || '$TMP').toUpperCase();
        const className = String(args.className || snippetClassName(String(Date.now().toString(36)))).toUpperCase();
        const classUrl = `/sap/bc/adt/oo/classes/${encodeURIComponent(className.toLowerCase())}`;
        const sourceUrl = `${classUrl}/source/main`;
        const steps: string[] = [];
        let created = false;
        const cleanup = async (): Promise<string | undefined> => {
            if (!created || args.keep === true) return undefined;
            try {
                this.adtclient.stateful = session_types.stateful;
                await withLock(this.adtclient, classUrl, undefined, (h) => this.adtclient.deleteObject(classUrl, h, args.transport), { keepOnSuccess: true });
                steps.push('deleted');
                created = false;
                return undefined;
            } catch (e: any) {
                return `temporary class ${className} could not be deleted: ${this.formatAdtError(e)}`;
            }
        };
        try {
            const { source, wrapped } = buildSnippetClass(className, String(args.code));
            this.adtclient.stateful = session_types.stateful;
            await this.adtclient.createObject('CLAS/OC', className, packageName, 'abap-adt-mcp temporary snippet', `/sap/bc/adt/packages/${encodeURIComponent(packageName.toLowerCase())}`, args.responsible ? String(args.responsible).toUpperCase() : undefined, args.transport);
            created = true;
            steps.push('created');

            await withLock(this.adtclient, classUrl, undefined, (h) => this.adtclient.setObjectSource(sourceUrl, source, h, args.transport));
            steps.push('source written');

            const activation: any = await this.adtclient.activate(className, classUrl);
            if (activation && activation.success === false) {
                const cleanupError = await cleanup();
                this.trackRequest(startTime, false);
                return { content: [{ type: 'text', text: JSON.stringify({
                    status: 'error', phase: 'activation', className, wrapped,
                    messages: activation.messages, steps, cleanupError,
                    hint: 'Fix the code and call runSnippet again. Line numbers refer to the generated class: the snippet body starts at line 8.'
                }) }], isError: true };
            }
            steps.push('activated');

            const output = await this.adtclient.runClass(className);
            steps.push('ran');
            const cleanupError = await cleanup();
            this.trackRequest(startTime, true);
            const payload: any = { status: 'success', className, packageName, wrapped, kept: args.keep === true, output, steps, cleanupError };
            const text = JSON.stringify(payload);
            return { content: [{ type: 'text', text: text.length > 40000 ? hardTruncateJson(payload) : text }] };
        } catch (error: any) {
            const cleanupError = await cleanup();
            this.trackRequest(startTime, false);
            if (error instanceof McpError) throw error;
            const detail = this.formatAdtError(error);
            const hint = /S_ABPLNGVS|language version/i.test(detail) && packageName === '$TMP'
                ? ' Hint: on S/4HANA Cloud objects in $TMP get the Standard ABAP language version, which cloud users may not change. Pass packageName with a customer package (ABAP for Cloud Development) and, if it is transportable, the transport from resolveTransport.'
                : '';
            throw new McpError(ErrorCode.InternalError, `runSnippet failed after ${steps.join(', ') || 'nothing'}: ${detail}${cleanupError ? ` (${cleanupError})` : ''}${hint}`);
        }
    }
}
