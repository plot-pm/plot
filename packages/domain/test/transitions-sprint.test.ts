import { describe, expect, it } from 'vitest';
import { SprintStateSchema, type Sprint, type SprintItem, type SprintState } from '../src/entities/sprint.js';
import {
  isDecision,
  isRefusal,
  openPromises,
  setSprintState,
  sprintStateSettable,
  SPRINT_LIFECYCLE,
} from '../src/transitions/sprint.js';

const item = (over: Partial<SprintItem> = {}): SprintItem => ({
  tier: 'must',
  checked: false,
  plan: 'a-lifecycle-is-enforced-by-a-test',
  text: 'the six declare their rules',
  annotation: '',
  ...over,
});

const sprintWith = (over: Partial<Sprint> = {}): Sprint => ({
  slug: 'the-domain-owns-the-lifecycle',
  title: 'The domain owns the lifecycle',
  state: 'Planning',
  start: '2026-09-01',
  plannedEnd: '2026-09-14',
  actualEnd: null,
  release: '2.13.0',
  goal: 'every lifecycle is enforced by a test',
  items: [item()],
  ...over,
});

const move = (from: SprintState, to: string, on?: string) =>
  setSprintState(sprintWith({ state: from }), { to, on });

describe('the states are consumed, never redeclared', () => {
  it('names the states the entity owns, in the order it draws them', () => {
    expect([...SPRINT_LIFECYCLE]).toEqual([...SprintStateSchema.options]);
  });
});

describe('a timebox is opened, committed to, run and closed', () => {
  it('goes Planning -> Committed -> Active -> Closed', () => {
    expect(isDecision(move('Planning', 'Committed'))).toBe(true);
    expect(isDecision(move('Committed', 'Active'))).toBe(true);
    expect(isDecision(move('Active', 'Closed', '2026-09-14'))).toBe(true);
  });

  it('records the close date, and nothing else carries one', () => {
    const closed = move('Active', 'Closed', '2026-09-14');
    expect(isDecision(closed) && closed.actualEnd).toBe('2026-09-14');
    const committed = move('Planning', 'Committed');
    expect(isDecision(committed) && committed.actualEnd).toBeNull();
  });

  it('lets a planned sprint be abandoned without pretending it ran', () => {
    // Every planned week that was overtaken took this move. Routing it through
    // Committed and Active would record work nobody did.
    expect(isDecision(move('Planning', 'Closed', '2026-09-14'))).toBe(true);
  });

  it('answers the same question through the callable-alone form', () => {
    expect(sprintStateSettable(sprintWith(), 'Committed')).toBe(true);
    expect(sprintStateSettable(sprintWith({ state: 'Closed' }), 'Active')).toBe(false);
  });
});

describe('it refuses what the lifecycle does not admit', () => {
  it('refuses an unrecognised state', () => {
    const result = move('Planning', 'Planned');
    expect(isRefusal(result) && result.reason).toBe('state-unrecognised');
  });

  it('refuses a move to the state it already holds', () => {
    const result = move('Active', 'Active');
    expect(isRefusal(result) && result.reason).toBe('state-unchanged');
  });

  it('refuses to reopen — a reopened sprint is a new timebox with its own week', () => {
    const result = move('Closed', 'Active');
    expect(isRefusal(result) && result.reason).toBe('state-terminal');
  });

  it('refuses to skip straight from Planning to Active', () => {
    const result = move('Planning', 'Active');
    expect(isRefusal(result) && result.reason).toBe('state-unreachable');
  });

  it('refuses to go backwards', () => {
    const result = move('Active', 'Committed');
    expect(isRefusal(result) && result.reason).toBe('state-unreachable');
  });
});

describe('committing asks what was promised', () => {
  it('refuses a commitment with no Must — only a Must is a promise', () => {
    const result = setSprintState(
      sprintWith({ items: [item({ tier: 'should' }), item({ tier: 'could' })] }),
      { to: 'Committed' },
    );
    expect(isRefusal(result) && result.reason).toBe('commitment-empty');
  });

  it('refuses a commitment naming no release — the release is the gate’s key', () => {
    const result = setSprintState(sprintWith({ release: '  ' }), { to: 'Committed' });
    expect(isRefusal(result) && result.reason).toBe('release-unnamed');
  });

  it('asks neither of a sprint being closed', () => {
    const result = setSprintState(
      sprintWith({ state: 'Planning', release: '', items: [] }),
      { to: 'Closed', on: '2026-09-14' },
    );
    expect(isDecision(result)).toBe(true);
  });
});

describe('a sprint ends when somebody says it ended', () => {
  it('refuses to close with no date', () => {
    const result = move('Active', 'Closed');
    expect(isRefusal(result) && result.reason).toBe('close-date-missing');
  });

  it('refuses a close date before the sprint started', () => {
    const result = move('Active', 'Closed', '2026-08-01');
    expect(isRefusal(result) && result.reason).toBe('close-date-before-start');
  });

  it('does not close on the calendar’s word — plannedEnd moves nothing', () => {
    // A sprint past its planned end is LATE, not closed. Nothing here reads
    // `plannedEnd`, which is why `actualEnd` is a separate field.
    const late = sprintWith({ state: 'Active', plannedEnd: '2026-01-01' });
    expect(isRefusal(setSprintState(late, { to: 'Closed' }))).toBe(true);
  });

  it('refuses on an unmet precondition, quoting what the source said', () => {
    const result = setSprintState(sprintWith(), {
      to: 'Committed',
      preconditions: [{ name: 'file-writable', met: false, detail: 'read-only' }],
    });
    expect(isRefusal(result) && result.reason).toBe('precondition-unmet');
    expect(isRefusal(result) && result.detail).toContain('read-only');
  });

  it('names an unmet reading that said nothing', () => {
    const result = setSprintState(sprintWith(), {
      to: 'Committed',
      preconditions: [{ name: 'file-writable', met: false }],
    });
    expect(isRefusal(result) && result.detail).toBe("the reading 'file-writable' is not met");
  });

  it('records no date on a move that is not a close, whatever the caller passed', () => {
    // `actualEnd` is the close's own field: a date offered on any other move is
    // dropped rather than written somewhere it does not belong.
    const result = setSprintState(sprintWith(), { to: 'Committed', on: '2026-09-14' });
    expect(isDecision(result) && result.actualEnd).toBeNull();
  });
});

describe('the promises a sprint has still to keep', () => {
  it('names a Must whose plan has not delivered', () => {
    expect(openPromises(sprintWith(), new Set())).toEqual(['a-lifecycle-is-enforced-by-a-test']);
  });

  it('keeps nothing open once the plan delivered, ticked or not', () => {
    // The estate outranks the checkbox in one direction: an unchecked box over
    // a delivered plan is done, because delivering moves the plan and nobody
    // re-ticks the box.
    expect(openPromises(sprintWith(), new Set(['a-lifecycle-is-enforced-by-a-test']))).toEqual([]);
  });

  it('ignores every tier but Must', () => {
    const sprint = sprintWith({ items: [item({ tier: 'should' }), item({ tier: 'could' })] });
    expect(openPromises(sprint, new Set())).toEqual([]);
  });

  it('reports a checked box over an undelivered plan as still open', () => {
    const sprint = sprintWith({ items: [item({ checked: true })] });
    expect(openPromises(sprint, new Set())).toEqual(['a-lifecycle-is-enforced-by-a-test']);
  });

  it('takes a ticked Must naming no plan at its checkbox', () => {
    // A plan-less item has one source of truth. `delivered.has('')` is false
    // for every estate, so scoring it as a plan would hold the sprint open on
    // a ticked box that nothing can ever deliver.
    const sprint = sprintWith({ items: [item({ checked: true, plan: '' })] });
    expect(openPromises(sprint, new Set())).toEqual([]);
  });

  it('keeps an unticked Must naming no plan open', () => {
    const sprint = sprintWith({ items: [item({ checked: false, plan: '' })] });
    expect(openPromises(sprint, new Set())).toEqual(['']);
  });
});
