// Contract test for skills/plot/scripts/plot-deliverable-search.sh — the search
// /plot-idea step 3 runs over the estate for a deliverable a plan proposes.
//
// WHY THIS EXISTS, MEASURED. Five plans in one week on this repo proposed
// something the estate already had — `normalizeVersion` (10 callers),
// `check-host-cli-callers.sh`, reconcile scan section 7, `readingLoss`,
// `computeStatusDrift`. Every one was found by a grep and none by an
// interrogation round.
//
// The tests below pin the properties that make the search worth running, each
// against a sandbox estate rather than this repo's: this repo's contents move
// under a test, and a test asserting `normalizeVersion` lives in
// `entities/version.ts` fails the day somebody moves it for a good reason.
//
// THE EXCEPTION IS THE LAST TEST, which runs against the real tree on purpose —
// it asserts the script SURVIVES this estate at a readable size, and that is a
// property of the estate rather than of a fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const search = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-deliverable-search.sh');

const run = (cwd, phrase, env = {}) =>
  spawnSync('bash', [search, phrase], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

/**
 * A throwaway git repo holding the files a case needs.
 *
 * A GIT REPO RATHER THAN A BARE DIRECTORY, because the script reaches the
 * corpora through `git grep` — which is also what gives it `.gitignore` and
 * pathspec exclusions for free. A plain directory would make every search
 * return nothing and every assertion below pass for the wrong reason.
 *
 * @param files map of repo-relative path to contents
 * @returns the repo root, for the caller to remove
 */
function estate(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-deliv-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'], { cwd: dir });
  return dir;
}

test('a deliverable the estate already has reports its file and line', () => {
  // THE PLAIN CASE, and four of the five measured misses are this shape: the
  // name is known and a grep finds it.
  const dir = estate({
    'packages/domain/src/entities/version.ts':
      'export const normalizeVersion = (v: string): string => v.trim();\n',
    'skills/plot/scripts/keep.sh': '#!/usr/bin/env bash\ntrue\n',
    'scripts/keep.sh': '#!/usr/bin/env bash\ntrue\n',
  });

  const got = run(dir, 'normalizeVersion, a shared version helper');
  assert.equal(got.status, 0, `the search never refuses:\n${got.stderr}`);
  assert.match(got.stdout, /normalizeVersion/,
    `it must name the deliverable it found:\n${got.stdout}`);
  assert.match(got.stdout, /entities\/version\.ts:1/,
    `and give the file and the LINE, so the author can look:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('a deliverable the estate does not have gets silence', () => {
  // THE DONE-WHEN, verbatim: "a plan declaring a new one gets silence".
  //
  // It is worth a test of its own because silence is easy to lose. The phrase
  // expands into `a` and `new`, which name most of any estate, so a footer
  // listing skipped terms unconditionally would turn this into ten lines about
  // `a` — and a check that prints when it found nothing is one an author stops
  // reading.
  const dir = estate({
    'packages/domain/src/entities/version.ts':
      'export const normalizeVersion = (v: string): string => v.trim();\n',
    // THE FIXTURE MUST NOT CONTAIN THE PHRASE'S OWN FILLER WORDS. A first draft
    // of this file wrote `# a new helper` into it and the test failed
    // correctly: `a` and `new` were in the estate, so reporting them was right
    // and the silence being asserted was never available.
    'scripts/keep.sh': '#!/usr/bin/env bash\ntrue\n',
  });

  const got = run(dir, 'quokkaTelemetryBridge, a new telemetry sink');
  assert.equal(got.status, 0, `the search never refuses:\n${got.stderr}`);
  assert.equal(got.stdout, '',
    `an unbuilt deliverable must produce NOTHING at all:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('the corpora are searched separately, which is what finds the hard case', () => {
  // THE ONE THAT BEAT A CAREFUL SEARCHER. `check-host-cli-callers.sh` was
  // missed by a search for `check-*gh*`: the plan said `gh`, the estate says
  // *host CLI*.
  //
  // The fixture reproduces the shape rather than the file — `gh` is mentioned
  // all over the helper scripts, in comments about the host adapter, and
  // exactly once in `scripts/`. Merging the corpora into one search buries the
  // rare hit under the common one; this asserts the split keeps `scripts/`
  // audible.
  const noisy = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [
      `skills/plot/scripts/noise${i}.sh`,
      `#!/usr/bin/env bash\n# routed through gh, see the adapter\ntrue\n`,
    ]),
  );

  const dir = estate({
    ...noisy,
    'scripts/check-host-cli-callers.sh':
      '#!/usr/bin/env bash\n# a script outside plot-host.sh that invokes gh has reached past it\ntrue\n',
  });

  const got = run(dir, 'a grep gate for gh callers');
  assert.equal(got.status, 0);
  assert.match(got.stdout, /^scripts :: gh —/m,
    `scripts/ holds ONE gh file and must be reported:\n${got.stdout}`);
  assert.match(got.stdout, /check-host-cli-callers\.sh/,
    `and the file the author missed must be named:\n${got.stdout}`);
  assert.match(got.stdout, /skills\/plot\/scripts :: gh \(10 files\)/,
    `while the noisy corpus is skipped and SAID to be skipped:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('a compound name is expanded to its bare nouns', () => {
  // THE FIFTH MISS, and the one a literal search cannot find today:
  // `computeStatusDrift` was proposed, and the estate's copy has since been
  // refactored so the exact name matches nothing while `Drift` still names it.
  //
  // "A rule name also searches its bare noun" — the brief's phrase, tested.
  const dir = estate({
    'packages/board/src/server/story.ts':
      'export const storyDrift = (s: Story): string | null => null;\n',
  });

  const got = run(dir, 'computeStatusDrift');
  assert.equal(got.status, 0);
  assert.match(got.stdout, /storyDrift/,
    `the bare noun Drift must reach a name the literal search misses:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('no term is dropped for being short — gh is two characters', () => {
  // A REGRESSION GUARD ON A CORRECTION. A `length >= 3` filter was written into
  // the expansion first, to keep `a`, `of` and `is` out of the report, and it
  // silently deleted `gh` — the two characters that ARE the hard case above.
  //
  // The noise floor refuses a term by MEASUREMENT rather than by a proxy for
  // one, and this pins that the proxy stays gone.
  const dir = estate({
    'scripts/host-gate.sh': '#!/usr/bin/env bash\n# invokes gh directly\ntrue\n',
  });

  const got = run(dir, 'gh');
  assert.equal(got.status, 0);
  assert.match(got.stdout, /host-gate\.sh/,
    `a two-character deliverable name must still be searched:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('the reconcile scan is searched by its section HEADINGS, not its body', () => {
  // THE FOURTH CORPUS, and the third measured miss: a plan proposed a
  // multi-branch-slice finding that was already scan section 7.
  //
  // A plan proposing a reconcile finding proposes a SECTION. The scan's other
  // 2,000 lines are its implementation and match every word in the language, so
  // this corpus is the `echo "== N. ... =="` lines alone.
  const dir = estate({
    'skills/plot/scripts/plot-reconcile-scan.sh': [
      '#!/usr/bin/env bash',
      '# uncut is a word this body uses many times over, in prose, deliberately',
      'echo "== 7. Uncut slices (a slice holds one branch) =="',
      'echo "== 8. Prose slice names =="',
      'echo "== 9. Unplanned sprint members =="',
      'echo "== 10. Sprint field unset =="',
      'echo "== 11. Sprint mismatch =="',
      'echo "== 12. Index drift =="',
      'echo "== 13. Stale sprint tally =="',
      'echo "== 14. Double-claimed branches =="',
      'echo "== 15. Stale interrogation rounds =="',
      'echo "== 16. Sprint phase vs index =="',
      '',
    ].join('\n'),
  });

  const got = run(dir, 'an uncut-slices finding');
  assert.equal(got.status, 0);
  assert.match(got.stdout, /^reconcile scan sections :: /m,
    `the heading corpus must report under its own name:\n${got.stdout}`);
  assert.match(got.stdout, /== 7\. Uncut slices/,
    `and name the section the plan would have duplicated:\n${got.stdout}`);

  // THE CASE DIFFERS ON PURPOSE — the author writes `uncut`, the estate says
  // `Uncut`. Case is one more spelling of the vocabulary gap the expansion
  // exists to cross, so the search matches without regard to it.
  const headings = got.stdout
    .split('\n')
    .filter((l) => l.startsWith('reconcile scan sections ::'));
  assert.ok(headings.length > 0, `at least one heading term must report:\n${got.stdout}`);

  // And the heading corpus reports HEADINGS ONLY. The planted body line uses
  // the same word and must never appear under this corpus's name.
  const scanSection = got.stdout.slice(got.stdout.indexOf('reconcile scan sections'));
  assert.doesNotMatch(scanSection, /uses many times over/,
    `a body line is not a section heading:\n${scanSection}`);

  rmSync(dir, { recursive: true, force: true });
});

test('it reports and never refuses, whatever it finds', () => {
  // A plan may legitimately propose REPLACING something that exists — two of
  // the five measured plans were doing exactly that. So the exit code carries
  // no verdict, and a caller reading it learns only that the search ran.
  const dir = estate({
    'packages/domain/src/entities/version.ts':
      'export const normalizeVersion = (v: string): string => v.trim();\n',
  });

  const hit = run(dir, 'normalizeVersion');
  const miss = run(dir, 'quokkaTelemetryBridge');
  assert.equal(hit.status, 0, 'a match is not a refusal');
  assert.equal(miss.status, 0, 'and neither is silence');
  assert.notEqual(hit.stdout, '', 'the match is reported');
  assert.equal(miss.stdout, '', 'and the miss is not');

  rmSync(dir, { recursive: true, force: true });
});

test('a generated bundle is excluded, read from .gitattributes', () => {
  // MEASURED BEFORE THE EXCLUSION EXISTED: one matched line in
  // `plot-delta.mjs` was 230,598 characters and the whole report was 339 KB.
  //
  // A bundle is BUILT from a corpus this search already reads, so a hit in one
  // is the same code found twice — once where an author could have written it,
  // once where nobody can. The list is read from `.gitattributes` rather than
  // hardcoded, because a gate already derives that file from the build's real
  // output.
  const dir = estate({
    '.gitattributes': 'skills/plot/scripts/board/bundle.mjs -merge\n',
    'packages/board/src/thing.ts': 'export const quokkaBridge = () => 1;\n',
    'skills/plot/scripts/board/bundle.mjs':
      `var a=1;/* quokkaBridge */${'x'.repeat(5000)}\n`,
  });

  const got = run(dir, 'quokkaBridge');
  assert.equal(got.status, 0);
  assert.match(got.stdout, /thing\.ts/, `the source must be reported:\n${got.stdout}`);
  assert.doesNotMatch(got.stdout, /bundle\.mjs/,
    `the bundle built from it must not be:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('it never reports its own header as a finding', () => {
  // ITS HEADER NAMES ALL FIVE MEASURED DUPLICATIONS, because that is the
  // evidence the design rests on — and it lives in `skills/plot/scripts`, one
  // of the corpora it searches. Without the self-exclusion, every future plan
  // proposing any of those five is told the estate already has it, citing this
  // script's own comment as the finding: a check firing on its own prose, which
  // is exactly the failure the four-corpus scoping exists to prevent.
  //
  // This runs on the real tree because the header is the real file's.
  for (const name of ['computeStatusDrift', 'readingLoss', 'normalizeVersion']) {
    const got = run(repoRoot, name);
    assert.equal(got.status, 0);
    assert.doesNotMatch(got.stdout, /plot-deliverable-search\.sh/,
      `searching for ${name} must not report this script:\n${got.stdout}`);
  }
});

test('it survives this estate at a size a person reads', () => {
  // THE ONE TEST THAT RUNS ON THE REAL TREE, and the property is about the tree
  // rather than a fixture: the check must stay readable against a repository
  // this size, or an author learns to skip its output — which is the failure
  // mode the whole design is arranged against.
  //
  // The phrase is the noisiest of the five measured cases: every word in it
  // names a large part of this estate.
  const got = run(repoRoot, 'normalizeVersion, a shared version helper');
  assert.equal(got.status, 0, `the search never refuses:\n${got.stderr}`);
  assert.ok(got.stdout.length < 20_000,
    `a report this long is one nobody reads (${got.stdout.length} bytes)`);
  assert.match(got.stdout, /normalizeVersion/,
    `and it must still find the deliverable:\n${got.stdout.slice(0, 2000)}`);
});
