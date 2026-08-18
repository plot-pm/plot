// Contract test for the PLOT_UNATTENDED declarations in the skills.
//
// The behaviour itself is prose an agent interprets, and this suite does not
// mechanize prose (see test/e2e/*.test.mjs). What it CAN pin is the seam that
// keeps the prose honest, and the reason it needs pinning is in the
// measurement recorded in skills/plot/docs/unattended.md:
//
//   Under `claude -p`, AskUserQuestion is not registered at all. The agent
//   notices, writes what it would have asked into its prose, and exits 0.
//
// So the failure this guards is not a hang — it is a silent one. A question
// site that loses its unattended clause does not break any test at runtime; it
// just quietly starts improvising again, and the run still goes green. The
// only durable check is structural: every skill that carries the interaction
// line must point at the shared reference, and every declared shape must carry
// the machine-readable PLOT-UNASKED line that makes the skip visible.
//
// This is also the enforcement half of the open point the plan asked us to
// decide: ONE shared reference file, per-question shapes inline. A shared file
// is only better than fifteen copies if the fifteen actually reference it, and
// a reference nobody checks drifts exactly like a copy would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const skillsDir = path.join(repoRoot, 'skills');

const REFERENCE = path.join(skillsDir, 'plot', 'docs', 'unattended.md');

/** Every skills/<name>/SKILL.md, as [name, text]. */
function skillFiles() {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => [d.name, path.join(skillsDir, d.name, 'SKILL.md')])
    .filter(([, p]) => existsSync(p))
    .map(([name, p]) => [name, readFileSync(p, 'utf8')]);
}

test('the shared reference exists and states the one rule that must not bend', () => {
  assert.ok(existsSync(REFERENCE), 'skills/plot/docs/unattended.md is missing');
  const doc = readFileSync(REFERENCE, 'utf8');

  // The variable is the whole interface.
  assert.match(doc, /PLOT_UNATTENDED=1/, 'reference must name the variable');

  // The rule the plan called non-negotiable: it answers "may I ask?", never
  // "may I proceed?". If this sentence goes, the file has lost its point.
  assert.match(
    doc,
    /never converts a gate into a pass/i,
    'reference must state that PLOT_UNATTENDED never converts a gate into a pass',
  );

  // All three shapes must stay documented — dropping one collapses the design
  // into "take a default", which is the defect, not the fix.
  for (const shape of [/documented default/i, /Refuse and say what was needed/i, /Report and stop cleanly/i]) {
    assert.match(doc, shape, `reference must document the shape: ${shape}`);
  }

  // Inference from a TTY is rejected on purpose; keep the rejection visible so
  // it is not "simplified" back in by someone who reads only the variable.
  assert.match(doc, /-t 0|TTY|terminal/i, 'reference must explain why a TTY is not the signal');
});

test('the reference records the measurement, not the original guess', () => {
  const doc = readFileSync(REFERENCE, 'utf8');

  // The plan assumed a hang. Measurement said otherwise. If a future edit
  // restores "blocks indefinitely" as fact, the file has been rewritten from
  // the guess again — which is the exact error the plan told us to avoid.
  assert.match(doc, /not registered|does not appear/i, 'reference must record that the tool is absent, not blocking');
  assert.match(doc, /exits? 0|exit 0/i, 'reference must record the exit-0 result, which is what makes it silent');
});

test('every skill carrying the interaction line points at the shared reference', () => {
  const carriers = skillFiles().filter(([, text]) => /AskUserQuestion/.test(text));

  // The line propagated by copy across the skill set; that is why the fix
  // propagates by reference. If a new skill is added with the interaction line
  // and no reference, this is where it surfaces.
  assert.ok(carriers.length >= 13, `expected the interaction line in 13+ skills, found ${carriers.length}`);

  const missing = carriers
    .filter(([, text]) => !/PLOT_UNATTENDED/.test(text))
    .map(([name]) => name);

  assert.deepEqual(missing, [], `skills ask the user but never say what to do when nobody is there: ${missing.join(', ')}`);
});

test('each skill that references PLOT_UNATTENDED links the shared file rather than restating it', () => {
  const offenders = [];
  for (const [name, text] of skillFiles()) {
    if (!/PLOT_UNATTENDED/.test(text)) continue;
    if (name === 'plot') {
      // The hub links by its own relative depth.
      if (!/docs\/unattended\.md/.test(text)) offenders.push(name);
    } else if (!/\.\.\/plot\/docs\/unattended\.md/.test(text)) {
      offenders.push(name);
    }
  }
  assert.deepEqual(offenders, [], `skills mention PLOT_UNATTENDED without linking the reference: ${offenders.join(', ')}`);
});

test('every declared unattended shape carries a PLOT-UNASKED line', () => {
  // The disclosure is the load-bearing half. A shape without one is a skill
  // that silently takes a default — indistinguishable in the log from a skill
  // that was never asked anything, which is the defect this repo has removed
  // nine times.
  const offenders = [];
  for (const [name, text] of skillFiles()) {
    // Count the per-question declarations, not the shared banner.
    const declarations = text.match(/\*\*Unattended \(`PLOT_UNATTENDED=1`\)/g) || [];
    if (declarations.length === 0) continue;
    const disclosures = text.match(/PLOT-UNASKED:/g) || [];
    if (disclosures.length < declarations.length) {
      offenders.push(`${name} (${declarations.length} shapes, ${disclosures.length} PLOT-UNASKED lines)`);
    }
  }
  assert.deepEqual(offenders, [], `unattended shapes without a disclosure line: ${offenders.join('; ')}`);
});

test('each PLOT-UNASKED line names a shape the reference defines', () => {
  // Format: PLOT-UNASKED: <question> — <default|refused|stopped> — <outcome>
  // Pinning the vocabulary keeps the lines countable. A free-text third field
  // would be prose again, and prose is what nobody greps.
  const allowed = new Set(['default', 'refused', 'stopped']);
  const bad = [];
  for (const [name, text] of skillFiles()) {
    for (const line of text.split('\n')) {
      const m = line.match(/PLOT-UNASKED:\s*(.+)/);
      if (!m) continue;
      // Split from the RIGHT: the last two fields are fixed (shape, outcome),
      // while the question may legitimately contain an em-dash of its own.
      const fields = m[1].split('—').map((f) => f.trim());
      if (fields.length < 3) {
        bad.push(`${name}: not three em-dash fields → ${line.trim()}`);
        continue;
      }
      const shape = fields[fields.length - 2];
      if (!allowed.has(shape)) {
        bad.push(`${name}: shape "${shape}" is not default|refused|stopped → ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(bad, [], `malformed PLOT-UNASKED lines:\n${bad.join('\n')}`);
});

test('the gates still refuse unattended', () => {
  // The one rule, checked where it is easiest to break. Each of these sites is
  // a phase guardrail; the unattended clause beside it must say "refused" and
  // must not say "default". A clause that let a gate through would be using
  // the variable for the opposite of its purpose.
  const gates = [
    ['plot-deliver', /open PRs.*?refused|refused.*?gate/is],
    ['plot-sprint', /false-positive completions.*?refused|refused.*?gate/is],
    ['plot-idea', /refused — gate/i],
  ];
  for (const [skill, pattern] of gates) {
    const text = readFileSync(path.join(skillsDir, skill, 'SKILL.md'), 'utf8');
    assert.match(text, pattern, `${skill}: a gate's unattended clause must refuse, not default`);
  }
});

test('no skill resolves the question by inferring a terminal', () => {
  // Rejected in the design on purpose: an agent under `claude -p` may have a
  // TTY, and a human behind a pipe may not. If this ever appears, someone has
  // "simplified" the variable away and reintroduced both failure modes.
  const offenders = [];
  for (const [name, text] of skillFiles()) {
    if (/\[\s*-t\s+0\s*\]|isatty|\btty -s\b/.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `skills infer attendance from a terminal: ${offenders.join(', ')}`);
});
