import type { ToolDefinition } from "../types/tools";
import type { ADTClient } from "abap-adt-api";
import { performance } from 'perf_hooks';
import { createLogger } from '../lib/logger';
import { formatAdtError } from '../lib/adtErrorFormatting';

export abstract class BaseHandler {
  protected readonly adtclient: ADTClient;
  protected readonly logger = createLogger(this.constructor.name);
  private readonly metrics = {
    requestCount: 0,
    errorCount: 0,
    successCount: 0,
    totalTime: 0
  };

  constructor(adtclient: ADTClient) {
    this.adtclient = adtclient;
  }

  protected trackRequest(startTime: number, success: boolean): void {
    const duration = performance.now() - startTime;
    this.metrics.requestCount++;
    this.metrics.totalTime += duration;
    
    if (success) {
      this.metrics.successCount++;
    } else {
      this.metrics.errorCount++;
    }

    this.logger.info('Request completed', {
      duration,
      success,
      metrics: this.getMetrics()
    });
  }

  /**
   * Formats a caught error for inclusion in an McpError message, recovering the
   * real SAP-side message/properties even when abap-adt-api's own error parsing
   * fell back to a bare "Request failed with status code NNN".
   */
  protected formatAdtError(error: unknown): string {
    return formatAdtError(error);
  }

  protected getMetrics() {
    return {
      ...this.metrics,
      averageTime: this.metrics.requestCount > 0 
        ? this.metrics.totalTime / this.metrics.requestCount 
        : 0
    };
  }

  abstract getTools(): ToolDefinition[];
  abstract handle(command: string, args: any): Promise<any>;
}
