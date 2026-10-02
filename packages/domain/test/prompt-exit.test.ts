import { describe, it, expect } from 'vitest';
import { promptExit, type LimitPatterns, type PromptExitInput } from '../src/rules/prompt-exit.js';
import { HARNESS_LIMIT_LINES } from '../src/adapters/harness/limit-lines.js';

/**
 * What one prompt exit was.
 *
 * **The case that matters is the FALSE POSITIVE, not the match.** A rule that
 * reads every limit-shaped line as a limit passes every `wait` test here and
 * holds a finished agent for 24 h the first time a slice's own output quotes
 * the #1141 line — which plans, panel files and fixtures on this estate do
 * verbatim. So the test separating a working rule from a harmful one is *a
 * status-0 run that quotes the line earlier answers `ran`*.
 *
 * Every instant below is computed rather than typed: `Europe/Zurich` is UTC+2
 * on 2026-10-01, so 16:00 local is 14:00Z.
 */

/** 2026-10-01 16:00 in Europe/Zurich. */
const NOW = 1790863200;
/** The same day at 17:20 local — the #1141 reset, 4800 s ahead of NOW. */
const RESET_SAME_DAY = 1790868000;
/** 2026-10-01 23:30 local, so a 1:20am reset crosses into the next day. */
const NOW_LATE = 1790890200;
/** 2026-10-02 01:20 local, 6600 s after NOW_LATE. */
const RESET_NEXT_DAY = 1790896800;

/** The line #1141 reported, verbatim. */
const LIMIT_LINE = "You've hit your session limit · resets 5:20pm (Europe/Zurich)";

const claude: LimitPatterns = HARNESS_LIMIT_LINES.claude;

/** An exit that met a limit for the first time: no wait preceded it. */
const exit = (over: Partial<PromptExitInput> = {}): PromptExitInput => ({
  status: 1,
  output: LIMIT_LINE,
  now: NOW,
  boundSeconds: 28800,
  ranSeconds: 3,
  afterWait: false,
  commitsSinceWait: 0,
  ...over,
});

describe('promptExit', () => {
  describe('the exit #1141 reported', () => {
    it('answers wait with the reset as epoch and ISO', () => {
      const answer = promptExit(exit(), claude);

      expect(answer).toEqual({
        answer: 'wait',
        reset: { epoch: RESET_SAME_DAY, iso: '2026-10-01T15:20:00.000Z' },
        line: LIMIT_LINE,
      });
    });

    it('resolves a reset that falls on the next local day', () => {
      // 23:30 local, limit resets 1:20am — tomorrow in Zurich, and the rule
      // resolves it on the date of NOW, so the hour alone would read as past.
      const answer = promptExit(
        exit({
          now: NOW_LATE,
          output: "You've hit your session limit · resets 1:20am (Europe/Zurich)",
        }),
        claude,
      );

      expect(answer.answer).toBe('wait');
      if (answer.answer !== 'wait') return;
      expect(answer.reset.epoch).toBe(RESET_NEXT_DAY);
      expect(answer.reset.iso).toBe('2026-10-01T23:20:00.000Z');
      expect(answer.reset.epoch - NOW_LATE).toBe(6600);
    });

    it('finds the limit line among the surrounding output', () => {
      const answer = promptExit(
        exit({ output: ['starting', 'some work', LIMIT_LINE, 'exiting'].join('\n') }),
        claude,
      );

      expect(answer.answer).toBe('wait');
    });
  });

  describe('a reset already past', () => {
    it('resolves a reset 60 s past to now, so the loop sleeps the margin only', () => {
      // 16:00:00 local with a reset at 15:59:00 — read a minute late, not a day
      // early.
      const answer = promptExit(
        exit({
          now: RESET_SAME_DAY + 60,
          output: LIMIT_LINE,
        }),
        claude,
      );

      expect(answer.answer).toBe('wait');
      if (answer.answer !== 'wait') return;
      expect(answer.reset.epoch).toBe(RESET_SAME_DAY + 60);
    });

    it('resolves a reset 200 s past to the next day', () => {
      const now = RESET_SAME_DAY + 200;
      const answer = promptExit(exit({ now, boundSeconds: 0 }), claude);

      expect(answer.answer).toBe('wait');
      if (answer.answer !== 'wait') return;
      expect(answer.reset.epoch).toBe(RESET_SAME_DAY + 86400);
    });

    it('resolves a reset exactly at now without moving it', () => {
      const answer = promptExit(exit({ now: RESET_SAME_DAY }), claude);

      expect(answer.answer).toBe('wait');
      if (answer.answer !== 'wait') return;
      expect(answer.reset.epoch).toBe(RESET_SAME_DAY);
    });
  });

  describe('a limit whose reset cannot be read', () => {
    it('answers end-limited with no-reset for a line carrying no reset', () => {
      const answer = promptExit(exit({ output: "You've hit your session limit" }), claude);

      expect(answer).toEqual({
        answer: 'end-limited',
        line: "You've hit your session limit",
        cause: 'no-reset',
      });
    });

    it('answers no-reset for a separator carrying unreadable text', () => {
      const line = "You've hit your session limit · resets later today";
      const answer = promptExit(exit({ output: line }), claude);

      expect(answer).toEqual({ answer: 'end-limited', line, cause: 'no-reset' });
    });

    it('answers no-reset for a zone Intl does not know', () => {
      const line = "You've hit your session limit · resets 5:20pm (Nowhere/Atlantis)";
      const answer = promptExit(exit({ output: line }), claude);

      expect(answer).toEqual({ answer: 'end-limited', line, cause: 'no-reset' });
    });

    it('answers no-reset for a wall-clock hour outside a 12-hour clock', () => {
      const line = "You've hit your session limit · resets 19:20pm (Europe/Zurich)";
      const answer = promptExit(exit({ output: line }), claude);

      expect(answer).toEqual({ answer: 'end-limited', line, cause: 'no-reset' });
    });

    it('answers no-reset for a minute outside the hour', () => {
      const line = "You've hit your session limit · resets 5:75pm (Europe/Zurich)";
      const answer = promptExit(exit({ output: line }), claude);

      expect(answer).toEqual({ answer: 'end-limited', line, cause: 'no-reset' });
    });

    it('answers no-reset for a line with no zone at all', () => {
      const line = "You've hit your session limit · resets 5:20pm";
      const answer = promptExit(exit({ output: line }), claude);

      expect(answer).toEqual({ answer: 'end-limited', line, cause: 'no-reset' });
    });
  });

  describe('the reset times the harness writes', () => {
    it('reads an hour with no minutes', () => {
      const answer = promptExit(
        exit({ output: "You've hit your weekly limit · resets 6pm (Europe/Zurich)" }),
        claude,
      );

      expect(answer.answer).toBe('wait');
      if (answer.answer !== 'wait') return;
      expect(answer.reset.iso).toBe('2026-10-01T16:00:00.000Z');
    });

    it('reads 12am as midnight at the start of the local day', () => {
      // 16:00 local, so midnight today is past and resolves to the next day.
      const answer = promptExit(
        exit({
          output: "You've hit your session limit · resets 12am (Europe/Zurich)",
          boundSeconds: 0,
        }),
        claude,
      );

      expect(answer.answer).toBe('wait');
      if (answer.answer !== 'wait') return;
      // Midnight Oct 1 local is 22:00Z Sep 30; a day on gives 22:00Z Oct 1.
      expect(answer.reset.iso).toBe('2026-10-01T22:00:00.000Z');
    });

    it('reads 12pm as local noon', () => {
      const answer = promptExit(
        exit({
          output: "You've hit your session limit · resets 12pm (Europe/Zurich)",
          boundSeconds: 0,
        }),
        claude,
      );

      expect(answer.answer).toBe('wait');
      if (answer.answer !== 'wait') return;
      // Noon Oct 1 local is 10:00Z, past 14:00Z, so a day on.
      expect(answer.reset.iso).toBe('2026-10-02T10:00:00.000Z');
    });

    it('reads a zone whose name carries an underscore', () => {
      const answer = promptExit(
        exit({ output: "You've hit your session limit · resets 11:20am (America/New_York)" }),
        claude,
      );

      expect(answer.answer).toBe('wait');
      if (answer.answer !== 'wait') return;
      // 11:20 EDT (UTC-4) is 15:20Z, the same instant as the #1141 line.
      expect(answer.reset.epoch).toBe(RESET_SAME_DAY);
    });

    it('resolves a wall clock the zone skipped to the hour it skipped into', () => {
      // Zurich jumps 02:00 to 03:00 on 2026-03-29, so 02:30 that morning is a
      // time that never happens and the offset correction oscillates. Measured
      // over every minute of both 2026 transition days, 60 of 2880 readings
      // never converge; the two-pass cap lands them an hour on.
      const nowBefore = Math.floor(Date.UTC(2026, 2, 29, 0, 10, 0) / 1000);
      const answer = promptExit(
        exit({
          now: nowBefore,
          output: "You've hit your session limit · resets 2:30am (Europe/Zurich)",
        }),
        claude,
      );

      expect(answer.answer).toBe('wait');
      if (answer.answer !== 'wait') return;
      // 03:30 local on the far side of the jump, which is 01:30Z.
      expect(answer.reset.iso).toBe('2026-03-29T01:30:00.000Z');
    });

    it('resolves across a zone offset change rather than assuming one offset', () => {
      // Zurich leaves summer time on 2026-10-25 at 03:00 local. A reset stated
      // at 05:20 that morning is CET (UTC+1), not CEST.
      const nowOnTheDay = Math.floor(Date.UTC(2026, 9, 25, 2, 0, 0) / 1000);
      const answer = promptExit(
        exit({
          now: nowOnTheDay,
          output: "You've hit your session limit · resets 5:20am (Europe/Zurich)",
        }),
        claude,
      );

      expect(answer.answer).toBe('wait');
      if (answer.answer !== 'wait') return;
      expect(answer.reset.iso).toBe('2026-10-25T04:20:00.000Z');
    });
  });

  describe('whether the wait is allowed', () => {
    it('answers end-limited with past-bound for a reset beyond the bound', () => {
      const answer = promptExit(exit({ boundSeconds: 1800 }), claude);

      expect(answer).toEqual({
        answer: 'end-limited',
        reset: { epoch: RESET_SAME_DAY, iso: '2026-10-01T15:20:00.000Z' },
        line: LIMIT_LINE,
        cause: 'past-bound',
      });
    });

    it('allows a reset exactly at the bound', () => {
      expect(promptExit(exit({ boundSeconds: 4800 }), claude).answer).toBe('wait');
    });

    it('allows any known reset when the bound is 0', () => {
      expect(promptExit(exit({ boundSeconds: 0 }), claude).answer).toBe('wait');
    });
  });

  describe('a limit that returned without progress', () => {
    it('ends the worker when a resumed prompt met the limit again with no commit', () => {
      const answer = promptExit(
        exit({ afterWait: true, ranSeconds: 12, commitsSinceWait: 0 }),
        claude,
      );

      expect(answer).toEqual({
        answer: 'end-limited',
        reset: { epoch: RESET_SAME_DAY, iso: '2026-10-01T15:20:00.000Z' },
        line: LIMIT_LINE,
        cause: 'no-progress',
      });
    });

    it('waits again when the resumed prompt committed', () => {
      expect(
        promptExit(exit({ afterWait: true, ranSeconds: 12, commitsSinceWait: 1 }), claude).answer,
      ).toBe('wait');
    });

    it('waits again when the resumed prompt ran past the window', () => {
      expect(
        promptExit(exit({ afterWait: true, ranSeconds: 600, commitsSinceWait: 0 }), claude).answer,
      ).toBe('wait');
    });

    it('never answers no-progress for an exit that followed no wait', () => {
      // THE CASE THE LOOP SENDS ON EVERY FIRST LIMIT. It passes all seven
      // arguments every time, so a run time of 5 s and a commit count of 0
      // arrive here with the flag unset and must not read as a stuck agent.
      const answer = promptExit(
        exit({ afterWait: false, ranSeconds: 5, commitsSinceWait: 0 }),
        claude,
      );

      expect(answer.answer).toBe('wait');
    });
  });

  describe('every limit name is a limit', () => {
    it.each([
      ['session limit'],
      ['weekly limit'],
      ['Opus limit'],
      ['fast limit'],
      ['monthly spend limit'],
    ])('reads a %s line as a limit', (name) => {
      const line = `You've hit your ${name}`;
      const answer = promptExit(exit({ output: line }), claude);

      // No measured reset shape for `fast` or `monthly spend`, so these end the
      // worker with a marker naming the limit — never the retry path and its
      // false prompt-fix marker, which is the defect #1141 reported.
      expect(answer).toEqual({ answer: 'end-limited', line, cause: 'no-reset' });
    });

    it('reads a known reset on a weekly limit', () => {
      expect(
        promptExit(
          exit({ output: "You've hit your weekly limit · resets 5:20pm (Europe/Zurich)" }),
          claude,
        ).answer,
      ).toBe('wait');
    });
  });

  describe('a line that is not this harness speaking', () => {
    it('answers unstarted for a limit name with no prefix', () => {
      expect(promptExit(exit({ output: 'session limit reached' }), claude).answer).toBe('unstarted');
    });

    it('answers unstarted for the prefix with no limit name', () => {
      expect(promptExit(exit({ output: "You've hit your stride" }), claude).answer).toBe(
        'unstarted',
      );
    });

    it('answers unstarted for a runtime error, which is the retry path of today', () => {
      expect(
        promptExit(exit({ output: 'Session ID 7f3a is already in use' }), claude).answer,
      ).toBe('unstarted');
    });

    it('answers unstarted for empty output', () => {
      expect(promptExit(exit({ output: '' }), claude).answer).toBe('unstarted');
    });

    it('reads a limit line indented by the harness', () => {
      expect(promptExit(exit({ output: `   ${LIMIT_LINE}` }), claude).answer).toBe('wait');
    });
  });

  describe('a status-0 exit is read strictly', () => {
    it('waits when the last non-empty line is the limit line', () => {
      const answer = promptExit(
        exit({ status: 0, output: ['worked a while', LIMIT_LINE, '', ''].join('\n') }),
        claude,
      );

      expect(answer.answer).toBe('wait');
    });

    it('answers ran when a finished slice quoted the limit line earlier', () => {
      // THE FALSE POSITIVE THIS SLICE EXISTS TO REFUSE. Plans, panel files and
      // fixtures on this estate carry the #1141 line verbatim, and a slice that
      // finished while quoting it must not wait 24 h on finished work.
      const answer = promptExit(
        exit({
          status: 0,
          output: [
            'I fixed the loop so that it handles this line:',
            LIMIT_LINE,
            'All tests pass.',
          ].join('\n'),
        }),
        claude,
      );

      expect(answer).toEqual({ answer: 'ran' });
    });

    it('answers ran for a status-0 run that never mentioned a limit', () => {
      expect(promptExit(exit({ status: 0, output: 'done' }), claude)).toEqual({ answer: 'ran' });
    });

    it('answers ran for status-0 output that is entirely blank', () => {
      expect(promptExit(exit({ status: 0, output: '\n\n' }), claude)).toEqual({ answer: 'ran' });
    });

    it('ends the worker on a status-0 limit line whose reset is unreadable', () => {
      const line = "You've hit your monthly spend limit";
      expect(promptExit(exit({ status: 0, output: line }), claude)).toEqual({
        answer: 'end-limited',
        line,
        cause: 'no-reset',
      });
    });
  });

  describe('a harness the table does not know', () => {
    it('answers unstarted by status with no patterns', () => {
      expect(promptExit(exit(), undefined).answer).toBe('unstarted');
    });

    it('answers ran by status with no patterns', () => {
      expect(promptExit(exit({ status: 0 }), undefined).answer).toBe('ran');
    });

    it('answers by status for a pattern set naming no limit', () => {
      const empty: LimitPatterns = { prefix: "You've hit your ", names: [], resetSeparator: ' · ' };

      expect(promptExit(exit(), empty).answer).toBe('unstarted');
      expect(promptExit(exit({ status: 0 }), empty).answer).toBe('ran');
    });
  });

  describe('the harness table', () => {
    it('names the prefix, the five limits and the reset separator measured in #1141', () => {
      expect(claude).toEqual({
        prefix: "You've hit your ",
        names: ['session limit', 'weekly limit', 'Opus limit', 'fast limit', 'monthly spend limit'],
        resetSeparator: ' · resets ',
      });
    });

    it('composes the #1141 line from its own parts', () => {
      // The table is data, so the line it describes is derivable from it; a
      // table that drifts from the message stops composing.
      expect(`${claude.prefix}${claude.names[0]}${claude.resetSeparator}5:20pm (Europe/Zurich)`).toBe(
        LIMIT_LINE,
      );
    });
  });
});
