---
name: abap-adt-mcp-setup
description: Install and configure the abap-adt-mcp MCP server for an MCP host (Claude Code, Claude Desktop, Cursor, VS Code): systems.json with destinations and policies, authentication modes (browser SSO for S/4HANA Cloud, basic, OAuth), toolsets, and a first health check. Use when someone wants to connect an AI agent to an SAP ABAP system through ADT.
---

# Setting up abap-adt-mcp

## 1. Describe the SAP systems
Create `~/.abap-adt-mcp/systems.json` (mode 0600) with one entry per destination:

```json
{
  "DEV": { "url": "https://myXXXXXX.s4hana.cloud.sap", "client": "080", "authType": "sso", "default": true,
           "policy": { "allowedPackages": ["Z*", "$*"] } },
  "PRD": { "url": "https://myYYYYYY.s4hana.cloud.sap", "client": "100", "authType": "sso",
           "policy": { "readOnly": true, "deniedTables": ["PA*", "HR*"], "allowFreeSql": false } },
  "ECC": { "url": "https://sap.example.com:44300", "client": "100", "authType": "basic",
           "user": "DEVELOPER", "password": "***", "insecureTls": true }
}
```

- `authType`: `sso` opens a browser once per host and keeps a persistent profile (S/4HANA Cloud with IAS); `basic` for on-prem users; `oauth` with `oauth.tokenUrl/clientId/clientSecret` for a communication arrangement.
- `policy` is enforced by the server before any SAP call: `readOnly`, `deniedTools`, `allowFreeSql`, `deniedTables`, `allowedPackages`, `allowedTransports` (globs). `MCP_READ_ONLY=1` makes everything read-only.

## 2. Register the server in the host
Server key `abap-adt-mcp` (keep this key: public ABAP skills route by it).

Claude Code (`.mcp.json` or `claude mcp add`):
```json
{ "mcpServers": { "abap-adt-mcp": {
  "command": "npx", "args": ["-y", "abap-adt-mcp"],
  "env": { "SAP_SYSTEMS_FILE": "/Users/me/.abap-adt-mcp/systems.json" }
} } }
```
From a source checkout use `"command": "node", "args": ["/abs/path/abap-adt-mcp/dist/index.js"]` after `npm ci && npm run build`.

Useful environment variables: `MCP_TOOLSETS=focused` (114 development tools instead of 173) or a comma list of toolsets, `MCP_DISABLED_TOOLSETS=debugger,traces`, `MCP_MAX_RESPONSE_CHARS`, `MCP_HTTP_PORT` (Streamable HTTP with bearer token, `MCP_HTTP_HOST=0.0.0.0` only in containers).

## 3. Verify
1. `healthcheck`: version, destinations, active toolsets, tool count.
2. `listSystems`: every destination with its policy.
3. `login(destination)` for SSO destinations (browser window once).
4. `systemProfile(destination)`: platform and unavailable toolsets.
5. `searchObject(query="CL_ABAP_CHAR_UTILITIES")` then `getObjectSource` on the result: proves read access.

## 4. Troubleshooting
- `kind: "sessionExpired"` persisting: run `login` again; the SSO profile lives under `~/.abap-adt-mcp/sso/<host>`.
- Tool refused with `policyDenied`: adjust the destination's `policy`.
- Tool refused as unavailable: the system lacks that ADT collection (see `systemProfile`); when the debugger toolset is missing use `dumps`/`dumpDetails`. `MCP_PROFILE_GATE=warn` logs instead of refusing, `off` disables the gate.
- Node 18+ required; Node 22 recommended.
