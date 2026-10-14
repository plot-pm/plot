import { describe, it, expect } from 'vitest';
import {
  designWork,
  recordRunFailure as recordFailure,
  specDeclined,
  specIsEmpty,
  specRow,
  specStart,
  type DesignStore,
  type DesignWorkReadings,
  type HeldSlice,
  type SpecStartInput,
} from '../src/index.js';

const SPEC_PLACEHOLDER = '_To be filled in during Design._';

const EMPTY_STORE: DesignStore = {
  failures: {},
  failedAt: [],
  lastSuccessAt: 0,
  declined: {},
  answeredPr: {},
  restart: {},
  orphans: {},
};

const held = (hold: HeldSlice['hold']): HeldSlice => ({ branch: 'b', hold, waitsOn: [], waitHeld: '', assignedTo: '' });

const startInput = (over: Partial<SpecStartInput> = {}): SpecStartInput => ({
  autoDesign: true,
  command: true,
  slug: 'ship-it',
  designCommit: 'abc1234',
  going: new Set(),
  store: EMPTY_STORE,
  now: 1_000_000,
  held: [],
  headroom: 'clear',
  machineOverride: false,
  ...over,
});

describe('specIsEmpty', () => {
  it('is true for an absent section, an empty one and the placeholder', () => {
    expect(specIsEmpty('# Plan\n\nno spec section here')).toBe(true);
    expect(specIsEmpty('## Spec\n\n## Next')).toBe(true);
    expect(specIsEmpty(`## Spec\n\n${SPEC_PLACEHOLDER}\n\n## Next`)).toBe(true);
  });

  it('is false for a link-only section and for written text', () => {
    expect(specIsEmpty('## Spec\n\n[DESIGN-foo.md](DESIGN-foo.md)\n\n## Next')).toBe(false);
    expect(specIsEmpty('## Spec\n\nThe approach is...\n\n## Next')).toBe(false);
  });
});

describe('designWork', () => {
  const readings = (over: Partial<DesignWorkReadings> = {}): DesignWorkReadings => ({
    state: 'design',
    text: '# Plan\n\nno spec',
    specRef: 'absent',
    prRetry: false,
    ...over,
  });

  it('answers write-spec for a design plan with an empty spec and no claim', () => {
    expect(designWork(readings())).toBe('write-spec');
  });

  it('answers open-pr for a work claim with prRetry', () => {
    expect(designWork(readings({ specRef: 'work', prRetry: true }))).toBe('open-pr');
  });

  it('answers none for claim-only, work without prRetry, unknown, a written spec and any other state', () => {
    expect(designWork(readings({ specRef: 'claim-only' }))).toBe('none');
    expect(designWork(readings({ specRef: 'work', prRetry: false }))).toBe('none');
    expect(designWork(readings({ specRef: 'unknown' }))).toBe('none');
    expect(designWork(readings({ text: '## Spec\n\nwritten\n\n## Next' }))).toBe('none');
    expect(designWork(readings({ state: 'approved' }))).toBe('none');
  });
});

describe('specStart', () => {
  it('starts nothing and answers ask-host when no refusal holds', () => {
    expect(specStart(startInput())).toEqual({ start: false, reason: 'ask-host' });
  });

  it('names off when Auto-design is off or Design command is missing', () => {
    expect(specStart(startInput({ autoDesign: false }))).toEqual({ start: false, reason: 'off' });
    expect(specStart(startInput({ command: false }))).toEqual({ start: false, reason: 'off' });
  });

  it('a restart mark with no Design command answers off', () => {
    const store: DesignStore = { ...EMPTY_STORE, restart: { 'ship-it': 'abc1234' } };
    expect(specStart(startInput({ command: false, store }))).toEqual({ start: false, reason: 'off' });
    expect(specStart(startInput({ autoDesign: false, command: false, store }))).toEqual({
      start: false,
      reason: 'off',
    });
  });

  it('names running while a spec run or a verify run is going, for this plan or another', () => {
    expect(specStart(startInput({ going: new Set(['ship-it']) }))).toEqual({ start: false, reason: 'running' });
    expect(specStart(startInput({ going: new Set(['another-plan']) }))).toEqual({ start: false, reason: 'running' });
  });

  it('names declined under the current Design commit', () => {
    const store: DesignStore = { ...EMPTY_STORE, declined: { 'ship-it': { commit: 'abc1234', pr: 7 } } };
    expect(specStart(startInput({ store }))).toEqual({ start: false, reason: 'declined' });
  });

  it('does not name declined for a mark under another commit', () => {
    const store: DesignStore = { ...EMPTY_STORE, declined: { 'ship-it': { commit: 'def5678', pr: 7 } } };
    expect(specStart(startInput({ store }))).toEqual({ start: false, reason: 'ask-host' });
  });

  it('names halted at three failures newer than lastSuccessAt, across plans', () => {
    const store: DesignStore = { ...EMPTY_STORE, failedAt: [10, 20, 30], lastSuccessAt: 5 };
    expect(specStart(startInput({ store }))).toEqual({ start: false, reason: 'halted' });
  });

  it('stops a plan after three failures under one Design commit', () => {
    let f = recordFailure(undefined, 'abc1234', 1);
    f = recordFailure(f, 'abc1234', 2);
    f = recordFailure(f, 'abc1234', 3);
    const store: DesignStore = { ...EMPTY_STORE, failures: { 'ship-it': f }, failedAt: [1] };
    expect(specStart(startInput({ store }))).toEqual({ start: false, reason: 'stopped' });
  });

  it('names waiting inside the delay after a failure', () => {
    const f = recordFailure(undefined, 'abc1234', 1_000_000);
    const store: DesignStore = { ...EMPTY_STORE, failures: { 'ship-it': f }, failedAt: [1_000_000] };
    expect(specStart(startInput({ store, now: 1_000_001 }))).toEqual({ start: false, reason: 'waiting' });
    expect(specStart(startInput({ store, now: 1_060_000 }))).toEqual({ start: false, reason: 'ask-host' });
  });

  it('names queue-unread while no queue pass has been read', () => {
    expect(specStart(startInput({ held: null }))).toEqual({ start: false, reason: 'queue-unread' });
  });

  it('names no-free-agent while any slice is held on it', () => {
    expect(specStart(startInput({ held: [held('waits'), held('no-free-agent')] }))).toEqual({
      start: false,
      reason: 'no-free-agent',
    });
  });

  it('names starved without a Machine override, and asks the host with one', () => {
    expect(specStart(startInput({ headroom: 'starved' }))).toEqual({ start: false, reason: 'starved' });
    expect(specStart(startInput({ headroom: 'starved', machineOverride: true }))).toEqual({
      start: false,
      reason: 'ask-host',
    });
  });

  it('refuses in order: declined is checked before running, and a fixture holding both catches a swapped order', () => {
    const store: DesignStore = { ...EMPTY_STORE, declined: { 'ship-it': { commit: 'abc1234', pr: 7 } } };
    expect(specStart(startInput({ store, going: new Set(['ship-it']) }))).toEqual({
      start: false,
      reason: 'running',
    });
  });

  it('a restart mark passes off, declined, halted, stopped and waiting once', () => {
    const declinedStore: DesignStore = {
      ...EMPTY_STORE,
      declined: { 'ship-it': { commit: 'abc1234', pr: 7 } },
      restart: { 'ship-it': 'abc1234' },
    };
    expect(specStart(startInput({ autoDesign: false, store: declinedStore }))).toEqual({ start: false, reason: 'ask-host' });

    const haltedStore: DesignStore = {
      ...EMPTY_STORE,
      failedAt: [10, 20, 30],
      lastSuccessAt: 5,
      restart: { 'ship-it': 'abc1234' },
    };
    expect(specStart(startInput({ store: haltedStore }))).toEqual({ start: false, reason: 'ask-host' });

    let f = recordFailure(undefined, 'abc1234', 1);
    f = recordFailure(recordFailure(f, 'abc1234', 2), 'abc1234', 3);
    const stoppedStore: DesignStore = {
      ...EMPTY_STORE,
      failures: { 'ship-it': f },
      failedAt: [1],
      restart: { 'ship-it': 'abc1234' },
    };
    expect(specStart(startInput({ store: stoppedStore }))).toEqual({ start: false, reason: 'ask-host' });

    const waiting = recordFailure(undefined, 'abc1234', 1_000_000);
    const waitingStore: DesignStore = {
      ...EMPTY_STORE,
      failures: { 'ship-it': waiting },
      failedAt: [1_000_000],
      restart: { 'ship-it': 'abc1234' },
    };
    expect(specStart(startInput({ store: waitingStore, now: 1_000_001 }))).toEqual({
      start: false,
      reason: 'ask-host',
    });
  });

  it('a restart mark does not pass running or a slot refusal', () => {
    const store: DesignStore = { ...EMPTY_STORE, restart: { 'ship-it': 'abc1234' } };
    expect(specStart(startInput({ store, going: new Set(['ship-it']) }))).toEqual({
      start: false,
      reason: 'running',
    });
    expect(specStart(startInput({ store, held: null }))).toEqual({ start: false, reason: 'queue-unread' });
    expect(specStart(startInput({ store, held: [held('no-free-agent')] }))).toEqual({
      start: false,
      reason: 'no-free-agent',
    });
    expect(specStart(startInput({ store, headroom: 'starved' }))).toEqual({ start: false, reason: 'starved' });
  });

  it('a restart mark under another commit does not apply', () => {
    const store: DesignStore = {
      ...EMPTY_STORE,
      declined: { 'ship-it': { commit: 'abc1234', pr: 7 } },
      restart: { 'ship-it': 'def5678' },
    };
    expect(specStart(startInput({ autoDesign: false, store }))).toEqual({ start: false, reason: 'off' });
  });
});

describe('specDeclined', () => {
  it('answers host-unknown when the host could not answer', () => {
    expect(specDeclined('unknown', 0)).toBe('host-unknown');
  });

  it('answers start when the host holds no PR', () => {
    expect(specDeclined(null, 0)).toBe('start');
  });

  it('answers pr-open for an open PR', () => {
    expect(specDeclined({ number: 5, state: 'OPEN' } as never, 0)).toBe('pr-open');
  });

  it('answers declined for a closed PR above answeredPr, start at or below it', () => {
    expect(specDeclined({ number: 5, state: 'CLOSED' } as never, 3)).toBe('declined');
    expect(specDeclined({ number: 5, state: 'CLOSED' } as never, 5)).toBe('start');
    expect(specDeclined({ number: 5, state: 'MERGED' } as never, 5)).toBe('start');
  });
});

describe('specRow', () => {
  it('answers working with the shared shape for a going run', () => {
    expect(specRow('ship-it', 'abc1234', EMPTY_STORE, 'l', true, 1_000_000)).toEqual({
      kind: 'spec',
      plan: 'ship-it',
      reason: '',
      log: '',
      restart: '',
      stopped: false,
      halted: false,
    });
  });

  it('answers waiting-on-you with reason, log and the restart command for a failure under the current commit', () => {
    let f = recordFailure(undefined, 'abc1234', 1);
    f = recordFailure(recordFailure(f, 'abc1234', 2), 'abc1234', 3);
    const store: DesignStore = { ...EMPTY_STORE, failures: { 'ship-it': f }, failedAt: [1] };
    const row = specRow('ship-it', 'abc1234', store, '/x/design.log', false, 1_000_000);
    expect(row).toMatchObject({ restart: 'plot-design.mjs restart ship-it', log: '/x/design.log', stopped: true });
    expect(row?.reason).toBe('the spec run failed 3 times; the fleet stopped retrying this plan');
  });

  it('answers waiting-on-you for an orphan with no-pr', () => {
    const store: DesignStore = { ...EMPTY_STORE, orphans: { 'ship-it': { tip: 'deadbeef', hasPr: false } } };
    const row = specRow('ship-it', 'abc1234', store, '', false, 1_000_000);
    expect(row).toMatchObject({ restart: 'plot-design.mjs restart ship-it', stopped: false });
  });

  it('answers halted when the store is halted', () => {
    const f = recordFailure(undefined, 'abc1234', 100);
    const store: DesignStore = { ...EMPTY_STORE, failures: { 'ship-it': f }, failedAt: [1, 2, 100] };
    const row = specRow('ship-it', 'abc1234', store, 'l', false, 1_000_000);
    expect(row?.halted).toBe(true);
    expect(row?.reason).toContain('the fleet is halted on spec run failures');
  });

  it('answers null for a record under another commit, and for no record', () => {
    const f = recordFailure(undefined, 'abc1234', 100);
    const store: DesignStore = { ...EMPTY_STORE, failures: { 'ship-it': f }, failedAt: [100] };
    expect(specRow('ship-it', 'def5678', store, 'l', false, 1)).toBeNull();
    expect(specRow('other', 'abc1234', EMPTY_STORE, 'l', false, 1)).toBeNull();
  });
});
