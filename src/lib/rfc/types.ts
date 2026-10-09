/**
 * Contract between the RFC transport (rfcHttpClient.ts, which speaks the
 * abap-adt-api HttpClient interface) and the NW RFC SDK binding (nwrfc.ts,
 * which loads the SDK the user installed and calls SADT_REST_RFC_ENDPOINT).
 *
 * Why RFC at all: SAP_BASIS below 7.51 ignores X-sap-adt-sessiontype over
 * HTTP, so every ADT HTTP request runs stateless and a LOCK dies with its
 * request. Eclipse on-premise projects avoid this by calling the remote-enabled
 * function module SADT_REST_RFC_ENDPOINT over RFC (SAP JCo); an RFC connection
 * is a stateful ABAP session for as long as it stays open.
 *
 * Interface of the function module (DDIC, confirmed on 7.40 SP07 and 7.53):
 *   IMPORTING REQUEST  TYPE SADT_REST_REQUEST
 *     REQUEST_LINE  : SADT_REST_REQUEST_LINE { METHOD string, URI string, VERSION string }
 *     HEADER_FIELDS : TIHTTPNVP, rows IHTTPNVP { NAME, VALUE }
 *     MESSAGE_BODY  : rawstring (XSTRING)
 *   EXPORTING RESPONSE TYPE SADT_REST_RESPONSE
 *     STATUS_LINE   : SADT_REST_STATUS_LINE { VERSION string, STATUS_CODE sstring(3), REASON_PHRASE string }
 *     HEADER_FIELDS : TIHTTPNVP
 *     MESSAGE_BODY  : rawstring (XSTRING)
 *
 * The SAP NetWeaver RFC SDK is never shipped with this package: SAP's licence
 * terms for connectors forbid redistribution. Each user downloads it with
 * their own S-user and points SAPNWRFC_HOME (or rfc.sdkPath) at it.
 */

/** NW RFC SDK connection parameters by their SDK names (ASHOST, SYSNR, CLIENT, USER, PASSWD, LANG, MYSAPSSO2, MSHOST, SYSID, GROUP, SAPROUTER, ...). */
export type RfcLogonParams = Record<string, string>;

export interface SadtHeader {
  name: string;
  value: string;
}

/** One ADT REST request as SADT_REST_RFC_ENDPOINT receives it. */
export interface SadtRequest {
  method: string;
  /** Path plus encoded query string, e.g. /sap/bc/adt/programs/programs/zx?_action=LOCK&accessMode=MODIFY */
  uri: string;
  version: string;
  headers: SadtHeader[];
  body: Buffer;
}

/** One ADT REST response as SADT_REST_RFC_ENDPOINT returns it, untouched. */
export interface SadtResponse {
  version: string;
  /** Raw STATUS_CODE; may carry a trailing blank ("200 ") and may be empty on old releases. */
  statusCode: string;
  reasonPhrase: string;
  headers: SadtHeader[];
  body: Buffer;
}

/** An open RFC connection: one ABAP user session on the backend. */
export interface RfcConnection {
  /** Call SADT_REST_RFC_ENDPOINT once. Calls on one connection must be serialized by the implementation. Rejects with RfcError. */
  callAdt(request: SadtRequest): Promise<SadtResponse>;
  /** RfcResetServerContext: ends the ABAP context of this connection; enqueue locks held by it are released. */
  reset(): Promise<void>;
  /** RfcCloseConnection; idempotent. */
  close(): Promise<void>;
  /** true after close() or after the SDK reported the connection as broken. */
  readonly closed: boolean;
}

/** The loaded SDK. */
export interface RfcConnector {
  /** RfcOpenConnection with the given parameters. Rejects with RfcError (rfcCode RFC_LOGON_FAILURE on bad credentials or an expired ticket). */
  open(params: RfcLogonParams): Promise<RfcConnection>;
  /** "major.minor.patch" of the loaded SDK, from RfcGetVersion. */
  readonly sdkVersion: string;
  /** Absolute path of the library that was loaded. */
  readonly libraryPath: string;
}

/** RFC_RC codes of the NW RFC SDK that the transport reacts to. */
export const RFC_RC = {
  RFC_OK: 0,
  RFC_COMMUNICATION_FAILURE: 1,
  RFC_LOGON_FAILURE: 2,
  RFC_ABAP_RUNTIME_FAILURE: 3,
  RFC_ABAP_MESSAGE: 4,
  RFC_ABAP_EXCEPTION: 5,
  RFC_CLOSED: 6,
  RFC_CANCELED: 7,
  RFC_TIMEOUT: 8,
  RFC_MEMORY_INSUFFICIENT: 9,
  RFC_VERSION_MISMATCH: 10,
  RFC_INVALID_PROTOCOL: 11,
  RFC_SERIALIZATION_FAILURE: 12,
  RFC_INVALID_HANDLE: 13,
} as const;

/** An error reported by the NW RFC SDK (RFC_ERROR_INFO), or by the binding itself before the SDK was reached. */
export class RfcError extends Error {
  constructor(
    message: string,
    /** RFC_RC value; -1 when the binding failed before calling the SDK (SDK not found, wrong version, ...). */
    readonly rfcCode: number,
    /** Symbolic name of rfcCode, e.g. RFC_LOGON_FAILURE, or SDK_NOT_FOUND for binding-level failures. */
    readonly rfcCodeName: string,
    /** RFC_ERROR_GROUP value, when the SDK reported one. */
    readonly group?: number,
    /** RFC_ERROR_INFO.key, e.g. RFC_INVALID_LOGON. */
    readonly key?: string,
    /** ABAP message carried by RFC_ERROR_INFO, when present. */
    readonly abapMessage?: { msgClass: string; msgType: string; msgNumber: string; v1: string; v2: string; v3: string; v4: string },
  ) {
    super(message);
    this.name = 'RfcError';
  }

  /** The connection is gone (network, gateway, timeout, closed handle): everything held in its session, locks included, is lost. */
  get connectionLost(): boolean {
    return this.rfcCode === RFC_RC.RFC_COMMUNICATION_FAILURE || this.rfcCode === RFC_RC.RFC_CLOSED
      || this.rfcCode === RFC_RC.RFC_TIMEOUT || this.rfcCode === RFC_RC.RFC_INVALID_HANDLE;
  }

  /**
   * The SDK closed the connection with this error: everything in connectionLost,
   * plus an ABAP message or a short dump in the called module (the SDK
   * documentation of RfcInvoke: the SDK closes the connection after these).
   */
  get closesConnection(): boolean {
    return this.connectionLost || this.rfcCode === RFC_RC.RFC_ABAP_MESSAGE || this.rfcCode === RFC_RC.RFC_ABAP_RUNTIME_FAILURE;
  }

  get logonFailure(): boolean {
    return this.rfcCode === RFC_RC.RFC_LOGON_FAILURE;
  }
}

/** RFC settings of a destination (systems.json "rfc" block). */
export interface RfcDestinationConfig {
  /** Application server host (direct logon). */
  ashost?: string;
  /** Two-digit instance number; the gateway listens on 33<sysnr>. */
  sysnr?: string;
  /** Message server host (load-balanced logon), with sysid and group. */
  mshost?: string;
  sysid?: string;
  group?: string;
  /** Optional message server service or port when sapms<SID> does not resolve. */
  msserv?: string;
  /** SAProuter string, /H/host/S/port/... */
  saprouter?: string;
  /** Gateway overrides. */
  gwhost?: string;
  gwserv?: string;
  /** Folder of the NW RFC SDK (the one that contains lib/); falls back to SAPNWRFC_HOME. */
  sdkPath?: string;
  /**
   * "split" (default, like Eclipse): LOCK/UNLOCK run on a long-lived enqueue
   * connection, everything else on a work connection whose context is reset
   * after each write. "single": everything on one connection, never reset.
   */
  sessions?: 'split' | 'single';
}
