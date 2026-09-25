// Contract test for WHERE an approval writes its `Approved:` record.
//
// The shipped plan template (`skills/plot/templates/plan.md`) ends `## Status`
// with a commented-out block that shows the SHAPE of the transition records
// rather than any record:
//
//     <!-- Transition records — written by the workflow commands, not by hand:
//     - **Approved:** <date>, <who>, <channel>
//     - **Started:** <date>, <who>, <branch>   (one line per started branch)
//     -->
//
// Those lines are list items. `append_approved_line` scanned `## Status` for
// the last list item and appended after it, so on any plan written from the
// shipped template the record landed INSIDE the comment.
//
// THE FAILURE IS SILENT IN BOTH DIRECTIONS. The PR merges, the phase flips,
// the summary says `record=written`. But `plot-plan-meta.sh` reads the record
// from the document and not from the comment, so it answers
// `approved_raw: ""` for a plan approved seconds earlier — and the board, the
// release gate and `/plot-deliver` all read it through that parser. Reported
// against Plot 2.20.0 as a plugin install (#981) and reproduced here directly
// against the shipped template, 2026-09-25.
//
// `plot-deliver.sh:330` has shipped the guard since #597 (2026-09-01) with
// `deliver-record-outside-comments.test.mjs`, which this file is modelled on.
// The assertion is the round trip, not the line number: approve, then ask
// `plot-plan-meta.sh` what the plan says. Nothing here re-implements either
// side, so a fix that satisfies this test is a fix a reader of the plan sees.
//
// THE TEMPLATE IS READ FROM DISK, not restated. A copy here would keep passing
// after the shipped template changed shape, which is the one way this test
// could go quiet while the defect came back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(here, '../../skills/plot/scripts');
const approve = path.join(SCRIPTS, 'plot-approve.sh');
const meta = path.join(SCRIPTS, 'plot-plan-meta.sh');
const TEMPLATE = path.resolve(here, '../../skills/plot/templates/plan.md');

let stubDir, statePath, tmp;

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

// The host CLI is PATH-stubbed the way approve.test.mjs stubs it: `plot-host.sh`
// is the one place that talks to `gh`, so one stub intercepts every host call.
// Nothing about the PR is under test here — only where the record lands.
before(() => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-comment-stub-'));
  statePath = path.join(stubDir, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify({ number: 42, state: 'OPEN', draft: false }));
  fs.writeFileSync(path.join(stubDir, 'gh'), `#!/usr/bin/env bash\nexec node ${JSON.stringify(path.join(stubDir, 'gh.mjs'))} "$@"\n`);
  fs.chmodSync(path.join(stubDir, 'gh'), 0o755);
  fs.writeFileSync(path.join(stubDir, 'gh.mjs'), `
import fs from 'node:fs';
const argv = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}, 'utf8'));
if (argv[0] === 'pr' && argv[1] === 'view') {
  process.stdout.write(JSON.stringify({
    number: state.number, state: state.state, isDraft: state.draft,
    url: 'https://example.invalid/pr/' + state.number, mergeCommit: null,
  }));
} else if (argv[0] === 'pr' && argv[1] === 'merge') {
  state.state = 'MERGED';
  fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify(state));
  process.stdout.write('merged');
} else if (argv[0] === 'repo' && argv[1] === 'view') {
  process.stdout.write('main');
} else {
  process.stdout.write('{}');
}
`);
});

after(() => {
  fs.rmSync(stubDir, { recursive: true, force: true });
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * Approve one plan for real and read back what landed on the default branch.
 *
 * NOT `--dry-run`: the dry run says what it WOULD write and never calls
 * `append_approved_line`, so it cannot see this defect at all.
 *
 * The plan is read from `origin/main` for the reason `plot-approve.sh` writes
 * it there: the working copy is not where the record lands.
 */
const approveAndRead = (planBody) => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-comment-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n');
  const rel = 'docs/plans/2026-09-25-approve-me.md';
  fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), planBody);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');

  fs.writeFileSync(statePath, JSON.stringify({ number: 42, state: 'OPEN', draft: false }));
  execFileSync('bash', [approve, '--who', 'Probe', 'approve-me'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, PLOT_HOST: 'github' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  git(repo, 'fetch', '-q', 'origin', 'main');
  const text = git(repo, 'show', `origin/main:${rel}`);
  const readBack = path.join(tmp, 'read-back.md');
  fs.writeFileSync(readBack, text);
  const parsed = JSON.parse(execFileSync('bash', [meta, readBack], { encoding: 'utf8' }));
  return { parsed, text };
};

/**
 * The SHIPPED template, made approvable: the two ceremony answers filled in and
 * a `## Branches` section added. Everything else — crucially the trailing
 * comment block — is the template's own text, read from disk.
 */
const fromShippedTemplate = () => {
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  assert.match(template, /<!-- Transition records/,
    'the shipped template no longer carries the comment block this test is about — '
    + 'if the placeholders moved out of the comment, re-read the plan before deleting this');
  return template
    .replace(/^# <title>$/m, '# Approve me')
    .replace(/^- \*\*Review:\*\* <!--.*-->$/m, '- **Review:** pr')
    .replace(/^- \*\*Impl:\*\* <!--.*-->$/m, '- **Impl:** own branches')
    + '\n## Branches\n\n### Wave one\n- `feature/alpha` — the first\n';
};

test('the Approved record lands where the parser reads it, not in the template comment', () => {
  const { parsed } = approveAndRead(fromShippedTemplate());
  assert.equal(parsed.phase, 'approved', 'the phase should flip');
  assert.notEqual(parsed.approved_raw, '',
    'the plan reports no Approved record — it was written into the template comment, '
    + 'where plot-plan-meta.sh cannot see it and no reader of the plan finds it');
});

test('the record sits before the template comment, so a reader finds it with the others', () => {
  const { text } = approveAndRead(fromShippedTemplate());
  const record = text.indexOf('- **Approved:** 2026');
  const comment = text.indexOf('<!-- Transition records');
  assert.ok(record > 0, 'no Approved line was written at all');
  assert.ok(comment > 0, 'the template comment vanished — this test is asserting nothing');
  assert.ok(record < comment,
    'the Approved line sits after the comment opens, so it is inside it');
});

test('a plan with no comment block is unchanged', () => {
  // The other arm of the same function. The guard must not move the insertion
  // point for the shape that never had the bug.
  const { parsed, text } = approveAndRead(
    '# Approve me\n\n## Status\n\n- **Phase:** Draft\n- **Type:** bug\n'
    + '- **Review:** pr\n- **Impl:** own branches\n\n## Branches\n\n### Wave one\n- `feature/alpha` — the first\n');
  assert.notEqual(parsed.approved_raw, '', 'no record was written at all');
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^\s*[-*]\s*\*\*Approved:\*\*/.test(l));
  assert.equal(lines[at - 1], '- **Impl:** own branches',
    'the record should still append after the last list item in `## Status`');
});

test('an empty placeholder outside a comment is FILLED, not duplicated', () => {
  const { parsed, text } = approveAndRead(
    '# Approve me\n\n## Status\n\n- **Phase:** Draft\n- **Type:** bug\n'
    + '- **Review:** pr\n- **Impl:** own branches\n- **Approved:**\n'
    + '\n## Branches\n\n### Wave one\n- `feature/alpha` — the first\n');
  assert.notEqual(parsed.approved_raw, '', 'the placeholder was not filled');
  const lines = text.split('\n').filter((l) => /^\s*[-*]\s*\*\*Approved:\*\*/.test(l));
  assert.equal(lines.length, 1, 'the placeholder was appended to rather than filled');
});

test('a comment block AFTER the live list items still gets the record in the right place', () => {
  // `break` rather than depth-tracking, which is what plot-deliver.sh:330 does.
  // Depth-tracking would resume scanning past `-->` and place the record after
  // the comment; `break` stops at it and keeps the record above — with the
  // other live fields, where a reader looks.
  const { parsed, text } = approveAndRead(
    '# Approve me\n\n## Status\n\n- **Phase:** Draft\n- **Type:** bug\n'
    + '- **Review:** pr\n- **Impl:** own branches\n'
    + '<!-- Transition records — written by the workflow commands, not by hand:\n'
    + '- **Approved:** <date>, <who>, <channel>\n-->\n'
    + '\n## Branches\n\n### Wave one\n- `feature/alpha` — the first\n');
  assert.notEqual(parsed.approved_raw, '', 'the record is invisible to the parser');
  const record = text.indexOf('- **Approved:** 2026');
  const comment = text.indexOf('<!-- Transition records');
  assert.ok(record < comment, 'the record landed inside or below the comment');
});
