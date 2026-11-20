import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { gatesCell, type Cell } from '@plot-pm/domain';
import { RowCell, type LinkHandlers } from '../../src/app/components/DeliveryRows.js';

/**
 * `RowCell` as markup: the gate marks carry the domain's outcome, the Do verb
 * keeps its class, and the Fleet cells it also renders keep their content.
 * The colours themselves are a browser reading, asserted in
 * `delivery-work-items.browser.test.ts`.
 */
const handlers: LinkHandlers = {
  context: {
    plan: '',
    branchUrlBase: 'https://github.com/tiny/garden/tree/',
    prUrl: (pr) => `https://github.com/tiny/garden/pull/${pr}`,
    checksUrl: (pr) => `https://github.com/tiny/garden/pull/${pr}/checks`,
    planFileOf: () => '',
    branchOfAgent: () => '',
  },
  onPlan: () => undefined,
  onReveal: () => undefined,
  onAct: () => undefined,
  onJump: () => undefined,
};

const render = (cell: Cell | null): string => renderToStaticMarkup(createElement(RowCell, { cell, handlers }));

const outcomes = (html: string): string[] => [...html.matchAll(/data-gate-outcome="([a-z]+)"/g)].map((m) => m[1]!);

describe('RowCell', () => {
  it('stamps each gate mark with the outcome gatesCell read, one span per mark', () => {
    expect(outcomes(render(gatesCell({ ci: 'running', review: 'none' }, 7)))).toEqual(['pending', 'none']);
    expect(outcomes(render(gatesCell({ ci: 'failed', review: 'high' }, 7)))).toEqual(['fail', 'fail']);
    expect(outcomes(render(gatesCell({ ci: 'passed', review: 'pending' }, 7)))).toEqual(['pass', 'pending']);
  });

  it('keeps the separator in the text between marks', () => {
    const html = render(gatesCell({ ci: 'running', review: 'none' }, 7));
    expect(html.replace(/<[^>]+>/g, '')).toBe('CI ⟳ · review –');
  });

  it('renders a part with no outcome without the attribute: absent is not none', () => {
    const html = render({
      value: 'open · 2 unpushed',
      links: [],
      parts: [{ value: 'open', link: null }, { value: '2 unpushed', link: null }],
    });
    expect(html).not.toContain('data-gate-outcome');
    expect(html.match(/data-gate-mark/g)).toHaveLength(2);
  });

  it('leaves the Do verb on the class string the You section colours', () => {
    const html = render({ value: 'Approve', links: [{ to: 'action', action: 'approve', id: 'p' }] });
    expect(html).toContain('data-row-do');
    expect(html).toContain('class="text-blue-600 hover:underline dark:text-blue-400"');
  });

  it('draws a link that leads somewhere as a tuple segment in the link colour', () => {
    const html = render({ value: '#7', links: [{ to: 'pr', pr: 7 }] });
    expect(html).toMatch(/<a href="https:\/\/github\.com\/tiny\/garden\/pull\/7" data-tuple-link="pr"[^>]*data-row-link=""[^>]*class="[^"]*text-blue-600 hover:underline/);
    expect(html).not.toContain('delivery-text-link');
  });

  it('still renders the role chip, the name and the attempt for an agent cell, as Fleet reads them', () => {
    const html = render({ value: 'fix-f3a1', links: [], agent: { role: 'fixer', attempt: '1/2' } });
    expect(html).toContain('fixer');
    expect(html).toContain('fix-f3a1');
    expect(html).toMatch(/<span data-agent-attempt="true"> 1\/2<\/span>/);
  });

  it('renders nothing for a cell nobody read', () => {
    expect(render(null)).toBe('');
  });

  it('shows an anchor link a filter hides as a disabled button that names the filter', () => {
    const hiding: LinkHandlers = { ...handlers, hiddenReason: (id) => (id === 'delivery-item-x' ? 'hidden by Mine' : null) };
    const cell: Cell = { value: 'x', links: [{ to: 'item', id: 'x' }] };
    const html = renderToStaticMarkup(createElement(RowCell, { cell, handlers: hiding }));
    expect(html).toMatch(/<button type="button" data-row-link="true" disabled="" data-hidden-reason="hidden by Mine" title="hidden by Mine"/);
    expect(html).not.toContain('href=');
    expect(renderToStaticMarkup(createElement(RowCell, { cell, handlers }))).toContain('href="#delivery-item-x"');
  });
});
