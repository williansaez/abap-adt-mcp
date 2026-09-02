import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler';
import type { ToolDefinition } from '../types/tools';
import { CreatableTypes } from 'abap-adt-api';

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
        name: 'creatableTypeDetails',
        description: 'List the object types createObject supports, with per-type required fields, label and max name length (SAP-style get_object_type_details). Filter with typeId. For the system-reported creatable catalog see loadTypes.',
        inputSchema: {
          type: 'object',
          properties: {
            typeId: { type: 'string', description: 'Optional type id filter, e.g. CLAS/OC', optional: true }
          }
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
            fugrname: { type: 'string', description: 'Function group name (only for function group members like FUGR/FF)' },
            swcomp: { type: 'string', description: 'Software component (DEVC/K only), e.g. HOME or ZLOCAL' },
            transportLayer: { type: 'string', description: 'Transport layer (DEVC/K only); empty for local/cloud packages' },
            packagetype: { type: 'string', description: 'Package type (DEVC/K only): development, structure or main' }
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
            transport: { type: 'string', optional: true, description: 'Transport request number; required for objects in transportable (non-$TMP) packages. Create one with createTransport' },
            swcomp: { type: 'string', optional: true, description: 'Software component; required when objtype is DEVC/K (e.g. HOME, ZLOCAL, ZCUSTOM_DEVELOPMENT)' },
            transportLayer: { type: 'string', optional: true, description: 'Transport layer for DEVC/K (e.g. YDEV); omit or empty for local packages' },
            packagetype: { type: 'string', optional: true, description: 'Package type for DEVC/K: development (default), structure or main' },
            recordChanges: { type: 'boolean', optional: true, description: 'DEVC/K only: record changes in transport requests (default true when a transportLayer is given; cloud systems require it)' },
            abapLanguageVersion: { type: 'string', optional: true, description: 'DEVC/K only: ABAP language version attribute, e.g. 5 = ABAP for Cloud Development. Omit to let the system decide' }
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
      case 'creatableTypeDetails':
        return this.handleCreatableTypeDetails(args);
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
        `Failed to get registration info: ${this.formatAdtError(error)}`
      );
    }
  }

  handleCreatableTypeDetails(args: any): any {
    const requiredFieldsFor = (typeId: string): string[] => {
      const base = ['objtype', 'objname', 'description'];
      if (typeId === 'DEVC/K') return [...base, 'packagename', 'swcomp', 'transportLayer', 'packagetype'];
      if (typeId === 'FUGR/FF' || typeId === 'FUGR/I') return [...base, 'fugrname'];
      if (typeId === 'SRVB/SVB') return [...base, 'package', 'serviceDefinition', 'serviceBindingVersion'];
      return [...base, 'packagename'];
    };
    let types = [...CreatableTypes.values()].map((t: any) => ({
      typeId: t.typeId,
      label: t.label,
      maxNameLength: t.maxLen,
      requiredValidationFields: requiredFieldsFor(t.typeId),
      createWith: t.typeId === 'DEVC/K'
        ? 'createObject (objtype, name, parentName=superpackage, description, parentPath, swcomp, transportLayer?, packagetype?)'
        : 'createObject (objtype, name, parentName=package, description, parentPath)'
    }));
    if (args.typeId) types = types.filter((t) => t.typeId === args.typeId);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ status: 'success', types })
      }]
    };
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
      const { objtype, objname, description, packagename, fugrname, swcomp, transportLayer, packagetype } = options;
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
        ...(fugrname ? { fugrname } : {}),
        ...(objtype === 'DEVC/K' ? {
          swcomp: swcomp ?? '',
          transportLayer: transportLayer ?? '',
          packagetype: packagetype ?? 'development'
        } : {})
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
        `Failed to validate new object: ${this.formatAdtError(error)}. If validation keeps failing, check objtype via loadTypes and confirm the package exists`
      );
    }
  }

  /**
   * Create a DEVC/K package with a hand-built ADT body. abap-adt-api's own
   * package body omits pak:recordChanges, which transportable packages on
   * S/4HANA Cloud reject ("Change recording must be activated").
   */
  private async createPackage(args: any): Promise<void> {
    const xmlEsc = (s: string) => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const h = (this.adtclient as any).httpClient;
    // Only args.responsible: the SSO flow logs in with a placeholder username
    // ("sso"), which SAP rejects as the person responsible; omitting the
    // attribute makes the backend default to the actual session user.
    const responsible = (args.responsible || '').toUpperCase();
    const recordChanges = args.recordChanges ?? !!args.transportLayer;
    const attrs = [
      `pak:packageType="${xmlEsc(args.packagetype ?? 'development')}"`,
      `pak:recordChanges="${recordChanges ? 'true' : 'false'}"`,
      ...(args.abapLanguageVersion ? [`pak:languageVersion="${xmlEsc(args.abapLanguageVersion)}"`] : [])
    ].join(' ');
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<pak:package xmlns:pak="http://www.sap.com/adt/packages" xmlns:adtcore="http://www.sap.com/adt/core"
 adtcore:description="${xmlEsc(args.description)}" adtcore:name="${xmlEsc(args.name)}"
 adtcore:type="DEVC/K" adtcore:version="active"${responsible ? ` adtcore:responsible="${xmlEsc(responsible)}"` : ''}>
<pak:attributes ${attrs}/>
<pak:superPackage${args.parentName ? ` adtcore:name="${xmlEsc(args.parentName)}"` : ''}/>
<pak:applicationComponent/>
<pak:transport>
 <pak:softwareComponent pak:name="${xmlEsc(args.swcomp)}"/>
 <pak:transportLayer pak:name="${xmlEsc(args.transportLayer ?? '')}"/>
</pak:transport>
<pak:translation/>
<pak:useAccesses/>
<pak:packageInterfaces/>
<pak:subPackages/>
</pak:package>`;
    const qs: Record<string, string> = {};
    if (args.transport) qs.corrNr = args.transport;
    await h.request('/sap/bc/adt/packages', {
      body,
      headers: { 'Content-Type': 'application/*' },
      method: 'POST',
      qs
    });
  }

  async handleCreateObject(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      let result;
      if (args.objtype === 'DEVC/K') {
        if (!args.swcomp) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'createObject for DEVC/K (package) requires swcomp (software component, e.g. HOME or ZLOCAL); transportLayer and packagetype are optional (defaults: empty transport layer, packagetype development)'
          );
        }
        result = await this.createPackage(args);
      } else {
        result = await this.adtclient.createObject(
          args.objtype,
          args.name,
          args.parentName,
          args.description,
          args.parentPath,
          args.responsible,
          args.transport
        );
      }
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
        `Failed to create object: ${this.formatAdtError(error)}`
      );
    }
  }
}
