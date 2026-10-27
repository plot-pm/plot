import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detachedFor } from '../../src/server/board.js';
import { rmTree } from '../helpers.mjs';

// `test/unit/setup/no-real-detached.ts` replaces the board's default
// `Detached` for this project. A test that passes no `detached` therefore
// starts no PR reader and no other detached process.

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmTree(dir);
});

describe('board unit tests start no detached process by default', () => {
  it('the default Detached starts nothing and opens no log', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-no-reader-'));
    temps.push(dir);
    const marker = path.join(dir, 'ran');
    const log = path.join(dir, 'child.log');
    const script = path.join(dir, 'child.mjs');
    fs.writeFileSync(script, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);

    const child = detachedFor({ repoRoot: dir, scriptsDir: dir }).node(script, [], dir, log);
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect(child.exitCode()).not.toBeNull();
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.existsSync(log)).toBe(false);
  });
});
