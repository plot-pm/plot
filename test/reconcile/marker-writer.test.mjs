// A `PLOT-BLOCKED` marker names the branch AND the agent that wrote it.
//
// This is the `A marker names its writer` wave of
// docs/plans/2026-09-12-a-failed-gate-becomes-a-correction.md.
//
// THE DEFECT, MEASURED 2026-08-20 in
// `plot-wt-bug-the-timeout-test-does-not-race-the-clock`: a marker appeared
// reading "Wrong worktree - need reassignment from
// bug/the-timeout-test-does-not-race-the-clock to
// bug/the-timeout-report-drops-what-it-cannot-measure" — written by the OTHER
// branch's worker, into that tree, mid-session. The fleet scan reads the marker
// from the TREE, so the tree's own finished branch read as awaiting a person,
// and the only way to tell was a human recognising a branch name that was not
// theirs.
//
// THE FUNCTION IS EXERCISED DIRECTLY, sourced out of the loop under
// `PLOT_WORKER_LOOP_SOURCED` — `deskreset.test.mjs` and
// `prompt-resolution.test.mjs` state the idiom. Spawning a loop to observe one
// `printf` would spend a multi-second fixture on a pure function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const loop = path.join(repo, 'skills', 'plot', 'scripts', 'plot-worker-loop.sh');

/**
 * The real head this caller writes, expanded — 357 characters, measured
 * 2026-09-12. Kept verbatim rather than shortened: the whole point of the
 * render assertion is that this text is ALREADY longer than QUESTION_MAX, so a
 * short stand-in would test a case the estate does not have.
 */
const HEAD = (branch) =>
  `PLOT-BLOCKED: the worker prompt for \`${branch}\` exited 1 without running, 3 times. `
  + 'Nothing was implemented and the slice is still claimed by this agent. Read '
  + '`.plot-worker.log` for what the runtime said, fix the invocation in the prompt file, '
  + `then restart this agent with \`/plot-dispatch --restart ${branch}\`.`;

/** Write a marker through the loop's own function and hand back the file. */
const writeMarker = ({ branch = 'feature/x', session = 'sess-abc123', existing = null } = {}) => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-marker-'));
  if (existing !== null) fs.writeFileSync(path.join(wt, 'PLOT-BLOCKED.md'), existing);
  const sessionLine = session === null ? 'unset PLOT_SESSION_ID' : `PLOT_SESSION_ID='${session}'`;
  const script = `
    PLOT_WORKER_LOOP_SOURCED=1
    . "${loop}"
    PLOT_BRANCH='${branch}'
    ${sessionLine}
    PLOT_MANIFEST_FILE=''
    write_blocked_marker '${wt}' "$1"
  `;
  try {
    execFileSync('bash', ['-c', script, 'bash', HEAD(branch)], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    // The function returns 0 on every path; a throw here is the assertion's job.
  }
  const file = path.join(wt, 'PLOT-BLOCKED.md');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.rmSync(wt, { recursive: true, force: true });
  return text;
};

/**
 * What the board renders from a marker.
 *
 * A LOCAL COPY OF `firstMarkerLine`'s CONTRACT, and it is deliberate: this file
 * is a shell contract test with no TypeScript in reach, and the property under
 * test is that the question SURVIVES the render. The rule it mirrors lives at
 * `packages/domain/src/adapters/agents/agents-fs.ts:125` and is covered by its
 * own unit tests; what this asserts is that the marker's SHAPE feeds it
 * correctly — first non-empty line, 120 characters.
 */
const QUESTION_MAX = 120;
const renderedFirstLine = (text) => {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l !== '');
  if (line === undefined) return '';
  const bare = line.replace(/^(?:\/\/+|#+|\*+|--|<!--)\s*/, '').trim();
  if (bare === '') return '';
  return bare.length > QUESTION_MAX ? `${bare.slice(0, QUESTION_MAX - 1).trimEnd()}…` : bare;
};

test('a marker names the branch and the session that wrote it', () => {
  const text = writeMarker({ branch: 'feature/x', session: 'sess-abc123' });
  assert.match(text, /feature\/x/, 'the branch is named');
  assert.match(text, /sess-abc123/, 'the session is named');
});

test('the identity sits BELOW the question, where the render cannot eat it', () => {
  // THE DEFECT THIS SLICE IS MOST LIKELY TO SHIP. `firstMarkerLine` takes the
  // first non-empty line and truncates at 120; this head is 357 characters
  // expanded, so an identity PREPENDED to it would push the question out of the
  // render entirely — the field would arrive by destroying the thing it
  // annotates.
  //
  // Asserted against the RENDER rather than the raw text, because the raw text
  // contains both either way and only the render shows which survived.
  const text = writeMarker({ branch: 'feature/x', session: 'sess-abc123' });
  const rendered = renderedFirstLine(text);

  assert.ok(rendered.startsWith('PLOT-BLOCKED:'), `render lost its head: ${rendered}`);
  assert.match(rendered, /exited 1 without running/, 'the question must survive the render');
  assert.ok(!rendered.includes('sess-abc123'), 'the identity must not occupy the question line');
});

test('an agent with no declared session says so, and names none', () => {
  // ABSENT IS NOT FALSE. `session_handle` returns non-zero when there is no
  // handle — the exit code is the answer — so a hand-started loop with no
  // dispatcher reports `undeclared` rather than an agent called nothing.
  // Inventing one would leave the next foreign-marker incident to be debugged
  // against a name nobody minted.
  const text = writeMarker({ branch: 'feature/x', session: null });

  assert.match(text, /undeclared/, 'the absence is stated');
  assert.ok(!/session `\s*`/.test(text), 'no empty session field may be rendered');
  assert.match(text, /feature\/x/, 'the branch is still named');
});

test('an existing marker is never rewritten', () => {
  // A marker already in the tree is an agent's own question to a person, and
  // replacing it with Plot's would answer a question nobody asked. So the new
  // field reaches NEW markers only — that is correct, not a migration gap.
  const mine = 'PLOT-BLOCKED: an agent asked this FIRST.\n';
  const text = writeMarker({ branch: 'feature/x', session: 'sess-zzz', existing: mine });

  assert.equal(text, mine, 'the standing marker must be untouched');
  assert.ok(!text.includes('sess-zzz'), 'no field may be added to a standing marker');
});

test('the marker is a FILE, and a document that merely mentions the token is not one', () => {
  // `agents-fs.ts:145` states the rule and the defect it fixes: a grep for the
  // token matched a brief or a CLAUDE.md that documented it and surfaced the
  // mention as a worker's question. Whatever field syntax the writer uses, it
  // must not tempt a contents-based match — so the writer's line is prose a
  // person reads rather than a key a parser would hunt for.
  const text = writeMarker({ branch: 'feature/x', session: 'sess-abc123' });

  // No `key=value` pair, which is the shape that invites a contents grep.
  assert.ok(!/\bbranch=/.test(text), 'no parseable branch= field');
  assert.ok(!/\bagent=/.test(text), 'no parseable agent= field');
  assert.ok(!/\bsession=/.test(text), 'no parseable session= field');
  assert.match(text, /Written by the agent on/, 'the writer is named in prose');
});
