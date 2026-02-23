import type { ScanResult } from "../scanResult";

/**
 * A Sink receives a {@link ScanResult} and persists it to a
 * storage backend.  Implementations must be safe to call
 * concurrently from different processes (file-level locking
 * or idempotent writes).
 */
export interface Sink {
  /** Human-readable sink identifier for log messages */
  readonly name: string;
  /** Persist the scan result.  Throws on failure. */
  write(result: ScanResult): Promise<void>;
}
