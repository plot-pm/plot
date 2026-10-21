import { describe, it, expect } from 'vitest';
import { trackerFixture } from '@plot-pm/domain/adapters';
import type { Issue } from '@plot-pm/domain/entities/issue';
import type { Tracker } from '@plot-pm/domain/ports/tracker';
import { EXIT, inputFrom, run, verdict, type GateWorld } from '../../src/server/entry/sprint-release-gate.js';

/** One sprint block as `plot-sprint-release.sh` writes it. */
const report = (release: string, must: { text: string; issues: (string | number)[] }[], sprint = 'demo'): string =>
  JSON.stringify({ sprints: [{ sprint, release, must }] });

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
});

describe('inputFrom', () => {
  it('gives a sprint with no Release: no entry', () => {
    expect(inputFrom(report('', [{ text: 'a', issues: ['PROJ-1'] }])).releases).toEqual([]);
  });

  it('takes the first Jira-shaped key and never a bare issue number', () => {
    const input = inputFrom(report('2.0.0', [{ text: 'a', issues: [12, 'PROJ-1', 'PROJ-2'] }, { text: 'b', issues: [7] }]));
    expect(input.releases[0]?.mustHaves).toEqual([
      { text: 'a', issue: 'PROJ-1' },
      { text: 'b', issue: '' },
    ]);
  });

  it('reads a page limit of 200 where the report gives none', () => {
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
          verdict: { checked: true, missingFromRelease: [{ text: 'b', issue: 'PROJ-2' }], missingFromSprint: ['PROJ-9'] },
        },
      ],
    });
  });

  it('names a version the tracker does not know, rather than a generic line', async () => {
    const answered = await verdict(inputFrom(report('9.9.9', [])), releaseHolding());
    expect(answered.sprints[0]?.verdict).toMatchObject({ checked: false, unreachable: true });
    expect(JSON.stringify(answered)).toContain('version-not-found');
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
});
