import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanActions } from '../../src/app/lib/agent-rows/menus.js';
import { CardSchema } from '../../src/contract/schema.js';
import { controlsFor } from '../fixtures/card-controls.js';
import { SOME_FACTS } from '../fixtures/card-facts.js';

// The plan row's menu offers Needs design where `controls.needsDesign` holds,
// which `cardControls` answers on a `draft` plan only — `needsDesign` shares
// the Approve binding rather than a route of its own, so the menu opens
// on every plan row, listing each act it cannot run disabled with its reason.
const render = (phase: 'Discovery' | 'Design'): string =>
  renderToStaticMarkup(createElement(PlanActions, {
    plan: 'a-plan',
    card: CardSchema.parse({
      slug: 'a-plan', title: 'A plan', type: 'feature', phase,
      path: 'docs/plans/2026-08-24-a-plan.md', facts: SOME_FACTS, controls: controlsFor({ phase }),
    }),
    approve: { available: true, reason: '' },
  }));

describe('PlanActions — needs design', () => {
  it('opens on a Draft plan, where needsDesign is offered', () => {
    const html = render('Discovery');
    expect(html).toContain('aria-label="Actions for a-plan"');
    expect(html).not.toContain('aria-disabled');
  });

  // The trigger is never disabled while its list holds an item: a refused Approve is listed disabled with its
  // reason inside the menu (`rowMenuOf`, test/unit/row-menu-items.test.ts), not on the trigger.
  it('opens on a Design plan too, where needsDesign is not offered and Approve is refused', () => {
    const html = renderToStaticMarkup(createElement(PlanActions, {
      plan: 'a-plan',
      card: CardSchema.parse({
        slug: 'a-plan', title: 'A plan', type: 'feature', phase: 'Design',
        path: 'docs/plans/2026-08-24-a-plan.md', facts: SOME_FACTS, controls: controlsFor({ phase: 'Design' }),
      }),
      approve: { available: false, reason: 'approve refused' },
    }));
    expect(html).toContain('aria-label="Actions for a-plan"');
    expect(html).not.toContain('aria-disabled');
  });
});
