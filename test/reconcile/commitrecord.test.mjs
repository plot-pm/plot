// Contract test for skills/plot/scripts/plot-commit-record.sh and its installer
// — the record that exists because the cause is unknown.
//
// Three explanations of this defect have been proposed and all three disproved
// in sandboxes: that an agent's push leaves a session's files reading as
// modified, that a second session shares the checkout, and that a session
// stages then pulls then commits. A gate needs a condition and every condition
// has died, so what is built is a RECORD — and these tests hold it to the two
// properties that make a record worth having: it fires on the measured
// signature, and it is silent on everything else.
//
// SILENCE IS THE ASSERTION THAT MATTERS. A record every commit produces is a
// log nobody reads. Measured over 150 recent commits on this estate: 2 records,
// one of them the known incident 3a3efcac.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const recorder = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-commit-record.sh');
const installer = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-install-commit-record.sh');

let tmp;
const git = (cwd, ...args) =>
  execFileSync('git', args, { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] });

/** Run a script in `cwd`; never throws, so the outcome word is readable. */
const run = (script, cwd, ...args) => {
  try {
    return { code: 0, out: execFileSync('bash', [script, ...args], { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

/** The recorder writes its note to stderr; both streams are folded together. */
const record = (cwd) => {
  const r = execFileSync('bash', [recorder], { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  return r;
};

const records = (cwd) => {
  const dir = path.join(cwd, '.plot', 'state', 'commit-records');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l)));
};

/**
 * The measured shape: a session whose checkout moved under it, committing the
 * older content it still had on disk. A bare remote, a session clone, and an
 * agent clone that advances origin — the same four commands that disproved the
 * first explanation.
 */
const estate = () => {
  const r = fs.mkdtempSync(path.join(tmp, 'estate-'));
  const bare = path.join(r, 'remote.git');
  git(r, 'init', '-q', '-b', 'main', '--bare', 'remote.git');
  git(r, 'clone', '-q', bare, 'sess');
  const sess = path.join(r, 'sess');
  git(sess, 'config', 'user.email', 'a@b.c');
  git(sess, 'config', 'user.name', 'A');
  fs.writeFileSync(path.join(sess, 'plan.md'), 'v1\n');
  fs.writeFileSync(path.join(sess, 'other.md'), 'other\n');
  git(sess, 'add', '-A');
  git(sess, 'commit', '-qm', 'one');
  git(sess, 'push', '-q', 'origin', 'main');
  return { root: r, bare, sess };
};

/** An agent advances `origin/main`, exactly as the fleet does. */
const agentPushes = ({ root, bare }, content = 'v2-newer\n') => {
  const agent = fs.mkdtempSync(path.join(root, 'agent-'));
  git(root, 'clone', '-q', bare, agent);
  git(agent, 'config', 'user.email', 'a@b.c');
  git(agent, 'config', 'user.name', 'A');
  fs.writeFileSync(path.join(agent, 'plan.md'), content);
  git(agent, 'add', '-A');
  git(agent, 'commit', '-qm', 'agent records its PR');
  git(agent, 'push', '-q', 'origin', 'main');
};

before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-commit-record-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('recorder: is shipped and is a valid bash file', () => {
  assert.ok(fs.existsSync(recorder), 'the recorder must exist');
  execFileSync('bash', ['-n', recorder]);
});

test('an ordinary commit records nothing', () => {
  // The property the whole design rests on. A record every commit produces is
  // a log nobody reads.
  const e = estate();
  fs.writeFileSync(path.join(e.sess, 'other.md'), 'brand new content\n');
  git(e.sess, 'add', '-A');
  git(e.sess, 'commit', '-qm', 'ordinary work');

  const out = record(e.sess);
  assert.equal(out, '', 'an ordinary commit says nothing');
  assert.deepEqual(records(e.sess), [], 'and writes nothing');
});

test('a commit setting a file to content the path already held is recorded', () => {
  // The measured signature: the session commits its own older blob onto a
  // parent that had moved on.
  const e = estate();
  agentPushes(e);
  git(e.sess, 'fetch', '-q', 'origin');
  git(e.sess, 'merge', '-q', '--ff-only', 'origin/main');

  // Something restores the older content — this plan cannot say what, which is
  // exactly why the record exists rather than a gate.
  fs.writeFileSync(path.join(e.sess, 'plan.md'), 'v1\n');
  git(e.sess, 'add', '-A');
  git(e.sess, 'commit', '-qm', 'a commit that reverts a file it never edited');

  record(e.sess);
  const found = records(e.sess);
  assert.equal(found.length, 1, 'one record for one commit');

  const rec = found[0];
  assert.equal(rec.version, 1);
  assert.equal(rec.commit, git(e.sess, 'rev-parse', 'HEAD').trim());
  assert.equal(rec.parent, git(e.sess, 'rev-parse', 'HEAD^').trim());

  // BOTH SHAS AT THE MOMENT IT HAPPENS — the plan's "done when".
  const file = rec.files.find((f) => f.path === 'plan.md');
  assert.ok(file, 'the reverted file is named');
  assert.equal(file.committed, git(e.sess, 'rev-parse', 'HEAD:plan.md').trim());
  assert.equal(file.parent, git(e.sess, 'rev-parse', 'HEAD^:plan.md').trim());
  assert.notEqual(file.committed, file.parent, 'the commit changed the file');

  // And what the shared ref held, which is what makes the record diagnosable.
  assert.equal(rec.origin, git(e.sess, 'rev-parse', 'refs/remotes/origin/main').trim());
  assert.equal(file.origin, file.parent, 'the parent agreed with origin; the commit moved away from it');
  assert.ok(/^[0-9a-f]{40}$/.test(file.heldBy), 'the commit that previously held this content is named');
});

test('a genuine edit committed beside a revert is not recorded', () => {
  // Measured on the real incident 3a3efcac: one reverted plan file alongside
  // two genuine edits the commit was actually for. Per-file classification is
  // the whole point — a per-commit verdict would indict honest work.
  const e = estate();
  agentPushes(e);
  git(e.sess, 'fetch', '-q', 'origin');
  git(e.sess, 'merge', '-q', '--ff-only', 'origin/main');

  fs.writeFileSync(path.join(e.sess, 'plan.md'), 'v1\n');            // the revert
  fs.writeFileSync(path.join(e.sess, 'other.md'), 'real work here\n'); // the edit
  git(e.sess, 'add', '-A');
  git(e.sess, 'commit', '-qm', 'real work, and a revert nobody intended');

  record(e.sess);
  const rec = records(e.sess)[0];
  const paths = rec.files.map((f) => f.path);
  assert.deepEqual(paths, ['plan.md'], 'only the reverted file is named');
});

test('a deliberate revert is recorded too, because intent is unreadable', () => {
  // THE RECORD CANNOT READ INTENT AND DOES NOT TRY. A person reverting a file
  // on purpose produces the same blobs as the defect, so it is recorded and a
  // reader decides. That is the honest failure mode for an observation: this
  // never refuses anything, so a record costs a line in a log and nothing else.
  const e = estate();
  fs.writeFileSync(path.join(e.sess, 'plan.md'), 'v2\n');
  git(e.sess, 'add', '-A');
  git(e.sess, 'commit', '-qm', 'edit');
  fs.writeFileSync(path.join(e.sess, 'plan.md'), 'v1\n');
  git(e.sess, 'add', '-A');
  git(e.sess, 'commit', '-qm', 'deliberate revert to v1');

  record(e.sess);
  assert.equal(records(e.sess).length, 1, 'a deliberate revert looks the same and is recorded');
});

test('the record cannot affect the commit', () => {
  // POST-commit and fail-silent. A recorder that breaks a commit is worse than
  // the defect it observes.
  const e = estate();
  fs.writeFileSync(path.join(e.sess, 'other.md'), 'x\n');
  git(e.sess, 'add', '-A');
  git(e.sess, 'commit', '-qm', 'work');
  const head = git(e.sess, 'rev-parse', 'HEAD').trim();

  const r = run(recorder, e.sess);
  assert.equal(r.code, 0, 'the recorder always exits 0');
  assert.equal(git(e.sess, 'rev-parse', 'HEAD').trim(), head, 'HEAD is untouched');
});

test('a repository with no origin still records', () => {
  // `origin` is read where present and never fetched. A local-only repository
  // must still get its evidence.
  const r = fs.mkdtempSync(path.join(tmp, 'local-'));
  git(r, 'init', '-q', '-b', 'main');
  git(r, 'config', 'user.email', 'a@b.c');
  git(r, 'config', 'user.name', 'A');
  fs.writeFileSync(path.join(r, 'f.md'), 'v1\n');
  git(r, 'add', '-A'); git(r, 'commit', '-qm', 'one');
  fs.writeFileSync(path.join(r, 'f.md'), 'v2\n');
  git(r, 'add', '-A'); git(r, 'commit', '-qm', 'two');
  fs.writeFileSync(path.join(r, 'f.md'), 'v1\n');
  git(r, 'add', '-A'); git(r, 'commit', '-qm', 'back to v1');

  const out = run(recorder, r);
  assert.equal(out.code, 0, out.out);
  const found = records(r);
  assert.equal(found.length, 1, 'the record is written without a remote');
  assert.equal(found[0].origin, '', 'and says plainly that origin was unreadable');
});

test('a root commit records nothing', () => {
  // No parent, so nothing can have moved under it.
  const r = fs.mkdtempSync(path.join(tmp, 'root-'));
  git(r, 'init', '-q', '-b', 'main');
  git(r, 'config', 'user.email', 'a@b.c');
  git(r, 'config', 'user.name', 'A');
  fs.writeFileSync(path.join(r, 'f.md'), 'v1\n');
  git(r, 'add', '-A'); git(r, 'commit', '-qm', 'root');

  assert.equal(run(recorder, r).code, 0);
  assert.deepEqual(records(r), [], 'a root commit is silent');
});

test('the log is bounded by day', () => {
  // A growing log needs a bound. The unit is the DAY because that is how a
  // forensic record is asked for, and because pruning whole days is one `rm`.
  const e = estate();
  const dir = path.join(e.sess, '.plot', 'state', 'commit-records');
  fs.mkdirSync(dir, { recursive: true });
  // 40 days of history, past the 30 the recorder keeps.
  for (let i = 0; i < 40; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    fs.writeFileSync(path.join(dir, `${d}.jsonl`), '{"version":1}\n');
  }

  agentPushes(e);
  git(e.sess, 'fetch', '-q', 'origin');
  git(e.sess, 'merge', '-q', '--ff-only', 'origin/main');
  fs.writeFileSync(path.join(e.sess, 'plan.md'), 'v1\n');
  git(e.sess, 'add', '-A');
  git(e.sess, 'commit', '-qm', 'revert');
  record(e.sess);

  const days = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  assert.ok(days.length <= 30, `the log is bounded, found ${days.length} days`);
  // The newest survive; the oldest are the ones dropped.
  assert.ok(!days.includes('2026-01-01.jsonl'), 'the oldest day is pruned');
});

test('installer: writes a post-commit hook where none exists', () => {
  const r = fs.mkdtempSync(path.join(tmp, 'inst-'));
  git(r, 'init', '-q', '-b', 'main');
  const hook = path.join(r, '.git', 'hooks', 'post-commit');
  assert.ok(!fs.existsSync(hook), 'precondition: no hook');

  const { code, out } = run(installer, r);
  assert.equal(code, 0, out);
  assert.match(out, /^written /, out);
  assert.ok(fs.existsSync(hook), 'the hook is either present or absent — that is the gate');
  execFileSync('bash', ['-n', hook]);
  assert.match(fs.readFileSync(hook, 'utf8'), /plot-commit-record\.sh/);
});

test('installer: never overwrites somebody else\'s post-commit hook', () => {
  // A repository may already run one for its own reasons, and this script
  // cannot tell an important hook from an abandoned one.
  const r = fs.mkdtempSync(path.join(tmp, 'inst-own-'));
  git(r, 'init', '-q', '-b', 'main');
  const hook = path.join(r, '.git', 'hooks', 'post-commit');
  const mine = '#!/bin/sh\necho "my own hook"\n';
  fs.writeFileSync(hook, mine);

  const { code, out } = run(installer, r);
  assert.equal(code, 3, out);
  assert.match(out, /^present /, out);
  assert.equal(fs.readFileSync(hook, 'utf8'), mine, 'the file is untouched');
  assert.match(out, /add this line to it/, 'the report says what to change');
});

test('installer: is idempotent', () => {
  const r = fs.mkdtempSync(path.join(tmp, 'inst-idem-'));
  git(r, 'init', '-q', '-b', 'main');
  assert.equal(run(installer, r).code, 0);
  const second = run(installer, r);
  assert.equal(second.code, 0, second.out);
  assert.match(second.out, /^current /, second.out);
});

test('installer: --check writes nothing', () => {
  // /plot-init asks before it acts: installing a git hook is a decision the
  // repo makes, not a side effect of cloning.
  const r = fs.mkdtempSync(path.join(tmp, 'inst-check-'));
  git(r, 'init', '-q', '-b', 'main');
  const { code, out } = run(installer, r, '--check');
  assert.equal(code, 3, out);
  assert.match(out, /^absent /, out);
  assert.ok(!fs.existsSync(path.join(r, '.git', 'hooks', 'post-commit')), '--check creates nothing');
});

test('installer: honours core.hooksPath', () => {
  // A repository that sets it runs nothing from `.git/hooks`, so a file
  // written there would never execute.
  const r = fs.mkdtempSync(path.join(tmp, 'inst-path-'));
  git(r, 'init', '-q', '-b', 'main');
  git(r, 'config', 'core.hooksPath', 'githooks');

  const { code, out } = run(installer, r);
  assert.equal(code, 0, out);
  assert.ok(fs.existsSync(path.join(r, 'githooks', 'post-commit')), 'written where git will read it');
  assert.ok(!fs.existsSync(path.join(r, '.git', 'hooks', 'post-commit')), 'and not where it would not');
});

test('the installed hook records a real commit end to end', () => {
  // The template nobody runs proves nothing. This installs the hook and makes
  // a real commit through git, so the wiring is exercised rather than asserted.
  const e = estate();
  // The shim resolves the recorder through the checkout, so the sandbox needs
  // one at that path.
  const dest = path.join(e.sess, 'skills', 'plot', 'scripts');
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(recorder, path.join(dest, 'plot-commit-record.sh'));
  fs.chmodSync(path.join(dest, 'plot-commit-record.sh'), 0o755);
  git(e.sess, 'add', '-A');
  git(e.sess, 'commit', '-qm', 'carry the recorder');
  // Push it before the agent moves origin, or the two lines diverge and the
  // fast-forward below — the whole point of the scenario — cannot apply.
  git(e.sess, 'push', '-q', 'origin', 'main');

  assert.equal(run(installer, e.sess).code, 0);

  agentPushes(e, 'v3-from-the-fleet\n');
  git(e.sess, 'fetch', '-q', 'origin');
  git(e.sess, 'merge', '-q', '--ff-only', 'origin/main');
  fs.writeFileSync(path.join(e.sess, 'plan.md'), 'v1\n');
  git(e.sess, 'add', '-A');
  git(e.sess, 'commit', '-qm', 'the commit that reverts');

  const found = records(e.sess);
  assert.equal(found.length, 1, 'git ran the hook and the record was written');
  assert.equal(found[0].commit, git(e.sess, 'rev-parse', 'HEAD').trim());
});
