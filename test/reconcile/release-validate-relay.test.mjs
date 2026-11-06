// Contract test: the release validate relay.
//
// The `relay-validate` job of release.yml copies a completed dispatched `CI`
// run's result to a `validate` commit status on the release head. The workflow files are read as text, with
// no YAML parser, and every assertion is scoped to a named block so it fails
// when the thing it looks for sits in a sibling block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) =>
  fs.readFileSync(path.join(here, '..', '..', '.github', 'workflows', name), 'utf8');

const CI = read('ci.yml');
const RELEASE = read('release.yml');

const stripComments = (text) =>
  text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

/** One top-level `jobs:` entry, comments dropped. */
const jobBlock = (yaml, name) => {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `${name}: must be a top-level job`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z_][A-Za-z0-9_-]*:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return stripComments(lines.slice(start, end).join('\n'));
};

/** Everything above `jobs:`, comments dropped. */
const preamble = (yaml) => stripComments(yaml.slice(0, yaml.indexOf('\njobs:')));

/** One trigger under `on:`, comments dropped. */
const triggerBlock = (yaml, name) => {
  const lines = preamble(yaml).split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `on.${name} must be declared`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z_][A-Za-z0-9_-]*:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
};

const JOB = jobBlock(RELEASE, 'relay-validate');
const permissionsOf = (job) => {
  const m = job.match(/^ {4}permissions:\n((?: {6}[a-z-]+: .*\n?)+)/m);
  assert.ok(m, 'the relay job must declare its own permissions');
  return m[1].trim().split('\n').map((l) => l.trim());
};

test('the relay job holds statuses: write and no other write permission', () => {
  const declared = permissionsOf(JOB);
  assert.ok(declared.includes('statuses: write'));
  for (const d of declared) {
    if (d.endsWith(': write')) assert.equal(d, 'statuses: write', `unexpected write: ${d}`);
  }
  assert.doesNotMatch(preamble(RELEASE), /: write/, 'no write permission at workflow level');
});

test('the relay job checks nothing out and installs nothing', () => {
  assert.doesNotMatch(JOB, /actions\/checkout/);
  assert.doesNotMatch(JOB, /\b(pnpm|npm|yarn)\s+(install|i|ci)\b/);
  assert.doesNotMatch(JOB, /pnpm\/action-setup|actions\/setup-node/);
});

test('every uses: in release.yml is pinned to a full SHA', () => {
  const uses = [...stripComments(RELEASE).matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)];
  assert.ok(uses.length > 0);
  for (const m of uses) assert.match(m[1], /@[0-9a-f]{40}$/, `${m[1]} must be SHA-pinned`);
});

test('the relay job needs release and dispatch-ci and is gated on the PR number', () => {
  const head = JOB.split('\n    steps:')[0];
  assert.match(head, /needs: \[release, dispatch-ci\]/);
  assert.match(head, /if: \$\{\{ needs\.release\.outputs\.pr_number \}\}/);
});

test('the relay job has a timeout above the dispatched run and is not named validate', () => {
  const m = JOB.match(/timeout-minutes: (\d+)/);
  assert.ok(m, 'timeout-minutes must be set');
  const ci = Number(jobBlock(CI, 'validate').match(/timeout-minutes: (\d+)/)[1]);
  assert.ok(Number(m[1]) > ci, `${m[1]} must exceed the dispatched validate's ${ci}`);
  assert.doesNotMatch(RELEASE, /^ {2}validate:/m);
});

test('the pin comes from the release job output, never from the remote ref', () => {
  assert.match(JOB, /PINNED_SHA: \$\{\{ needs\.release\.outputs\.head_sha \}\}/);
  assert.doesNotMatch(JOB, /git\/ref\/heads\/changeset-release\/main/);
});

test('the relay writes the validate status with GITHUB_TOKEN and no App path', () => {
  assert.match(JOB, /context=validate/);
  assert.match(JOB, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.doesNotMatch(JOB, /commitStatus/);
  assert.doesNotMatch(JOB, /secrets\.(?!GITHUB_TOKEN)/);
});

test('the relay compares the SHA itself and writes nothing for a cancelled run', () => {
  assert.match(JOB, /"\$RUN_SHA" != "\$PINNED_SHA"/, 'the run head must equal the pin');
  assert.match(JOB, /"\$STATUS" = "completed"/);
  assert.match(JOB, /case "\$CONCLUSION" in\n\s+success\|failure\) ;;/, 'only success and failure are copied');
  assert.match(JOB, /"\$COUNT" -gt 1/, 'two runs fail the job');
  assert.match(JOB, /found 0/, 'zero runs fail the job');
  assert.match(JOB, /github-actions\[bot\]/);
  assert.match(JOB, /\.github\/workflows\/ci\.yml/);
  assert.match(JOB, /head_branch == "changeset-release\/main"/);
  assert.match(JOB, /event=workflow_dispatch/);
  assert.match(JOB, /statuses\/\$PINNED_SHA/, 'the status goes to the pinned SHA only');
  assert.doesNotMatch(JOB, /continue-on-error|\|\| true/);
});

test('the dead workflow_run relay is gone', () => {
  assert.equal(
    fs.existsSync(path.join(here, '..', '..', '.github', 'workflows', 'release-validate-relay.yml')),
    false,
  );
  assert.doesNotMatch(preamble(RELEASE), /workflow_run/);
});

test('ci.yml and release.yml name the relay job and the measured outcome', () => {
  const ci = CI.replace(/\n\s*#\s*/g, ' ');
  assert.doesNotMatch(ci, /release-validate-relay/);
  assert.match(ci, /did not lift `BLOCKED`/);
  assert.match(ci, /`relay-validate` job in `release\.yml`/);
  const rel = RELEASE.replace(/\n\s*#\s*/g, ' ');
  assert.doesNotMatch(rel, /release-validate-relay/);
  assert.match(rel, /DISPATCH ALONE DOES NOT LIFT `BLOCKED`/);
  assert.match(rel, /started no relay run/);
});
