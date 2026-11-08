import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { card } from '../catalogue/index.js';
import { PlanCard } from '../../src/app/components/PlanCard.js';
import type { Card } from '../../src/contract/schema.js';

const render = (c: Card, props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(PlanCard, {
  card: c, accent: 'neutral', showSprint: true, showStory: true, onOpen: () => {}, ...props,
}));

describe('PlanCard renders safely', () => {
  it('a card the payload sent no facts for shows its title and an unreadable-card alert, rather than throwing', () => {
    const bare = { ...card({ slug: 'bare', title: 'A bare card' }) } as Partial<Card>;
    delete bare.facts;
    const html = render(bare as Card);
    expect(html).toContain('A bare card');
    // The title is still the card's open link.
    expect(html).toMatch(/<a href="\/plan\/2026-08-24-a-plan\.md"[^>]*data-card-title[^>]*>A bare card<\/a>/);
    expect(html).toContain('data-card-unreadable');
    expect(html).toContain('unreadable card');
  });

  it('an enabled action with no capability answer leaves no empty slot; the footer stays for the assignee and age', () => {
    // Ready to start, Start work enabled — but the board said nothing about dispatch.
    const ready = card({ slug: 'ready', title: 'Ready', phase: 'Development', started: false });
    expect(ready.facts.next.primary).toMatchObject({ action: 'start-work', enabled: true });
    const html = render(ready);
    expect(html).not.toContain('data-action-slot');
    expect(html).toContain('data-footer-band');
    expect(html).toContain('aria-label="Unassigned"');
  });

  it('keeps the row and the slot when the control renders', () => {
    const ready = card({ slug: 'ready', title: 'Ready', phase: 'Development', started: false });
    const html = render(ready, { dispatch: { available: true, reason: '' } });
    expect(html).toContain('data-card-row="next"');
    expect(html).toContain('data-action-slot="primary"');
  });

  it('leads the title row with the plan kind icon, named Plan', () => {
    const html = render(card({ slug: 'p', title: 'P' }));
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-label="Plan"[^>]*data-kind-icon="plan"/);
  });

  it('draws a disabled action as a focusable control described by its reason, with no native title', () => {
    const cold = card({ slug: 'cold', title: 'Cold', phase: 'Development', started: false, sliceSummary: { slices: 2, branches: 2, deferred: 0 } });
    expect(cold.facts.next.primary).toMatchObject({ action: 'start-work', enabled: false });
    const html = render(cold, { dispatch: { available: true, reason: '' } });
    const button = html.match(/<button[^>]*aria-disabled="true"[^>]*>Start work<\/button>/)?.[0] ?? '';
    expect(button).not.toBe('');
    expect(button).not.toContain('title=');
    expect(button).not.toContain(' disabled');
    const describedBy = button.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(html).toContain(`id="${describedBy}" role="tooltip"`);
    expect(html).toContain('no fleet scan yet');
    expect(html).toContain('data-action-band');
  });
});
