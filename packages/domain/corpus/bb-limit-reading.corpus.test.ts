import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hostShell } from '../src/adapters/host/host-shell.js';
import { shellContext } from '../src/adapters/scripts.js';
import type { LimitReading } from '../src/entities/limit.js';
import { bbLimitReading } from '../src/rules/bb-ledger.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Does `plot-host.sh limit` on Bitbucket, read through `hostShell`, answer what
 * `bbLimitReading` answers over the same `bb rate-limit --json` output?
 *
 * A stub `bb` serves each recorded `rate-limit-*` case: its stdout and its exit
 * status. The adapter reads the shell's line with a clock fixed at the
 * recording's `now`. The rule reads the recorded JSON with no declared limit,
 * because this repository's `## Plot Config` declares no `Host rate limit`.
 *
 * `bb` 1.13.0 has no `rate-limit` command: it prints `unknown command` and
 * exits 1. That case, and an answer that is not the JSON, must read as the
 * line `plot-host.sh` printed before it asked `bb`.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const FIXTURES = new URL('./fixtures/bb-ledger/', import.meta.url);
const report = describingAs({ left: 'rule', right: 'shell' });

interface Recorded {
  readonly bb: string;
  readonly now: number;
  readonly cases: readonly { name: string; status: number; stdout: string; stderr?: string }[];
}

interface Served {
  readonly name: string;
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface RawFields {
  readonly requests: number | null;
  readonly ceiling: number | null;
  readonly paused_until: number | null;
  readonly wait_seconds: number;
}

const recorded = JSON.parse(readFileSync(new URL('bb-outputs.json', FIXTURES), 'utf8')) as Recorded;
const nowMs = recorded.now * 1000;
const READ = recorded.cases.filter((one) => one.name.startsWith('rate-limit-'));

/** The line `plot-host.sh` printed before it asked `bb rate-limit`. */
const TODAY: LimitReading = { connector: 'bitbucket', bucket: 'api', limit: 800, remaining: null, resetAt: null, basis: 'predicted' };

const UNREAD: readonly Served[] = [
  { name: 'bb-1.13.0-unknown-command', status: 1, stdout: '', stderr: 'error: unknown command "rate-limit" for "bb"' },
  { name: 'not-json', status: 0, stdout: 'rate limit: fine\n', stderr: '' },
  { name: 'json-without-wait', status: 0, stdout: '{"requests":2,"ceiling":800}\n', stderr: '' },
];

let sandbox = '';
const answers = new Map<string, readonly LimitReading[]>();

/** Writes a stub `bb` into `dir` that serves `one` for `rate-limit` and the recorded banner for `--version`. */
const bbStub = (dir: string, one: Served): void => {
  writeFileSync(join(dir, 'stdout'), one.stdout);
  writeFileSync(join(dir, 'stderr'), one.stderr);
  const body = [
    '#!/usr/bin/env bash',
    `[ "$1" = --version ] && { printf '%s\\n' ${JSON.stringify(recorded.bb)}; exit 0; }`,
    `[ "$1" = rate-limit ] && { cat ${JSON.stringify(join(dir, 'stdout'))}; cat ${JSON.stringify(join(dir, 'stderr'))} >&2; exit ${one.status}; }`,
    'echo "stub bb: only --version and rate-limit are served" >&2; exit 1',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'bb'), body);
  chmodSync(join(dir, 'bb'), 0o755);
};

/** The adapter's limit readings for one served case, with `bb` on `PATH` through `process.env`. */
const adapterReadings = async (dir: string): Promise<readonly LimitReading[]> => {
  const saved = { PATH: process.env.PATH, PLOT_HOST: process.env.PLOT_HOST, PLOT_BUDGET_OFF: process.env.PLOT_BUDGET_OFF };
  process.env.PATH = `${dir}:${saved.PATH}`;
  process.env.PLOT_HOST = 'bitbucket';
  process.env.PLOT_BUDGET_OFF = '1';
  try {
    const answer = await hostShell(shellContext(ROOT), undefined, () => nowMs).limit();
    if (!answer.ok) throw new Error(`limit did not answer for ${dir}: ${JSON.stringify(answer)}`);
    return answer.value;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const fieldsOf = (stdout: string): RawFields => JSON.parse(stdout) as RawFields;

beforeAll(async () => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'plot-bb-limit-corpus-')));
  const served: Served[] = [...READ.map((one) => ({ ...one, stderr: one.stderr ?? '' })), ...UNREAD];
  for (const [index, one] of served.entries()) {
    const dir = join(sandbox, `case-${index}`);
    mkdirSync(dir);
    bbStub(dir, one);
    answers.set(one.name, await adapterReadings(dir));
  }
}, 120_000);

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

const compareReading = (found: Disagreement[], subject: string, rule: LimitReading, shell: LimitReading | undefined): void => {
  for (const field of ['connector', 'bucket', 'limit', 'remaining', 'resetAt', 'basis'] as const) {
    compareField(found, subject, field, String(rule[field]), String(shell?.[field]));
  }
};

describe('plot-host.sh limit on Bitbucket agrees with bbLimitReading', () => {
  it('serves every recorded rate-limit case, so this is not vacuous', () => {
    expect(READ.map((one) => one.name)).toEqual([
      'rate-limit-idle',
      'rate-limit-ceiling',
      'rate-limit-paused',
      'rate-limit-paused-429',
      'rate-limit-unknown',
      'rate-limit-off',
    ]);
    expect(READ.some((one) => one.status === 75)).toBe(true);
  });

  it('answers what the rule answers over each recorded bb rate-limit --json', () => {
    const found: Disagreement[] = [];
    for (const one of READ) {
      const raw = fieldsOf(one.stdout);
      const rule = bbLimitReading(
        { requests: raw.requests, ceiling: raw.ceiling, pausedUntil: raw.paused_until, waitSeconds: raw.wait_seconds },
        null,
        nowMs,
        'bitbucket',
      );
      const shell = answers.get(one.name) ?? [];
      expect(shell).toHaveLength(1);
      compareReading(found, one.name, rule, shell[0]);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('reads a paused bb as no requests left until the pause ends', () => {
    const paused = answers.get('rate-limit-paused')?.[0];
    expect(paused?.remaining).toBe(0);
    expect(paused?.resetAt).toBe(1788000323 * 1000);
  });

  it('answers the line it printed before it asked bb, where bb gives no reading', () => {
    const found: Disagreement[] = [];
    for (const one of UNREAD) {
      const shell = answers.get(one.name) ?? [];
      expect(shell).toHaveLength(1);
      compareReading(found, one.name, TODAY, shell[0]);
    }
    expect(found.map(report)).toEqual([]);
  });
});
