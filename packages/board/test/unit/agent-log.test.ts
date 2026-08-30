import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentLogDir, agentLogPath } from '../../src/server/agent-log.js';
import { deliverLogPath } from '../../src/server/deliver.js';
import { dispatchLogPath } from '../../src/server/dispatch.js';
import { implementLogPath } from '../../src/server/implement.js';
import { approveLogPath } from '../../src/server/approve.js';
import { ideaLogPath, ideaPromptPath } from '../../src/server/idea.js';
import { storyLogPath, storyPromptPath } from '../../src/server/story.js';
import { commissionLogPath, commissionPromptPath } from '../../src/server/commission.js';
import { resliceLogPath } from '../../src/server/reslice.js';
import { repairLogPath } from '../../src/server/resolver.js';

/**
 * ONE PLACE DECIDES WHERE AN AGENT LOG LIVES.
 *
 * Nine modules spawn agents and each keeps a log, a prompt and a state file.
 * Until 2026-08-30 each resolved the directory itself — one decision written 22
 * times — and moving the logs meant editing 22 call sites, or moving the
 * decision to one.
 *
 * These tests assert the two properties that make this slice safe to review.
 *
 * FIRST, THE PATH DID NOT CHANGE. This slice moves who decides, not what they
 * decide; the move is the next one. Asserting the literal `<parent>/plot-…`
 * form — rather than comparing each helper to `agentLogPath`, which would pass
 * against any shared mistake — is what makes a reviewer able to tell a missed
 * call site from an intended path change.
 *
 * SECOND, NOBODY RESOLVES IT THEMSELVES. The grep is the plan's own stated
 * assertion, and it is a test rather than a note because 22 call sites is
 * exactly the kind of change where one gets missed — and the missed one keeps
 * writing to the old location where nothing will ever clean it.
 */

const repoRoot = '/tmp/plot-agent-log-fixture/repo';

/** The pre-refactor expression, written out once so the tests state the old truth. */
const beside = (name: string) => path.join(path.resolve(repoRoot, '..'), name);

describe('agentLogPath', () => {
  it('places a run beside the repository, not inside it', () => {
    expect(agentLogPath(repoRoot, 'dispatch', 'my-slug', 'log')).toBe(
      beside('plot-dispatch-my-slug.log'),
    );
  });

  it('gives a run its three files one name and three extensions', () => {
    expect(agentLogPath(repoRoot, 'deliver', 'my-slug', 'log')).toBe(beside('plot-deliver-my-slug.log'));
    expect(agentLogPath(repoRoot, 'deliver', 'my-slug', 'state')).toBe(beside('plot-deliver-my-slug.state'));
    expect(agentLogPath(repoRoot, 'deliver', 'my-slug', 'prompt')).toBe(beside('plot-deliver-my-slug.prompt.md'));
  });

  it('takes a number as readily as a slug, because two kinds are keyed by issue', () => {
    expect(agentLogPath(repoRoot, 'idea-issue', 333, 'log')).toBe(beside('plot-idea-issue-333.log'));
  });

  it('returns an absolute path for a relative repoRoot, so a caller cannot inherit its cwd', () => {
    expect(path.isAbsolute(agentLogPath('relative/repo', 'approve', 'x', 'log'))).toBe(true);
  });

  it('exposes the directory on its own, for the one caller that wants a worktree there', () => {
    // `idea.ts` builds `plot-idea-issue-<n>` as a WORKTREE, not a log file.
    // Without this export it would have to fake a filename to get the
    // directory — which is how a call site drifts back to hard-coding.
    expect(agentLogDir(repoRoot)).toBe(path.resolve(repoRoot, '..'));
  });
});

describe('the nine modules ask the resolver', () => {
  /**
   * Every helper against the literal old form. If this table and the resolver
   * are wrong together, these still fail — that is the point of spelling the
   * expectation out rather than deriving it.
   */
  it.each([
    ['deliverLogPath', deliverLogPath(repoRoot, 'my-slug'), 'plot-deliver-my-slug.log'],
    ['dispatchLogPath', dispatchLogPath(repoRoot, 'my-slug'), 'plot-dispatch-my-slug.log'],
    ['implementLogPath', implementLogPath(repoRoot, 'my-slug'), 'plot-implement-my-slug.log'],
    ['approveLogPath', approveLogPath(repoRoot, 'my-slug'), 'plot-approve-my-slug.log'],
    ['resliceLogPath', resliceLogPath(repoRoot, 'my-slug'), 'plot-reslice-my-slug.log'],
    ['commissionLogPath', commissionLogPath(repoRoot, 'my-slug'), 'plot-commission-my-slug.log'],
    ['commissionPromptPath', commissionPromptPath(repoRoot, 'my-slug'), 'plot-commission-my-slug.prompt.md'],
    ['ideaLogPath', ideaLogPath(repoRoot, 333), 'plot-idea-issue-333.log'],
    ['ideaPromptPath', ideaPromptPath(repoRoot, 333), 'plot-idea-issue-333.prompt.md'],
    ['storyLogPath', storyLogPath(repoRoot, 333), 'plot-story-issue-333.log'],
    ['storyPromptPath', storyPromptPath(repoRoot, 333), 'plot-story-issue-333.prompt.md'],
  ])('%s still returns the path it returned before', (_name, actual, expected) => {
    expect(actual).toBe(beside(expected));
  });

  it('repairLogPath keys by branch with its slashes flattened', () => {
    // The one caller whose id is not a slug or a number: a branch name would
    // otherwise create directories.
    expect(repairLogPath(repoRoot, 'infra/one-place-decides')).toBe(
      beside('plot-resolve-infra-one-place-decides.log'),
    );
  });
});

describe('the decision lives in exactly one place', () => {
  it('no module outside agent-log.ts resolves the parent directory itself', () => {
    // The plan's stated `Done when`, as a gate rather than a note: a 22-site
    // change is exactly where one gets missed, and a missed writer keeps
    // writing to a location nothing sweeps while a missed READER looks in the
    // wrong directory and reports nothing wrong.
    const serverDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../src/server',
    );
    const offenders = fs
      .readdirSync(serverDir)
      .filter((f) => f.endsWith('.ts') && f !== 'agent-log.ts')
      .filter((f) => /resolve\((?:opts\.)?repoRoot, '\.\.'\)/.test(
        fs.readFileSync(path.join(serverDir, f), 'utf8'),
      ));
    expect(offenders).toEqual([]);
  });
});
