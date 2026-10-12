import { describe, it, expect } from 'vitest';
import { cardControls } from '@plot-pm/domain';
import { controlsFor } from '../fixtures/card-controls.js';

// The fixture reads a card's controls from a plan state, so a Design column
// can stand for a draft or a design plan, and a declared column name the
// default map does not know reads as an approved plan rather than throwing.
describe('controlsFor', () => {
  it('reads a stated plan state before the column name', () => {
    expect(controlsFor({ phase: 'Design', state: 'draft' }).commission).toBe(true);
    expect(controlsFor({ phase: 'Design' }).commission).toBe(false);
  });

  it('reads a column name outside the default map as an approved plan', () => {
    expect(controlsFor({ phase: 'Idea' })).toEqual(
      cardControls({ state: 'approved', status: 'approved', started: true }),
    );
  });

  it('keeps the legacy Discovery name as a Draft card', () => {
    expect(controlsFor({ phase: 'Discovery' }).roundsBadge).toBe(true);
  });

  it('lets a card status replace the status of the state', () => {
    expect(controlsFor({ phase: 'Development', status: 'in-progress', started: false }).readyToStart).toBe(true);
    expect(controlsFor({ state: 'released' }).dispatch).toBe(false);
  });
});
