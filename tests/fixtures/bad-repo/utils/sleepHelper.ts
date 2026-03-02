// Obvious name, Promise-based sleep
export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Deceptive name — looks meaningful but is just a sleep
export async function waitForDataSync(timeoutMs: number = 3000): Promise<void> {
  await new Promise((r) => setTimeout(r, timeoutMs));
}

// NOT a sleep wrapper — contains retry loop (should NOT be flagged)
export async function retryOperation(fn: () => Promise<void>, maxAttempts: number = 3): Promise<void> {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try { await fn(); return; } catch {
      attempt++;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

// Class-based sleep wrapper — method should be flagged
export class WaiterHelpers {
  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  async waitForIdleNetwork(page: any): Promise<void> {
    await page.waitForNetworkIdle();
  }
}
