import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { envFileCandidates, pickEnvFile, readEnvVar, type EnvFileRead } from '../src/rules/env-file.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Do `readEnvVar` and `pickEnvFile` answer what `plot-host.sh`'s
 * `read_env_var` and `plot_env_file` answer?
 *
 * The in-process Bitbucket and Jira clients read credentials from `.env` and
 * the shell reads them the same way. Each case writes one file, asks the shell
 * function over it, and asks the rule over the same text.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = join(ROOT, 'skills/plot/scripts/plot-host.sh');
const report = describingAs({ left: 'rule', right: 'shell' });

interface Line {
  readonly name: string;
  readonly text: string;
  readonly ask: string;
}

const LINES: readonly Line[] = [
  { name: 'plain', text: 'T=tok\n', ask: 'T' },
  { name: 'export', text: 'export T=tok\n', ask: 'T' },
  { name: 'export with tab', text: 'export\tT=tok\n', ask: 'T' },
  { name: 'leading whitespace', text: '   T=tok\n', ask: 'T' },
  { name: 'leading tab and export', text: '\texport   T=tok\n', ask: 'T' },
  { name: 'double quotes', text: 'T="tok"\n', ask: 'T' },
  { name: 'single quotes', text: "T='tok'\n", ask: 'T' },
  { name: 'double quotes then trailing whitespace', text: 'T="tok"   \n', ask: 'T' },
  { name: 'single quotes then trailing tab', text: "T='tok'\t\n", ask: 'T' },
  { name: 'trailing whitespace inside quotes', text: 'T="tok  "\n', ask: 'T' },
  { name: 'whitespace after the quotes inside whitespace', text: 'T=  "tok"  \n', ask: 'T' },
  { name: 'mismatched quotes', text: 'T="tok\'\n', ask: 'T' },
  { name: 'one quote only', text: 'T="tok\n', ask: 'T' },
  { name: 'a lone quote', text: 'T="\n', ask: 'T' },
  { name: 'empty quotes', text: 'T=""\n', ask: 'T' },
  { name: 'quotes around quotes', text: 'T=""tok""\n', ask: 'T' },
  { name: 'two quoted words', text: 'T="a" "b"\n', ask: 'T' },
  { name: 'empty value', text: 'T=\n', ask: 'T' },
  { name: 'duplicated name takes the first', text: 'T=first\nT=second\n', ask: 'T' },
  { name: 'duplicated name, first empty', text: 'T=\nT=second\n', ask: 'T' },
  { name: 'a longer name sharing the prefix', text: 'TT=wrong\nT=right\n', ask: 'T' },
  { name: 'a name only inside a comment', text: '# T=nope\n', ask: 'T' },
  { name: 'a name as a suffix', text: 'XT=nope\n', ask: 'T' },
  { name: 'value with equals signs', text: 'T=a=b==\n', ask: 'T' },
  { name: 'value with a hash', text: 'T=abc # not a comment\n', ask: 'T' },
  { name: 'no trailing newline', text: 'T=tok', ask: 'T' },
  { name: 'CRLF line ends', text: 'T=tok\r\nU=other\r\n', ask: 'T' },
  { name: 'CRLF and quotes', text: 'T="tok"\r\n', ask: 'T' },
  { name: 'absent name', text: 'U=other\n', ask: 'T' },
  { name: 'empty file', text: '', ask: 'T' },
  { name: 'blank lines around', text: '\n\nT=tok\n\n', ask: 'T' },
  { name: 'export without a space', text: 'exportT=tok\n', ask: 'T' },
  { name: 'dollar and backslash', text: 'T=a$b\\c\n', ask: 'T' },
  { name: 'a token like Atlassian issues', text: 'JIRA_API_TOKEN="ATATT3xFfGF0=abc_DEF-123"\n', ask: 'JIRA_API_TOKEN' },
];

let sandbox = '';
let shellValues: string[] = [];

/** The shell's `read_env_var` over one file's text. */
const shellRead = (one: Line, index: number): string => {
  const file = join(sandbox, `case-${index}.env`);
  writeFileSync(file, one.text);
  const run = spawnSync('bash', ['-c', `${shellFunctions()}\nread_env_var "$1" "$2"`, 'corpus', one.ask, file], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (run.error) throw new Error(`read_env_var did not finish: ${run.error.message}`);
  return run.stdout.replace(/\n$/, '');
};

/** The text of `read_env_var`, `plot_env_file` and `plot_env_file_qualifies`, lifted from `plot-host.sh`. */
const shellFunctions = (): string => {
  const run = spawnSync(
    'awk',
    [
      '/^(read_env_var|plot_env_file|plot_env_file_qualifies)\\(\\) \\{/{on=1} on{print} on&&/^\\}/{on=0}',
      HOST,
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0 || run.stdout === '') throw new Error(`could not lift the env functions: ${run.stderr}`);
  return run.stdout;
};

beforeAll(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'plot-env-file-corpus-')));
  shellValues = LINES.map(shellRead);
});

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

describe('readEnvVar agrees with plot-host.sh read_env_var', () => {
  it('exercises a value and an empty answer, so this is not vacuous', () => {
    expect(shellValues.some((v) => v !== '')).toBe(true);
    expect(shellValues.some((v) => v === '')).toBe(true);
  });

  it('answers what the shell answers on every recorded line', () => {
    const found: Disagreement[] = [];
    LINES.forEach((one, i) => compareField(found, one.name, 'value', readEnvVar(one.text, one.ask), shellValues[i] ?? ''));
    expect(found.map(report)).toEqual([]);
  });
});

/** One arrangement of the two `.env` files. */
interface Layout {
  readonly name: string;
  readonly worktree: string | null;
  readonly main: string | null;
}

const BOTH = 'A=1\nB=2\n';
const LAYOUTS: readonly Layout[] = [
  { name: 'worktree holds both', worktree: BOTH, main: 'A=x\nB=y\n' },
  { name: 'only the main checkout holds both', worktree: null, main: BOTH },
  { name: 'worktree holds half, main holds both', worktree: 'A=1\n', main: BOTH },
  { name: 'worktree holds the other half, main holds both', worktree: 'B=2\n', main: BOTH },
  { name: 'worktree holds half, main holds half', worktree: 'A=1\n', main: 'B=2\n' },
  { name: 'worktree holds an empty value, main holds both', worktree: 'A=1\nB=\n', main: BOTH },
  { name: 'neither file exists', worktree: null, main: null },
  { name: 'both files lack both', worktree: 'C=3\n', main: 'D=4\n' },
  { name: 'quoted pair in the worktree', worktree: 'export A="1"  \nB=\'2\'\n', main: null },
];

/** The shell's pick over a real repository with a linked worktree, as `path|label`. */
const shellPick = (layout: Layout, index: number): { path: string; label: string } | null => {
  const main = join(sandbox, `repo-${index}`);
  const desk = join(sandbox, `desk-${index}`);
  mkdirSync(main);
  const git = (cwd: string, ...args: string[]): void => {
    const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { cwd, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
  };
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'seed');
  git(main, 'worktree', 'add', '-q', desk);
  if (layout.main !== null) writeFileSync(join(main, '.env'), layout.main);
  if (layout.worktree !== null) writeFileSync(join(desk, '.env'), layout.worktree);
  const env = { ...process.env };
  delete env.PLOT_GIT_COMMON_DIR;
  delete env.PLOT_REPO_ROOT;
  const run = spawnSync('bash', ['-c', `here="$1"; ${shellFunctions()}\ncd "$2" && plot_env_file A B`, 'corpus', join(ROOT, 'skills/plot/scripts'), desk], {
    encoding: 'utf8',
    env,
    timeout: 20_000,
  });
  if (run.error) throw new Error(`plot_env_file did not finish: ${run.error.message}`);
  if (run.stdout === '') return null;
  const [path = '', label = ''] = run.stdout.split('|');
  return { path, label };
};

/** The rule's pick over the same layout, with the top level and common dir git printed. */
const rulePick = (layout: Layout, index: number): { path: string; label: string } | null => {
  const main = join(sandbox, `repo-${index}`);
  const desk = join(sandbox, `desk-${index}`);
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: desk, encoding: 'utf8' }).stdout.trim();
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: desk, encoding: 'utf8' }).stdout.trim();
  expect(common).toBe(join(main, '.git'));
  const text = { worktree: layout.worktree, 'main-checkout': layout.main };
  const reads: EnvFileRead[] = envFileCandidates(top, common).map((candidate) => ({ candidate, text: text[candidate.source] }));
  const picked = pickEnvFile(reads, ['A', 'B']);
  return picked === null ? null : { path: picked.path, label: picked.source === 'worktree' ? '' : "the main checkout's " };
};

describe('pickEnvFile agrees with plot-host.sh plot_env_file', () => {
  it('answers what the shell answers on every recorded layout, with the same path and the same source', () => {
    const found: Disagreement[] = [];
    LAYOUTS.forEach((layout, i) => {
      const shell = shellPick(layout, i);
      const rule = rulePick(layout, i);
      compareField(found, layout.name, 'path', rule?.path ?? '', shell?.path ?? '');
      compareField(found, layout.name, 'source', rule?.label ?? '', shell?.label ?? '');
    });
    expect(found.map(report)).toEqual([]);
  });
});
