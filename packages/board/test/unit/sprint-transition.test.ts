import { describe, it, expect } from 'vitest';
import {
  answer,
  decide,
  itemsFrom,
  requestFrom,
  sprintFrom,
  run,
  states,
} from '../../src/server/entry/sprint-transition.js';
import { isRefusal } from '@plot-pm/domain/transitions/sprint';

/**
 * THE TESTS REPLAY 2026-09-08.
 *
 * On that afternoon a master agent activated a sprint by hand: `sed` over the
 * `State:` line, `ln -s` for the symlink, a file written without the template.
 * The sprint then carried a phase no rule admits and counted zero of its nine
 * items for an hour while a person asked what was wrong with the board.
 *
 * `setSprintState` had a refusal for each of the three mistakes, exported and
 * tested, called by nothing. Each `it` below is one of those inputs, so a slice
 * claiming to fix the day fails before the wiring and passes after.
 */

/** The sprint file as it stood that afternoon: a state the lifecycle lacks. */
const PLANNED = `# Sprint: The Jenkins team sees its builds

## Status

- **State:** Planned
- **Start:** 2026-09-08
- **End:** 2026-09-14
- **Release:** 2.14.0

## Sprint Goal

**The Jenkins team sees its builds.**

## Commitment

### Must Have

- [ ] [a-probe-reports-and-the-domain-judges] the probe reports and the domain judges
`;

/** The same file with the state the lifecycle does admit. */
const planning = PLANNED.replace('- **State:** Planned', '- **State:** Planning');

const ask = (content: string, to: string, on = '') =>
  decide({ to, on, slug: 'the-jenkins-team-sees-its-builds', content });

describe('the sprint transitions are reachable from a controller', () => {
  describe("replaying 2026-09-08's three refusals", () => {
    it("refuses a sprint carrying 'Planned', naming the four states", () => {
      // THE EXACT SEQUENCE: a file saying `State: Planned`, started.
      //
      // The state is carried through unparsed so THIS rule recognises it.
      // Narrowing in the parser would refuse in the parser's words and leave
      // `state-unrecognised` as dead as it was.
      const result = ask(PLANNED, 'Active');
      expect(isRefusal(result)).toBe(true);
      expect(isRefusal(result) && result.reason).toBe('state-unrecognised');
      expect(isRefusal(result) && result.detail).toContain('Planned');
      expect(isRefusal(result) && result.detail).toContain(
        'Planning, Committed, Active, Closed',
      );
    });

    it('refuses committing a sprint whose Musts parse to nothing', () => {
      // The file was written by hand instead of from `templates/sprint.md`, so
      // its heading read `### Must` where the parser matches `### Must Have`.
      // Nine items, none of them a promise.
      const unparseable = planning.replace('### Must Have', '### Must');
      const result = ask(unparseable, 'Committed');
      expect(isRefusal(result) && result.reason).toBe('commitment-empty');
      expect(isRefusal(result) && result.detail).toContain('only a Must is a promise');
    });

    it('refuses Planning -> Active, naming what Planning may become', () => {
      const result = ask(planning, 'Active');
      expect(isRefusal(result) && result.reason).toBe('state-unreachable');
      expect(isRefusal(result) && result.detail).toContain('Committed or Closed');
    });
  });

  describe('the transitions that hold', () => {
    it('commits a sprint that promised something against a release', () => {
      expect(answer({ to: 'Committed', on: '', slug: 's', content: planning }))
        .toBe('Committed\t\n');
    });

    it('starts a committed sprint', () => {
      const committed = planning.replace('- **State:** Planning', '- **State:** Committed');
      expect(answer({ to: 'Active', on: '', slug: 's', content: committed }))
        .toBe('Active\t\n');
    });

    it('closes an active sprint, carrying the date the timebox ended', () => {
      // A sprint ends when somebody says it ended: the date is the caller's,
      // and it comes back out so the record and the state are one write.
      const active = planning.replace('- **State:** Planning', '- **State:** Active');
      expect(answer({ to: 'Closed', on: '2026-09-14', slug: 's', content: active }))
        .toBe('Closed\t2026-09-14\n');
    });

    it('refuses a close nobody can place', () => {
      const active = planning.replace('- **State:** Planning', '- **State:** Active');
      const result = ask(active, 'Closed');
      expect(isRefusal(result) && result.reason).toBe('close-date-missing');
    });
  });

  describe('reading the file', () => {
    it('reads the state, the dates, the release and the goal', () => {
      const sprint = sprintFrom(planning, 'the-jenkins-team-sees-its-builds');
      expect(sprint.state).toBe('Planning');
      expect(sprint.start).toBe('2026-09-08');
      expect(sprint.plannedEnd).toBe('2026-09-14');
      expect(sprint.release).toBe('2.14.0');
      expect(sprint.goal).toBe('The Jenkins team sees its builds.');
      expect(sprint.title).toBe('The Jenkins team sees its builds');
      expect(sprint.actualEnd).toBeNull();
    });

    it("reads a file written before 2026-09-07, which spells the field 'Phase'", () => {
      const old = planning.replace('- **State:** Planning', '- **Phase:** Planning');
      expect(sprintFrom(old, 's').state).toBe('Planning');
    });

    it('reads a recorded close date back', () => {
      const closed = planning.replace(
        '- **State:** Planning',
        '- **State:** Closed\n- **Actual End:** 2026-09-14',
      );
      expect(sprintFrom(closed, 's').actualEnd).toBe('2026-09-14');
    });

    it('takes the tier from the heading a line sits under', () => {
      const items = itemsFrom(
        '### Must Have\n\n- [x] [one] first\n\n### Should Have\n\n- [ ] [two] second\n',
      );
      expect(items).toEqual([
        { tier: 'must', checked: true, plan: 'one', text: 'first' },
        { tier: 'should', checked: false, plan: 'two', text: 'second' },
      ]);
    });

    it('counts a checkbox outside a MoSCoW heading as no item', () => {
      // The goal and the notes carry checkboxes too, and neither is a promise.
      expect(itemsFrom('## Sprint Goal\n\n- [ ] [not-an-item] prose\n')).toEqual([]);
    });

    it('keeps the strongest tier for a plan listed once per slice', () => {
      const items = itemsFrom(
        '### Must Have\n\n- [ ] [p] slice one\n\n### Could Have\n\n- [ ] [p] slice two\n',
      );
      expect(items).toEqual([{ tier: 'must', checked: false, plan: 'p', text: 'slice one' }]);
    });

    it('reads a Deferred bullet written as prose as no item', () => {
      expect(itemsFrom('### Deferred\n\n- **Renaming Endgame.** moved out\n')).toEqual([]);
    });
  });

  describe('the wire', () => {
    it('splits a header line from the file that follows it', () => {
      const request = requestFrom(`Active\t2026-09-14\tslug\n${planning}`);
      expect(request).toMatchObject({ to: 'Active', on: '2026-09-14', slug: 'slug' });
      expect(request.content).toBe(planning);
    });

    it('carries a sprint whose body holds tabs and its own Status block', () => {
      const awkward = `## Status\n\n- **State:** Planning\n\n### Must Have\n\n- [ ] [p]\tone\n`;
      expect(requestFrom(`Committed\t\ts\n${awkward}`).content).toBe(awkward);
    });

    it('refuses a header short of three fields rather than padding it', () => {
      // A missing `on` would read as '' — the spelling for no date given — and
      // a close would then refuse with `close-date-missing` where the caller
      // had supplied one, reporting the caller's bug as the sprint's state.
      expect(() => requestFrom('Closed\ts\nbody')).toThrow(/3 tab-separated/);
    });

    it('refuses input carrying no file at all', () => {
      expect(() => requestFrom('Closed\t\ts')).toThrow(/header line and a sprint file/);
    });
  });

  describe('the process', () => {
    it('exits 1 on a refusal and writes nothing to stdout', () => {
      const out: string[] = [];
      expect(run(`Active\t\ts\n${PLANNED}`, (s) => out.push(s))).toBe(1);
      expect(out).toEqual([]);
    });

    it('exits 2 on unreadable input, which is the caller’s bug', () => {
      const out: string[] = [];
      expect(run('Closed\ts\nbody', (s) => out.push(s))).toBe(2);
      expect(out).toEqual([]);
    });

    it('exits 0 and prints the decision', () => {
      const out: string[] = [];
      expect(run(`Committed\t\ts\n${planning}`, (s) => out.push(s))).toBe(0);
      expect(out.join('')).toBe('Committed\t\n');
    });

    it('answers --states from the schema, so a fifth cannot be invented', () => {
      const out: string[] = [];
      expect(run('', (s) => out.push(s), ['node', 'bundle', '--states'])).toBe(0);
      expect(out.join('')).toBe('Planning\nCommitted\nActive\nClosed\n');
      expect(states()).toBe('Planning\nCommitted\nActive\nClosed\n');
    });
  });
});

/**
 * THE READERS AGREE ABOUT WHAT AN ITEM IS.
 *
 * A bare `- [ ] rename the deploy step` under `### Must Have` is the
 * lightweight form `skills/plot-sprint/SKILL.md:240` documents. Measured
 * 2026-09-24 on one sandbox sprint with two such lines:
 * `plot-sprint-release.sh` reported **2 Must items, both open**, and this
 * reader refused the commit with `commitment-empty`, *"names no Must"* —
 * because `MEMBER_LINE`'s second bracket was mandatory and the line never
 * became an item at all.
 *
 * EVERY TEST HERE ASSERTS THE COUNT. Making the bracket optional without
 * re-keying the dedup keeps 2 of 3 (and 1 of 8), and a test asserting only
 * *"it commits"* passes on that 2. The count is the discriminator.
 */
describe('a bare item is an item', () => {
  /** A `## Status` block a sprint parses from, at the given state. */
  const sprint = (state: string, must: string) => `# Sprint: bare items

## Status

- **State:** ${state}
- **Start:** 2026-09-24
- **End:** 2026-09-30
- **Release:** 2.21.0

## Sprint Goal

**The readers agree.**

## Commitment

### Must Have

${must}
`;

  it('reads three lines as three items when two of them are bare', () => {
    // THE MEASURED CASE. As shipped this kept 1 of 3; with the bracket made
    // optional and the dedup left alone it kept 2 of 3, because both bare
    // lines captured the plan `''` and collided on that one key.
    const items = itemsFrom(sprint('Planning', [
      '- [ ] rename the deploy step',
      '- [ ] update the runbook',
      '- [ ] [a-slug](../plans/x.md) — do a thing',
    ].join('\n')));
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.tier)).toEqual(['must', 'must', 'must']);
    // The bare ones carry no plan and keep their own text — the text is the
    // only name such an item has.
    expect(items[0]).toMatchObject({ plan: '', text: 'rename the deploy step' });
    expect(items[1]).toMatchObject({ plan: '', text: 'update the runbook' });
    expect(items[2].plan).toBe('a-slug');
  });

  it('reads eight bare Musts as eight items', () => {
    // The panel measured 1 of 8 for the shipped reader. Eight is the number
    // that separates a fixed dedup from a regex-only change.
    const must = Array.from({ length: 8 }, (_, i) => `- [ ] task ${i}`).join('\n');
    expect(itemsFrom(sprint('Planning', must))).toHaveLength(8);
  });

  it('counts two IDENTICAL bare lines as two items', () => {
    // THE KEY MUST NOT BE THE TEXT. Two lines reading the same are two items;
    // keying on the text would collapse them and reproduce this very defect in
    // miniature, on a sprint where nothing looks wrong.
    const items = itemsFrom(sprint('Planning', [
      '- [ ] rename the deploy step',
      '- [ ] rename the deploy step',
    ].join('\n')));
    expect(items).toHaveLength(2);
  });

  it('still dedupes a slug listed twice, keeping its strongest tier', () => {
    // THE REGRESSION THE NEW KEY MUST NOT CAUSE. A plan sliced across slices
    // lists its slug once per slice and the sprint contains it once — the
    // reason dedup exists. Only a line naming NO plan escapes it.
    const items = itemsFrom(`# Sprint: dupes

## Status

- **State:** Planning
- **Release:** 2.21.0

## Commitment

### Must Have

- [ ] [a-plan] wave one

### Should Have

- [ ] [a-plan] wave two
`);
    expect(items).toHaveLength(1);
    expect(items[0].tier).toBe('must');
  });

  it('commits a sprint whose Must Haves are all bare', () => {
    // The end-to-end shape of the bug: this exact file was refused with
    // `commitment-empty` while the release gate counted its two open Musts.
    const content = sprint('Planning', [
      '- [ ] rename the deploy step',
      '- [ ] update the runbook',
    ].join('\n'));
    expect(itemsFrom(content)).toHaveLength(2);
    expect(answer({ to: 'Committed', on: '', slug: 's', content })).toBe('Committed\t\n');
  });

  it('still refuses a sprint with an empty Must Have', () => {
    // `commitment-empty` STAYS. Its sentence is correct for a sprint that
    // genuinely promises nothing, and the fix feeds the rule items rather than
    // removing the refusal that reports their absence.
    const result = ask(sprint('Planning', ''), 'Committed');
    expect(isRefusal(result)).toBe(true);
    expect(isRefusal(result) && result.reason).toBe('commitment-empty');
  });

  it('does not treat a checkbox outside a tier heading as an item', () => {
    // The tier is the heading the line sits under, and the optional bracket
    // must not widen that. A checkbox in the goal or the notes is not a
    // promise — this is the property the mandatory bracket used to enforce
    // accidentally, and it has to survive on its own.
    const items = itemsFrom(`# Sprint: stray boxes

## Status

- **State:** Planning
- **Release:** 2.21.0

## Sprint Goal

- [ ] this is prose in the goal

## Commitment

### Must Have

- [ ] a real item

## Notes

- [x] a checkbox in the notes
`);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('a real item');
  });
});
