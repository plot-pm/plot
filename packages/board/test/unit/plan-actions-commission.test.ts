import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanActions } from '../../src/app/lib/agent-rows/menus.js';
import { card } from '../catalogue/build.js';

// The plan row's menu offers Commission design where `controls.commission`
// holds, which `cardControls` answers on a `draft` plan only: the commission
// endpoint refuses every other state. Approve is refused in both renders, so
// the menu opens only where Commission is offered and will act.
const render = (phase: 'Discovery' | 'Design'): string =>
  renderToStaticMarkup(createElement(PlanActions, {
    plan: 'a-plan',
    card: card({ phase }),
    approve: { available: false, reason: 'approve refused' },
    commission: { available: true, reason: '' },
  }));

describe('PlanActions — Commission design', () => {
  it('opens on a Draft plan, where Commission is offered', () => {
    const html = render('Discovery');
    expect(html).toContain('aria-label="Actions for a-plan"');
    expect(html).not.toContain('aria-disabled');
  });

  it('stays shut on a Design plan, where Commission is not offered', () => {
    const html = render('Design');
    expect(html).toContain('aria-label="approve refused"');
    expect(html).toContain('aria-disabled="true"');
  });
});
