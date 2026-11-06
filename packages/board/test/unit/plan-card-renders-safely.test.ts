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
    expect(html).toContain('data-card-unreadable');
    expect(html).toContain('unreadable card');
  });

  it('an enabled action with no capability answer leaves no empty slot, and no action row at all', () => {
    // Ready to start, Start work enabled — but the board said nothing about dispatch.
    const ready = card({ slug: 'ready', title: 'Ready', phase: 'Development', started: false });
    expect(ready.facts.next.primary).toMatchObject({ action: 'start-work', enabled: true });
    const html = render(ready);
    expect(html).not.toContain('data-action-slot');
    expect(html).not.toContain('data-card-row="next"');
  });

  it('keeps the row and the slot when the control renders', () => {
    const ready = card({ slug: 'ready', title: 'Ready', phase: 'Development', started: false });
    const html = render(ready, { dispatch: { available: true, reason: '' } });
    expect(html).toContain('data-card-row="next"');
    expect(html).toContain('data-action-slot="primary"');
  });
});
