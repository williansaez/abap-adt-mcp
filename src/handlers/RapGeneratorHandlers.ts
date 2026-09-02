import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler';
import type { ToolDefinition } from '../types/tools';

const GEN_ID = {
  type: 'string',
  enum: ['uiservice', 'webapiservice'],
  description: 'Generator id: uiservice (OData UI service) or webapiservice (Web API service)'
};
const REF_URI = {
  type: 'string',
  description: 'ADT URI of the reference object the generation starts from, typically a database table or CDS entity (e.g. /sap/bc/adt/ddic/tables/ztravel)'
};
const CONTENT = {
  type: 'string',
  description: 'JSON string of the generator content, following the schema returned by rapGenGetSchema: { metadata?, general: { referenceObjectName?, description }, businessObject: { dataModelEntity: { cdsName, entityName? }, behavior: { implementationType, implementationClass, draftTable } }, serviceProjection: { name }, businessService: { serviceDefinition: { name }, serviceBinding: { name, bindingType } } }'
};

/**
 * RAP repository-object generation (tables -> CDS views, behavior definitions,
 * service definitions/bindings), mirroring SAP's official ADT MCP Server
 * abap_generators-* toolset. Wraps the rapGen* API of abap-adt-api.
 */
export class RapGeneratorHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'rapGenIsAvailable',
        description: 'Check whether RAP repository-object generators are available on this system. Call before the other rapGen* tools.',
        inputSchema: {
          type: 'object',
          properties: {
            genId: { ...GEN_ID, optional: true }
          }
        }
      },
      {
        name: 'rapGenGetSchema',
        description: 'Get the JSON schema describing the input content of a RAP generator. Use it to build the content for rapGenValidateContent / rapGenPreview / rapGenGenerate.',
        inputSchema: {
          type: 'object',
          properties: {
            genId: GEN_ID,
            refObjectUri: REF_URI,
            packageName: { type: 'string', description: 'Target ABAP package' }
          },
          required: ['genId', 'refObjectUri', 'packageName']
        }
      },
      {
        name: 'rapGenGetContent',
        description: 'Get the proposed default generator content (names for CDS entities, behavior class, service definition/binding) for a reference object. Adjust and pass to rapGenValidateContent / rapGenGenerate.',
        inputSchema: {
          type: 'object',
          properties: {
            genId: GEN_ID,
            refObjectUri: REF_URI,
            packageName: { type: 'string', description: 'Target ABAP package' }
          },
          required: ['genId', 'refObjectUri', 'packageName']
        }
      },
      {
        name: 'rapGenValidateInitial',
        description: 'Validate that generation can start from the given reference object and package (run before rapGenGetContent).',
        inputSchema: {
          type: 'object',
          properties: {
            genId: GEN_ID,
            refObjectUri: REF_URI,
            packageName: { type: 'string', description: 'Target ABAP package' }
          },
          required: ['genId', 'refObjectUri', 'packageName']
        }
      },
      {
        name: 'rapGenValidateContent',
        description: 'Validate a full generator content (names, package, conflicts) BEFORE generating. Recommended flow: rapGenGetContent -> adjust -> rapGenValidateContent -> rapGenPreview -> rapGenGenerate.',
        inputSchema: {
          type: 'object',
          properties: {
            genId: GEN_ID,
            refObjectUri: REF_URI,
            content: CONTENT
          },
          required: ['genId', 'refObjectUri', 'content']
        }
      },
      {
        name: 'rapGenPreview',
        description: 'Preview the list of repository objects a generation would create (CDS views, behavior definition, service definition/binding) without creating anything.',
        inputSchema: {
          type: 'object',
          properties: {
            genId: GEN_ID,
            refObjectUri: REF_URI,
            content: CONTENT
          },
          required: ['genId', 'refObjectUri', 'content']
        }
      },
      {
        name: 'rapGenGenerate',
        description: 'Generate the RAP repository objects (CDS views, behavior definition, service definition/binding) on the system. Requires a transport (createTransport). Validate with rapGenValidateContent and inspect rapGenPreview first. Activate the generated objects afterwards with activateObjects.',
        inputSchema: {
          type: 'object',
          properties: {
            genId: GEN_ID,
            refObjectUri: REF_URI,
            transport: { type: 'string', description: 'Transport request number (see createTransport)' },
            content: CONTENT
          },
          required: ['genId', 'refObjectUri', 'transport', 'content']
        }
      },
      {
        name: 'rapGenPublishService',
        description: 'Publish a generated service binding so its OData service becomes callable (alternative to publishServiceBinding for rapGen-created bindings).',
        inputSchema: {
          type: 'object',
          properties: {
            srvbName: { type: 'string', description: 'Name of the service binding to publish' }
          },
          required: ['srvbName']
        }
      }
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'rapGenIsAvailable':
        return this.run(() => this.adtclient.rapGenIsAvailable(args.genId), 'check generator availability');
      case 'rapGenGetSchema':
        return this.run(() => this.adtclient.rapGenGetSchema(args.genId, args.refObjectUri, args.packageName), 'get generator schema');
      case 'rapGenGetContent':
        return this.run(() => this.adtclient.rapGenGetContent(args.genId, args.refObjectUri, args.packageName), 'get generator content proposal');
      case 'rapGenValidateInitial':
        return this.run(() => this.adtclient.rapGenValidateInitial(args.genId, args.refObjectUri, args.packageName, args.checks), 'validate generation start');
      case 'rapGenValidateContent':
        return this.run(() => this.adtclient.rapGenValidateContent(args.genId, args.refObjectUri, this.parseContent(args.content)), 'validate generator content');
      case 'rapGenPreview':
        return this.run(() => this.adtclient.rapGenPreview(args.genId, args.refObjectUri, this.parseContent(args.content)), 'preview generation');
      case 'rapGenGenerate':
        return this.run(() => this.adtclient.rapGenGenerate(args.genId, args.refObjectUri, args.transport, this.parseContent(args.content)), 'generate objects');
      case 'rapGenPublishService':
        return this.run(() => this.adtclient.rapGenPublishService(args.srvbName), 'publish service binding');
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown RAP generator tool: ${toolName}`);
    }
  }

  private parseContent(content: any): any {
    if (typeof content !== 'string') return content;
    try {
      return JSON.parse(content);
    } catch {
      throw new McpError(ErrorCode.InvalidParams, 'content must be a JSON string matching the schema from rapGenGetSchema');
    }
  }

  private async run(fn: () => Promise<any>, action: string): Promise<any> {
    const startTime = performance.now();
    try {
      const result = await fn();
      this.trackRequest(startTime, true);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ status: 'success', result })
        }]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to ${action}: ${this.formatAdtError(error)}`
      );
    }
  }
}
