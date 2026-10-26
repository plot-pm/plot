import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sameCommit } from '../src/rules/same-commit.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * Does `sameCommit` answer what `plot-host.sh`'s Bitbucket pinned `pr-merge`
 * arm answers, over representative sha pairs?
 *
 * THE PAIR EXISTS ON PURPOSE. `plot-host.sh`'s `pr-merge --match-head` already
 * carries a comment naming `sameCommit` as the rule it mirrors — Bitbucket's
 * merge endpoint takes no head precondition, so the shell re-reads the head
 * and matches it by prefix itself rather than paying a bundle hop on every
 * merge. NEITHER SIDE IS AUTHORITATIVE: on a disagreement the branch stops,
 * and adjusting either side to make this pass is the one move forbidden.
 *
 * THE SHELL IS RUN, NOT COPIED. A stub `bb` answers `pr view` with the
 * case's head sha and a no-op `pr merge`, so `plot-host.sh pr-merge <num>
 * --match-head <pin>` on the bitbucket backend exercises the real pin-match
 * expression in place rather than a pasted copy of it — the exact gap
 * `docs/shell-and-domain.md` exists to close, after a hand-copied fragment
 * drifted silently once before.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = join(ROOT, 'skills/plot/scripts/plot-host.sh');
const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

/** One pair of shas handed to both sides, and a name a failure can be read by. */
interface Case {
  name: string;
  a: string;
  b: string;
}

const CASES: Case[] = [
  { name: 'identical 40-character shas', a: 'a'.repeat(40), b: 'a'.repeat(40) },
  { name: '12-character head is a prefix of the 40-character pin', a: '66836536f8c9', b: '66836536f8c9' + 'a'.repeat(28) },
  { name: '40-character pin is a prefix of the 12-character head (reversed)', a: '66836536f8c9' + 'a'.repeat(28), b: '66836536f8c9' },
  { name: 'uppercase head against lowercase pin', a: '66836536F8C9' + 'a'.repeat(28), b: '66836536f8c9' },
  { name: '12-character head does not extend the 40-character pin', a: '66836536f8c9', b: '66836536f8c8' + 'a'.repeat(28) },
  { name: 'moved head, unrelated 40-character shas', a: 'a'.repeat(40), b: 'b'.repeat(40) },
  { name: 'exactly seven hex characters, matching', a: '1234567', b: '1234567' },
  { name: 'six hex characters, too short to pin', a: '123456', b: '123456' },
  { name: 'seven characters but one is not hex', a: '123456g', b: '123456g' },
  { name: 'empty head', a: '', b: 'a'.repeat(40) },
];

/**
 * `'empty pin'` (`a` set, `b: ''`) and `'both empty'` (`a: '', b: ''`) are
 * deliberately absent. Both would pass `one.b` as `pr-merge`'s `--match-head`
 * value, and `plot-host.sh`'s `${2:?pr-merge --match-head needs a commit}`
 * refuses an empty string the same as a missing argument — the CLI layer
 * rejects them before the pin-match expression this file exists to compare
 * ever runs. `sameCommit('a'.repeat(40), '')` and `sameCommit('', '')` are
 * still covered by {@link same-commit.test.ts}; there is no shell verdict to
 * compare them against.
 */

let sandbox = '';

/** Writes an executable stub into `dir`. */
const stub = (dir: string, name: string, body: string): void => {
  writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}`);
  chmodSync(join(dir, name), 0o755);
};

/**
 * `plot-host.sh pr-merge`'s verdict for one case: `true` where it merged
 * (the stub `bb pr merge` ran), `false` where it refused `head-moved`.
 *
 * ONE PROCESS PER CASE. `pr-merge` re-reads the head through `bb pr view`
 * before matching, so each case needs its own stub answering with that
 * case's head sha — unlike the listing corpus, the head is the input under
 * test rather than a fixed shape the args vary.
 */
const shellVerdict = (one: Case, index: number): boolean => {
  const dir = mkdtempSync(join(sandbox, `case-${index}-`));
  // The shape `bb pr view --json` returns for a Bitbucket PR: `bb_state_row`
  // pipes it through `plot-jenkins-pr-checks.mjs state`, which reads
  // `.id`, `.state`, `.links.html.href` and `.source.commit.hash` — the last
  // of those is the head sha the pin-match expression compares against.
  const pr = {
    id: 1,
    state: 'OPEN',
    draft: false,
    links: { html: { href: 'https://bitbucket.org/acme/repo/pull-requests/1' } },
    source: { branch: { name: 'feature' }, commit: { hash: one.a } },
    destination: { branch: { name: 'main' } },
  };
  const json = JSON.stringify(pr).replace(/'/g, `'\\''`);
  stub(dir, 'bb', [
    'if [ "$1" = "pr" ] && [ "$2" = "view" ]; then',
    `  printf '%s' '${json}'`,
    '  exit 0',
    'fi',
    'if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then',
    '  exit 0',
    'fi',
    'echo "stub bb: unexpected args: $*" >&2',
    'exit 1',
    '',
  ].join('\n'));
  const run = spawnSync('bash', [HOST, 'pr-merge', '1', '--match-head', one.b], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      PLOT_HOST: 'bitbucket',
      PLOT_BUDGET_OFF: '1',
      PLOT_BB_SKIP_CAP_CHECK: '1',
    },
  });
  if (run.status === 0) return true;
  if (/head-moved/.test(run.stderr)) return false;
  throw new Error(`plot-host.sh pr-merge exited ${run.status} unexpectedly: ${run.stderr}`);
};

let verdicts: { one: Case; shell: boolean }[] = [];

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-same-commit-corpus-'));
  verdicts = CASES.map((one, i) => ({ one, shell: shellVerdict(one, i) }));
});

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

describe('sameCommit agrees with plot-host.sh pr-merge Bitbucket pin match', () => {
  it('reads a corpus worth comparing', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(10);
    expect(verdicts.length).toBe(CASES.length);
  });

  it('exercises both answers, so this is not vacuous', () => {
    const ruled = new Set(CASES.map((one) => sameCommit(one.a, one.b)));
    expect([...ruled].sort()).toEqual([false, true]);
    expect(new Set(verdicts.map((v) => v.shell)).size).toBe(2);
  });

  it('answers what the shell answers, on every case', () => {
    const found: Disagreement[] = [];
    for (const { one, shell } of verdicts) {
      compareField(found, one.name, 'same-commit', sameCommit(one.a, one.b), shell);
    }
    expect(found.map(report)).toEqual([]);
  });
});
