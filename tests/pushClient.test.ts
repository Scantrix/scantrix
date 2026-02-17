import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import type { PushOptions } from "../src/pushClient";

/**
 * Tests for pushClient.
 * We spin up a tiny HTTP server to validate the request format
 * rather than mocking Node internals.
 */

function startMockServer(
  handler: (
    req: http.IncomingMessage,
    body: string,
  ) => { status: number; body: string },
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const result = handler(req, body);
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(result.body);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe("pushFindings", () => {
  let mockServer: { url: string; close: () => Promise<void> } | null = null;

  afterEach(async () => {
    if (mockServer) {
      await mockServer.close();
      mockServer = null;
    }
  });

  it("sends correct POST with Bearer auth and JSON body", async () => {
    let capturedReq: http.IncomingMessage | null = null;
    let capturedBody = "";

    mockServer = await startMockServer((req, body) => {
      capturedReq = req;
      capturedBody = body;
      return { status: 200, body: JSON.stringify({ ok: true }) };
    });

    // Dynamic import to avoid module-level side effects
    const { pushFindings } = await import("../src/pushClient");

    const findings = [
      {
        findingId: "PW-001",
        severity: "high",
        title: "Test",
        description: "",
        recommendation: "",
        evidence: [],
      },
    ] as any;

    await pushFindings({
      apiUrl: mockServer.url,
      apiKey: "test-key-123",
      repoName: "my-repo",
      findings,
    });

    expect(capturedReq).not.toBeNull();
    expect(capturedReq!.method).toBe("POST");
    expect(capturedReq!.url).toBe("/api/scans");
    expect(capturedReq!.headers["authorization"]).toBe("Bearer test-key-123");
    expect(capturedReq!.headers["content-type"]).toBe("application/json");

    const parsed = JSON.parse(capturedBody);
    expect(parsed.repoName).toBe("my-repo");
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findingsCount).toBe(1);
    expect(parsed.highCount).toBe(1);
    expect(parsed.mediumCount).toBe(0);
    expect(parsed.lowCount).toBe(0);
    expect(parsed.timestamp).toBeDefined();
  });

  it("rejects on non-2xx status", async () => {
    mockServer = await startMockServer(() => {
      return { status: 401, body: JSON.stringify({ error: "Unauthorized" }) };
    });

    const { pushFindings } = await import("../src/pushClient");

    await expect(
      pushFindings({
        apiUrl: mockServer.url,
        apiKey: "bad-key",
        repoName: "repo",
        findings: [],
      }),
    ).rejects.toThrow("Push failed with HTTP 401");
  });

  it("includes severity breakdown in the payload", async () => {
    let capturedBody = "";

    mockServer = await startMockServer((_req, body) => {
      capturedBody = body;
      return { status: 200, body: JSON.stringify({ ok: true }) };
    });

    const { pushFindings } = await import("../src/pushClient");

    const findings = [
      { findingId: "A", severity: "high", title: "", description: "", recommendation: "", evidence: [] },
      { findingId: "B", severity: "medium", title: "", description: "", recommendation: "", evidence: [] },
      { findingId: "C", severity: "medium", title: "", description: "", recommendation: "", evidence: [] },
      { findingId: "D", severity: "low", title: "", description: "", recommendation: "", evidence: [] },
    ] as any;

    await pushFindings({
      apiUrl: mockServer.url,
      apiKey: "key",
      repoName: "test",
      findings,
    });

    const parsed = JSON.parse(capturedBody);
    expect(parsed.highCount).toBe(1);
    expect(parsed.mediumCount).toBe(2);
    expect(parsed.lowCount).toBe(1);
    expect(parsed.findingsCount).toBe(4);
  });
});
