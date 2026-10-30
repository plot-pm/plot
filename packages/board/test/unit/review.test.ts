import { describe, it, expect } from 'vitest';
import { hostFixture } from '@plot-pm/domain/adapters/host/host-fixture';
import type { Pr } from '@plot-pm/domain/entities/pr';
import type { CommitStatusWrite } from '@plot-pm/domain/ports/host';
import type { AgentRun, AgentRunRequest } from '@plot-pm/domain/ports/agent-run';
import type { Trees } from '@plot-pm/domain';
import { EXIT, reviewPr, reviewStatusOnly, type ReviewChange, type ReviewDeps } from '../../src/server/entry/review.js';
import { REVIEW_INLINE_DIFF_LIMIT } from '@plot-pm/domain/rules/review-verdict';

const answered = <T>(value: T) => ({ ok: true as const, value });
const HEAD = 'a'.repeat(40);
const MOVED = 'b'.repeat(40);
const CHARTER = JSON.stringify({ name: 'reviewer', prompt: '.plot/worker-prompt.sh', model: 'opus', effort: 'high', capabilities: ['read-only'] });

const pr = (over: Partial<Pr> = {}): Pr => ({
  number: 7, repo: '', head: 'feature/x', base: 'main', state: 'OPEN', mergedAt: null, mergeCommit: '', draft: false,
  mergeable: 'mergeable', review: 'none', checks: 'passing', failingChecks: [], url: 'https://github.com/o/r/pull/7',
  author: '', headSha: HEAD, ...over,
} as Pr);

interface Rig {
  deps: ReviewDeps;
  /** Every `commitStatus` write except the lock's own `pending` marker. */
  statuses: CommitStatusWrite[];
  /** Every `commitStatus` write, `pending` included, in call order. */
  allStatuses: CommitStatusWrite[];
  requests: AgentRunRequest[];
  commands: string[];
  files: Map<string, string>;
  removed: string[];
  written: string[];
  changeBases: string[];
  prComments: { pr: number; body: string }[];
  locks: Map<string, string>;
  pids: Map<number, boolean | null>;
  runIds: string[];
}

const RUN = '2026-10-19T16:44:37Z';
const MERGE_BASE = 'c'.repeat(40);
const DIFF = 'diff --git a/docs/review-status-rollout.md b/docs/review-status-rollout.md\n+one line\n';
const CHANGE: ReviewChange = { ok: true, mergeBase: MERGE_BASE, files: ['docs/review-status-rollout.md'], diff: DIFF };
const TREE = '/repo/.worktrees/review-7-aaaaaaa';
const REVIEWS = '/repo/.git/plot/state/reviews';
const DIFF_FILE = `${REVIEWS}/7-${HEAD}.diff`;

const rig = (
  verdict: string | null,
  opts: {
    prs?: Pr[];
    files?: Map<string, string>;
    headAfter?: string;
    change?: ReviewChange;
    prCommentFails?: boolean;
    prCommentUnaskable?: boolean;
    pid?: number;
    runIds?: string[];
    pids?: Map<number, boolean | null>;
    locks?: Map<string, string>;
  } = {},
): Rig => {
  const allStatuses: CommitStatusWrite[] = [];
  const requests: AgentRunRequest[] = [];
  const commands: string[] = [];
  const removed: string[] = [];
  const written: string[] = [];
  const changeBases: string[] = [];
  const prComments: { pr: number; body: string }[] = [];
  const files = opts.files ?? new Map<string, string>();
  const locks = opts.locks ?? new Map<string, string>();
  const pids = opts.pids ?? new Map<number, boolean | null>();
  const runIds = opts.runIds ?? [];
  let runIdCalls = 0;
  let asked = 0;
  const prs = opts.prs ?? [pr()];
  const hostBase = hostFixture({
    prs,
    commitStatuses: allStatuses,
    prComments,
    prCommentFails: opts.prCommentFails,
    prCommentUnaskable: opts.prCommentUnaskable,
  });
  const host = {
    ...hostBase,
    // A CALLER-SUPPLIED SHA CANNOT BE THE ONE WRITTEN: the host answers a moved
    // head on its second look, and the status must still name the first.
    prState: async (ref: string | number) => {
      asked += 1;
      if (asked > 1 && opts.headAfter !== undefined) return answered(pr({ headSha: opts.headAfter }));
      return hostBase.prState(ref);
    },
    // Mirrors a real git host: `prReview` reads back whatever `commitStatus`
    // last wrote for that sha, newest pending included — never the fixture's
    // own static `reviews` map, which no caller here populates.
    prReview: async (number: number) => {
      const mine = allStatuses.filter((s) => prs.some((p) => p.number === number && s.targetUrl === p.url));
      const last = mine.at(-1);
      if (last === undefined) return hostBase.prReview(number);
      return answered({ sha: last.sha, state: last.state, description: last.description, time: RUN, bypass: false });
    },
  };
  const agentRun: AgentRun = {
    run: async (request) => {
      requests.push(request);
      return answered({
        sessionId: 's', end: { answer: 'ran', handBack: null }, usageByModel: {}, costUsd: null,
        costUsdByModel: {}, turns: 1, limitReadings: [], account: null,
        ...(verdict === null ? {} : { finalText: verdict }),
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
    trees,
    agentRun: (command) => { commands.push(command); return agentRun; },
    repoRoot: '/repo', commonDir: '/repo/.git', base: 'main', currentBranch: 'feature/x',
    fetchSha: async () => true,
    readChange: async (_tree, base) => { changeBases.push(base); return opts.change ?? CHANGE; },
    readCharterText: () => CHARTER,
    readText: (f) => files.get(f) ?? locks.get(f) ?? null,
    writeText: (f, t) => { written.push(f); files.set(f, t); },
    removeFile: (f) => { files.delete(f); },
    now: () => RUN,
    pid: () => opts.pid ?? 1234,
    runId: () => {
      const id = runIds[runIdCalls] ?? `run-id-${runIdCalls}`;
      runIdCalls += 1;
      return id;
    },
    isAlive: (p) => pids.get(p) ?? true,
    publishLock: (scratch, target) => {
      if (locks.has(target)) return 'held';
      const content = files.get(scratch);
      if (content === undefined) return 'failed';
      locks.set(target, content);
      return 'taken';
    },
    removeLock: (f) => { locks.delete(f); files.delete(f); },
  };
  return {
    deps,
    get statuses() { return allStatuses.filter((s) => s.state !== 'pending'); },
    allStatuses, requests, commands, files, removed, written, changeBases, prComments, locks, pids, runIds,
  };
};

const FINDINGS = '- [HIGH] leaks a token\nFindings: HIGH 2, MEDIUM 1, LOW 0\n';

describe('reviewPr', () => {
  it('diffs against the PR base, not the process-wide base', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n', { prs: [pr({ base: 'release/1.0' })] });
    expect(r.deps.base).toBe('main');
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.ok);
    expect(r.changeBases).toEqual(['release/1.0']);
    expect(r.requests[0]!.prompt).toContain('Base branch: release/1.0');
  });

  it('refuses a PR whose base the host did not name', async () => {
    const r = rig(FINDINGS, { prs: [pr({ base: '' })] });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(out.lines.join('\n')).toContain('PR #7');
    expect(r.changeBases).toEqual([]);
  });

  it('writes failure with the PR URL, posts one findings comment, on HIGH findings', async () => {
    const r = rig(FINDINGS);
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.ok);
    expect(r.statuses).toEqual([{
      sha: HEAD, state: 'failure', context: 'plot/review', description: `2 HIGH findings; run ${RUN}`,
      targetUrl: 'https://github.com/o/r/pull/7',
    }]);
    expect(r.prComments).toHaveLength(1);
    expect(r.prComments[0]!.pr).toBe(7);
    expect(r.prComments[0]!.body).toContain('leaks a token');
  });

  it('a second run on an unchanged head edits the same comment, not a second one', async () => {
    const r = rig(FINDINGS);
    await reviewPr(r.deps, '7');
    await reviewPr(r.deps, '7');
    expect(r.prComments).toHaveLength(1);
    expect(r.statuses).toHaveLength(2);
    expect(r.statuses[1]!.targetUrl).toBe(r.statuses[0]!.targetUrl);
    expect(r.statuses[0]!.description).toContain(`run ${RUN}`);
    expect(r.prComments[0]!.body).toContain(`run ${RUN}`);
    expect(r.statuses[1]!.description).toContain(`run ${RUN}`);
  });

  it('keeps the worst-case description within the host\'s 140-character cap', async () => {
    const r = rig('Findings: HIGH 99, MEDIUM 99, LOW 99\n');
    await reviewPr(r.deps, '7');
    await reviewPr(r.deps, '7');
    const description = r.statuses[1]!.description;
    expect(description).toBe(`99 HIGH findings; run ${RUN}`);
    expect(description.length).toBeLessThanOrEqual(140);
  });

  it('writes success with the PR URL and posts no comment on no findings at all', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n');
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.ok);
    expect(r.prComments).toHaveLength(0);
    expect(r.statuses).toEqual([{
      sha: HEAD, state: 'success', context: 'plot/review', description: 'no HIGH findings',
      targetUrl: 'https://github.com/o/r/pull/7',
    }]);
  });

  it('writes success and posts the findings comment on HIGH 0 with MEDIUM and LOW findings', async () => {
    const r = rig('- [MEDIUM] a gap\n- [LOW] naming\nFindings: HIGH 0, MEDIUM 1, LOW 1\n');
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.ok);
    expect(r.prComments).toHaveLength(1);
    expect(r.prComments[0]!.body).toContain('a gap');
    expect(r.statuses).toEqual([{
      sha: HEAD, state: 'success', context: 'plot/review', description: `no HIGH findings; run ${RUN}`,
      targetUrl: 'https://github.com/o/r/pull/7',
    }]);
    expect(out.lines.at(-1)).toBe(`plot-review: PR #7 ${HEAD} success, no HIGH findings`);
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
    r.deps.agentRun = () => ({ run: async () => { throw new Error('boom'); } });
    await expect(reviewPr(r.deps, '7')).rejects.toThrow('boom');
    expect(r.removed).toHaveLength(1);
  });

  it.each([
    ['no Findings line', '- [HIGH] x\n'],
    ['two Findings lines', 'Findings: HIGH 0, MEDIUM 0, LOW 0\nFindings: HIGH 1, MEDIUM 0, LOW 0\n'],
    ['a non-integer count', 'Findings: HIGH many, MEDIUM 0, LOW 0\n'],
  ])('refuses %s: no status, no comment, non-zero exit', async (_name, text) => {
    const r = rig(text);
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(out.lines[0]).toContain('refused');
    expect(r.statuses).toHaveLength(0);
    expect(r.prComments).toHaveLength(0);
  });

  it.each([
    ['no final answer', null],
    ['an empty final answer', '  \n'],
  ])('refuses %s: no status, no comment', async (_name, text) => {
    const r = rig(text);
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(out.lines[0]).toContain('no final answer');
    expect(r.statuses).toHaveLength(0);
    expect(r.prComments).toHaveLength(0);
  });

  it('writes the final answer to the verdict file and reads the counts from it', async () => {
    const r = rig('- [LOW] naming\nFindings: HIGH 0, MEDIUM 0, LOW 1\n');
    await reviewPr(r.deps, '7');
    expect(r.files.get(`/repo/.git/plot/state/reviews/7-${HEAD}.md`)).toBe('- [LOW] naming\nFindings: HIGH 0, MEDIUM 0, LOW 1\n');
    expect(r.statuses.map((s) => s.state)).toEqual(['success']);
  });

  it('runs the reviewer read-only: read and search tools, no bypass, no write or shell tool', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n');
    await reviewPr(r.deps, '7');
    expect(r.commands).toHaveLength(1);
    const command = r.commands[0]!;
    expect(command).not.toContain('bypassPermissions');
    expect(command).toContain('--tools Read,Grep,Glob ');
    expect(command).toContain('--permission-mode dontAsk');
    expect(command).toContain('--strict-mcp-config');
    expect(command).toContain('--setting-sources user');
    const denied = /--disallowedTools (\S+)/.exec(command)![1]!.split(',');
    expect(denied).toEqual(expect.arrayContaining(['Write', 'Edit', 'Bash']));
    expect(command).toContain("--model 'opus'");
    expect(command).toContain(`--add-dir '${REVIEWS}' --tools `);
    expect(r.requests[0]!.role).toBe('reviewer');
    expect(r.requests[0]!.capabilities).toContain('read-only');
    expect(r.requests[0]!.prompt).not.toContain('Write your verdict to');
  });

  it('refuses a charter whose harness is not claude, and runs nothing', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n');
    r.deps.readCharterText = () => JSON.stringify({ name: 'reviewer', prompt: 'p', harness: 'codex', capabilities: [] });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(out.lines[0]).toContain("harness 'codex'");
    expect(r.commands).toHaveLength(0);
    expect(r.requests).toHaveLength(0);
    expect(r.statuses).toHaveLength(0);
  });

  it('refuses a stale verdict from an earlier run when the reviewer answers nothing', async () => {
    const files = new Map([['/repo/.git/plot/state/reviews/7-' + HEAD + '.md', 'Findings: HIGH 0, MEDIUM 0, LOW 0\n']]);
    const r = rig(null, { files });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(r.statuses).toHaveLength(0);
  });

  it('gives the reviewer the changed files, the diff file and the scope rule', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n');
    await reviewPr(r.deps, '7');
    const prompt = r.requests[0]!.prompt;
    expect(r.files.get(DIFF_FILE)).toBe(DIFF);
    expect(prompt).toContain(`Merge base: ${MERGE_BASE}`);
    expect(prompt).toContain(`git diff ${MERGE_BASE}..${HEAD}`);
    expect(prompt).toContain('Changed files (1):\n- docs/review-status-rollout.md');
    expect(prompt).toContain(`Full diff: ${DIFF_FILE}`);
    expect(prompt).toContain('Scope: judge only this change.');
    expect(prompt).toContain('It never counts in the Findings: line.');
  });

  it('carries the diff inline under the limit', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n');
    await reviewPr(r.deps, '7');
    expect(r.requests[0]!.prompt).toContain('+one line');
  });

  it('leaves the diff out over the limit, and still writes it to the diff file', async () => {
    const big = `${DIFF}+${'x'.repeat(REVIEW_INLINE_DIFF_LIMIT)}\n`;
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n', { change: { ...CHANGE, diff: big } });
    await reviewPr(r.deps, '7');
    const prompt = r.requests[0]!.prompt;
    expect(prompt).not.toContain('+one line');
    expect(prompt).toContain('it is not inline');
    expect(r.files.get(DIFF_FILE)).toBe(big);
  });

  it('writes the diff next to the verdict, never inside the reviewed tree', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n');
    await reviewPr(r.deps, '7');
    expect(r.written).toContain(DIFF_FILE);
    expect(r.written.filter((f) => f.startsWith(`${TREE}/`))).toEqual([]);
    expect(r.written.every((f) => f.startsWith(`${REVIEWS}/`))).toBe(true);
  });

  it.each([
    ['a .plot-review symlink', `${TREE}/.plot-review`, '-> /home/operator'],
    ['a .plot-review/change.diff.tmp symlink', `${TREE}/.plot-review/change.diff.tmp`, '-> /home/operator/.zshrc'],
  ])('leaves %s the PR committed untouched, and the run is unaffected', async (_name, planted, text) => {
    const files = new Map([[planted, text]]);
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n', { files });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.ok);
    expect(r.files.get(planted)).toBe(text);
    expect(r.written.filter((f) => f.startsWith(`${TREE}/`))).toEqual([]);
    expect(r.statuses.map((s) => s.state)).toEqual(['success']);
  });

  it('refuses by name when a tracked regular file blocks the reviews directory, instead of throwing', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n');
    const original = r.deps.writeText;
    r.deps.writeText = (file, text) => {
      if (file === DIFF_FILE) throw new Error(`ENOTDIR: not a directory, mkdir '${REVIEWS}'`);
      original(file, text);
    };
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(out.lines[0]).toContain(`could not write ${DIFF_FILE}`);
    expect(out.lines[0]).toContain('ENOTDIR');
    expect(r.statuses).toHaveLength(0);
    expect(r.prComments).toHaveLength(0);
  });

  it('removes a stale diff from an earlier run before the change is read', async () => {
    const files = new Map([[DIFF_FILE, 'stale diff\n']]);
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n', { files, change: { ok: false, why: 'git diff failed' } });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(r.files.has(DIFF_FILE)).toBe(false);
  });

  it('refuses when the change cannot be read: no run, no status, no comment, tree removed', async () => {
    const r = rig(FINDINGS, { change: { ok: false, why: 'git diff failed' } });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(out.lines[0]).toContain('the change of PR #7 could not be read: git diff failed');
    expect(r.requests).toHaveLength(0);
    expect(r.statuses).toHaveLength(0);
    expect(r.prComments).toHaveLength(0);
    expect(r.removed).toEqual([TREE]);
  });

  it('refuses a PR that is not open', async () => {
    const r = rig(FINDINGS, { prs: [pr({ state: 'MERGED' })] });
    expect((await reviewPr(r.deps, '7')).code).toBe(EXIT.refused);
    expect(r.requests).toHaveLength(0);
  });
});

describe('the run lock', () => {
  const LOCK_FILE = `${REVIEWS}/7-${HEAD}.lock`;

  it('a second run refuses review-running and removes neither file of the first', async () => {
    const files = new Map([
      [`/repo/.git/plot/state/reviews/7-${HEAD}.md`, 'earlier verdict\n'],
      [DIFF_FILE, 'earlier diff\n'],
    ]);
    const locks = new Map([[LOCK_FILE, '999\tother-run\n']]);
    const r = rig(FINDINGS, { files, locks, pids: new Map([[999, true]]) });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(out.lines[0]).toContain('review-running');
    expect(r.files.get(`/repo/.git/plot/state/reviews/7-${HEAD}.md`)).toBe('earlier verdict\n');
    expect(r.files.get(DIFF_FILE)).toBe('earlier diff\n');
    expect(r.statuses).toHaveLength(0);
    expect(r.requests).toHaveLength(0);
  });

  it('a lock with a dead pid is moved aside and the next run\'s take succeeds', async () => {
    const locks = new Map([[LOCK_FILE, '999\tdead-run\n']]);
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n', { locks, pids: new Map([[999, false]]) });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.ok);
    expect(r.statuses).toHaveLength(1);
  });

  it('a superseded run writes no status at all', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n');
    r.deps.host.prReview = async (number: number) =>
      answered({ sha: HEAD, state: 'pending', description: 'run someone-elses-run-id', time: RUN, bypass: false });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(out.lines.join('\n')).toContain('superseded');
    expect(r.statuses).toHaveLength(0);
  });

  it('no run replaces an existing failure, even when itself the newest pending', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n');
    r.deps.host.prReview = async (number: number) =>
      answered({ sha: HEAD, state: 'failure', description: '1 HIGH finding', time: RUN, bypass: false });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(out.lines.join('\n')).toContain('already carries a failure status');
    expect(r.statuses).toHaveLength(0);
  });

  it('--status-only writes the status matching the verdict file and starts no agent', async () => {
    const files = new Map([[`/repo/.git/plot/state/reviews/7-${HEAD}.md`, FINDINGS]]);
    const r = rig(null, { files });
    const out = await reviewStatusOnly(r.deps, '7');
    expect(out.code).toBe(EXIT.ok);
    expect(r.requests).toHaveLength(0);
    expect(r.commands).toHaveLength(0);
    expect(r.statuses).toEqual([{
      sha: HEAD, state: 'failure', context: 'plot/review', description: `2 HIGH findings; run ${RUN}`,
      targetUrl: 'https://github.com/o/r/pull/7',
    }]);
  });

  it('--status-only refuses with no verdict file to read', async () => {
    const r = rig(null);
    const out = await reviewStatusOnly(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(r.requests).toHaveLength(0);
    expect(r.statuses).toHaveLength(0);
  });
});

describe('one findings comment per PR', () => {
  const sha = (n: number): string => String(n).repeat(40);

  it('three heads of one PR edit the same comment, never a second one', async () => {
    const files = new Map<string, string>();
    for (const n of [1, 2, 3]) {
      const r = rig('- [LOW] naming\nFindings: HIGH 0, MEDIUM 0, LOW 1\n', { prs: [pr({ headSha: sha(n) })], files });
      const out = await reviewPr(r.deps, '7');
      expect(out.code).toBe(EXIT.ok);
      expect(r.prComments).toHaveLength(1);
      expect(r.prComments[0]!.pr).toBe(7);
    }
  });

  it('keys the findings comment by a per-PR marker, so a second review of the PR edits it', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 1\n');
    await reviewPr(r.deps, '7');
    await reviewPr(r.deps, '7');
    expect(r.prComments).toHaveLength(1);
    expect(r.prComments[0]!.body.startsWith('<!-- plot-review-findings pr-7 -->\n')).toBe(true);
    expect(r.prComments[0]!.body).toContain(`run ${RUN}`);
  });

  it('cuts a long verdict, never the counts or the run marker, and names the file by its basename', async () => {
    // 40,000 four-byte code points: 160,000 UTF-8 bytes, 80,000 UTF-16 units.
    const r = rig(`Findings: HIGH 0, MEDIUM 0, LOW 1\n${'😀'.repeat(40000)}\n`);
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.ok);
    const body = r.prComments[0]!.body;
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(65536);
    expect(body).toContain('HIGH 0, MEDIUM 0, LOW 1');
    expect(body.endsWith(`run ${RUN}`)).toBe(true);
    expect(body).toContain(`truncated; the full verdict is in 7-${HEAD}.md`);
    expect(body).not.toContain(REVIEWS);
    expect(body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('reports a failed PR comment without changing the exit code, and names the verdict file', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 1\n', { prCommentFails: true });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.issueNotOpened);
    expect(r.prComments).toHaveLength(1);
    expect(out.lines.join('\n')).toContain(`the findings were not posted on the PR: the host answered failed with no reason; they are only in ${REVIEWS}/7-${HEAD}.md`);
    expect(r.statuses).toEqual([{
      sha: HEAD, state: 'success', context: 'plot/review', description: 'no HIGH findings; findings not posted',
      targetUrl: 'https://github.com/o/r/pull/7',
    }]);
  });

  it('says the findings reached nobody when the host cannot take PR comments, as Bitbucket answers', async () => {
    const r = rig('Findings: HIGH 1, MEDIUM 0, LOW 0\n', { prCommentUnaskable: true });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.issueNotOpened);
    expect(r.prComments).toHaveLength(1);
    expect(out.lines.join('\n')).toContain(`the findings were not posted on the PR: this git host cannot take PR comments; they are only in ${REVIEWS}/7-${HEAD}.md`);
    expect(r.statuses).toEqual([{
      sha: HEAD, state: 'failure', context: 'plot/review', description: '1 HIGH finding; findings not posted',
      targetUrl: 'https://github.com/o/r/pull/7',
    }]);
  });
});
