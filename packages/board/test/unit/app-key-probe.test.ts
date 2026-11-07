import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { probeAppKeysAtBoardStart } from '../../src/server/app-key-probe.js';

describe('probeAppKeysAtBoardStart', () => {
  it('logs one line per unreadable key, once, with the board prefix', () => {
    const logged: string[] = [];
    probeAppKeysAtBoardStart('/r', '/s', (l) => logged.push(l), (key) =>
      key === 'Merger app' ? { read: 'invalid', reason: 'cannot be read: /f/plot/plot-merger.1.private-key.pem' } : { read: 'absent' },
    );
    expect(logged).toEqual(["board: App key 'Merger app' is not usable: cannot be read: /f/plot/plot-merger.1.private-key.pem"]);
  });

  it('logs nothing for usable and undeclared keys', () => {
    const logged: string[] = [];
    probeAppKeysAtBoardStart('/r', '/s', (l) => logged.push(l), (key) => (key === 'Review app' ? { read: 'usable' } : { read: 'absent' }));
    expect(logged).toEqual([]);
  });

  it('a reader that throws is logged and does not propagate', () => {
    const logged: string[] = [];
    expect(() =>
      probeAppKeysAtBoardStart('/r', '/s', (l) => logged.push(l), () => {
        throw new Error('nope');
      }),
    ).not.toThrow();
    expect(logged).toHaveLength(3);
    expect(logged[0]).toContain('start probe failed (nope)');
  });

  it('the entry calls it after the ready line', () => {
    const entry = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/server/index.ts'), 'utf8');
    expect(entry).toMatch(/afterReady:\s*\(\)\s*=>\s*probeAppKeysAtBoardStart\(/);
  });
});
