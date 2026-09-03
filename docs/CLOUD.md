# S/4HANA Cloud

Everything in abap-adt-mcp that behaves differently on SAP S/4HANA Cloud. The [README](../README.md#s4hana-cloud-versus-on-prem) has the one-table summary; this is the long version, built from what [docs/TESTPLAN.md](TESTPLAN.md) and [docs/FIELD-NOTES.md](FIELD-NOTES.md) recorded on a Public Edition tenant and from what the code does (`src/lib/systemProfile.ts`, `src/lib/browserLogin.ts`, `src/lib/cookieHttpClient.ts`, `src/lib/oauth.ts`, `src/lib/runFresh.ts`, `src/lib/apiReleases.ts`). "Cloud" means Public Edition unless a paragraph says otherwise. Setup and environment variables are in [docs/CONFIGURATION.md](CONFIGURATION.md), tool sequences in [docs/WORKFLOWS.md](WORKFLOWS.md), the per-tool reference in [docs/TOOLS.md](TOOLS.md), the authentication modes in [docs/AUTH.md](AUTH.md).

Placeholders: `https://myXXXXXX.s4hana.cloud.sap` (tenant), `ZEXAMPLE` (package), `ZCL_EXAMPLE` (class), `DEVK900123` (transport), `DEVELOPER` (user).

## 1. Three clouds, one server

| Edition | Host pattern | What the server knows about it |
|---|---|---|
| S/4HANA Cloud Public Edition | `myXXXXXX.s4hana.cloud.sap` | Browser SSO (IAS) for named users, OAuth2 or a Communication User for unattended clients. ABAP for Cloud Development only; `$TMP` refused on the tested tenant; some ADT collections missing. The edition every live test ran against. |
| BTP ABAP Environment | `*.abap.<region>.hana.ondemand.com`, `*.abap-web.<region>.hana.ondemand.com` | Classified as `cloud` by the `CLOUD_HOST` pattern in `src/lib/systemProfile.ts`; `apiReleaseState(edition="btp")`. Not exercised live: expect the Public Edition behaviour below and confirm with `systemProfile`. |
| S/4HANA Cloud Private Edition | Customer domain | Treated like on-prem: `basic` auth, `tls` client certificates, `platform: "onprem"` derived from the host name, the system information and the discovery collection set. `apiReleaseState(edition="pce2023")` or `apiReleaseState(edition="pce2022")` reads the 3-tier extensibility lists. Nothing else in the repository is specific to it. |

`systemProfile(destination)` tells which one you are talking to: `platform` is `cloud`, `onprem` or `unknown`, with a `platformReason` such as `host myXXXXXX.s4hana.cloud.sap is an SAP cloud tenant domain`. `listSystems` repeats `platform` and `unavailableToolsets` once a profile exists.

## 2. Authentication

### 2.1 Browser SSO for named users

Public Edition does not answer `401` to a named business user with a password: the ADT endpoints redirect to the identity provider (IAS) instead, which is why test 2.10 in [docs/TESTPLAN.md](TESTPLAN.md) could not even provoke an authentication error. `authType: "sso"` (the default) does what Eclipse ADT does:

1. `login`, or the first tool call on the destination, launches a Chromium browser through `puppeteer-core` (nothing is downloaded). Chrome, Edge and Brave are auto-detected under `/Applications` on macOS; elsewhere `SAP_BROWSER_PATH` names the executable, otherwise the login fails with `No Chrome/Edge/Brave found for SSO login`. Concurrent calls share one in-flight login.
2. The window opens `/sap/bc/adt/core/discovery?sap-client=<client>` and you complete the IAS login. The server polls the browser's cookie jar over the DevTools protocol every 1.5 seconds for up to 300 seconds and returns once a `SAP_SESSIONID*` or `MYSAPSSO2` cookie for the tenant host appears; closing the window first fails with `Browser was closed before the SSO login completed`.
3. The harvested cookies stay in memory. Every ADT request carries them plus `sap-client=<client>`, because the cookies alone land the session in the tenant's default client (added in 0.3.1 after a live run hit the wrong client, [CHANGELOG.md](../CHANGELOG.md)).

**Persistent profile.** The login window is not incognito. It uses a dedicated Chromium user-data directory per host, `~/.abap-adt-mcp/sso/<host>`, created with mode `0700`, so ticking "stay signed in" at IAS makes later logins silent (about six seconds on the tested tenant). It holds the identity-provider session the browser keeps; the harvested SAP cookie itself is held in memory only. Deleting the directory is the only way to end the identity-provider session early. `SAP_BROWSER_PROFILE_DIR` points the login at a profile you maintain yourself (saved passkeys, for instance); Chrome's default profile on macOS is refused by name, because Chrome 136 and later block automation on it and the cookie harvest would see every site in it.

**Which client.** `client` must be the client the SSO session actually lands on. On the tested landscape the development tenant logged on to `080` and the customizing and test tenants to `100`; that is an observation, not a rule, and the About entry of the launchpad user menu shows the value for yours. A wrong `client` gives a successful login followed by `authorization` or `notFound` errors on objects that open in Eclipse ([README, Troubleshooting](../README.md#troubleshooting)). On that landscape the development tenant also had its own host, and the first Layer 3 run failed because the `DEV` destination pointed at the customizing host: one destination per tenant, each with its own `url` and `client`.

**Expiry detection.** An expired SSO session does not fail either: IAS answers the redirect chain with its HTML login page and HTTP `200`. `CookieHttpClient.looksLikeLoginPage` recognises a 2xx or 3xx HTML body carrying SAML or IAS markers (`SAMLRequest`, `sap-idp`, `accounts.sap.com`, `Identity Authentication`) or a logon form and raises `SESSION_EXPIRED` instead of handing HTML to the ADT parser (the `/icf/logoff` answer is exempt, so `logout` is not mistaken for an expiry). The dispatcher classifies it as `kind: "sessionExpired"`, re-runs the browser login silently and retries the call once; lock handles from the old session are forgotten, so a retried write fails with `staleLockHandle` and you lock again. If the error keeps coming back, call `login`.

**Where SSO cannot run.** A container has no browser, so SSO destinations run from npm on the workstation and only `basic` or `oauth` destinations work inside one ([README, Other ways to install](../README.md#other-ways-to-install)). On the HTTP transport every remote caller would share the browser login of the user running the server; a non-loopback bind warns about it at startup ([docs/CONFIGURATION.md](CONFIGURATION.md#6-http-transport)).

### 2.2 OAuth2 client credentials for unattended clients

`authType: "oauth"` with an `oauth` block (`tokenUrl`, `clientId`, `clientSecret`, optional `scope`, all accepting `${env:VAR}`) implements the `client_credentials` grant only: the server posts to `tokenUrl` with HTTP Basic credentials built from the client id and secret, caches the `access_token` until 60 seconds before `expires_in` (3600 seconds when the endpoint omits it) and sends it as a bearer on every ADT call. A `401` on a token still inside its lifetime is treated as an expired session: the cached token is dropped (`invalidate` on the bearer fetcher), the ADT session dropped, a fresh token fetched and the call retried once. The legacy variables `SAP_OAUTH_TOKEN_URL`, `SAP_OAUTH_CLIENT_ID`, `SAP_OAUTH_CLIENT_SECRET` and `SAP_OAUTH_SCOPE` with `SAP_AUTH_TYPE=oauth` configure the same thing without `systems.json`.

The SAP side is done once per tenant by an administrator ([docs/AUTH.md](AUTH.md#sap-side-setup-per-tenant-done-by-an-administrator)): a Communication User (its client id and secret become `clientId` and `clientSecret`), a Communication System with OAuth 2.0 as authentication method, and a Communication Arrangement for the communication scenario that exposes ADT on the tenant. The arrangement is authoritative for `tokenUrl` (often `/sap/bc/sec/oauth2/token`) and any `scope`; which scenario grants ADT access depends on the tenant's developer-extensibility enablement and the repository does not name one. The tools then run with the Communication User's authorizations; `client` travels on the ADT calls, not on the token request. [docs/CONFIGURATION.md](CONFIGURATION.md#s4hana-cloud-oauth2-for-an-unattended-client) has the recipe, a table of what to take from the arrangement, and the `-api` host question (the arrangement publishes its inbound services on the tenant's API host, `myXXXXXX-api.s4hana.cloud.sap` by convention). OAuth is documented, not part of the recorded live tests.

### 2.3 Basic auth with a Communication User

A Communication User carries its own password, so `authType: "basic"` with `user` and `password` works on Public Edition for that kind of user (never for named business users), and it is the normal mode for Private Edition and on-prem. Like `oauth`, it authenticates on the first call and an expired session is re-established once; the end of [docs/CONFIGURATION.md, S/4HANA Cloud OAuth2](CONFIGURATION.md#s4hana-cloud-oauth2-for-an-unattended-client) compares the two and prefers `oauth`; neither mode was exercised live by this repository.

### 2.4 Roles and authorizations the repository documents

Only what the live sessions hit; ask your administrator for the rest.

| Need | What the repository says |
|---|---|
| Use the server as a named user | The business role that allows Eclipse ADT on the tenant, `SAP_BR_DEVELOPER` in the standard delivery. If Eclipse ADT works for you, the server works too ([README, Setup](../README.md#setup)). |
| Objects in `$TMP` | Refused on the tested tenant by authorization object `S_ABPLNGVS` (section 3.1). |
| `runSnippet`, `runClass` | `S_DEVELOP`: development systems only, a test system refused `runSnippet` ([docs/FIELD-NOTES.md](FIELD-NOTES.md), session B). |
| `runQuery`, `tableContents` | `S_TABU_DIS` and `S_TABU_NAM` still apply (section 8). |
| Debugger, traces, abapGit | Depends on the tenant and the user's authorizations; `systemProfile` tells (section 5). |
| Unattended clients | Whatever the arrangement's scenario grants to the Communication User. |

An `authorization` error (`kind: "authorization"`, hint pointing at `SU53`) is never retried by the server. Section 6 lists every refusal shape the server can produce, cloud or not, in one place.

## 3. The development model

### 3.1 ABAP for Cloud Development and the end of `$TMP`

On Public Edition every customer object is written in ABAP for Cloud Development: released APIs only, checked by the ATC variant `ABAP_CLOUD_DEVELOPMENT_DEFAULT`. The language version is a property of the package, which is why `$TMP` is a problem: on the tested tenant every attempt to create an object there came back with `S_ABPLNGVS`, because objects in `$TMP` get the Standard language version and cloud users may not change that. Consequences:

- `runSnippet` defaults `packageName` to `$TMP`, correct on-prem. On cloud pass a customer package plus its `transport` and `responsible`; the `$TMP` refusal carries a hint saying exactly that, and the create and delete of the temporary class are recorded on the transport: `runSnippet(code="...", packageName="ZEXAMPLE", transport="DEVK900123", responsible="DEVELOPER")`.
- `resolveTransport(objSourceUrl)` still answers `needsTransport: false` for local packages (delivery unit `LOCAL`, a name starting with `$`, or a non-recording package without locks), so a local customer package works without a transport; the first live round created a local package under a customer package and its throwaway class there, and the later rounds used a transportable package whose transport `resolveTransport` found through the object's transport lock. For transportable packages it returns the transport already locking the object, else the newest modifiable one of the user, else asks for `createIfMissing=true`.
- The server `instructions` ("Use $TMP for local throwaway development") and the `abap-adt-mcp` skill ("Prefer `$TMP` for experiments") serve both platforms; on cloud read that as "use your local customer package". The `allowedPackages` recipe for a cloud entry lists `Z*` only; `$*` belongs on the on-prem entry ([README, Setup](../README.md#1-describe-your-sap-systems)).

**Local or transportable, when the task does not say.** "Create an object in a transportable package" only tells you the package must record changes; it does not say whether that package already exists. Treat it as two separate questions and answer both before calling `createObject` for the object itself: pick or create the package first (an existing transportable package needs nothing extra beyond `resolveTransport` below; a package that does not exist yet is created with `createObject(objtype="DEVC/K", ...)` as in 3.2), then create the object inside it. When nothing says "transportable" at all, a local customer package (no separate creation step, `resolveTransport` answers `needsTransport: false`) is the lighter default for anything that is not meant to leave the development tenant; the session checklist in section 12 makes the same choice explicit.

### 3.2 Creating packages and objects

`createObject` gained the fields cloud backends insist on during the 0.3.1 live round:

- `responsible`, the SAP user recorded as the person responsible. The SSO client logs in with the placeholder user name `sso`, which the backend rejects as responsible, so pass your real user on every create. For `DEVC/K` the server omits the attribute when you leave it out and the backend defaults to the session user. This is the only one of the two write arguments below that a create call needs: `transport` matters here too when the package is transportable, but `responsible` never applies to the writes that follow (`setObjectSource`, `editObjectSource`, `setMethodSource` take `transport`, never `responsible`).

  **Finding your SAP user id.** Nothing about the SSO harvest produces one: the ADT client logs every SSO destination in with the placeholder `sso`, which is exactly the value the backend rejects as `responsible`, and `listSystems` reports no user for any destination. Cheapest sources, in order:

  | Source | How |
  |---|---|
  | The browser login | The user you typed into the IAS form is your SAP business user, the same name Eclipse shows for the project. |
  | `systemUsers(startIndex, maxItems)` | Lists SAP user ids and names (`id`, `title`); page through it or scan the returned names for your own when you only remember part of it. Whether it answers at all depends on the connected user's authorizations. |
  | A transport you already own | `resolveTransport(objSourceUrl=<any object in your package>)`: `candidates[].owner` lists the owner of each modifiable request for the current user; `transportDetails(transportNumber)` shows the owner of one request. |
  | An object you changed | `revisions(objectUrl)` lists `author` per revision. |
  | On-prem or a development tenant without the cloud `$TMP` restriction | `runSnippet(code="out->write( sy-uname ).")` prints it directly, but on cloud `runSnippet` itself needs `responsible`, so it cannot be the first step there. |

  Full detail, and the other tools that want the same name (`activatePackage(user)`, `dumps(user)`, `userTransports(user)`): [docs/WORKFLOWS.md, Your SAP user name](WORKFLOWS.md#your-sap-user-name).
- `DEVC/K` packages need `swcomp` (for example `ZLOCAL` or `HOME`), optionally `transportLayer` (empty for local packages), `packagetype`, `recordChanges` (defaults to `true` when a transport layer is given; transportable packages on cloud reject a body without it, which is why the server builds the package XML itself) and `abapLanguageVersion` (`"5"` requests ABAP for Cloud Development; omit it to let the system decide). A transportable package worked example, every cloud-relevant field present: `createObject(objtype="DEVC/K", name="ZEXAMPLE_SUB", parentName="ZEXAMPLE", description="Example sub-package", parentPath="/sap/bc/adt/packages/zexample", swcomp="ZCUSTOM_DEVELOPMENT", transportLayer="Z_LAYER", packagetype="development", recordChanges=true, abapLanguageVersion="5", responsible="DEVELOPER", transport="DEVK900123")`. Only `swcomp` is mandatory; the rest have the defaults just described. The class, interface and program rows of the per-type table, plus what `validateNewObject` and `creatableTypeDetails` check first, are in [docs/WORKFLOWS.md#4-creating-objects](WORKFLOWS.md#4-creating-objects).
- The transport for an object that does not exist yet is resolved on its package: `resolveTransport(objSourceUrl="/sap/bc/adt/packages/zexample", devClass="ZEXAMPLE", createIfMissing=true)`. `createIfMissing` is not a shortcut that always makes a new request: `resolveTransport` works through its decision order first regardless of the flag (the transport already locking the object or package, then the newest modifiable transport the current user already owns for that package) and only creates a new one when neither candidate exists, so passing it costs nothing when a suitable transport is likely already there. Omitting it just changes the failure mode when none exists: you get `transport: null, needsTransport: true` back with a reason, instead of a created request, and call `createTransport` or rerun with the flag yourself. A destination with `allowedTransports` refuses `createIfMissing=true` outright (and `createTransport`), so there you always pass a named transport instead.

Then write the source with `setObjectSource(objectSourceUrl="<object url>/source/main", source, activate=true, transport)`, a full rewrite: a brand-new object has nothing for `editObjectSource`'s exact-text anchors to match, so that tool answers "0 matches" on it (see 3, Changing code safely, in [docs/WORKFLOWS.md](WORKFLOWS.md#3-changing-code-safely)). `editObjectSource` and `setMethodSource` come back into play only once the object has source to change.

The `create-object` prompt runs this whole sequence with `responsible` and `apiReleaseState` on cloud. Its optional `purpose` argument is plain text folded into the rendered instructions ("Purpose: ...") for whichever model executes the prompt; it does not write or generate ABAP source by itself and does not replace `setObjectSource`. The source that step still writes is whatever the model (you, or the host running the prompt) authors and passes as `source`.

### 3.3 Released APIs: `apiReleaseState`

Cloud code may only use SAP objects released for the edition, and a model recalling release states from memory is what this tool prevents. Four inputs, combinable in one call: `names` (comma-separated, optionally typed: `CL_ABAP_CHAR_UTILITIES, TABL:MARA, FUGR:BAPI_...`), `objectUrl` (mapped to a TADIR type and also asked of the backend), `source` (pasted ABAP) or `sourceUrl` (read through the source cache and scanned for `SELECT` targets, `TYPE` references, `CL_`/`IF_`/`CX_` names, `CALL FUNCTION`, `INTERFACES` and `INHERITING FROM`, skipping names declared in the source and customer names).

`edition` selects the list: `cloud` (default, `objectReleaseInfoLatest.json`), `btp` (`objectReleaseInfo_BTPLatest.json`), `pce2023` and `pce2022`. The files come from SAP's cloudification repository (`raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc`, plus `objectClassifications_SAP.json`), cached in memory and on disk under `~/.abap-adt-mcp/cache` (`MCP_CACHE_DIR` relocates it) for 24 hours; `refresh=true` re-downloads and a stale cache beats a failed download. No proxy or mirror: on an air-gapped host seed the cache directory once ([README, Keeping it safe](../README.md#keeping-it-safe)).

Each verdict has a `state`: `released` (cloud-ready), `deprecated` (with `successors`), `classicAPI` (classic ABAP and, with care, the 3-tier model), `noAPI`, `customer` (Y/Z or customer namespace: not an SAP API, its own language version decides) and `unknown` (not in the repository, which lists objects with a release decision rather than every SAP object: verify with `ddicElement` or `abapDocumentation` before calling it a blocker). The answer groups `summary`, `blockers`, `unknown`, `results` and, for `objectUrl`, `backendApiRelease` from `/sap/bc/adt/apireleases`; the tested tenant answered `state=RELEASED`, `contract=C4` for the object checked.

### 3.4 ATC on cloud

`createAtcRun(mainUrl, variant="ABAP_CLOUD_DEVELOPMENT_DEFAULT")` accepts the variant name and resolves it to a worklist, then `atcWorklists` or `atcSummary` read the findings. `mainUrl` takes an object, package or transport URL: right after creating and activating a single class, `createAtcRun(mainUrl="/sap/bc/adt/oo/classes/zcl_example", variant="ABAP_CLOUD_DEVELOPMENT_DEFAULT")` checks that one object (the object URL `createObject` or `searchObject` returned, no `/source/main`); `mainUrl="/sap/bc/adt/packages/zexample"` checks everything in a package instead, and `mainUrl="/sap/bc/adt/cts/transportrequests/DEVK900123"` everything recorded on a transport. `atcSummary` on a two-object package took about 14 seconds on the tested tenant and sent progress heartbeats meanwhile. The `atc` toolset is gated on `/sap/bc/adt/atc`, which the tenant exposed.

**`apiReleaseState` and `createAtcRun` are not alternatives for the same question; the workflow expects both.** `apiReleaseState` checks whether the SAP objects your code *calls* are released for the edition, against SAP's cloudification repository, and it can run before a line is activated (`source`, or `sourceUrl` on an inactive write); `createAtcRun` with `ABAP_CLOUD_DEVELOPMENT_DEFAULT` checks the ABAP-for-Cloud-Development *language* rules (statements, constructs) against the object as it stands in the system. [docs/WORKFLOWS.md, ABAP Cloud readiness](WORKFLOWS.md#9-abap-cloud-readiness) states the rule plainly: an object that passes both is cloud-ready whatever its package's language-version attribute says. That is why the `create-object` prompt runs `apiReleaseState` before writing and `createAtcRun` after activating in the same sequence, and why the `clean-core-check` prompt runs both rather than picking one.

## 4. Sessions and running code

Every destination has one stateful ADT session and the dispatcher serialises its calls. Two facts about that session matter on cloud:

- **Locks live in it.** `dropSession` ends the stateful context and every lock it held. A lock held by another session, typically an open Eclipse window of the same user, is foreign: `listLocks` does not show it and `forceUnlock` cannot release it. The `locked` hint mentions `SM12`, a SAP GUI transaction outside the ADT surface this server uses and one a Public Edition developer is unlikely to have; assume only the other session can let go.
- **It keeps the program load.** After a write and activation the same stateful session still runs the old code: `runClass` printed the previous output on the tested tenant while `getObjectSource` and `activateByName` were current ([docs/TESTPLAN.md](TESTPLAN.md), addendum of 2026-09-03). `runClass` and `runSnippet` therefore always run with a fresh load (`src/lib/runFresh.ts`): on `basic` and `oauth` destinations through a stateless clone of the client (`runMode: "clone"`, locks untouched); on `sso` destinations, which cannot be cloned, by sending a stateless request on the session itself (`runMode: "stateless"`), which ADT treats like `dropSession`. The explicit locks released beforehand are listed in `locksInvalidated`; lock again before the next write.

`runSnippet` reports its `steps` (`created`, `source written`, `activated`, `ran`, `deleted`) and a `cleanupError` when the delete failed; an activation error returns `phase: "activation"` with messages whose line numbers refer to the generated class (the body starts at line 8).

**Running a class you wrote yourself.** `runClass(className)` does none of that shaping: unlike `runSnippet`, it takes only a class name and runs the class exactly as it stands, with no wrapper built around it. Console output only appears when the class already implements `IF_OO_ADT_CLASSRUN` and writes through the `out` parameter of `IF_OO_ADT_CLASSRUN~MAIN` (`out->write( ... )`), the same interface `runSnippet`'s generated wrapper implements; a class created without that interface activates and runs but has nothing for `runClass` to show. So a hand-written class meant for `runClass` needs the interface from the start:

```abap
CLASS zcl_example DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_example IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    out->write( 'hello' ).
  ENDMETHOD.
ENDCLASS.
```

Create and write it as in 3.2 (`createObject` then `setObjectSource(activate=true)`), then `runClass(className="ZCL_EXAMPLE")`. For throwaway code, skip all of that and use `runSnippet` instead, which builds this same wrapper for you and deletes it again afterward.

## 5. What the tenant serves: `systemProfile` and the platform gate

The profile is built from the ADT discovery document and `/sap/bc/adt/system/information`. `features` maps the collections the server cares about (`debugger`, `traces`, `abapGit`, `atc`, `rapGenerator`, `serviceBindings`, `textSearch`, `apiReleases`, `feeds`, `dataPreview`, `unitTests`, `refactorings`, among others); ten toolsets depend on one of them (`debugger`, `traces`, `git`, `atc`, `rap`, `services`, `runtime` on `feeds`, `tests`, `data`, `refactoring`), the rest are never gated. The tested tenant reported 976 collections with only `rap` unavailable; debugger, traces and abapGit were present in discovery, and whether their tools then work depends on the user's authorizations.

With `MCP_PROFILE_GATE=enforce` (default) a tool of a missing toolset is refused before any SAP call: `Tool debuggerListen is not available on destination DEV (S/4HANA Cloud does not expose the ADT debugger collection; see systemProfile)`, with the suggestion to use `dumps`/`dumpDetails` instead of the debugger and ATC instead of traces. The profile is built on the first call of a gated toolset when nobody called `systemProfile`, cached for the life of the server instance and rebuilt with `refresh=true`; `warn` logs the message and lets the call through, `off` disables the gate; a profile that cannot be built lets the call run unchecked. The audit log records refusals with `outcome: "unavailable"`. Do not confuse the gate with `MCP_TOOLSETS`: the `focused` preset publishes no `debugger`, `traces`, `git` or `rap` tools at all, and that refusal names the toolset ([docs/CONFIGURATION.md](CONFIGURATION.md#the-platform-gate)).

**Text search.** `sourceTextSearch` uses the ADT text index at `/sap/bc/adt/repository/informationsystem/textsearch`; `textSearch` appears in `features` but gates nothing. The tested tenant answered `Source Search is not supported` (message `SRIS_SEARCH 006`); the server maps that, like `404` and `501`, to "unavailable" and, when the call named `packages`, runs `grepPackage` over them and says so in `fallback`. Without `packages` the error tells you to call `grepPackage(packageName, pattern)` yourself. `grepPackage` downloads each source once into the session cache (`MCP_SOURCE_CACHE_TTL_SECONDS`), supports regex, context lines and `recursive=true`, is bounded by `maxObjects` and `maxMatches`, and works on every system.

**`notFound` on cloud.** A missing endpoint outside the ten gated features surfaces as a plain `404`; the `notFound` hint therefore ends with "On S/4HANA Cloud some ADT endpoints do not exist: check systemProfile for the destination" and lists `systemProfile` in `nextTools`.

## 6. Why a call is refused

Refusals are described one at a time across this document and the README; this section collects them, so "why was this tool refused" has a single place to look. Every error the dispatcher throws, whatever produced it, passes through one function right before it reaches the client (`classifyAdtError`, `src/lib/adtErrorHints.ts`) and comes back as JSON with `error`, `code` and, when the message text matches one of eleven patterns, `kind`, `httpStatus`, `hint` and `nextTools`; a message that matches none of them (`unknown`) carries no `kind`. That is why a policy refusal, which never touches SAP, still comes back with `kind: "policyDenied"`: its message starts with `Policy:`, which the classifier treats the same whether the text came from `systems.json` policy or, hypothetically, from SAP itself. The platform gate's message ("Tool X is not available on destination...") and a toolset a preset never published ("Tool X belongs to toolset...") match none of the eleven patterns, so both carry no `kind` at all, only the plain message; the platform gate's refusal is still visible in the audit log as `outcome: "unavailable"`.

| Refusal | `kind` | Retried automatically? | What it means | Detail in this document |
|---|---|---|---|---|
| Policy denial | `policyDenied` | No, and never will be: the hint says to pick another destination or change `systems.json` | The destination's `policy` block (`readOnly`, `deniedTools`, `allowedPackages`, `allowedTransports`, `allowFreeSql`, `deniedTables`) refuses the call before any SAP request | [README, Keeping it safe](../README.md#keeping-it-safe) |
| Toolset not published | none (message names the toolset) | No | `MCP_TOOLSETS`/`MCP_DISABLED_TOOLSETS` left the tool out of the list entirely; a call by name (from a prompt or a cached tool list) is refused | Section 5 |
| Platform gate | none (audited as `outcome: "unavailable"`) | No | `systemProfile` found the tool's ADT collection missing on this tenant (`MCP_PROFILE_GATE=enforce`, the default) | Section 5 |
| Session expired | `sessionExpired` | Yes, once, silently (browser re-login on `sso`, a fresh token on `oauth`, re-authenticate on `basic`) | The SSO cookie hit the IAS login page, or a token/credential 401'd | 2.1, 2.2 |
| CSRF rejected | `csrf` | Yes, once (re-authenticates like `sessionExpired`) | The CSRF token was rejected and the session reset | Not cloud-specific; re-acquire any `lockHandle` after |
| Stale lock handle | `staleLockHandle` | No: `lock` again | A write retried after a session re-auth carried a `lockHandle` from the session that no longer exists | Section 4 |
| Locked | `locked` | No | Another session (an open Eclipse window of the same or another user) already holds the lock; absent from `listLocks`, so `dropSession`/`forceUnlock` cannot touch it | Section 4; the hint's `SM12` is a SAP GUI transaction, nothing this server can reach |
| Transport required | `transportRequired` | No | A write needs a transport, or the object is already recorded on a different one | 3.1, 3.2 |
| Authorization | `authorization` | No, never retried | The connected user lacks the SAP authorization (hint points at `SU53`) | 2.4 |
| Not found | `notFound` | No | `404`; on cloud the hint adds "check systemProfile for the destination" since some ADT endpoints simply do not exist there | Section 5 |
| Rate limited | `rateLimited` | Not by the dispatcher; on `sso` destinations the cookie client already retried a `GET`/`HEAD`/`OPTIONS` once, honouring `Retry-After` up to 5 seconds. The hint says to wait a few seconds | SAP answered `429` or `503` | Not cloud-specific |
| Ambiguous request | `ambiguous400` | No | SAP rejected the request as invalid (`400`): usually a name where a URL was expected, a missing `/source/main`, or a missing `lockHandle` | Not cloud-specific |
| Server error | `serverError` | No (the hint says check `dumps` before retrying a write) | SAP-side `5xx`, often a short dump | Section 7 |
| Unclassified | none (`kind` absent) | No | The classifier could not place the error; only the message comes back | Not cloud-specific |

## 7. Root cause without a debugger

When `systemProfile` lists `debugger` under `unavailableToolsets`, or the toolset is not published, the path is the dump feed: `dumps(from, to, user, contains, maxItems)` returns compact summaries with `runtimeError`, `exception`, `program`, `terminatedAt` (`objectSourceUrl` and `line`) and the top of the `stack` with a `sourceUrl` per frame; `dumpDetails(dumpId)` pages the full analysis. Then `getObjectSource(version="active")` around the line, `whereUsed` for the callers, and `runSnippet` on a development tenant to reproduce. The `runtime` toolset is gated on `/sap/bc/adt/feeds`, present on the tested tenant. The `debug-dump` prompt scripts this and stops before applying a fix; [docs/WORKFLOWS.md](WORKFLOWS.md#8-runtime-and-diagnosis) explains how the positions map to sources. Traces are gated on `/sap/bc/adt/runtime/traces`, with ATC as the suggested substitute.

## 8. Data on cloud

`runQuery(sqlQuery)` runs an ABAP SQL `SELECT` through the ADT data preview over tables and CDS entities, released API views included; a view with `@AccessControl.authorizationCheck: #MANDATORY` was readable without a DCL block ([docs/FIELD-NOTES.md](FIELD-NOTES.md), session A). The limits are the preview's: statements are read in 255-character lines, so the server reflows long statements before sending (a single literal longer than that still fails); `rowNumber` caps what SAP returns (default 100) and `startRow`/`maxRows` page the result; tables whose DDIC `dataMaintenance` is restricted are refused with "is not permitted", and `tableContents(ddicEntityName)` reads them under `S_TABU_DIS`/`S_TABU_NAM`; keys come back in internal format, so `getDataElementProperties` and `getDomainProperties` tell you about leading zeros before a `WHERE`. On test and production tenants this is the only way to read data, since `runSnippet` needs `S_DEVELOP`; `readOnly`, `deniedTables` and `allowFreeSql: false` are the policy for them ([docs/CONFIGURATION.md](CONFIGURATION.md#3-policy-in-depth)).

## 9. Transports on cloud

The tested Public Edition landscape had separate development, customizing and test tenants. On it the development tenant logged on to client `080`, the customizing and test tenants to `100`, and development had its own host; those numbers describe that landscape, yours may differ. Development objects belong on the development tenant: give it its own destination and give the others a `readOnly` policy. Transport handling itself goes through the ADT transport organizer as on-prem: `resolveTransport` found the transport already locking an object, `runSnippet` recorded its create and delete on that transport, and `transportDetails` plus `transportUnifiedDiff` reviewed a RAP transport made of `LIMU CINC` and `LIMU MESS` entries (which forced the class-part mapping in 0.3.3, [docs/FIELD-NOTES.md](FIELD-NOTES.md)). `transportRelease` is destructive and the `review-transport` prompt never calls it on its own. `allowedTransports` pins the agent to named requests and refuses `createTransport` and `resolveTransport(createIfMissing=true)`.

## 10. abapGit, RAP generator and business services

- **abapGit.** The `git` toolset is gated on `/sap/bc/adt/abapgit/repos`; the tested tenant listed it, and whether `gitRepos`, `gitPullRepo`, `stageRepo` and `pushRepo` then work depends on the tenant and the user's authorizations (none of them is in the recorded live tests). `gitUser` and `gitPassword` on the destination keep remote credentials out of the conversation; a destination with `allowedPackages` refuses `gitPullRepo`. `exportPackageSources` is the git-free alternative: it writes a package tree in abapGit layout into the absolute `targetDir` you pass, which must sit inside the export root (`MCP_EXPORT_ROOT`, default `~/.abap-adt-mcp/exports`), runs on `readOnly` destinations, and did so on the tested tenant ([docs/WORKFLOWS.md](WORKFLOWS.md#11-abapgit-and-local-exports)).
- **RAP generator.** Gated on `/sap/bc/adt/businessservices/generators`, absent on the tested tenant: every `rapGen*` tool is refused there before calling SAP; `rapGenIsAvailable(genId="uiservice")` is the cheap check on another tenant.
- **Business services.** `services` is gated on `/sap/bc/adt/businessservices/bindings`. `fetchServiceDetails(name)` resolved a binding on the tested tenant; OData V4 bindings the library cannot fully derive degrade to `details: null` with a `note`. `rapGenGenerate`, `rapGenPublishService`, `publishServiceBinding` and `unPublishServiceBinding` are refused wherever `allowedPackages` is set.

## 11. What does not exist on cloud

Recorded on the tested Public Edition tenant, or true by construction: basic auth for named business users (a redirect to IAS instead of `401`; the ADT endpoints themselves are there); objects in `$TMP` (`S_ABPLNGVS`); the ADT text search index (`Source Search is not supported`); the RAP generator collection and with it the `rap` toolset; a stateless clone of an SSO session (`runClass` and `runSnippet` reset the session instead and report `locksInvalidated`); browser SSO inside a container or for the remote callers of a shared HTTP instance.

What the repository does not claim: that the debugger, traces or abapGit are absent on every tenant (they were listed in discovery on the tested one), which communication scenario exposes ADT for OAuth on yours, or anything about Private Edition beyond the `pce2023`/`pce2022` release lists.

## 12. Session checklist

1. `listSystems`: confirm the destination name, that `url` is the development tenant's own host and `client` its logon client, and read the `policy`. Test and production tenants should show `readOnly`.
2. Optionally `login` on SSO destinations, to get the browser window out of the way before the real work (tick "stay signed in"); the first tool call opens it by itself otherwise. `basic` and `oauth` destinations authenticate on the first call.
3. `systemProfile`: expect `platform: "cloud"` and read `unavailableToolsets`. Decide now whether root cause will go through `dumps`.
4. Pick the package: a local customer package for experiments (`resolveTransport` answers `needsTransport: false`, nothing to create first), a transportable one for real work (already exists: just `resolveTransport` on it; does not exist yet: create it first with `createObject(objtype="DEVC/K", ...)`, section 3.2); never `$TMP`.
5. Before writing cloud code, `apiReleaseState(names=...)` or `apiReleaseState(sourceUrl=...)` on the draft.
6. Create the object with `createObject(..., responsible="DEVELOPER", transport="DEVK900123")`; `responsible` belongs on this call only. Write its source with `setObjectSource(objectSourceUrl, source, activate=true, transport="DEVK900123")`: a brand-new object has no existing text for `editObjectSource`'s anchors to match, so that tool (and `setMethodSource`, which edits one method of an existing class) comes into play only for a later change, not this first write; neither write call takes `responsible`. Then `unitTestRun(url)`, and `createAtcRun(mainUrl=<object URL>, variant="ABAP_CLOUD_DEVELOPMENT_DEFAULT")` followed by `atcWorklists` to confirm what step 5 could only check from the outside.
7. To see the output of what you just activated, `runClass` (only for a class that implements `IF_OO_ADT_CLASSRUN`, section 4) or `runSnippet` (fresh load); re-lock if `locksInvalidated` is not empty.
8. Search code with `sourceTextSearch(packages=...)` and accept the `grepPackage` fallback; read data with `runQuery` or `tableContents`.
9. `logout` at the end releases the server's own locks; delete `~/.abap-adt-mcp/sso/<host>` only to end the identity-provider session as well.

## 13. Cloud versus on-prem, per capability

| Capability | S/4HANA Cloud Public Edition (tested) | Private Edition / on-prem |
|---|---|---|
| Named-user authentication | `sso` (browser, IAS, persistent profile, `sap-client` pinned) | `basic`, plus `tls` client certificates |
| Unattended authentication | `oauth` (Communication Arrangement) or `basic` with a Communication User | `basic` |
| Expired session | IAS login page with HTTP `200`, detected as `sessionExpired`; silent re-login, one retry | `401`; re-login, one retry |
| Local objects | `$TMP` refused (`S_ABPLNGVS`); local customer package instead | `$TMP`, no transport |
| `runSnippet` | `packageName`, `transport`, `responsible` required | Defaults to `$TMP` |
| `createObject` | `responsible` required; `DEVC/K` needs `swcomp` (the server always sends `recordChanges`), optionally `abapLanguageVersion="5"` | `responsible` optional; `swcomp` for packages |
| Language version and APIs | ABAP for Cloud Development; `apiReleaseState(edition="cloud")`; ATC `ABAP_CLOUD_DEVELOPMENT_DEFAULT` | Standard ABAP; `apiReleaseState(edition="pce2023")` for the 3-tier model |
| Text search | Index answers "not supported"; `grepPackage` fallback | `sourceTextSearch` where the index exists; `grepPackage` everywhere |
| Fresh program load for `runClass` | `stateless` on SSO (locks released, `locksInvalidated`) | `clone` on `basic` and `oauth`, locks untouched |
| Debugger, traces | Gated per tenant and user; `dumps` and `dumpDetails` as the root-cause path | Full toolsets when published |
| RAP generator | Absent on the tested tenant | Present where the collection exists |
| abapGit | Gated on the tenant; `exportPackageSources` as the local alternative | Same tools, same gate |
| Transports | ADT transport organizer; separate development and customizing tenants | Same organizer, one system |
| Foreign locks | Not releasable by this server; wait for the other session | That session or `SM12` |
| Where the server runs | Workstation for `sso`; container or shared HTTP only with `oauth` or `basic` | Anywhere |
