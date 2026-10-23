import { describe, it, expect } from 'vitest';
import { allReleased, ticketPhase, type TicketPlan } from '../src/rules/ticket-phase.js';

const plan = (state: string, overrides: Partial<TicketPlan> = {}): TicketPlan => ({ state, total: 0, merged: null, ...overrides });

describe('ticketPhase', () => {
  it('answers null when no plan names the ticket', () => {
    expect(ticketPhase([])).toBeNull();
  });

  it('words a Draft plan as planning', () => {
    expect(ticketPhase([plan('draft')])?.label).toBe('planning');
  });

  it('words a Design plan as design', () => {
    expect(ticketPhase([plan('design')])?.label).toBe('design');
  });

  it('words an Approved plan with 3 of 6 slices merged as in progress 3/6', () => {
    expect(ticketPhase([plan('approved', { total: 6, merged: 3 })])?.label).toBe('in progress 3/6');
  });

  it('words an Approved plan with no slice started as in progress 0/N when the reading exists', () => {
    expect(ticketPhase([plan('approved', { total: 2, merged: 0 })])?.label).toBe('in progress 0/2');
  });

  it('words an Approved plan with no merged-PR reading as in progress, never 0/0', () => {
    expect(ticketPhase([plan('approved', { total: 6, merged: null })])?.label).toBe('in progress');
    expect(ticketPhase([plan('approved')])?.label).toBe('in progress');
  });

  it('words an Approved plan that lists no slices as in progress', () => {
    expect(ticketPhase([plan('approved', { total: 0, merged: 0 })])?.label).toBe('in progress');
  });

  it('words a Delivered plan as delivered', () => {
    expect(ticketPhase([plan('delivered')])?.label).toBe('delivered');
  });

  it('words a Released plan as released', () => {
    expect(ticketPhase([plan('released')])?.label).toBe('released');
  });

  it('shows in progress, not delivered, for an Approved and a Delivered plan in either order', () => {
    const approved = plan('approved', { total: 4, merged: 1 });
    expect(ticketPhase([approved, plan('delivered')])?.label).toBe('in progress 1/4');
    expect(ticketPhase([plan('delivered'), approved])?.label).toBe('in progress 1/4');
  });

  it('shows planning for a Draft and a Design plan', () => {
    expect(ticketPhase([plan('design'), plan('draft')])?.label).toBe('planning');
  });

  it('orders a less advanced phase below a more advanced one', () => {
    const order = (state: string) => ticketPhase([plan(state)])?.order ?? NaN;
    expect(order('draft')).toBeLessThan(order('design'));
    expect(order('design')).toBeLessThan(order('approved'));
    expect(order('approved')).toBeLessThan(order('delivered'));
    expect(order('delivered')).toBeLessThan(order('released'));
  });

  it('ignores a withdrawn plan', () => {
    expect(ticketPhase([plan('rejected'), plan('superseded')])).toBeNull();
    expect(ticketPhase([plan('rejected'), plan('delivered')])?.label).toBe('delivered');
  });
});

describe('allReleased', () => {
  it('answers false for an empty list — unplanned, not released-and-hidden', () => {
    expect(allReleased([])).toBe(false);
  });

  it('answers true when the one plan is released', () => {
    expect(allReleased([plan('released')])).toBe(true);
  });

  it('answers true when every plan is released', () => {
    expect(allReleased([plan('released'), plan('released')])).toBe(true);
  });

  it('answers false when another plan is still unfinished', () => {
    expect(allReleased([plan('released'), plan('approved')])).toBe(false);
  });
});
