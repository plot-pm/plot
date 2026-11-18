import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHASE_MAP, parsePhaseMap, TICKETS_ANCHOR, youHeader, deliveryGroupAnchor,
  type PhaseMap, type YouHeaderInput,
} from '../src/index.js';

const repoMap = (): PhaseMap => {
  const parsed = parsePhaseMap('Discovery = story:*; Design = plan:draft, plan:design; Development = plan:approved; Testing = plan:delivered; Released = plan:released');
  if (!parsed.ok) throw new Error('map refused');
  return parsed.map;
};

const base = (over: Partial<YouHeaderInput> = {}): YouHeaderInput => ({
  groups: [
    { key: 'blocks-delivery', count: 3 },
    { key: 'input-to-the-fleet', count: 1 },
    { key: 'unblock', count: 0 },
  ],
  tickets: [{ ownership: 'mine' }, { ownership: 'unknown' }, { ownership: 'theirs' }],
  ticketAnswer: 'answered',
  map: repoMap(),
  stories: [{ status: 'draft', plans: 0, ownership: 'mine' }],
  plans: [
    { phase: 'Design', ownership: 'mine', anchor: 'delivery-item-plan:a' },
    { phase: 'Design', ownership: 'theirs', anchor: 'delivery-item-plan:b' },
    { phase: 'Development', ownership: 'unknown', anchor: null },
  ],
  ...over,
});

describe('youHeader counts', () => {
  it('words each count and links a group with rows to its heading', () => {
    const { counts } = youHeader(base());
    expect(counts.map((c) => c.text)).toEqual([
      '3 block delivery', '1 inputs the fleet waits for', '0 to clean up', '2 tickets to triage',
    ]);
    expect(counts[0]!.anchor).toBe(deliveryGroupAnchor('blocks-delivery'));
  });

  it('links a group with no rows nowhere', () => {
    const { counts } = youHeader(base());
    expect(counts[2]!.anchor).toBeNull();
  });

  it('links the ticket count to the Tickets section', () => {
    const tickets = youHeader(base()).counts[3]!;
    expect(tickets.anchor).toBe(TICKETS_ANCHOR);
  });

  it('counts an unknown ticket and leaves out a theirs ticket', () => {
    expect(youHeader(base({ tickets: [{ ownership: 'unknown' }, { ownership: 'theirs' }] })).counts[3]!.count).toBe(1);
  });

  it.each(['failed', 'unsupported', null] as const)('shows the absence, not 0, where the issue answer is %s', (answer) => {
    const tickets = youHeader(base({ ticketAnswer: answer })).counts[3]!;
    expect(tickets.count).toBeNull();
    expect(tickets.text).toBe('tickets to triage: not read');
    expect(tickets.anchor).toBe(TICKETS_ANCHOR);
  });

  it('links a ticket count of 0 nowhere', () => {
    expect(youHeader(base({ tickets: [] })).counts[3]!.anchor).toBeNull();
  });
});

describe('youHeader phase strip', () => {
  it('reads this repository\'s map', () => {
    expect(youHeader(base()).stripLine).toBe('Discovery 3 ─▶ Design 1 ─▶ Development 1');
  });

  it('reads the default map the same way', () => {
    const header = youHeader(base({ map: DEFAULT_PHASE_MAP }));
    expect(header.stripLine).toBe('Discovery 3 ─▶ Design 1 ─▶ Development 1');
  });

  it('names the phases a renamed map declares', () => {
    const parsed = parsePhaseMap('Ideas = story:*; Shaping = plan:draft, plan:design; Building = plan:approved');
    if (!parsed.ok) throw new Error('map refused');
    const plans = [{ phase: 'Shaping', ownership: 'mine' as const, anchor: null }, { phase: 'Building', ownership: 'mine' as const, anchor: null }];
    expect(youHeader(base({ map: parsed.map, plans })).stripLine).toBe('Ideas 3 ─▶ Shaping 1 ─▶ Building 1');
  });

  it('keeps a count whose member no phase names, with no name', () => {
    const parsed = parsePhaseMap('Discovery = story:*; Design = plan:draft, plan:design');
    if (!parsed.ok) throw new Error('map refused');
    const header = youHeader(base({ map: parsed.map }));
    expect(header.strip[2]).toMatchObject({ name: null, count: 0, text: '0' });
    expect(header.stripLine).toBe('Discovery 3 ─▶ Design 1 ─▶ 0');
  });

  it('shows the story phase as absent, not 0, where the issue answer failed', () => {
    const header = youHeader(base({ ticketAnswer: 'failed' }));
    expect(header.strip[0]).toMatchObject({ count: null, text: 'Discovery —', anchor: null });
  });

  it('counts an unknown item and leaves out a theirs item', () => {
    const header = youHeader(base({
      stories: [{ status: 'draft', plans: 0, ownership: 'unknown' }, { status: 'draft', plans: 0, ownership: 'theirs' }],
      tickets: [{ ownership: 'theirs' }],
    }));
    expect(header.strip[0]!.count).toBe(1);
    expect(header.strip[1]!.count).toBe(1);
  });

  it('leaves out a story a plan answers and a story outside the phase', () => {
    const header = youHeader(base({
      tickets: [],
      stories: [{ status: 'draft', plans: 2, ownership: 'mine' }, { status: 'draft', plans: 0, ownership: 'mine' }],
    }));
    expect(header.strip[0]!.count).toBe(1);
  });

  it('links each phase with items to its first item and a phase with none nowhere', () => {
    const { strip } = youHeader(base());
    expect(strip[0]!.anchor).toBe(TICKETS_ANCHOR);
    expect(strip[1]!.anchor).toBe('delivery-item-plan:a');
    expect(strip[2]!.anchor).toBeNull();
    expect(youHeader(base({ plans: [], tickets: [] })).strip.map((e) => e.anchor)).toEqual([null, null, null]);
  });
});
