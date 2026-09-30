# SAP API Policy and this server

What the SAP API Policy says, where the ADT services this server calls stand under it, what the server does about it, and what only SAP can answer for your landscape.

> Written on 2026-09-29 against **SAP API Policy v.4.2026a**, SAP's **FAQ on the policy, version 1.3** (June 2026) and SAP's overview of the policy for user groups (2026-05-30). Both are living documents: check the primary sources in [References](#references) before relying on anything here. This page is information, not legal advice.

## The short version

- abap-adt-mcp talks to the ADT REST services under `/sap/bc/adt`, the ones Eclipse ADT uses. SAP does not list them on the SAP Business Accelerator Hub and does not publish them as an API contract.
- SAP's FAQ on the policy (question 33) calls the ADT APIs internal and says they may be used for development purposes through endorsed channels only. It lists those channels, and **a third-party MCP server is not among them**. It also lists what ADT is not intended for, which includes reading application tables, running SQL and agentic workflows on business data.
- The same FAQ (question 56) says customers and partners may use third-party MCP servers if the use complies with the agreement and the policy, recommends published APIs only, and states that the use of interfaces that are not published is at the customer's or partner's own risk, without support.
- The policy restricts the use of APIs by AI systems that choose and run sequences of calls, except through architectures SAP endorses. A language model driving this server is that pattern.
- So this server is outside the channels SAP endorses for ADT today. Whether SAP accepts your use is a question for SAP (your account executive, partner manager or customer success partner). The project cannot answer it for you. Ask before you use it on a system that matters, and keep it to development work on development and test systems.
- The server is built to make the conversation easy: it runs as the SAP user who logged on, it removes no SAP control and adds its own, it does not read business data unless you open that per destination, and it tells the model which SAP objects are released, not released or not permitted.

## What the policy says

Section numbers are the ones of v.4.2026a. The text is two pages long; read it.

| Section | In short | What it means here |
|---|---|---|
| 1.1 Published APIs | APIs on the SAP Business Accelerator Hub, or identified in the documentation of a product, may be used for the documented purpose. | ADT is not on the Hub. SAP documents ADT as a development tool and publishes an SDK for it (see below), which is not the same as publishing its REST services. |
| 1.2 Non-published APIs | Customer and third-party applications must not use them unless the documentation permits it or SAP authorizes it. They may change or disappear without notice. The duty to verify that an endpoint is published is on customers and partners. Interfaces developed by the customer in private cloud and on-premise systems are named as permitted. | This is the open question for every tool that speaks ADT over HTTP. The exception for customer interfaces covers what you build, not ADT. |
| 2.1 Specific controls | Rate limits, quotas and limits for bulk extraction are in the documentation of each API. | None is published for ADT. |
| 2.2.1 General controls | No use that puts the performance, stability or security of the system at risk. | See [Load](#load). |
| 2.2.2 AI systems and extraction | Outside the architectures and pathways SAP endorses for the purpose: no interaction with AI systems that plan, select or run sequences of API calls, and no scraping or large-scale extraction or replication of data. | See [Business data](#business-data) and [What only SAP can answer](#what-only-sap-can-answer). |
| 3 Monitoring and remedies | SAP may monitor, throttle, suspend or end access. Controls must not be bypassed, including through proxies, gateways, intermediary services or impersonation. | See [Identity](#identity). |

### What the FAQ says about ADT and about MCP servers

The FAQ is SAP's own explanation of the policy. It states that it is information and no binding commitment; it is still the most direct statement SAP has made on the subject.

| Question | In short | What it means here |
|---|---|---|
| 33, ADT and developer tooling | The ADT APIs are internal to SAP and may be used for development purposes through endorsed channels only. The channels it lists: Eclipse ADT as published by SAP, abapGit, developer tools provided by SAP that use ADT, CI/CD pipelines that use tooling published by SAP, and custom developer utilities built on the documented Eclipse Java SDK for internal automation such as code checks, builds and transport management. | This server is a Node.js program that speaks the ADT services over HTTP. It is none of the listed channels. |
| 33, scope | ADT must not be used outside its scope as a development tooling framework. Named as not intended: reading application tables or exporting business data by program, running SQL against the backend, business data integration, agentic workflows on business data, replacing business APIs. | `tableContents` and `runQuery` are exactly the first two. They are closed by default for that reason, see [Business data](#business-data). What is left when they are closed is development work: source, transports, activation, tests, ATC. |
| 56, third-party MCP servers | Customers and partners may use third-party or custom MCP servers to connect to SAP APIs when all use complies with the agreement, the documentation and the policy, with authentication and authorization on every connection and respect for the published limits. The operator is responsible for the server. SAP gives no support and recommends published APIs only; interfaces that are not published are used at own risk. | An MCP server is not ruled out as such. One that uses ADT uses interfaces that are not published. |

### What the overview adds

SAP's overview for user groups adds what the two pages of the policy do not spell out:

- Interfaces that are not published have always been used at the customer's own risk; SAP's support and stability obligations do not apply to them.
- Interfaces in the customer namespace (Z, Y: function modules, OData services, CDS views) stay permitted.
- An interface is **not permitted** when an SAP Note or an ATC check flags it so, when it is marked confidential or proprietary, or when it was found only by debugging or reverse engineering. ODP over RFC is the example, and the only one so far ([SAP Note 3255746](https://me.sap.com/notes/3255746)).
- SAP will extend the cloudification repository with classifications for interfaces that are not released and for interfaces that are prohibited, so that ATC checks flag them.
- The architectures SAP endorses for agents are in the SAP Architecture Center, among them "Third-Party MCP Access to SAP Solutions" and the MCP Gateway of SAP Integration Suite.

## Where ADT stands

What SAP has published around `/sap/bc/adt`:

| Content | What it covers | What it does not |
|---|---|---|
| ADT SDK and the guide to REST resources in ADT | Building your own ADT resources in the backend and using them from Eclipse. | A reference of SAP's own ADT services. |
| The discovery documents (`/sap/bc/adt/discovery`, `/sap/bc/adt/core/discovery`) | Each system lists its collections, the media types it accepts and its URL templates. `adtDiscovery`, `adtCoreDiscovery` and `systemProfile` read them. | Request bodies, semantics, errors. |
| The configuration guide for the ADT backend | The ICF services and the authorizations (`S_ADT_RES`, `S_DEVELOP`). | The protocol. |
| The ADT MCP Server inside ABAP Development Tools for Eclipse and for VS Code | SAP's own MCP server over the same backend, for agents inside the IDE. | Access for servers outside the IDE. |

So ADT over HTTP is long established, used by SAP's own tools and by open-source clients for more than ten years, not a published API in the sense of section 1.1, and by SAP's FAQ reserved to channels this server does not belong to. SAP has not classified the ADT services as not permitted (that list holds ODP over RFC only), and it has not cleared tools like this one either. Read it as: at your own risk, without support from SAP, and subject to what SAP tells you when you ask.

## What this server does about it

### Identity

Every call reaches SAP as the user of the destination, and SAP's own authorization checks (development authorizations, package checks, table display authorizations) run as they would for Eclipse. The server removes none of them and cannot: it has no access the user does not have.

With `authType: "sso"` and `"sso2"` that user is the person at the keyboard. With `"basic"` and `"oauth"` it is whoever owns the stored credentials, which can be a technical user shared by several people; SAP then sees one identity. Prefer named users where section 3 matters to you. [docs/AUTH.md](AUTH.md) has the modes.

### Guard rails of its own

The `policy` of a destination is evaluated in the server before the call, whatever the host approved: `readOnly`, `deniedTools`, `allowDataPreview`, `allowFreeSql`, `deniedTables`, `allowedPackages`, `allowedTransports`. [docs/CONFIGURATION.md](CONFIGURATION.md#3-policy-in-depth) documents each key.

### Business data

Reading rows of tables and CDS views is what question 33 of the FAQ names first among the uses ADT is not intended for, and the part of ADT closest to what section 2.2.2 calls extraction. It is the one capability that is closed until you open it, and opening it is a decision to take with that sentence of the FAQ in mind:

| Capability | Tools | Default | Opened by |
|---|---|---|---|
| Rows of a table or CDS entity by name | `tableContents` | off | `"allowDataPreview": true` in the policy of the destination |
| ABAP SQL written by the model | `runQuery`, `tableContents` with `sqlQuery` | off | `"allowFreeSql": true` (implies the row above) |

`MCP_ALLOW_DATA_PREVIEW=1` and `MCP_ALLOW_FREE_SQL=1` set the default for the destinations that do not state the key; a destination that states `false` stays closed. `listSystems` shows the effective `dataAccess` of every destination. Where data is open, `deniedTables` keeps named tables out, the data preview caps the rows of a call (100 unless asked otherwise) and the response is capped in size.

What the two switches do not cover: code that the model writes and runs (`runSnippet`, `runClass`) can select data and print it, and a debugger session shows the variables of the program it is attached to. `readOnly` refuses running code and attaching the debugger; `deniedTools` (`"runSnippet"`, `"runClass"`, `"toolset:debugger"`) closes them on a destination that stays writable.

### Released, not released, not permitted

`apiReleaseState` answers from SAP's cloudification repository, the content the ATC checks use, and adds `apiPolicy` to every object it checks:

| `apiPolicy` | Repository state | Meaning |
|---|---|---|
| `released` | `released`, `deprecated` | Released API. Deprecated ones name a successor. |
| `classic` | `classicAPI` | Classic API: for classic ABAP and the 3-tier model, not for ABAP Cloud. |
| `notReleased` | `notToBeReleased`, `notToBeReleasedStable`, `noAPI`, and any state this version does not know | SAP-internal, no release for customer use. |
| `prohibited` | a state or label that says prohibited, not permitted, unpermitted, forbidden or not allowed; or a name SAP declared not permitted in an SAP Note | Do not call it. Outranks every other state of the same object. |
| `customer` | | Y/Z or customer namespace: not an SAP API. |
| `unknown` | | Not in the repository. Verify in the system. |

The repository does not carry the prohibited classification yet (checked on 2026-09-29: the states in use are the six above). The server is ready for it without a new release:

- Every array of entries in a file is read, whatever its key.
- A state the server does not know is reported as SAP wrote it, flagged `unrecognizedState`, and never counted as cloud ready.
- `MCP_API_CLASSIFICATION_FILES` adds files: a path inside the repository (`partner/objectClassifications_ACME.json`) or an `https` URL, comma separated. A file that cannot be read is reported in the answer, not skipped in silence.
- Until then, the interface SAP has declared not permitted in a Note is built in: the function modules of the ODP Data Replication API (`RODPS_REPL*`, SAP Note 3255746).

`apiPolicy` is a reading of what SAP classified. It is not a statement that a use is compliant.

### Load

Calls to one destination run one after the other, never in parallel. A `429` or `503` from SAP or a gateway in front of it is retried once, after the `Retry-After` it names. There is no bulk export of table data; `exportPackageSources` copies source code, and `deniedTools` closes it.

### Record

`MCP_AUDIT_FILE` writes one line per call: tool, destination, outcome, the policy gate that refused it. See [README: Audit log](../README.md#audit-log).

## What only SAP can answer

Questions to put to your SAP contact, in writing:

1. Question 33 of the FAQ lists the endorsed channels for ADT. Is a tool outside that list, used by a named developer for development work only (source, transports, activation, tests, ATC), accepted for our contract and deployment, and under which conditions?
2. Does an MCP server on the developer's machine, run by that developer, count as one of the endorsed pathways of section 2.2.2? If not, which architecture would: the ADT MCP Server of the IDE, the MCP Gateway of SAP Integration Suite, a server on SAP BTP?
3. Does the answer differ between S/4HANA Cloud Public Edition, Private Edition and on-premise?
4. Are there rate limits for ADT we should stay under?

Until you have the answers, the conservative setup is: development and test systems only, named users, `allowedPackages` on every destination that may be written to, data access left closed.

```json
{
  "DEV": {
    "url": "https://myXXXXXX.s4hana.cloud.sap",
    "client": "080",
    "authType": "sso",
    "policy": { "allowedPackages": ["Z*"], "allowedTransports": ["DEVK9*"] }
  },
  "QAS": {
    "url": "https://myYYYYYY.s4hana.cloud.sap",
    "client": "100",
    "authType": "sso",
    "policy": { "readOnly": true, "deniedTools": ["exportPackageSources"] }
  }
}
```

## References

- [SAP API Policy](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf) (v.4.2026a at the time of writing)
- [SAP API Policy FAQ, version 1.3, June 2026](https://d.dam.sap.com/x/UL9AiqH/SAP_API_Policy_FAQ_v1.3_June.pdf): questions 33 (ADT) and 56 (third-party MCP servers)
- [SAP API Policy overview for user groups, 2026-05-30](https://assets.dm.ux.sap.com/sap-user-groups/pdfs/260530_sap_api_policy_overview.pdf)
- [SAP Architecture Center: Third-Party MCP Access to SAP Solutions](https://architecture.learning.sap.com/docs/ref-arch/137800)
- [SAP Note 3255746](https://me.sap.com/notes/3255746): ODP Data Replication API over RFC
- [SAP cloudification repository](https://github.com/SAP/abap-atc-cr-cv-s4hc)
- [SAP Help: Enabling ADT MCP Server](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/enabling-adt-mcp-server)
