import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { checkWord, checksOf, ciChecksOf, type RollupItem } from '../src/rules/checks-of.js';
import { mergeableOf, type MergeableFields } from '../src/rules/mergeable-of.js';
import { readListingFixtures } from '../test/fixtures/github-replay.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Do `rules/checks-of.ts` and `rules/mergeable-of.ts` answer what
 * `plot-host.sh`'s jq programs `CHECKS_OF` and `MERGEABLE_OF` answer?
 *
 * The test reads both programs out of `plot-host.sh` and runs them with `jq`
 * over the same inputs as the TypeScript rules: every rollup `gh` exported in
 * the recorded listing fixtures, every single item over the status,
 * conclusion and state words, and every pair of those items. Mergeability
 * runs over every combination of the three fields' recorded values.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = readFileSync(join(ROOT, 'skills/plot/scripts/plot-host.sh'), 'utf8');
const report = describingAs({ left: 'rule', right: 'shell' });

/** One single-quoted jq program assigned at the start of a line in `plot-host.sh`. */
const program = (name: string): string => {
  const match = new RegExp(`^${name}='([^']*)'`, 'm').exec(HOST);
  if (match === null) throw new Error(`plot-host.sh assigns no ${name}`);
  return match[1];
};

const STATUSES = ['', 'COMPLETED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'PENDING'];
const CONCLUSIONS = ['', 'SUCCESS', 'NEUTRAL', 'SKIPPED', 'FAILURE', 'ACTION_REQUIRED', 'CANCELLED', 'TIMED_OUT', 'STALE', 'STARTUP_FAILURE'];
const STATES = ['SUCCESS', 'PENDING', 'EXPECTED', 'FAILURE', 'ERROR'];
const NAMES = ['build', 'plot/review'];

const singles: RollupItem[] = [
  ...STATUSES.flatMap((status) => CONCLUSIONS.flatMap((conclusion) => NAMES.map((name) => ({ __typename: 'CheckRun', name, status, conclusion })))),
  ...STATES.flatMap((state) => NAMES.map((context) => ({ __typename: 'StatusContext', context, state, startedAt: '2026-10-02T11:00:00Z' }))),
  { name: 'bare' },
  { context: 'bare' },
  {},
];

/** Every rollup the cases cover: none, the recorded ones, every single item, and every pair. */
const rollups = (): (RollupItem[] | null)[] => {
  const recorded = readListingFixtures().flatMap((f) =>
    f.calls.flatMap((call) => (JSON.parse(call.stdout) as { statusCheckRollup?: RollupItem[] | null }[]).map((pr) => pr.statusCheckRollup ?? null)),
  );
  const pairs = singles.flatMap((a, i) => singles.slice(i).map((b) => [a, b]));
  return [null, [], ...recorded, ...singles.map((one) => [one]), ...pairs];
};

const MERGEABLE_VALUES: unknown[] = ['MERGEABLE', 'CONFLICTING', 'UNKNOWN', true, false, null, undefined];
const STATE_STATUS: unknown[] = ['CLEAN', 'DIRTY', 'BLOCKED', 'BEHIND', 'UNKNOWN', '', undefined];
const REST_STATE: unknown[] = ['clean', 'dirty', 'unknown', undefined];

const mergeables = (): MergeableFields[] =>
  MERGEABLE_VALUES.flatMap((mergeable) =>
    STATE_STATUS.flatMap((mergeStateStatus) =>
      REST_STATE.map((mergeable_state) => JSON.parse(JSON.stringify({ mergeable, mergeStateStatus, mergeable_state })) as MergeableFields),
    ),
  );

/** Runs `jq` with the shell's definitions over one JSON input. */
const jq = (filter: string, input: unknown): unknown => {
  const run = spawnSync('jq', ['-c', `${program('CHECKS_OF')}${program('MERGEABLE_OF')}${filter}`], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`jq exited ${run.status}: ${run.stderr}`);
  return JSON.parse(run.stdout);
};

let cases: (RollupItem[] | null)[] = [];
let shellRollups: { checks: string; ciChecks: string; words: string[] }[] = [];
let fields: MergeableFields[] = [];
let shellMergeable: string[] = [];

beforeAll(() => {
  cases = rollups();
  shellRollups = jq('[.[] | {statusCheckRollup: .} | {checks: checks_of, ciChecks: ci_checks_of, words: [.statusCheckRollup[]? | ck]}]', cases) as typeof shellRollups;
  fields = mergeables();
  shellMergeable = jq('[.[] | mergeable_of]', fields) as string[];
});

describe('checks-of and mergeable-of agree with plot-host.sh CHECKS_OF and MERGEABLE_OF', () => {
  it('covers the recorded rollups and every word, so this is not vacuous', () => {
    expect(cases.length).toBeGreaterThan(10_000);
    expect(new Set(shellRollups.map((r) => r.checks))).toEqual(new Set(['green', 'pending', 'failing', 'none']));
    expect(new Set(shellRollups.flatMap((r) => r.words))).toEqual(new Set(['ok', 'wait', 'bad']));
    expect(new Set(shellMergeable)).toEqual(new Set(['conflicting', 'mergeable', 'unknown']));
  });

  it('folds every rollup to the same checks, ciChecks and item words', () => {
    const found: Disagreement[] = [];
    cases.forEach((rollup, i) => {
      const subject = `rollup=${JSON.stringify(rollup)}`;
      const shell = shellRollups[i];
      compareField(found, subject, 'checks', checksOf(rollup), shell.checks);
      compareField(found, subject, 'ciChecks', ciChecksOf(rollup), shell.ciChecks);
      compareField(found, subject, 'ck', (rollup ?? []).map(checkWord), shell.words);
    });
    expect(found.map(report)).toEqual([]);
  });

  it('reads every mergeability combination to the same word', () => {
    const found: Disagreement[] = [];
    fields.forEach((one, i) => compareField(found, `pr=${JSON.stringify(one)}`, 'mergeable', mergeableOf(one), shellMergeable[i]));
    expect(found.map(report)).toEqual([]);
  });
});
