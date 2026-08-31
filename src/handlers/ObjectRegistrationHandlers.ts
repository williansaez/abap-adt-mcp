import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler';
import type { ToolDefinition } from '../types/tools';

export class ObjectRegistrationHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'objectRegistrationInfo',
        description: 'Get registration information for an ABAP object',
        inputSchema: {
          type: 'object',
          properties: {
            objectUrl: { type: 'string' }
          },
          required: ['objectUrl']
        }
      },
      {
        name: 'validateNewObject',
        description: 'Validate name, package and type for a new ABAP object BEFORE calling createObject. Returns field-level validation errors. Use loadTypes to discover valid objtype values first.',
        inputSchema: {
          type: 'object',
          properties: {
            objtype: { type: 'string', description: 'ADT object type id, e.g. CLAS/OC (class), INTF/OI (interface), PROG/P (program), DEVC/K (package)' },
            objname: { type: 'string', description: 'Name of the object to create' },
            description: { type: 'string', description: 'Object description' },
            packagename: { type: 'string', description: 'Target ABAP package (required for most object types; use $TMP for local objects)' },
            fugrname: { type: 'string', description: 'Function group name (only for function group members like FUGR/FF)' }
          },
          required: ['objtype', 'objname', 'description']
        }
      },
      {
        name: 'createObject',
        description: 'Create a new ABAP object skeleton. Recommended flow: loadTypes to pick objtype (e.g. CLAS/OC) -> validateNewObject to check name/package -> createTransport if the package is not local ($TMP) -> createObject. Afterwards edit source with lock + setObjectSource, then activate with activateByName and run unitTestRun.',
        inputSchema: {
          type: 'object',
          properties: {
            objtype: { type: 'string', description: 'ADT object type id, e.g. CLAS/OC. Discover valid values with loadTypes' },
            name: { type: 'string' },
            parentName: { type: 'string', description: 'Parent object name, usually the ABAP package (e.g. $TMP or ZPACKAGE)' },
            description: { type: 'string' },
            parentPath: { type: 'string', description: 'ADT path of the parent, e.g. /sap/bc/adt/packages/$TMP' },
            responsible: { type: 'string', optional: true },
            transport: { type: 'string', optional: true, description: 'Transport request number; required for objects in transportable (non-$TMP) packages. Create one with createTransport' }
          },
          required: ['objtype', 'name', 'parentName', 'description', 'parentPath']
        }
      }
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'objectRegistrationInfo':
        return this.handleObjectRegistrationInfo(args);
      case 'validateNewObject':
        return this.handleValidateNewObject(args);
      case 'createObject':
        return this.handleCreateObject(args);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown object registration tool: ${toolName}`);
    }
  }

  async handleObjectRegistrationInfo(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      const info = await this.adtclient.objectRegistrationInfo(args.objectUrl);
      this.trackRequest(startTime, true);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'success',
            info
          })
        }]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get registration info: ${error.message || 'Unknown error'}`
      );
    }
  }

  async handleValidateNewObject(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      // Accept either the documented flat fields or a legacy JSON string in args.options
      let options = args;
      if (typeof args.options === 'string') {
        try {
          options = JSON.parse(args.options);
        } catch {
          throw new McpError(
            ErrorCode.InvalidParams,
            'validateNewObject: pass objtype/objname/description/packagename as fields (options as a JSON string is deprecated and must be valid JSON)'
          );
        }
      }
      const { objtype, objname, description, packagename, fugrname } = options;
      if (!objtype || !objname || !description) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'validateNewObject requires objtype, objname and description (plus packagename for most types, or fugrname for function group members)'
        );
      }
      const result = await this.adtclient.validateNewObject({
        objtype,
        objname,
        description,
        ...(packagename ? { packagename } : {}),
        ...(fugrname ? { fugrname } : {})
      } as any);
      this.trackRequest(startTime, true);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'success',
            result
          })
        }]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to validate new object: ${error.message || 'Unknown error'}. If validation keeps failing, check objtype via loadTypes and confirm the package exists`
      );
    }
  }

  async handleCreateObject(args: any): Promise<any> {    
    const startTime = performance.now();
    try {
      const result = await this.adtclient.createObject(
        args.objtype,
        args.name,
        args.parentName,
        args.description,
        args.parentPath,
        args.responsible,
        args.transport
      );
      this.trackRequest(startTime, true);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'success',
            result
          })
        }]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create object: ${error.message || 'Unknown error'}`
      );
    }
  }
}
