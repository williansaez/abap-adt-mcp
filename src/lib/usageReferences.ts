import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { ADTClient } from 'abap-adt-api';
import { httpStatusOf } from './adtErrorHints.js';

/**
 * usageReferences with a readable 404. SAP_BASIS 7.40 has no
 * /sap/bc/adt/repository/informationsystem/usageReferences (its discovery
 * offers only the older .../informationsystem/whereused protocol, which this
 * server does not speak), so a bare Not Found there says nothing useful.
 */
export async function usageReferencesExplained(client: ADTClient, url: string, line?: number, column?: number) {
    try {
        return await (line === undefined && column === undefined ? client.usageReferences(url) : client.usageReferences(url, line, column));
    } catch (error: any) {
        if (httpStatusOf(error) === 404) {
            throw new McpError(ErrorCode.InvalidRequest, `Where-used answered 404 for ${url}. On SAP_BASIS 7.40 and older the usageReferences resource does not exist (the release offers only the older where-used service, not supported here): use the where-used list in SAP GUI. On a newer release, check the object URL with searchObject.`);
        }
        throw error;
    }
}
