/**
 * isomorphic-git requires a global `Buffer` (Node API) even in the browser.
 * @see https://github.com/isomorphic-git/isomorphic-git/issues/1855
 */
import { Buffer } from 'buffer';

const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (typeof g.Buffer === 'undefined') {
  g.Buffer = Buffer;
}

export { Buffer };
