import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hostShell } from '../src/adapters/host/host-shell.js';
import { shellContext } from '../src/adapters/scripts.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * May a caller treat this branch as merged — and do the two lookups that answer
 * it agree?
 *
 * TWO LOOKUPS, ONE QUESTION. `_plot_merged_lookup` behind `pr_merged`
 * (`plot-pr-merged.sh`) asks `gh` directly; the TypeScript host adapter's
 * `prMerged` (`adapters/host/host-shell.ts`) runs `plot-host.sh pr-merged`,
 * which asks `gh` too. `plot-pr-merged.sh`'s header states why the shell keeps
 * its own lookup, and `scripts/check-host-cli-callers.sh` exempts it by name.
 * The RULE is shared — both reach `rules/landed.ts`, the shell through
 * `board/plot-landed.mjs` — so the rule cannot disagree with itself. What is
 * implemented twice is the LOOKUP, and the empty-branch defect (#1082) was a
 * disagreement between the two that stayed latent because nothing compared
 * them.
 *
 * THE COMPARED VERDICT IS ONE BOOLEAN: may a caller treat this branch as
 * merged. The shell's verdict is `pr_merged`'s exit code 0. The adapter's is an
 * `ok` result whose value is `merged`; a failed result, `not-merged` and
 * `unknown` all refuse, exactly as `registryd-main.ts` maps them. The
 * three-valued answer is deliberately NOT compared: the shell has no
 * `not-merged`/`unknown` distinction at exit-code level, so comparing unequal
 * vocabularies could only pass by translation.
 *
 * THE CORPUS IS BUILT, NOT READ. No branch on the estate is empty, so a live
 * corpus cannot exercise the case this plan exists for.
 *
 * ONE STUB `gh` SERVES BOTH SIDES. That is what makes a single-stub comparison
 * possible at all: the shell calls `gh` directly and the adapter calls it
 * through `plot-host.sh`, so a `gh` on `PATH` is reachable by both.
 *
 * WHAT THIS COMPARISON LEAVES OUT, by name:
 *
 * - `pr_open` has no TypeScript counterpart. `plot-pr-merged.sh` states that no
 *   `plot-host.sh` op answers *any open PR* with three values, so there is
 *   nothing to compare it against; `test/reconcile/host.test.mjs` holds
 *   `pr_open ""`.
 * - `github` ONLY. `_plot_merged_lookup` asks `gh` on every backend while
 *   `plot-host.sh pr-merged` also serves Bitbucket. A Bitbucket divergence is a
 *   separate finding and is not this comparison's to hold.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const PR_MERGED_LIB = join(ROOT, 'skills/plot/scripts/plot-pr-merged.sh');
const report = describingAs({ left: 'adapter', right: 'shell' });

/** One row as `gh pr list --json` returns it, newest first. */
interface Row {
  readonly number: number;
  readonly mergedAt: string | null;
}

/** One branch asked about, against one stub `gh`. */
interface Case {
  /** What the case is called in a disagreement report. */
  readonly label: string;
  /** The branch handed to both lookups. */
  readonly branch: string;
  /** The rows the stub holds, or `null` to make the stub fail. */
  readonly rows: readonly Row[] | null;
  /** What the stub writes to stderr before exiting non-zero. */
  readonly error?: string;
  /** Whether `gh` is absent from `PATH` for this case. */
  readonly absent?: boolean;
}

const MERGED: Row = { number: 101, mergedAt: '2026-01-01T00:00:00Z' };
const OPEN: Row = { number: 102, mergedAt: null };

const CASES: readonly Case[] = [
  // THE DEFECT. `gh pr list --head ""` applies no filter, so every PR in the
  // repository matches and the lookup reads *merged* about a branch that is not
  // one. Measured 2026-10-01 on `origin/main` (`56a978ea`): `pr_merged ""`
  // exited 0 and `pr_merged_heads ""` printed 98 lines.
  { label: 'empty', branch: '', rows: [MERGED, OPEN] },
  { label: 'one-merged-pr', branch: 'feature/merged', rows: [MERGED] },
  // THE `--limit 1` CASE. A newer unmerged PR sits in FRONT of the merge, so a
  // lookup reading only the newest PR answers *not merged* about a branch whose
  // work is on main. The stub honours `--limit`, which is what makes this case
  // bite rather than pass by accident.
  { label: 'newer-unmerged-in-front', branch: 'feature/masked', rows: [OPEN, MERGED] },
  { label: 'no-pr', branch: 'feature/fresh', rows: [] },
  { label: 'only-an-open-pr', branch: 'feature/open', rows: [OPEN] },
  // `gh` ABSENT. The shell's `command -v gh` answers `unaskable`;
  // `plot-host.sh` reads `command not found` on stderr, which `is_lookup_miss`
  // excludes by name, and answers `unknown`. Different words, one refusal.
  { label: 'gh-absent', branch: 'feature/no-cli', rows: null, absent: true },
  // AN AUTH ERROR, AND THE TEXT IS CHOSEN DELIBERATELY. `is_lookup_miss` reads
  // the CLI's own words, so an error phrased as a lookup miss would be answered
  // `not-merged` — the host speaking — while this one is not a miss and is
  // answered `unknown`. Both refuse, and the distinction is the reason the text
  // is named in the case rather than left to chance.
  { label: 'gh-auth-error', branch: 'feature/unauthed', rows: null, error: 'gh: Bad credentials (HTTP 401)' },
];

let sandbox = '';
/** A `PATH` holding every real tool except `gh`, built once. */
let withoutGh = '';

/** Writes an executable stub into `dir`. */
const stub = (dir: string, name: string, body: string): void => {
  writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}`);
  chmodSync(join(dir, name), 0o755);
};

/**
 * A directory holding a symlink to every executable on the real `PATH` except
 * `gh`.
 *
 * BUILT UP, NEVER DELETED FROM. The absent-CLI case needs a `PATH` where `gh`
 * cannot be found, and `plot-host.sh` needs far more than `bash`, `jq` and
 * `node` to reach its `gh` call at all — it resolves `dirname` and sources
 * `plot-tmp.sh` first, so a hand-picked tool list reports a temp-file failure
 * instead of the missing CLI. Nothing is removed from the real `PATH`.
 */
const pathWithoutGh = (dir: string): string => {
  for (const entry of (process.env.PATH ?? '').split(':')) {
    if (entry === '') continue;
    let names: string[];
    try {
      names = readdirSync(entry);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === 'gh' || existsSync(join(dir, name))) continue;
      try {
        symlinkSync(join(entry, name), join(dir, name));
      } catch {
        // A name that cannot be linked is one this PATH cannot offer either.
      }
    }
  }
  return dir;
};

/**
 * The stub `gh` for one case, and the file it records its argv in.
 *
 * THE STUB ANSWERS `--head ""` WITH EVERY ROW IT HOLDS, as the real `gh` does.
 * Measured 2026-10-01: `gh pr list --head ""` applies no filter. A stub that
 * returned nothing for an empty head would reproduce a stub's idea of the
 * defect and would pass with the guard removed.
 *
 * AND IT HONOURS `--limit`, which is what makes the masked-merge case bite. A
 * stub returning both rows regardless passes the verdict comparison on a lookup
 * regressed to `--limit 1`; slicing to the asked limit makes that regression
 * answer *not merged* and fail.
 *
 * AND IT RECORDS ITS ARGV ON EVERY CALL, so a missing file is positive proof
 * that no call was made. That is the assertion a guard placed after
 * `command -v gh` fails.
 */
const ghStub = (dir: string, one: Case): string => {
  const argv = join(dir, 'gh.argv');
  if (one.rows === null) {
    stub(dir, 'gh', [
      `printf '%s\\n' "$@" >> ${JSON.stringify(argv)}`,
      `printf '%s\\n' ${JSON.stringify(one.error ?? '')} >&2`,
      'exit 1',
      '',
    ].join('\n'));
    return argv;
  }
  const rows = JSON.stringify(one.rows).replace(/'/g, `'\\''`);
  stub(dir, 'gh', [
    `printf '%s\\n' "$@" >> ${JSON.stringify(argv)}`,
    'limit=100; prev=""',
    'for a in "$@"; do [ "$prev" = --limit ] && limit="$a"; prev="$a"; done',
    `LIMIT="$limit" node -e 'let s="";process.stdin.on("data",(d)=>{s+=d;}).on("end",()=>{process.stdout.write(JSON.stringify(JSON.parse(s).slice(0,Number(process.env.LIMIT))));});' <<<'${rows}'`,
    '',
  ].join('\n'));
  return argv;
};

/** What one case's readings and both verdicts came to. */
interface Reading {
  readonly one: Case;
  /** Whether the shell permits treating the branch as merged. */
  readonly shell: boolean;
  /** Whether the adapter permits it. */
  readonly adapter: boolean;
  /** Whether the stub `gh` recorded any call from the shell side. */
  readonly shellAskedGh: boolean;
}

/**
 * Whether `pr_merged` permits treating this branch as merged.
 *
 * SOURCED, NOT RUN, as `plot-pr-merged.sh`'s header requires, and as
 * `test/reconcile/host.test.mjs` sources it. THE EXIT CODE IS THE VERDICT —
 * never stdout's emptiness, which `pr_merged` does not write at all.
 */
const shellVerdict = (dir: string, one: Case): boolean => {
  const run = spawnSync('bash', ['-c', `source ${JSON.stringify(PR_MERGED_LIB)}\npr_merged ${JSON.stringify(one.branch)}`], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PATH: one.absent === true ? withoutGh : `${dir}:${process.env.PATH}` },
  });
  return run.status === 0;
};

/**
 * Whether the host adapter's `prMerged` permits treating this branch as merged.
 *
 * A FAILED RESULT, `not-merged` AND `unknown` ALL REFUSE, the way
 * `registryd-main.ts` maps them: only an `ok` result whose value is `merged`
 * permits.
 *
 * `PATH` IS SET ON `process.env` RATHER THAN THREADED THROUGH. `hostShell`
 * passes only `cwd` to `runProcess`, which merges its own `env` over
 * `process.env`, so the stub is put where the adapter's child will inherit it.
 */
const adapterVerdict = async (dir: string, one: Case): Promise<boolean> => {
  const restore = process.env.PATH;
  const host = process.env.PLOT_HOST;
  const budget = process.env.PLOT_BUDGET_OFF;
  process.env.PATH = one.absent === true ? withoutGh : `${dir}:${restore}`;
  process.env.PLOT_HOST = 'github';
  process.env.PLOT_BUDGET_OFF = '1';
  try {
    const answer = await hostShell(shellContext(ROOT)).prMerged(one.branch);
    return answer.ok && answer.value === 'merged';
  } finally {
    process.env.PATH = restore;
    if (host === undefined) delete process.env.PLOT_HOST;
    else process.env.PLOT_HOST = host;
    if (budget === undefined) delete process.env.PLOT_BUDGET_OFF;
    else process.env.PLOT_BUDGET_OFF = budget;
  }
};

let readings: Reading[] = [];

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-prmerged-corpus-'));
  withoutGh = pathWithoutGh(mkdtempSync(join(tmpdir(), 'plot-prmerged-nogh-')));
  readings = [];
  for (const [index, one] of CASES.entries()) {
    // ONE DIRECTORY PER SIDE, so the shell's call log cannot be confused with
    // the adapter's. The empty-branch assertion is about the SHELL's log.
    const shellDir = join(sandbox, `shell-${index}-${one.label}`);
    const adapterDir = join(sandbox, `adapter-${index}-${one.label}`);
    mkdirSync(shellDir);
    mkdirSync(adapterDir);
    const shellArgv = ghStub(shellDir, one);
    ghStub(adapterDir, one);
    const shell = shellVerdict(shellDir, one);
    const adapter = await adapterVerdict(adapterDir, one);
    readings.push({ one, shell, adapter, shellAskedGh: existsSync(shellArgv) });
  }
});

afterAll(() => {
  for (const dir of [sandbox, withoutGh]) if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

describe('pr_merged agrees with the host adapter prMerged', () => {
  it('holds at least the seven cases and exercises both verdicts, so this is not vacuous', () => {
    expect(readings.length).toBeGreaterThanOrEqual(7);
    expect([...new Set(readings.map((r) => r.shell))].sort()).toEqual([false, true]);
    expect([...new Set(readings.map((r) => r.adapter))].sort()).toEqual([false, true]);
  });

  it('answers what the shell answers, on every case', () => {
    const found: Disagreement[] = [];
    for (const { one, shell, adapter } of readings) {
      compareField(found, `subject=${JSON.stringify(one.branch)} (${one.label})`, 'may-treat-as-merged', adapter, shell);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('asks gh about no empty branch, on the shell side', () => {
    const empty = readings.find((r) => r.one.branch === '');
    expect(empty).toBeDefined();
    // THE ASSERTION A GUARD AFTER `command -v gh` FAILS. It passes the verdict
    // comparison above — a lookup that asks and then refuses answers the same
    // boolean — and fails here, because the stub appends its argv on every
    // invocation and the file exists if and only if `gh` ran.
    const log = join(sandbox, `shell-${CASES.findIndex((c) => c.branch === '')}-empty`, 'gh.argv');
    expect(empty?.shellAskedGh, existsSync(log) ? readFileSync(log, 'utf8') : '').toBe(false);
  });

  it('reads every PR for the branch rather than only the newest', () => {
    // THE `--limit 1` REGRESSION, named as a case rather than left to the
    // verdict sweep: the merge sits BEHIND a newer unmerged PR, and the stub
    // honours `--limit`, so a lookup asking for one row sees only the unmerged
    // one and answers *not merged* on both sides.
    const masked = readings.find((r) => r.one.label === 'newer-unmerged-in-front');
    expect(masked?.shell).toBe(true);
    expect(masked?.adapter).toBe(true);
  });
});
