import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { bbAccountKey } from '../src/adapters/host/bb-ledger-file.js';
import {
  type BbPause,
  bbBudgetCount,
  bbGuard,
  bbHourlyLimit,
  bbHourStamps,
  bbPauseAfter429,
  bbPauseLeft,
  bbPauseLine,
  bbPauseMerge,
  bbPauseParse,
  bbPauseIsStale,
  bbPauseTail,
  bbPrunes,
  bbShownWait,
  bbStatePath,
  bbUtcHms,
} from '../src/rules/bb-ledger.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Do the ledger rules answer what `bb` 1.15.2 answers?
 *
 * Reads the recordings `record-bb-ledger.mjs` took from the real `bb` and
 * needs no `bb` installed. The recorder runs once per `bb` version.
 */

const DIR = new URL('./fixtures/bb-ledger/', import.meta.url);
const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as T;
const report = describingAs({ left: 'rule', right: 'shell' });
const VERSION = 'bb 1.15.2 ';

interface Functions {
  readonly bb: string;
  readonly now: number;
  readonly hourStamps: readonly { second: number; output: string }[];
  readonly utcHms: readonly { second: number; output: string }[];
  readonly shownWait: readonly { seconds: number; output: number }[];
  readonly statePath: readonly { env: Record<string, string>; output: string | null }[];
  readonly accountKey: readonly { email: string; c: string; utf8: string }[];
  readonly hourlyLimit: readonly { value: string | null; status: number; stdout: string; stderr: string }[];
  readonly budgetCount: readonly { limit: number; prev: string; cur: string; now: number; output: string }[];
  readonly budgetCountMissing: string;
  readonly prune: { prev: string; names: readonly string[]; kept: readonly string[] };
  readonly pauseRead: readonly { text: string | null; output: string }[];
  readonly pauseIsStale: readonly { end: number; length: number; now: number; stale: boolean }[];
  readonly pauseAfter429: readonly { stored: string | null; retryAfter: string | null; now: number; tail: string; file: string | null }[];
  readonly pauseWrite: readonly { stored: string | null; end: number; length: number; now: number; file: string | null }[];
}

interface Outputs {
  readonly bb: string;
  readonly now: number;
  readonly email: string;
  readonly key: string;
  readonly cases: readonly {
    name: string;
    env: Record<string, string>;
    files: Record<string, string | null>;
    status: number;
    stdout: string;
    stderr: string;
  }[];
}

interface Interop {
  readonly bb: string;
  readonly now: number;
  readonly key: string;
  readonly shellKey: string;
  readonly written: Record<string, string>;
  readonly count: string;
  readonly pause: string;
}

const recorded = read<Functions>('functions.json');
const outputs = read<Outputs>('bb-outputs.json');
const interop = read<Interop>('interop.json');
const NOW = recorded.now;

const pauseWords = (pause: BbPause | null): string => (pause === null ? '' : `${pause.end} ${pause.length}`);
const caseNamed = (name: string) => {
  const one = outputs.cases.find((c) => c.name === name);
  if (one === undefined) throw new Error(`no recording named ${name}`);
  return one;
};

/** `bb rate-limit --json` composed from the rules over one recorded state. */
const rateLimitOf = (one: Outputs['cases'][number]): string => {
  const hourly = bbHourlyLimit(one.env.BB_HOURLY_LIMIT);
  if (!hourly.ok) throw new Error(hourly.said);
  const ceiling = hourly.limit > 0 ? hourly.limit : null;
  const { stamp, prev } = bbHourStamps(outputs.now);
  const fileOf = (name: string): string | null | undefined => one.files[name];
  const files = [fileOf(`requests-${outputs.key}-${prev}.log`), fileOf(`requests-${outputs.key}-${stamp}.log`)];
  const texts = files.some((text) => text === null) ? null : files.map((text) => text ?? '');
  const pause = bbPauseParse(fileOf(`pause-${outputs.key}`) ?? null);
  const left = bbPauseLeft(pause, outputs.now);
  const verdict = bbGuard({ now: outputs.now, ceiling, pause, texts, host: 'Bitbucket' });
  const requests = texts === null ? null : bbBudgetCount(outputs.now, ceiling, texts).requests;
  const wait = verdict.verdict === 'send' ? 0 : verdict.waitSeconds;
  const fields = {
    requests,
    ceiling,
    paused_until: left === null ? null : outputs.now + bbShownWait(left),
    wait_seconds: wait,
  };
  return JSON.stringify(fields);
};

describe("the ledger rules agree with the recorded bb's functions", () => {
  it('was recorded from bb 1.15.2 over a ceiling, a pause and a non-ASCII email, so this is not vacuous', () => {
    for (const bb of [recorded.bb, outputs.bb, interop.bb]) expect(bb.startsWith(VERSION)).toBe(true);
    expect(recorded.accountKey.some((one) => /[^\x00-\x7f]/.test(one.email))).toBe(true);
    expect(outputs.cases.map((one) => one.status)).toEqual(expect.arrayContaining([0, 75]));
    expect(recorded.pauseAfter429.some((one) => one.stored !== null)).toBe(true);
  });

  it('stamps the hour as bb_hour_stamps does, across a day', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.hourStamps) {
      const { stamp, prev } = bbHourStamps(one.second);
      compareField(found, String(one.second), 'stamps', `${stamp} ${prev}`, one.output);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('names the time of day as bb_utc_hms does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.utcHms) compareField(found, String(one.second), 'hms', bbUtcHms(one.second), one.output);
    expect(found.map(report)).toEqual([]);
  });

  it('shows a wait as bb_shown_wait does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.shownWait) compareField(found, String(one.seconds), 'shown', String(bbShownWait(one.seconds)), String(one.output));
    expect(found.map(report)).toEqual([]);
  });

  it('names the state directory as bb_state_path does, with empty variables', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.statePath) compareField(found, JSON.stringify(one.env), 'path', String(bbStatePath(one.env)), String(one.output));
    expect(found.map(report)).toEqual([]);
  });

  it('keys an account as bb_account_key does under LC_ALL=C', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.accountKey) compareField(found, one.email, 'key', bbAccountKey(one.email), one.c);
    expect(found.map(report)).toEqual([]);
  });

  it('keys an account as bb_account_key does under a UTF-8 locale, a non-ASCII capital included', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.accountKey) compareField(found, one.email, 'key', bbAccountKey(one.email), one.utf8);
    expect(recorded.accountKey.some((one) => one.email.toLowerCase() !== one.email.replace(/[A-Z]/g, (c) => c.toLowerCase()))).toBe(true);
    expect(found.map(report)).toEqual([]);
  });

  it('reads BB_HOURLY_LIMIT as bb_hourly_limit does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.hourlyLimit) {
      const rule = bbHourlyLimit(one.value ?? undefined);
      compareField(found, String(one.value), 'limit', rule.ok ? String(rule.limit) : rule.said, one.status === 0 ? one.stdout : one.stderr);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('counts the request files as bb_budget_count does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.budgetCount) {
      const count = bbBudgetCount(one.now, one.limit, [one.prev, one.cur]);
      compareField(found, `${one.limit}|${JSON.stringify(one.prev + one.cur)}`, 'count', `${count.requests} ${count.freeAt ?? 0}`, one.output);
    }
    const missing = bbBudgetCount(NOW, 800, ['', '']);
    compareField(found, 'missing files', 'count', `${missing.requests} ${missing.freeAt ?? 0}`, recorded.budgetCountMissing);
    expect(found.map(report)).toEqual([]);
  });

  it('prunes as bb_budget_prune does', () => {
    const found: Disagreement[] = [];
    const kept = recorded.prune.names.filter((name) => !bbPrunes(name, recorded.prune.prev)).sort();
    compareField(found, recorded.prune.prev, 'kept', JSON.stringify(kept), JSON.stringify(recorded.prune.kept));
    expect(found.map(report)).toEqual([]);
  });

  it('reads a pause file as bb_pause_read does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.pauseRead) compareField(found, JSON.stringify(one.text), 'pause', pauseWords(bbPauseParse(one.text)), one.output);
    expect(found.map(report)).toEqual([]);
  });

  it('calls a pause stale as bb_pause_is_stale does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.pauseIsStale) {
      compareField(found, `${one.end} ${one.length}`, 'stale', String(bbPauseIsStale(one, one.now)), String(one.stale));
    }
    expect(found.map(report)).toEqual([]);
  });

  it('writes the pause and its words after a 429 as bb_pause_after_429 does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.pauseAfter429) {
      const subject = `${JSON.stringify(one.stored)}|${one.retryAfter}`;
      const pause = bbPauseAfter429(bbPauseParse(one.stored), one.retryAfter, one.now);
      compareField(found, subject, 'file', bbPauseLine(pause), String(one.file));
      compareField(found, subject, 'tail', bbPauseTail(pause, one.retryAfter, one.now, 'Bitbucket'), one.tail);
    }
    expect(recorded.pauseAfter429.some((one) => one.tail.includes('asked to wait'))).toBe(true);
    expect(found.map(report)).toEqual([]);
  });

  it('merges with a stored pause as bb_pause_write does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.pauseWrite) {
      const pause = bbPauseMerge({ end: one.end, length: one.length }, bbPauseParse(one.stored), one.now);
      compareField(found, `${JSON.stringify(one.stored)}|${one.end} ${one.length}`, 'file', bbPauseLine(pause), String(one.file));
    }
    expect(found.map(report)).toEqual([]);
  });
});

describe('the ledger rules agree with the recorded bb commands', () => {
  it('answers bb rate-limit --json idle, at the ceiling, paused, unknown and off', () => {
    const found: Disagreement[] = [];
    for (const one of outputs.cases.filter((c) => c.name.startsWith('rate-limit-'))) {
      compareField(found, one.name, 'json', rateLimitOf(one), JSON.stringify(JSON.parse(one.stdout)));
    }
    expect(found.map(report)).toEqual([]);
  });

  it("refuses at the ceiling and during a pause in bb's words", () => {
    const found: Disagreement[] = [];
    for (const name of ['refused-ceiling', 'refused-paused']) {
      const one = caseNamed(name);
      const hourly = bbHourlyLimit(one.env.BB_HOURLY_LIMIT);
      const { stamp, prev } = bbHourStamps(outputs.now);
      const verdict = bbGuard({
        now: outputs.now,
        ceiling: hourly.ok && hourly.limit > 0 ? hourly.limit : null,
        pause: bbPauseParse(one.files[`pause-${outputs.key}`] ?? null),
        texts: [one.files[`requests-${outputs.key}-${prev}.log`] ?? '', one.files[`requests-${outputs.key}-${stamp}.log`] ?? ''],
        host: 'Bitbucket',
      });
      compareField(found, name, 'stderr', verdict.verdict === 'send' ? 'send' : `error: ${verdict.said}\n`, one.stderr);
    }
    expect(found.map(report)).toEqual([]);
  });

  it("names a 429 and a 429 on a later page in bb's words", () => {
    const found: Disagreement[] = [];
    const tail = (retryAfter: string | null) => bbPauseTail(bbPauseAfter429(null, retryAfter, outputs.now), retryAfter, outputs.now, 'Bitbucket');
    compareField(found, 'refused-429', 'stderr', `error: rate limited — ${tail('30')}\n`, caseNamed('refused-429').stderr);
    compareField(found, 'refused-429-later-page', 'stderr', `error: rate limited after 50 rows — ${tail(null)}\n`, caseNamed('refused-429-later-page').stderr);
    expect(found.map(report)).toEqual([]);
  });
});

describe('bb reads the files the TS adapter writes', () => {
  it('names the same account key and counts and reads what the adapter wrote', () => {
    const found: Disagreement[] = [];
    compareField(found, 'key', 'key', interop.key, interop.shellKey);
    const { stamp, prev } = bbHourStamps(interop.now);
    const count = bbBudgetCount(interop.now, 3, [interop.written[`requests-<key>-${prev}.log`] ?? '', interop.written[`requests-<key>-${stamp}.log`] ?? '']);
    compareField(found, 'requests', 'count', `${count.requests} ${count.freeAt ?? 0}`, interop.count);
    compareField(found, 'pause', 'pause', pauseWords(bbPauseParse(interop.written['pause-<key>'] ?? null)), interop.pause);
    expect(count.requests).toBe(3);
    expect(found.map(report)).toEqual([]);
  });
});
