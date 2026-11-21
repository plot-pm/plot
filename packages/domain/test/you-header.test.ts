import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHASE_MAP, parsePhaseMap, TICKETS_ANCHOR, todoList, youHeader, deliveryGroupAnchor,
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

describe('youHeader release approvals', () => {
  // THE #3562 SHAPE: the to-do list held one "Approve release" line, so its header read
  // "You block 1 delivery", while the You row read "0 block delivery" from the empty group.
  const release = { id: 'release-row:changeset-release/main', label: '2.35.1', anchor: 'release-card-2.35.1', blocks: true, reason: '' };
  const waiting = { ...release, blocks: false, reason: 'CI has not reported on aaaaaaaaa' };
  const empty = [
    { key: 'blocks-delivery', count: 0 },
    { key: 'input-to-the-fleet', count: 0 },
    { key: 'unblock', count: 5 },
  ];

  it('counts each release the cards owe an approval for under block delivery', () => {
    const counts = youHeader(base({ groups: empty, releases: [release] })).counts;
    expect(counts[0]!.text).toBe('1 block delivery');
    expect(counts[0]!.anchor).toBe('release-card-2.35.1');
  });

  it('agrees with the to-do list header over the same release entries', () => {
    const head = youHeader(base({ groups: empty, releases: [release] })).counts[0]!.count;
    const todo = todoList({ items: [], ticketAnswer: 'answered', tickets: [], releases: [release] });
    expect(head).toBe(todo.counts['blocks-delivery']);
  });

  it('counts no release whose approval cannot run, and agrees with the to-do list', () => {
    const counts = youHeader(base({ groups: empty, releases: [waiting] })).counts;
    expect(counts[0]).toMatchObject({ count: 0, text: '0 block delivery', anchor: null });
    const todo = todoList({ items: [], ticketAnswer: 'answered', tickets: [], releases: [waiting] });
    expect(counts[0]!.count).toBe(todo.counts['blocks-delivery']);
  });

  it('links to the first release that blocks where only releases count', () => {
    const second = { ...release, id: 'release-row:two', anchor: 'release-card-2.36.0' };
    expect(youHeader(base({ groups: empty, releases: [waiting, second] })).counts[0]).toMatchObject({ count: 1, anchor: 'release-card-2.36.0' });
  });

  it('keeps the group anchor where the group has rows', () => {
    const counts = youHeader(base({ releases: [release] })).counts;
    expect(counts[0]!.text).toBe('4 block delivery');
    expect(counts[0]!.anchor).toBe(deliveryGroupAnchor('blocks-delivery'));
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

describe('youHeader phase holders', () => {
  const mapOf = (text: string): PhaseMap => {
    const parsed = parsePhaseMap(text);
    if (!parsed.ok) throw new Error('map refused');
    return parsed.map;
  };

  it('finds the design phase by plan:design alone and by plan:draft alone', () => {
    const designOnly = youHeader(base({ map: mapOf('Found = story:*; Shape = plan:design; Build = plan:approved') }));
    expect(designOnly.strip[1]!.name).toBe('Shape');
    const draftOnly = youHeader(base({ map: mapOf('Found = story:*; Shape = plan:draft; Build = plan:approved') }));
    expect(draftOnly.strip[1]!.name).toBe('Shape');
  });

  it('counts every unplanned live story where the map names no story phase', () => {
    const noStory = mapOf('Shape = plan:draft, plan:design; Build = plan:approved');
    const { strip } = youHeader(base({ map: noStory, stories: [{ status: 'anything', plans: 0, ownership: 'mine' }] }));
    expect(strip[0]).toMatchObject({ name: null, count: 3 });
    expect(strip[0]!.text).toBe('3');
  });

  it('shows a bare dash for a story slot with no name and no ticket answer', () => {
    const noStory = mapOf('Shape = plan:draft, plan:design; Build = plan:approved');
    const { strip } = youHeader(base({ map: noStory, ticketAnswer: null }));
    expect(strip[0]).toMatchObject({ name: null, count: null, text: '—' });
  });

  it('links a plan phase to the first item that has an anchor', () => {
    const plans = [
      { phase: 'Design', ownership: 'mine' as const, anchor: null },
      { phase: 'Design', ownership: 'mine' as const, anchor: 'delivery-item-plan:c' },
    ];
    expect(youHeader(base({ plans })).strip[1]!.anchor).toBe('delivery-item-plan:c');
  });

  it('ignores a group key the header does not word', () => {
    const { counts } = youHeader(base({ groups: [{ key: 'elsewhere', count: 4 }] }));
    expect(counts.map((c) => c.key)).toEqual(['tickets']);
  });
});

describe('YouHeaderCount.words', () => {
  it('follows the number and holds none', () => {
    for (const c of youHeader(base()).counts) {
      expect(c.words).not.toMatch(/\d/);
      if (c.count !== null) expect(c.text).toBe(`${c.count} ${c.words}`);
    }
  });
  it('keeps count null and says the reading is missing where the tracker did not answer', () => {
    const tickets = youHeader(base({ ticketAnswer: 'failed' })).counts[3]!;
    expect(tickets.count).toBeNull();
    expect(tickets.words).toBe('tickets to triage: not read');
  });
});
