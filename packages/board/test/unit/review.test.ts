import { describe, it, expect } from 'vitest';
import { hostFixture } from '@plot-pm/domain/adapters/host/host-fixture';
import { trackerFixture } from '@plot-pm/domain/adapters/tracker/tracker-fixture';
import { trackerNone } from '@plot-pm/domain/adapters/tracker/tracker-none';
import { ISSUE_MAY_EXIST } from '@plot-pm/domain/rules/refuted-issues';
import type { Pr } from '@plot-pm/domain/entities/pr';
import type { CommitStatusWrite } from '@plot-pm/domain/ports/host';
import type { IssueOpen } from '@plot-pm/domain/ports/tracker';
import type { AgentRun, AgentRunRequest } from '@plot-pm/domain/ports/agent-run';
import type { Trees } from '@plot-pm/domain';
import { EXIT, reviewPr, reviewTracker, type ReviewChange, type ReviewDeps } from '../../src/server/entry/review.js';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  statuses: CommitStatusWrite[];
  issues: IssueOpen[];
  requests: AgentRunRequest[];
  commands: string[];
  files: Map<string, string>;
  removed: string[];
  written: string[];
  changeBases: string[];
}

const MERGE_BASE = 'c'.repeat(40);
const DIFF = 'diff --git a/docs/review-status-rollout.md b/docs/review-status-rollout.md\n+one line\n';
const CHANGE: ReviewChange = { ok: true, mergeBase: MERGE_BASE, files: ['docs/review-status-rollout.md'], diff: DIFF };
const TREE = '/repo/.worktrees/review-7-aaaaaaa';
const REVIEWS = '/repo/.git/plot/state/reviews';
const DIFF_FILE = `${REVIEWS}/7-${HEAD}.diff`;

const rig = (
  verdict: string | null,
  opts: { prs?: Pr[]; files?: Map<string, string>; headAfter?: string; change?: ReviewChange } = {},
): Rig => {
  const statuses: CommitStatusWrite[] = [];
  const issues: IssueOpen[] = [];
  const requests: AgentRunRequest[] = [];
  const commands: string[] = [];
  const removed: string[] = [];
  const written: string[] = [];
  const changeBases: string[] = [];
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
    tracker: trackerFixture({ scheme: 'github-issues', opened: issues }),
    trees,
    agentRun: (command) => { commands.push(command); return agentRun; },
    repoRoot: '/repo', commonDir: '/repo/.git', base: 'main', currentBranch: 'feature/x',
    fetchSha: async () => true,
    readChange: async (_tree, base) => { changeBases.push(base); return opts.change ?? CHANGE; },
    readCharterText: () => CHARTER,
    readText: (f) => files.get(f) ?? null,
    writeText: (f, t) => { written.push(f); files.set(f, t); },
    removeFile: (f) => { files.delete(f); },
  };
  return { deps, statuses, issues, requests, commands, files, removed, written, changeBases };
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

  it('writes success with the PR URL and opens no issue on no findings at all', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n');
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.ok);
    expect(r.issues).toHaveLength(0);
    expect(r.statuses).toEqual([{
      sha: HEAD, state: 'success', context: 'plot/review', description: 'no HIGH findings',
      targetUrl: 'https://github.com/o/r/pull/7',
    }]);
  });

  it('opens the follow-up issue and writes success with its URL on HIGH 0 with MEDIUM and LOW findings', async () => {
    const r = rig('- [MEDIUM] a gap\n- [LOW] naming\nFindings: HIGH 0, MEDIUM 1, LOW 1\n');
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.ok);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.title).toBe('plot-review: MEDIUM 1, LOW 1 on PR #7');
    expect(r.issues[0]!.labels).toEqual(['ai-generated']);
    expect(r.issues[0]!.body).toContain('a gap');
    expect(r.statuses).toEqual([{
      sha: HEAD, state: 'success', context: 'plot/review', description: 'no HIGH findings',
      targetUrl: 'https://github.com/o/r/issues/1',
    }]);
    expect(out.lines.at(-1)).toBe(`plot-review: PR #7 ${HEAD} success, no HIGH findings, issue https://github.com/o/r/issues/1`);
  });

  it('still writes failure with the HIGH count when the issue cannot be opened, and names the failure', async () => {
    const r = rig(FINDINGS);
    r.deps.tracker = { ...trackerFixture({ scheme: 'github-issues', opened: r.issues, issueOpenFails: true }), lastRefusal: () => 'plot-host: HTTP 502' };
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.issueNotOpened);
    expect(r.issues).toHaveLength(1);
    expect(r.statuses).toEqual([{
      sha: HEAD, state: 'failure', context: 'plot/review', description: '2 HIGH findings; follow-up issue not opened',
      targetUrl: 'https://github.com/o/r/pull/7',
    }]);
    expect(out.lines).toContain('plot-review: the follow-up issue was not opened: plot-host: HTTP 502');
    expect(r.files.has(`${REVIEWS}/7-${HEAD}.issue`)).toBe(false);
  });

  it('still writes success when a tracker answering unaskable opens no issue for MEDIUM findings', async () => {
    const r = rig('Findings: HIGH 0, MEDIUM 2, LOW 0\n');
    r.deps.tracker = trackerNone('no Tracker declared');
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.issueNotOpened);
    expect(r.statuses.map((s) => [s.state, s.targetUrl])).toEqual([['success', 'https://github.com/o/r/pull/7']]);
    expect(out.lines).toContain('plot-review: the follow-up issue was not opened: no Tracker declared');
  });

  it('keeps the pending entry when the issue may exist, so a second run opens none', async () => {
    const r = rig(FINDINGS);
    r.deps.tracker = { ...trackerFixture({ opened: r.issues, issueOpenFails: true }), lastRefusal: () => `${ISSUE_MAY_EXIST}timed out` };
    expect((await reviewPr(r.deps, '7')).code).toBe(EXIT.issueNotOpened);
    expect(r.files.get(`${REVIEWS}/7-${HEAD}.issue`)).toBe('pending');
    expect((await reviewPr(r.deps, '7')).code).toBe(EXIT.issueNotOpened);
    expect(r.issues).toHaveLength(1);
    expect(r.statuses.map((s) => s.state)).toEqual(['failure', 'failure']);
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
  ])('refuses %s: no status, no issue, non-zero exit', async (_name, text) => {
    const r = rig(text);
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(out.lines[0]).toContain('refused');
    expect(r.statuses).toHaveLength(0);
    expect(r.issues).toHaveLength(0);
  });

  it.each([
    ['no final answer', null],
    ['an empty final answer', '  \n'],
  ])('refuses %s: no status, no issue', async (_name, text) => {
    const r = rig(text);
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(out.lines[0]).toContain('no final answer');
    expect(r.statuses).toHaveLength(0);
    expect(r.issues).toHaveLength(0);
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

  it('opens nothing on a pending issue entry, still writes the status, and names the entry', async () => {
    const files = new Map([['/repo/.git/plot/state/reviews/7-' + HEAD + '.issue', 'pending']]);
    const r = rig(FINDINGS, { files });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.issueNotOpened);
    expect(r.issues).toHaveLength(0);
    expect(r.statuses.map((s) => [s.state, s.description])).toEqual([['failure', '2 HIGH findings; follow-up issue not opened']]);
    expect(out.lines.join('\n')).toContain(`remove ${REVIEWS}/7-${HEAD}.issue once checked`);
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

  it('removes a stale diff from an earlier run before the change is read', async () => {
    const files = new Map([[DIFF_FILE, 'stale diff\n']]);
    const r = rig('Findings: HIGH 0, MEDIUM 0, LOW 0\n', { files, change: { ok: false, why: 'git diff failed' } });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(r.files.has(DIFF_FILE)).toBe(false);
  });

  it('refuses when the change cannot be read: no run, no status, no issue, tree removed', async () => {
    const r = rig(FINDINGS, { change: { ok: false, why: 'git diff failed' } });
    const out = await reviewPr(r.deps, '7');
    expect(out.code).toBe(EXIT.refused);
    expect(out.lines[0]).toContain('the change of PR #7 could not be read: git diff failed');
    expect(r.requests).toHaveLength(0);
    expect(r.statuses).toHaveLength(0);
    expect(r.issues).toHaveLength(0);
    expect(r.removed).toEqual([TREE]);
  });

  it('refuses a PR that is not open', async () => {
    const r = rig(FINDINGS, { prs: [pr({ state: 'MERGED' })] });
    expect((await reviewPr(r.deps, '7')).code).toBe(EXIT.refused);
    expect(r.requests).toHaveLength(0);
  });

});

describe('reviewTracker', () => {
  it('returns the declared tracker when a Tracker key is set', () => {
    const context = { repoRoot: '/nowhere', scriptDir: '/nowhere' };
    expect(reviewTracker(answered('jira https://x.invalid'), answered('github'), context).config().scheme).toBe('jira');
  });

  it('answers unaskable with no Tracker key on a non-github host, and calls nothing', async () => {
    const context = { repoRoot: '/nowhere', scriptDir: '/nowhere' };
    const opened = await reviewTracker(answered(''), answered('bitbucket'), context).issueOpen({ title: 't', body: 'b', labels: [] });
    expect(opened).toEqual({ ok: false, why: 'unaskable', reason: "no Tracker declared; the git host's issues are read-only to Plot" });
  });

  it('with no Tracker key on a github host opens the issue through githubIssueOpen', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plot-review-tracker-'));
    try {
      const scriptDir = join(root, 'scripts');
      mkdirSync(scriptDir);
      const argv = join(root, 'argv');
      const host = join(scriptDir, 'plot-host.sh');
      writeFileSync(host, `#!/usr/bin/env bash\nprintf '%s|%s\\n' "\${PLOT_TRACKER:-}" "$*" >> ${JSON.stringify(argv)}\necho https://github.com/o/r/issues/9\n`);
      chmodSync(host, 0o755);
      const tracker = reviewTracker(answered(''), answered('github'), { repoRoot: root, scriptDir });
      const opened = await tracker.issueOpen({ title: 't', body: 'b', labels: ['ai-generated'] });
      expect(opened).toEqual({ ok: true, value: { outcome: 'opened', id: '9' } });
      expect(readFileSync(argv, 'utf8')).toBe('github-issues|issue-open t b --label ai-generated\n');
      expect(tracker.config()).toEqual({ scheme: '', baseUrl: '' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('reports the issue-open refusal through lastRefusal when githubIssueOpen fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plot-review-tracker-'));
    try {
      const scriptDir = join(root, 'scripts');
      mkdirSync(scriptDir);
      const host = join(scriptDir, 'plot-host.sh');
      writeFileSync(host, "#!/usr/bin/env bash\necho 'plot-host: HTTP 502' >&2\nexit 3\n");
      chmodSync(host, 0o755);
      const tracker = reviewTracker(answered(''), answered('github'), { repoRoot: root, scriptDir });
      expect(await tracker.issueOpen({ title: 't', body: 'b', labels: [] })).toEqual({ ok: false, why: 'failed' });
      expect(tracker.lastRefusal()).toBe('plot-host: HTTP 502');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
