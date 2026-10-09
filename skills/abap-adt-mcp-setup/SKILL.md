---
name: abap-adt-mcp-setup
description: Install and configure the abap-adt-mcp MCP server for an MCP host (Claude Code, Claude Desktop, Cursor, VS Code): systems.json with destinations and policies, authentication modes (browser SSO for S/4HANA Cloud, basic, OAuth), toolsets, and a first health check. Use when someone wants to connect an AI agent to an SAP ABAP system through ADT.
---

# Setting up abap-adt-mcp

## 0. Check the ground first
Do this before writing any file; most failed installs stop here.
1. Where is the user talking to you? The plugin's MCP server runs in Claude Code (terminal, the Code tab of the desktop app, VS Code) and in Cowork sessions on the user's computer. Plain chat in Claude Desktop loads this skill but never starts the server: there the server goes into `claude_desktop_config.json` by hand (section 2, without the plugin). The plugin never writes that file.
2. Run `node -v` (22.12 or newer) and `which npx` (`where npx` on Windows). Node from nvm, fnm or Homebrew is often invisible to GUI apps on macOS: the host log then shows `spawn npx ENOENT`. Fix by giving the full path of `npx` as `command`, or install Node from nodejs.org.
3. Run `npx -y abap-adt-mcp --check`. It prints one line per check (Node, systems file, every destination over HTTPS with its TLS settings, a browser for SSO) and exits 1 when something must be fixed. Before step 1 it reports the missing systems file; that is expected. No credentials are sent.

## 1. Describe the SAP systems
Create `~/.abap-adt-mcp/systems.json` (mode 0600) with one entry per destination:

```json
{
  "DEV": { "url": "https://myXXXXXX.s4hana.cloud.sap", "client": "080", "authType": "sso", "default": true,
           "policy": { "allowedPackages": ["Z*"] } },
  "PRD": { "url": "https://myYYYYYY.s4hana.cloud.sap", "client": "100", "authType": "sso",
           "policy": { "readOnly": true, "allowDataPreview": true, "deniedTables": ["PA*", "HR*"] } },
  "ECC": { "url": "https://sap.example.com:44300", "client": "100", "authType": "basic",
           "user": "DEVELOPER", "password": "${env:ECC_PASSWORD}",
           "policy": { "allowedPackages": ["Z*", "$*"] }, "tls": { "ca": "/etc/ssl/corp-ca.pem" } }
}
```

- `authType`: `sso` opens a browser once per host and keeps a persistent profile (S/4HANA Cloud with IAS); `basic` for on-prem users; `oauth` with `oauth.tokenUrl/clientId/clientSecret` for a communication arrangement.
- On-prem systems below SAP_BASIS 7.51 (SAP ERP 6.0 EHP7 is 7.40, EHP8 is 7.50) read over HTTP but cannot write: locks do not survive between HTTP requests (the write fails with 423 `invalid lock handle`). Ask the user for the release, or which ERP it is, before the first write. For such a system add `"transport": "rfc"` and `"rfc": { "ashost": "<host>", "sysnr": "<2 digits>", "sdkPath": "<folder>" }` to its entry. It needs the SAP NetWeaver RFC SDK, which the user must download themselves with their S-user from https://me.sap.com/softwarecenter/search/SAP%20NW%20RFC%20SDK%207.50 (the archive matching `node -p "process.platform + ' ' + process.arch"`), unpack, and name in `sdkPath`: you cannot download it for them and must never copy or share it, because SAP's connector licence forbids redistribution. The gateway port `33<sysnr>` must be reachable and the user needs `S_RFC` for `SADT_REST_RFC_ENDPOINT` (Eclipse users have it). `--check` tests only the HTTPS url, not the SDK or the gateway port; those show on the first call. Steps and errors: docs/RFC.md.
- `policy` is enforced by the server before any SAP call: `readOnly`, `deniedTools`, `allowDataPreview`, `allowFreeSql`, `deniedTables`, `allowedPackages`, `allowedTransports` (globs). `MCP_READ_ONLY=1` makes everything read-only. Table data is closed by default: `tableContents` needs `allowDataPreview: true` and `runQuery` needs `allowFreeSql: true` on the destination; ask the user before adding either, and never add them to a production entry on your own. `$*` (local packages) belongs on on-prem entries only: the tested S/4HANA Public Cloud tenant refuses `$TMP`.
- Secrets: never inline. `${env:VAR}` works in every string and a missing variable fails at startup by name. A file readable by others is refused when it holds an inline password.
- TLS stays on. `tls.ca` adds a corporate or self-signed CA; `tls.servername` names the certificate when the system is reached by IP address or short hostname; `tls.cert`/`tls.key` or `tls.pfx` for client certificates. `insecureTls: true` is the last resort, per destination, announced at startup. `NODE_TLS_REJECT_UNAUTHORIZED=0` is ignored by the server.

Then run `npx -y abap-adt-mcp --check` again: every line should read `ok` (an HTTP 401 from a destination is fine, it only means no credentials were sent).

## 2. Register the server in the host
Installed as the plugin (Claude Code or Cowork), the server is already registered and reads `~/.abap-adt-mcp/systems.json`. Without that file it starts in setup mode: only `listSystems` and `healthcheck`, both answering `needsSetup` with these instructions. After writing the file, tell the user to run `/reload-plugins` (or start a new session), then go to section 3. Skip the rest of this section.

Without the plugin, server key `abap-adt-mcp` (keep this key: public ABAP skills route by it). Claude Desktop chat: Settings, Developer, Edit Config opens `claude_desktop_config.json`; add the map below and restart the app.

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
Call the tools yourself; do not tell the user setup is done before step 5 succeeds.
1. `healthcheck`: version, destinations, active toolsets, tool count. `status: "needsSetup"` means the server started before the systems file existed: reload it. If the tool does not exist at all, the server is not running in this host: go back to section 0 and read the host's MCP log (Claude Desktop on macOS: `~/Library/Logs/Claude/mcp-server-abap-adt-mcp.log` or `mcp*.log` there; Windows: `%APPDATA%\Claude\logs`).
2. `listSystems`: every destination with its policy.
3. `login(destination)` for SSO destinations (browser window once).
4. `systemProfile(destination)`: platform and unavailable toolsets.
5. `searchObject(query="CL_ABAP_CHAR_UTILITIES")` then `getObjectSource` on the result: proves read access.

## 4. Troubleshooting
- `kind: "tlsCertificate"`: the hint names the fix for that destination (`tls.ca` for an unknown issuer, `tls.servername` for a name mismatch, renewal for an expired certificate).
- `kind: "sessionExpired"` persisting: run `login` again; the SSO profile lives under `~/.abap-adt-mcp/sso/<host>`.
- Tool refused with `policyDenied`: adjust the destination's `policy`.
- Tool refused as unavailable: the system lacks that ADT collection (see `systemProfile`); when the debugger toolset is missing use `dumps`/`dumpDetails`. `MCP_PROFILE_GATE=warn` logs instead of refusing, `off` disables the gate.
- Node 22.12+ required (22 or 24 LTS).
- Server listed as failed or missing in the host: `npx -y abap-adt-mcp --check` in a terminal shows which part breaks, then the host log shows how the host starts it.
