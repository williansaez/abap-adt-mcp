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
    }>;
    required?: string[];
  };
  /** MCP tool annotations; when omitted the server derives them centrally. */
  annotations?: ToolAnnotations;
}
