import { describe, it, expect } from 'vitest';
import { trackerFixture } from '@plot-pm/domain/adapters';
import type { Issue } from '@plot-pm/domain/entities/issue';
import type { Tracker } from '@plot-pm/domain/ports/tracker';
import { EXIT, inputFrom, main, run, verdict, type GateWorld } from '../../src/server/entry/sprint-release-gate.js';

/** One sprint item as `plot-sprint-release.sh` writes it, for any tier. */
type ReportItem = { text: string; issues: (string | number)[]; ticket?: string; state?: string };

/** One sprint block as `plot-sprint-release.sh` writes it. */
const report = (release: string, must: ReportItem[], sprint = 'demo'): string =>
  JSON.stringify({ sprints: [{ sprint, release, must }] });

/** One sprint block carrying all three MoSCoW tiers, as `plot-sprint-release.sh` writes it. */
const reportWithTiers = (
  release: string,
  tiers: { must?: ReportItem[]; should?: ReportItem[]; could?: ReportItem[] },
  sprint = 'demo',
): string => JSON.stringify({ sprints: [{ sprint, release, ...tiers }] });

/** A Release issue as the fixture answers it. */
const issue = (id: string): Issue => ({ id }) as Issue;

/** A tracker fixture holding Release `2.0.0` with the given issue keys. */
const releaseHolding = (...keys: string[]): Tracker =>
  trackerFixture({
    versions: { '2.0.0': { name: '2.0.0', released: false, releaseDate: null } },
    labelled: { 'fixVersion:2.0.0': keys.map(issue) },
  });

/** A world answering `config` from `keys`, and counting how often a tracker was built. */
const world = (keys: Record<string, string>, tracker: Tracker = releaseHolding()): GateWorld & { built: number } => {
  const w = {
    built: 0,
    config: async (key: string) => keys[key] ?? '',
    tracker: async () => {
      w.built += 1;
      return tracker;
    },
  };
  return w;
};

/** Runs the gate and collects what it wrote. */
const runGate = async (text: string, w: GateWorld): Promise<{ code: number; out: string; err: string }> => {
  let out = '';
  let err = '';
  const code = await run(text, w, (s) => (out += s), (s) => (err += s));
  return { code, out, err };
};

const jiraOwnedByPlot = { Tracker: 'jira https://example.atlassian.net PROJ', 'Sprint owner': 'plot' };

describe('a repository without a version-reading tracker reports no Release drift', () => {
  it('answers no entry and builds no tracker where no tracker is declared', async () => {
    const w = world({});
    const r = await runGate(report('2.0.0', [{ text: 'a', issues: [12] }]), w);
    expect(r.code).toBe(EXIT.ok);
    expect(JSON.parse(r.out)).toEqual({ sprints: [] });
    expect(w.built).toBe(0);
  });

  it('answers no entry where Plot owns the sprints and the tracker is GitHub issues', async () => {
    const w = world({ Tracker: 'github-issues', 'Sprint owner': 'plot' });
    const r = await runGate(report('2.0.0', [{ text: 'a', issues: [12] }]), w);
    expect(JSON.parse(r.out)).toEqual({ sprints: [] });
    expect(r.err).toBe('');
    expect(w.built).toBe(0);
  });
});

describe('the sprint-owner refusal', () => {
  it('exits 3 and names the tracker where an external tracker owns the sprints', async () => {
    const w = world({ Tracker: 'jira https://example.atlassian.net PROJ' });
    const r = await runGate('{}', w);
    expect(r.code).toBe(EXIT.externalOwner);
    expect(r.err).toContain("'jira'");
    expect(r.out).toBe('');
    expect(w.built).toBe(0);
  });

  it('answers the owner check alone from empty input', async () => {
    const w = world(jiraOwnedByPlot);
    const r = await runGate('{}', w);
    expect(r.code).toBe(EXIT.ok);
    expect(JSON.parse(r.out)).toEqual({ sprints: [] });
    expect(w.built).toBe(0);
  });
});

describe('unreadable input', () => {
  it('exits 2 on input that is not JSON', async () => {
    const r = await runGate('not json', world(jiraOwnedByPlot));
    expect(r.code).toBe(EXIT.usage);
    expect(r.err).toContain('could not read the sprint report');
  });

  it("exits 2 where 'sprints' is not a list", async () => {
    const r = await runGate('{"sprints":{}}', world(jiraOwnedByPlot));
    expect(r.code).toBe(EXIT.usage);
  });

  it("exits 2 where a sprint's 'must' is not a list", async () => {
    const r = await runGate('{"sprints":[{"sprint":"demo","release":"2.0.0","must":{}}]}', world(jiraOwnedByPlot));
    expect(r.code).toBe(EXIT.usage);
    expect(r.err).toContain("'demo'");
  });

  it("exits 2 where a sprint's 'should' is not a list, the same refusal 'must' gets", async () => {
    const r = await runGate('{"sprints":[{"sprint":"demo","release":"2.0.0","should":{}}]}', world(jiraOwnedByPlot));
    expect(r.code).toBe(EXIT.usage);
    expect(r.err).toContain("'demo'");
    expect(r.err).toContain("'should'");
  });
});

describe('inputFrom', () => {
  it('gives a sprint with no Release: no entry', () => {
    expect(inputFrom(report('', [{ text: 'a', issues: ['PROJ-1'] }])).releases).toEqual([]);
  });

  it('takes the first Jira-shaped key and never a bare issue number', () => {
    const input = inputFrom(report('2.0.0', [{ text: 'a', issues: [12, 'PROJ-1', 'PROJ-2'] }, { text: 'b', issues: [7] }]));
    expect(input.releases[0]?.mustHaves).toEqual([
      { text: 'a', issue: 'PROJ-1', state: 'open' },
      { text: 'b', issue: '', state: 'open' },
    ]);
  });

  it('falls back to ticket frontmatter where the Issue line names no Jira key', () => {
    const input = inputFrom(report('2.0.0', [{ text: 'a', issues: [], ticket: 'PROJ-9' }]));
    expect(input.releases[0]?.mustHaves).toEqual([{ text: 'a', issue: 'PROJ-9', state: 'open' }]);
  });

  it('falls back to item text matched against Ticket prefixes where neither other source names a key', () => {
    const input = inputFrom(report('2.0.0', [{ text: 'Tracer bullet for the thing (PROJ-3858)', issues: [] }]), ['PROJ']);
    expect(input.releases[0]?.mustHaves).toEqual([
      { text: 'Tracer bullet for the thing (PROJ-3858)', issue: 'PROJ-3858', state: 'open' },
    ]);
  });

  it('leaves a Must-have unresolved where no source and no declared prefix name a key', () => {
    const input = inputFrom(report('2.0.0', [{ text: 'Tracer bullet for the thing (PROJ-3858)', issues: [] }]));
    expect(input.releases[0]?.mustHaves).toEqual([
      { text: 'Tracer bullet for the thing (PROJ-3858)', issue: '', state: 'open' },
    ]);
  });

  it('asks for a page of 200 — the report names no limit for the gate to read', () => {
    expect(inputFrom('{}').limit).toBe(200);
  });
});

describe('the Release comparison where Plot owns the sprint under Jira', () => {
  it('reports drift in both directions', async () => {
    const w = world(jiraOwnedByPlot, releaseHolding('PROJ-1', 'PROJ-9'));
    const r = await runGate(report('2.0.0', [{ text: 'a', issues: ['PROJ-1'] }, { text: 'b', issues: ['PROJ-2'] }]), w);
    expect(r.code).toBe(EXIT.ok);
    expect(JSON.parse(r.out)).toEqual({
      sprints: [
        {
          sprint: 'demo',
          release: '2.0.0',
          verdict: {
            checked: true,
            missingFromRelease: [{ text: 'b', issue: 'PROJ-2', state: 'open' }],
            missingFromSprint: ['PROJ-9'],
            notCompared: [],
          },
        },
      ],
    });
  });

  it('reports a Must-have with no resolvable key as notCompared, never as missingFromRelease', async () => {
    const w = world(jiraOwnedByPlot, releaseHolding('PROJ-1'));
    const r = await runGate(
      report('2.0.0', [{ text: 'a', issues: ['PROJ-1'] }, { text: 'ship the other thing', issues: [] }]),
      w,
    );
    expect(r.code).toBe(EXIT.ok);
    expect(JSON.parse(r.out)).toEqual({
      sprints: [
        {
          sprint: 'demo',
          release: '2.0.0',
          verdict: {
            checked: true,
            missingFromRelease: [],
            missingFromSprint: [],
            notCompared: [{ text: 'ship the other thing', issue: '', state: 'open' }],
          },
        },
      ],
    });
  });

  it('resolves a Must-have from item text against the configured Ticket prefixes', async () => {
    const w = world(
      { ...jiraOwnedByPlot, 'Ticket prefixes': 'PROJ' },
      releaseHolding('PROJ-3858'),
    );
    const r = await runGate(report('2.0.0', [{ text: 'Tracer bullet for the thing (PROJ-3858)', issues: [] }]), w);
    expect(JSON.parse(r.out).sprints[0].verdict).toEqual({
      checked: true,
      missingFromRelease: [],
      missingFromSprint: [],
      notCompared: [],
    });
  });

  it('resolves a Must-have from ticket frontmatter where the Issue line names no key', async () => {
    const w = world(jiraOwnedByPlot, releaseHolding('PROJ-9'));
    const r = await runGate(report('2.0.0', [{ text: 'a', issues: [], ticket: 'PROJ-9' }]), w);
    expect(JSON.parse(r.out).sprints[0].verdict).toEqual({
      checked: true,
      missingFromRelease: [],
      missingFromSprint: [],
      notCompared: [],
    });
  });

  it('names a version the tracker does not know, rather than a generic line', async () => {
    const answered = await verdict(inputFrom(report('9.9.9', [])), releaseHolding());
    expect(answered.sprints[0]?.verdict).toMatchObject({ checked: false, unreachable: true });
    expect(JSON.stringify(answered)).toContain('version-not-found');
  });

  it('reads should and could tiers into the drift, with Release keys named only by those tiers', async () => {
    const w = world(jiraOwnedByPlot, releaseHolding('PROJ-1', 'PROJ-2', 'PROJ-3', 'PROJ-9'));
    const r = await runGate(
      reportWithTiers('2.0.0', {
        must: [{ text: 'a', issues: ['PROJ-1'] }],
        should: [{ text: 'b', issues: ['PROJ-2'] }],
        could: [{ text: 'c', issues: ['PROJ-3'] }],
      }),
      w,
    );
    expect(r.code).toBe(EXIT.ok);
    expect(JSON.parse(r.out)).toEqual({
      sprints: [
        {
          sprint: 'demo',
          release: '2.0.0',
          verdict: {
            checked: true,
            missingFromRelease: [],
            missingFromSprint: ['PROJ-9'],
            notCompared: [],
          },
        },
      ],
    });
  });

  it('says the tracker could not be reached where the read failed', async () => {
    const failing = { ...releaseHolding(), versionRead: async () => ({ ok: false, why: 'failed' }) } as unknown as Tracker;
    const answered = await verdict(inputFrom(report('2.0.0', [])), failing);
    expect(answered.sprints[0]?.verdict).toEqual({
      checked: false,
      unreachable: true,
      reason: 'the tracker could not be reached',
    });
  });

  it('excludes a withdrawn Must-have from missingFromRelease and notCompared, never reporting it as drift', async () => {
    const w = world(jiraOwnedByPlot, releaseHolding('PROJ-1'));
    const r = await runGate(
      report('2.0.0', [
        { text: 'a', issues: ['PROJ-1'] },
        { text: 'dropped', issues: ['PROJ-2'], state: 'withdrawn' },
        { text: 'dropped, no key', issues: [], state: 'withdrawn' },
      ]),
      w,
    );
    expect(r.code).toBe(EXIT.ok);
    expect(JSON.parse(r.out)).toEqual({
      sprints: [
        {
          sprint: 'demo',
          release: '2.0.0',
          verdict: {
            checked: true,
            missingFromRelease: [],
            missingFromSprint: [],
            notCompared: [],
          },
        },
      ],
    });
  });

  it('reports not checked, with no drift lists, where the Release read is incomplete', async () => {
    const cut = trackerFixture({
      versions: { '2.0.0': { name: '2.0.0', released: false, releaseDate: null } },
      labelled: { 'fixVersion:2.0.0': [issue('PROJ-1'), issue('PROJ-2')] },
    });
    const answered = await verdict({ releases: [{ sprint: 'demo', release: '2.0.0', mustHaves: [], otherTiers: [] }], limit: 1 }, cut);
    expect(answered.sprints[0]?.verdict).toMatchObject({ checked: false });
    const verdictOut = answered.sprints[0]?.verdict as Record<string, unknown>;
    expect(verdictOut).not.toHaveProperty('missingFromRelease');
    expect(verdictOut).not.toHaveProperty('missingFromSprint');
    expect(verdictOut).not.toHaveProperty('notCompared');
    expect(JSON.stringify(verdictOut).toLowerCase()).toContain('cut');
  });
});

describe('main', () => {
  /** Runs `main` with a collector answering `facts` and stdin holding `stdin`; records the collector's arguments. */
  const runMain = async (argv: string[], facts: string, stdin: string, w: GateWorld) => {
    let out = '';
    let err = '';
    const asked: (readonly string[])[] = [];
    const code = await main(
      argv,
      async (args) => {
        asked.push(args);
        return facts;
      },
      async () => stdin,
      w,
      (s) => (out += s),
      (s) => (err += s),
    );
    return { code, out, err, asked };
  };

  it('runs the collector with the sprint slug and answers from its report', async () => {
    const w = world(jiraOwnedByPlot, releaseHolding('PROJ-1'));
    const r = await runMain(['demo'], report('2.0.0', [{ text: 'a', issues: ['PROJ-1'] }]), '', w);
    expect(r.code).toBe(EXIT.ok);
    expect(r.asked).toEqual([['demo']]);
    expect(JSON.parse(r.out).sprints[0].verdict.checked).toBe(true);
  });

  it('exits 2 and names the collector where it reported nothing', async () => {
    const r = await runMain([], '', '', world(jiraOwnedByPlot));
    expect(r.code).toBe(EXIT.usage);
    expect(r.err).toContain('plot-sprint-release.sh reported nothing');
    expect(r.out).toBe('');
  });

  it('reads the report from stdin and runs no collector under --stdin', async () => {
    const r = await runMain(['--stdin'], '', '{}', world(jiraOwnedByPlot));
    expect(r.code).toBe(EXIT.ok);
    expect(r.asked).toEqual([]);
    expect(JSON.parse(r.out)).toEqual({ sprints: [] });
  });
});
