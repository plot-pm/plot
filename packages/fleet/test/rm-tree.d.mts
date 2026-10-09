/**
 * Delete a fixture tree, retrying only while a dying process still writes into
 * it. See `rm-tree.mjs` for the reasoning; this is its type declaration, read
 * because `fleet`'s `tsconfig.json` includes `test`, and a `strict` project
 * needs one for a plain `.mjs` import.
 */
export function removeTree(target: string, options?: { retries?: number; delayMs?: number }): void;
