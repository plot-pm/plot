// Contract test for skills/plot/scripts/plot-context.sh — what Plot contributes
// to a session log someone else writes.
//
// Plot does not write session logs. The `bye` skill does that far better: it
// reconstructs compacted history, classifies session types, and guards against
// parallel sessions — all things a plan-shaped tool cannot know. Plot's job is
// to hand it the plot-shaped facts: which plan, which phase, which branches.
//
// So this is a SUPPLIER, not an author. Read-only, machine-readable, and it
// must say "nothing" clearly rather than inventing context.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-context.sh');

let tmp;
function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}
function run(cwd) {
  return JSON.parse(execFileSync('bash', [ctx], { encoding: 'utf8', cwd }));
}
function repo({ plan, branch } = {}) {
  const r = fs.mkdtempSync(path.join(tmp, 'r-'));
  const o = path.join(r, 'origin.git');
  const w = path.join(r, 'work');
  git(r, 'init', '--bare', '-q', '-b', 'main', o);
  git(r, 'clone', '-q', o, 'work');
  git(w, 'config', 'user.email', 'test@example.invalid');
  git(w, 'config', 'user.name', 'Plot Test');
  git(w, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(w, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.mkdirSync(path.join(w, 'plans', 'active'), { recursive: true });
  if (plan) {
    fs.writeFileSync(path.join(w, 'plans', `2026-01-01-${plan.slug}.md`), plan.body);
    fs.symlinkSync(`../2026-01-01-${plan.slug}.md`,
      path.join(w, 'plans', 'active', `${plan.slug}.md`));
  }
  git(w, 'add', '-A');
  git(w, 'commit', '-qm', 'init');
  git(w, 'push', '-q', 'origin', 'main');
  if (branch) git(w, 'checkout', '-q', '-b', branch);
  return w;
}

before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ctx-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('context: names the plan governing the current branch', () => {
  // On feature/x of a plan that lists feature/x, the session is about that
  // plan — the log should say so without the human retyping it.
  const w = repo({
    plan: { slug: 'thing', body: '# Thing\n\n## Status\n\n- **Phase:** Approved\n- **Type:** feature\n\n## Branches\n\n- `feature/thing` — the work\n' },
    branch: 'feature/thing',
  });
  const c = run(w);
  assert.equal(c.plan_slug, 'thing');
  assert.equal(c.phase, 'approved');
  assert.equal(c.branch, 'feature/thing');
});

test('context: reports the wave position when the plan has waves', () => {
  const w = repo({
    plan: { slug: 'waved', body: '# W\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### Tracer\n- `feature/seam` — first\n\n### Implementation\n- `feature/api` — second\n' },
    branch: 'feature/api',
  });
  const c = run(w);
  assert.equal(c.wave, 'Implementation');
  assert.equal(c.waves_total, 2);
});

test('context: says so plainly when the branch belongs to no plan', () => {
  // A session on an unrelated branch must not be attributed to a plan just
  // because one exists. Wrong attribution in a durable log is worse than none.
  const w = repo({
    plan: { slug: 'other', body: '# O\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n- `feature/other` — x\n' },
    branch: 'feature/unrelated',
  });
  const c = run(w);
  assert.equal(c.plan_slug, '');
  assert.equal(c.branch, 'feature/unrelated');
});

test('context: works in a repo with no plans at all', () => {
  const w = repo({});
  const c = run(w);
  assert.equal(c.plan_slug, '');
  assert.equal(c.phase, '');
});

test('context: is read-only', () => {
  const w = repo({
    plan: { slug: 'ro', body: '# R\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n- `feature/ro` — x\n' },
    branch: 'feature/ro',
  });
  const before = git(w, 'status', '--porcelain');
  run(w);
  assert.equal(git(w, 'status', '--porcelain'), before);
});

test('context: an idea/ branch resolves its plan even when no Branches list names it', () => {
  // A plan on its own idea/ branch is often not listed in any Branches section
  // yet — the fast path is the ONLY thing that resolves it. Disabling that path
  // left every test green, so nothing pinned the primary resolution route.
  const w = repo({
    plan: { slug: 'solo', body: '# Solo\n\n## Status\n\n- **Phase:** Draft\n- **Type:** feature\n\n## Branches\n\n<!-- none yet -->\n' },
    branch: 'idea/solo',
  });
  assert.equal(run(w).plan_slug, 'solo');
});

test('context: a branch claimed by two plans reports the ambiguity, not a guess', () => {
  // The loop broke on the first glob hit, so the "governing plan" was whichever
  // symlink sorted first ALPHABETICALLY — renaming a file changed the answer
  // without anything about the work changing. The header promises the opposite:
  // "a durable decision record attributed to the wrong plan is worse than one
  // with no attribution". Silence about ambiguity is exactly that attribution.
  const w = repo({});
  const plansDir = path.join(w, 'plans');
  for (const n of ['alpha', 'beta']) {
    fs.writeFileSync(path.join(plansDir, `2026-01-01-${n}.md`),
      `# ${n}\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n- \`feature/shared\` — in both\n`);
    fs.symlinkSync(`../2026-01-01-${n}.md`, path.join(plansDir, 'active', `${n}.md`));
  }
  git(w, 'add', '-A');
  git(w, 'commit', '-qm', 'two plans');
  git(w, 'checkout', '-q', '-b', 'feature/shared');

  const c = run(w);
  assert.equal(c.ambiguous, true, 'ambiguity must be reported');
  assert.deepEqual([...c.candidates].sort(), ['alpha', 'beta']);
  assert.equal(c.plan_slug, '', 'no single plan may be claimed when two match');
});
