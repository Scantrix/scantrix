import type { Sink } from "./types";
import { JsonSink } from "./jsonSink";
import { SqliteSink } from "./sqliteSink";
import { HubSink } from "./hubSink";

export type SinkMode = "local" | "hub";

export interface SinkConfig {
  mode: SinkMode;
  jsonPath?: string;
  sqlitePath?: string;
  ingestUrl?: string;
  token?: string;
}

/**
 * Resolve sink configuration from environment variables, with optional
 * CLI-flag overrides.
 *
 * Performs **fail-fast validation**: if the configuration is invalid
 * (e.g. hub mode without a token), this throws immediately so the
 * scan never starts.
 */
export function resolveSinkConfig(overrides?: Partial<SinkConfig>): SinkConfig {
  const raw = overrides?.mode ?? process.env.SCANTRIX_SINK ?? "local";
  const mode = raw as SinkMode;

  if (mode !== "local" && mode !== "hub") {
    throw new Error(
      `Invalid SCANTRIX_SINK value "${String(raw)}". Expected "local" or "hub".`,
    );
  }

  const config: SinkConfig = {
    mode,
    jsonPath:   overrides?.jsonPath   ?? process.env.SCANTRIX_JSON_PATH   ?? undefined,
    sqlitePath: overrides?.sqlitePath ?? process.env.SCANTRIX_SQLITE_PATH ?? undefined,
    ingestUrl:  overrides?.ingestUrl  ?? process.env.SCANTRIX_INGEST_URL  ?? undefined,
    token:      overrides?.token      ?? process.env.SCANTRIX_TOKEN       ?? undefined,
  };

  // ── Fail-fast validation ─────────────────────────────────────────
  if (mode === "hub") {
    if (!config.ingestUrl) {
      throw new Error(
        "Hub mode requires SCANTRIX_INGEST_URL (or --ingest-url).",
      );
    }
    if (!config.token) {
      throw new Error(
        "Hub mode requires SCANTRIX_TOKEN (or --token).",
      );
    }
  }

  return config;
}

/**
 * Build the ordered list of sinks from a validated {@link SinkConfig}.
 *
 * - JSON sink is always created when `jsonPath` is set.
 * - In **local** mode an optional SQLite sink is appended.
 * - In **hub** mode the Hub HTTP sink is appended.
 */
export function buildSinks(config: SinkConfig): Sink[] {
  const sinks: Sink[] = [];

  // JSON sink — always active when a path is provided
  if (config.jsonPath) {
    sinks.push(new JsonSink(config.jsonPath));
  }

  if (config.mode === "local") {
    if (config.sqlitePath) {
      sinks.push(new SqliteSink(config.sqlitePath));
    }
  } else if (config.mode === "hub") {
    sinks.push(new HubSink(config.ingestUrl!, config.token!));
  }

  return sinks;
}

export type { Sink } from "./types";
export type { ScanResult } from "../scanResult";
export { JsonSink } from "./jsonSink";
export { SqliteSink } from "./sqliteSink";
export { HubSink } from "./hubSink";
