import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  deskManifest,
  manifestDirectory,
  type ManifestReading,
} from '../src/rules/desk-manifest.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * THE THIRD RULE-VERSUS-SHELL COMPARISON: does `deskManifest` /
 * `manifestDirectory` answer what `plot_manifest_for_worktree` and
 * `plot_manifest_dir_for` answer, over a desk in every shape a desk can be in?
 *
 * THE PAIR EXISTS ON PURPOSE. `docs/shell-and-domain.md` settles which side of
 * the cost rule this falls on: `plot_manifest_for_worktree` runs once per
 * worktree per fleet-scan pass, where a 39 ms bundle hop is paid by every desk
 * forever, so the shell duplicates the rule and this holds the pair. NEITHER
 * SIDE IS AUTHORITATIVE — on a disagreement the branch stops, and adjusting
 * either side to make this pass is the one move forbidden.
 *
 * THE CORPUS IS CONSTRUCTED, for `desk-reset.corpus.test.ts`'s reason. CI's
 * checkout has ONE clean worktree and no agent registry, so a live corpus would
 * compare *no manifest* against *no manifest* on every row — a comparison that
 * can only pass, which `docs/shell-and-domain.md` names by that name. Each shape
 * is BUILT in a real repository with real worktrees, and the shell under test is
 * the shipped shell.
 *
 * BOTH SIDES ARE READ FROM THE SHELL'S OWN PERSPECTIVE. The rule's input is what
 * the shell says it saw — the directory it resolved and the manifests in it —
 * rather than what this file believes it planted. Assembling the readings here
 * would compare the rule against this file's idea of a registry, and the
 * directory derivation is exactly what #1086 got wrong.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const SCRIPTS = `${ROOT}/skills/plot/scripts`;
const WORKER_STATE = `${SCRIPTS}/plot-worker-state.sh`;

/** Two implementations of one rule, so neither is `adapter=` nor `production=`. */
const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

/**
 * Ask the shell, from INSIDE the desk, with `PLOT_MANIFEST_DIR` unset.
 *
 * THE `cd` IS THE SUBJECT. `--show-toplevel` answers the desk only when git is
 * asked from within one, so a `git -C` would not exercise #1086 at all. The
 * ambient `PLOT_REPO_ROOT` is cleared with it: the fleet wrapper exports the
 * DISPATCHING repository's root into every agent, and `plot-config.sh:222`
 * prefers it over asking git, so a run inside a worker would read this
 * repository's config for a fixture's desk.
 */
const askShell = (desk: string, from: string): ShellReading => {
  const program = [
    'cd "$2" || exit 9',
    '. "$1"',
    'printf \'%s\\n\' "$PLOT_MANIFEST_DIR"',
    'manifest=$(plot_manifest_for_worktree "$3") && printf \'%s\\n\' "$manifest" || printf \'\\n\'',
    // Every manifest the shell's own directory holds, read its own way, so the
    // rule is handed what the SHELL saw.
    'for f in "$PLOT_MANIFEST_DIR"/*.json; do',
    '  [ -f "$f" ] || continue',
    '  wt=$(grep -m1 \'"worktree":\' "$f" 2>/dev/null | sed \'s/.*"worktree": *"\\([^"]*\\)".*/\\1/\')',
    '  real=$(cd "$wt" 2>/dev/null && pwd -P) || real=""',
    '  printf \'m\\t%s\\t%s\\t%s\\n\' "$f" "$wt" "$real"',
    'done',
    'printf \'d\\t%s\\n\' "$(cd "$3" 2>/dev/null && pwd -P)"',
  ].join('\n');
  // `PLOT_REPO_ROOT` is SCRUBBED rather than blanked — the idiom
  // `test/reconcile/sandbox-scrubs-repo-root.test.mjs` gates, for the mechanism
  // it documents: the variable travels from the launchd supervisor down to any
  // suite a worker runs, and `plot-config.sh` prefers it over asking git.
  const env: NodeJS.ProcessEnv = { ...process.env, PLOT_MANIFEST_DIR: '' };
  delete env.PLOT_REPO_ROOT;
  const out = execFileSync('bash', ['-c', program, 'bash', WORKER_STATE, from, desk], {
    cwd: from,
    encoding: 'utf8',
    env,
    timeout: 120_000,
  });
  const lines = out.split('\n');
  const dir = lines[0] ?? '';
  const manifest = lines[1] ?? '';
  const manifests: ManifestReading[] = [];
  let deskReal = '';
  for (const line of lines.slice(2)) {
    const [tag, a = '', b = '', c = ''] = line.split('\t');
    if (tag === 'm') manifests.push({ path: a, worktree: b, worktreeReal: c === '' ? undefined : c });
    if (tag === 'd') deskReal = a;
  }
  return { dir, manifest, manifests, deskReal };
};

/** What the shell resolved, found, and saw. */
interface ShellReading {
  /** The directory the shell resolved at source time. */
  dir: string;
  /** The manifest it answered, or `''` for none and for `several`. */
  manifest: string;
  /** Every manifest in that directory, as the shell read each one. */
  manifests: ManifestReading[];
  /** The desk's own realpath, as the shell resolves it. */
  deskReal: string;
}

/** One shape, the desk it is about, and where the question is asked from. */
interface Case {
  /** What this fixture was built to exercise — the subject of a report. */
  name: string;
  /** The desk being asked about. */
  desk: string;
  /** The directory the question is asked from. */
  from: string;
  /** The main checkout, for `manifestDirectory`. */
  mainCheckout: string;
  /** The `Agent registry` value this repository declares, or `''`. */
  configured: string;
  /** What the shell answered. */
  shell: ShellReading;
}

let sandbox = '';
let cases: Case[] = [];

/** Writes a manifest naming one desk, in the shape `plot-dispatch.sh` writes it. */
const plant = (dir: string, worktree: string, name: string): string => {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `{\n  "worktree": "${worktree}",\n  "pid": "4242"\n}\n`);
  return file;
};

/** A repository with an origin, a desk, and whatever registry a case needs. */
const repoWithDesk = (label: string): { repo: string; desk: string } => {
  const origin = join(sandbox, `${label}.git`);
  const repo = join(sandbox, label);
  git(sandbox, 'init', '--bare', '-q', '-b', 'main', origin);
  git(sandbox, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'corpus@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Corpus');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), '# corpus\n');
  writeFileSync(
    join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n',
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  const desk = join(repo, '.worktrees', 'feature-one');
  git(repo, 'branch', 'feature/one');
  git(repo, 'worktree', 'add', '-q', desk, 'feature/one');
  return { repo, desk };
};

const buildCases = (): Case[] => {
  const built: Case[] = [];
  /** Takes the shell's reading and records the case. */
  const record = (
    name: string,
    { desk, from, mainCheckout, configured }:
      { desk: string; from: string; mainCheckout: string; configured: string },
  ): void => {
    built.push({ name, desk, from, mainCheckout, configured, shell: askShell(desk, from) });
  };

  // PATH MATCH, ASKED FROM INSIDE THE DESK — #1086's own case. The manifest
  // sits in the MAIN checkout and the desk holds no registry of its own, so a
  // derivation from the desk finds nothing.
  {
    const { repo, desk } = repoWithDesk('inside-desk');
    plant(join(repo, '.plot', 'agents'), desk, 'one.json');
    record('path-match-from-desk', { desk, from: desk, mainCheckout: repo, configured: '' });
  }

  // THE SAME DESK, ASKED FROM THE MAIN CHECKOUT. `--git-common-dir` prints an
  // ABSOLUTE path in a linked worktree and `.git` — relative — in the main
  // checkout, so both forms are exercised and both must answer one directory.
  {
    const { repo, desk } = repoWithDesk('from-checkout');
    plant(join(repo, '.plot', 'agents'), desk, 'one.json');
    record('path-match-from-checkout', { desk, from: repo, mainCheckout: repo, configured: '' });
  }

  // REALPATH MATCH. The manifest records the RESOLVED path, which is what the
  // dispatcher writes, while the desk is asked about by the path git prints.
  {
    const { repo, desk } = repoWithDesk('realpath');
    const real = execFileSync('bash', ['-c', 'cd "$1" && pwd -P', 'bash', desk], {
      encoding: 'utf8',
    }).trim();
    plant(join(repo, '.plot', 'agents'), real, 'one.json');
    record('realpath-match', { desk, from: desk, mainCheckout: repo, configured: '' });
  }

  // SYMLINK. The manifest names a symlink TO the desk, and the question comes by
  // the desk's own path — the asymmetry the supervisor could not match. Explicit,
  // because /tmp-against-/private/tmp is macOS's gift and CI runs Linux.
  {
    const { repo, desk } = repoWithDesk('symlink');
    const link = join(repo, '.worktrees', 'desk-link');
    symlinkSync(desk, link);
    plant(join(repo, '.plot', 'agents'), link, 'one.json');
    record('symlink-match', { desk, from: desk, mainCheckout: repo, configured: '' });
  }

  // NONE. A registry that exists and names another desk.
  {
    const { repo, desk } = repoWithDesk('none');
    plant(join(repo, '.plot', 'agents'), join(repo, '.worktrees', 'elsewhere'), 'one.json');
    record('no-manifest', { desk, from: desk, mainCheckout: repo, configured: '' });
  }

  // NO REGISTRY AT ALL. Absent is not false: both sides answer *no manifest*
  // rather than failing.
  {
    const { repo, desk } = repoWithDesk('no-registry');
    record('no-registry-directory', { desk, from: desk, mainCheckout: repo, configured: '' });
  }

  // SEVERAL. Two agents on one desk is an estate defect, and the first match
  // hides it — so both sides decline rather than picking.
  {
    const { repo, desk } = repoWithDesk('several');
    plant(join(repo, '.plot', 'agents'), desk, 'one.json');
    plant(join(repo, '.plot', 'agents'), desk, 'two.json');
    record('several', { desk, from: desk, mainCheckout: repo, configured: '' });
  }

  // CONFIGURED, ABSOLUTE, and OUTSIDE both checkouts — or the default could
  // answer it by accident and the key would not be the reason.
  {
    const { repo, desk } = repoWithDesk('configured-absolute');
    const registry = join(sandbox, 'shared-registry');
    plant(registry, desk, 'one.json');
    appendFileSync(join(repo, 'CLAUDE.md'), `- **Agent registry:** ${registry}\n`);
    record('configured-absolute', { desk, from: desk, mainCheckout: repo, configured: registry });
  }

  // CONFIGURED, RELATIVE. It joins to the MAIN CHECKOUT and never to the desk,
  // which is the whole of why a desk resolves the same file the checkout does.
  {
    const { repo, desk } = repoWithDesk('configured-relative');
    plant(join(repo, 'var', 'agents'), desk, 'one.json');
    appendFileSync(join(repo, 'CLAUDE.md'), '- **Agent registry:** var/agents\n');
    record('configured-relative', { desk, from: desk, mainCheckout: repo, configured: 'var/agents' });
  }

  // A TRAILING SLASH. `plot-dispatch.sh:agent_registry_dir` trims one and
  // `path.join` normalises one; a fifth resolver exists there and this row is
  // what keeps the two answers equal.
  {
    const { repo, desk } = repoWithDesk('configured-slash');
    plant(join(repo, 'var', 'agents'), desk, 'one.json');
    appendFileSync(join(repo, 'CLAUDE.md'), '- **Agent registry:** var/agents/\n');
    record('configured-trailing-slash', {
      desk, from: desk, mainCheckout: repo, configured: 'var/agents/',
    });
  }

  // A MANIFEST WITH NO `worktree` FIELD, beside one that names the desk. The
  // unreadable one must not match and must not stop the readable one.
  {
    const { repo, desk } = repoWithDesk('no-field');
    const dir = join(repo, '.plot', 'agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'broken.json'), '{\n  "pid": "1"\n}\n');
    plant(dir, desk, 'one.json');
    record('manifest-with-no-worktree', { desk, from: desk, mainCheckout: repo, configured: '' });
  }

  return built;
};

/** The rule's answer, in the shell's own vocabulary — `''` for none and several. */
const ruleAnswer = (one: Case): string => {
  const answer = deskManifest({
    desk: one.desk,
    deskReal: one.shell.deskReal === '' ? one.desk : one.shell.deskReal,
    manifests: one.shell.manifests,
  });
  return answer.kind === 'named' ? answer.path : '';
};

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-manifest-corpus-'));
  cases = buildCases();
});

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

describe('desk-manifest agrees with plot-worker-state.sh', () => {
  it('reads a corpus worth comparing', () => {
    // A FLOOR, because the comparisons below are universally quantified and a
    // universal claim over an empty set is true.
    expect(cases.length).toBeGreaterThan(8);
    expect(cases.every((one) => one.desk !== '')).toBe(true);
  });

  it('exercises both answers and every directory shape, so this is not vacuous', () => {
    // If every row answered *no manifest* the agreement would be an accident of
    // the fixture rather than a property of the pair — and *no manifest* is
    // exactly what main answers for every row.
    expect(cases.some((one) => one.shell.manifest !== '')).toBe(true);
    expect(cases.some((one) => one.shell.manifest === '')).toBe(true);
    // Every directory shape resolved to something, including the two configured
    // ones: a key that read as empty would exercise the default twice.
    expect(cases.every((one) => one.shell.dir !== '')).toBe(true);
    expect(cases.some((one) => one.configured !== '')).toBe(true);
    expect(cases.some((one) => one.configured.startsWith('/'))).toBe(true);
    expect(cases.some((one) => one.configured !== '' && !one.configured.startsWith('/'))).toBe(true);
  });

  it('resolves the directory the shell resolves, on every shape', () => {
    const found: Disagreement[] = [];
    for (const one of cases) {
      // The shell's answer is PHYSICAL — composed from `pwd -P` — while
      // `mainCheckout` here is the logical fixture path, so the rule is asked
      // with the root the shell actually used. The comparison is then about the
      // JOIN, which is what the two sides each implement.
      const root = one.shell.dir.startsWith('/') && one.configured.startsWith('/')
        ? one.mainCheckout
        : physical(one.mainCheckout);
      compareField(
        found,
        one.name,
        'directory',
        manifestDirectory({ mainCheckout: root, configured: one.configured }),
        one.shell.dir,
      );
    }
    // ONE comparison rather than an assertion per shape: one shape disagreeing
    // and every shape disagreeing are different findings pointing at different
    // bugs, and a failure has to name which.
    expect(found.map(report)).toEqual([]);
  });

  it('names the manifest the shell names, on every desk', () => {
    const found: Disagreement[] = [];
    for (const one of cases) {
      compareField(found, one.name, 'manifest', ruleAnswer(one), one.shell.manifest);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('declines on a desk two manifests name, on both sides', () => {
    // `several` is the answer a first-match loop cannot give, and it is asserted
    // on the SHELL's answer too — this is the case where agreeing on the wrong
    // thing hides an estate defect rather than losing a desk.
    const several = cases.find((one) => one.name === 'several');
    expect(several?.shell.manifest).toBe('');
    expect(several?.shell.manifests.length).toBe(2);
    expect(
      deskManifest({
        desk: several!.desk,
        deskReal: several!.shell.deskReal,
        manifests: several!.shell.manifests,
      }).kind,
    ).toBe('several');
  });

  it('finds the manifest from inside a desk, on both sides', () => {
    // #1086 ITSELF. The shell derived `<desk>/.plot/agents` and found nothing,
    // so this row is the one that fails on main — asserted directly rather than
    // only through the comparison, because a comparison of two *no manifest*
    // answers passes.
    const inside = cases.find((one) => one.name === 'path-match-from-desk');
    expect(inside?.shell.manifest).not.toBe('');
    expect(ruleAnswer(inside!)).toBe(inside!.shell.manifest);
  });

  it('reads the `Agent registry` key, on both sides', () => {
    for (const name of ['configured-absolute', 'configured-relative']) {
      const one = cases.find((c) => c.name === name);
      expect(one?.shell.manifest, `${name} must find its manifest`).not.toBe('');
      expect(ruleAnswer(one!)).toBe(one!.shell.manifest);
    }
  });

  it('reports a disagreement naming the subject and both answers', () => {
    // THE REPORT IS THE DELIVERABLE, so it is asserted rather than assumed.
    const line = report({
      subject: 'several',
      field: 'manifest',
      adapter: '"/a/one.json"',
      production: '""',
    });
    expect(line).toBe('several :: manifest :: rule="/a/one.json" shell=""');
  });
});

/** A path through `pwd -P`, the form the shell composes its directory from. */
const physical = (p: string): string =>
  execFileSync('bash', ['-c', 'cd "$1" && pwd -P', 'bash', p], { encoding: 'utf8' }).trim();
