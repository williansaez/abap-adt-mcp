# ABAP + MCP: Let AI Do Real Development in Your SAP System

*Updated on 8 September 2026 for release 2.0.0: the server now ships on npm (no clone or build), exposes 173 tools, enforces per-destination guard rails, and requires Node.js 22.12 or newer. The original text described version 0.3.1.*

## An AI That Actually Works in Your SAP System

Imagine the following situation. A developer opens Claude Desktop and types one sentence: "In DEV, create class ZCL_INVOICE_CHECK in package ZSANDBOX, add a unit test, run it, and show me any ATC findings." Then they watch. The AI searches the system, picks the transport, creates the class, activates it, generates a test include, runs the tests, and reports back, with real results from a real SAP system. No copy-pasting code between a chatbot and Eclipse. No "here's some code, good luck."

That is what abap-adt-mcp does. It is a free, MIT-licensed, open-source MCP server that gives AI agents full ABAP development capabilities over multiple SAP systems at once: 173 tools, and nothing to install inside SAP. The project lives on GitHub: https://github.com/williansaez/abap-adt-mcp

![WSaez_4-1788350708879.png](https://community.sap.com/t5/image/serverpage/image-id/454781iCE099AA58328229A/image-size/large?v=v2&px=999)

![WSaez_10-CARTAO_001.png](https://community.sap.com/t5/image/serverpage/image-id/454790iD6D5D0BB674790B6/image-size/large?v=v2&px=999)

## First, for those who are not familiar: What Is MCP?

If you have never heard of MCP, here it is in three sentences. AI assistants like Claude are smart but "hand-less": they can talk about your SAP system, but they cannot touch it. MCP (Model Context Protocol) is an open standard that fixes this. Think of it as a USB port for AI: plug in a "device" (an MCP server) and the AI gains that device's abilities. Plug in a file server and the AI can read files; plug in abap-adt-mcp and the AI can develop ABAP.

An MCP server is just a small program running on your own machine. It translates between the AI and a real system by exposing "tools" the AI can call, always with your approval. It works with any client or model that supports MCP (Claude Desktop, Claude Code, Codex CLI, Cline, Cursor, VS Code, and others).

## What Can It Actually Do?

Before: you ask an AI about ABAP, it guesses from training data, and you paste code back and forth into Eclipse/ADT or your SAPGui.

After: the AI reads the real object from your system, edits it, activates it, and tests it, while you supervise.

### Four real examples

**Fix a bug.** "Method CALCULATE_TAX in ZCL_BILLING dumps on empty input. Find it and fix it." The AI finds the class, reads the method, picks the transport, replaces exactly the lines that need to change, activates, runs the unit tests and shows you the diff (the chain searchObject → getMethodSource → resolveTransport → editObjectSource with activate=true → unitTestRun → objectDiff). Locking and unlocking happen inside the write tool; the AI never juggles lock handles, and a stale edit is refused because the server re-reads the source from SAP before every replacement.

**Quality pass.** "Run ATC on my package and apply the safe quickfixes." ATC (ABAP Test Cockpit, SAP's static code-check tool) runs via createAtcRun, atcSummary totals the findings by priority, then atcQuickfixProposals and atcApplyQuickfix apply the deterministic fixes. The same flow ships as the built-in prompt fix-atc, which re-runs ATC until priority 1 and 2 are clean.

**Explore and understand.** "Where is table ZORDERS used, and show me the last 10 rows in QAS." That is whereUsed (or grepPackage when the tenant has no text index) plus runQuery, across two different systems in a single conversation, because every tool takes a destination parameter. "Is ZCL_ORDER_SERVICE ready for ABAP Cloud?" is apiReleaseState: it checks every SAP object the class references against SAP's official cloudification repository, so the model never recalls release states from memory.

**Create data end-to-end.** "Create table ZTRAVEL_LOG with fields ID, DESTINATION and TRAVEL_DATE, and insert a first entry: Berlin, today." The AI creates and activates the table, then hands a small INSERT to runSnippet, which wraps it in a temporary IF_OO_ADT_CLASSRUN class, runs it, returns the console output and deletes the class again. Finally it proves the record exists by reading it back with runQuery. You watch every step and approve the writes; nothing happens behind your back.

### The full menu: 173 tools in 16 toolsets

Here is the whole surface at a glance:

| Toolset | Tools | Examples |
|---|---|---|
| Destinations, health & session | 6 | listSystems, healthcheck, systemProfile |
| Source code | 16 | getObjectSource, editObjectSource, setMethodSource, objectDiff |
| Objects & navigation | 27 | searchObject, createObject, packageTree, whereUsed, grepPackage |
| Transports | 18 | resolveTransport, transportUnifiedDiff, transportRelease |
| Syntax & code analysis | 16 | syntaxCheckCode, apiReleaseState, runSnippet, codeCompletion |
| Unit tests | 4 | unitTestRun, createTestInclude |
| ATC | 14 | createAtcRun, atcSummary, atcApplyQuickfix |
| Data access & DDIC | 10 | runQuery, tableContents, getDomainProperties |
| Runtime errors | 3 | dumps, dumpDetails |
| Discovery & metadata | 7 | loadTypes, adtDiscovery |
| Refactoring | 8 | renameExecute, extractMethodExecute, changePackageExecute |
| RAP generation | 8 | rapGenGenerate, rapGenPublishService |
| Business services | 4 | fetchServiceDetails, publishServiceBinding |
| abapGit | 10 | gitPullRepo, stageRepo, pushRepo |
| Debugger | 13 | debuggerSetBreakpoints, debuggerVariables |
| Traces | 9 | tracesHitList, tracesStatements |

Tool schemas cost context, so a preset called focused publishes the 114 day-to-day development tools and leaves out the debugger, traces, abapGit, RAP, services, refactoring and discovery toolsets until you ask for them. The complete reference, generated from the live server and carrying a "read-only · writes · destructive" legend on every tool, is in docs/TOOLS.md.

Six workflows also travel as MCP prompts (create-object, safe-edit, review-transport, fix-atc, clean-core-check, debug-dump). Each names the exact tools to call, in order, and says where it must stop and ask. In Claude Code they appear as slash commands.

![WSaez_11-1788351074262.png](https://community.sap.com/t5/image/serverpage/image-id/454791i8939FB5AC288A4CB/image-size/large?v=v2&px=999)

## How It Works (No Magic Involved)

Here is the demystifying part: abap-adt-mcp speaks the exact same protocol your Eclipse installation already uses. ADT is really a set of REST services under /sap/bc/adt, and this server calls them through the proven abap-adt-api library by marcellourbani. If ADT works against your system today, this works too. And because everything runs on your machine, nothing is installed inside SAP: no add-on, no transport, no Basis project.

![The architecture in one picture: your MCP client talks to abap-adt-mcp running locally, which calls your SAP systems through the same ADT REST services Eclipse already uses. Nothing is installed inside SAP.](https://community.sap.com/t5/image/serverpage/image-id/454779i255F3C3A3FAEAF15/image-size/large?v=v2&px=999)

### Multiple systems, one server

You list your systems once in a systems.json file, and every tool accepts a destination parameter, so the AI can read a class in DEV and query a table in QAS in the same conversation. A listSystems tool shows what is configured, and marking one entry "default": true means single-system users never think about destinations at all. systemProfile tells whether a destination is S/4HANA Cloud or on-prem and which toolsets that backend cannot serve, and the server refuses those tools before calling SAP. This is not theoretical: it has been tested live with 20 destinations in one config, documented in docs/TESTPLAN.md.

### Guard rails that live in the server

New since the first version of this post: each destination can carry a policy block that the server enforces before any SAP call, whatever the host approves. readOnly refuses every write on that system. allowedPackages restricts writes to, say, Z* packages. deniedTables keeps HR and user tables out of runQuery and tableContents. deniedTools switches off transportRelease or the whole abapGit toolset for one destination. Refusals come back to the model as a clear policyDenied error naming the gate, so a careless prompt cannot reach the wrong system. The host's approval dialog is a courtesy; the policy block is the guarantee.

### Three ways to log on

Each destination declares one of three auth modes. SSO (authType: "sso", the default) is for named users on S/4HANA Cloud: the server opens a real browser window for your corporate login, just like Eclipse does, then reuses the session. Tick "stay signed in" once and later logins are silent. Basic (authType: "basic") is classic username and password: fine for on-premise systems and S/4HANA Cloud Communication Users, but named business users on S/4HANA Public Cloud cannot use it on ADT endpoints. OAuth (authType: "oauth", client credentials) is the unattended path for Public Cloud.

Full details, including profile persistence and the Communication Arrangement setup, are in docs/AUTH.md.

Convinced? Then let's get it running.

## Set It Up in 10 Minutes

> **SPOILER:** it can also take seconds. Claude Code users install the plugin with two commands, and any client with file access can hand the entire setup to the AI itself. See the BONUS at the end of this section. The manual steps below are here so you know exactly what happens under the hood.

### Prerequisites

You need three things:

- Node.js 22.12 or newer (22 or 24 LTS) on your laptop. Never used Node.js? Install it from nodejs.org (the LTS version); npm and npx come with it. Release 2.0.0 dropped Node 18 and 20 because they are past end of life and receive no security fixes, and a server holding SAP credentials should not run on them.
- An ABAP system reachable via ADT. On S/4HANA Cloud (public edition) your user needs the business role that allows Eclipse ADT (SAP_BR_DEVELOPER in the standard delivery). On-prem, the /sap/bc/adt service must be active in transaction SICF. If Eclipse ADT already connects to the system, you are set.
- A client that supports MCP. Any of them works; the steps in this guide were tested with Claude Desktop and Claude Code.

Start with a development system. You'll thank yourself later.

### Step 1: Describe your systems

Create a folder .abap-adt-mcp in your home directory and a file systems.json inside it, one entry per system. One S/4HANA Cloud tenant with browser SSO needs exactly this:

```json
{
  "DEV": {
    "url": "https://myXXXXXX.s4hana.cloud.sap",
    "client": "080",
    "authType": "sso",
    "default": true
  }
}
```

Several systems, with guard rails, look like this:

```json
{
  "DEV": {
    "url": "https://myXXXXXX.s4hana.cloud.sap",
    "client": "080",
    "authType": "sso",
    "default": true,
    "policy": { "allowedPackages": ["Z*"] }
  },
  "PRD": {
    "url": "https://myYYYYYY.s4hana.cloud.sap",
    "client": "100",
    "authType": "sso",
    "policy": { "readOnly": true, "deniedTables": ["PA*", "HR*", "USR02"] }
  },
  "ONPREM": {
    "url": "https://sap.example.com:44300",
    "client": "100",
    "authType": "basic",
    "user": "DEVELOPER",
    "password": "${env:ONPREM_PASSWORD}",
    "tls": { "ca": "/etc/ssl/corp-ca.pem" }
  }
}
```

${env:VAR} pulls a secret from the environment so it never sits in the file, and tls.ca adds a corporate CA with certificate verification kept on. One system is enough to start. Keep just the entry you need.

### Step 2: Register with your AI client

The package is on npm as abap-adt-mcp, so npx is all you need. Nothing to clone, nothing to build.

Claude Code, one line:

```bash
claude mcp add abap-adt-mcp -e SAP_SYSTEMS_FILE=$HOME/.abap-adt-mcp/systems.json -- npx -y abap-adt-mcp
```

Claude Desktop (Settings → Developer → Edit Config, then quit and reopen the app; replace me with your user name, on Windows write C:/Users/<you>/.abap-adt-mcp/systems.json):

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "npx",
      "args": ["-y", "abap-adt-mcp"],
      "env": {
        "SAP_SYSTEMS_FILE": "/Users/me/.abap-adt-mcp/systems.json",
        "MCP_TOOLSETS": "focused"
      }
    }
  }
}
```

The same JSON works in Cursor, Cline and other hosts that read an mcpServers map; VS Code names the map servers instead. docs/HOSTS.md has the per-host form. Prefer a container? Images are published to GHCR (ghcr.io/williansaez/abap-adt-mcp) on every release, and the server is listed in the official MCP Registry as io.github.williansaez/abap-adt-mcp for hosts that browse it.

The server also supports an optional HTTP transport (loopback-only, protected by a Bearer token, the same model SAP's own ADT MCP Server uses); see the README if you prefer that over the default stdio setup.

### Step 3: Say hello

Restart your client and start small, building trust as you go:

1. "List my SAP systems and run a healthcheck." Confirms the connection works.
2. "Log in to DEV and show me the source of class CL_ABAP_CHAR_UTILITIES." First real read from the system (the browser window for SSO appears here).
3. "Show me the source of ZCL_SOMETHING and explain what it does." Reading actual code.
4. Then go for the full workflow from the top of this post: create a class, add a unit test, run it, check ATC.

![WSaez_3-1788350547814.png](https://community.sap.com/t5/image/serverpage/image-id/454780i5184D31F426BC860/image-size/large?v=v2&px=999)

If step 1 works, everything else will.

### 🎉 Bonus: Skip the technical part, let the agent manage the installation and the destinations itself

Claude Code users have the shortest path: the repository is a plugin marketplace, so two commands register the server and load the two skills that ship with it (one teaches the model how to develop ABAP with these tools, the other walks it through setup and a first health check):

```text
/plugin marketplace add williansaez/abap-adt-mcp
/plugin install abap-adt-mcp@abap-adt-mcp
```

The plugin expects systems.json at ~/.abap-adt-mcp/systems.json, and that file is the one thing left for Step 1. Ask the agent to write it, as in the second prompt below.

In any client that can run commands or edit files (Claude Code, or Claude Desktop with the filesystem extension), you do not have to do Steps 1 and 2 yourself either. Give the agent the README and the facts about your system, and let it work through the setup. The prompt that works best names the source of truth, the destination, and where to stop:

"Set up the abap-adt-mcp MCP server for me, following the Setup section of https://github.com/williansaez/abap-adt-mcp#setup. Check that Node.js 22.12 or newer is installed. Create ~/.abap-adt-mcp/systems.json with one destination called DEV: url https://myXXXXXX.s4hana.cloud.sap, client 080, SSO authentication, default, allowed packages Z*. Register the server in this client under the key abap-adt-mcp, started with npx -y abap-adt-mcp, with SAP_SYSTEMS_FILE pointing at that file and MCP_TOOLSETS=focused. Do not put any password in the file. Tell me when I have to restart the client."

Pointing at the README matters: the agent reads the current instructions instead of guessing from training data, and the per-host snippets (Claude Desktop, Claude Code, Cursor, VS Code) are all there. Two things stay with you: restarting the client, since the config and systems.json are read at startup, and the first browser login for SSO destinations.

Once the server is running, adding a destination is one sentence too, because systems.json is just a JSON file:

"Add a new SAP destination called ACME-DEV to my systems.json: url https://my999999.s4hana.cloud.sap, client 080, SSO authentication, allowed packages Z*, and mark it as the default."

The agent edits the file for you. Restart the client and listSystems confirms the new entry, policy included.

## Is This Safe? Read Before Pointing It at PRD

An AI with write access to SAP deserves a straight answer, so here it is:

- Guard rails are enforced by the server, not by the chat client. A policy block per destination (readOnly, allowedPackages, deniedTables, deniedTools, allowedTransports) is checked before every SAP call. Add "policy": { "readOnly": true } to any productive or test system and the server refuses every write there, whatever the model is asked.
- Every tool carries MCP read-only/destructive annotations, so your client can ask for approval on risky calls. Review destructive calls before approving them: deleteObject, transportRelease, transportDelete, setObjectSource, editObjectSource, runSnippet, pushRepo. Remember that runQuery and tableContents return real business data.
- Point it at development systems (that is the README's own advice) and use a least-privilege SAP user. The AI can only do what your user can do.
- Treat content coming back from SAP as untrusted input for the AI (prompt-injection awareness).
- Credentials hygiene is built in: ${env:VAR} references keep secrets out of systems.json, a world-readable file with inline passwords is refused at startup, secret redaction is unit-tested, and reentranceTicket is disabled by default because it would place a live logon credential into the chat.
- TLS verification stays on and cannot be switched off for everything at once. Since 1.0.1 the server deletes NODE_TLS_REJECT_UNAUTHORIZED=0 from its environment before the first connection and says so. A corporate CA goes into tls.ca, a certificate issued to another name than the one in the URL is handled by tls.servername (new in 2.0.0), and a failed handshake reaches the model with the exact fix for that destination. insecureTls still exists, per destination, off by default, announced at startup.
- Audit trail: set MCP_AUDIT_FILE and every tool call is appended as one JSON line (tool, destination, duration, outcome, policy gate, redacted arguments). Nothing else leaves the machine: no telemetry, no update checks.

And when the experiment is over, the same assistant cleans up after itself: one sentence deletes the demo class and package, and the system is left exactly as it was found.

![WSaez_6-1788350779351.png](https://community.sap.com/t5/image/serverpage/image-id/454784iE22A343139CAB257/image-size/large?v=v2&px=999)

For credibility: the project is validated against a four-layer test plan (static checks, offline protocol suites, live runs on a real S/4HANA Public Cloud tenant, and a Claude Desktop integration check), and the full write flow shown in this post was executed live end-to-end on that tenant: package and class created, activated, 2/2 unit tests green, ATC with zero findings, runClass printing its console output, rename and extract-method refactorings that kept the tests green, and full cleanup afterwards. The first live campaign (95 of the then 142 tools exercised, 87 green, the rest failing only for platform reasons) uncovered eight server bugs, all fixed and shipped as 0.3.1; the tools added since (runSnippet, grepPackage, atcSummary, exportPackageSources, getMethodSource/setMethodSource, progress notifications and more) were verified on the same tenant and are recorded in the addenda of docs/TESTPLAN.md. Release 1.0.0 then had ten documents fact-checked claim by claim against the code (2022 claims checked, 91 corrected), and 2.0.0 closed the last open dependency alert: npm audit reports zero vulnerabilities.

## How This Fits with Other SAP + MCP Projects

This is not the only SAP + MCP project out there, and the others are worth knowing: they solve different problems and combine nicely.

- SAP's official ADT MCP Server ships with ADT for VS Code and Eclipse and publishes under the server key abap-adt. abap-adt-mcp publishes under abap-adt-mcp with its own tool names, so the two can be registered side by side in the same host without collisions. What this project adds on top: many destinations from one process, server-side policies, and compositions such as resolveTransport, editObjectSource, grepPackage, apiReleaseState, runSnippet and objectDiff. docs/ROUTING.md maps SAP's tool names to ours where an equivalent exists.
- marianfoo's ABAP docs MCP server is a read-only reference library: it gives the AI access to the ABAP Keyword Documentation and Clean ABAP guidelines, and never touches a live system. It pairs beautifully with this project. Run both side by side, and the AI uses the docs server for "how should I write this?" and abap-adt-mcp for "now go do it."
- Skybuffer's MCP add-on is a commercial product installed inside the ABAP stack. It exposes business transactions (purchase orders, leave requests) to AI agents, which makes it an end-user and business-process play rather than a developer tool.
- abap-adt-mcp is free, open source, runs outside SAP on your own machine, and targets the developer workflow. No add-on, no license, no Basis project: just a URL and credentials.

## Try It, Break It, Tell Me

That's the whole pitch: an AI assistant with real hands in your ABAP development systems, free and open source, set up in about ten minutes.

If you want to try it:

- Repo: github.com/williansaez/abap-adt-mcp. npm: abap-adt-mcp. Container: ghcr.io/williansaez/abap-adt-mcp.
- Full tool reference: docs/TOOLS.md (all 173 tools, each marked read-only, write, or destructive).
- End-to-end workflows with exact tool sequences: docs/WORKFLOWS.md. Every option and policy: docs/CONFIGURATION.md.
- Authentication details: docs/AUTH.md. Security policy and the TLS decision: SECURITY.md.
- Teach the AI your team's conventions: there's a ready-to-fill agents.md template at docs/agents.template.md, and two skills under skills/.

I'd genuinely like to hear how it goes: what works, what breaks, what's missing. And a question for the comments: what's the first thing you'd ask an AI to do in your DEV system?

Thank you for reading!

*This post was assisted by GenAI. Every claim was reviewed, tested against a live system, and validated by me.*
