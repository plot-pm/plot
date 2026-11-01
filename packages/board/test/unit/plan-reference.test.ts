import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { planReference, planIndexOf, type PlanReferenceAnswer } from '@plot-pm/domain';
import { PlanReference, isPlainPlanClick } from '../../src/app/components/PlanReference.js';

const render = (answer: PlanReferenceAnswer, file?: string, onOpenPlan?: (file: string) => boolean): string =>
  renderToStaticMarkup(createElement(PlanReference, { answer, file, onOpenPlan }));

describe('PlanReference', () => {
  it('never truncates the prefix — it carries shrink-0, the slug carries truncate', () => {
    const answer = planReference({ slug: 'a-plan', file: 'a-plan.md', issues: ['1089'] }, planIndexOf({}));
    const html = render(answer);
    expect(html).toContain('class="shrink-0">1089: </span>');
    expect(html).toContain('truncate');
  });

  it('keeps two plans sharing an issue key distinguishable: an 8ch floor and the full label in title/aria-label', () => {
    const answer = planReference({ slug: 'a-very-long-plan-slug-name', file: 'a.md' }, planIndexOf({ cards: [{ slug: 'a-very-long-plan-slug-name', title: 'Plan title', path: 'a.md', issues: ['42'] }] }));
    const html = render(answer);
    expect(html).toContain('min-w-[8ch]');
    expect(html).toContain('title="42: a-very-long-plan-slug-name — Plan title"');
    expect(html).toContain('aria-label="Plan 42: a-very-long-plan-slug-name"');
  });

  it('starts the accessible name with the visible text', () => {
    const answer = planReference({ slug: 'a', issues: ['7'] }, planIndexOf({}));
    const html = render(answer);
    expect(html).toContain('aria-label="Plan 7: a"');
  });

  it('renders a real anchor with no href where the reference resolved one', () => {
    const answer = planReference({ slug: 'a', file: 'a.md' }, planIndexOf({}));
    const html = render(answer, 'a.md', () => true);
    expect(html).toContain('<a ');
    expect(html).toContain('href="/plan/a.md"');
    expect(html).toContain('data-tuple-link="plan"');
    expect(html).toContain('data-plan-ref');
    expect(html).not.toContain(' target=');
  });

  it('renders a span, not a link, where nothing resolved', () => {
    const answer = planReference({ slug: 'gone', issues: ['5'] }, planIndexOf({}));
    const html = render(answer);
    expect(html).toContain('<span');
    expect(html).toContain('data-tuple-text="plan"');
    expect(html).not.toContain('<a ');
  });
});

describe('isPlainPlanClick', () => {
  it('admits an unmodified primary click', () => {
    expect(isPlainPlanClick({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0 })).toBe(true);
  });

  it('refuses Cmd/Ctrl/Shift/Alt and a non-primary button — browser handling, like opening a new tab, is never intercepted', () => {
    expect(isPlainPlanClick({ metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, button: 0 })).toBe(false);
    expect(isPlainPlanClick({ metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, button: 0 })).toBe(false);
    expect(isPlainPlanClick({ metaKey: false, ctrlKey: false, shiftKey: true, altKey: false, button: 0 })).toBe(false);
    expect(isPlainPlanClick({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: true, button: 0 })).toBe(false);
    expect(isPlainPlanClick({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 1 })).toBe(false);
  });
});
