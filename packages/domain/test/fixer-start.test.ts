import { describe, expect, it } from 'vitest';

import type { FixerAttemptsRecord } from '../src/entities/fixer-attempts.js';
import { endedFixerAttempts, fixerPrompt, FIXER_FINDINGS_MAX } from '../src/rules/fixer-start.js';

const HEAD = 'a'.repeat(40);
const base = { pr: 7, url: 'https://host/pr/7', branch: 'feature/x', head: HEAD };

const textOf = (answer: ReturnType<typeof fixerPrompt>): string => {
  if (answer.read !== 'prompt') throw new Error(`refused: ${answer.why}`);
  return answer.text;
};

describe('fixerPrompt', () => {
  it('names the PR, the branch, the head, the detached checkout and the push without force', () => {
    const text = textOf(fixerPrompt({ ...base, evidence: { kind: 'high', findings: 'HIGH 1: x' } }));
    expect(text).toContain('pull request #7 (https://host/pr/7)');
    expect(text).toContain('`feature/x`');
    expect(text).toContain(`head ${HEAD}`);
    expect(text).toContain('detached checkout');
    expect(text).toContain('`git push origin HEAD:feature/x`');
    expect(text).toContain('Never force-push');
  });

  it('carries the HIGH findings verbatim', () => {
    const text = textOf(fixerPrompt({ ...base, evidence: { kind: 'high', findings: '\n**HIGH 1: nothing calls it.**\n' } }));
    expect(text).toContain('--- review findings ---\n**HIGH 1: nothing calls it.**\n--- end of review findings ---');
    expect(text).toContain('HIGH finding');
  });

  it('cuts findings longer than the cap and says so', () => {
    const findings = 'x'.repeat(FIXER_FINDINGS_MAX + 10);
    const text = textOf(fixerPrompt({ ...base, evidence: { kind: 'high', findings } }));
    expect(text).toContain(`${'x'.repeat(FIXER_FINDINGS_MAX)}\n\n…cut at ${FIXER_FINDINGS_MAX} characters.`);
    expect(text).not.toContain('x'.repeat(FIXER_FINDINGS_MAX + 1));
  });

  it('names the failing checks for a CI-red run', () => {
    const text = textOf(fixerPrompt({ ...base, evidence: { kind: 'ci-red', failingChecks: ['test', ' ', 'lint'] } }));
    expect(text).toContain('The failing checks: test, lint.');
    expect(text).toContain('`gh pr checks 7`');
    expect(text).not.toContain('review findings');
  });

  it('says the index named no failing check where none is named', () => {
    const text = textOf(fixerPrompt({ ...base, evidence: { kind: 'ci-red', failingChecks: [] } }));
    expect(text).toContain('the index named no failing check');
  });

  it('names the PR by number alone where the index carries no URL', () => {
    const text = textOf(fixerPrompt({ ...base, url: '', evidence: { kind: 'ci-red', failingChecks: [] } }));
    expect(text).toContain('You fix pull request #7 on branch');
  });

  it('refuses an empty branch, an empty head, and HIGH findings with no text', () => {
    expect(fixerPrompt({ ...base, branch: ' ', evidence: { kind: 'ci-red', failingChecks: [] } })).toEqual({ read: 'refused', why: 'no-branch' });
    expect(fixerPrompt({ ...base, head: '', evidence: { kind: 'ci-red', failingChecks: [] } })).toEqual({ read: 'refused', why: 'no-head' });
    expect(fixerPrompt({ ...base, evidence: { kind: 'high', findings: ' \n' } })).toEqual({ read: 'refused', why: 'findings-empty' });
  });
});

describe('fixerPrompt for a conflict', () => {
  const TIP = 'c'.repeat(40);
  const conflict = { kind: 'conflict', base: 'main', baseTip: TIP } as const;

  it('names the base and its tip, the merge, and the push as a fast-forward', () => {
    const text = textOf(fixerPrompt({ ...base, evidence: conflict }));
    expect(text).toContain(`conflicts with the base branch \`main\` at ${TIP}`);
    expect(text).toContain('`git fetch origin main`');
    expect(text).toContain('`git merge origin/main`');
    expect(text).toContain('Never rebase');
    expect(text).toContain('`git push origin HEAD:feature/x`');
  });

  it('names the restore of a generated bundle from the merge base', () => {
    const text = textOf(fixerPrompt({ ...base, evidence: conflict }));
    expect(text).toContain('`git restore --staged --worktree --source="$(git merge-base origin/main HEAD MERGE_HEAD)" -- <path>`');
    expect(text).not.toContain('git merge-base HEAD MERGE_HEAD');
    expect(text).toContain('never commit a rebuild');
    expect(text).toContain('Resolving a board artifact conflict');
  });

  it('names the stop on a protected path, a refused push and a State: line', () => {
    const text = textOf(fixerPrompt({ ...base, evidence: conflict }));
    expect(text).toContain('`.github/workflows/`, `.claude/`, `scripts/check-*.sh`');
    expect(text).toContain('`rolePushViolation`');
    expect(text).toContain('plot-state-gate.sh refuses the commit');
  });

  it('refuses a conflict with no base or no base tip', () => {
    expect(fixerPrompt({ ...base, evidence: { ...conflict, base: '' } })).toEqual({ read: 'refused', why: 'no-base' });
    expect(fixerPrompt({ ...base, evidence: { ...conflict, baseTip: ' ' } })).toEqual({ read: 'refused', why: 'no-base' });
  });
});

describe('endedFixerAttempts', () => {
  const record: FixerAttemptsRecord = {
    v: 1,
    pr: 7,
    attempts: [
      { headSha: HEAD, finding: { kind: 'high', hash: 'h' }, inFlight: { pid: 11, startedAt: 't' } },
      { headSha: HEAD, finding: { kind: 'high', hash: 'h' } },
      { headSha: HEAD, finding: { kind: 'ci', runId: 'r' }, inFlight: { pid: 12, startedAt: 't' } },
    ],
  };

  it('names the in-flight attempts whose process is dead', () => {
    expect(endedFixerAttempts(record, (pid) => (pid === '12' ? 'dead' : 'alive'))).toEqual([2]);
    expect(endedFixerAttempts(record, () => 'dead')).toEqual([0, 2]);
  });

  it('keeps an attempt in flight while its pid check is unanswerable', () => {
    expect(endedFixerAttempts(record, () => 'unanswerable')).toEqual([]);
  });

  it('names nothing for a missing or unreadable record', () => {
    expect(endedFixerAttempts('none', () => 'dead')).toEqual([]);
    expect(endedFixerAttempts('unreadable', () => 'dead')).toEqual([]);
  });
});
