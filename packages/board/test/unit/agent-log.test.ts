import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentLogDir,
  agentLogPath,
  ensureAgentLogDir,
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
import { rmTree } from '../helpers.mjs';

/**
 * ONE PLACE DECIDES WHERE AN AGENT LOG LIVES, AND NOW IT DECIDES DIFFERENTLY.
 *
 * Nine modules spawn agents and each keeps a log, a prompt and a state file.
 * Until 2026-08-30 each resolved the directory itself — one decision written 22
 * times — and moving the logs meant editing 22 call sites, or moving the
 * decision to one. Slice 1 moved the decision; this slice changes it.
 *
 * SO THE `inDeskRoot` ASSERTIONS BELOW ARE REWRITTEN, DELIBERATELY — twice now.
 * Slice 1 asserted the literal `<parent>/plot-…` form precisely so that a
 * reviewer could tell a missed call site from an intended path change, and on
 * 2026-10-01 the default moved from the checkout's parent to `<repo>/.worktrees`
 * — the intended path change, a second time. What survives both rewrites is the
 * SHAPE of the assertion: every helper is checked against a literal expectation
 * rather than against `agentLogPath`, which would pass against any shared
 * mistake.
 *
 * The parent is now asserted ABSENT rather than expected, because a directory
 * the repository does not own is what this change stopped writing to.
 */

/**
 * A fixture root of this run's own, removed after the file.
 *
 * Under the run's temp directory rather than a fixed `/tmp` path: resolving a
 * log path creates the desk root, so a fixed path outlives every run.
 */
const fixtureParent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'plot-agent-log-fixture-'));
const repoRoot = path.join(fixtureParent, 'repo');
afterAll(() => rmTree(fixtureParent));

/**
 * The default expression — `<repo>/.worktrees` for a repo with no `Worktree root`.
 *
 * The fixture root never gets a `CLAUDE.md`, so `plot-config.sh` finds no key
 * and every helper below resolves through the default. That is what makes
 * these the DEFAULT tests: the configured case is exercised against a real
 * fixture repo further down.
 */
const inDeskRoot = (name: string) => path.join(repoRoot, '.worktrees', name);

beforeEach(forgetWorktreeRoot);
afterEach(forgetWorktreeRoot);

describe('agentLogPath', () => {
  it('places a run in the desk root, the default location', () => {
    expect(agentLogPath(repoRoot, 'dispatch', 'my-slug', 'log')).toBe(
      inDeskRoot('plot-dispatch-my-slug.log'),
    );
  });

  it('gives a run its three files one name and three extensions', () => {
    expect(agentLogPath(repoRoot, 'deliver', 'my-slug', 'log')).toBe(inDeskRoot('plot-deliver-my-slug.log'));
    expect(agentLogPath(repoRoot, 'deliver', 'my-slug', 'state')).toBe(inDeskRoot('plot-deliver-my-slug.state'));
    expect(agentLogPath(repoRoot, 'deliver', 'my-slug', 'prompt')).toBe(inDeskRoot('plot-deliver-my-slug.prompt.md'));
  });

  it('takes a number as readily as a slug, because two kinds are keyed by issue', () => {
    expect(agentLogPath(repoRoot, 'idea-issue', 333, 'log')).toBe(inDeskRoot('plot-idea-issue-333.log'));
  });

  it('returns an absolute path for a relative repoRoot, so a caller cannot inherit its cwd', () => {
    expect(path.isAbsolute(agentLogPath('relative/repo', 'approve', 'x', 'log'))).toBe(true);
  });

  it('exposes the directory on its own, for the one caller that wants a worktree there', () => {
    // `idea.ts` builds `plot-idea-issue-<n>` as a WORKTREE, not a log file.
    // Without this export it would have to fake a filename to get the
    // directory — which is how a call site drifts back to hard-coding.
    expect(agentLogDir(repoRoot)).toBe(path.join(repoRoot, '.worktrees'));
  });

  it('never answers the checkout\'s parent, which the repository does not own', () => {
    // The defect this change fixed: with no key configured, every one of the
    // nine modules wrote `plot-<kind>-*` into the directory holding the
    // developer's other checkouts. 190 logs totalling 2.6 MB accumulated there
    // since 2026-08-17 with nothing that would ever remove one.
    expect(agentLogDir(repoRoot)).not.toBe(path.resolve(repoRoot, '..'));
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
    expect(actual).toBe(inDeskRoot(expected));
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

  it('puts a repository with no key under its own .worktrees', () => {
    // The plan's second `Done when`. This asserted the checkout's PARENT until
    // 2026-10-01: nine sites computed the default and two of them already
    // answered `.worktrees`, so one of the two was always writing somewhere the
    // others did not read. The default is now the one `/plot-init` writes.
    const repo = makeRepo(null);
    expect(agentLogDir(repo)).toBe(path.join(repo, '.worktrees'));
    expect(agentLogDir(repo)).not.toBe(path.resolve(repo, '..'));
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

  it('keeps the desk root out of git status after the first log write', () => {
    // The board can create `.worktrees/` before any dispatch does, so the
    // writer must add the ignore line itself. It goes into the COMMON git
    // directory's `info/exclude`, the only one git reads it from, and once.
    const repo = makeRepo(null);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'x\n');
    git('add', '-A');
    git('-c', 'user.email=t@example.invalid', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init');

    const dir = ensureAgentLogDir(repo);
    fs.writeFileSync(agentLogPath(repo, 'dispatch', 'my-slug', 'log'), 'started\n');
    forgetWorktreeRoot();
    ensureAgentLogDir(repo);

    expect(dir).toBe(path.join(repo, '.worktrees'));
    expect(fs.existsSync(path.join(dir, 'plot-dispatch-my-slug.log'))).toBe(true);
    expect(git('status', '--porcelain')).not.toMatch(/\.worktrees/);
    const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n').filter((l) => l === '/.worktrees/')).toHaveLength(1);
  });

  it('writes the ignore line into the COMMON git dir when served from a linked worktree', () => {
    const repo = makeRepo(null);
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, '-c', 'user.email=t@example.invalid', '-c', 'user.name=T', '-c', 'commit.gpgsign=false',
      'commit', '-q', '--allow-empty', '-m', 'init');
    const linked = path.join(tmp, 'linked');
    git(repo, 'worktree', 'add', '-q', '--detach', linked);

    ensureAgentLogDir(linked);

    const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n')).toContain('/.worktrees/');
    expect(git(linked, 'status', '--porcelain')).not.toMatch(/\.worktrees/);
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
    // `<desk root>-elsewhere` starts with the root's string and
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
      'implement', 'interrogate', 'reslice', 'resolve', 'story-issue']) {
      write(parent, `plot-${kind}-x.log`);
    }
    expect(migrateAgentLogs(repo)).toBe(10);
  });

  it('moves records into <repo>/.worktrees when no Worktree root is configured', () => {
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Fixture\n\n## Plot Config\n\n');
    forgetWorktreeRoot();
    write(parent, 'plot-approve-x.log');
    write(parent, 'plot-approve-x.state');

    expect(migrateAgentLogs(repo)).toBe(2);
    expect(fs.readdirSync(path.join(repo, '.worktrees')).filter((n) => n.startsWith('plot-')).sort())
      .toEqual(['plot-approve-x.log', 'plot-approve-x.state']);
    // The parent holds the repository and nothing Plot wrote.
    expect(fs.readdirSync(parent)).toEqual(['repo']);
  });

  it('runs at board startup, once the Worktree root is read', () => {
    const index = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/server/index.ts'),
      'utf8',
    );
    const prime = index.indexOf('primeWorktreeRoot(opts.repoRoot');
    const migrate = index.indexOf('migrateAgentLogs(opts.repoRoot)');
    expect(prime).toBeGreaterThan(-1);
    // After the prime, in its chain: the destination depends on the key it reads.
    expect(migrate).toBeGreaterThan(prime);
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

  it('does nothing at all when the desk root is the parent itself', () => {
    // Source and destination are the same directory: nothing moved, so there is
    // nothing to move and no marker to write into a directory Plot does not own.
    // A repository with NO key reached this case until 2026-10-01, when the
    // default became `<repo>/.worktrees`; a root configured as `..` is the one
    // left, and moving an unconfigured repository's records is the next
    // slice's migration test.
    fs.writeFileSync(
      path.join(repo, 'CLAUDE.md'),
      '# Fixture\n\n## Plot Config\n\n- **Worktree root:** ..\n',
    );
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
