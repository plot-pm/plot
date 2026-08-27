// Contract test for the plan-parse batching in
// skills/plot/scripts/plot-fleet-scan.sh.
//
// THE SUBJECT IS A SPAWN COUNT, NOT A DURATION. The scan parsed its plan
// estate once per plan, twice over: `plot-plan-meta.sh` per plan, then a fresh
// `python3` per plan to re-parse that helper's own output. Measured on this
// repo 2026-08-27 on main: 319 `plot-plan-meta.sh` and 463 `python3` spawns for
// 154 plans, at 86.8 % CPU under `--offline` — the scan was computing, not
// waiting, and more than half its CPU budget was interpreter startup.
//
// A timing assertion would be flaky on a loaded machine. The COUNT is the fact
// that produces the timing, and it is the one nobody had: the cost is invisible
// because 463 invocations each look instant and none of them errors.
//
// Both halves or neither (plan `Done when` items 2 and 3). Batching the
// `plot-plan-meta.sh` call while leaving an interpreter per plan running would
// satisfy item 2 and save roughly 3 s of 30.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-fleet-scan.sh');

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

// A repo carrying `n` plans, each with one wave and one unclaimed branch, so
// the scan has real per-plan work to do. The spawn count is meant to be
// CONSTANT in `n`; the tests below run two sizes and compare, because an
// absolute number would encode today's estate rather than the property.
function makeRepo(prefix, n, { planBody } = {}) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const bare = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', bare);
  git(t, 'clone', '-q', bare, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  for (let i = 0; i < n; i++) {
    const slug = `p${String(i).padStart(3, '0')}`;
    const body = planBody
      ? planBody(i, slug)
      : `# Plan ${slug}\n\n## Status\n\n- **Phase:** Approved\n\n`
        + `## Branches\n\n### One\n- \`feature/${slug}\` — the work\n`;
    fs.writeFileSync(path.join(r, 'plans', `2026-01-01-${slug}.md`), body);
  }
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plans');
  git(r, 'push', '-q', 'origin', 'main');
  return {
    dir: r,
    cleanup() { fs.rmSync(t, { recursive: true, force: true }); },
  };
}

// A scripts directory whose `plot-plan-meta.sh` APPENDS A LINE PER INVOCATION
// and then delegates to the real parser. The same trick the host-call tests
// use: a stub that merely failed would be indistinguishable from an outage, so
// the CALL ITSELF is what the assertion watches, and the real answer still
// flows through — the scan's output must stay correct while being counted.
function countingShim() {
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-batch-shim-'));
  const realScripts = path.dirname(scan);
  fs.mkdirSync(path.join(shim, 'scripts'));
  for (const f of fs.readdirSync(realScripts)) {
    if (f.endsWith('.sh')) {
      fs.copyFileSync(path.join(realScripts, f), path.join(shim, 'scripts', f));
      fs.chmodSync(path.join(shim, 'scripts', f), 0o755);
    }
  }
  fs.renameSync(path.join(shim, 'scripts', 'plot-plan-meta.sh'),
    path.join(shim, 'scripts', 'plot-plan-meta-real.sh'));
  // Records how many FILES one invocation covered — the argument count minus
  // the `--prefixes <re>` pair — which is what distinguishes a batch call from
  // a per-plan one. Counting raw `$#` would report 3 for a single-file call and
  // read as a batch.
  fs.writeFileSync(path.join(shim, 'scripts', 'plot-plan-meta.sh'),
    '#!/usr/bin/env bash\n'
    + 'n=0\n'
    + 'for a in "$@"; do\n'
    + '  case "$a" in --prefixes) skip=1 ;;\n'
    + '    --*) ;;\n'
    + '    *) if [ "${skip:-0}" = 1 ]; then skip=0; else n=$((n + 1)); fi ;;\n'
    + '  esac\n'
    + 'done\n'
    + 'printf "%s\\n" "$n" >> "$PLOT_TEST_META_CALLS"\n'
    + 'exec "$(dirname "$0")/plot-plan-meta-real.sh" "$@"\n');
  fs.chmodSync(path.join(shim, 'scripts', 'plot-plan-meta.sh'), 0o755);
  return {
    scan: path.join(shim, 'scripts', 'plot-fleet-scan.sh'),
    dir: shim,
    cleanup() { fs.rmSync(shim, { recursive: true, force: true }); },
  };
}

// Spawns are counted by tracing the scan with `bash -x` and counting the lines
// that name the command. This sees EVERY invocation, including ones inside
// command substitutions and pipelines, which a PATH shim for a builtin-adjacent
// interpreter cannot reliably intercept.
function traceCounts(cwd, scanPath, args = []) {
  const trace = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-batch-trace-'));
  const file = path.join(trace, 'x.log');
  const fd = fs.openSync(file, 'w');
  try {
    execFileSync('bash', ['-x', scanPath, '--offline', ...args],
      { cwd, stdio: ['ignore', 'ignore', fd] });
  } catch {
    // A non-zero exit (e.g. --next with nothing to start) still leaves a
    // usable trace; the counts are the subject, not the status.
  } finally {
    fs.closeSync(fd);
  }
  const text = fs.readFileSync(file, 'utf8');
  const count = (re) => text.split('\n').filter((l) => re.test(l)).length;
  fs.rmSync(trace, { recursive: true, force: true });
  return {
    meta: count(/plot-plan-meta\.sh/),
    python: count(/\bpython3\b/),
  };
}

test('fleet: plot-plan-meta.sh is spawned once per scan, not once per plan', () => {
  // `Done when` item 2. The count, not the duration: 319 → 1 on this repo.
  const f = makeRepo('plot-batch-meta-', 12);
  const s = countingShim();
  const calls = path.join(s.dir, 'meta-calls.txt');
  execFileSync('bash', [s.scan, '--offline'], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PLOT_TEST_META_CALLS: calls },
  });
  const invocations = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean);
  assert.equal(invocations.length, 1,
    `plot-plan-meta.sh must be spawned once for the whole estate, saw ${
      invocations.length} invocations covering [${invocations.join(', ')}] files`);
  assert.equal(Number(invocations[0]), 12,
    'the single invocation must cover every plan — one call for one plan is not a batch');
  s.cleanup();
  f.cleanup();
});

test('fleet: neither meta nor python spawns scale with plan count', () => {
  // `Done when` items 2 and 3 together — "both halves or neither". Two estates
  // that differ by 16 plans must spawn the SAME number of processes. An
  // absolute threshold would encode today's implementation; the invariant is
  // that the count does not track the estate.
  const small = makeRepo('plot-batch-small-', 4);
  const large = makeRepo('plot-batch-large-', 20);
  const a = traceCounts(small.dir, scan);
  const b = traceCounts(large.dir, scan);

  assert.equal(b.meta, a.meta,
    `plot-plan-meta.sh spawns must not scale with plan count: `
    + `4 plans → ${a.meta}, 20 plans → ${b.meta}`);
  assert.equal(b.python, a.python,
    `python3 spawns must not scale with plan count: `
    + `4 plans → ${a.python}, 20 plans → ${b.python}`);
  small.cleanup();
  large.cleanup();
});

test('fleet: a malformed plan does not take the estate down', () => {
  // `Done when` item 6. The batch call is exactly where one bad file can poison
  // every result: one invocation now covers every plan, so a parser that died
  // on the worst file would report nothing about the good ones.
  //
  // `plot-plan-meta.sh` contracts to exit 0 always and report parse problems IN
  // the JSON. This test holds the scan to the consequence of that contract
  // rather than to the contract itself — what matters is that the readable
  // plans are still reported.
  const f = makeRepo('plot-batch-malformed-', 4);
  // A file that is not a plan at all, plus one whose Status section is
  // truncated mid-record. Neither may remove p000..p003 from the report.
  fs.writeFileSync(path.join(f.dir, 'plans', '2026-01-01-broken.md'),
    '# Broken\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n###   \n- `feature/\n');
  fs.writeFileSync(path.join(f.dir, 'plans', '2026-01-01-notaplan.md'),
    'just some prose, no Status section at all\n');
  git(f.dir, 'add', '-A');
  git(f.dir, 'commit', '-qm', 'add malformed');
  git(f.dir, 'push', '-q', 'origin', 'main');

  const out = execFileSync('bash', [scan, '--offline'],
    { encoding: 'utf8', cwd: f.dir });
  for (let i = 0; i < 4; i++) {
    const slug = `p${String(i).padStart(3, '0')}`;
    assert.match(out, new RegExp(`^ {6}feature/${slug} — `, 'm'),
      `a malformed sibling must not hide ${slug}; the scan reports what it could read`);
  }
  const summary = out.split('\n').filter((l) => l.startsWith('summary: '));
  assert.equal(summary.length, 1, 'the scan still completes with a footer');
  assert.match(summary[0], /\bplans=[45]\b/,
    'the four readable plans are counted (the unparseable one may or may not be a plan)');
  f.cleanup();
});
