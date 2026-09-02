import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler';
import type { ToolDefinition } from '../types/tools';
import { session_types } from "abap-adt-api";
import { sourceCache } from '../lib/sourceCache';
import { withLock, objectNameFromUrl } from '../lib/lockLedger';
import { objectUrlOf } from '../lib/policy';
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
              description: 'Which version to read: active (default) or inactive (the not-yet-activated version after setObjectSource/editObjectSource). Read inactive to verify what you wrote before activating.',
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
        description: 'Applies a targeted edit to an ABAP object without sending the full source. Always re-fetches the current source from SAP first, so the edit lands on the latest remote version. Two modes: (a) replacements: a JSON array of {oldText, newText} where each oldText must occur exactly once in the current source (0 or several matches fail with the candidate lines, so re-read and refine); this is robust to line-number drift after earlier edits. (b) line range: replace lines [startLine, endLine] (inclusive, 1-based) with newText; endLine = startLine - 1 inserts; empty newText deletes; pass expectedText (exact current content of the range, joined with \\n) to fail fast on stale reads. Requires the lockHandle from lock; write back is a full setObjectSource.',
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
      sourceCache.set(args.objectSourceUrl, fullSource);
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
      sourceCache.set(args.objectSourceUrl, args.source);
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
      sourceCache.set(args.objectSourceUrl, newSource);
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
    sourceCache.set(args.objectSourceUrl, working);
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
}
