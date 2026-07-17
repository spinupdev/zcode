/**
 * Browser agent library (ZenFS/OPFS + git worker + locks).
 * Implementation lands in Track B2–B4. This package only exports the public surface.
 */

export type { BrowserAgent } from '@zcode/protocol';

export class BrowserAgentNotImplementedError extends Error {
  constructor(feature: string) {
    super(
      `@zcode/browser-agent: ${feature} is not implemented yet (Track B2–B4).`,
    );
    this.name = 'BrowserAgentNotImplementedError';
  }
}

/** Placeholder factory — real OPFS/git agent replaces this in B2+. */
export function createBrowserAgent(): never {
  throw new BrowserAgentNotImplementedError('createBrowserAgent');
}
