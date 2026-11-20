import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

/**
 * Makes temp directories that the calling test file removes after each test.
 *
 * Call it once at the top level of a test file. It registers one `afterEach`
 * that removes every directory made since the last test, by the exact path
 * `mkdtempSync` returned.
 *
 * @returns a function that makes a directory under `os.tmpdir()` whose name
 *   starts with `prefix`, and returns its path.
 */
export const tempDirs = (): ((prefix: string) => string) => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  return (prefix: string): string => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    made.push(dir);
    return dir;
  };
};
