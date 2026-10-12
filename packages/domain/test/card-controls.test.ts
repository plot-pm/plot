// The controls a plan card offers, decided over values.
import { describe, it, expect } from 'vitest';
import { cardControls } from '../src/rules/card-controls.js';
import type { PlanStatus } from '../src/rules/phase.js';

const STATES = ['draft', 'design', 'approved', 'delivered', 'released'];
const STATUSES: PlanStatus[] = [
  'draft', 'open', 'approved', 'in-progress', 'deliverable', 'delivered', 'released', 'withdrawn',
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

  it.each(STATES)('commission and roundsBadge hold on draft only: %s', (state) => {
    const draft = state === 'draft';
    for (const status of STATUSES) {
      for (const started of [false, true]) {
        const actual = cardControls({ state, status, started });
        expect(actual.commission).toBe(draft);
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

  it('offers Approve and Interrogate on a Design plan, and not Commission or the rounds badge', () => {
    expect(cardControls({ state: 'design', status: 'open', started: false })).toEqual({
      approve: true, interrogate: true, commission: false, roundsBadge: false, dispatch: false, readyToStart: false,
    });
  });

  it('offers Commission and the rounds badge on a Draft plan', () => {
    expect(cardControls({ state: 'draft', status: 'draft', started: false })).toEqual({
      approve: true, interrogate: true, commission: true, roundsBadge: true, dispatch: false, readyToStart: false,
    });
  });

  it('offers nothing on a state the workflow does not know', () => {
    expect(cardControls({ state: 'weird', status: 'draft', started: false })).toEqual({
      approve: false, interrogate: false, commission: false, roundsBadge: false, dispatch: false, readyToStart: false,
    });
  });
});
