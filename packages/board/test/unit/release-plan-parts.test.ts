import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PersonCard } from '@plot-pm/domain';
import { lineBody, PhaseChip, PlanStrip, ReleaseLine } from '../../src/app/components/ReleasePlanParts.js';
import { ReleasePersonCards } from '../../src/app/components/ReleasePersonCards.js';
import { SEGMENT_CLASS } from '../../src/app/components/SprintCard.js';

const strip = (over: Partial<Parameters<typeof PlanStrip>[0]['plan']> = {}) =>
  renderToStaticMarkup(createElement(PlanStrip, { plan: { strip: [], stripText: '', unread: 0, ...over } }));

const blocks = (html: string) => [...html.matchAll(/class="delivery-strip-block ([^"]+)"/g)].map((m) => m[1]);

describe('the Release plan strip', () => {
  it('draws one block per slice in strip order, each in its state class', () => {
    const html = strip({ strip: [{ state: 'delivered', count: 3 }, { state: 'not-started', count: 2 }], stripText: '3 of 5 delivered' });
    expect(blocks(html)).toEqual([
      'delivery-state-delivered', 'delivery-state-delivered', 'delivery-state-delivered',
      'delivery-state-not-started', 'delivery-state-not-started',
    ]);
    expect(html).toContain('data-strip-segment="delivered"');
    expect(html).toContain('<span class="sr-only">3 delivered</span>');
    expect(html).toContain('<span class="sr-only">2 not-started</span>');
    expect(html).toContain('<span data-strip-text="true" class="delivery-release-strip-text">3 of 5 delivered</span>');
  });

  it('draws no block for an unread slice and keeps the unread words', () => {
    const html = strip({ strip: [{ state: 'delivered', count: 1 }], unread: 2 });
    expect(blocks(html)).toEqual(['delivery-state-delivered']);
    expect(html).toContain('<span data-strip-unread="true" class="delivery-release-strip-text">2 not read</span>');
  });
});

describe('the Phase chip', () => {
  it('shows the phase word in the hue of its accent', () => {
    const html = renderToStaticMarkup(createElement(PhaseChip, { plan: { phase: 'Testing', accent: 'Testing' } }));
    expect(html).toBe('<span data-plan-phase-chip="Testing" class="delivery-chip delivery-hue-violet">Testing</span>');
  });

  it('renders nothing where the plan has no phase', () => {
    expect(renderToStaticMarkup(createElement(PhaseChip, { plan: {} }))).toBe('');
  });
});

describe('the Release header bar', () => {
  it('prints each count bold in its hue, and the header only as the title', () => {
    const html = renderToStaticMarkup(createElement(ReleaseLine, { block: {
      release: 'v2', name: '', header: 'v2 · 3 plans · 1 ticket',
      counts: [{ key: 'plans', count: 3, words: 'plans' }, { key: 'delivered', count: 2, words: 'delivered' }, { key: 'blocked', count: 1, words: 'blocked' }],
    } }));
    expect(html).toContain('title="v2 · 3 plans · 1 ticket"');
    expect(html).toContain('<span data-release-count="plans"><b class="delivery-count-n ">3</b>');
    expect(html).toContain('<b class="delivery-count-n delivery-hue-green">2</b>');
    expect(html).toContain('<b class="delivery-count-n delivery-hue-red">1</b>');
    expect(html).not.toContain('1 ticket<');
  });
});

describe('an opened plan line', () => {
  it('splits a Done line with a PR into the slice name and keeps the commit where there is none', () => {
    expect(lineBody({ heading: 'done', slice: 'Beds', text: '✓ merged · Beds · #12 · 2026-11-01', pr: 12 })).toBe('Beds');
    expect(lineBody({ heading: 'done', slice: 'Beds', text: '✓ merged · Beds · abc1234' })).toBe('Beds · abc1234');
    expect(lineBody({ heading: 'to-do', slice: 'Beds', text: 'Beds · waits for Soil' })).toBe('Beds · waits for Soil');
  });
});

describe('the person cards', () => {
  it('colour a blocked segment with the class the sprint card uses', () => {
    const cards: PersonCard[] = [{ key: 'g', label: 'Gardener', sprints: [{ slug: 's', title: 'Spring', bar: [{ state: 'blocked', count: 1 }], missingText: '' }] }] as unknown as PersonCard[];
    const html = renderToStaticMarkup(createElement(ReleasePersonCards, { cards }));
    expect(html).toContain(`data-person-card-segment="blocked" data-count="1" style="flex-grow:1" class="${SEGMENT_CLASS.blocked}"`);
    expect(SEGMENT_CLASS.blocked).toBe('delivery-state-blocked');
  });
});
