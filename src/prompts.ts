/**
 * MCP prompts: the canonical ABAP workflows as reusable, parameterised
 * instructions, so hosts that support prompts can offer them as slash
 * commands. Every step names the real tools of this server.
 */
export interface PromptDef {
  name: string;
  title: string;
  description: string;
  arguments: Array<{ name: string; description: string; required?: boolean }>;
  render: (args: Record<string, string>) => string;
}

const dest = (a: Record<string, string>) => a.destination ? `destination="${a.destination}"` : 'the destination from listSystems';

export const PROMPTS: PromptDef[] = [
  {
    name: 'create-object',
    title: 'Create an ABAP object',
    description: 'Validate, create, write, activate and unit-test a new ABAP object in the right package and transport.',
    arguments: [
      { name: 'destination', description: 'Target system name from listSystems', required: false },
      { name: 'objectType', description: 'ADT object type, e.g. CLAS/OC, INTF/OI, PROG/P, DDLS/DF', required: true },
      { name: 'name', description: 'Object name, e.g. ZCL_ORDER_SERVICE', required: true },
      { name: 'package', description: 'Target package (e.g. $TMP or ZFIN)', required: true },
      { name: 'purpose', description: 'What the object must do', required: false },
    ],
    render: (a) => `Create the ABAP object ${a.name} (${a.objectType}) in package ${a.package} on ${dest(a)}.${a.purpose ? `\nPurpose: ${a.purpose}` : ''}

Follow this sequence with the abap-adt-mcp tools:
1. systemProfile once if this system is unfamiliar (cloud vs on-prem decides the ABAP language version and released APIs).
2. loadTypes to confirm the objtype, then validateNewObject(objtype="${a.objectType}", name="${a.name}", packageName="${a.package}").
3. resolveTransport(objSourceUrl="/sap/bc/adt/packages/${a.package.toLowerCase()}", devClass="${a.package}") unless the package is local; keep the returned transport.
4. Before writing, check every SAP object you plan to use with apiReleaseState (names or the draft source) on cloud systems.
5. createObject(objtype, name, parentName="${a.package}", description, parentPath="/sap/bc/adt/packages/${a.package.toLowerCase()}", responsible on cloud, transport).
6. syntaxCheckCode on the intended source, then setObjectSource(objectSourceUrl="<object url>/source/main", source, activate=true, transport). Read the activation field; fix and rewrite on errors.
7. createTestInclude for classes, write the tests with setObjectSource on the testclasses include, then unitTestRun(url="<object url>").
8. createAtcRun on the object (pass the project's check variant, e.g. ABAP_CLOUD_DEVELOPMENT_DEFAULT on cloud, or omit for the system default) and clear priority 1 and 2 findings (atcQuickfixProposals / atcApplyQuickfix where deterministic).
Report the object URL, transport, activation and test results.`,
  },
  {
    name: 'safe-edit',
    title: 'Edit an existing object safely',
    description: 'Read, change with text-anchored edits, activate and test an existing object without losing anyone else\'s work.',
    arguments: [
      { name: 'destination', description: 'Target system name', required: false },
      { name: 'object', description: 'Object name or URL, e.g. ZCL_ORDER_SERVICE', required: true },
      { name: 'change', description: 'What to change', required: true },
    ],
    render: (a) => `Change ${a.object} on ${dest(a)}: ${a.change}

Sequence:
1. searchObject / findObjectPath to get the object URL; getObjectSource(objectSourceUrl="<url>/source/main") or getMethodSource(classUrl, methodName) for classes.
2. whereUsed(name) when the change alters a signature or behaviour other objects depend on.
3. resolveTransport(objSourceUrl="<url>") for transportable packages.
4. Apply the change with editObjectSource(objectSourceUrl, replacements=[{oldText, newText}], activate=true, transport) or setMethodSource(classUrl, methodName, source, activate=true, transport). Anchors must be unique; re-read if the tool reports 0 or several matches. Do not call lock/unLock yourself.
5. If activation fails, read the messages, fix, and write again. Then unitTestRun(url) and, for cloud, apiReleaseState(sourceUrl) on the changed source.
6. objectDiff(objectUrl) to show what changed against the previous revision in your final report.
Stop and ask before deleteObject, transportRelease or forceUnlock.`,
  },
  {
    name: 'review-transport',
    title: 'Review a transport request',
    description: 'Summarise what a transport changes, object by object, with unified diffs and risk notes.',
    arguments: [
      { name: 'destination', description: 'Target system name', required: false },
      { name: 'transport', description: 'Transport request number, e.g. DEVK900123', required: true },
    ],
    render: (a) => `Review transport ${a.transport} on ${dest(a)}.

1. transportDetails(transportNumber="${a.transport}") for the object list, owner, tasks and status.
2. transportUnifiedDiff(transportNumber="${a.transport}") for the per-object diffs; use objectDiff(objectUrl) for objects with several revisions.
3. For each changed object: what changed, risk (data model, authorization, performance, released-API use via apiReleaseState on cloud), and whether unit tests exist (unitTestRun) and ATC is clean (createAtcRun with the transport as mainUrl and the project's check variant, then atcWorklists).
4. Produce a review with: summary, per-object findings, blockers, and a go/no-go recommendation. Never release the transport yourself (transportRelease needs explicit approval).`,
  },
  {
    name: 'fix-atc',
    title: 'Fix ATC findings',
    description: 'Run ATC on an object or package, apply deterministic quickfixes, fix the rest by hand, re-run until clean.',
    arguments: [
      { name: 'destination', description: 'Target system name', required: false },
      { name: 'target', description: 'Object URL, package name or transport to check', required: true },
      { name: 'variant', description: 'Check variant (cloud default ABAP_CLOUD_DEVELOPMENT_DEFAULT)', required: false },
    ],
    render: (a) => `Clear the ATC findings of ${a.target} on ${dest(a)}${a.variant ? ` using check variant ${a.variant}` : ''}.

1. createAtcRun(mainUrl="${a.target}"${a.variant ? `, variant="${a.variant}"` : ''}) then atcWorklists for the findings grouped by priority.
2. For each finding: atcDocumentation(docUri) when the check is unfamiliar; atcQuickfixProposals(objectSourceUrl, line, column) and atcApplyQuickfix when a deterministic fix exists (the tool locks/unlocks itself); otherwise editObjectSource with replacements.
3. Activate (activate=true on the write, or activateByName), unitTestRun, and re-run createAtcRun until priority 1 and 2 are clean.
4. Report remaining findings with the reason they were left (exemption candidates via atcRequestExemption only with approval).`,
  },
  {
    name: 'clean-core-check',
    title: 'ABAP Cloud / Clean Core readiness check',
    description: 'Assess whether an object or package can run in ABAP Cloud: released APIs, deprecated objects, successors.',
    arguments: [
      { name: 'destination', description: 'Target system name', required: false },
      { name: 'target', description: 'Object name/URL or package name', required: true },
    ],
    render: (a) => `Assess ABAP Cloud readiness of ${a.target} on ${dest(a)}.

1. If ${a.target} is a package: packageTree(packageName="${a.target}", objectTypes="CLAS/OC,PROG/P,INTF/OI,DDLS/DF") to enumerate sources. Otherwise resolve the object with searchObject.
2. For each source: apiReleaseState(sourceUrl="<url>/source/main", edition="cloud") and collect blockers (deprecated with successors, classicAPI, noAPI, notInRepository).
3. createAtcRun with variant ABAP_CLOUD_DEVELOPMENT_DEFAULT (or ABAP_CLOUD_READINESS if present) and atcWorklists for the syntax-level cloud checks.
4. Report per object: cloudReady yes/no, blocking SAP objects with their successors, ATC findings, and the estimated effort to migrate. Do not change code in this prompt.`,
  },
  {
    name: 'debug-dump',
    title: 'Analyse a short dump',
    description: 'Find the root cause of a runtime error from the dump feed and propose a fix at the exact source line.',
    arguments: [
      { name: 'destination', description: 'Target system name', required: false },
      { name: 'filter', description: 'User, program, exception or time window to narrow the dumps', required: false },
    ],
    render: (a) => `Analyse the latest short dump${a.filter ? ` matching "${a.filter}"` : ''} on ${dest(a)}.

1. dumps(${a.filter ? `contains or user or from derived from "${a.filter}", ` : ''}maxItems=5) for the compact summaries; pick the relevant dumpId.
2. dumpDetails(dumpId) for the full analysis, variables and call stack.
3. getObjectSource on terminatedAt.objectSourceUrl around terminatedAt.line (use startLine/maxLines) and walk up the stack with the sourceUrl of each frame as needed; whereUsed / usageReferences for the callers.
4. Explain the root cause, then propose the fix as replacements for editObjectSource (do not apply without approval). Mention whether the fix needs a transport (resolveTransport).`,
  },
];

export function listPrompts() {
  return PROMPTS.map(p => ({ name: p.name, title: p.title, description: p.description, arguments: p.arguments }));
}

export function getPrompt(name: string, args: Record<string, string> = {}) {
  const p = PROMPTS.find(x => x.name === name);
  if (!p) return undefined;
  const missing = p.arguments.filter(a => a.required && !args[a.name]).map(a => a.name);
  if (missing.length) throw new Error(`Prompt ${name} requires arguments: ${missing.join(', ')}`);
  return { description: p.description, messages: [{ role: 'user' as const, content: { type: 'text' as const, text: p.render(args) } }] };
}
