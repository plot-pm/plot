// Contract test for skills/plot/scripts/plot-sprint-release.sh — the facts
// behind the sprint/release gate.
//
// The script decides NOTHING. It reports a sprint's declared release target
// and the state of each MoSCoW item; /plot-release applies the rule (Must
// refuses, Should prompts, Could neither). So these tests pin the FACTS the
// rule reads, plus the one judgement the script does make: what counts as
// finished when the checkbox and the plan estate disagree.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-sprint-release.sh');

let tmp;
function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}
function run(cwd, ...args) {
  return JSON.parse(execFileSync('bash', [script, ...args], { encoding: 'utf8', cwd }));
}

// A sprint repo: plans land in delivered/ or active/, items reference them by
// slug. `release` omitted → no `Release:` line at all, the pre-existing shape.
function repo({ release, must = [], should = [], could = [], delivered = [], active = [], activeSprint = true, phase = 'Active' } = {}) {
  const w = fs.mkdtempSync(path.join(tmp, 'r-'));
  git(w, 'init', '-q', '-b', 'main');
  git(w, 'config', 'user.email', 'test@example.invalid');
  git(w, 'config', 'user.name', 'Plot Test');
  fs.writeFileSync(path.join(w, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n' +
    '- **Active index:** docs/plans/active/\n' +
    '- **Delivered index:** docs/plans/delivered/\n' +
    '- **Sprint directory:** docs/sprints/\n');
  for (const d of ['docs/plans/active', 'docs/plans/delivered', 'docs/sprints/active']) {
    fs.mkdirSync(path.join(w, d), { recursive: true });
  }
  for (const slug of delivered) fs.writeFileSync(path.join(w, 'docs/plans/delivered', `${slug}.md`), '# ' + slug);
  for (const slug of active) fs.writeFileSync(path.join(w, 'docs/plans/active', `${slug}.md`), '# ' + slug);

  const tier = (name, items) => `### ${name}\n\n` + (items.length ? items.join('\n') + '\n' : '<!-- none -->\n') + '\n';
  const body =
    '# Sprint: Test\n\n> A goal.\n\n## Status\n\n' +
    `- **Phase:** ${phase}\n- **Start:** 2026-08-18\n- **End:** 2026-08-22\n` +
    (release === undefined ? '' : `- **Release:** ${release}\n`) +
    '\n## Sprint Goal\n\nProse.\n\n' +
    tier('Must Have', must) + tier('Should Have', should) + tier('Could Have', could) +
    tier('Deferred', []) +
    '## Retrospective\n\n## Notes\n\nSome note.\n';
  fs.writeFileSync(path.join(w, 'docs/sprints/2026-W34-demo.md'), body);
  if (activeSprint) fs.symlinkSync('../2026-W34-demo.md', path.join(w, 'docs/sprints/active/demo.md'));
  git(w, 'add', '-A');
  git(w, 'commit', '-qm', 'init');
  return w;
}

before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-sr-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// --- The field itself -------------------------------------------------------

test('a sprint with no Release: reports an empty target — behaves exactly as today', () => {
  const w = repo({ must: ['- [ ] [alpha] Do alpha'], active: ['alpha'] });
  const r = run(w);
  assert.equal(r.release, '', 'no Release: line must read as no target');
  assert.equal(r.must.length, 1, 'items are still reported; only the target is absent');
});

test('a declared Release: is reported verbatim, and is never validated', () => {
  // The plan is explicit: 2.5.2 is named before it is cut, so the gate checks
  // Must Haves and never the version string. A typo is the release command's
  // problem, not the sprint's.
  for (const v of ['2.5.2', 'v3.0.0-rc.1', 'not-a-version', '2.5.2 (probably)']) {
    const w = repo({ release: v });
    assert.equal(run(w).release, v, `must pass through ${v} untouched`);
  }
});

test('a template placeholder is not a declared target', () => {
  const w = repo({ release: '<version>' });
  assert.equal(run(w).release, '', 'an unfilled placeholder behaves as absent');
});

test('Release: is read from ## Status, not from prose elsewhere in the file', () => {
  const w = repo({ must: [] });
  const f = path.join(w, 'docs/sprints/2026-W34-demo.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Some note.', '- **Release:** 9.9.9 (mentioned in a note)'));
  assert.equal(run(w).release, '', 'a Release: outside ## Status is prose, not the target');
});

// --- What counts as finished ------------------------------------------------

test('unchecked with the plan still active is open', () => {
  const w = repo({ must: ['- [ ] [alpha] Do alpha'], active: ['alpha'] });
  assert.equal(run(w).must[0].state, 'open');
});

test('checked with the plan delivered is done', () => {
  const w = repo({ must: ['- [x] [alpha] Do alpha'], delivered: ['alpha'] });
  assert.equal(run(w).must[0].state, 'done');
});

test('unchecked with the plan delivered is done — bookkeeping lag, not a dispute', () => {
  // Measured against this repo's first real sprint: all four Must Haves were
  // unchecked with their plans in delivered/, because /plot-deliver moves the
  // plan and nobody re-ticks the box. A gate firing here would fire on every
  // live sprint, which is how --ignore-sprint becomes reflexive.
  const w = repo({ must: ['- [ ] [alpha] Do alpha'], delivered: ['alpha'] });
  assert.equal(run(w).must[0].state, 'done');
});

test('checked with the plan NOT delivered is disputed — the claim the estate denies', () => {
  // /plot-sprint close already calls this a false-positive completion. The
  // release gate must not be the more lenient of the two commands.
  const w = repo({ must: ['- [x] [alpha] Do alpha'], active: ['alpha'] });
  const r = run(w);
  assert.equal(r.must[0].state, 'disputed');
  assert.equal(r.must[0].checked, true);
  assert.equal(r.must[0].delivered, false);
});

test('a lightweight task without a slug is taken at its checkbox, and says so', () => {
  const w = repo({ must: ['- [x] Update the changelog by hand', '- [ ] Ask legal'] });
  const r = run(w);
  assert.equal(r.must[0].state, 'done');
  assert.equal(r.must[1].state, 'open');
  assert.equal(r.must[0].delivered, 'none', 'no slug means no lookup happened — reported, not implied');
  assert.equal(r.must[0].slug, '');
});

// --- The tiers stay distinct ------------------------------------------------

test('all three tiers are reported separately, so the caller can treat them differently', () => {
  const w = repo({
    must:   ['- [ ] [m1] Must one'],
    should: ['- [ ] [s1] Should one'],
    could:  ['- [ ] [c1] Could one'],
    active: ['m1', 's1', 'c1'],
  });
  const r = run(w);
  assert.equal(r.must.length, 1);
  assert.equal(r.should.length, 1);
  assert.equal(r.could.length, 1);
  assert.equal(r.must[0].slug, 'm1');
  assert.equal(r.should[0].slug, 's1');
  assert.equal(r.could[0].slug, 'c1');
});

test('Deferred items belong to no tier — moving an item there clears it from Must', () => {
  // Option 2 of /plot-sprint close moves incomplete must-haves to Deferred.
  // The plan names that as one of the three ways past the gate, so a deferred
  // item must not still count as an open Must Have.
  const w = repo({ must: [], active: ['alpha'] });
  const f = path.join(w, 'docs/sprints/2026-W34-demo.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8')
    .replace('### Deferred\n\n<!-- none -->', '### Deferred\n\n- [ ] [alpha] Do alpha'));
  const r = run(w);
  assert.equal(r.must.length, 0, 'a deferred item is not an open Must Have');
});

// --- Item text --------------------------------------------------------------

test('item text survives markdown, and the automation annotation is stripped', () => {
  const w = repo({
    must: ['- [ ] [alpha] Uses `backticks`, a "quote" and — a dash <!-- pr: #12, status: draft -->'],
    active: ['alpha'],
  });
  const r = run(w);
  assert.equal(r.must[0].text, '[alpha] Uses `backticks`, a "quote" and — a dash');
  assert.ok(!r.must[0].text.includes('<!--'), 'the annotation is machinery, not the item');
});

// --- Resolution -------------------------------------------------------------

test('the single active sprint is found without being named', () => {
  const w = repo({ release: '2.5.2' });
  assert.equal(run(w).release, '2.5.2');
  assert.equal(run(w).sprint, 'demo');
});

test('an explicit slug resolves a sprint that is not active', () => {
  const w = repo({ release: '2.5.2', activeSprint: false, phase: 'Closed' });
  const r = run(w, 'demo');
  assert.equal(r.release, '2.5.2');
  assert.equal(r.phase, 'Closed');
});

test('no active sprint is reported, never guessed', () => {
  const w = repo({ activeSprint: false });
  const r = run(w);
  assert.equal(r.release, '');
  assert.match(r.note, /no active sprint/);
  assert.equal(r.must.length, 0);
});

test('a slug naming no sprint reports that, and exits clean', () => {
  const w = repo({});
  const r = run(w, 'nonexistent');
  assert.match(r.note, /nonexistent/);
});

test('the phase is reported so the caller can tell an Active sprint from a Closed one', () => {
  // Only an ACTIVE sprint gates a release; the script reports the phase and
  // lets /plot-release decide, rather than filtering silently.
  const w = repo({ release: '2.5.2', phase: 'Planning' });
  assert.equal(run(w).phase, 'Planning');
});
