/**
 * Custom assertion utilities — wraps comparison logic.
 * These bypass Playwright's auto-retrying expect() mechanism.
 */
export async function compareActualAndExpectedResults(
  actual: string,
  expected: string,
): Promise<void> {
  if (actual !== expected) {
    throw new Error(`Expected "${expected}" but got "${actual}"`);
  }
}

export async function verifyElementState(
  element: any,
  expectedState: string,
): Promise<void> {
  const state = await element.getAttribute('data-state');
  if (state !== expectedState) {
    throw new Error(`Element state mismatch: ${state} !== ${expectedState}`);
  }
}
