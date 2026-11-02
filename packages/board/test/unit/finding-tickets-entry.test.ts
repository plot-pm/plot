import { describe, expect, it } from 'vitest';
import { trackerFixture } from '@plot-pm/domain/adapters';
import type { Issue } from '@plot-pm/domain/entities/issue';
import { TICKET_TRIAGE_MARKER } from '@plot-pm/domain/rules/review-issue';
import { EXIT, run, type Deps } from '../../src/server/entry/finding-tickets.js';

const ticket = (id: string): Issue =>
  ({
    id, title: `plot-review: findings on PR #${id}`, url: '', createdAt: null, body: 'Findings: HIGH 0, MEDIUM 1, LOW 1',
    status: 'open', statusCategory: 'To Do', closedAt: null,
  }) as Issue;

const verdicts: Record<string, string> = {
  '1': 'Default: abc1234\n- a: fixed\n- b: wont-fix\n',
  '2': 'Default: abc1234\n- a: fixed\n- b: still-true\n',
};

const harness = (env: Record<string, string> = {}) => {
  const closed: string[] = [];
  const commented: { id: string; body: string; marker?: string }[] = [];
  const tickets = [ticket('1'), ticket('2'), ticket('3')];
  const tracker = trackerFixture({ scheme: 'github', issues: tickets, titled: { 'ai-generated': tickets }, closed, commented });
  const written: Record<string, string> = {};
  const out: string[] = [];
  const err: string[] = [];
  const deps: Deps = {
    tracker,
    verdict: (issue) => verdicts[issue] ?? null,
    lastWritten: (issue) => written[issue] ?? null,
    recordWritten: (issue, hash) => {
      written[issue] = hash;
    },
    env,
    write: (s) => out.push(s),
    warn: (s) => err.push(s),
  };
  return { deps, closed, commented, out, err };
};

describe('plot-finding-tickets', () => {
  it('writes nothing on a dry run', async () => {
    const h = harness();
    expect(await run([], h.deps)).toBe(EXIT.ok);
    expect(h.closed).toEqual([]);
    expect(h.commented).toEqual([]);
    expect(h.out.join('')).toContain('summary: close=1 comment=1 unjudged=1');
  });

  it('closes the settled ticket, comments on the open one, and leaves the unjudged one', async () => {
    const h = harness();
    expect(await run(['--yes'], h.deps)).toBe(EXIT.ok);
    expect(h.closed).toEqual(['1']);
    expect(h.commented).toHaveLength(1);
    expect(h.commented[0]).toMatchObject({ id: '2', marker: TICKET_TRIAGE_MARKER });
  });

  it('writes the stay-open comment once across two runs with an unchanged verdict', async () => {
    const h = harness();
    await run(['--yes'], h.deps);
    await run(['--yes'], h.deps);
    expect(h.commented).toHaveLength(1);
  });

  it('refuses --yes under PLOT_UNATTENDED=1 before reading anything', async () => {
    const h = harness({ PLOT_UNATTENDED: '1' });
    expect(await run(['--yes'], h.deps)).toBe(EXIT.usage);
    expect(h.out).toEqual([]);
  });

  it('rejects an unknown argument', async () => {
    expect(await run(['--now'], harness().deps)).toBe(EXIT.usage);
  });
});
