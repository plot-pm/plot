import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QUESTION_ESCALATION,
  parseQuestionEscalation,
  questionEscalation,
  type QuestionReading,
} from '../src/rules/question-escalation.js';

/**
 * `questionEscalation` — the registry tick's once-per-age notification rule.
 *
 * Fixes the failure measured 2026-10-05: a question asked at 13:36 sat
 * unanswered until 18:20 with `person=0` on every tick, because nothing read a
 * question's age or notified anyone. This rule is what the tick now calls,
 * per desk, after `supervise` — for every verdict including `leave`.
 */

const AGES = [900_000, 3_600_000, 14_400_000]; // 15m, 1h, 4h

const reading = (over: Partial<QuestionReading> = {}): QuestionReading => ({
  marker: { askedAt: '2026-10-05T13:36:00.000Z' },
  ageMs: 0,
  ages: AGES,
  recordedRungs: new Set(),
  ...over,
});

describe('questionEscalation', () => {
  it('answers no rung at all where the desk holds no marker', () => {
    expect(questionEscalation(reading({ marker: null, ageMs: 999_999_999 }))).toEqual({
      rung: null,
      isNew: false,
    });
  });

  it('is a `notify` write at the first age for a live free loop with a marker — the 2026-10-05 case', () => {
    // A LIVE LOOP IS NOT IN THE READING AT ALL. The rule reads only the marker
    // and its age, so a call placed inside the `needs-a-person` arm (which
    // never ran for this desk) would never see this case.
    const result = questionEscalation(reading({ ageMs: 901_000 }));
    expect(result.rung).toBe('notified-1');
    expect(result.isNew).toBe(true);
  });

  it('answers `listed` below the first age, and `listed` is never new', () => {
    const result = questionEscalation(reading({ ageMs: 500_000 }));
    expect(result).toEqual({ rung: 'listed', isNew: false });
  });

  it('is not new once the rung is already recorded — the once-per-age rule', () => {
    // THE SAME TICK INPUT, WITH THE RUNG RECORDED, PRODUCES NO WRITE. An
    // implementation that notifies whenever age >= threshold would send a
    // message every minute; this is the test that catches it.
    const result = questionEscalation(
      reading({ ageMs: 901_000, recordedRungs: new Set(['notified-1']) }),
    );
    expect(result).toEqual({ rung: 'notified-1', isNew: false });
  });

  it('reports the highest rung and sends one message when a tick crosses two ages at once', () => {
    // A DESK FIRST SEEN AT AGE 70m WITH AGES 15m, 1h, 4h GETS notified-2, NOT
    // TWO NOTIFICATIONS. The tick never stepped through notified-1 on the way.
    const result = questionEscalation(reading({ ageMs: 70 * 60_000 }));
    expect(result).toEqual({ rung: 'notified-2', isNew: true });
  });

  it('reaches the highest rung at the oldest age', () => {
    const result = questionEscalation(reading({ ageMs: 5 * 3_600_000 }));
    expect(result).toEqual({ rung: 'notified-3', isNew: true });
  });

  it('is strictly greater than the threshold — exact age has not yet reached the rung', () => {
    // MUTATION: threshold `>` changed to `>=` must fail here. At the EXACT
    // configured age the rung is not yet reached; the next tick, a minute
    // later, is what crosses it.
    const result = questionEscalation(reading({ ageMs: 900_000 }));
    expect(result).toEqual({ rung: 'listed', isNew: false });
  });

  it('starts again at `listed` for a new modification time, regardless of the old marker\'s recorded rungs', () => {
    // THE OLD MARKER'S RUNGS MUST NOT SUPPRESS THE NEW ONE'S. The caller keys
    // `recordedRungs` on desk path AND modification time — this asserts the
    // rule's own behaviour once handed an empty set for the new marker.
    const result = questionEscalation(reading({ ageMs: 0, recordedRungs: new Set() }));
    expect(result).toEqual({ rung: 'listed', isNew: false });
  });

  it('gives `listed` only for an empty `Question escalation`', () => {
    const result = questionEscalation(reading({ ageMs: 999_999_999, ages: [] }));
    expect(result).toEqual({ rung: 'listed', isNew: false });
  });

  it('never throws and never notifies at age 0 with no configured ages', () => {
    expect(() => questionEscalation(reading({ ageMs: 0, ages: [] }))).not.toThrow();
    expect(questionEscalation(reading({ ageMs: 0, ages: [] })).isNew).toBe(false);
  });

  it('the recorded-rung lookup is not simply `false` — a recorded rung changes the answer', () => {
    // MUTATION: the recorded-rung lookup replaced by `false` must fail here.
    const withoutRecord = questionEscalation(reading({ ageMs: 901_000 }));
    const withRecord = questionEscalation(
      reading({ ageMs: 901_000, recordedRungs: new Set(['notified-1']) }),
    );
    expect(withoutRecord.isNew).toBe(true);
    expect(withRecord.isNew).toBe(false);
  });
});

describe('parseQuestionEscalation', () => {
  it('parses the default into three ascending ages', () => {
    expect(parseQuestionEscalation(DEFAULT_QUESTION_ESCALATION)).toEqual(AGES);
  });

  it('parses an empty value into no ages — disabling notification', () => {
    expect(parseQuestionEscalation('')).toEqual([]);
    expect(parseQuestionEscalation('   ')).toEqual([]);
  });

  it('parses `none`, in any case, into no ages — disabling notification', () => {
    expect(parseQuestionEscalation('none')).toEqual([]);
    expect(parseQuestionEscalation(' None ')).toEqual([]);
  });

  it('falls back to the default for a malformed list', () => {
    expect(parseQuestionEscalation('15m, soon')).toEqual(AGES);
  });

  it('never throws', () => {
    expect(() => parseQuestionEscalation('not a duration at all')).not.toThrow();
    expect(() => parseQuestionEscalation(',,,')).not.toThrow();
  });

  it('sorts ages ascending regardless of input order', () => {
    expect(parseQuestionEscalation('1h, 15m, 4h')).toEqual(AGES);
  });

  it('parses seconds, minutes, hours and days', () => {
    expect(parseQuestionEscalation('30s')).toEqual([30_000]);
    expect(parseQuestionEscalation('2d')).toEqual([172_800_000]);
  });
});
