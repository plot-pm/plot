// Contract test: CI runs its checks in tiers, and a job in a later tier waits
// on the tier before it.
//
// `ci.yml` has `select` (tier 0), `gates` (tier 1: the static steps), the
// tier-2 jobs (`checks`, `corpus`, `helper-contracts`, `board-integration`,
// `macos-shell-contract`) and the process census (tier 3). A failed `gates`
// skips every job still waiting only when each of them says
// `needs: [..., gates]` and tests `needs.gates.result == 'success'`; a job
// that drops either runs on after a red static gate.
//
// `tierRefusals` reads a copy of the workflow as text and returns one line per
// defect. The test runs it over the real file (no defect) and over copies
// carrying one defect each (refused).
//
// Part of docs/plans/2026-11-09-quality-gates-fail-fast.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const CI = fs.readFileSync(path.join(here, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');

const TIER_2 = ['checks', 'corpus', 'helper-contracts', 'board-integration', 'macos-shell-contract'];
const TIER_3 = ['process-census'];
const GATES_CAP_MINUTES = 4;

/** The top-level job names of a workflow text, in file order. */
const jobNames = (ci) => {
  const lines = ci.split('\n');
  const from = lines.indexOf('jobs:');
  return lines
    .slice(from + 1)
    .map((l) => /^ {2}([A-Za-z_][A-Za-z0-9_-]*):$/.exec(l))
    .filter(Boolean)
    .map((m) => m[1]);
};

/** The lines of one top-level job, from its `  <name>:` line to the next job. */
const jobLines = (ci, name) => {
  const lines = ci.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1).findIndex((l) => /^ {2}[A-Za-z_][A-Za-z0-9_-]*:/.test(l));
  return lines.slice(start, rest === -1 ? lines.length : start + 1 + rest);
};

/** The job's header lines, those before its `steps:`. */
const headerOf = (lines) => lines.slice(0, lines.indexOf('    steps:'));

/** The job names in the job's `needs:` line, or [] when it has none. */
const needsOf = (header) => {
  const line = header.find((l) => /^ {4}needs:/.test(l));
  if (!line) return [];
  return line
    .replace(/^ {4}needs:/, '')
    .replace(/[[\]]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

/** One line per way `ci` breaks the tier contract. */
export const tierRefusals = (ci) => {
  const out = [];
  const names = jobNames(ci);
  if (!names.includes('gates')) out.push('gates: the tier-1 job is missing');
  for (const name of [...TIER_2, ...TIER_3]) {
    const lines = jobLines(ci, name);
    if (!lines) {
      out.push(`${name}: the job is missing`);
      continue;
    }
    const header = headerOf(lines);
    const needs = needsOf(header);
    if (!needs.includes('gates')) out.push(`${name}: needs: lacks gates`);
    if (!header.some((l) => /^ {4}if:/.test(l) && l.includes("needs.gates.result == 'success'"))) {
      out.push(`${name}: if: does not test needs.gates.result == 'success'`);
    }
    if (TIER_3.includes(name)) {
      if (!needs.includes('checks')) out.push(`${name}: needs: lacks checks`);
      if (!header.some((l) => /^ {4}if:/.test(l) && l.includes("needs.checks.result == 'success'"))) {
        out.push(`${name}: if: does not test needs.checks.result == 'success'`);
      }
    }
  }
  const validate = jobLines(ci, 'validate');
  if (validate && !needsOf(headerOf(validate)).includes('gates')) out.push('validate: needs: lacks gates');
  if (validate && !validate.some((l) => /^\s+require gates "\$GATES" true$/.test(l))) {
    out.push('validate: does not require gates');
  }
  for (const name of names) {
    const lines = jobLines(ci, name);
    const at = lines.findIndex((l) => /^ {4}timeout-minutes: \d+$/.test(l));
    if (at === -1 || at > lines.indexOf('    steps:')) {
      out.push(`${name}: no job-level timeout-minutes`);
      continue;
    }
    if (!lines.slice(Math.max(0, at - 5), at).some((l) => /^ {4}#/.test(l))) {
      out.push(`${name}: the timeout-minutes cap has no comment in the five lines above it`);
    }
  }
  const gates = jobLines(ci, 'gates');
  const cap = gates?.find((l) => /^ {4}timeout-minutes: \d+$/.test(l));
  if (cap && Number(cap.split(':')[1]) > GATES_CAP_MINUTES) {
    out.push(`gates: the cap is above ${GATES_CAP_MINUTES} minutes`);
  }
  return out;
};

/** Replaces the first match of `from` (text or pattern) inside the job named `name`. */
const mutate = (name, from, to) => {
  const block = jobLines(CI, name).join('\n');
  const changed = block.replace(from, to);
  assert.notEqual(changed, block, `${name}: fixture text moved: ${from}`);
  return CI.replace(block, changed);
};

test('ci.yml holds the tier contract', () => {
  assert.deepEqual(tierRefusals(CI), []);
});

for (const name of [...TIER_2, ...TIER_3]) {
  test(`${name}: a copy without gates in needs: is refused`, () => {
    const copy = mutate(name, /\n {4}needs: \[select, gates/, '\n    needs: [select');
    const bad = tierRefusals(copy);
    assert.ok(bad.includes(`${name}: needs: lacks gates`), bad.join('\n'));
  });

  test(`${name}: a copy whose if: ignores the gates result is refused`, () => {
    const copy = mutate(name, "needs.gates.result == 'success'", 'true');
    const bad = tierRefusals(copy);
    assert.ok(bad.some((l) => l.startsWith(`${name}: if: does not test needs.gates.result`)), bad.join('\n'));
  });
}

test('process-census: a copy whose needs: lacks checks is refused', () => {
  const copy = mutate('process-census', 'needs: [select, gates, checks]', 'needs: [select, gates]');
  assert.ok(tierRefusals(copy).includes('process-census: needs: lacks checks'));
});

test('process-census: a copy whose if: ignores the checks result is refused', () => {
  const copy = mutate('process-census', " && needs.checks.result == 'success'", '');
  assert.ok(tierRefusals(copy).includes("process-census: if: does not test needs.checks.result == 'success'"));
});

test('validate: a copy that does not require gates is refused', () => {
  const copy = mutate('validate', 'require gates "$GATES" true', 'true');
  assert.ok(tierRefusals(copy).includes('validate: does not require gates'));
});

test('validate: a copy whose needs: lacks gates is refused', () => {
  const copy = mutate('validate', 'needs: [select, gates, checks,', 'needs: [select, checks,');
  assert.ok(tierRefusals(copy).includes('validate: needs: lacks gates'));
});

test('a job with no job-level timeout-minutes is refused', () => {
  const copy = mutate('corpus', '    timeout-minutes: 15\n', '');
  assert.ok(tierRefusals(copy).includes('corpus: no job-level timeout-minutes'));
});

test('a cap with no comment in the five lines above it is refused', () => {
  const lines = jobLines(CI, 'validate');
  const at = lines.findIndex((l) => /^ {4}timeout-minutes: /.test(l));
  const bare = lines.filter((l, i) => i >= at || i < at - 5 || !/^ {4}#/.test(l)).join('\n');
  assert.notEqual(bare, lines.join('\n'), 'fixture: a comment sits above the cap');
  const copy = CI.replace(lines.join('\n'), bare);
  assert.ok(
    tierRefusals(copy).includes('validate: the timeout-minutes cap has no comment in the five lines above it'),
    tierRefusals(copy).join('\n'),
  );
});

test('a gates cap above four minutes is refused', () => {
  const copy = mutate('gates', 'timeout-minutes: 4', 'timeout-minutes: 12');
  assert.ok(tierRefusals(copy).includes('gates: the cap is above 4 minutes'));
});

test('a copy without the gates job is refused', () => {
  const copy = CI.replace('\n  gates:\n', '\n  gatez:\n');
  assert.ok(tierRefusals(copy).includes('gates: the tier-1 job is missing'));
});

test('gates holds the static steps and no test suite', () => {
  const block = jobLines(CI, 'gates').join('\n');
  for (const step of ['Validate skills parse', 'Plan headings say Slices', 'Domain typecheck', 'Board typecheck', 'Fleet typecheck', 'Changesets name real workspace packages']) {
    assert.ok(block.includes(`- name: ${step}`), `gates must hold ${step}`);
  }
  const checks = jobLines(CI, 'checks').join('\n');
  for (const step of ['Gate tests', 'E2E choreography tests', 'Domain tests + coverage gate', 'Board tests', 'Fleet bundle tests']) {
    assert.ok(checks.includes(`- name: ${step}`), `checks must keep ${step}`);
    assert.ok(!block.includes(`- name: ${step}`), `gates must not hold ${step}`);
  }
});
