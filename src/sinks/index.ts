import type { Sink } from "./types";
import { JsonSink } from "./jsonSink";

export interface SinkConfig {
  jsonPath?: string;
}

/**
 * Resolve sink configuration from environment variables, with optional
 * CLI-flag overrides.
 */
export function resolveSinkConfig(overrides?: Partial<SinkConfig>): SinkConfig {
  return {
    jsonPath: overrides?.jsonPath ?? process.env.SCANTRIX_JSON_PATH ?? undefined,
  };
}

/**
 * Build the ordered list of sinks from a validated {@link SinkConfig}.
 *
 * JSON sink is created when `jsonPath` is set.
 */
export function buildSinks(config: SinkConfig): Sink[] {
  const sinks: Sink[] = [];

  if (config.jsonPath) {
    sinks.push(new JsonSink(config.jsonPath));
  }

  return sinks;
}

export type { ScanResult } from "../scanResult";
export { JsonSink } from "./jsonSink";
