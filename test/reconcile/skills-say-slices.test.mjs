// Contract test for the word the skills teach: `## Slices`, not `## Branches`.
//
// `plot-plan-meta.sh` settles which is accurate, in its own comment: a Slice
// holds one branch and belongs to one plan; a Wave is the fleet cohort that
// spans plans, and the section was always the former. The skills taught the
// legacy word eighteen times against one correct use, so every plan written
// from a skill carried it forward.
//
// WHY PROSE NEEDS A STRUCTURAL GATE, and why this one is shaped as it is:
//
// The obvious implementation — `sed -i 's/## Branches/## Slices/g'` over
// `skills/` — produces the same occurrence total as the correct change and
// breaks it in three ways a count cannot see:
//
//   1. TWO INSTRUCTIONS ARE TOLERANT. `plot-deliver` and `ralph-plot-sprint`
//      describe what their reader ACCEPTS. They must GAIN `## Slices` and KEEP
//      `Branches`: narrowed to strict they stop reading the 600+ plans on this
//      estate that say the legacy word, and every other test still passes.
//   2. ONE LINE MUST KEEP BOTH WORDS. `plot-reslice/README.md` states what the
//      parser accepts — the same `## Branches` / `## Waves` shapes — while
//      three other lines in the SAME FILE are instructions that change. The
//      exemption unit is the SENTENCE, and no per-file rule can express it.
//   3. A BLANKET `grep → 0` GATE WOULD FALSIFY SHIPPED HISTORY.
//      `plot-plan-meta.sh` records "renaming its `## Branches` to `## Slices`
//      took it from 6 branches to 0" — a sentence that must keep the word to
//      stay true — and the same gate would rewrite changelog entries and the
//      fixtures whose whole purpose is proving the parser still reads it.
//
// So every assertion below names a FILE and a SENTENCE. Nothing here counts
// occurrences repo-wide: that number went 632 → 656 between the plan's
// approval and its dispatch, so a gate phrased as a total would already be
// failing for a reason unrelated to the work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');

/** Read one repo-relative file. */
const read = (rel) => {
  const p = path.join(repoRoot, rel);
  assert.ok(existsSync(p), `${rel} is missing`);
  return readFileSync(p, 'utf8');
};

/**
 * The files that must teach `## Slices` and carry no `## Branches` at all.
 *
 * NAMED EXPLICITLY RATHER THAN GLOBBED. A glob over `skills/` would sweep in
 * the two tolerant instructions and the one line that keeps both words, which
 * are the whole difficulty of this change.
 */
const TEACH_SLICES = [
  'skills/plot/SKILL.md',
  'skills/plot-approve/SKILL.md',
  'skills/plot-implement/SKILL.md',
  'skills/plot-pulse/SKILL.md',
  'skills/plot-reconcile/SKILL.md',
  'skills/plot-reslice/SKILL.md',
  'skills/plot/templates/plan.md',
  'skills/plot/intro-to-using-plot.md',
  'skills/tracer-bullets/README.md',
];

for (const rel of TEACH_SLICES) {
  test(`${rel} teaches \`## Slices\` and no longer says \`## Branches\``, () => {
    const text = read(rel);
    assert.ok(text.includes('## Slices'), `${rel} does not teach \`## Slices\``);
    assert.ok(
      !text.includes('## Branches'),
      `${rel} still says \`## Branches\` — every occurrence in this file is an instruction`,
    );
  });
}

test('the SHIPPED template teaches Slices — the highest-value target', () => {
  // Every adopting project receives this file. It said `## Branches` while
  // this repository's own `.plot/templates/plan.md` said `## Slices`: we had
  // fixed ours and shipped theirs.
  const shipped = read('skills/plot/templates/plan.md');
  assert.match(shipped, /^## Slices$/m, 'the shipped template has no `## Slices` heading');

  // The local template is the reference, and it is NOT this branch's to change.
  const local = read('.plot/templates/plan.md');
  assert.match(local, /^## Slices$/m, 'the local template no longer says `## Slices`');
});

test('plot-deliver stays TOLERANT — it gains Slices and keeps Branches', () => {
  // THE TRAP A FIND-AND-REPLACE FALLS INTO. This sentence describes what the
  // reader ACCEPTS, so narrowing it to `Slices` alone silently stops it
  // reading every legacy plan while passing every other test.
  const text = read('skills/plot-deliver/SKILL.md');
  const line = text.split('\n').find((l) => l.includes('Parse it for PR references'));
  assert.ok(line, 'the plan-parsing instruction is gone from plot-deliver');
  assert.ok(line.includes('## Slices'), 'plot-deliver does not accept `## Slices`');
  assert.ok(line.includes('## Branches'), 'plot-deliver NARROWED — it no longer accepts `## Branches`');
});

test('ralph-plot-sprint stays TOLERANT — it gains Slices and keeps Branches', () => {
  const text = read('skills/ralph-plot-sprint/SKILL.md');
  const line = text.split('\n').find((l) => l.includes('Reading plan branches:'));
  assert.ok(line, 'the plan-reading instruction is gone from ralph-plot-sprint');
  assert.ok(line.includes('## Slices'), 'ralph-plot-sprint does not accept `## Slices`');
  assert.ok(
    line.includes('## Branches'),
    'ralph-plot-sprint NARROWED — it no longer accepts `## Branches`',
  );
});

test('plot-reslice README: the instructions change and the tolerance line keeps BOTH', () => {
  // THE SENTENCE IS THE UNIT, NOT THE FILE. Three instruction lines change and
  // one states what the parser accepts; a per-file allow/deny list cannot say
  // that, which is why this test reads the sentences.
  const text = read('skills/plot-reslice/README.md');
  const lines = text.split('\n');

  const tolerance = lines.find((l) => l.includes('already parses'));
  assert.ok(tolerance, 'the parser-tolerance sentence is gone from plot-reslice/README.md');
  assert.ok(
    tolerance.includes('## Branches') && tolerance.includes('## Waves'),
    'the tolerance sentence lost a spelling the parser still accepts',
  );

  for (const marker of ['rewrites **only**', 'The names are already in', 'is the source of truth']) {
    const line = lines.find((l) => l.includes(marker));
    assert.ok(line, `the instruction containing "${marker}" is gone`);
    assert.ok(
      line.includes('## Slices'),
      `the instruction containing "${marker}" still teaches the legacy word`,
    );
  }
});

test('plot-pulse README: the instruction changes, the scan description keeps the word', () => {
  // `:56` tells a reader what a wave IS — an instruction, so it changes. The
  // filtering section describes what the scan reads on the real estate, where
  // "most real plans are pre-wave" and say `## Branches`; converting it would
  // describe a section those files do not have.
  const lines = read('skills/plot-pulse/README.md').split('\n');

  const waveDef = lines.find((l) => l.includes('A wave is a'));
  assert.ok(waveDef, 'the wave definition is gone from plot-pulse/README.md');
  assert.ok(waveDef.includes('## Slices'), 'the wave definition still teaches the legacy word');

  const filtering = lines.find((l) => l.includes('Not every prefixed token'));
  assert.ok(filtering, 'the filtering description is gone');
  assert.ok(
    filtering.includes('## Branches'),
    'the filtering description was converted — it describes existing plans, which say `## Branches`',
  );
});

test('the Slice/Wave distinction is stated ONCE, where a reader meets it', () => {
  // Stating it in all nine skills is what the plan forbids. It belongs in the
  // intro, two lines above where waves are introduced, because that is the
  // first place a reader is asked to tell the two apart. Before this it lived
  // only in a script comment, invisible to the person writing a plan.
  const intro = read('skills/plot/intro-to-using-plot.md');
  assert.ok(
    intro.includes('A slice is not a wave.'),
    'the Slice/Wave distinction is not stated in intro-to-using-plot.md',
  );

  const others = [
    'skills/plot/SKILL.md',
    'skills/plot-approve/SKILL.md',
    'skills/plot-deliver/SKILL.md',
    'skills/plot-implement/SKILL.md',
    'skills/plot-pulse/SKILL.md',
    'skills/plot-reconcile/SKILL.md',
    'skills/plot-reslice/SKILL.md',
    'skills/ralph-plot-sprint/SKILL.md',
  ];
  for (const rel of others) {
    assert.ok(
      !read(rel).includes('A slice is not a wave.'),
      `${rel} repeats the distinction — the plan says state it ONCE`,
    );
  }
});

test('the parser still reads all three spellings, and this change did not touch it', () => {
  // The skills changed what they TEACH, never what the parser ACCEPTS. One
  // branch in `plot-plan-meta.sh` handles all three, and its own comment says
  // the heading word no longer picks the layout.
  const parser = read('skills/plot/scripts/plot-plan-meta.sh');
  for (const spelling of ['## Branches', '## Waves', '## Slices']) {
    assert.ok(
      parser.includes(spelling),
      `the parser no longer mentions ${spelling} — a spelling was dropped`,
    );
  }

  // THE PARSER'S OWN RECORDED MEASUREMENT MUST KEEP THE WORD TO STAY TRUE.
  // This is the sentence a blanket `grep → 0` gate would have falsified.
  assert.ok(
    parser.includes('`## Branches` to `## Slices`'),
    "the parser's recorded measurement was rewritten — it must keep both words to stay true",
  );
});
