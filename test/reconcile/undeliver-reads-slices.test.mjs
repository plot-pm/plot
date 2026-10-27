// `plot-undeliver.sh` reads a plan's branches through `plot-plan-meta.sh` and
// supplies one reading per branch; the domain decides `refs-swept` and
// `refs-unknown`. Each case runs the real script and the real bundle in a
// throwaway repo with a local bare origin and a `gh` on PATH that records its
// argv. Run `pnpm build:board` first: the bundle is generated and uncommitted.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.resolve(here, '../../skills/plot/scripts');
const undeliver = path.join(scripts, 'plot-undeliver.sh');
const gate = path.join(scripts, 'plot-state-gate.sh');

const made = [];
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const cleanEnv = () => {
  const e = { ...process.env };
  for (const k of ['PLOT_UNATTENDED', 'PLOT_REPO_ROOT']) delete e[k];
  return e;
};

const LIST_FORM = (branches) => ['## Slices', '', '### Wave', '', ...branches.map((b) => `- \`${b}\` — work`), ''].join('\n');
const HEADING_FORM = (branches) => ['## Slices', '', ...branches.map((b, i) => `### Slice ${i + 1} (Branch: ${b})`), ''].join('\n');

/**
 * A repo with one Delivered plan, a local bare origin, and a `gh` stub.
 *
 * @param opts.slices the plan's `## Slices` text.
 * @param opts.pushed branches that exist on origin.
 * @param opts.prs per-branch PR rows the stub answers with: `{ state, mergedAt }`.
 * @returns the repo path, the stub's argv log, and a runner for the script.
 */
const sandbox = ({ slices, pushed = [], prs = {} }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-undeliver-'));
  made.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  for (const [k, v] of [['user.email', 't@example.invalid'], ['user.name', 'T'], ['commit.gpgsign', 'false']]) git(repo, 'config', k, v);
  fs.mkdirSync(path.join(repo, 'docs/plans/delivered'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Git host:** github\n- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/\n');
  fs.writeFileSync(path.join(repo, 'docs/plans/2026-01-01-thing.md'), [
    '# A plan', '', '## Status', '', '- **State:** Delivered', '- **Approved:** 2026-01-01, T, in-session',
    '- **Delivered:** 2026-01-02', '', slices, '## Changelog', '', '- Did a thing.', '',
  ].join('\n'));
  fs.symlinkSync('../2026-01-01-thing.md', path.join(repo, 'docs/plans/delivered/thing.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');
  for (const b of pushed) git(repo, 'push', '-q', 'origin', `HEAD:refs/heads/${b}`);

  const bin = path.join(tmp, 'bin');
  const log = path.join(tmp, 'gh.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, argv.join(' ') + '\\n');
if (argv[0] !== 'pr' || argv[1] !== 'list') process.exit(1);
const arg = (n) => argv[argv.indexOf(n) + 1];
const head = arg('--head');
const state = arg('--state');
const rows = (${JSON.stringify(prs)}[head] || []).map((p, i) => ({
  number: i + 1, title: 't', state: p.state, headRefName: head, isDraft: false, url: 'u', updatedAt: '2026-01-01T00:00:00Z',
  author: { login: 'a' }, headRefOid: 'abc', mergeable: 'UNKNOWN', mergeStateStatus: '', reviewDecision: '', mergedAt: p.mergedAt || null,
}));
// gh's own vocabulary: "closed" is closed-and-unmerged, "merged" is merged.
const keep = rows.filter((r) => state === 'all' || (state === 'closed' ? r.state === 'CLOSED' && !r.mergedAt : state === 'merged' ? r.mergedAt : r.state === 'OPEN'));
process.stdout.write(JSON.stringify(keep));
`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);

  const run = () => {
    const r = spawnSync('bash', [undeliver, 'thing', '--why', 'work unbuilt', '--on', '2026-01-03'], {
      cwd: repo, encoding: 'utf8', env: { ...cleanEnv(), PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
  return { repo, origin, run, calls };
};

const MERGED = { state: 'CLOSED', mergedAt: '2026-01-02T00:00:00Z' };
const UNMERGED = { state: 'CLOSED' };
const stateOf = (repo) => fs.readFileSync(path.join(repo, 'docs/plans/2026-01-01-thing.md'), 'utf8').match(/\*\*State:\*\* (\w+)/)[1];

for (const [name, form] of [['list form', LIST_FORM], ['heading form', HEADING_FORM]]) {
  test(`${name}: a merged and deleted branch decides Approved`, () => {
    const s = sandbox({ slices: form(['feature/a']), prs: { 'feature/a': [MERGED] } });
    const r = s.run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /thing → Approved/);
    assert.equal(stateOf(s.repo), 'Approved');
  });
}

test('a branch absent, not merged and closed unmerged refuses refs-swept and names the plan', () => {
  const s = sandbox({ slices: LIST_FORM(['feature/a']), prs: { 'feature/a': [UNMERGED] } });
  const r = s.run();
  assert.equal(r.code, 1);
  assert.match(r.out, /refs-swept: plan 'thing'/);
  assert.equal(stateOf(s.repo), 'Delivered');
});

test('a never-pushed branch with no PR passes', () => {
  const s = sandbox({ slices: LIST_FORM(['feature/a']) });
  assert.equal(s.run().code, 0);
});

test('a deferred branch with no ref does not affect the decision', () => {
  const s = sandbox({
    slices: ['## Slices', '', '### Wave', '', '- `feature/a` — work', '- `feature/b` — later <!-- deferred: next sprint -->', ''].join('\n'),
    prs: { 'feature/a': [MERGED], 'feature/b': [UNMERGED] },
  });
  const r = s.run();
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(s.calls(), /feature\/b/);
});

test('an origin that does not answer refuses refs-unknown and does not say deleted', () => {
  const s = sandbox({ slices: LIST_FORM(['feature/a']), prs: { 'feature/a': [MERGED] } });
  git(s.repo, 'remote', 'set-url', 'origin', path.join(s.repo, 'no-such-origin.git'));
  const r = s.run();
  assert.equal(r.code, 1);
  assert.match(r.out, /refs-unknown: .*could not be read/);
  assert.doesNotMatch(r.out, /deleted/);
  assert.equal(stateOf(s.repo), 'Delivered');
});

test('the host is not asked about a branch whose ref is present', () => {
  const s = sandbox({ slices: LIST_FORM(['feature/a']), pushed: ['feature/a'] });
  const r = s.run();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.calls(), '');
});

test('a successful run clears the state gate and moves the index entry', () => {
  const s = sandbox({ slices: LIST_FORM(['feature/a']), prs: { 'feature/a': [MERGED] } });
  assert.equal(s.run().code, 0);
  assert.ok(fs.existsSync(path.join(s.repo, 'docs/plans/active/thing.md')), 'active entry exists');
  assert.ok(!fs.existsSync(path.join(s.repo, 'docs/plans/delivered/thing.md')), 'delivered entry gone');
  assert.equal(fs.readlinkSync(path.join(s.repo, 'docs/plans/active/thing.md')), '../2026-01-01-thing.md');
  git(s.repo, 'add', '-A');
  const hook = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' } });
  const gated = () => spawnSync('bash', [gate], { cwd: s.repo, input: hook, encoding: 'utf8', env: cleanEnv() });
  const ok = gated();
  assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr}`);
  // Control: with the receipt spent the same staged change is refused, so the
  // pass above came from the receipt and not from a gate that checks nothing.
  const again = gated();
  assert.notEqual(again.status, 0, 'a spent receipt no longer clears the commit');
  assert.match(`${again.stdout}${again.stderr}`, /\/plot-reject thing/);
});
