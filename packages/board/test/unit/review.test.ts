import { describe, it, expect } from 'vitest';
import { hostFixture } from '@plot-pm/domain/adapters/host/host-fixture';
import { trackerFixture } from '@plot-pm/domain/adapters/tracker/tracker-fixture';
import type { Pr } from '@plot-pm/domain/entities/pr';
import type { CommitStatusWrite } from '@plot-pm/domain/ports/host';
import type { IssueOpen } from '@plot-pm/domain/ports/tracker';
import type { AgentRun, AgentRunRequest } from '@plot-pm/domain/ports/agent-run';
import type { Trees } from '@plot-pm/domain';
import { EXIT, reviewPr, type ReviewDeps } from '../../src/server/entry/review.js';

const answered = <T>(value: T) => ({ ok: true as const, value });
const HEAD = 'a'.repeat(40);
const MOVED = 'b'.repeat(40);
const CHARTER = JSON.stringify({ name: 'reviewer', prompt: '.plot/worker-prompt.sh', model: 'opus', effort: 'high', capabilities: ['read-only'] });

const pr = (over: Partial<Pr> = {}): Pr => ({
  number: 7, repo: '', head: 'feature/x', state: 'OPEN', mergedAt: null, mergeCommit: '', draft: false,
  mergeable: 'mergeable', review: 'none', checks: 'passing', failingChecks: [], url: 'https://github.com/o/r/pull/7',
  author: '', headSha: HEAD, ...over,
} as Pr);

interface Rig {
  deps: ReviewDeps;
  statuses: CommitStatusWrite[];
  issues: IssueOpen[];
  requests: AgentRunRequest[];
  files: Map<string, string>;
  removed: string[];
}

const rig = (verdict: string | null, opts: { prs?: Pr[]; files?: Map<string, string>; headAfter?: string } = {}): Rig => {
  const statuses: CommitStatusWrite[] = [];
  const issues: IssueOpen[] = [];
  const requests: AgentRunRequest[] = [];
  const removed: string[] = [];
  const files = opts.files ?? new Map<string, string>();
  let asked = 0;
  const prs = opts.prs ?? [pr()];
  const hostBase = hostFixture({ prs, commitStatuses: statuses });
  const host = {
    ...hostBase,
    // A CALLER-SUPPLIED SHA CANNOT BE THE ONE WRITTEN: the host answers a moved
    // head on its second look, and the status must still name the first.
    prState: async (ref: string | number) => {
      asked += 1;
      if (asked > 1 && opts.headAfter !== undefined) return answered(pr({ headSha: opts.headAfter }));
      return hostBase.prState(ref);
    },
  };
  const agentRun: AgentRun = {
    run: async (request) => {
      requests.push(request);
      const file = /Write your verdict to (\S+)\./.exec(request.prompt)![1]!;
      if (verdict !== null) files.set(file, verdict);
      return answered({
        sessionId: 's', end: { answer: 'ran', handBack: null }, usageByModel: {}, costUsd: null,
        costUsdByModel: {}, turns: 1, limitReadings: [], account: null,
      });
    },
  };
  const trees = {
    prune: async () => answered(undefined),
    add: async () => answered(undefined),
    removeOnly: async (p: string) => { removed.push(p); return answered(undefined); },
  } as unknown as Trees;
  const deps: ReviewDeps = {
    host,
    tracker: trackerFixture({ scheme: 'github-issues', opened: issues }),
    trees,
    agentRun: async () => ({ agentRun, model: '' }),
    repoRoot: '/repo', commonDir: '/repo/.git', base: 'main', currentBranch: 'feature/x',
    fetchSha: async () => true,
    readCharterText: () => CHARTER,
    readText: (f) => files.get(f) ?? null,
    writeText: (f, t) => { files.set(f, t); },
    removeFile: (f) => { files.delete(f); },
  };
  return { deps, statuses, issues, requests, files, removed };
};

const FINDINGS = '- [HIGH] leaks a token\nFindings: HIGH 2, MEDIUM 1, LOW 0\n';

describe('reviewPr', () => {
  it('writes failure with the issue URL, not the PR URL, on HIGH findings', async () => {
    const r = rig(FINDINGS);
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.ok);
    expect(r.statuses).toEqual([{
      sha: HEAD, state: 'failure', context: 'plot/review', description: '2 HIGH findings',
      targetUrl: 'https://github.com/o/r/issues/1',
    }]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.labels).toEqual(['ai-generated']);
    expect(r.issues[0]!.body).toContain('leaks a token');
  });

  it('a second run on an unchanged head files no second issue', async () => {
    const r = rig(FINDINGS);
    await reviewPr(r.deps, '7');
    await reviewPr(r.deps, '7');
    expect(r.issues).toHaveLength(1);
    expect(r.statuses).toHaveLength(2);
    expect(r.statuses[1]!.targetUrl).toBe(r.statuses[0]!.targetUrl);
  });

  it('writes success and never opens an issue on zero HIGH findings', async () => {
    const r = rig('- [LOW] naming\nFindings: HIGH 0, MEDIUM 0, LOW 1\n');
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.ok);
    expect(r.issues).toHaveLength(0);
    expect(r.statuses).toEqual([{
      sha: HEAD, state: 'success', context: 'plot/review', description: 'no HIGH findings',
      targetUrl: 'https://github.com/o/r/pull/7',
    }]);
  });

  it('writes on the host-resolved head and says so when the head moved', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n', { headAfter: MOVED });
    const out = await reviewPr(r.deps, '7');
    expect(r.statuses[0]!.sha).toBe(HEAD);
    expect(out.lines.join('\n')).toContain(`moved to ${MOVED}`);
  });

  it('resolves the current branch’s PR when given no number', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n');
    await reviewPr(r.deps, '');
    expect(r.statuses[0]!.sha).toBe(HEAD);
  });

  it('runs the reviewer in a detached tree and removes it afterwards', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n');
    await reviewPr(r.deps, '7');
    expect(r.requests[0]!.role).toBe('reviewer');
    expect(r.requests[0]!.worktree).toBe('/repo/.worktrees/review-7-aaaaaaa');
    expect(r.removed).toEqual(['/repo/.worktrees/review-7-aaaaaaa']);
  });

  it('removes the tree when the run throws', async () => {
    const r = rig(null);
    r.deps.agentRun = async () => ({ agentRun: { run: async () => { throw new Error('boom'); } }, model: '' });
    await expect(reviewPr(r.deps, '7')).rejects.toThrow('boom');
    expect(r.removed).toHaveLength(1);
  });

  it.each([
    ['no Findings line', '- [HIGH] x\n'],
    ['two Findings lines', 'Findings: HIGH 0, MEDIUM 0, LOW 0\nFindings: HIGH 1, MEDIUM 0, LOW 0\n'],
    ['a non-integer count', 'Findings: HIGH many, MEDIUM 0, LOW 0\n'],
  ])('refuses %s: no status, no issue, non-zero exit', async (_name, text) => {
    const r = rig(text);
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(out.lines[0]).toContain('refused');
    expect(r.statuses).toHaveLength(0);
    expect(r.issues).toHaveLength(0);
  });

  it('refuses when the reviewer wrote no verdict file', async () => {
    const r = rig(null);
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(r.statuses).toHaveLength(0);
  });

  it('refuses a stale verdict from an earlier run when the reviewer writes none', async () => {
    const files = new Map([['/repo/.git/plot/state/reviews/7-' + HEAD + '.md', 'Findings: HIGH 0, MEDIUM 0, LOW 0\n']]);
    const r = rig(null, { files });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(r.statuses).toHaveLength(0);
  });

  it('refuses on a pending issue entry and opens nothing', async () => {
    const files = new Map([['/repo/.git/plot/state/reviews/7-' + HEAD + '.issue', 'pending']]);
    const r = rig(FINDINGS, { files });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(r.issues).toHaveLength(0);
    expect(r.statuses).toHaveLength(0);
  });

  it('refuses a PR that is not open', async () => {
    const r = rig(FINDINGS, { prs: [pr({ state: 'MERGED' })] });
    expect((await reviewPr(r.deps, '7')).code).toBe(EXIT.refused);
    expect(r.requests).toHaveLength(0);
  });

  it('refuses when no agent can run the reviewer', async () => {
    const r = rig(FINDINGS);
    r.deps.agentRun = async () => ({ refused: 'Agent runner: sdk, and this process does not carry the SDK runner' });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(out.lines[0]).toContain('SDK');
    expect(r.statuses).toHaveLength(0);
  });
});
