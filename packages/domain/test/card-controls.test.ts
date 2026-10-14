// The controls a plan card offers, decided over values.
import { describe, it, expect } from 'vitest';
import { cardControls, CardControlsSchema } from '../src/rules/card-controls.js';
import type { PlanStatus } from '../src/rules/phase.js';

const STATES = ['draft', 'design', 'approved', 'delivered', 'released'];
const STATUSES: PlanStatus[] = [
  'draft', 'open', 'approved', 'in-progress', 'deliverable', 'proven', 'delivered', 'released', 'withdrawn',
];

describe('cardControls', () => {
  it.each(STATES)('approve and interrogate follow the state: %s', (state) => {
    const under = state === 'draft' || state === 'design';
    for (const status of STATUSES) {
      for (const started of [false, true]) {
        const actual = cardControls({ state, status, started });
        expect(actual.approve).toBe(under);
        expect(actual.interrogate).toBe(under);
      }
    }
  });

  it.each([...STATES, 'rejected', 'superseded', 'none'])('needsDesign holds on draft only: %s', (state) => {
    for (const status of STATUSES) {
      for (const started of [false, true]) {
        expect(cardControls({ state, status, started }).needsDesign).toBe(state === 'draft');
      }
    }
  });

  it.each(STATES)('roundsBadge holds on draft only: %s', (state) => {
    const draft = state === 'draft';
    for (const status of STATUSES) {
      for (const started of [false, true]) {
        const actual = cardControls({ state, status, started });
        expect(actual.roundsBadge).toBe(draft);
      }
    }
  });

  it.each(STATUSES)('dispatch follows the status: %s', (status) => {
    const expected = status === 'approved' || status === 'in-progress';
    for (const state of STATES) {
      for (const started of [false, true]) {
        expect(cardControls({ state, status, started }).dispatch).toBe(expected);
      }
    }
  });

  it.each(STATUSES)('readyToStart needs dispatch and no Started record: %s', (status) => {
    const dispatch = status === 'approved' || status === 'in-progress';
    expect(cardControls({ state: 'approved', status, started: false }).readyToStart).toBe(dispatch);
    expect(cardControls({ state: 'approved', status, started: true }).readyToStart).toBe(false);
  });

  it('offers Approve and Interrogate on a Design plan, and not the rounds badge', () => {
    expect(cardControls({ state: 'design', status: 'open', started: false })).toEqual({
      approve: true, needsDesign: false, interrogate: true, roundsBadge: false, dispatch: false, readyToStart: false, approveSpike: false, confirmSlices: false, spikeState: null,
    });
  });

  it('offers needsDesign and the rounds badge on a Draft plan', () => {
    expect(cardControls({ state: 'draft', status: 'draft', started: false })).toEqual({
      approve: true, needsDesign: true, interrogate: true, roundsBadge: true, dispatch: false, readyToStart: false, approveSpike: false, confirmSlices: false, spikeState: null,
    });
  });

  it('offers nothing on a state the workflow does not know', () => {
    expect(cardControls({ state: 'weird', status: 'draft', started: false })).toEqual({
      approve: false, needsDesign: false, interrogate: false, roundsBadge: false, dispatch: false, readyToStart: false, approveSpike: false, confirmSlices: false, spikeState: null,
    });
  });
});

describe('CardControlsSchema', () => {
  it('reads a payload written before needsDesign existed as needsDesign: false', () => {
    const older = { approve: true, interrogate: true, roundsBadge: true, dispatch: false, readyToStart: false };
    expect(CardControlsSchema.parse(older).needsDesign).toBe(false);
  });

  it('has no commission field', () => {
    const actual = cardControls({ state: 'draft', status: 'draft', started: false });
    expect(actual).not.toHaveProperty('commission');
  });
});

describe('cardControls — a Design plan against its spike', () => {
  const slices = [
    { name: 'Spike', branches: [{ branch: 'feature/spike', spike: true }] },
    { name: 'Rest', branches: [{ branch: 'feature/rest' }] },
  ];
  const at = (spikeApproved: string, spikeMerged?: boolean) =>
    cardControls({ state: 'design', status: 'open', started: false, slices, spikeApproved, spikeMerged });

  it('offers only the spike approval before the spike is approved', () => {
    expect(at('')).toMatchObject({ spikeState: 'spike-not-approved', approveSpike: true, confirmSlices: false, approve: false });
  });

  it('offers neither approval while the approved spike is unmerged', () => {
    expect(at('2026-10-13, jwloka, in-session')).toMatchObject({ spikeState: 'spike-approved', approveSpike: false, confirmSlices: false, approve: false });
  });

  it('words the approval as Confirm slices once the spike has merged', () => {
    expect(at('2026-10-13, jwloka, in-session', true)).toMatchObject({ spikeState: 'spike-merged', confirmSlices: true, approve: true });
  });

  it('leaves a Design plan with no spike its plain Approve', () => {
    expect(cardControls({ state: 'design', status: 'open', started: false })).toMatchObject({ approve: true, confirmSlices: false, spikeState: null });
  });
});
