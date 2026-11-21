import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PersonCard, PlanLinkKey } from '@plot-pm/domain';
import { lineBody, LineState, PhaseChip, PlanName, PLAN_TRACKS, PlanStrip, ReleaseHeaderCounts, ReleaseLine } from '../../src/app/components/ReleasePlanParts.js';
import { ReleasePersonCards } from '../../src/app/components/ReleasePersonCards.js';
import { TicketHrefContext } from '../../src/app/components/PlanTicketKeys.js';
import { SEGMENT_CLASS } from '../../src/app/lib/agent-rows/state-classes.js';

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

describe('the plan table', () => {
  it('gives the actions track a fixed width, so the header and the rows share every track', () => {
    expect(PLAN_TRACKS.split('_').at(-1)).toBe('1.25rem]');
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

describe('the Release delivery header line', () => {
  const head = {
    scope: '2.36.0', title: '2.36.0 · 8 plans',
    counts: [
      { key: 'plans' as const, count: 8, words: 'plans', target: 'p', anchor: 'delivery-plan-p' },
      { key: 'at-a-gate' as const, count: 3, words: 'at a gate', target: 'q', anchor: 'delivery-plan-q' },
      { key: 'blocked' as const, count: 0, words: 'blocked', target: null, anchor: null },
    ],
  };
  it('links a non-zero count and prints a 0 count as text', () => {
    const html = renderToStaticMarkup(createElement(ReleaseHeaderCounts, { head, onJump: () => {} }));
    expect(html).toContain('<span data-release-header-scope="true" class="delivery-release-label">2.36.0</span>');
    expect(html).toContain('data-release-header-link="plans"');
    expect(html).toContain('<b class="delivery-count-n delivery-hue-amber">3</b> at a gate');
    expect(html).not.toContain('data-release-header-link="blocked"');
    expect(html).toContain('<span data-release-header-count="blocked"><b class="delivery-count-n delivery-hue-red">0</b> blocked</span>');
  });
  it('prints no scope where the section holds several blocks', () => {
    const html = renderToStaticMarkup(createElement(ReleaseHeaderCounts, { head: { ...head, scope: '', title: '' }, onJump: () => {} }));
    expect(html).not.toContain('data-release-header-scope');
    expect(html).not.toContain('title=');
  });
});

describe('an opened plan line', () => {
  it('names a slice at a gate and one being built in the mockups\' words and hues', () => {
    expect(renderToStaticMarkup(createElement(LineState, { state: 'at-a-gate' }))).toBe('<span data-plan-line-state="at-a-gate" class="delivery-release-state delivery-hue-amber">⟳ at CI</span>');
    expect(renderToStaticMarkup(createElement(LineState, { state: 'being-built' }))).toBe('<span data-plan-line-state="being-built" class="delivery-release-state delivery-hue-blue">● building</span>');
  });

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

describe('the Plan cell', () => {
  const cell = (href: string, open = false, label = 'red-hold', keys: PlanLinkKey[] = []) => renderToStaticMarkup(createElement(
    TicketHrefContext.Provider,
    { value: (key: string) => (/^\d+$/.test(key) ? `https://github.com/o/r/issues/${key}` : undefined) },
    createElement(PlanName, { plan: { plan: 'red-hold', label, keys, planFile: '2026-11-09-red-hold.md', href }, open, onToggle: () => {} }),
  ));
  const keys = [{ key: '3489', text: '#3489' }, { key: '2531', text: '#2531' }];

  it('draws each ticket key as a ticket segment before the plan segment, which prints the slug alone', () => {
    const html = cell('/plan/2026-11-09-red-hold.md', false, '#3489 #2531 red-hold', keys);
    expect(html).toContain('title="#3489 #2531 red-hold"');
    expect(html).toMatch(/<a href="https:\/\/github\.com\/o\/r\/issues\/3489" data-tuple-link="ticket"[^>]*data-ticket-link="3489"/);
    expect(html).toMatch(/<a href="https:\/\/github\.com\/o\/r\/issues\/2531" data-tuple-link="ticket"[^>]*data-ticket-link="2531"/);
    expect(html).toMatch(/data-plan-link="red-hold"[^>]*>.*<span class="min-w-0 truncate">red-hold<\/span><\/a>/);
    expect(html.indexOf('data-ticket-link="2531"')).toBeLessThan(html.indexOf('data-plan-link'));
  });

  it('prints a key with no address as a text segment, never as a link', () => {
    const html = cell('', false, 'ABC-123 red-hold', [{ key: 'ABC-123', text: 'ABC-123' }]);
    expect(html).toMatch(/<span data-tuple-text="ticket"[^>]*>.*ABC-123<\/span><\/span>/);
    expect(html).not.toContain('data-ticket-link');
    expect(html).toContain('<span data-tuple-text="plan"');
  });

  it('links the plan name to its route and keeps the toggle on the chevron alone', () => {
    const html = cell('/plan/2026-11-09-red-hold.md');
    expect(html).toContain('<a href="/plan/2026-11-09-red-hold.md" data-tuple-link="plan"');
    expect(html).toContain('data-plan-link="red-hold"');
    expect(html).toMatch(/<button type="button" data-plan-toggle="red-hold" aria-expanded="false" aria-label="Show the slices of red-hold"[^>]*><span aria-hidden="true"[^>]*>▸<\/span><\/button>/);
  });

  it('names the toggle Hide once the row is open', () => {
    expect(cell('/plan/x.md', true)).toContain('aria-label="Hide the slices of red-hold"');
  });

  it('shows the plan as a text segment where the row has no plan file', () => {
    const html = cell('');
    expect(html).not.toContain('<a ');
    expect(html).toMatch(/<span data-tuple-text="plan"[^>]*>.*red-hold<\/span><\/span>/);
  });
});
