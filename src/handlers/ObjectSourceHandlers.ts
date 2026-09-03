import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler';
import type { ToolDefinition } from '../types/tools';
import { session_types } from "abap-adt-api";
import { sourceCache } from '../lib/sourceCache';
import { withLock, objectNameFromUrl } from '../lib/lockLedger';
import { objectUrlOf } from '../lib/policy';
import { listMethods, findMethods, findMethod, replaceMethod, classUrlOf, includeSourceUrl } from '../lib/methodSource';
import { SAFE_OUTPUT_CHARS, shrinkToFit } from '../lib/responseSizing';

function buildPagedSourcePayload(lines: string[], totalLines: number, startLine: number, initialMaxLines: number, requestedPaging: boolean): string {
  const startIndex = startLine - 1;
  return shrinkToFit(initialMaxLines, (count, capped) => {
    const endIndex = Math.min(startIndex + count, totalLines);
    const payload: any = {
      status: 'success',
      source: lines.slice(startIndex, endIndex).join('\n'),
      totalLines,
      startLine,
      returnedLines: Math.max(0, endIndex - startIndex),
      hasMore: endIndex < totalLines
    };
    if (!requestedPaging) {
      payload.autoPaged = true;
    }
    if (capped) {
      payload.capped = true;
      payload.note = 'Requested/default range exceeded the safe response size and was shrunk to fit. Pass a smaller maxLines (or a later startLine) to continue.';
    }
    return payload;
  });
}

/** Method names, qualified with their class only when the include holds several implementations. */
function methodLabels(blocks: Array<{ name: string; className?: string }>): string[] {
  const classes = new Set(blocks.map(b => b.className).filter(Boolean));
  return blocks.map(b => (classes.size > 1 && b.className ? `${b.className}=>${b.name}` : b.name));
}

export class ObjectSourceHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'getObjectSource',
        description: 'Retrieves source code for ABAP objects. For large objects, use startLine/maxLines to page through the source instead of retrieving it all at once.',
        inputSchema: {
          type: 'object',
          properties: {
            objectSourceUrl: { type: 'string', description: 'Source URL of the object, usually the object URL plus /source/main' },
            version: {
              type: 'string',
              enum: ['active', 'inactive', 'workingArea'],
              description: 'Omit to read what ADT serves by default: the inactive (not yet activated) version when one exists, otherwise the active one. Pass active to force the activated version, or inactive to require the unactivated one (fails when there is none). Read inactive to verify what you wrote before activating.',
              optional: true
            },
            startLine: {
              type: 'number',
              description: '1-based line number to start from (default 1). Use with maxLines to page through large sources.',
              optional: true
            },
            maxLines: {
              type: 'number',
              description: 'Maximum number of lines to return from startLine. Omit to return the rest of the source.',
              optional: true
            }
          },
          required: ['objectSourceUrl']
        }
      },
      {
        name: 'setObjectSource',
        description: 'Write the full source code of an ABAP object. Locks, writes and unlocks in one call when no lockHandle is given (pass activate=true to also activate); pass a lockHandle from lock only when you hold the lock across several calls. Run syntaxCheckCode before writing to catch errors early. For a targeted change to a large object, prefer editObjectSource instead of resending the full source.',
        inputSchema: {
          type: 'object',
          properties: {
            objectSourceUrl: { type: 'string', description: 'Source URL of the object, usually the object URL plus /source/main' },
            source: { type: 'string', description: 'Full new source code (replaces the current source)' },
            lockHandle: { type: 'string', description: 'Optional: lock handle from lock when you hold the lock yourself. Omit to let the server lock/unlock around this write.', optional: true },
            transport: { type: 'string', description: 'Transport number for objects in transportable packages (see resolveTransport)', optional: true },
            activate: { type: 'boolean', description: 'Activate the object after writing (default false). The activation result is returned; check it for errors.', optional: true }
          },
          required: ['objectSourceUrl', 'source']
        }
      },
      {
        name: 'editObjectSource',
        description: 'Applies a targeted edit to an ABAP object without sending the full source. Always re-fetches the current source from SAP first, so the edit lands on the latest remote version. Two modes: (a) replacements: a JSON array of {oldText, newText} where each oldText must occur exactly once in the current source (0 or several matches fail with the candidate lines, so re-read and refine); this is robust to line-number drift after earlier edits. (b) line range: replace lines [startLine, endLine] (inclusive, 1-based) with newText; endLine = startLine - 1 inserts; empty newText deletes; pass expectedText (exact current content of the range, joined with \\n) to fail fast on stale reads. Locks and unlocks automatically (or reuses a lockHandle you pass); the write back is a full setObjectSource of the edited source, optionally activated with activate=true.',
        inputSchema: {
          type: 'object',
          properties: {
            objectSourceUrl: { type: 'string', description: 'Source URL of the object, usually the object URL plus /source/main' },
            replacements: {
              type: 'string',
              description: 'Mode (a): JSON array of {"oldText": "...", "newText": "..."}. Each oldText must match exactly one location in the current source (include enough surrounding lines to make it unique). Applied in order, atomically: if any entry fails, nothing is written.',
              optional: true
            },
            startLine: {
              type: 'number',
              description: 'Mode (b): 1-based first line to replace (inclusive).',
              optional: true
            },
            endLine: {
              type: 'number',
              description: 'Mode (b): 1-based last line to replace (inclusive). Use startLine - 1 to insert without replacing any existing line.',
              optional: true
            },
            newText: {
              type: 'string',
              description: 'Mode (b): replacement text for the given line range (use \\n for multiple lines). Use an empty string to delete the range.',
              optional: true
            },
            expectedText: {
              type: 'string',
              description: 'Optional safety check: exact current text of lines [startLine, endLine] joined with \\n. If it does not match what SAP currently has, the edit is rejected instead of applied.',
              optional: true
            },
            lockHandle: { type: 'string', description: 'Optional: lock handle from lock when you hold the lock yourself. Omit to let the server lock/unlock around this edit.', optional: true },
            transport: { type: 'string', description: 'Transport number for objects in transportable packages (see resolveTransport)', optional: true },
            activate: { type: 'boolean', description: 'Activate the object after the edit (default false). The activation result is returned; check it for errors.', optional: true }
          },
          required: ['objectSourceUrl']
        }
      },
      {
        name: 'getMethodSource',
        description: 'Source of one method of a class (METHOD … ENDMETHOD block with its line range) instead of the whole class. Pass the class name or URL and the method name (interface methods as if_x~m). include selects main (default: definition and implementations), implementations (local classes), testclasses, definitions or macros. When the method is not found, the methods present in that include are listed.',
        inputSchema: {
          type: 'object',
          properties: {
            classUrl: { type: 'string', description: 'Class name (ZCL_DEMO) or class URL (/sap/bc/adt/oo/classes/zcl_demo)' },
            methodName: { type: 'string', description: 'Method name, e.g. GET_DATA or IF_OO_ADT_CLASSRUN~MAIN' },
            className: { type: 'string', description: 'Enclosing class when the include holds several implementations with the same method name (local classes in implementations, test classes in testclasses). Required when the method name is ambiguous.', optional: true },
            include: { type: 'string', enum: ['main', 'implementations', 'testclasses', 'definitions', 'macros'], description: 'Class include to read (default main)', optional: true }
          },
          required: ['classUrl', 'methodName']
        }
      },
      {
        name: 'setMethodSource',
        description: 'Replace one method of a class without touching the rest: re-reads the include from SAP, swaps the METHOD … ENDMETHOD block (pass the full block, or only the body to keep the existing header/footer), writes it back under an automatic lock and optionally activates. Use for focused fixes in large classes.',
        inputSchema: {
          type: 'object',
          properties: {
            classUrl: { type: 'string', description: 'Class name or class URL' },
            methodName: { type: 'string', description: 'Method to replace' },
            className: { type: 'string', description: 'Enclosing class when the include holds several implementations with the same method name (local classes in implementations, test classes in testclasses). Required when the method name is ambiguous.', optional: true },
            source: { type: 'string', description: 'New METHOD … ENDMETHOD block, or just the body statements' },
            include: { type: 'string', enum: ['main', 'implementations', 'testclasses', 'definitions', 'macros'], description: 'Class include holding the method (default main)', optional: true },
            lockHandle: { type: 'string', description: 'Optional lock handle when you hold the lock yourself', optional: true },
            transport: { type: 'string', description: 'Transport for transportable packages (see resolveTransport)', optional: true },
            activate: { type: 'boolean', description: 'Activate the class after the write (default false)', optional: true }
          },
          required: ['classUrl', 'methodName', 'source']
        }
      }
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'getObjectSource':
        return this.handleGetObjectSource(args);
      case 'setObjectSource':
        return this.handleSetObjectSource(args);
      case 'editObjectSource':
        return this.handleEditObjectSource(args);
      case 'getMethodSource':
        return this.handleGetMethodSource(args);
      case 'setMethodSource':
        return this.handleSetMethodSource(args);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown object source tool: ${toolName}`);
    }
  }

  async handleGetObjectSource(args: any): Promise<any> {
    
    const startTime = performance.now();
    try {
      const fullSource = await this.adtclient.getObjectSource(args.objectSourceUrl, args.version ? { version: args.version } : undefined);
      // Remember the source so a later syntaxCheckCode on the same URL can reuse
      // it without the caller re-sending it (issue #2).
      sourceCache.set(this.adtclient, args.objectSourceUrl, fullSource);
      this.trackRequest(startTime, true);

      const lines = fullSource.split('\n');
      const totalLines = lines.length;

      // Optional pagination for large sources (issue #4). When the caller
      // didn't ask for paging but the source is large enough to risk
      // exceeding the host's tool-output limit, page automatically instead
      // of returning everything and having the host discard it.
      const requestedPaging = args.startLine !== undefined || args.maxLines !== undefined;

      if (!requestedPaging && fullSource.length <= SAFE_OUTPUT_CHARS) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                source: fullSource,
                totalLines,
                startLine: 1,
                returnedLines: totalLines,
                hasMore: false
              })
            }
          ]
        };
      }

      const startLine = Math.max(1, Number(args.startLine) || 1);
      const startIndex = startLine - 1;
      const initialMaxLines = args.maxLines !== undefined
        ? Math.max(0, Number(args.maxLines))
        : totalLines - startIndex;

      const text = buildPagedSourcePayload(lines, totalLines, startLine, initialMaxLines, requestedPaging);

      return {
        content: [
          {
            type: 'text',
            text
          }
        ]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get object source: ${this.formatAdtError(error)}`
      );
    }
  }

  async handleSetObjectSource(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      // dropSession/logout reset the client to stateless; writing source requires a stateful session
      this.adtclient.stateful = session_types.stateful;
      const written = await withLock(this.adtclient, args.objectSourceUrl, args.lockHandle, async (handle) => {
        await this.adtclient.setObjectSource(args.objectSourceUrl, args.source, handle, args.transport);
        return true;
      });
      // Cache the just-written source so a follow-up syntaxCheckCode can reuse it
      // without the caller re-sending it (issue #2).
      sourceCache.set(this.adtclient, args.objectSourceUrl, args.source);
      const activation = await this.maybeActivate(args);
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              updated: true,
              lockMode: written.lockMode,
              ...(written.unlockError ? { unlockError: written.unlockError, hint: 'The write succeeded but the object stayed locked; call forceUnlock.' } : {}),
              ...(activation ? { activation } : {})
            })
          }
        ]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to set object source: ${this.formatAdtError(error)}`
      );
    }
  }

  async handleEditObjectSource(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      // Always re-fetch from SAP (never from sourceCache) so the edit is
      // guaranteed to be based on the current remote version, not a stale
      // local copy from earlier in the conversation.
      const fullSource = await this.adtclient.getObjectSource(args.objectSourceUrl);

      if (args.replacements !== undefined) {
        return await this.applyReplacements(args, fullSource, startTime);
      }
      if (args.startLine === undefined || args.endLine === undefined || args.newText === undefined) {
        throw new McpError(ErrorCode.InvalidParams, 'editObjectSource needs either "replacements" (array of {oldText, newText}) or the line-range trio startLine/endLine/newText');
      }

      const lines = fullSource.split('\n');
      const totalLines = lines.length;

      const startLine = Number(args.startLine);
      const endLine = Number(args.endLine);

      if (!Number.isInteger(startLine) || startLine < 1) {
        throw new McpError(ErrorCode.InvalidParams, `startLine must be a positive integer, got ${args.startLine}`);
      }
      if (!Number.isInteger(endLine) || endLine < startLine - 1) {
        throw new McpError(ErrorCode.InvalidParams, `endLine must be an integer >= startLine - 1, got ${args.endLine}`);
      }
      if (startLine > totalLines + 1) {
        throw new McpError(ErrorCode.InvalidParams, `startLine ${startLine} is beyond the end of the source (${totalLines} lines)`);
      }

      const startIndex = startLine - 1;
      const endIndex = Math.min(endLine, totalLines);

      if (args.expectedText !== undefined) {
        const actualText = lines.slice(startIndex, endIndex).join('\n');
        if (actualText !== args.expectedText) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `expectedText did not match the current content of lines ${startLine}-${endLine} on SAP. The object may have changed since you last read it. Actual content:\n${actualText}`
          );
        }
      }

      const newLines = args.newText.length === 0 ? [] : String(args.newText).split('\n');
      lines.splice(startIndex, endIndex - startIndex, ...newLines);
      const newSource = lines.join('\n');

      this.adtclient.stateful = session_types.stateful;
      const written = await withLock(this.adtclient, args.objectSourceUrl, args.lockHandle, async (handle) => {
        await this.adtclient.setObjectSource(args.objectSourceUrl, newSource, handle, args.transport);
        return true;
      });
      sourceCache.set(this.adtclient, args.objectSourceUrl, newSource);
      const activation = await this.maybeActivate(args);
      this.trackRequest(startTime, true);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              updated: true,
              lockMode: written.lockMode,
              ...(written.unlockError ? { unlockError: written.unlockError } : {}),
              totalLinesBefore: totalLines,
              totalLinesAfter: lines.length,
              linesReplaced: endIndex - startIndex,
              linesInserted: newLines.length,
              ...(activation ? { activation } : {})
            })
          }
        ]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to edit object source: ${this.formatAdtError(error)}`
      );
    }
  }

  /** activate=true: activate the object after a write and return the result (never throws on activation errors). */
  private async maybeActivate(args: any): Promise<any> {
    if (args.activate !== true) return undefined;
    const objectUrl = objectUrlOf(args.objectSourceUrl);
    try {
      const result: any = await this.adtclient.activate(objectNameFromUrl(objectUrl), objectUrl);
      return { success: result?.success !== false, ...result };
    } catch (error: any) {
      return { success: false, error: this.formatAdtError(error) };
    }
  }

  /**
   * Text-anchored edit: every oldText must occur exactly once in the current
   * source. Line endings are normalized to \n on both sides so an anchor copied
   * from a getObjectSource result matches a CRLF source too.
   */
  private async applyReplacements(args: any, fullSource: string, startTime: number): Promise<any> {
    let replacements: Array<{ oldText: string; newText: string }>;
    if (Array.isArray(args.replacements)) {
      replacements = args.replacements;
    } else {
      try {
        replacements = JSON.parse(String(args.replacements));
      } catch {
        throw new McpError(ErrorCode.InvalidParams, 'replacements must be a JSON array of {oldText, newText}');
      }
    }
    if (!Array.isArray(replacements) || replacements.length === 0 ||
        replacements.some(r => !r || typeof r.oldText !== 'string' || r.oldText.length === 0 || typeof r.newText !== 'string')) {
      throw new McpError(ErrorCode.InvalidParams, 'replacements must be a non-empty array of {oldText: non-empty string, newText: string}');
    }

    const normalize = (t: string) => t.replace(/\r\n/g, '\n');
    let working = normalize(fullSource);
    const applied: Array<{ index: number; line: number; linesRemoved: number; linesAdded: number }> = [];

    replacements.forEach((r, index) => {
      const oldText = normalize(r.oldText);
      const newText = normalize(r.newText);
      const positions: number[] = [];
      let from = 0;
      while (true) {
        const at = working.indexOf(oldText, from);
        if (at < 0) break;
        positions.push(at);
        from = at + Math.max(1, oldText.length);
      }
      const lineOf = (pos: number) => working.slice(0, pos).split('\n').length;
      if (positions.length === 0) {
        throw new McpError(ErrorCode.InvalidRequest,
          `replacements[${index}]: oldText was not found in the current source on SAP (0 matches). Re-read the object with getObjectSource and copy the exact current text, including indentation.`);
      }
      if (positions.length > 1) {
        throw new McpError(ErrorCode.InvalidRequest,
          `replacements[${index}]: oldText matches ${positions.length} locations (lines ${positions.map(lineOf).join(', ')}). Include more surrounding lines so it matches exactly once.`);
      }
      const pos = positions[0];
      applied.push({
        index, line: lineOf(pos),
        linesRemoved: oldText.split('\n').length,
        linesAdded: newText.length === 0 ? 0 : newText.split('\n').length
      });
      working = working.slice(0, pos) + newText + working.slice(pos + oldText.length);
    });

    this.adtclient.stateful = session_types.stateful;
    const written = await withLock(this.adtclient, args.objectSourceUrl, args.lockHandle, async (handle) => {
      await this.adtclient.setObjectSource(args.objectSourceUrl, working, handle, args.transport);
      return true;
    });
    sourceCache.set(this.adtclient, args.objectSourceUrl, working);
    const activation = await this.maybeActivate(args);
    this.trackRequest(startTime, true);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          updated: true,
          lockMode: written.lockMode,
          ...(written.unlockError ? { unlockError: written.unlockError } : {}),
          ...(activation ? { activation } : {}),
          mode: 'replacements',
          replacementsApplied: applied.length,
          applied,
          totalLinesBefore: normalize(fullSource).split('\n').length,
          totalLinesAfter: working.split('\n').length
        })
      }]
    };
  }

  async handleGetMethodSource(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      const classUrl = classUrlOf(args.classUrl);
      const sourceUrl = includeSourceUrl(classUrl, args.include);
      const source = await this.adtclient.getObjectSource(sourceUrl);
      sourceCache.set(this.adtclient, sourceUrl, source);
      const candidates = findMethods(source, String(args.methodName), args.className);
      this.trackRequest(startTime, true);
      if (candidates.length === 0) {
        const names = methodLabels(listMethods(source));
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', classUrl, include: args.include || 'main', methodName: String(args.methodName).toUpperCase(), className: args.className, found: false, methodsInInclude: names, hint: names.length ? 'Pick one of methodsInInclude (class=>method), or try include=implementations/testclasses for local and test classes.' : 'No METHOD blocks in this include; try another include.' }) }], isError: true };
      }
      if (candidates.length > 1) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', classUrl, include: args.include || 'main', methodName: String(args.methodName).toUpperCase(), ambiguous: true, candidates: candidates.map(b => ({ className: b.className, startLine: b.startLine, endLine: b.endLine })), hint: 'Several implementations carry this method name; pass className to pick one.' }) }], isError: true };
      }
      const block = candidates[0];
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', classUrl, sourceUrl, include: args.include || 'main', method: block.name, className: block.className, startLine: block.startLine, endLine: block.endLine, lines: block.endLine - block.startLine + 1, amdp: block.amdp, source: block.text }) }] };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw new McpError(ErrorCode.InternalError, `Failed to get method source: ${this.formatAdtError(error)}`);
    }
  }

  async handleSetMethodSource(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      const classUrl = classUrlOf(args.classUrl);
      const sourceUrl = includeSourceUrl(classUrl, args.include);
      const current = await this.adtclient.getObjectSource(sourceUrl);
      const candidates = findMethods(current, String(args.methodName), args.className);
      if (candidates.length === 0) {
        const names = methodLabels(listMethods(current));
        throw new McpError(ErrorCode.InvalidRequest, `Method ${String(args.methodName).toUpperCase()}${args.className ? ` of ${String(args.className).toUpperCase()}` : ''} not found in ${args.include || 'main'} of ${classUrl}. Methods present: ${names.join(', ') || 'none'}`);
      }
      if (candidates.length > 1) {
        throw new McpError(ErrorCode.InvalidRequest, `Method ${String(args.methodName).toUpperCase()} is implemented ${candidates.length} times in ${args.include || 'main'} of ${classUrl} (${candidates.map(b => `${b.className || '?'} lines ${b.startLine}-${b.endLine}`).join('; ')}). Pass className to pick one; nothing was written.`);
      }
      const block = candidates[0];
      const { source: newSource, wrapped } = replaceMethod(current, block, String(args.source));
      this.adtclient.stateful = session_types.stateful;
      const written = await withLock(this.adtclient, sourceUrl, args.lockHandle, async (handle) => {
        await this.adtclient.setObjectSource(sourceUrl, newSource, handle, args.transport);
        return true;
      });
      sourceCache.set(this.adtclient, sourceUrl, newSource);
      const activation = await this.maybeActivate({ objectSourceUrl: sourceUrl, activate: args.activate });
      const after = findMethod(newSource, String(args.methodName), block.className);
      this.trackRequest(startTime, true);
      return { content: [{ type: 'text', text: JSON.stringify({
        status: 'success', updated: true, classUrl, sourceUrl, method: block.name,
        replaced: { startLine: block.startLine, endLine: block.endLine },
        now: after ? { startLine: after.startLine, endLine: after.endLine } : undefined,
        bodyWrapped: wrapped, lockMode: written.lockMode,
        ...(written.unlockError ? { unlockError: written.unlockError } : {}),
        ...(activation ? { activation } : {})
      }) }] };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `Failed to set method source: ${this.formatAdtError(error)}`);
    }
  }
}
