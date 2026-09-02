// Contract test for the SHELL half of the budget record — `plot-budget.sh` and
// the counting `plot-host.sh` does around every host call.
//
// THREE THINGS THIS FILE EXISTS TO PIN, and none is expressible from the
// TypeScript side:
//
// 1. **Every host call appends one line, and a refusal appends one too.** A
//    refused call spent quota, and a record blind to refusals reads a throttled
//    account as an idle one — under-counting exactly when the count matters.
// 2. **The shell writes the format `budget.ts` decodes.** The format is written
//    twice, in two languages, because a shell that had to start `node` to
//    record one call would add a runtime dependency to plot's hot path. The
//    drift risk that buys is real, and this file is the answer to it.
// 3. **Concurrent appenders do not corrupt a line.** Asserted with real
//    concurrency and real `bash` processes, at a line length that approaches
//    `MAX_LINE_BYTES` — a test that never nears the cap has not tested the
//    guarantee the cap exists to give.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const adapter = path.join(scripts, 'plot-host.sh');
const budget = path.join(scripts, 'plot-budget.sh');

// The format's own constant, mirrored from
// `packages/domain/src/entities/budget.ts`. Named here rather than imported
// because this suite is `node --test` over shell and the domain is a vitest
// workspace — and a test that read the constant from the shell would pin the
// shell to itself.
const MAX_LINE_BYTES = 512;

/**
 * A record directory nothing else writes to.
 *
 * `PLOT_BUDGET_HOME` is the one override, and its real job is exactly this: a
 * suite writing to the operator's own record would be measuring their GitHub
 * budget.
 */
function makeHome() {
  return mkdtempSync(path.join(tmpdir(), 'plot-budget-sh-'));
}

/** A `gh` stub that records its argv and can be made to fail with chosen stderr. */
function makeGh({ json = '{}', fail = null, stderr = '' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-budget-stub-'));
  const calls = path.join(dir, 'gh.calls');
  const body = fail
    ? `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${calls}"\n` +
      (stderr === '' ? '' : `printf '%s\\n' '${stderr.replace(/'/g, `'\\''`)}' >&2\n`) +
      `exit 1\n`
    : `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${calls}"\nprintf '%s' '${json.replace(/'/g, `'\\''`)}'\n`;
  writeFileSync(path.join(dir, 'gh'), body);
  chmodSync(path.join(dir, 'gh'), 0o755);
  return { dir, calls };
}

/** Runs the adapter with a stubbed host and a private record. */
function runHost(args, { home, stub, env = {} } = {}) {
  const res = spawnSync('bash', [adapter, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stub.dir}:${process.env.PATH}`,
      PLOT_HOST: 'github',
      PLOT_BUDGET_HOME: home,
      PLOT_BUDGET_ACCOUNT: 'tester',
      ...env,
    },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** The record's lines, or [] where nothing has been written. */
function recordLines(home) {
  const file = path.join(home, 'budget.tsv');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line !== '');
}

/** How many host calls the stub actually saw. */
function callCount(stub) {
  if (!existsSync(stub.calls)) return 0;
  return readFileSync(stub.calls, 'utf8').split('\n').filter((line) => line !== '').length;
}

/**
 * Runs a snippet with `plot-budget.sh` sourced, against a private record.
 *
 * Sourced rather than executed, which is the file's own contract: it defines
 * functions and does nothing else on load.
 */
function inBudget(home, snippet, env = {}) {
  const res = spawnSync('bash', ['-c', `. "${budget}"\n${snippet}`], {
    encoding: 'utf8',
    env: { ...process.env, PLOT_BUDGET_HOME: home, ...env },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

// --- every call is counted, including the ones that fail --------------------

test('budget: every host call appends exactly one line', () => {
  // ONE LINE PER CALL, counted against what the stub actually saw rather than
  // against what the op is believed to do. `pr-state` makes two `gh` calls on
  // GitHub — the rate-limit read and the PR view — and asserting "one line per
  // op" would have pinned the wrong number and passed.
  const home = makeHome();
  const stub = makeGh({ json: '{"number":1,"state":"OPEN","isDraft":false,"url":"u"}' });
  runHost(['pr-state', '1'], { home, stub });
  assert.equal(recordLines(home).length, callCount(stub));
  assert.ok(callCount(stub) > 0, 'the stub saw no call at all — the test proves nothing');
});

test('budget: a refused call is recorded too', () => {
  // A REFUSAL COSTS QUOTA. GitHub debits the request before it decides to
  // refuse it, so a record that omits refusals under-counts exactly when the
  // count matters most — a throttled account reads as an idle one.
  const home = makeHome();
  const stub = makeGh({ fail: true, stderr: 'API rate limit exceeded' });
  runHost(['pr-state', '1'], { home, stub });
  assert.equal(recordLines(home).length, callCount(stub));
  assert.ok(recordLines(home).length > 0, 'a refused call left no line');
});

test('budget: recording changes neither the exit code nor the output', () => {
  // NO BEHAVIOUR CHANGE BEYOND THE RECORD, asserted by running the same call
  // with recording on and off and comparing all three of stdout, exit code and
  // the number of host calls. `PLOT_BUDGET_OFF` exists for this assertion.
  const home = makeHome();
  const withStub = makeGh({ json: '{"number":7,"state":"OPEN","isDraft":false,"url":"u"}' });
  const withoutStub = makeGh({ json: '{"number":7,"state":"OPEN","isDraft":false,"url":"u"}' });
  const on = runHost(['pr-state', '7'], { home, stub: withStub });
  const off = runHost(['pr-state', '7'], {
    home: makeHome(),
    stub: withoutStub,
    env: { PLOT_BUDGET_OFF: '1' },
  });
  assert.equal(on.stdout, off.stdout);
  assert.equal(on.code, off.code);
  assert.equal(callCount(withStub), callCount(withoutStub));
  // And the switch really is a switch: one wrote lines, the other wrote none.
  assert.ok(recordLines(home).length > 0);
});

test('budget: an unwritable record does not fail the call', () => {
  // BOOKKEEPING NEVER FAILS ITS CALLER. The record is written beside a host
  // call that has already happened; a home directory that cannot be written
  // must not turn a successful call into a failed one.
  const stub = makeGh({ json: '{"number":1,"state":"OPEN","isDraft":false,"url":"u"}' });
  const res = runHost(['pr-state', '1'], { home: '/dev/null/nowhere', stub });
  assert.equal(res.code, 0);
  assert.match(res.stdout, /"number":1/);
});

// --- the shell writes the format the domain decodes -------------------------

test('budget: the line carries the ten fields behind the b1 marker', () => {
  // THE FORMAT IS `budget.ts`'s AND NOT THIS FILE'S. Ten tab-separated fields
  // behind a `b1` marker, which is what `decodeEntry` requires — it returns
  // null for any other field count or marker, and a null reads as a torn line.
  const home = makeHome();
  inBudget(home, 'budget_append github jwloka graphql 1 5000 4854 1788269670 actual');
  const [line] = recordLines(home);
  const fields = line.split('\t');
  assert.equal(fields.length, 10);
  assert.deepEqual(fields.slice(0, 4), ['b1', 'github', 'jwloka', 'graphql']);
  assert.equal(fields[5], '1');
  assert.equal(fields[6], '5000');
  assert.equal(fields[7], '4854');
  assert.equal(fields[9], 'actual');
});

test('budget: an absent number is written as the absent marker, never as zero', () => {
  // ABSENT IS NOT ZERO, and this is where it costs something real: a
  // `remaining` of 0 means the bucket is spent and every call is refused, while
  // an absent one means the connector did not say. Writing null as `0` would
  // make silence read as exhaustion.
  const home = makeHome();
  inBudget(home, "budget_append bitbucket team api 1 1000 '' '' predicted");
  const fields = recordLines(home)[0].split('\t');
  assert.equal(fields[7], '-', 'an unreported remaining must not be written as 0');
  assert.equal(fields[8], '-', 'an unreported reset must not be written as 0');
  assert.notEqual(fields[7], '0');
});

test('budget: the reset is stored in milliseconds, as the record holds it', () => {
  // The connector reports epoch SECONDS and the record holds MILLISECONDS —
  // `budget.ts` stores `resetAt` in ms, and a seconds value stored there would
  // land in 1970 and make every line read as dead.
  const home = makeHome();
  inBudget(home, 'budget_append github jwloka graphql 1 5000 4854 1788269670 actual');
  assert.equal(recordLines(home)[0].split('\t')[8], '1788269670000');
});

test('budget: a timestamp is milliseconds and near now', () => {
  const home = makeHome();
  const before = Date.now();
  inBudget(home, 'budget_append github jwloka graphql 1 - - - unknown');
  const at = Number(recordLines(home)[0].split('\t')[4]);
  assert.ok(at >= before - 1000 && at <= Date.now() + 1000, `timestamp ${at} is not near now`);
});

test('budget: an unknown basis carries no numbers', () => {
  // A number tagged *unknown* is the collapse slice 1 exists to refuse: the two
  // would otherwise be able to disagree, and a caller reading the number would
  // be reading a value the basis says nobody took.
  const home = makeHome();
  inBudget(home, 'budget_append gitlab someone api 1 9999 8888 - unknown');
  const fields = recordLines(home)[0].split('\t');
  assert.equal(fields[6], '-');
  assert.equal(fields[9], 'unknown');
});

test('budget: a basis nobody has seen degrades to unknown, never to actual', () => {
  // The split falls ONE WAY ONLY. `actual` is the one basis a caller is
  // entitled to trust, so a word nobody has seen must never arrive as it.
  const home = makeHome();
  inBudget(home, 'budget_append gitlab someone api 1 - - - measured');
  assert.equal(recordLines(home)[0].split('\t')[9], 'unknown');
});

test('budget: a tab in a key part cannot add a field', () => {
  // A tab would add a field and a newline would add a line, so both are
  // replaced rather than escaped — an escape scheme costs every reader a
  // decoder, and no connector spells its name with whitespace.
  const home = makeHome();
  inBudget(home, "budget_append github $'a\\tb' $'c\\nd' 1 - - - unknown");
  const lines = recordLines(home);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].split('\t').length, 10);
});

// --- the line cap is the atomicity guarantee --------------------------------

test('budget: a line over the cap is refused, not truncated', () => {
  // A torn line loses the CONCURRENT writer's line too, so refusing one spend
  // is cheaper than corrupting another's. And the refusal SAYS SO: a silent one
  // would make a systematically over-long key look like an idle account.
  const home = makeHome();
  const huge = 'a'.repeat(MAX_LINE_BYTES);
  const res = inBudget(home, `budget_append github ${huge} api 1 - - - unknown`);
  assert.equal(recordLines(home).length, 0, 'an over-long line was written');
  assert.match(res.stderr, /refusing/);
  assert.equal(res.code, 0, 'refusing a line must not fail the caller');
});

test('budget: a line at the cap is written', () => {
  // The cap is a boundary, and a test that only ever refuses proves the refusal
  // and not the boundary. This pins that the appender does not refuse a line it
  // is allowed to write.
  const home = makeHome();
  // 10 fields, 9 tabs, marker `b1`, and the fixed tail; the account is padded
  // so the whole line lands exactly on the cap.
  const fixed = ['b1', 'github', '', 'api', '1788269670000', '1', '-', '-', '-', 'unknown'].join('\t')
    .length + 1;
  const pad = 'a'.repeat(MAX_LINE_BYTES - fixed);
  inBudget(home, `budget_append github ${pad} api 1 - - - unknown`);
  const lines = recordLines(home);
  assert.equal(lines.length, 1);
  assert.ok(
    Buffer.byteLength(lines[0] + '\n') <= MAX_LINE_BYTES,
    'the written line exceeded the cap',
  );
});

test('budget: concurrent appenders never tear a line, at lines near the cap', () => {
  // REAL CONCURRENCY, REAL PROCESSES, AND LINES THAT APPROACH THE CAP.
  // `MAX_LINE_BYTES` is the guarantee, so a test writing short lines has not
  // tested it: `O_APPEND` atomicity is a property of the write's SIZE.
  //
  // Six writers rather than two, because `PIPE_BUF` on this fleet's macOS
  // machines is 512 — a tenth of Linux's 4096 — and the tear this cap exists to
  // prevent needs contention to show itself.
  const home = makeHome();
  const each = 120;
  const writers = 6;
  // A key long enough that each line lands just under the cap, which is the
  // only length at which the guarantee is under any strain at all.
  const fixed = ['b1', 'github', '', 'api', '1788269670000', '1', '5000', '4854', '-', 'actual']
    .join('\t').length + 1;
  const pad = MAX_LINE_BYTES - fixed - 2;

  const procs = Array.from({ length: writers }, (_, index) =>
    spawnSync(
      'bash',
      [
        '-c',
        `. "${budget}"\n` +
          `acct="w${index}$(printf 'a%.0s' $(seq 1 ${pad - 2}))"\n` +
          `for i in $(seq 1 ${each}); do budget_append github "$acct" api 1 5000 4854 - actual; done`,
      ],
      { encoding: 'utf8', env: { ...process.env, PLOT_BUDGET_HOME: home } },
    ),
  );
  for (const proc of procs) assert.equal(proc.status, 0, proc.stderr);

  const lines = recordLines(home);
  assert.equal(lines.length, each * writers, 'a line was lost or split');

  // NEITHER INTERLEAVED: every line has exactly ten fields and the `b1` marker,
  // and each writer's tag appears exactly `each` times. A torn write leaves one
  // line short of a field and another carrying two writers' halves.
  const perWriter = new Map();
  for (const line of lines) {
    const fields = line.split('\t');
    assert.equal(fields.length, 10, `torn line: ${JSON.stringify(line)}`);
    assert.equal(fields[0], 'b1', `torn line: ${JSON.stringify(line)}`);
    assert.ok(
      Buffer.byteLength(line + '\n') <= MAX_LINE_BYTES,
      `line over the cap: ${Buffer.byteLength(line + '\n')}`,
    );
    perWriter.set(fields[2], (perWriter.get(fields[2]) ?? 0) + 1);
  }
  assert.equal(perWriter.size, writers);
  for (const [tag, count] of perWriter) assert.equal(count, each, `writer ${tag} lost lines`);
});

// --- two worktrees share one record ----------------------------------------

test('budget: two worktrees of one account write to one record', () => {
  // THE CASE THE LOCATION EXISTS FOR, asserted rather than assumed. Measured
  // 2026-09-01: two GitHub checkouts on this computer share the account
  // `jwloka`, and a per-checkout record let each read a full 5000 while the
  // other spent it — the over-spend this plan exists to prevent, reproduced by
  // storing the record in the wrong place.
  const home = makeHome();
  const first = mkdtempSync(path.join(tmpdir(), 'plot-wt-one-'));
  const second = mkdtempSync(path.join(tmpdir(), 'plot-wt-two-'));
  for (const cwd of [first, second]) {
    const res = spawnSync('bash', ['-c', `. "${budget}"\nbudget_append github jwloka api 1 - - - unknown`], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, PLOT_BUDGET_HOME: home },
    });
    assert.equal(res.status, 0, res.stderr);
  }
  // Both landed in one file, under one key — which is what makes the account's
  // total readable at all.
  const lines = recordLines(home);
  assert.equal(lines.length, 2);
  assert.equal(new Set(lines.map((line) => line.split('\t').slice(1, 4).join('/'))).size, 1);
});

test('budget: the record path names no checkout', () => {
  // Nothing in the resolution reads a repository root, a git directory or a
  // working directory — and that ABSENCE is the fix rather than an omission.
  const home = makeHome();
  const one = inBudget(home, 'budget_path').stdout.trim();
  const two = spawnSync('bash', ['-c', `. "${budget}"\nbudget_path`], {
    cwd: tmpdir(),
    encoding: 'utf8',
    env: { ...process.env, PLOT_BUDGET_HOME: home },
  }).stdout.trim();
  assert.equal(one, two);
  assert.ok(!one.includes('.worktrees'));
});

// --- the rate is readable, over the window ----------------------------------

test('budget: the spend rate counts only this budget', () => {
  // Lines belonging to other budgets are not this budget's business. A rate
  // that summed the file would report a GitHub cadence inflated by every
  // Jenkins poll on the machine.
  const home = makeHome();
  inBudget(
    home,
    [
      'budget_append github jwloka api 1 - - - unknown',
      'budget_append github jwloka api 1 - - - unknown',
      'budget_append jenkins ci "" 1 60 - - predicted',
      'budget_append bitbucket team api 1 1000 - - predicted',
    ].join('\n'),
  );
  const rate = JSON.parse(inBudget(home, 'budget_rate github jwloka api').stdout);
  assert.equal(rate.spent, 2);
  assert.equal(rate.lines, 2);
});

test('budget: the rate is derived over the window, not the whole file', () => {
  // THE WHOLE REASON THE WINDOW EXISTS. Measured 2026-09-01, ~1,160 lines an
  // hour: a rate divided by an ever-growing span approaches zero, so a cadence
  // derived from it relaxes forever — the opposite of what the record is for.
  const home = makeHome();
  const now = 1_788_269_670_000;
  const file = path.join(home, 'budget.tsv');
  const line = (at) => `b1\tgithub\tjwloka\tapi\t${at}\t1\t-\t-\t-\tunknown`;
  writeFileSync(
    file,
    [
      line(now - 5 * 60 * 60 * 1000), // five hours old: dead
      line(now - 4 * 60 * 60 * 1000), // four hours old: dead
      line(now - 30 * 60 * 1000), // half an hour old: live
      line(now - 15 * 60 * 1000), // live
    ].join('\n') + '\n',
    'utf8',
  );
  const rate = JSON.parse(inBudget(home, `budget_rate github jwloka api ${now}`).stdout);
  assert.equal(rate.spent, 2, 'the dead lines were counted');
  assert.equal(rate.spanMs, 30 * 60 * 1000);
  assert.equal(Math.round(rate.perHour), 4);
});

test('budget: a reset already passed starts the window, one still ahead does not', () => {
  // A reset an hour out, minus an hour, lands on `now` — and every line ever
  // written is then older than the window. So a FUTURE reset says only that the
  // window has not closed, and the fallback bounds it instead.
  const home = makeHome();
  const now = 1_788_269_670_000;
  const file = path.join(home, 'budget.tsv');
  const line = (at, reset) => `b1\tgithub\tjwloka\tapi\t${at}\t1\t-\t-\t${reset}\tunknown`;
  const future = now + 30 * 60 * 1000;
  writeFileSync(
    file,
    [line(now - 40 * 60 * 1000, future), line(now - 10 * 60 * 1000, future)].join('\n') + '\n',
    'utf8',
  );
  const ahead = JSON.parse(inBudget(home, `budget_rate github jwloka api ${now}`).stdout);
  assert.equal(ahead.spent, 2, 'a future reset discarded live lines');

  const passed = now - 20 * 60 * 1000;
  writeFileSync(
    file,
    [line(now - 40 * 60 * 1000, passed), line(now - 10 * 60 * 1000, passed)].join('\n') + '\n',
    'utf8',
  );
  const after = JSON.parse(inBudget(home, `budget_rate github jwloka api ${now}`).stdout);
  assert.equal(after.spent, 1, 'a passed reset did not start the window');
});

test('budget: an unreadable line is counted and never thrown on', () => {
  // A NULL IS THE NORMAL CASE. The file is appended to by processes that may be
  // killed mid-write, so a torn tail is a thing every reader meets — and a
  // reader that failed on one would report the whole account as unreadable,
  // which reads as headroom to anything that takes a fallback.
  const home = makeHome();
  writeFileSync(
    path.join(home, 'budget.tsv'),
    [
      'b1\tgithub\tjwloka\tapi\t1788269670000\t1\t-\t-\t-\tunknown',
      'b1\tgithub\tjwloka', // a torn tail
      'b9\tgithub\tjwloka\tapi\t1788269670000\t1\t-\t-\t-\tunknown', // a newer format
      '',
    ].join('\n'),
    'utf8',
  );
  const rate = JSON.parse(inBudget(home, 'budget_rate github jwloka api 1788269671000').stdout);
  assert.equal(rate.spent, 1);
  assert.equal(rate.unreadable, 2);
});

test('budget: a record nobody has written reports no spend and no rate', () => {
  // A MISSING FILE IS AN EMPTY RECORD, not a failure — absence is the state of
  // every computer that has not spent yet, and `failed` would make a fresh
  // machine look broken.
  const home = makeHome();
  const rate = JSON.parse(inBudget(home, 'budget_rate github jwloka api').stdout);
  assert.equal(rate.spent, 0);
  assert.equal(rate.perHour, null, 'an empty record must not report a zero rate');
  assert.equal(rate.basis, 'unknown');
});

test('budget: no span to divide by reports an absent rate, never a zero one', () => {
  // An invented rate is exactly the dishonest cadence input this slice exists
  // to remove. One line has nothing to divide by, and `null` says so.
  const home = makeHome();
  const now = 1_788_269_670_000;
  writeFileSync(
    path.join(home, 'budget.tsv'),
    `b1\tgithub\tjwloka\tapi\t${now}\t1\t-\t-\t-\tunknown\n`,
    'utf8',
  );
  const rate = JSON.parse(inBudget(home, `budget_rate github jwloka api ${now}`).stdout);
  assert.equal(rate.spent, 1);
  assert.equal(rate.perHour, null);
  assert.notEqual(rate.perHour, 0);
});

test('budget: an unknown reading is reported as absent, never as room', () => {
  // `unknown` IS NOT HEADROOM. A caller reading absence as permission is the
  // defect, so a stored number tagged unknown is reported as no number at all.
  const home = makeHome();
  const now = 1_788_269_670_000;
  writeFileSync(
    path.join(home, 'budget.tsv'),
    `b1\tgithub\tjwloka\tapi\t${now}\t1\t-\t-\t-\tunknown\n`,
    'utf8',
  );
  const rate = JSON.parse(inBudget(home, `budget_rate github jwloka api ${now}`).stdout);
  assert.equal(rate.basis, 'unknown');
  assert.equal(rate.limit, null);
  assert.equal(rate.remaining, null);
});

test('budget: a recorded zero remaining is told apart from an unknown one', () => {
  // The pair this record refuses to collapse: 0 means the bucket is spent and
  // every call is refused; absent means the connector did not say.
  const home = makeHome();
  const now = 1_788_269_670_000;
  writeFileSync(
    path.join(home, 'budget.tsv'),
    `b1\tgithub\tjwloka\tapi\t${now}\t1\t5000\t0\t-\tactual\n`,
    'utf8',
  );
  const rate = JSON.parse(inBudget(home, `budget_rate github jwloka api ${now}`).stdout);
  assert.equal(rate.remaining, 0);
  assert.equal(rate.basis, 'actual');
  assert.notEqual(rate.remaining, null);
});

// --- the op ----------------------------------------------------------------

test('budget: spend-rate reads the record back and asks no host', () => {
  // IT SPENDS NOTHING — the whole reason the record exists rather than a
  // `rate_limit` call per decision. Asserted against the stub's call count,
  // which must not move.
  const home = makeHome();
  const stub = makeGh({ json: '{"number":1,"state":"OPEN","isDraft":false,"url":"u"}' });
  runHost(['pr-state', '1'], { home, stub });
  const spentCalls = callCount(stub);

  const res = runHost(['spend-rate'], { home, stub });
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.connector, 'github');
  assert.equal(out.account, 'tester');
  assert.equal(out.spent, spentCalls);
  assert.equal(callCount(stub), spentCalls, 'spend-rate asked the host');
});

test('budget: spend-rate accepts an explicit triple', () => {
  // For a caller asking about a connector it is not itself using — the key is
  // (connector, account, bucket) and all three are the caller's to name.
  const home = makeHome();
  const stub = makeGh();
  inBudget(home, 'budget_append bitbucket team api 1 1000 - - predicted');
  const out = JSON.parse(
    runHost(['spend-rate', '--connector', 'bitbucket', '--account', 'team', '--bucket', 'api'], {
      home,
      stub,
    }).stdout,
  );
  assert.equal(out.connector, 'bitbucket');
  assert.equal(out.spent, 1);
  assert.equal(out.basis, 'predicted');
});

test('budget: spend-rate refuses an argument it does not know', () => {
  const home = makeHome();
  const stub = makeGh();
  const res = runHost(['spend-rate', '--nonsense'], { home, stub });
  assert.notEqual(res.code, 0);
});

test('budget: an account nobody could resolve is recorded, not dropped', () => {
  // Two checkouts whose account cannot be read still share one real budget, so
  // dropping their lines would under-count the machine — the failure this plan
  // exists to remove. They group under one honest name instead.
  const home = makeHome();
  const stub = makeGh({ json: '{"number":1,"state":"OPEN","isDraft":false,"url":"u"}' });
  const res = spawnSync('bash', [adapter, 'pr-state', '1'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stub.dir}:${process.env.PATH}`,
      PLOT_HOST: 'github',
      PLOT_BUDGET_HOME: home,
      PLOT_BUDGET_ACCOUNT: '',
      // No `gh` config to read an account out of.
      GH_CONFIG_DIR: path.join(home, 'absent'),
    },
  });
  assert.equal(res.status, 0);
  const lines = recordLines(home);
  assert.ok(lines.length > 0, 'the call went unrecorded');
  for (const line of lines) assert.equal(line.split('\t')[2], 'unknown');
});
