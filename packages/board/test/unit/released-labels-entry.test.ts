import { describe, expect, it } from 'vitest';
import { trackerFixture } from '@plot-pm/domain/adapters';
import type { Issue } from '@plot-pm/domain/entities/issue';
import { CALLS_PER_WRITE, EXIT, MIN_REMAINING, run, type Deps } from '../../src/server/entry/released-labels.js';

const closed = (id: string, labels: string[] = []): Issue => ({
  id, title: `t${id}`, url: '', status: 'closed', statusCategory: 'Done', assignees: [], createdAt: '', closedAt: '2026-01-02T00:00:00Z', labels,
}) as Issue;

const harness = (over: { issues?: Issue[]; env?: Record<string, string>; issueLabelFails?: boolean; remaining?: number } = {}) => {
  const labelWrites: { id: string; add: string; remove: readonly string[] }[] = [];
  const commented: { id: string; body: string }[] = [];
  const written: never[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const tracker = trackerFixture({
    scheme: 'github',
    issues: over.issues ?? [closed('1'), closed('2', ['plan:released']), closed('3')],
    labelWrites,
    commented,
    written,
    issueLabelFails: over.issueLabelFails,
    limits: [{ connector: 'github', bucket: 'core', remaining: over.remaining ?? 5000, limit: 5000, resetAt: null, known: true }] as never,
  });
  const deps: Deps = {
    tracker,
    plans: async () => [{ phase: 'released', issues: [1, 2, 3] }],
    env: over.env ?? {},
    write: (s) => out.push(s),
    warn: (s) => err.push(s),
  };
  return { deps, labelWrites, commented, written, out, err };
};

describe('plot-released-labels', () => {
  it('a dry run prints both sets with reasons and the call count, and writes nothing', async () => {
    const h = harness();
    expect(await run([], h.deps)).toBe(EXIT.ok);
    const text = h.out.join('');
    expect(text).toContain('write\t1\n');
    expect(text).toContain('write\t3\n');
    expect(text).toContain('skip\t2\talready-labelled\n');
    expect(text).toContain(`summary: write=2 skip=1 calls=${2 * CALLS_PER_WRITE}\n`);
    expect(h.labelWrites).toEqual([]);
  });

  it('--yes makes exactly one issueLabel call per target and no comment or close', async () => {
    const h = harness();
    expect(await run(['--yes'], h.deps)).toBe(EXIT.ok);
    expect(h.labelWrites.map((w) => w.id)).toEqual(['1', '3']);
    expect(h.labelWrites.every((w) => w.add === 'plan:released')).toBe(true);
    expect(h.commented).toEqual([]);
    expect(h.written).toEqual([]);
  });

  it('--yes under PLOT_UNATTENDED=1 exits 2 with zero tracker calls', async () => {
    const h = harness({ env: { PLOT_UNATTENDED: '1' } });
    expect(await run(['--yes'], h.deps)).toBe(EXIT.usage);
    expect(h.labelWrites).toEqual([]);
    expect(h.out).toEqual([]);
  });

  it('a dry run runs unattended', async () => {
    const h = harness({ env: { PLOT_UNATTENDED: '1' } });
    expect(await run([], h.deps)).toBe(EXIT.ok);
  });

  it('stops before writing when the connector is below the floor', async () => {
    const h = harness({ remaining: MIN_REMAINING - 1 });
    expect(await run(['--yes'], h.deps)).toBe(EXIT.failed);
    expect(h.labelWrites).toEqual([]);
    expect(h.out.join('')).toContain('unwritten: 1 3');
  });

  it('stops at the first failed write and names what is unwritten', async () => {
    const h = harness({ issueLabelFails: true });
    expect(await run(['--yes'], h.deps)).toBe(EXIT.failed);
    expect(h.labelWrites).toHaveLength(1);
    expect(h.out.join('')).toContain('unwritten: 1 3');
  });

  it('--section prints the count and the --yes command, and writes nothing', async () => {
    const h = harness();
    h.deps.self = '/x/plot-released-labels.mjs';
    expect(await run(['--section', '1'], h.deps)).toBe(EXIT.ok);
    expect(h.out.join('')).toBe('\n== Closed issues of Released plans without plan:released ==\n  2 issue(s) — run: node /x/plot-released-labels.mjs --yes\n\n');
    expect(h.labelWrites).toEqual([]);
  });

  it('refuses an unknown argument', async () => {
    const h = harness();
    expect(await run(['--nope'], h.deps)).toBe(EXIT.usage);
  });
});
