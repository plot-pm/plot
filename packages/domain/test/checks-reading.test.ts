import { describe, it, expect } from 'vitest';
import {
  CHECKS_UNASKABLE_NOTE,
  checksProminence,
  checksShown,
  checksUnaskable,
  checksUnaskableNote,
  checksVerdict,
  ciDisplayName,
  type Checks,
  type ChecksReadings,
} from '../src/index.js';

/**
 * The checks reading — asserted with NO BROWSER, NO BOARD SERVER, NO SHELL.
 *
 * Every case here is a plain record. That is the whole point of taking readings
 * as values: the badge's word, its prominence and its sentence are decided in a
 * rule, so proving them costs a function call rather than a rendered page.
 *
 * The measurement behind it, 2026-09-07: `ChecksSchema` has carried `unknown`
 * since it was written, the host script produces it and `fleet.ts` holds it —
 * and `CardPrSchema` carried `number` and `url` alone, so a PR with no CI and a
 * PR whose CI could not be reached rendered identically on every plan card.
 */

const reading = (over: Partial<ChecksReadings> = {}): ChecksReadings => ({
  checks: 'green',
  mergeable: 'mergeable',
  ...over,
});

const ALL_STATES: readonly Checks[] = ['green', 'pending', 'failing', 'none', 'unknown'];

describe('checksProminence', () => {
  it('is quiet for green', () => {
    expect(checksProminence(reading({ checks: 'green' }))).toBe('quiet');
  });

  it('warns for failing, whatever the branch merges like', () => {
    expect(checksProminence(reading({ checks: 'failing' }))).toBe('warn');
    expect(checksProminence(reading({ checks: 'failing', mergeable: 'conflicting' }))).toBe('warn');
    expect(checksProminence(reading({ checks: 'failing', mergeable: 'unknown' }))).toBe('warn');
  });

  it('notes pending — a machine is working, which is not a finding', () => {
    expect(checksProminence(reading({ checks: 'pending' }))).toBe('note');
  });

  it('notes unknown, and never warns about it', () => {
    // THE RULE THIS FILE EXISTS FOR. The board's own inability to ask is not a
    // fact about the build, so it must not be an alarm — the same asymmetry
    // `supervisorProminence` applies to `unknown` beside `down`.
    expect(checksProminence(reading({ checks: 'unknown' }))).toBe('note');
    expect(checksProminence(reading({ checks: 'unknown', mergeable: 'conflicting' }))).toBe('note');
    expect(checksProminence(reading({ checks: 'unknown', mergeable: 'unknown' }))).toBe('note');
  });

  it('reads the mergeability beside none, and only beside none', () => {
    // An empty rollup on a clean branch is a fact about the repository. The
    // same empty rollup on a conflicting branch is a symptom of a fault, and a
    // reader shown `no checks` there learns the symptom and not the cause.
    expect(checksProminence(reading({ checks: 'none', mergeable: 'mergeable' }))).toBe('quiet');
    expect(checksProminence(reading({ checks: 'none', mergeable: 'unknown' }))).toBe('quiet');
    expect(checksProminence(reading({ checks: 'none', mergeable: 'conflicting' }))).toBe('warn');
  });
});

describe('checksShown', () => {
  it('is silent only when the news is good', () => {
    expect(checksShown(reading({ checks: 'green' }))).toBe(false);
    for (const checks of ALL_STATES.filter((state) => state !== 'green')) {
      expect(checksShown(reading({ checks }))).toBe(true);
    }
  });

  it('shows none even though it is quiet', () => {
    // THE PLAN'S CENTRAL RULE, and the one a prominence-only reading would
    // lose: `none` carries no colour and must still be VISIBLE, because two
    // states a reader cannot tell apart are one state whatever the wire holds.
    const none = reading({ checks: 'none' });
    expect(checksProminence(none)).toBe('quiet');
    expect(checksShown(none)).toBe(true);
  });
});

describe('checksVerdict', () => {
  it('answers every state, and answers each one differently', () => {
    // A comparison that can only pass proves nothing: if two states rendered
    // the same label, the field would be carried and the defect would remain.
    const labels = ALL_STATES.map((checks) => checksVerdict(reading({ checks })).label);
    expect(new Set(labels).size).toBe(ALL_STATES.length);
  });

  it('gives none and unknown different labels and different sentences', () => {
    // THE WHOLE PLAN, in one assertion. `none` is a fact about the repository;
    // `unknown` is a question about the board's own reach.
    const none = checksVerdict(reading({ checks: 'none' }));
    const unknown = checksVerdict(reading({ checks: 'unknown' }));
    expect(none.label).not.toBe(unknown.label);
    expect(none.detail).not.toBe(unknown.detail);
    expect(none.state).toBe('none');
    expect(unknown.state).toBe('unknown');
  });

  it('names the board rather than the build when it could not ask', () => {
    // *Could not be asked* is a fact about this reading. Phrasing it as a fact
    // about the pull request is exactly the confusion the fifth state prevents,
    // so the sentence says which, and says the two are not the same fact.
    const verdict = checksVerdict(reading({ checks: 'unknown' }));
    expect(verdict.label).toBe('checks not asked');
    expect(verdict.detail).toContain('The board could not');
    expect(verdict.detail).toContain('not the same fact');
  });

  it('names the conflict as the cause when none rides on a conflicting branch', () => {
    const clean = checksVerdict(reading({ checks: 'none', mergeable: 'mergeable' }));
    const conflicting = checksVerdict(reading({ checks: 'none', mergeable: 'conflicting' }));
    expect(clean.label).toBe('no checks');
    expect(clean.prominence).toBe('quiet');
    expect(conflicting.label).toBe('no checks — conflicts');
    expect(conflicting.prominence).toBe('warn');
    expect(conflicting.detail).toContain('does not merge cleanly');
  });

  it('reports green, failing and pending with their own words', () => {
    expect(checksVerdict(reading({ checks: 'green' }))).toMatchObject({
      state: 'green', prominence: 'quiet', shown: false, label: 'checks green',
    });
    expect(checksVerdict(reading({ checks: 'failing' }))).toMatchObject({
      state: 'failing', prominence: 'warn', shown: true, label: 'checks failing',
    });
    expect(checksVerdict(reading({ checks: 'pending' }))).toMatchObject({
      state: 'pending', prominence: 'note', shown: true, label: 'checks running',
    });
  });

  it('agrees with the three rules it is assembled from, on every state', () => {
    // ONE CALL RATHER THAN THREE is only safe if the one cannot disagree with
    // the three — the pairing a `.tsx` would otherwise re-derive.
    for (const checks of ALL_STATES) {
      for (const mergeable of ['mergeable', 'conflicting', 'unknown'] as const) {
        const readings = reading({ checks, mergeable });
        const verdict = checksVerdict(readings);
        expect(verdict.state).toBe(checks);
        expect(verdict.prominence).toBe(checksProminence(readings));
        expect(verdict.shown).toBe(checksShown(readings));
        expect(verdict.label.length).toBeGreaterThan(0);
        expect(verdict.detail.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('checksUnaskable', () => {
  it('is true only when there are readings and every one is unknown', () => {
    expect(checksUnaskable([reading({ checks: 'unknown' }), reading({ checks: 'unknown' })])).toBe(true);
  });

  it('is false on an empty set — a board that has not fetched is not a refusal', () => {
    // THE VACUOUS CASE, and it is the one that matters. `every` over nothing is
    // true, so a rule without the length guard would put a connector warning on
    // a board that has simply not asked yet.
    expect(checksUnaskable([])).toBe(false);
  });

  it('is false when any reading is an answer', () => {
    for (const answered of ALL_STATES.filter((state) => state !== 'unknown')) {
      expect(checksUnaskable([reading({ checks: 'unknown' }), reading({ checks: answered })])).toBe(false);
    }
  });

  it('carries a sentence about the connector rather than about the work', () => {
    expect(CHECKS_UNASKABLE_NOTE).toContain('host cannot report');
    expect(CHECKS_UNASKABLE_NOTE).toContain('not about the work');
  });
});

describe('the board names which CI answered', () => {
  it('gives a CI system the name a person uses, not the config key', () => {
    // `github-actions` is a key's VALUE. A board printing it makes its reader
    // translate, which the goal — *sees build status without being told which
    // keys to set* — rules out.
    expect(ciDisplayName('github-actions')).toBe('GitHub Actions');
    expect(ciDisplayName('jenkins')).toBe('Jenkins');
  });

  it('reads a declared system however the config spells it', () => {
    expect(ciDisplayName('  Jenkins  ')).toBe('Jenkins');
    expect(ciDisplayName('GitHub-Actions')).toBe('GitHub Actions');
  });

  it('returns an unknown system as itself rather than a placeholder', () => {
    // A repository may declare a CI Plot has no connector for. Printing the
    // word back is honest; `unknown` would hide which system was asked.
    expect(ciDisplayName('gitlab-ci')).toBe('gitlab-ci');
  });

  it('names nothing where nothing was declared', () => {
    expect(ciDisplayName('')).toBe('');
    expect(ciDisplayName('   ')).toBe('');
  });

  it('names the system in the sentence the board shows once', () => {
    // THE WHOLE POINT: an empty check column must not read as *no CI*.
    expect(checksUnaskableNote('jenkins')).toContain('Jenkins reported no check state');
    expect(checksUnaskableNote('github-actions')).toContain(
      'GitHub Actions reported no check state',
    );
  });

  it('keeps the sentence about the connector, not about the work', () => {
    // The distinction `CHECKS_UNASKABLE_NOTE` was written to protect survives
    // the rename: a reader must not read an unreachable connector as failing
    // pull requests.
    expect(checksUnaskableNote('jenkins')).toContain('not about the work');
  });

  it('falls back to the unnamed sentence where no CI was read', () => {
    // A board that never read the `CI` key knows LESS than one that did, and
    // naming a system it does not have would be worse than naming none.
    expect(checksUnaskableNote('')).toBe(CHECKS_UNASKABLE_NOTE);
  });
});

