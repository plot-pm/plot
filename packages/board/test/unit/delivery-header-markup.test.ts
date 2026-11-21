import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deliveryHeader, TICKETS_ANCHOR, type DeliveryHeaderInput } from '@plot-pm/domain';
import { DeliveryHeader } from '../../src/app/components/DeliveryHeader.js';
import { TONE_CLASS } from '../../src/app/lib/agent-rows/state-classes.js';

const input = (over: Partial<DeliveryHeaderInput> = {}): DeliveryHeaderInput => ({
  you: {
    counts: [
      { key: 'blocks-delivery', count: 1 }, { key: 'input-to-the-fleet', count: 0 },
      { key: 'unblock', count: 2 }, { key: 'tickets', count: 3 },
    ],
    ages: [120],
    releases: [],
    ticketNote: null,
  },
  work: { groups: [{ key: 'at-a-gate', count: 1 }], ages: [] },
  unplaced: [],
  agents: [{ group: 'working' }, { group: 'free' }],
  supervisor: { state: 'up', label: 'fleet running', shown: false },
  switches: { dispatch: true, review: false, verify: true, design: false },
  parallelAgents: 4,
  machine: { headroom: 'clear', load1: 2, cores: 8, host: { connector: 'github', buckets: [{ bucket: '', limit: 100, remaining: 50, resetAt: null }] } },
  hostAnswer: 'answered',
  ...over,
});

const render = (over: Partial<DeliveryHeaderInput> = {}, onJump: (a: string) => void = () => {}): string =>
  renderToStaticMarkup(createElement(DeliveryHeader, { header: deliveryHeader(input(over)), release: createElement('p', null, 'release slot'), onJump }));

/** The markup of one group, from its opening tag to the next group. */
const group = (html: string, key: string): string => {
  const start = html.indexOf(`data-header-group="${key}"`);
  const next = html.indexOf('data-header-group=', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
};

/** The text of a markup string, tags removed. */
const text = (html: string): string => html.replace(/<[^>]+>/g, '');

describe('the Delivery header markup', () => {
  it('renders five groups in one card, the release slot first, with no fold and no aria-expanded', () => {
    const html = render();
    expect([...html.matchAll(/data-header-group="([^"]+)"/g)].map((m) => m[1])).toEqual(['release', 'you', 'work-items', 'fleet', 'machine']);
    expect(group(html, 'release')).toContain('release slot');
    expect(html).not.toContain('aria-expanded');
    expect(html.match(/data-tab-header=/g)).toHaveLength(1);
  });

  it('renders each You number in its tone, and a zero number muted', () => {
    const you = group(render(), 'you');
    expect(you).toMatch(new RegExp(`data-header-number="blocks-delivery" data-count="1" class="${TONE_CLASS.red}"`));
    expect(you).toMatch(/data-header-number="input-to-the-fleet" data-count="0" class="delivery-text-muted"/);
    expect(text(you)).toContain('oldest waits 2h');
    expect(text(you)).toContain('3 tickets need triage');
  });

  it('shows the amber unread clause and no clear sentence where an item is unread', () => {
    const zero = { ...input().you, counts: input().you.counts.map((c) => ({ ...c, count: 0 })) };
    const calm = render({ you: zero, work: { groups: [], ages: [] } });
    expect(group(calm, 'you')).toContain('data-header-clear');
    expect(group(calm, 'work-items')).toContain('data-header-clear');
    const html = render({ you: zero, work: { groups: [], ages: [] }, unplaced: [{ subject: 'item', reason: 'unread' }] });
    for (const key of ['you', 'work-items']) {
      expect(group(html, key)).toMatch(/data-header-unread="true" class="delivery-hue-amber[^"]*">! 1 not read</);
      expect(group(html, key)).not.toContain('data-header-clear');
    }
  });

  it('renders a release approval that cannot run as a grey line with its reason', () => {
    const you = { ...input().you, releases: [{ label: '2.35.0', blocks: false, reason: 'CI is still running' }] };
    expect(group(render({ you }), 'you')).toMatch(/data-header-release-wait="true" class="delivery-text-muted">Approve release 2.35.0 · CI is still running</);
  });

  it('jumps to the section from open › and to the tickets from triage ›', () => {
    const html = render();
    for (const key of ['you', 'work-items', 'fleet', 'machine']) expect(html).toContain(`data-header-open="${key}"`);
    expect(html).toMatch(/data-header-triage="true"[^>]*>.*triage ›<\/button>/);
    expect(TICKETS_ANCHOR).toBe('tickets');
  });

  it('renders the fleet marks as text and no input, and the stopped status in red', () => {
    const fleet = group(render(), 'fleet');
    expect(fleet).not.toMatch(/<input|role="spinbutton"/);
    expect(text(fleet)).toContain('✓ dispatch– review✓ verify– designparallel 4');
    const stopped = group(render({ supervisor: { state: 'down', label: 'fleet down', shown: true } }), 'fleet');
    expect(stopped).toMatch(/data-header-status="true" class="delivery-hue-red[^"]*">fleet stopped</);
  });

  it('labels a one-pool host meter API, never an empty label', () => {
    const machine = group(render(), 'machine');
    expect(text(machine)).toContain('API 50 / 100 left');
    expect(text(machine)).toContain('load 2.0 of 8 cores');
  });
});
