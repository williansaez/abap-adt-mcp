# MCP hosts

How to register abap-adt-mcp in each MCP host, where the host keeps its configuration and logs, how it shows tools, prompts and approvals, and what tends to go wrong. The README covers the two common cases in [Register the server in your host](../README.md#2-register-the-server-in-your-host); this page assumes you already have a `systems.json` ([Describe your SAP systems](../README.md#1-describe-your-sap-systems), every option in [CONFIGURATION.md](CONFIGURATION.md)).

Everything about the server (tool names, variables, transports, stderr) comes from this repository; everything about a host is stated as of the time of writing, and the host's own documentation wins where they differ. A few questions in this page turn on how a specific host's own MCP client behaves (does it send an `Origin` header, how many sessions does it open, what tool-count cap does today's release enforce) rather than on anything abap-adt-mcp does; those are called out as such, with what the server does either way, instead of a guessed number.

## What every host gets

Whatever the host, the server is the same process:

- **Transport.** stdio by default: the host spawns `npx -y abap-adt-mcp` (or `node /path/dist/index.js`, or `docker run -i ...`). With `MCP_HTTP_PORT` set the process serves Streamable HTTP on `http://127.0.0.1:<port>/mcp` instead, see [Streamable HTTP clients](#streamable-http-clients).
- **Environment variables only**, no command-line flags. `SAP_SYSTEMS_FILE` is the one you always set; `MCP_TOOLSETS`, `MCP_DISABLED_TOOLSETS`, `MCP_READ_ONLY`, `MCP_AUDIT_FILE` and `MCP_MAX_RESPONSE_CHARS` are the ones that vary per host. All of them are in the README's [Configuration reference](../README.md#configuration-reference).
- **Tools with annotations.** 173 tools under `MCP_TOOLSETS=all`, 114 under `focused`, each with `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint` (only `apiReleaseState`). Hosts may gate approvals by them; the `policy` block in `systems.json` is enforced by the server regardless.
- **Six prompts** (`create-object`, `safe-edit`, `review-transport`, `fix-atc`, `clean-core-check`, `debug-dump`), see [Built-in prompts](../README.md#built-in-prompts). Hosts without prompt support ignore them; the flows still reach the model through the server's `instructions` field.
- **stderr is the log.** Startup lines (`Active toolsets: ...`, printed whenever fewer than all toolsets are enabled), TLS and audit warnings and `MCP_PROFILE_GATE=warn` messages go to stderr, which each host captures somewhere different, except when nothing wraps the process at all (see "Running it unattended" under [Streamable HTTP clients](#streamable-http-clients)).
- **Version pinning.** Every generic snippet on this page and in the README's quick start uses unpinned `npx -y abap-adt-mcp`, which fetches the newest release every time it starts; that is the right default to get going. For a controlled or shared rollout, pin the version everywhere the process is started (`npx -y abap-adt-mcp@0.3.3`, or the `vX.Y.Z` container tag), as the README's [Other ways to install](../README.md#other-ways-to-install) section recommends. The Claude Desktop pitfalls below single pinning out only because Desktop has no lockfile or CI run to catch a bad release the way a team's other tooling might; the same advice applies everywhere a process is started unattended or by more than one person.

## Comparison

| Host | Transport to this server | MCP prompts | Approval model | How env reaches the server |
|---|---|---|---|---|
| Claude Desktop | stdio | Yes, attachment (plus) menu | Per tool, "allow once" or "allow for this chat" | `env` map in `claude_desktop_config.json`; shell env not inherited |
| Claude Code | stdio or HTTP | Yes, `/mcp__abap-adt-mcp__<prompt>` | Per tool with permanent allow; `permissions.allow` rules | `-e KEY=VALUE` on `claude mcp add`, `env` in `.mcp.json` with `${VAR}` expansion |
| Cline | stdio or HTTP | Not surfaced at the time of writing | Per tool, `autoApprove` list per server | `env` map in `cline_mcp_settings.json` |
| Roo Code | stdio or HTTP | Not surfaced at the time of writing | Per tool, `alwaysAllow` list per server | `env` map in `mcp_settings.json` or `.roo/mcp.json` |
| Cursor | stdio or HTTP | Not surfaced at the time of writing | Per tool, or auto-run mode | `env` map in `mcp.json` |
| VS Code (Copilot agent mode) | stdio or HTTP | Yes, `/mcp.abap-adt-mcp.<prompt>` | Per tool with session, workspace or always | `env` map in `.vscode/mcp.json`, `${input:...}` and `${env:...}` |
| Windsurf | stdio or HTTP | Check the Windsurf docs | Per tool with auto-run toggles | `env` map in `mcp_config.json` |
| Generic Streamable HTTP client | HTTP | Depends on the client | Depends on the client | Set on the server process, not the client |

## Claude Desktop

**Config file.** `claude_desktop_config.json`, opened from Settings > Developer > Edit Config. At the time of writing it lives at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and `%APPDATA%\Claude\claude_desktop_config.json` on Windows. Claude Desktop has no official Linux build at the time of writing.

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "npx",
      "args": ["-y", "abap-adt-mcp"],
      "env": {
        "SAP_SYSTEMS_FILE": "/Users/me/.abap-adt-mcp/systems.json",
        "MCP_TOOLSETS": "focused",
        "MCP_AUDIT_FILE": "/Users/me/.abap-adt-mcp/audit.jsonl"
      }
    }
  }
}
```

The same file on Windows, forward slashes as the pitfalls below require:

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "npx",
      "args": ["-y", "abap-adt-mcp"],
      "env": {
        "SAP_SYSTEMS_FILE": "C:/Users/me/.abap-adt-mcp/systems.json",
        "MCP_TOOLSETS": "focused",
        "MCP_AUDIT_FILE": "C:/Users/me/.abap-adt-mcp/audit.jsonl"
      }
    }
  }
}
```

**Restart.** The file is read at application start only: quit the app completely (Cmd-Q on macOS, the tray icon on Windows) and reopen it after every change; closing the window is not enough.

**Tools, prompts, approvals.** After the restart, Settings > Developer lists `abap-adt-mcp` with a status, and the tools menu below the chat input (the sliders icon) shows the server and lets you switch tools off for a chat. The six prompts sit in the attachment (plus) menu under the server name. Before a tool runs, Desktop asks with "allow once" or "allow for this chat"; at the time of writing that dialog is host behaviour independent of `destructiveHint`, so `getObjectSource` and `deleteObject` look the same in it. Treat it as a courtesy and the destination's `policy` as the guarantee ([Keeping it safe](../README.md#keeping-it-safe)).

**Logs.** `~/Library/Logs/Claude/` on macOS and `%APPDATA%\Claude\logs\` on Windows, with `mcp.log` (the host's view: spawn, handshake, disconnects) and `mcp-server-abap-adt-mcp.log` (everything the server wrote to stderr). The second file is where `No ABAP systems configured`, `Active toolsets: ...` and TLS warnings land.

**Pitfalls.**

- Desktop does not inherit your shell environment and starts the process with a minimal `PATH`. `spawn npx ENOENT` in `mcp.log` means Node is not on that path: put the absolute path to `npx` in `command` (`/usr/local/bin/npx` for the macOS installer, `/opt/homebrew/bin/npx` for Homebrew, `C:/Program Files/nodejs/npx.cmd` on Windows).
- No `~` or `$HOME` expansion in `command`, `args` or `env`: write absolute paths. On Windows use forward slashes (`C:/Users/me/.abap-adt-mcp/systems.json`) or doubled backslashes; a single backslash makes the file `is not valid JSON`.
- `${env:VAR}` references in `systems.json` are resolved from the `env` map of this file, not from your terminal. This bites hardest by example: the README's own `systems.json` snippet for an on-prem entry uses `"password": "${env:ONPREM_PASSWORD}"`, but the Desktop `env` map above never sets `ONPREM_PASSWORD`: combine the two exactly as written and the server fails at startup naming that variable. Either add `"ONPREM_PASSWORD": "..."` to the `env` map (duplicating the secret into a file whose mode nobody checks), put the password inline in `systems.json` at mode `0600` instead, or use a launcher script that reads it from the OS keychain; [docs/CONFIGURATION.md](CONFIGURATION.md#8-host-configuration-snippets) lays out all three with a worked keychain script.
- `npx -y abap-adt-mcp` fetches the newest release at every start; pin `abap-adt-mcp@0.3.3` in `args` for a controlled rollout.
- Browser SSO works: the server opens a Chrome, Edge or Brave window from the Desktop process. Auto-detection only knows the macOS install locations of Chrome, Edge and Brave ([Environment variables](CONFIGURATION.md#5-environment-variables)); on Windows and Linux `SAP_BROWSER_PATH` is required, not optional, or login fails with `No Chrome/Edge/Brave found for SSO login`. Point it at wherever that browser is actually installed: the default location its own installer used (typically `C:/Program Files/Google/Chrome/Application/chrome.exe` for Chrome or the equivalent Edge path), which the server does not detect for you on that platform.
- `MCP_AUDIT_FILE` and, for the HTTP transport, the generated `http-token` file are documented at mode `0700`/`0600`; those are Unix permission bits, and Windows has none to set, the same way the `systems.json` mode check itself is skipped there ([File mode checks](CONFIGURATION.md#file-mode-checks)). The files are still created on Windows, just without that enforcement: keep them in a folder only your account can reach and rely on the OS's own file permissions or full-disk encryption instead of a `chmod` that does not exist.

## Claude Code

**Registration.** One line, with `-e` for each environment variable and the server command after `--`:

```bash
claude mcp add abap-adt-mcp \
  -e SAP_SYSTEMS_FILE=$HOME/.abap-adt-mcp/systems.json \
  -e MCP_TOOLSETS=focused \
  -- npx -y abap-adt-mcp
```

`claude mcp list`, `claude mcp get abap-adt-mcp` and `claude mcp remove abap-adt-mcp` manage the entries; inside a session, `/mcp` shows connection state and the tools per server.

**Scopes.** `--scope local` (the default) stores the entry for the current project in `~/.claude.json`; `--scope user` makes it available in every project from the same file; `--scope project` writes a `.mcp.json` at the repository root, meant to be committed. For a team, project scope with secrets kept out of the file:

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "npx",
      "args": ["-y", "abap-adt-mcp"],
      "env": {
        "SAP_SYSTEMS_FILE": "${HOME}/.abap-adt-mcp/systems.json",
        "MCP_TOOLSETS": "${ABAP_MCP_TOOLSETS:-focused}"
      }
    }
  }
}
```

At the time of writing `.mcp.json` expands `${VAR}` and `${VAR:-default}` from the environment of the `claude` process, so every developer keeps their own `systems.json` in their own home directory. Claude Code asks once before it starts servers declared by a project's `.mcp.json`, and `claude mcp reset-project-choices` clears that answer.

**Tools and approvals.** Tools appear as `mcp__abap-adt-mcp__<tool>` for a server registered through `claude mcp add` or `.mcp.json`, as in the two snippets above (see the plugin section below for the one route this rule does not obviously cover). The first call of each tool asks for approval with the option to allow it permanently for the project (stored in `.claude/settings.local.json`). Rules can also be written by hand in `.claude/settings.json` or `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__abap-adt-mcp__listSystems",
      "mcp__abap-adt-mcp__searchObject",
      "mcp__abap-adt-mcp__getObjectSource",
      "mcp__abap-adt-mcp__runQuery"
    ],
    "deny": ["mcp__abap-adt-mcp__transportRelease"]
  }
}
```

`mcp__abap-adt-mcp` alone allows every tool of the server, convenient for a read-only destination and reckless for a writable one. A rule for a tool hidden by `MCP_TOOLSETS` is simply unused.

**Prompts as slash commands.** Each prompt is a command named `/mcp__abap-adt-mcp__<prompt>` with the arguments given positionally in the order the prompt declares them; `destination` comes first in all six:

```text
/mcp__abap-adt-mcp__safe-edit DEV ZCL_EXAMPLE "return early when the input table is empty"
/mcp__abap-adt-mcp__review-transport DEV DEVK900123
/mcp__abap-adt-mcp__clean-core-check DEV ZCL_EXAMPLE
```

**Plugin manifest and skills.** `.claude-plugin/plugin.json` at the repository root declares the server under `mcpServers` as `npx -y abap-adt-mcp`, with only `SAP_SYSTEMS_FILE=${HOME}/.abap-adt-mcp/systems.json` in its `env` map (no `MCP_TOOLSETS`, more on that below); the two skills sit next to it in `skills/abap-adt-mcp/SKILL.md` (developing ABAP with these tools) and `skills/abap-adt-mcp-setup/SKILL.md` (installation and first health check). Installed as a Claude Code plugin, the manifest is what registers the server and the skills ship beside it, so at the time of writing no `claude mcp add` is needed; the host's own plugin documentation is the authority on what an install actually loads.

This repository ships no `.claude-plugin/marketplace.json`, so there is no `/plugin marketplace add <name>` command or single install line to give here, and none should be assumed from Claude Code's general plugin documentation without one existing in this repository. The one route this repository actually supports is a local checkout loaded from disk, with Claude Code's own local-plugin flag (`--plugin-dir <path>` at the time of writing; the host's plugin documentation has the current name) pointed at it, so that it reads `.claude-plugin/plugin.json` from that directory. That manifest still runs `npx -y abap-adt-mcp`, the published npm package, not the checkout's own build: what the directory contributes is the manifest, and this manifest names the npm package, so testing local source changes through the plugin route silently runs the last npm release instead of what you just built. To exercise a local build this way, point the checkout's `plugin.json` at `"command": "node", "args": ["<absolute path>/dist/index.js"]` first, or skip the plugin route and use `claude mcp add ... -- node /absolute/path/abap-adt-mcp/dist/index.js` as in the README's [Other ways to install](../README.md#other-ways-to-install) instead.

Because the manifest sets no `MCP_TOOLSETS`, a plugin install publishes all 173 tools by default, not the `focused` 114 recommended for Claude Code elsewhere on this page ([Choosing MCP_TOOLSETS](#choosing-mcp_toolsets-per-host-and-task)), and the manifest has no per-install override for it. Getting `focused` from the plugin route means editing the checkout's `plugin.json` before pointing `--plugin-dir` at it, or registering the server a second way (`claude mcp add` or a project `.mcp.json`) alongside or instead of the plugin.

Whether a plugin-installed server keeps the `mcp__abap-adt-mcp__<tool>` prefix promised above is also not something this repository's manifest settles by itself: Claude Code plugin-declared MCP servers seen elsewhere are prefixed `mcp__plugin_<plugin-name>_<server-name>__<tool>`, not the bare `mcp__<server-name>__<tool>` a direct `claude mcp add` or `.mcp.json` registration gets. Since this repository's plugin name and its `mcpServers` key are both `abap-adt-mcp`, that pattern would produce `mcp__plugin_abap-adt-mcp_abap-adt-mcp__searchObject` rather than `mcp__abap-adt-mcp__searchObject`, which would break every permission rule and slash-command name given on this page as written, if it holds for the release in use. Check the actual prefix with `/mcp` (or the tool list a running session reports) right after a plugin install, before writing permission rules or scripting the prompts against it; this document states the prefix confidently only for the `claude mcp add`/`.mcp.json` route.

The skills alone install, at the time of writing, with `npx skills add williansaez/abap-adt-mcp` (the command the README gives; it is a third-party installer, not part of this repository) or by copying the two directories into `~/.claude/skills/` or `.claude/skills/`. A plain `claude mcp add` installs no skill; the essential flows still arrive through `instructions`.

**Context and output limits.** Every published tool schema travels with each request, so `MCP_TOOLSETS=focused` (114 tools) or a narrower list is the first thing to set ([Choosing MCP_TOOLSETS](#choosing-mcp_toolsets-per-host-and-task)). On the output side, Claude Code truncates tool results above its own limit (`MAX_MCP_OUTPUT_TOKENS` at the time of writing, 25000 tokens by default); the server's `MCP_MAX_RESPONSE_CHARS` (40000 characters) pages `getObjectSource`, `runQuery`, `atcWorklists` and other large responses below that, so raise both together or neither.

**Logs.** `claude --debug` prints MCP connection details to the terminal and `/mcp` shows the last error per server. At the time of writing each server's stderr is also written under `~/Library/Caches/claude-cli-nodejs/<project>/mcp-logs-abap-adt-mcp/` on macOS; the `Active toolsets` line there (present whenever `MCP_TOOLSETS` or `MCP_DISABLED_TOOLSETS` narrowed the catalogue) explains a tool refused as "not enabled".

**Pitfalls.**

- `-e` takes `KEY=VALUE` pairs and must come before `--`; after it, `-e` is an argument of `npx`.
- A local-scope registration belongs to one directory; elsewhere `claude mcp list` shows nothing and the model says the tools do not exist.
- The server key must stay `abap-adt-mcp`: skills, slash names and permission rules embed it, for a `claude mcp add`/`.mcp.json` registration; a plugin install may not keep that exact key as the tool prefix, see above.
- Headless runs (`claude -p`) keep the approval model; pre-approve the read tools in `permissions.allow` or the run stalls.

## Cline and Roo Code

Both are VS Code extensions with the same JSON shape in the extension's global storage; both open the file from their MCP Servers panel, which is easier than finding it on disk.

**Cline** stores `cline_mcp_settings.json` under the VS Code global storage of the `saoudrizwan.claude-dev` extension. At the time of writing: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/` on macOS, `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\` on Windows, `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/` on Linux (VS Code Insiders and forks use their own `Code - Insiders`, `Cursor` or `VSCodium` folder).

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "npx",
      "args": ["-y", "abap-adt-mcp"],
      "env": {
        "SAP_SYSTEMS_FILE": "/Users/me/.abap-adt-mcp/systems.json",
        "MCP_TOOLSETS": "focused"
      },
      "disabled": false,
      "autoApprove": ["listSystems", "healthcheck", "searchObject", "getObjectSource"],
      "timeout": 120
    }
  }
}
```

`autoApprove` names tools that run without the confirmation click; everything else asks. Cline's `timeout` is in seconds and at the time of writing defaults to 60, which is short for `createAtcRun` on a package or a first `login` over browser SSO; 120 or more avoids a spurious timeout while the SAP call is still running.

**Roo Code** reads `mcp_settings.json` from the global storage of `rooveterinaryinc.roo-cline` (same parent folders) and, per project, `.roo/mcp.json` at the workspace root. Same shape; the auto-approval key is `alwaysAllow`.

**Tools, prompts, approvals.** Both list the server, its tools and a per-tool auto-approve toggle in the MCP Servers pane, and show the server's stderr there when it fails to start. Neither surfaces MCP prompts at the time of writing; the workflows reach the model through `instructions`, and the text of `skills/abap-adt-mcp/SKILL.md` can go into the extension's custom instructions or rules.

**Pitfalls.** Both inherit the environment of the VS Code process, which on macOS is not your shell's: launch VS Code from a terminal (`code .`) or use absolute paths, as for Claude Desktop. Both add every tool description to each request on top of a large system prompt of their own, so use `focused` or a comma list. A changed `env` takes effect only after the pane's restart button.

## Cursor

**Config file.** `~/.cursor/mcp.json` for every project, `.cursor/mcp.json` in a workspace for that project alone. Cursor Settings > MCP (called Tools & Integrations in recent builds) shows both, with a toggle and the list of tools per server.

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "npx",
      "args": ["-y", "abap-adt-mcp"],
      "env": {
        "SAP_SYSTEMS_FILE": "/Users/me/.abap-adt-mcp/systems.json",
        "MCP_TOOLSETS": "core,source,objects,analysis,tests,atc"
      }
    }
  }
}
```

An HTTP entry uses `"url": "http://127.0.0.1:2236/mcp"` with a `"headers"` map for the bearer token.

**Tools, prompts, approvals, logs.** Tools appear in the agent's tool list with a per-server toggle; every call asks for confirmation unless Cursor's auto-run setting is on. Prompts are not exposed at the time of writing; `instructions` still apply. The Output panel's MCP channel (View > Output) holds the spawn, the handshake and the server's stderr.

**Pitfalls.**

- Cursor caps how many tools it sends to the model per request (the number has changed across releases; the settings page warns when a server exceeds it). 173 is above every cap seen so far, so a comma list of toolsets is the normal configuration here. Whether `focused` (114 tools) fits under today's cap is not something this document can state either: the cap has moved before, and Cursor's own settings screen, not this page, is the live source of truth. Register with `focused` or shorter, then check that screen for a per-server or total-tool warning; narrow further with a comma list of toolsets ([Choosing MCP_TOOLSETS](#choosing-mcp_toolsets-per-host-and-task)) if it still warns.
- Same environment rule as the other editors: no `~` in paths, absolute `npx` when Node is not on the launcher's `PATH`.

## VS Code with GitHub Copilot agent mode

**Config file.** VS Code uses `servers` instead of `mcpServers`, plus an `inputs` array for values it should prompt for and store in its secret storage. This is the one host on this page where the README's step-2 line ("the same JSON works in Cursor, VS Code, Cline and other hosts that read an `mcpServers` map") does not hold as written: rename the top-level key from `mcpServers` to `servers` before reusing that JSON here, as the snippet below does. Workspace: `.vscode/mcp.json`. User: the file opened by the command "MCP: Open User Configuration". The commands "MCP: Add Server", "MCP: List Servers" and "MCP: Show Output" cover the rest.

```json
{
  "inputs": [
    {
      "id": "onprem-password",
      "type": "promptString",
      "description": "SAP password for the ONPREM destination",
      "password": true
    }
  ],
  "servers": {
    "abap-adt-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "abap-adt-mcp"],
      "env": {
        "SAP_SYSTEMS_FILE": "${env:HOME}/.abap-adt-mcp/systems.json",
        "MCP_TOOLSETS": "focused",
        "ONPREM_PASSWORD": "${input:onprem-password}"
      }
    }
  }
}
```

`${input:onprem-password}` is asked for once, kept in VS Code's secret storage and handed to the server's environment, where `"password": "${env:ONPREM_PASSWORD}"` in `systems.json` picks it up ([AUTH.md](AUTH.md)). `${env:HOME}` and `${workspaceFolder}` are the other useful substitutions. A `.vscode/mcp.json` with only `${input:...}` references can be committed.

An HTTP entry is `"type": "http"` with `"url"` and `"headers": { "Authorization": "Bearer ${input:mcp-token}" }`.

**Tools, prompts, approvals.** In agent mode the Tools button of the chat input opens a picker where each server and tool can be ticked; the first use of a tool asks for confirmation for this session, this workspace or always, and `chat.tools.autoApprove` switches confirmations off. MCP prompts are slash commands named `/mcp.abap-adt-mcp.<prompt>` (`/mcp.abap-adt-mcp.review-transport`) and VS Code asks for the declared arguments.

**Logs.** "MCP: Show Output" or the Output panel entry named after the server, with the handshake and stderr; "MCP: List Servers" gives start, stop and restart per server.

**Pitfalls.**

- At the time of writing VS Code warns when more than 128 tools are enabled for a request and groups the excess into virtual tools the model has to expand first. `focused` (114 tools) fits under that limit; `all` (173) does not, which is a second reason to pick toolsets here.
- Organisation policies can restrict which MCP servers Copilot may use (an allowlist in the GitHub organisation or enterprise settings); when the server never appears although the file is correct, check that policy before the JSON.
- With `chat.mcp.discovery.enabled` VS Code also imports Claude Desktop's config, which yields two registrations of the same server. Keep one.

## Windsurf

**Config file.** `~/.codeium/windsurf/mcp_config.json`, opened from the MCP panel in Cascade (Settings > Cascade > MCP servers, or the plugins icon). Same `mcpServers` shape as Cursor; HTTP servers use `"serverUrl"` instead of `"url"` at the time of writing.

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "npx",
      "args": ["-y", "abap-adt-mcp"],
      "env": {
        "SAP_SYSTEMS_FILE": "/Users/me/.abap-adt-mcp/systems.json",
        "MCP_TOOLSETS": "core,source,objects,analysis,tests"
      }
    }
  }
}
```

**Tools, prompts, approvals.** The MCP panel lists tools per server with enable and auto-run toggles; without auto-run each call asks in the Cascade thread. Whether prompts are surfaced depends on the release; check the Windsurf documentation. Startup errors, including the server's stderr, appear in the same panel.

**Pitfalls.** Windsurf enforces a total tool limit across all servers (100 at the time of writing), counted after per-tool toggles; a comma list of toolsets keeps this server's share small enough to coexist with others.

## Streamable HTTP clients

For hosts that expect a URL rather than a command (Eclipse and other IDEs, another machine, a shared team instance), start the server with a port:

```bash
MCP_HTTP_PORT=2236 MCP_TOOLSETS=focused npx -y abap-adt-mcp
```

The endpoint is `http://127.0.0.1:2236/mcp` (ports below 1024 are refused). Without `MCP_HTTP_TOKEN` the bearer token is generated and written to `~/.abap-adt-mcp/http-token` (mode `0600`); `GET /health` answers without a token. The README's [HTTP transport](../README.md#http-transport-optional) section lists what the front door enforces and what it leaves to a reverse proxy (TLS, rate limiting, per-user tokens); its host-config JSON shows one generic `"type": "http"` shape inside an `mcpServers` map, which is the shape the protocol needs, not a literal snippet for every host below: Cursor takes `"url"` alone with no `"type"`, Windsurf `"serverUrl"`, VS Code `"type": "http"` under `servers` instead of `mcpServers` (each host's own section above has the exact form).

**What a client must send.** `Authorization: Bearer <token>` on every request; `Content-Type: application/json` and `Accept: application/json, text/event-stream` on `POST`; after `initialize`, the `mcp-session-id` header copied from that response. Only `initialize` may open a session (`400` otherwise), an unknown or expired id gets `404` and a fresh `initialize` fixes it, `503` with `Retry-After` means `MCP_HTTP_MAX_SESSIONS` (16) is reached, and an idle session is closed with its SAP sessions and locks after `MCP_HTTP_SESSION_TTL_MINUTES` (30).

```bash
TOKEN=$(cat ~/.abap-adt-mcp/http-token)
curl -si http://127.0.0.1:2236/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

The response headers carry `mcp-session-id`; reuse it for `notifications/initialized`, `tools/list` and `tools/call`.

**Origin and Host.** Requests without an `Origin` header (non-browser clients) always pass. A browser-based client sends one, and on the default loopback bind only loopback origins pass; list the client's origin in `MCP_HTTP_ALLOWED_ORIGINS` (comma separated, `*` allows any) or the call gets `403 Forbidden: Origin not allowed`. The `Host` header check guards a loopback bind against DNS rebinding and is extended with `MCP_HTTP_ALLOWED_HOSTS`; on a non-loopback bind (`MCP_HTTP_HOST=0.0.0.0`) every `Host` passes. A `403` names the variable to set.

Whether Cursor and VS Code (both Electron apps) send an `Origin` header on their Streamable HTTP requests is a property of those clients' own MCP implementations, not of this server, and neither host's documentation states it plainly at the time of writing; this repository has no way to confirm it either way for you. What is fixed and testable is what the server does with either answer: no `Origin` header always passes, one that is present must be listed in `MCP_HTTP_ALLOWED_ORIGINS` (or match the loopback-origin allowance on a loopback bind). Capture what the client actually sends once, using the reverse proxy's access log or a `curl -v`/MCP Inspector probe against the same endpoint, before deciding the variable can be left unset for a shared instance both hosts connect to; setting `MCP_HTTP_ALLOWED_ORIGINS=*` sidesteps the question at the cost of accepting a request from any browser tab, not only the intended client.

**Host entries.** Claude Code: `claude mcp add --transport http abap-adt-mcp http://127.0.0.1:2236/mcp --header "Authorization: Bearer <token>"`. JSON hosts: `"type": "http"` (`"url"` alone in Cursor, `"serverUrl"` in Windsurf) with a `"headers"` map. That file now holds a credential; keep it at mode `0600`. On Windows that mode cannot be set at all (no POSIX permission bits, the same gap `systems.json`'s own mode check has there), so rely on NTFS permissions or disk encryption for that machine instead.

**Behind a reverse proxy.** A shared team instance almost always wants TLS in front, and the server never terminates it itself. [docs/CONFIGURATION.md](CONFIGURATION.md#reverse-proxy-with-tls) has a full worked nginx example (`MCP_HTTP_HOST` stays `127.0.0.1`, the proxy owns `443`) together with the exact `Host` header value each common proxy configuration produces and whether `MCP_HTTP_ALLOWED_HOSTS` is therefore needed: an nginx `proxy_set_header Host $host` (or Caddy's default `reverse_proxy`) forwards the public hostname, so `MCP_HTTP_ALLOWED_HOSTS=mcp.team.example` (a bare hostname, a port suffix is stripped before matching) is required; a proxy that leaves `Host` untouched sends its own loopback address and needs nothing added. This also resolves an apparent tension elsewhere on this page and in the README's configuration reference: `MCP_HTTP_HOST=0.0.0.0` is documented as being "only in containers," and that stays true for a bare-metal shared instance too. The loopback-plus-reverse-proxy pattern just described, not a direct `0.0.0.0` bind reachable from the network, is what a team VM should run. Inside a container, `0.0.0.0` is still only the container's own network namespace, published back to `127.0.0.1` on the host and reverse-proxied from there the same way; [docs/CONFIGURATION.md](CONFIGURATION.md#container-deployment) shows that combination end to end.

**Running it unattended.** Nothing in this repository starts the server as a background service: no systemd unit, no launchd plist, no pm2 config ship with it, and the `MCP_HTTP_PORT=...` command above (and the README's own) is written for a foreground shell. For an instance that must survive a logout or a reboot, wrap it in whatever the host OS already offers; a minimal systemd unit, built only from the environment variables this page and [docs/CONFIGURATION.md](CONFIGURATION.md#5-environment-variables) already document:

```ini
# /etc/systemd/system/abap-adt-mcp.service
[Unit]
Description=abap-adt-mcp (Streamable HTTP)
After=network.target

[Service]
Type=simple
Environment=MCP_HTTP_PORT=2236
Environment=MCP_HTTP_HOST=127.0.0.1
Environment=MCP_HTTP_ALLOWED_HOSTS=mcp.team.example
Environment=SAP_SYSTEMS_FILE=/etc/abap-adt-mcp/systems.json
Environment=MCP_AUDIT_FILE=/var/log/abap-adt-mcp/audit.jsonl
EnvironmentFile=/etc/abap-adt-mcp/token.env   # MCP_HTTP_TOKEN=..., kept out of this unit file
ExecStart=/usr/bin/npx -y abap-adt-mcp
Restart=on-failure
User=abap-adt-mcp

[Install]
WantedBy=multi-user.target
```

`journalctl -u abap-adt-mcp` is then where the server's stderr lands: startup warnings, TLS warnings, the `MCP_HTTP_HOST=0.0.0.0` and SSO-destination warnings, `MCP_PROFILE_GATE=warn` messages, the same lines a desktop host captures into its own log file. With no host wrapping the process, nothing else captures that output, and closing a foreground shell running the command above takes the log with it, which is the reason to set this up before relying on a shared instance for anything more than a quick test. On macOS a `launchd` `.plist` with the same values under `EnvironmentVariables` and a `StandardErrorPath` set to a log file does the same job; neither form ships with this repository, both follow directly from the variables already in the [Configuration reference](../README.md#configuration-reference).

**Sizing a shared instance.** `MCP_HTTP_MAX_SESSIONS` (default 16) caps concurrent MCP sessions. How many your team consumes depends on client behaviour outside this server's control: whether an editor opens one Streamable HTTP session per window, per workspace, or reuses a single one for the whole application is a property of Cursor's, VS Code's or Windsurf's own MCP client, not documented here or, at the time of writing, in those hosts' own docs either. Rather than guess a number, watch it: `GET /health` (no token needed) reports the live `sessions` count, so polling it during a normal working morning shows the real ceiling to raise `MCP_HTTP_MAX_SESSIONS` toward; a `503` with `Retry-After` on `initialize` is the unambiguous sign the current value is too low. Idle sessions close themselves and free their slot after `MCP_HTTP_SESSION_TTL_MINUTES` (default 30), so a burst of short-lived clients recovers on its own.

Distributing `MCP_HTTP_TOKEN` to a team is likewise outside what this repository automates: left unset, the generated token is written only to `~/.abap-adt-mcp/http-token` on the machine running the server, readable there and nowhere else. For more than one caller, set `MCP_HTTP_TOKEN` yourself (`openssl rand -hex 32`, as in [docs/CONFIGURATION.md](CONFIGURATION.md#reverse-proxy-with-tls)'s worked example) and hand the value to the team through whatever secret channel already carries credentials. The server has no distribution mechanism of its own and no per-user tokens, so everyone shares one bearer value until it is rotated (a restart without `MCP_HTTP_TOKEN` already generates a new token and overwrites `http-token`; when you set the variable yourself, change it and restart; open sessions end with the process). On the client side that token then sits in each person's own host config file, exactly the file the mode-`0600` advice above is about, with the same Windows caveat: no permission bits to set there, so a Windows teammate's protection is the machine's own access controls, not a `chmod`.

**Pitfalls.** One instance means one token and one set of SAP credentials per destination for every caller, and the audit file records no caller identity; SSO destinations share the browser login of the user who started the process (the server warns at startup when `MCP_HTTP_HOST` binds beyond loopback and an `sso` destination is configured). MCP Inspector (`npm run dev` from a source checkout) shows the raw traffic when a client misbehaves.

## Docker-based hosts

The image `ghcr.io/williansaez/abap-adt-mcp` (tags `latest` and `vX.Y.Z`) runs as the unprivileged `node` user and speaks stdio by default, so any host that spawns a command can spawn Docker instead of `npx`:

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/Users/me/.abap-adt-mcp/systems.json:/config/systems.json:ro",
        "-e", "SAP_SYSTEMS_FILE=/config/systems.json",
        "-e", "MCP_TOOLSETS=focused",
        "-e", "ONPREM_PASSWORD",
        "ghcr.io/williansaez/abap-adt-mcp:v0.3.3"
      ],
      "env": { "ONPREM_PASSWORD": "..." }
    }
  }
}
```

`-i` is mandatory (stdio needs stdin) and `-t` must be absent (a TTY corrupts the JSON stream). A bare `-e ONPREM_PASSWORD` forwards the variable from the host's `env` map without repeating the value in `args`.

**Pitfalls.**

- Browser SSO cannot run inside the container (no browser, no display). Run `sso` destinations from npm on the workstation; `basic` and `oauth` work in the image ([AUTH.md](AUTH.md)).
- The mounted file is read by uid 1000. A `systems.json` at mode `0600` owned by your own uid fails with `is not valid JSON: EACCES`; own it by uid 1000, or make it readable and keep every secret as `${env:VAR}` (the server warns and starts, see [Other ways to install](../README.md#other-ways-to-install)).
- The `MCP_AUDIT_FILE` directory needs the same uid-1000 ownership, or the first call that would write to it fails once with `EACCES` on stderr (`docker logs`) and every later call is silently unrecorded while everything else keeps working; [docs/CONFIGURATION.md](CONFIGURATION.md#container-deployment) has the volume and `chown` recipe, including the Docker Desktop exception on macOS and Windows where bind mounts are writable to any uid.
- `docker` must be on the host's `PATH`; the Claude Desktop rule applies (absolute path in `command` when needed).
- For Streamable HTTP inside the container set `MCP_HTTP_PORT`, `MCP_HTTP_HOST=0.0.0.0` (the container's loopback is unreachable from outside) and `MCP_HTTP_TOKEN`, and publish to loopback only: `-p 127.0.0.1:2236:2236`. Values passed with `-e` are visible to `docker inspect`.
- Hosts that manage containers themselves apply their own registration flow; the variables and mounts above are what the image needs, whatever wraps it.

## Choosing MCP_TOOLSETS per host and task

The tool list is the largest fixed cost of a session. `MCP_TOOLSETS` takes a preset (`all`, the default, 173 tools; `focused`, 114 tools) or a comma list of toolset names, and `MCP_DISABLED_TOOLSETS` subtracts from either. A preset stands alone: `focused,git` is refused, spell the list out instead. `core` (6 tools: `listSystems`, `healthcheck`, `systemProfile`, `login`, `logout`, `dropSession`) is always on and cannot be disabled, and an unknown name stops the start with the valid list. The toolset table with counts is in [TOOLS.md](TOOLS.md).

| Task | Setting | Tools |
|---|---|---|
| Read and explain code, where-used, CDS | `MCP_TOOLSETS=core,source,objects,analysis,data` | 75 |
| Everyday development (edit, test, ATC, transports, dumps) | `MCP_TOOLSETS=focused` | 114 |
| Development plus abapGit | `MCP_TOOLSETS=core,source,objects,transports,analysis,tests,atc,data,runtime,git` | 124 |
| Transport review only | `MCP_TOOLSETS=core,source,transports,atc,tests` | 58 |
| Clean core assessment | `MCP_TOOLSETS=core,objects,analysis,atc` | 63 |
| Everything, minus what the tenant cannot serve | `MCP_TOOLSETS=all` with `MCP_DISABLED_TOOLSETS=debugger,traces` | 151 |

Per host:

- **Claude Desktop and Claude Code**: `focused` by default, `all` for a debugging or RAP session. The two hosts have independent `env` maps, so each can carry its own setting. A Claude Code plugin install is the exception: its manifest carries no `MCP_TOOLSETS`, so it publishes `all` unless the manifest is edited (see [Plugin manifest and skills](#claude-code) above).
- **VS Code**: stay under 128 tools, so `focused` or a list.
- **Cursor and Windsurf**: a list, sized for the host's cap and the other servers running alongside; check the host's own tool-count warning before trusting a fixed number, `focused` is not confirmed to fit every Cursor release (see [Cursor pitfalls](#cursor)).
- **Cline and Roo Code**: `focused`, trimmed further if the extension's own prompt already fills the window.
- **Shared HTTP instance**: the setting is process-wide; choose for the widest caller and let policies (`deniedTools`, `readOnly`) narrow per destination, or run one instance per team profile.

A call to a hidden tool (from a prompt or a skill) is refused with the toolset's name ("belongs to toolset ... which is not enabled"), the cue to restart with it enabled; `systemProfile` still reports what the destination could serve, so "hidden by me" and "absent on this tenant" (`MCP_PROFILE_GATE`) stay distinguishable. Related knobs: `MCP_MAX_RESPONSE_CHARS`, matched to the host's output limit, and `MCP_READ_ONLY=1` when a host should see the full catalogue but never write.

## See also

[README Troubleshooting](../README.md#troubleshooting) for symptoms across hosts, [CONFIGURATION.md](CONFIGURATION.md) for every variable and policy gate (its [HTTP transport](CONFIGURATION.md#6-http-transport) section has the reverse-proxy, container and session-model detail this page links to above), [WORKFLOWS.md](WORKFLOWS.md) for the tool sequences the prompts and skills encode, [AUTH.md](AUTH.md) for SSO, basic and OAuth per destination, [TOOLS.md](TOOLS.md) for the generated tool reference.
