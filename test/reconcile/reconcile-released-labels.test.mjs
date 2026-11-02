// Contract test for the reconcile section "Closed issues of Released plans
// without plan:released": the scan asks `board/plot-released-labels.mjs
// --section`, prints the drift count and the `--yes` command, and writes
// nothing to the tracker.
//
// The sandbox is a real repository whose origin/main holds one Released plan
// answering issue #7. The host is a `gh` stub on PATH that records every call
// and lists #7 as closed with no `plan:released` label. The assertion that
// matters is the call log: a dry run that labelled the issue would print the
// same section.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reconcile-scan.sh');

const made = [];
const tmp = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `plot-${tag}-`));
  made.push(d);
  return d;
};
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/** A `gh` that lists issue #7 as closed with `labels`, and records every call. */
const stubGh = (labels) => {
  const dir = tmp('relabels-gh');
  const log = path.join(dir, 'calls.log');
  const issue = JSON.stringify([{
    number: 7, title: 'Seven', url: '', createdAt: '', assignees: [],
    closedAt: '2026-01-02T00:00:00Z', labels: labels.map((name) => ({ name })),
  }]);
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
case "$*" in
  *"issue list"*) printf '%s' '${issue}' ;;
  *"pr list"*)    printf '%s' '[]' ;;
esac
exit 0
`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return {
    dir,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => l !== '') : []),
  };
};

let repo;
before(() => {
  const t = tmp('relabels');
  const origin = path.join(t, 'origin.git');
  repo = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', origin);
  git(t, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/plot-pm/fixture.git');
  git(repo, 'remote', 'add', 'store', origin);
  const w = (rel, content) => {
    const p = path.join(repo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  w('CLAUDE.md', ['# Fixture', '', '## Plot Config', '',
    '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/',
    '- **Plan directory:** plans/', '- **Active index:** plans/active/',
    '- **Delivered index:** plans/delivered/', ''].join('\n'));
  w('plans/2026-01-10-seven.md', ['# Seven', '', '## Status', '',
    '- **Phase:** Released', '- **Type:** feature', '- **Issue:** #7', ''].join('\n'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plans');
  git(repo, 'push', '-q', 'store', 'main');
  git(repo, 'fetch', '-q', 'store');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'refs/remotes/store/main');
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
});

let scanTmpdir;
const runScan = (stub, extraEnv = {}) => {
  scanTmpdir ??= tmp('relabels-tmpdir');
  const env = {
    ...process.env,
    TMPDIR: scanTmpdir,
    PLOT_BUDGET_HOME: scanTmpdir,
    PLOT_PR_INDEX_HOME: scanTmpdir,
    PATH: `${stub.dir}:${process.env.PATH}`,
    ...extraEnv,
  };
  delete env.PLOT_REPO_ROOT;
  return execFileSync('bash', [scan, '--no-fetch'], { encoding: 'utf8', cwd: repo, env });
};

const sectionOf = (out) => {
  const lines = out.split('\n');
  const at = lines.findIndex((l) => l.startsWith('== Closed issues of Released plans without plan:released'));
  return at < 0 ? null : lines.slice(at, at + 3);
};

const writes = (stub) => stub.calls().filter((l) => /issue (edit|comment|close)|label create/.test(l));

test('one drifted issue prints 1 and the --yes command, and nothing is written', () => {
  const stub = stubGh(['bug']);
  const out = runScan(stub);
  const section = sectionOf(out);
  assert.notEqual(section, null, `the section is missing from:\n${out}`);
  assert.match(section[1], /^ {2}1 issue\(s\) — run: node .*plot-released-labels\.mjs --yes$/);
  assert.deepEqual(writes(stub), [], `the dry run wrote:\n${stub.calls().join('\n')}`);
});

test('an issue that carries plan:released is not drift', () => {
  const stub = stubGh(['plan:released']);
  const section = sectionOf(runScan(stub));
  assert.equal(section?.[1], '  (none)');
  assert.deepEqual(writes(stub), []);
});

test('--offline skips the section\'s host read and says so', () => {
  const stub = stubGh(['bug']);
  const scanOut = execFileSync('bash', [scan, '--offline'], {
    encoding: 'utf8', cwd: repo,
    env: { ...process.env, PATH: `${stub.dir}:${process.env.PATH}`, PLOT_BUDGET_HOME: tmp('relabels-off'), PLOT_PR_INDEX_HOME: tmp('relabels-off') },
  });
  assert.equal(sectionOf(scanOut)?.[1], '  (not checked: offline)');
  assert.deepEqual(stub.calls().filter((l) => l.includes('issue list')), []);
});
