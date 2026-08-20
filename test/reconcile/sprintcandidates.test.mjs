// Contract test for the goal-driven sprint proposal.
//
// The feature has two halves and this file tests both, because each half is
// worthless without the other:
//
//   1. skills/plot/scripts/plot-sprint-candidates.sh collects the candidates
//      and what each says it does. It ranks NOTHING.
//   2. skills/plot-sprint/SKILL.md ranks them, at Frontier tier, and shows the
//      reason on every row.
//
// Half 2 is prose an agent interprets, and this suite does not mechanize prose
// (see test/e2e/*.test.mjs, and the same reasoning in unattended.test.mjs). What
// it CAN pin is the seam that keeps the prose honest — and here the seam matters
// more than usual, because the failure mode is silent in a specific way: a
// ranking is plausible whether or not it was performed. An operator handed six
// slugs in alphabetical order cannot tell that nothing read the goal. Nothing
// errors, nothing hangs, and the wall of slugs is back with a ranking's
// authority on top of it.
//
// So the prose tests assert the three claims that make the output checkable:
// the measured semantic case is named, every row carries its reason, and the
// fallback announces itself as a fallback.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const scriptsDir = path.join(repoRoot, 'skills', 'plot', 'scripts');
const script = path.join(scriptsDir, 'plot-sprint-candidates.sh');
const SKILL = path.join(repoRoot, 'skills', 'plot-sprint', 'SKILL.md');

let tmp;
function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}
function run(cwd) {
  return JSON.parse(execFileSync('bash', [script], { encoding: 'utf8', cwd }));
}

/**
 * A repo of plans. Each plan is {slug, phase, title, story, changelog, type}.
 * `notAPlan` entries are files in docs/plans/ with no Status block at all — the
 * decision logs and worker reports the real repo carries.
 */
function repo({ plans = [], notAPlan = [] } = {}) {
  const w = fs.mkdtempSync(path.join(tmp, 'r-'));
  git(w, 'init', '-q', '-b', 'main');
  git(w, 'config', 'user.email', 'test@example.invalid');
  git(w, 'config', 'user.name', 'Plot Test');
  fs.writeFileSync(path.join(w, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n' +
    '- **Active index:** docs/plans/active/\n' +
    '- **Delivered index:** docs/plans/delivered/\n');
  fs.mkdirSync(path.join(w, 'docs/plans/active'), { recursive: true });
  fs.mkdirSync(path.join(w, 'docs/plans/delivered'), { recursive: true });

  // The scripts live in the repo under test's own tree, since the skill invokes
  // them by relative path and plot-config.sh is resolved as a sibling.
  fs.mkdirSync(path.join(w, 'skills/plot/scripts'), { recursive: true });
  for (const s of ['plot-sprint-candidates.sh', 'plot-plan-meta.sh', 'plot-config.sh']) {
    fs.copyFileSync(path.join(scriptsDir, s), path.join(w, 'skills/plot/scripts', s));
  }

  for (const p of plans) {
    const cl = p.changelog === undefined ? ['It changes something.'] : p.changelog;
    const body =
      `# ${p.title}\n\n> A one-line summary.\n\n## Status\n\n` +
      `- **Phase:** ${p.phase}\n- **Type:** ${p.type || 'feature'}\n` +
      (p.story ? `- **Story:** ${p.story}\n` : '') +
      '\n## Changelog\n\n' + (cl.length ? cl.map((e) => `- ${e}`).join('\n') + '\n' : '') +
      '\n## Motivation\n\nBecause.\n';
    fs.writeFileSync(path.join(w, 'docs/plans', `${p.file || `2026-08-18-${p.slug}`}.md`), body);
  }
  for (const n of notAPlan) {
    fs.writeFileSync(path.join(w, 'docs/plans', `${n.file}.md`), n.body);
  }
  git(w, 'add', '-A');
  git(w, 'commit', '-qm', 'init');
  return w;
}

const bySlug = (r) => Object.fromEntries(r.plans.map((p) => [p.slug, p]));

before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-sc-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// --- Which plans are candidates ---------------------------------------------

test('the unfinished estate is the candidate set — draft and approved, never delivered or released', () => {
  const w = repo({ plans: [
    { slug: 'a-draft', phase: 'Draft', title: 'A draft plan' },
    { slug: 'an-approved', phase: 'Approved', title: 'An approved plan' },
    { slug: 'a-delivered', phase: 'Delivered', title: 'A delivered plan' },
    { slug: 'a-released', phase: 'Released', title: 'A released plan' },
  ] });
  const got = bySlug(run(w));
  assert.deepEqual(Object.keys(got).sort(), ['a-draft', 'an-approved'],
    'only unfinished plans can be proposed for a sprint');
});

test('candidacy is read from the phase, not from the active/ symlink index', () => {
  // The active/ index drifts — /plot-reconcile exists for exactly that drift.
  // A plan missing from it is still unfinished work, and a sprint that could
  // not propose it would silently omit real candidates.
  const w = repo({ plans: [{ slug: 'unlinked', phase: 'Approved', title: 'Approved but not symlinked' }] });
  assert.equal(fs.readdirSync(path.join(w, 'docs/plans/active')).length, 0,
    'precondition: nothing is in the active index');
  assert.equal(run(w).count, 1, 'the phase is the fact; the index is a view');
});

test('a file with no phase is not a plan and is not proposed', () => {
  // docs/plans/ carries decision logs and blocked-worker reports. One of them
  // says so in its own header: not a plan, no Status block, ignored by
  // plot-plan-meta.sh and the board by design. Proposing one would offer a
  // sprint item that cannot be delivered, with no title to rank on either.
  const w = repo({
    plans: [{ slug: 'real', phase: 'Approved', title: 'A real plan' }],
    notAPlan: [
      { file: 'kanban-open-questions', body: '# Open questions\n\n> Not a plan — it carries no Status block.\n' },
      { file: '2026-08-18-a-report', body: 'PLOT-BLOCKED: is this a gap?\n\n## What I found\n\nThings.\n' },
    ],
  });
  const r = run(w);
  assert.equal(r.count, 1, 'non-plans in docs/plans/ are skipped');
  assert.equal(r.plans[0].slug, 'real');
});

test('an empty plan directory reports zero candidates, not a failure', () => {
  const w = repo({});
  const r = run(w);
  assert.equal(r.count, 0);
  assert.deepEqual(r.plans, []);
});

// --- What each candidate carries --------------------------------------------

test('each candidate carries the signals the ranking reads', () => {
  // Title and story are unconditional. The changelog is signal 3 and arrived in
  // plot-plan-meta.sh on a separate branch, so this asserts the CONTRACT rather
  // than one side of it: the entries are there when the field is available, and
  // the field is an empty list — never a silently partial one — when it is not.
  // Written this way the test holds before and after that branch lands, which
  // is the point: a test that only passes in one of the two worlds tells you
  // nothing about the world you are in.
  const entry = 'A row that cannot say why it is stuck reports a guess.';
  const w = repo({ plans: [{
    slug: 'the-row-says-what-it-knows',
    phase: 'Draft',
    title: 'The row says what it knows',
    story: 'plot-board',
    changelog: [entry],
  }] });
  const r = run(w);
  const p = r.plans[0];
  assert.equal(p.title, 'The row says what it knows', 'title is signal 1');
  assert.equal(p.story, 'plot-board', 'story is signal 2');
  assert.ok(Array.isArray(p.changelog), 'changelog is always an array, present or not');
  assert.deepEqual(p.changelog, r.changelog_available ? [entry] : [],
    'signal 3 matches what changelog_available claims about it');
});

test('the slug is the one a sprint item carries — the filename without its ISO date', () => {
  const w = repo({ plans: [{ slug: 'x', file: '2026-08-18-a-sprint-proposes-its-work', phase: 'Approved', title: 'T' }] });
  assert.equal(run(w).plans[0].slug, 'a-sprint-proposes-its-work',
    'a sprint item reads [slug], not [2026-08-18-slug]');
});

test('a plan with no story is a candidate with an empty story, not an excluded one', () => {
  // Story is a signal, not a filter. 40 of 53 plans carried one when this was
  // measured; the other 13 are still real work.
  const w = repo({ plans: [{ slug: 'storyless', phase: 'Approved', title: 'No story here' }] });
  const p = run(w).plans[0];
  assert.equal(p.story, '');
  assert.equal(run(w).count, 1);
});

test('a plan with no changelog reports an empty list rather than failing', () => {
  const w = repo({ plans: [{ slug: 'bare', phase: 'Approved', title: 'Bare', changelog: [] }] });
  assert.deepEqual(run(w).plans[0].changelog, [], 'absence is an empty list, not an error');
  assert.equal(run(w).count, 1, 'and the plan is still a candidate — title and story remain');
});

// --- The escaping the assembly must survive ---------------------------------

test('a title containing a double quote survives — the defect that chose node over sed', () => {
  // This is not hypothetical. The repo carries the plan titled
  //   A finished commit nobody pushed is not "no commits yet"
  // and a `"title":"[^"]*"` extraction truncates at the escaped quote, emitting
  // invalid JSON for the one caller that most needs to parse it — silently, and
  // only for the plans whose titles are written in this repo's own style.
  const title = 'A finished commit nobody pushed is not "no commits yet"';
  const w = repo({ plans: [{ slug: 'quoted', phase: 'Approved', title }] });
  const r = run(w); // throws on invalid JSON, which is the assertion that matters
  assert.equal(r.plans[0].title, title, 'the quote round-trips intact');
});

test('a changelog entry with backticks, a link and a quote survives the round trip', (t) => {
  const entry = 'Adds `--all` to [the proposal](docs/x.md) so "everything" is still reachable.';
  const w = repo({ plans: [{ slug: 'special', phase: 'Draft', title: 'Special', changelog: [entry] }] });
  const r = run(w);
  if (!r.changelog_available) {
    // plot-plan-meta.sh does not report the field yet — there is no round trip
    // to test. Skipping is honest; asserting [] would pin the absence and start
    // failing the day the field arrives, for a reason unrelated to this branch.
    t.skip('changelog not reported by plot-plan-meta.sh — nothing to round-trip');
    return;
  }
  assert.deepEqual(r.plans[0].changelog, [entry]);
});

test('a backslash in a title does not corrupt the output', () => {
  const title = 'Paths like C:\\plans and a trailing backslash \\';
  const w = repo({ plans: [{ slug: 'slashes', phase: 'Draft', title }] });
  assert.equal(run(w).plans[0].title, title);
});

// --- changelog_available: the signal about the signals ----------------------

test('changelog_available reports whether the third signal can be read at all', () => {
  // The changelog field arrived in plot-plan-meta.sh separately from this
  // feature. A caller that ranked on two signals while believing it read three
  // would be confident about a reading it did not do, which is why this is a
  // reported fact rather than an assumption on either side.
  const w = repo({ plans: [{ slug: 'p', phase: 'Approved', title: 'P', changelog: ['Does a thing.'] }] });
  const r = run(w);
  assert.equal(typeof r.changelog_available, 'boolean', 'it must always be answerable');
  if (r.changelog_available) {
    assert.deepEqual(r.plans[0].changelog, ['Does a thing.'],
      'available means the entries are actually there');
  } else {
    assert.deepEqual(r.plans[0].changelog, [],
      'unavailable means an empty list — never a silently partial one');
  }
});

// --- What the script must NOT do --------------------------------------------

test('the script ranks nothing — no score, no rank, no relevance field anywhere', () => {
  // The whole point. The measured case shares no word with its goal, so any
  // score a shell script could compute ranks it last; a `score` field here
  // would be a wrong answer wearing a helper's clothes. If a future edit adds
  // one, this fails and sends the author back to the plan.
  const w = repo({ plans: [
    { slug: 'a', phase: 'Approved', title: 'The board tells the truth' },
    { slug: 'b', phase: 'Approved', title: 'None printed before the first fetch' },
  ] });
  const r = run(w);
  for (const p of r.plans) {
    for (const forbidden of ['score', 'rank', 'relevance', 'match', 'reason']) {
      assert.ok(!(forbidden in p), `candidate must not carry a ${forbidden} field`);
    }
  }
  assert.ok(!('ranked' in r), 'the envelope must not claim an ordering either');
});

test('the script writes nothing', () => {
  const w = repo({ plans: [{ slug: 'p', phase: 'Approved', title: 'P' }] });
  const before = git(w, 'status', '--porcelain');
  run(w);
  assert.equal(git(w, 'status', '--porcelain'), before, 'read-only: no file may change');
});

test('the script exits 0 with no candidates and no plan directory', () => {
  const w = repo({});
  fs.rmSync(path.join(w, 'docs/plans'), { recursive: true, force: true });
  const out = execFileSync('bash', [script], { encoding: 'utf8', cwd: w });
  assert.equal(JSON.parse(out).count, 0, 'a missing directory reports zero, never a crash');
});

// --- The prose contract -----------------------------------------------------

test('the proposal step names the measured semantic case, goal and plan both', () => {
  // This case IS the specification. It is the reason a model reads the plans
  // rather than grepping them, and a step that loses it loses the argument for
  // its own tier — the next editor sees a ranking and reaches for word overlap.
  const text = fs.readFileSync(SKILL, 'utf8');
  assert.match(text, /the board tells the truth/i, 'the measured goal must be named');
  assert.match(text, /none printed before the first fetch/i, 'the measured plan must be named');
  assert.match(text, /semantic, not lexical|not lexical/i, 'and the reason the pair matters');
  assert.match(text, /shares? not one word|shared words|share no word|no word/i,
    'the pair only argues anything if the zero overlap is stated');
});

test('the proposal step requires a visible reason on every row', () => {
  const text = fs.readFileSync(SKILL, 'utf8');
  assert.match(text, /Every row shows the reason it was proposed/i,
    'a ranking whose rows carry no reason is an oracle the operator cannot correct');
  assert.match(text, /oracle/i, 'and the prose must say why, not just assert the rule');
});

test('the proposal step proposes and never adds', () => {
  const text = fs.readFileSync(SKILL, 'utf8');
  assert.match(text, /Propose only; never add/i, 'the rule');
  assert.match(text, /Nothing is written to\s+the sprint's tiers without an explicit selection/i,
    'stated as the write it forbids, since that is the failure that would matter');
  assert.match(text, /committing on someone's behalf/i,
    'and why: a MoSCoW tier is a commitment, which is the judgement being asked for');
});

test('story is documented as a signal and explicitly not a filter', () => {
  const text = fs.readFileSync(SKILL, 'utf8');
  assert.match(text, /Story is a signal, not a filter/i);
  assert.match(text, /Never exclude a candidate because its story differs/i,
    'the rule must be stated as the exclusion it forbids');
});

test('--all is both documented and parsed', () => {
  const text = fs.readFileSync(SKILL, 'utf8');
  assert.match(text, /`--all` lists everything/i, 'documented at the proposal step');
  assert.match(text, /--all.*strip it from the input|strip it from the input/is,
    'and parsed at step 1 — a flag the output offers but the input never reads is a lie');
  assert.match(text, /Usage: `\/plot-sprint <slug>: <goal> \[--all\]`/,
    'and present in the usage line the operator is shown on a mistake');
});

test('the step calls the candidates helper rather than listing the active index', () => {
  const text = fs.readFileSync(SKILL, 'utf8');
  assert.match(text, /plot-sprint-candidates\.sh/, 'the helper supplies the facts');
  const step = text.slice(text.indexOf('#### 4.'), text.indexOf('#### 5.'));
  assert.ok(!/ls docs\/plans\/active\//.test(step),
    'the old unordered listing of the symlink index must be gone from this step');
});

test('the fallback below Frontier announces itself as a fallback', () => {
  // A smaller model that lists everything grouped by story has not ranked
  // anything. A reader who believes it did will trust an ordering that is
  // alphabetical — so the announcement is the load-bearing half of the
  // fallback, not a courtesy.
  const text = fs.readFileSync(SKILL, 'utf8');
  assert.match(text, /grouped by story/i, 'the fallback behaviour');
  assert.match(text, /says that is what happened|say that is what happened/i,
    'and the requirement to declare it');
  assert.match(text, /announcement is not optional/i, 'stated as non-optional');
  assert.match(text, /trust an ordering that is alphabetical/i,
    'and the failure it prevents, so the next editor does not trim it as flavour');
});

test('the Model Guidance table names the step Frontier, with its fallback', () => {
  const text = fs.readFileSync(SKILL, 'utf8');
  const table = text.slice(text.indexOf('## Model Guidance'), text.indexOf('> **User interaction:**'));
  assert.match(table, /Frontier/, 'the table must carry the tier');
  assert.match(table, /Propose plans from the goal/i, 'named as a step, findable from the step itself');
  assert.match(table, /Fallback below Frontier/i, 'with the documented degradation');
});

test('the blanket "no Frontier needed" sentence is gone', () => {
  // It was true before this branch and false after it. A Model Guidance table
  // that under-states its own requirement sends a small model into a judgement
  // call it will answer confidently and wrongly.
  const text = fs.readFileSync(SKILL, 'utf8');
  assert.ok(!/No Frontier needed/i.test(text),
    'the sentence contradicts the Frontier row and must not coexist with it');
  assert.match(text, /Every other sprint operation is structural/i,
    'replaced by a statement that is true: structural everywhere except this step');
});

test('the unattended path still stops without assigning tiers', () => {
  // :150 documented this before the branch and must keep documenting it: the
  // proposal changes what the operator is shown, never whether a machine may
  // choose the tiers for them.
  const text = fs.readFileSync(SKILL, 'utf8');
  const step = text.slice(text.indexOf('#### 4.'), text.indexOf('#### 5.'));
  assert.match(step, /PLOT_UNATTENDED=1/, 'the unattended clause must survive at this step');
  assert.match(step, /tiers empty/i, 'it creates the sprint empty');
  assert.match(step, /stop before assigning anything/i, 'and stops');
  assert.match(step, /PLOT-UNASKED: Which plans, in which MoSCoW tier\?/,
    'and keeps the machine-readable line that makes the skip visible');
});
