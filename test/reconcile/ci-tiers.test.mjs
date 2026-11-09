// Contract test: CI runs its checks in tiers, and a job in a later tier waits
// on the tier before it.
//
// `ci.yml` has `select` (tier 0), `gates` (tier 1: the static steps), the
// tier-2 jobs (`checks`, `corpus`, `helper-contracts`, `board-integration`,
// `macos-shell-contract`) and the process census (tier 3: `census-head` and
// `census-base` in parallel, `census-compare` after both). A failed `gates`
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
const TIER_3 = ['census-head', 'census-base', 'census-compare'];
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

/** The `census-gate.mjs` invocations of a job, each as one logical line (a `\\` continues it). */
const censusCalls = (lines) => {
  const calls = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#/.test(lines[i]) || !lines[i].includes('census-gate.mjs')) continue;
    let call = lines[i];
    while (call.trimEnd().endsWith('\\') && i + 1 < lines.length) call = `${call.trimEnd().slice(0, -1)} ${lines[++i].trim()}`;
    calls.push(call);
  }
  return calls;
};

const BASE_GATES = ['check-shell-lines.sh pr', 'check-decision-count.sh pr', 'check-sprint-members.sh'];

// The bundle gate reads `origin/main` on every pull request: a branch carries
// `main`'s build, and the commit hook compares with the same base.
const BUNDLE_GATE = 'check-no-bundle-diff.sh';

/** One line per merge-base gate call in `ci` that names `origin/main`, or lacks the pull request's base. */
const gateBaseRefusals = (ci) => {
  const out = [];
  const calls = ci.split('\n').filter((l) => !/^\s*#/.test(l) && l.includes('./scripts/check-'));
  for (const gate of BASE_GATES) {
    const mine = calls.filter((l) => l.includes(`./scripts/${gate}`));
    if (mine.length === 0) out.push(`${gate}: no call in ci.yml`);
    if (mine.some((l) => l.includes('origin/main'))) out.push(`${gate}: a call passes origin/main instead of the pull request's base`);
    if (!mine.some((l) => l.includes('origin/$GITHUB_BASE_REF'))) out.push(`${gate}: no call passes origin/$GITHUB_BASE_REF`);
  }
  const bundle = calls.filter((l) => l.includes(`./scripts/${BUNDLE_GATE}`));
  if (bundle.length === 0) out.push(`${BUNDLE_GATE}: no call in ci.yml`);
  if (bundle.some((l) => l.includes('$GITHUB_BASE_REF'))) out.push(`${BUNDLE_GATE}: a call passes the pull request's base instead of origin/main`);
  return out;
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
  const halves = new Set();
  for (const name of TIER_3) {
    const lines = jobLines(ci, name);
    if (!lines) continue;
    for (const call of censusCalls(lines)) {
      const only = /--only (head|before)\b/.exec(call)?.[1];
      if (only) halves.add(`${name}:${only}`);
      if (!only && !/--compare\b/.test(call)) {
        out.push(`${name}: runs both census halves in one step (census-gate.mjs without --only or --compare)`);
      }
    }
    const jobHalves = [...halves].filter((h) => h.startsWith(`${name}:`));
    if (jobHalves.length > 1) out.push(`${name}: runs both census halves in one job`);
  }
  const compare = jobLines(ci, 'census-compare');
  if (compare) {
    const header = headerOf(compare);
    for (const dep of ['census-head', 'census-base']) {
      if (!needsOf(header).includes(dep)) out.push(`census-compare: needs: lacks ${dep}`);
    }
    if (!header.some((l) => /^ {4}if:/.test(l) && l.includes("needs.census-head.result == 'success'"))) {
      out.push("census-compare: if: does not test needs.census-head.result == 'success'");
    }
  }
  for (const [name, half] of [['census-head', 'head'], ['census-base', 'before']]) {
    const lines = jobLines(ci, name);
    if (lines && !censusCalls(lines).some((c) => c.includes(`--only ${half}`))) out.push(`${name}: does not run --only ${half}`);
  }
  for (const line of ci.split('\n')) {
    const m = /uses:\s*actions\/(upload|download)-artifact@(\S+)/.exec(line);
    if (m && !/^[0-9a-f]{40}$/.test(m[2])) out.push(`actions/${m[1]}-artifact is not pinned by a full commit SHA: ${m[2]}`);
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
  out.push(...gateBaseRefusals(ci));
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

for (const [gate, from] of [
  ['check-shell-lines.sh pr', './scripts/check-shell-lines.sh pr "origin/$GITHUB_BASE_REF"'],
  ['check-decision-count.sh pr', './scripts/check-decision-count.sh pr "origin/$GITHUB_BASE_REF"'],
  ['check-sprint-members.sh', './scripts/check-sprint-members.sh "origin/$GITHUB_BASE_REF"'],
]) {
  test(`${gate}: a copy that passes origin/main is refused`, () => {
    const copy = CI.replace(from, from.replace('origin/$GITHUB_BASE_REF', 'origin/main'));
    assert.notEqual(copy, CI, `fixture text moved: ${from}`);
    const bad = tierRefusals(copy);
    assert.ok(bad.some((l) => l.startsWith(`${gate}: a call passes origin/main`)), bad.join('\n'));
  });
}

test('check-no-bundle-diff.sh: a copy that passes origin/$GITHUB_BASE_REF is refused', () => {
  const from = './scripts/check-no-bundle-diff.sh\n';
  const copy = CI.replace(from, './scripts/check-no-bundle-diff.sh . HEAD "origin/$GITHUB_BASE_REF"\n');
  assert.notEqual(copy, CI, `fixture text moved: ${from}`);
  const bad = tierRefusals(copy);
  assert.ok(bad.some((l) => l.startsWith('check-no-bundle-diff.sh: a call passes the pull request\'s base')), bad.join('\n'));
});

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

for (const name of TIER_3) {
  test(`${name}: a copy whose needs: lacks checks is refused`, () => {
    const copy = mutate(name, /\n {4}needs: \[select, gates, checks/, '\n    needs: [select, gates');
    assert.ok(tierRefusals(copy).includes(`${name}: needs: lacks checks`));
  });

  test(`${name}: a copy whose if: ignores the checks result is refused`, () => {
    const copy = mutate(name, " && needs.checks.result == 'success'", '');
    assert.ok(tierRefusals(copy).includes(`${name}: if: does not test needs.checks.result == 'success'`));
  });
}

// ── the two-tree census ─────────────────────────────────────────────────────

test('census-head: a step that runs both halves in one process is refused', () => {
  const copy = mutate('census-head', '--only head --report "$RUNNER_TEMP/census-head.jsonl"', '--base origin/main');
  const bad = tierRefusals(copy);
  assert.ok(bad.some((l) => l.startsWith('census-head: runs both census halves in one step')), bad.join('\n'));
  assert.ok(bad.includes('census-head: does not run --only head'), bad.join('\n'));
});

test('census-base: a step that runs both halves in one process is refused', () => {
  const copy = mutate('census-base', /--only before --base/, '--base');
  assert.ok(tierRefusals(copy).some((l) => l.startsWith('census-base: runs both census halves in one step')));
});

test('a job that runs the merge-base half beside the HEAD half is refused', () => {
  const copy = mutate('census-head', 'node packages/fleet/test/census/census-gate.mjs --only head --report "$RUNNER_TEMP/census-head.jsonl"',
    'node packages/fleet/test/census/census-gate.mjs --only head --report "$RUNNER_TEMP/census-head.jsonl"\n          node packages/fleet/test/census/census-gate.mjs --only before --base origin/main --report "$RUNNER_TEMP/census-before.jsonl"');
  assert.ok(tierRefusals(copy).includes('census-head: runs both census halves in one job'), tierRefusals(copy).join('\n'));
});

test('one census job running the whole census (the former process-census) is refused', () => {
  const copy = mutate('census-compare', 'census-gate.mjs --compare', 'census-gate.mjs --base origin/main #');
  assert.ok(tierRefusals(copy).some((l) => l.startsWith('census-compare: runs both census halves in one step')));
});

test('census-compare: a copy that does not wait on both halves is refused', () => {
  const copy = mutate('census-compare', 'census-head, census-base]', 'census-head]');
  assert.ok(tierRefusals(copy).includes('census-compare: needs: lacks census-base'));
});

test('census-compare: a copy whose if: ignores the HEAD half is refused', () => {
  const copy = mutate('census-compare', " && needs.census-head.result == 'success'", '');
  assert.ok(tierRefusals(copy).includes("census-compare: if: does not test needs.census-head.result == 'success'"));
});

test('an artifact action pinned by tag instead of SHA is refused', () => {
  const copy = CI.replace(/actions\/upload-artifact@[0-9a-f]{40} # v7\.0\.1/, 'actions/upload-artifact@v7');
  assert.notEqual(copy, CI);
  assert.ok(tierRefusals(copy).includes('actions/upload-artifact is not pinned by a full commit SHA: v7'));
});

test('the census halves upload and the compare job downloads, each pinned by SHA', () => {
  assert.match(jobLines(CI, 'census-head').join('\n'), /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(jobLines(CI, 'census-base').join('\n'), /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(jobLines(CI, 'census-compare').join('\n'), /actions\/download-artifact@[0-9a-f]{40}/);
});

test('the census jobs stay outside validate needs', () => {
  const needs = needsOf(headerOf(jobLines(CI, 'validate')));
  for (const name of TIER_3) assert.ok(!needs.includes(name), `${name} must not be in validate's needs:`);
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
