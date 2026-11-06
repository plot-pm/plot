// Contract test: the release validate relay.
//
// The relay copies a completed dispatched `CI` run's result to a `validate`
// commit status on the release head. The workflow files are read as text, with
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

const RELAY = read('release-validate-relay.yml');
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

const JOB = jobBlock(RELAY, 'relay');
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
  assert.doesNotMatch(preamble(RELAY), /: write/, 'no write permission at workflow level');
});

test('the relay job checks nothing out and installs nothing', () => {
  assert.doesNotMatch(JOB, /actions\/checkout/);
  assert.doesNotMatch(JOB, /\b(pnpm|npm|yarn)\s+(install|i|ci)\b/);
  assert.doesNotMatch(JOB, /pnpm\/action-setup|actions\/setup-node/);
});

test('every uses: in the relay job is pinned to a full SHA', () => {
  for (const m of JOB.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)) {
    assert.match(m[1], /@[0-9a-f]{40}$/, `${m[1]} must be SHA-pinned`);
  }
});

test('the relay job has a timeout and is not named validate', () => {
  assert.match(JOB, /timeout-minutes: \d+/);
  assert.doesNotMatch(RELAY, /^ {2}validate:/m);
});

test('the relay is triggered by workflow_run of CI and by nothing else', () => {
  const on = preamble(RELAY).slice(preamble(RELAY).indexOf('\non:'));
  const run = triggerBlock(RELAY, 'workflow_run');
  assert.match(run, /workflows: \[CI\]/);
  assert.match(run, /types: \[completed\]/);
  for (const other of ['pull_request', 'pull_request_target', 'push', 'workflow_dispatch']) {
    assert.doesNotMatch(on, new RegExp(`^ {2}${other}:`, 'm'), `${other} must not trigger the relay`);
  }
});

test('the job filters on the dispatched event in its own if:', () => {
  const head = JOB.split('\n    steps:')[0];
  assert.match(head, /if: \$\{\{ github\.event\.workflow_run\.event == 'workflow_dispatch' \}\}/);
});

test('the relay writes the validate status with GITHUB_TOKEN and no App path', () => {
  assert.match(JOB, /context=validate/);
  assert.match(JOB, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.doesNotMatch(RELAY, /commitStatus/);
  assert.doesNotMatch(stripComments(RELAY), /secrets\.(?!GITHUB_TOKEN)/);
});

test('the relay compares the SHA itself and writes nothing for a cancelled run', () => {
  assert.match(JOB, /git\/ref\/heads\/changeset-release\/main/, 'the pin is read from the branch ref');
  assert.match(JOB, /"\$TRIGGER_SHA" != "\$PINNED_SHA"/, 'the triggering run head must equal the pin');
  assert.match(JOB, /"\$TRIGGER_BRANCH" != "changeset-release\/main"/);
  assert.match(JOB, /"\$STATUS" != "completed"/);
  assert.match(JOB, /case "\$CONCLUSION" in\n\s+success\|failure\) ;;/, 'only success and failure are copied');
  assert.match(JOB, /"\$COUNT" -ne 1/, 'zero or two runs fail the job');
  assert.match(JOB, /github-actions\[bot\]/);
  assert.match(JOB, /\.github\/workflows\/ci\.yml/);
  assert.match(JOB, /statuses\/\$PINNED_SHA/, 'the status goes to the pinned SHA only');
});

test('the ci.yml and release.yml comments state the measured outcome', () => {
  assert.doesNotMatch(
    CI.replace(/\n\s*#\s*/g, ' '),
    /is the context the branch protection requires, so the required check reports/,
  );
  assert.match(CI.replace(/\n\s*#\s*/g, ' '), /did not lift `BLOCKED`/);
  const rel = RELEASE.replace(/\n\s*#\s*/g, ' ');
  assert.doesNotMatch(rel, /dispatch makes the required check report/);
  assert.match(rel, /DISPATCH ALONE DOES NOT LIFT `BLOCKED`/);
});
