import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { ADTClient, session_types } from "abap-adt-api";
import { recordLock, forgetLock, listLocks, releaseAll, clearLedger } from '../lib/lockLedger.js';

export class ObjectLockHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [{
      name: 'lock',
      description: 'Lock an ABAP object for editing and keep the lock across calls. Returns the lockHandle; the server also records it, so setObjectSource/editObjectSource/deleteObject/createTestInclude/atcApplyQuickfix on the same object may omit lockHandle while it is held. Not needed for a single write: those tools lock and unlock by themselves when no lock is held. Always unLock when done.',
      inputSchema: {
        type: 'object',
        properties: {
          objectUrl: { 
            type: 'string',
            description: 'URL of the object to lock'
          },
          accessMode: { 
            type: 'string',
            description: 'Access mode for the lock',
            optional: true 
          }
        },
        required: ['objectUrl']
      }
    }, {
      name: 'unLock',
      description: 'Unlock an ABAP object previously locked with lock (requires its lockHandle).',
      inputSchema: {
        type: 'object',
        properties: {
          objectUrl: { 
            type: 'string',
            description: 'URL of the object to unlock'
          },
          lockHandle: { 
            type: 'string',
            description: 'Lock handle from lock. May be omitted when the server recorded the lock for this object.',
            optional: true
          }
        },
        required: ['objectUrl']
      }
    }, {
      name: 'listLocks',
      description: 'List the ADT locks this server currently holds on the destination (object, lockHandle, when, whether acquired automatically). Use it when a write fails with a lock/lockHandle error or before forceUnlock.',
      inputSchema: { type: 'object', properties: {} }
    }, {
      name: 'forceUnlock',
      description: 'Release every lock this server holds on the destination (or one objectUrl). With dropSession=true also drops the SAP session afterwards, which frees locks whose handles are already invalid. Use after failed writes left objects locked.',
      inputSchema: {
        type: 'object',
        properties: {
          objectUrl: { type: 'string', description: 'Release only this object (default: all recorded locks)', optional: true },
          dropSession: { type: 'boolean', description: 'Also drop the SAP session after releasing (default false)', optional: true }
        }
      }
    }];
  }
  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'lock':
        return this.handleLock(args);
      case 'unLock':
        return this.handleUnlock(args);
      case 'listLocks':
        return this.handleListLocks();
      case 'forceUnlock':
        return this.handleForceUnlock(args);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown object lock tool: ${toolName}`);
    }
  }

  async handleLock(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      // dropSession/logout reset the client to stateless; locks require a stateful session
      this.adtclient.stateful = session_types.stateful;
      const lockResult = await this.adtclient.lock(args.objectUrl, args.accessMode);
      recordLock(this.adtclient, args.objectUrl, lockResult.LOCK_HANDLE, args.accessMode, false);
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              lockHandle: lockResult.LOCK_HANDLE,
              recorded: true,
              message: 'Object locked; the server recorded the handle, so write tools on this object may omit lockHandle until you unLock.'
            })
          }
        ]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to lock object: ${this.formatAdtError(error)}`
      );
    }
  }

  async handleUnlock(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      // dropSession/logout reset the client to stateless; locks require a stateful session
      this.adtclient.stateful = session_types.stateful;
      const handle = args.lockHandle || (await import('../lib/lockLedger.js')).findLock(this.adtclient, args.objectUrl)?.lockHandle;
      if (!handle) {
        throw new McpError(ErrorCode.InvalidParams, 'No lockHandle given and the server holds no recorded lock for this object (see listLocks)');
      }
      await this.adtclient.unLock(args.objectUrl, handle);
      forgetLock(this.adtclient, args.objectUrl);
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              message: 'Object unlocked successfully'
            })
          }
        ]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to unlock object: ${this.formatAdtError(error)}`
      );
    }
  }

  async handleListLocks(): Promise<any> {
    const locks = listLocks(this.adtclient);
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', count: locks.length, locks }) }] };
  }

  async handleForceUnlock(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      let released: string[] = [];
      let failed: Array<{ objectUrl: string; error: string }> = [];
      if (args.objectUrl) {
        const { findLock } = await import('../lib/lockLedger.js');
        const entry = findLock(this.adtclient, args.objectUrl);
        if (entry) {
          try {
            this.adtclient.stateful = session_types.stateful;
            await this.adtclient.unLock(entry.objectUrl, entry.lockHandle);
            released.push(entry.objectUrl);
          } catch (e: any) {
            failed.push({ objectUrl: entry.objectUrl, error: String(e?.message || e) });
          }
          forgetLock(this.adtclient, args.objectUrl);
        }
      } else {
        ({ released, failed } = await releaseAll(this.adtclient));
      }
      let sessionDropped = false;
      if (args.dropSession === true) {
        await this.adtclient.dropSession();
        this.adtclient.stateful = session_types.stateful;
        clearLedger(this.adtclient);
        sessionDropped = true;
      }
      this.trackRequest(startTime, true);
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', released, failed, sessionDropped, remaining: listLocks(this.adtclient).length }) }] };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw new McpError(ErrorCode.InternalError, `Failed to force unlock: ${this.formatAdtError(error)}`);
    }
  }
}
