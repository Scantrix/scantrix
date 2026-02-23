import https from "https";
import http from "http";
import type { ScanResult } from "../scanResult";
import type { Sink } from "./types";

/**
 * Sends the {@link ScanResult} to a central Hub ingestion endpoint
 * via HTTP POST with Bearer-token authentication.
 *
 * Used in pipeline / CI mode where results are aggregated in a
 * shared Postgres-backed dashboard rather than a local SQLite DB.
 */
export class HubSink implements Sink {
  readonly name = "hub";

  constructor(
    private readonly ingestUrl: string,
    private readonly token: string,
  ) {}

  async write(result: ScanResult): Promise<void> {
    const url = new URL(this.ingestUrl);
    const body = JSON.stringify(result);

    return new Promise<void>((resolve, reject) => {
      const transport = url.protocol === "https:" ? https : http;
      const req = transport.request(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.token}`,
            "User-Agent": `scantrix-cli/${result.version}`,
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          const { statusCode } = res;
          const chunks: Buffer[] = [];
          res.on("data", (d) =>
            chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)),
          );
          res.on("end", () => {
            if (statusCode && statusCode >= 200 && statusCode < 300) {
              resolve();
            } else {
              const respBody = Buffer.concat(chunks).toString("utf8");
              reject(
                new Error(
                  `Hub ingest failed HTTP ${statusCode ?? "?"}: ${respBody}`,
                ),
              );
            }
          });
        },
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}
