/**
 * Resource manager utility — manages browser resource pools with
 * exponential backoff retry logic. This is infrastructure code,
 * NOT a test file. It should not trigger PW-FLAKE-001 or PW-FLAKE-002.
 */

export interface ResourceOptions {
  maxRetries: number;
  baseDelay: number;
  force: true; // config flag, not Playwright force-click
}

export async function acquireWithRetry(
  resourceId: string,
  options: ResourceOptions = { maxRetries: 3, baseDelay: 1000, force: true },
): Promise<void> {
  let attempt = 0;

  while (attempt < options.maxRetries) {
    try {
      // Simulate resource acquisition
      await fetchResource(resourceId);
      return;
    } catch {
      attempt++;
      const backoff = options.baseDelay * Math.pow(2, attempt);
      // Exponential backoff — legitimate delay, not a test hard-wait
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw new Error(`Failed to acquire resource ${resourceId} after ${options.maxRetries} attempts`);
}

async function fetchResource(id: string): Promise<void> {
  // stub
  if (!id) throw new Error("missing id");
}
