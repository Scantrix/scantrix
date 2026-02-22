import fs from "fs/promises";
import path from "path";
import type { ScanResult } from "../scanResult";
import type { Sink } from "./types";

/**
 * Writes the full {@link ScanResult} as a pretty-printed JSON file.
 *
 * This sink is always safe to use and has no external dependencies
 * beyond Node's built-in `fs` module.  Recommended in every
 * environment (local & CI) as a durable artifact / fallback.
 */
export class JsonSink implements Sink {
  readonly name = "json";

  constructor(private readonly filePath: string) {}

  async write(result: ScanResult): Promise<void> {
    const abs = path.resolve(this.filePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, JSON.stringify(result, null, 2), "utf8");
  }
}
