import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type { ShellContext } from '../src/adapters/scripts.js';
import { githubIssueComment } from '../src/adapters/tracker/tracker-github.js';

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** A `plot-host.sh` that records its argv and its environment's tracker, then runs `tail`. */
const fakeHost = (tail: string): { context: ShellContext; argv: () => string[]; tracker: () => string } => {
  const root = mkdtempSync(join(tmpdir(), 'plot-issue-comment-'));
  roots.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  const file = join(scriptDir, 'plot-host.sh');
  writeFileSync(
    file,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >"${root}/argv"\nprintf '%s' "$PLOT_TRACKER" >"${root}/tracker"\n${tail}\n`,
  );
  chmodSync(file, 0o755);
  return {
    context: { repoRoot: root, scriptDir },
    argv: () => readFileSync(join(root, 'argv'), 'utf8').split('\n').slice(0, -1),
    tracker: () => readFileSync(join(root, 'tracker'), 'utf8'),
  };
};

describe('githubIssueComment', () => {
  it('posts through issue-comment with an empty marker and answers commented', async () => {
    const host = fakeHost('exit 0');
    const refusals: (string | null)[] = [];
    const result = await githubIssueComment(host.context, (said) => refusals.push(said))('12', 'the new head');
    expect(result).toEqual({ ok: true, value: { outcome: 'commented' } });
    expect(host.argv()).toEqual(['issue-comment', '12', '', 'the new head']);
    expect(host.tracker()).toBe('github-issues');
    expect(refusals).toEqual([null]);
  });

  it('answers unaskable with the reason where plot-host.sh exits 4', async () => {
    const host = fakeHost('echo "plot-host: issue-comment: jira" >&2; exit 4');
    const refusals: (string | null)[] = [];
    const result = await githubIssueComment(host.context, (said) => refusals.push(said))('12', 'body');
    expect(result).toEqual({ ok: false, why: 'unaskable', reason: 'issue-comment: jira' });
    expect(refusals).toEqual([null]);
  });

  it('answers failed and records the refusal on any other exit', async () => {
    const host = fakeHost('echo boom >&2; exit 3');
    const refusals: (string | null)[] = [];
    const result = await githubIssueComment(host.context, (said) => refusals.push(said))('12', 'body');
    expect(result).toEqual({ ok: false, why: 'failed' });
    expect(refusals).toEqual(['boom']);
  });
});
