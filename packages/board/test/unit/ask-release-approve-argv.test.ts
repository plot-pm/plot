// `plot-ask.mjs release-approve <pr> <sha>`: the argument check in front of `releaseApproveAt`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { run } from '../../src/server/entry/main.js';

const HEX40 = 'a'.repeat(40);

describe('plot-ask release-approve argv', () => {
  afterEach(() => vi.restoreAllMocks());

  const cases: [string, string[]][] = [
    ['no arguments', ['release-approve']],
    ['no sha', ['release-approve', '7']],
    ['a non-numeric pr', ['release-approve', 'abc', 'deadbeef']],
    ['a sha shorter than 7 hex characters', ['release-approve', '7', 'dead']],
    ['a 40-character sha that is not hex', ['release-approve', '7', 'z'.repeat(40)]],
    ['a numeric-looking pr with trailing text', ['release-approve', '7x', HEX40]],
  ];

  for (const [name, argv] of cases) {
    it(`exits 2 with the usage line for ${name}`, async () => {
      const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const out = vi.fn();
      expect(await run(argv, '/nonexistent', out)).toBe(2);
      expect(err).toHaveBeenCalledWith('usage: plot-ask.mjs release-approve <pr> <sha>\n');
      expect(out).not.toHaveBeenCalled();
    });
  }
});

describe('plot-ask release-approve carries no passkey', () => {
  let root: string;
  const saved = { unattended: process.env.PLOT_UNATTENDED, repo: process.env.PLOT_REPO_ROOT };
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ask-release-approve-'));
    process.env.PLOT_REPO_ROOT = root;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of [['PLOT_UNATTENDED', saved.unattended], ['PLOT_REPO_ROOT', saved.repo]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  // `env -u PLOT_UNATTENDED` is the unset case: the bypass the plan measured.
  const readings: [string, string | undefined][] = [['unset (env -u)', undefined], ['0', '0'], ['1', '1']];
  for (const [name, value] of readings) {
    it(`refuses person-unproven with PLOT_UNATTENDED ${name} for a caller that reads person or unattended`, async () => {
      if (value === undefined) delete process.env.PLOT_UNATTENDED;
      else process.env.PLOT_UNATTENDED = value;
      const out = vi.fn();
      const code = await run(['release-approve', '7', HEX40], '/nonexistent', out);
      const printed = JSON.parse(out.mock.calls.map((c) => String(c[0])).join('')) as { approved: boolean; reason: string; detail: string };
      expect(code).toBe(1);
      expect(printed.approved).toBe(false);
      // `1` is the unattended caller, refused first; `unset` and `0` read person and reach the proof.
      expect(printed.reason).toBe(value === '1' ? 'unattended' : 'person-unproven');
      if (value !== '1') expect(printed.detail).toContain('board');
    });
  }
});
