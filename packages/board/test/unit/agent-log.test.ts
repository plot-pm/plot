import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentLogDir,
  agentLogPath,
  forgetWorktreeRoot,
  isUnderAgentLogDir,
  migrateAgentLogs,
  MIGRATION_MARKER,
} from '../../src/server/agent-log.js';
import { deliverLogPath } from '../../src/server/deliver.js';
import { dispatchLogPath } from '../../src/server/dispatch.js';
import { implementLogPath } from '../../src/server/implement.js';
import { approveLogPath } from '../../src/server/approve.js';
import { ideaLogPath, ideaPromptPath } from '../../src/server/idea.js';
import { storyLogPath, storyPromptPath } from '../../src/server/story.js';
import { commissionLogPath, commissionPromptPath } from '../../src/server/commission.js';
import { resliceLogPath } from '../../src/server/reslice.js';
import { repairLogPath } from '../../src/server/resolver.js';
import { rmTree } from '../helpers.mjs';

/**
 * ONE PLACE DECIDES WHERE AN AGENT LOG LIVES, AND NOW IT DECIDES DIFFERENTLY.
 *
 * Nine modules spawn agents and each keeps a log, a prompt and a state file.
 * Until 2026-08-30 each resolved the directory itself — one decision written 22
 * times — and moving the logs meant editing 22 call sites, or moving the
 * decision to one. Slice 1 moved the decision; this slice changes it.
 *
 * SO THE `beside` ASSERTIONS BELOW ARE REWRITTEN, DELIBERATELY. Slice 1 asserted
 * the literal `<parent>/plot-…` form precisely so that a reviewer could tell a
 * missed call site from an intended path change — and this is the intended path
 * change. What survives is the SHAPE of that assertion: every helper is still
 * checked against a literal expectation rather than against `agentLogPath`,
 * which would pass against any shared mistake.
 *
 * The fallback keeps the old form and keeps testing it, because a repository
 * with no `Worktree root` key must not move.
 */

const repoRoot = '/tmp/plot-agent-log-fixture/repo';

/**
 * The fallback expression — today's location for a repo with no `Worktree root`.
 *
 * The fixture root does not exist on disk and never gets a `CLAUDE.md`, so
 * `plot-config.sh` finds no key and every helper below resolves through the
 * fallback. That is what makes these the FALLBACK tests: the configured case is
 * exercised against a real fixture repo further down.
 */
const beside = (name: string) => path.join(path.resolve(repoRoot, '..'), name);

beforeEach(forgetWorktreeRoot);
afterEach(forgetWorktreeRoot);

describe('agentLogPath', () => {
  it('places a run outside the repository, in the fallback location', () => {
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
   * Every helper against a literal expectation. If this table and the resolver
   * are wrong together, these still fail — that is the point of spelling the
   * expectation out rather than deriving it from the resolver under test.
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
  ])('%s resolves through the one resolver', (_name, actual, expected) => {
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

/**
 * THE MOVE ITSELF, AGAINST A REAL REPOSITORY.
 *
 * The tests above resolve against a fixture root that does not exist, which is
 * what exercises the fallback. These need a real directory: `plot-config.sh` is
 * a shell script reading a `CLAUDE.md`, and the point of this slice is that the
 * resolver reads the SAME key through the SAME helper as `resolve_wt_root()`.
 * Stubbing that read would test the plumbing and not the agreement.
 */
describe('the configured worktree root', () => {
  const scriptsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../skills/plot/scripts',
  );
  let tmp: string;
  let previousScriptsDir: string | undefined;

  /** A repo with a `## Plot Config` naming `root`, or with no key at all. */
  const makeRepo = (root: string | null): string => {
    const repo = fs.mkdtempSync(path.join(tmp, 'repo-'));
    if (root !== null) {
      fs.writeFileSync(
        path.join(repo, 'CLAUDE.md'),
        `# Fixture\n\n## Plot Config\n\n- **Worktree root:** ${root}\n`,
      );
    }
    forgetWorktreeRoot();
    return repo;
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'plot-log-move-'));
    previousScriptsDir = process.env.PLOT_SCRIPTS_DIR;
    process.env.PLOT_SCRIPTS_DIR = scriptsDir;
    forgetWorktreeRoot();
  });

  afterEach(() => {
    if (previousScriptsDir === undefined) delete process.env.PLOT_SCRIPTS_DIR;
    else process.env.PLOT_SCRIPTS_DIR = previousScriptsDir;
    forgetWorktreeRoot();
    rmTree(tmp);
  });

  it('puts a dispatch log under the configured root', () => {
    // The plan's first `Done when`: a dispatch in THIS repository writes its
    // log under `.worktrees/`.
    const repo = makeRepo('.worktrees');
    expect(dispatchLogPath(repo, 'my-slug')).toBe(
      path.join(repo, '.worktrees', 'plot-dispatch-my-slug.log'),
    );
  });

  it('leaves a repository with no key writing beside itself', () => {
    // The plan's second `Done when`, and the reason the fallback is a fallback
    // rather than an error: a repo with no key has no `.worktrees/`, and
    // creating one because a log needs somewhere to go invents a directory
    // nobody asked for.
    const repo = makeRepo(null);
    expect(agentLogDir(repo)).toBe(path.resolve(repo, '..'));
  });

  it('takes an absolute root as given and a relative one against the repo', () => {
    // `resolve_wt_root()`'s rule, which this reads the same key as. Asserted
    // here because a disagreement between the two would put a log in a
    // directory holding no worktree, which is the one thing the shared key is
    // for.
    expect(agentLogDir(makeRepo('/var/tmp/plot-elsewhere'))).toBe('/var/tmp/plot-elsewhere');
    const repo = makeRepo('nested/trees');
    expect(agentLogDir(repo)).toBe(path.join(repo, 'nested/trees'));
  });

  it('normalises a trailing slash without touching the filesystem', () => {
    // The directory need not exist — a first dispatch is entitled to create it —
    // so this is pure string work, exactly as `resolve_wt_root()` documents.
    const repo = makeRepo('.worktrees/');
    expect(fs.existsSync(path.join(repo, '.worktrees'))).toBe(false);
    expect(agentLogDir(repo)).toBe(path.join(repo, '.worktrees'));
  });
});

/**
 * THE PATH GUARD.
 *
 * The invariant the resolver now owns, asked by the route that serves these
 * files to a browser. The slug guard is a separate question and is unchanged.
 */
describe('isUnderAgentLogDir', () => {
  it('accepts the path the resolver itself produced', () => {
    expect(isUnderAgentLogDir(repoRoot, dispatchLogPath(repoRoot, 'my-slug'))).toBe(true);
  });

  it('rejects a resolved path outside the root', () => {
    // The plan's fifth `Done when`. A future caller could compute this without
    // touching the slug at all — which is why the slug guard does not cover it.
    expect(isUnderAgentLogDir(repoRoot, '/etc/passwd')).toBe(false);
  });

  it('rejects a sibling directory sharing the root as a prefix', () => {
    // `/tmp/plot-agent-log-fixture-elsewhere` starts with the root's string and
    // is not inside it. Compared with a trailing separator for exactly this.
    expect(isUnderAgentLogDir(repoRoot, `${agentLogDir(repoRoot)}-elsewhere/plot-dispatch-x.log`)).toBe(
      false,
    );
  });

  it('collapses `..` before comparing, so an escape is not matched as text', () => {
    const escape = path.join(agentLogDir(repoRoot), '..', '..', 'plot-dispatch-x.log');
    expect(isUnderAgentLogDir(repoRoot, escape)).toBe(false);
  });

  it('rejects the directory itself, which is never a log', () => {
    expect(isUnderAgentLogDir(repoRoot, agentLogDir(repoRoot))).toBe(false);
  });
});

/**
 * THE ONE-TIME MOVE.
 *
 * Bounded, and the boundary is the point: a dispatch that touches files in the
 * parent directory does more than it says.
 */
describe('migrateAgentLogs', () => {
  const scriptsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../skills/plot/scripts',
  );
  let tmp: string;
  let repo: string;
  let parent: string;
  let dest: string;
  let previousScriptsDir: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'plot-log-migrate-'));
    previousScriptsDir = process.env.PLOT_SCRIPTS_DIR;
    process.env.PLOT_SCRIPTS_DIR = scriptsDir;
    parent = path.join(tmp, 'checkouts');
    repo = path.join(parent, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'CLAUDE.md'),
      '# Fixture\n\n## Plot Config\n\n- **Worktree root:** .worktrees\n',
    );
    dest = path.join(repo, '.worktrees');
    forgetWorktreeRoot();
  });

  afterEach(() => {
    if (previousScriptsDir === undefined) delete process.env.PLOT_SCRIPTS_DIR;
    else process.env.PLOT_SCRIPTS_DIR = previousScriptsDir;
    forgetWorktreeRoot();
    rmTree(tmp);
  });

  const write = (dir: string, name: string, body = 'x') => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  };

  it("moves a run's three files and nothing else", () => {
    write(parent, 'plot-dispatch-a-slug.log');
    write(parent, 'plot-dispatch-a-slug.state');
    write(parent, 'plot-deliver-a-slug.prompt.md');
    // Files Plot did not write. A dispatch that touched these would do more
    // than it says — which is the risk the plan states and bounds.
    write(parent, 'notes.md');
    write(parent, 'plot-something-else.txt');
    write(parent, 'my-plot-dispatch-a-slug.log');

    expect(migrateAgentLogs(repo)).toBe(3);
    expect(fs.readdirSync(dest).sort()).toEqual([
      MIGRATION_MARKER,
      'plot-deliver-a-slug.prompt.md',
      'plot-dispatch-a-slug.log',
      'plot-dispatch-a-slug.state',
    ]);
    expect(fs.readdirSync(parent).sort()).toEqual([
      'my-plot-dispatch-a-slug.log',
      'notes.md',
      'plot-something-else.txt',
      'repo',
    ]);
  });

  it('moves every kind, so a tenth added later is swept too', () => {
    // Built from `KINDS`, not from a second list. A hand-written glob beside a
    // hand-written union is how the two drift into a file nothing removes.
    for (const kind of ['approve', 'commission', 'deliver', 'dispatch', 'idea-issue',
      'implement', 'reslice', 'resolve', 'story-issue']) {
      write(parent, `plot-${kind}-x.log`);
    }
    expect(migrateAgentLogs(repo)).toBe(9);
  });

  it('moves nothing on a second run', () => {
    // The plan's third `Done when`. The marker lives in the DESTINATION, with
    // the thing it describes.
    write(parent, 'plot-dispatch-a-slug.log');
    expect(migrateAgentLogs(repo)).toBe(1);

    write(parent, 'plot-dispatch-later.log');
    expect(migrateAgentLogs(repo)).toBe(0);
    expect(fs.existsSync(path.join(parent, 'plot-dispatch-later.log'))).toBe(true);
    expect(fs.existsSync(path.join(dest, MIGRATION_MARKER))).toBe(true);
  });

  it('never deletes: a name already in the destination leaves the source alone', () => {
    // The destination is authoritative because it is the one the running board
    // writes to. A file Plot did not write is not Plot's to remove, and neither
    // is one it did.
    write(parent, 'plot-dispatch-a-slug.log', 'old');
    write(dest, 'plot-dispatch-a-slug.log', 'current');

    expect(migrateAgentLogs(repo)).toBe(0);
    expect(fs.readFileSync(path.join(dest, 'plot-dispatch-a-slug.log'), 'utf8')).toBe('current');
    expect(fs.readFileSync(path.join(parent, 'plot-dispatch-a-slug.log'), 'utf8')).toBe('old');
  });

  it('does nothing at all for a repository with no configured root', () => {
    // Source and destination are the same directory: nothing moved, so there is
    // nothing to move and no marker to write into a directory Plot does not own.
    fs.rmSync(path.join(repo, 'CLAUDE.md'));
    forgetWorktreeRoot();
    write(parent, 'plot-dispatch-a-slug.log');

    expect(migrateAgentLogs(repo)).toBe(0);
    expect(fs.existsSync(path.join(parent, 'plot-dispatch-a-slug.log'))).toBe(true);
    expect(fs.existsSync(path.join(parent, MIGRATION_MARKER))).toBe(false);
  });

  it('survives a source directory it cannot read', () => {
    // The plan's fourth `Done when`: a move that fails leaves the dispatch
    // working. Every failure mode here returns rather than throws, because the
    // migration is convenience and the dispatch is the job.
    const orphan = path.join(tmp, 'no', 'such', 'parent', 'repo');
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(
      path.join(orphan, 'CLAUDE.md'),
      '# Fixture\n\n## Plot Config\n\n- **Worktree root:** .worktrees\n',
    );
    forgetWorktreeRoot();
    rmTree(path.dirname(orphan));

    expect(() => migrateAgentLogs(orphan)).not.toThrow();
  });

  it('survives a destination it cannot create', () => {
    // A file where the directory should be. `mkdirSync` throws ENOTDIR and the
    // dispatch must still proceed.
    write(parent, 'plot-dispatch-a-slug.log');
    fs.writeFileSync(dest, 'not a directory');

    expect(() => migrateAgentLogs(repo)).not.toThrow();
    expect(migrateAgentLogs(repo)).toBe(0);
  });

  it('moves the others when one file will not move', () => {
    // One unmovable file must not stop the sweep, and must not stop the
    // dispatch. A directory named like a log renames on some platforms and not
    // others, so the assertion is on the movable pair rather than the count.
    write(parent, 'plot-dispatch-first.log');
    write(parent, 'plot-dispatch-second.log');
    fs.mkdirSync(path.join(dest, 'plot-dispatch-blocked.log'), { recursive: true });
    write(parent, 'plot-dispatch-blocked.log');

    expect(() => migrateAgentLogs(repo)).not.toThrow();
    expect(fs.existsSync(path.join(dest, 'plot-dispatch-first.log'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'plot-dispatch-second.log'))).toBe(true);
    // And the blocked one is still where it was — skipped, never deleted. This
    // is what makes the assertion above non-vacuous: the sweep really did meet
    // a file it could not move and really did carry on.
    expect(fs.existsSync(path.join(parent, 'plot-dispatch-blocked.log'))).toBe(true);
    expect(fs.statSync(path.join(dest, 'plot-dispatch-blocked.log')).isDirectory()).toBe(true);
  });
});
