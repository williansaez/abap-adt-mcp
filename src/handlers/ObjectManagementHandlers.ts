import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler';
import type { ToolDefinition } from '../types/tools';
import { shrinkToFit, SAFE_OUTPUT_CHARS } from '../lib/responseSizing';
import { walkPackage } from '../lib/packageWalk';

interface InactiveObject {
  "adtcore:uri": string;
  "adtcore:type": string;
  "adtcore:name": string;
  "adtcore:parentUri": string;
}

interface ActivationResultMessage {
  objDescr: string;
  type: string;
  line: number;
  href: string;
  forceSupported: boolean;
  shortText: string;
}

interface ActivationResult {
  success: boolean;
  messages: ActivationResultMessage[];
  inactive: InactiveObjectRecord[];
}

interface InactiveObjectElement extends InactiveObject {
  user: string;
  deleted: boolean;
}

interface InactiveObjectRecord {
  object?: InactiveObjectElement;
  transport?: InactiveObjectElement;
}

export class ObjectManagementHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'activateObjects',
        description: 'Activate ABAP objects using object references. Run after setObjectSource; the entries returned by inactiveObjects can be passed here directly. For a single object, activateByName is simpler.',
        inputSchema: {
          type: 'object',
          properties: {
            objects: { 
              type: 'string',
              description: 'JSON array of objects to activate. Each object must have adtcore:uri, adtcore:type, adtcore:name, and adtcore:parentUri properties'
            },
            preauditRequested: {
              type: 'boolean',
              description: 'Whether to perform pre-audit checks',
              optional: true
            }
          },
          required: ['objects']
        }
      },
      {
        name: 'activateByName',
        description: 'Activate a single ABAP object by name and URL. Run after setObjectSource (and unLock); after activation run unitTestRun to verify behavior.',
        inputSchema: {
          type: 'object',
          properties: {
            objectName: {
              type: 'string',
              description: 'Name of the object'
            },
            objectUrl: {
              type: 'string',
              description: 'URL of the object'
            },
            mainInclude: {
              type: 'string',
              description: 'Main include context',
              optional: true
            },
            preauditRequested: {
              type: 'boolean',
              description: 'Whether to perform pre-audit checks',
              optional: true
            }
          },
          required: ['objectName', 'objectUrl']
        }
      },
      {
        name: 'activatePackage',
        description: 'Activate every inactive object of a package (and its sub-packages) in one activation request, the way RAP stacks (CDS, behavior definition, service definition, classes) must be activated together. Returns the activation messages and what is still inactive afterwards.',
        inputSchema: {
          type: 'object',
          properties: {
            packageName: { type: 'string', description: 'Package whose inactive objects to activate' },
            recursive: { type: 'boolean', description: 'Include sub-packages (default true)', optional: true },
            user: { type: 'string', description: 'Only inactive objects of this SAP user (default: the connected user; other users\' unfinished work is left alone and listed)', optional: true },
            allUsers: { type: 'boolean', description: 'Activate inactive objects of every user in the package tree (default false)', optional: true },
            preauditRequested: { type: 'boolean', description: 'Run the pre-audit (default true)', optional: true }
          },
          required: ['packageName']
        }
      },
      {
        name: 'inactiveObjects',
        description: 'Get list of inactive objects. For systems with many inactive objects across users, use startIndex/maxItems to page through the list instead of retrieving it all at once.',
        inputSchema: {
          type: 'object',
          properties: {
            startIndex: {
              type: 'number',
              description: '0-based index of the inactive-object record to start from (default 0). Use with maxItems to page through a large list.',
              optional: true
            },
            maxItems: {
              type: 'number',
              description: 'Maximum number of inactive-object records to return from startIndex. Omit to return the rest.',
              optional: true
            }
          }
        }
      }
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'activateObjects':
        return this.handleActivateObjects(args);
      case 'activateByName':
        return this.handleActivateByName(args);
      case 'activatePackage':
        return this.handleActivatePackage(args);
      case 'inactiveObjects':
        return this.handleInactiveObjects(args);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown object management tool: ${toolName}`);
    }
  }

  async handleActivateObjects(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      if (!args.objects || typeof args.objects !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, "objects parameter must be a JSON string");
      }

      let objects: InactiveObject[];
      try {
        objects = JSON.parse(args.objects);
        if (!Array.isArray(objects)) {
          throw new Error("Parsed objects must be an array");
        }
        
        // Validate each object has required properties
        objects.forEach((obj, index) => {
          if (!obj["adtcore:uri"] || !obj["adtcore:type"] || 
              !obj["adtcore:name"] || !obj["adtcore:parentUri"]) {
            throw new Error(`Object at index ${index} is missing required properties`);
          }
        });
      } catch (parseError: any) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid objects JSON: ${parseError.message}`
        );
      }

      const result = await this.adtclient.activate(objects, args.preauditRequested);
      this.trackRequest(startTime, true);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result)
        }]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to activate objects: ${this.formatAdtError(error)}`
      );
    }
  }

  async handleActivateByName(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      if (!args.objectName || !args.objectUrl) {
        throw new McpError(ErrorCode.InvalidParams, "objectName and objectUrl parameters are required");
      }

      const result = await this.adtclient.activate(
        args.objectName,
        args.objectUrl,
        args.mainInclude,
        args.preauditRequested
      );
      this.trackRequest(startTime, true);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result)
        }]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to activate object: ${this.formatAdtError(error)}`
      );
    }
  }

  async handleInactiveObjects(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      const result: InactiveObjectRecord[] = await this.adtclient.inactiveObjects();
      this.trackRequest(startTime, true);

      const requestedPaging = args.startIndex !== undefined || args.maxItems !== undefined;

      if (!requestedPaging) {
        const text = JSON.stringify(result);
        if (text.length <= SAFE_OUTPUT_CHARS) {
          return { content: [{ type: 'text', text }] };
        }
      }

      const totalObjects = result.length;
      const startIndex = Math.max(0, Number(args.startIndex) || 0);
      const initialMaxItems = args.maxItems !== undefined
        ? Math.max(0, Number(args.maxItems))
        : totalObjects - startIndex;

      const text = shrinkToFit(initialMaxItems, (count, capped) => {
        const endIndex = Math.min(startIndex + count, totalObjects);
        const payload: any = {
          status: 'success',
          result: result.slice(startIndex, endIndex),
          totalObjects,
          startIndex,
          returnedObjects: Math.max(0, endIndex - startIndex),
          hasMore: endIndex < totalObjects
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
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get inactive objects: ${this.formatAdtError(error)}`
      );
    }
  }

  /** Inactive objects that belong to the package tree (by parent URI or by object URL prefix). */
  /** The SAP user of this session when known; SSO/OAuth clients carry a placeholder instead of a real name. */
  private ownUser(): string | undefined {
    const u = String((this.adtclient as any).username || '').toUpperCase();
    return u && !['SSO', 'OAUTH', 'BROWSER'].includes(u) ? u : undefined;
  }

  private async inactiveInPackage(packageName: string, recursive: boolean, user: string | undefined): Promise<{ objects: any[]; packages: string[]; otherUsers: any[] }> {
    const walk = await walkPackage(this.adtclient as any, packageName, { maxDepth: recursive ? 99 : 0, includeObjects: true, maxObjects: 5000 });
    const pkgUrls = new Set(walk.packageUrls.map(u => u.toLowerCase()));
    const objUrls = walk.objects.map(o => o.objectUrl.toLowerCase());
    const records: any[] = await this.adtclient.inactiveObjects();
    const inTree = records
      .filter(r => r?.object && r.object['adtcore:uri'])
      .filter(r => {
        const o = r.object;
        const parent = String(o['adtcore:parentUri'] || '').toLowerCase();
        const uri = String(o['adtcore:uri']).toLowerCase();
        return pkgUrls.has(parent) || objUrls.some(u => uri === u || uri.startsWith(u + '/'));
      });
    const owner = (r: any) => String(r.user || r.object?.['adtcore:responsible'] || '').toUpperCase();
    const mine = user ? inTree.filter(r => !owner(r) || owner(r) === user) : inTree;
    const otherUsers = user ? inTree.filter(r => owner(r) && owner(r) !== user).map(r => ({ name: r.object['adtcore:name'], type: r.object['adtcore:type'], user: owner(r) })) : [];
    const objects = mine.map(r => r.object).map(o => ({ 'adtcore:uri': o['adtcore:uri'], 'adtcore:type': o['adtcore:type'], 'adtcore:name': o['adtcore:name'], 'adtcore:parentUri': o['adtcore:parentUri'] }));
    return { objects, packages: walk.packages, otherUsers };
  }

  async handleActivatePackage(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      const recursive = args.recursive !== false;
      const user = args.allUsers === true ? undefined : (args.user ? String(args.user).toUpperCase() : this.ownUser());
      const warning = !user && args.allUsers !== true ? 'The connected user is not known for this authentication mode (SSO/OAuth): inactive objects of every user in the package tree are activated. Pass user=<SAP user> to restrict, or allUsers=true to silence this.' : undefined;
      const { objects, packages, otherUsers } = await this.inactiveInPackage(String(args.packageName), recursive, user);
      if (objects.length === 0) {
        this.trackRequest(startTime, true);
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', packages, user: user || 'all', ...(warning ? { warning } : {}), activated: 0, message: 'No inactive objects in the package tree' + (otherUsers.length ? ` for this user (${otherUsers.length} of other users left alone)` : ''), ...(otherUsers.length ? { otherUsers: otherUsers.slice(0, 50) } : {}) }) }] };
      }
      const result: any = await this.adtclient.activate(objects, args.preauditRequested !== false);
      const after = await this.inactiveInPackage(String(args.packageName), recursive, user);
      this.trackRequest(startTime, true);
      const payload = {
        status: result?.success === false ? 'error' : 'success',
        packages,
        user: user || 'all',
        ...(warning ? { warning } : {}),
        ...(otherUsers.length ? { otherUsers: otherUsers.slice(0, 50) } : {}),
        requested: objects.map(o => ({ name: o['adtcore:name'], type: o['adtcore:type'], uri: o['adtcore:uri'] })),
        success: result?.success !== false,
        messages: result?.messages || [],
        stillInactive: after.objects.map(o => ({ name: o['adtcore:name'], type: o['adtcore:type'], uri: o['adtcore:uri'] })),
      };
      const text = JSON.stringify(payload);
      return { content: [{ type: 'text', text: text.length <= SAFE_OUTPUT_CHARS ? text : JSON.stringify({ ...payload, requested: payload.requested.length, messages: payload.messages.slice(0, 50), stillInactive: payload.stillInactive.slice(0, 50), capped: true }) }], ...(result?.success === false ? { isError: true } : {}) };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw new McpError(ErrorCode.InternalError, `Failed to activate package: ${this.formatAdtError(error)}`);
    }
  }
}
