export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, {
      type: string;
      description?: string;
      optional?: boolean;
      enum?: string[];
      /** Required for type 'array': VS Code rejects the whole request on an array without items. */
      items?: Record<string, unknown>;
    }>;
    required?: string[];
  };
  /** MCP tool annotations; when omitted the server derives them centrally. */
  annotations?: ToolAnnotations;
}
