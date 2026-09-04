import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * THE PROBE READS ITS OWN HELP TEXT — issue #668.
 *
 * `bb_test_json_support` consulted a text heuristic BEFORE the exit code, and
 * bb 1.9.0's help says "a bare `--json`, costs nothing extra". The old pattern
 * `--json.*not` matched `--json, costs no`t`hing`, so a bb that WORKS was
 * refused for documenting the flag it supports.
 *
 * The bug therefore scaled with documentation quality: bb 1.0.0 lacks that
 * sentence and passed; bb 1.9.0 explains the flag and failed.
 *
 * These drive the function against a stub `bb` on PATH. This estate reports
 * `backend github`, so nothing here runs against a real bb and the tests claim
 * no more than that.
 */
const SCRIPT = 'skills/plot/scripts/plot-host.sh';

/** The function alone, sourced without the script's own dispatch. */
const probeIn = (dir) => {
  const fn = execFileSync('sed', ['-n', '/^bb_test_json_support()/,/^}/p', SCRIPT], { encoding: 'utf8' });
  const path = join(dir, 'fn.sh');
  writeFileSync(path, fn);
  return path;
};

/** A stub `bb` printing `help` and exiting `code`. */
const stubBb = (dir, help, code) => {
  const path = join(dir, 'bb');
  writeFileSync(path, `#!/usr/bin/env bash\ncat <<'HELPEOF'\n${help}\nHELPEOF\nexit ${code}\n`);
  chmodSync(path, 0o755);
};

const probe = (help, code) => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-bbprobe-'));
  try {
    const fn = probeIn(dir);
    stubBb(dir, help, code);
    const out = execFileSync('bash', ['-c', `source '${fn}'; bb_test_json_support && echo ACCEPTED || echo REFUSED`],
      { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
    return out.trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('bb probe: help documenting --json is not a rejection', () => {
  // THE REGRESSION LOCK. Verified 2026-09-04 that this returns REFUSED against
  // the function as it stood on main, so the fix is the reason it passes.
  assert.equal(probe('other fields, or a bare --json, costs nothing extra.', 0), 'ACCEPTED');
});

test('bb probe: a real flag rejection is still refused', () => {
  // craftamap 0.6.0 exits NON-ZERO, so it never reaches the early return and
  // its exact message still matches the narrowed patterns.
  assert.equal(probe('Error: unknown flag: --json', 1), 'REFUSED');
});

test('bb probe: any prose with exit 0 is accepted', () => {
  // THE RULE, NOT THE SENTENCE. The next false negative will be different prose
  // from a different release, so this pins the ordering — a help call that
  // exits 0 proves the flag parsed, whatever the text says.
  assert.equal(probe('Prints results. Note: nothing else matters.', 0), 'ACCEPTED');
});

test('bb probe: an unrecognised failure accepts rather than refuses', () => {
  // Round 1's behaviour change. Refusing on wording outside the three known
  // formats is the same mistake as #668, one arm along — so the first real call
  // fails with bb's own error instead.
  assert.equal(probe('some other failure entirely', 2), 'ACCEPTED');
});
