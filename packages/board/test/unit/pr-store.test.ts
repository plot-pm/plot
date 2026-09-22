import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmTree } from '../helpers.mjs';
import { refreshPrs, freshCacheEntry, type CacheEntry, type PrRecord } from '../../src/server/fleet.js';
import { decodePrIndex, type PrIndex } from '@plot-pm/domain';

// THE SUBJECT: `refreshPrs` reads a durable store before its host call and
// writes it after. The call's filter is unchanged — still
// `pr-list --rich --state all --limit 1000` — so what this buys is that the
// ANSWER survives the process.
//
// The measurement behind it: one `gh pr list --state all` with the fields the
// board needs is 29 811 ms of a 32 105 ms scan, 96%. The board refreshes every
// 5 s against that, so under load it reported "No contact with the board server
// for 12 polls" while the server was alive and inside the call.
//
// EVERY ASSERTION HERE IS ABOUT THE FILE, not about the in-memory map. The
// outage paths already keep the map and are already tested; what is new is that
// they must leave the DISK alone, because the next process inherits the disk.

/** One `pr-list --rich` line, as `plot-host.sh` emits it. */
const line = (over: Record<string, unknown> = {}): string => JSON.stringify({
  number: 1,
  title: 'a pull request',
  state: 'OPEN',
  head: 'feature/one',
  draft: false,
  checks: 'green',
  mergeable: 'mergeable',
  review: '',
  url: 'https://example.invalid/1',
  updatedAt: '2026-09-20T12:00:00Z',
  failing_checks: [],
  ...over,
});

/**
 * A fake `plot-host.sh` answering `pr-list` with fixed rows and a fixed code.
 *
 * A SCRIPT RATHER THAN A STUBBED FUNCTION, because the seam under test is the
 * real one: `refreshPrs` locates `plot-host.sh` by path and shells out to it,
 * and exit code 7 — a partial answer — is a property of that boundary rather
 * than of any object a stub could return.
 */
const fakeHost = (rows: readonly string[], code = 0, stderr = ''): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-pr-store-'));
  const body = rows.map((r) => `printf '%s\\n' ${JSON.stringify(r)}`).join('\n');
  fs.writeFileSync(
    path.join(dir, 'plot-host.sh'),
    '#!/usr/bin/env bash\n'
    // EVERY INVOCATION IS RECORDED, APPENDED RATHER THAN OVERWRITTEN. The
    // window's whole contract is about WHICH arguments went out — a cold store
    // must issue the call unchanged, and a warm one must add `--since` with the
    // stored stamp. An overwriting record would show only the last call and
    // hide exactly the comparison these tests make.
    + `printf '%s\\n' "$*" >> ${JSON.stringify(path.join(dir, 'argv'))}\n`
    + 'if [ "$1" = pr-list ]; then\n'
    + `${body}\n`
    + (stderr ? `  printf '%s\\n' ${JSON.stringify(stderr)} >&2\n` : '')
    + `  exit ${code}\nfi\nexit 0\n`,
  );
  fs.chmodSync(path.join(dir, 'plot-host.sh'), 0o755);
  return dir;
};

/** Every `plot-host.sh` invocation that scripts directory saw, in order. */
const argvOf = (scriptsDir: string): string[] => {
  const file = path.join(scriptsDir, 'argv');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '');
};

const dirs: string[] = [];
/** A scripts directory whose `plot-host.sh` answers as told. */
const host = (rows: readonly string[], code = 0, stderr = ''): string => {
  const dir = fakeHost(rows, code, stderr);
  dirs.push(dir);
  return dir;
};

/** A store home the suite owns, so it never touches the operator's own. */
const storeHome = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-pr-store-home-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmTree(dir);
  delete process.env.PLOT_PR_INDEX_HOME;
  delete process.env.PLOT_BUDGET_HOME;
});

/**
 * Drives one refresh against a fake host and a suite-owned store.
 *
 * `backend` is pinned on the entry rather than resolved, so the store's
 * filename is known to the test and no `plot-config.sh` lookup is needed.
 */
const refresh = async (
  scriptsDir: string, home: string, entry: CacheEntry = freshCacheEntry(),
): Promise<CacheEntry> => {
  process.env.PLOT_PR_INDEX_HOME = home;
  // THE SLOT CLAIMS GO SOMEWHERE THIS SUITE OWNS TOO, and that is a correctness
  // fix rather than a speed one. `slotsFile()` defaults to `~/.plot/state/`,
  // which on a developer's machine holds the claims of every LIVE board and
  // worker — measured here: five accounts, `jwloka`, `plot-pm`, `quatico`
  // among them. Without this the suite waits on the operator's real
  // concurrency cap and takes slots from it: one test spent 215 s polling for
  // a slot a running board was holding, and passed or failed by timing.
  process.env.PLOT_BUDGET_HOME = home;
  entry.backend = 'github';
  // The gate is not consulted: `refreshPrs` is called directly, which is why it
  // is exported. Driving it through `maybeRefreshPrs` would prove the cadence
  // gate was open and nothing about the store.
  await refreshPrs({ repoRoot: scriptsDir, scriptsDir }, entry);
  return entry;
};

/** The store as it sits on disk, or null where there is none. */
const onDisk = (home: string): PrIndex | null => {
  const file = path.join(home, 'github.json');
  if (!fs.existsSync(file)) return null;
  return decodePrIndex(fs.readFileSync(file, 'utf8'));
};

describe('a whole answer is written to the store', () => {
  it('writes the rows the host returned, keyed by number', async () => {
    const home = storeHome();
    await refresh(host([line(), line({ number: 2, head: 'feature/two' })]), home);
    const held = onDisk(home);
    expect(held?.rows.map((r) => r.number)).toEqual([1, 2]);
    expect(held?.complete).toBe(true);
  });

  it('takes the watermark from the returned rows, never from the clock', async () => {
    // THE DONE-WHEN, and the fixture data is deliberately OLD — a year behind
    // the wall clock this test runs under. An implementation stamping
    // `Date.now()` writes today; the skew bug the design names is exactly that,
    // and it closes the window permanently because it never reopens.
    const home = storeHome();
    await refresh(host([
      line({ updatedAt: '2025-01-01T00:00:00Z' }),
      line({ number: 2, head: 'feature/two', updatedAt: '2025-06-01T00:00:00Z' }),
    ]), home);
    expect(onDisk(home)?.watermark).toBe('2025-06-01T00:00:00Z');
  });

  it('stores both PRs of one branch', async () => {
    // THE DONE-WHEN: catches branch-keying, the `--limit 1` defect by another
    // route — `plot-pr-merged.sh` measured three branches reported unlanded
    // whose work was on main, each masked by a duplicate the fleet opened.
    const home = storeHome();
    const head = 'feature/reopened';
    await refresh(host([
      line({ number: 10, head, state: 'CLOSED' }),
      line({ number: 11, head, state: 'OPEN' }),
    ]), home);
    const held = onDisk(home);
    expect(held?.rows).toHaveLength(2);
    expect(held?.rows.map((r) => [r.number, r.state])).toEqual([[10, 'CLOSED'], [11, 'OPEN']]);
  });

  it('round-trips each absent-value shape rather than inventing a fourth', async () => {
    // `refreshPrs` normalizes three fields to three DIFFERENT absent values.
    // Writing `false` or `"none"` for a field the host never answered
    // manufactures the verdict `an-unasked-host-is-not-an-absent-pr` removes.
    const home = storeHome();
    await refresh(host([
      JSON.stringify({
        number: 1, state: 'OPEN', head: 'feature/sparse', draft: false,
        checks: 'unknown', review: '',
      }),
    ]), home);
    const row = onDisk(home)?.rows[0];
    expect(row?.url).toBe('');
    expect(row?.mergeable).toBe('unknown');
    expect(row?.failing_checks).toEqual([]);
    // The host answered no stamp, so the store can say nothing about freshness
    // — and says nothing, rather than saying the epoch.
    expect(row?.updatedAt).toBeUndefined();
    expect(onDisk(home)?.watermark).toBeNull();
  });
});

describe('a partial answer merges rather than replaces', () => {
  // THE DONE-WHEN: catches a whole-store write that deletes every PR belonging
  // to a state that did not answer. Bitbucket has no `all` state, so its arm
  // asks once per state and may reach some and not others — dropping those rows
  // is #912, nine branches reading "commits, no PR ever opened" while two had
  // live ones.
  it('keeps the rows a partial pass did not mention', async () => {
    const home = storeHome();
    await refresh(host([line(), line({ number: 2, head: 'feature/two' })]), home);
    expect(onDisk(home)?.rows.map((r) => r.number)).toEqual([1, 2]);

    // Exit 7 with one row: a real partial answer.
    await refresh(
      host([line({ number: 2, head: 'feature/two', state: 'MERGED' })], 7, 'closed state did not answer'),
      home,
    );
    const held = onDisk(home);
    expect(held?.rows.map((r) => r.number)).toEqual([1, 2]);
    expect(held?.rows.find((r) => r.number === 2)?.state).toBe('MERGED');
  });

  it('records the store as no longer whole', async () => {
    const home = storeHome();
    await refresh(host([line()]), home);
    expect(onDisk(home)?.complete).toBe(true);
    await refresh(host([line()], 7, 'a state did not answer'), home);
    // Completeness is RECORDED, never inferred — a partial store must never
    // license "asked, and there is no PR", which is
    // `plot-fleet-scan.sh:1031`'s failure: 28 of 29 fallthrough calls were for
    // branches with no ref and no PR, re-learning NONE forever.
    expect(onDisk(home)?.complete).toBe(false);
  });

  it('drops a row a WHOLE pass no longer lists', async () => {
    const home = storeHome();
    await refresh(host([line(), line({ number: 2, head: 'feature/two' })]), home);
    // THE SECOND PASS MUST BE A FULL READ TO REPLACE, and since the delta slice
    // a warm, whole, freshly-written store is narrowed instead. The store is
    // aged past the full-read cadence so the pass this test is about is the
    // pass that happens — asserting the fold's REPLACE rule, which is what the
    // test has always been for. A delta merging here is correct and is asserted
    // separately, in `the call asks only for the delta`.
    const file = path.join(home, 'github.json');
    const held = decodePrIndex(fs.readFileSync(file, 'utf8'))!;
    fs.writeFileSync(file, JSON.stringify({ ...held, at: '2026-01-01T00:00:00Z' }));
    await refresh(host([line()]), home);
    expect(onDisk(home)?.rows.map((r) => r.number)).toEqual([1]);
  });
});

describe('the outage paths leave the file alone', () => {
  // THE DONE-WHEN, and it asserts the FILE rather than the map: a dark map
  // written to disk is inherited by the next process as good data, where an
  // in-memory one dies with this one. That is why these paths matter more once
  // a store exists, not less.
  it('an all-unknown answer does not touch the store', async () => {
    const home = storeHome();
    await refresh(host([line()]), home);
    const before = fs.readFileSync(path.join(home, 'github.json'), 'utf8');

    const entry = await refresh(host([line({ state: 'unknown' })]), home);
    // The banner fires, which is what says this path was taken at all.
    expect(entry.prError).toContain('unknown');
    expect(fs.readFileSync(path.join(home, 'github.json'), 'utf8')).toBe(before);
  });

  it('a refused call does not touch the store', async () => {
    const home = storeHome();
    await refresh(host([line()]), home);
    const before = fs.readFileSync(path.join(home, 'github.json'), 'utf8');

    const entry = await refresh(host([], 3, 'could not reach the host'), home);
    expect(entry.prError).toBeTruthy();
    expect(fs.readFileSync(path.join(home, 'github.json'), 'utf8')).toBe(before);
  });

  it('a refused call against a COLD store writes nothing at all', async () => {
    // The stronger form: a first refresh that fails must not create a file
    // describing an outage, which the next process would read as an answer.
    const home = storeHome();
    await refresh(host([], 3, 'could not reach the host'), home);
    expect(onDisk(home)).toBeNull();
  });
});

describe('a cold store costs time and never answers', () => {
  it('produces the same maps as no store at all', async () => {
    // THE DONE-WHEN: catches an implementation that writes defaults into absent
    // fields — the store looks populated and the board has invented data.
    const rows = [line(), line({ number: 2, head: 'feature/two', state: 'MERGED' })];
    const cold = await refresh(host(rows), storeHome());
    const alsoCold = await refresh(host(rows), storeHome());
    expect([...alsoCold.prsByNumber!.entries()]).toEqual([...cold.prsByNumber!.entries()]);
    expect([...alsoCold.prs!.entries()]).toEqual([...cold.prs!.entries()]);
    expect([...alsoCold.prsByHead!.entries()]).toEqual([...cold.prsByHead!.entries()]);
  });

  it('a warm store produces the same maps a cold one does', async () => {
    // The store is an optimisation, so deleting it must never change an answer.
    //
    // ASSERTED ON EVERY FIELD `PrRecord` DECLARES, rather than on the parsed
    // object. Since the delta slice a warm refresh serves maps derived from
    // STORED rows, and the store holds what `PrIndexRowSchema` names — which
    // deliberately excludes `title`, a key that rides along on the host's JSON,
    // is declared by no type and is read by nothing. Comparing the raw objects
    // would fail on that passenger and say nothing about the board's answers.
    const fields = (pr: PrRecord) => [
      pr.number, pr.head, pr.state, pr.draft, pr.checks,
      pr.review, pr.url, pr.mergeable, pr.failing_checks,
    ];
    const rows = [line(), line({ number: 2, head: 'feature/two', state: 'MERGED' })];
    const home = storeHome();
    await refresh(host(rows), home);
    const warm = await refresh(host(rows), home);
    const cold = await refresh(host(rows), storeHome());
    expect([...warm.prsByNumber!].map(([n, pr]) => [n, fields(pr)]))
      .toEqual([...cold.prsByNumber!].map(([n, pr]) => [n, fields(pr)]));
    expect([...warm.prs!].map(([h, pr]) => [h, fields(pr)]))
      .toEqual([...cold.prs!].map(([h, pr]) => [h, fields(pr)]));
  });

  it('an unreadable store leaves the board working', async () => {
    // THE DONE-WHEN: a failed write leaves the board working. A read-only
    // filesystem must cost time, not answers.
    const home = storeHome();
    fs.chmodSync(home, 0o500);
    try {
      const entry = await refresh(host([line()]), home);
      expect(entry.prsByNumber?.get(1)?.head).toBe('feature/one');
      // The store's failure is NOT reported as the host's: `prError` is the
      // banner that names the connector, and a local disk problem there would
      // send an operator to look at GitHub.
      expect(entry.prError).toBeNull();
    } finally {
      fs.chmodSync(home, 0o700);
    }
  });

  it('an unrecognised version falls back to a full read and does not throw', async () => {
    const home = storeHome();
    fs.writeFileSync(
      path.join(home, 'github.json'),
      JSON.stringify({ v: 99, connector: 'github', watermark: null, complete: true, at: 'x', rows: [] }),
    );
    const entry = await refresh(host([line()]), home);
    expect(entry.prsByNumber?.get(1)).toBeDefined();
    // And the next whole answer replaces the unreadable file rather than
    // leaving the board stuck with it forever.
    expect(onDisk(home)?.v).toBe(1);
  });
});

describe('the store seeds a cold process', () => {
  // WHAT A RESTART BUYS, and the whole of this slice's own measurable win. The
  // call is unchanged, so the store cannot make it cheaper here; what it does
  // is stop the board being blank for the 29 811 ms the call takes.
  it('fills the maps from disk before the host answers', async () => {
    const home = storeHome();
    await refresh(host([line(), line({ number: 2, head: 'feature/two' })]), home);

    // A new process: a fresh entry, and a host that answers nothing at all.
    const restarted = await refresh(host([], 3, 'the host is unreachable'), home,
      freshCacheEntry());
    // The rows came from disk, because the host refused.
    expect(restarted.prsByNumber?.get(1)?.head).toBe('feature/one');
    expect(restarted.prsByNumber?.get(2)?.head).toBe('feature/two');
  });

  it('does not stamp prAt, so the operator is told how old the data is', async () => {
    const home = storeHome();
    await refresh(host([line()]), home);
    const restarted = await refresh(host([], 3, 'unreachable'), home, freshCacheEntry());
    // `prAt` answers "how old is this DATA". A seeded map is as old as the
    // store, and stamping it now would report stale rows as fresh — the one lie
    // this path could tell, and `prAgeSeconds` is what an operator reads to
    // decide whether to trust the screen.
    expect(restarted.prAt).toBeNull();
  });

  it('never moves a live map backwards', async () => {
    // Disk is older than a map this process already built, by construction.
    const home = storeHome();
    await refresh(host([line({ number: 7, head: 'feature/old' })]), home);
    const entry = await refresh(host([line({ number: 8, head: 'feature/new' })]), home);
    // A second refresh on the SAME entry must not re-seed number 7 from disk.
    await refresh(host([line({ number: 8, head: 'feature/new' })]), home, entry);
    expect([...entry.prsByNumber!.keys()]).toEqual([8]);
  });
});

describe('the call asks only for the delta', () => {
  // THE SUBJECT OF THIS WAVE. One `gh pr list --state all` over 933 pull
  // requests takes 29 811 ms with the fields the board needs; the same call
  // with `--search "updated:>"` over one day takes 943 ms for 3 rows. Factor
  // 32, with every expensive field still included — which is why the answer is
  // a delta call rather than a cache in front of the same call.
  //
  // The window is only asked for once a store exists, carries a watermark and
  // has been proven whole. `prWindowFor` owns that rule and is tested against
  // it directly; what these assert is the SEAM — that the decision reaches the
  // arguments, and that the answer reaches the maps the board serves.

  /** The `pr-list` invocation from one recorded argv line. */
  const prListCall = (scriptsDir: string, nth = 0): string =>
    argvOf(scriptsDir).filter((l) => l.startsWith('pr-list'))[nth] ?? '';

  it('a cold store issues the unchanged full call', async () => {
    // THE DONE-WHEN, and it asserts the ARGUMENTS rather than that a call
    // happened. `--since` with an empty value would still "work" and would ask
    // GitHub for `updated:>`, a syntax error the host may answer with
    // everything or with nothing.
    const scripts = host([line()]);
    await refresh(scripts, storeHome());
    expect(prListCall(scripts)).toBe('pr-list --rich --state all --limit 1000');
  });

  it('a warm store sends the stored watermark, byte-for-byte', async () => {
    const home = storeHome();
    await refresh(host([line({ updatedAt: '2026-09-20T18:42:10Z' })]), home);
    expect(onDisk(home)?.watermark).toBe('2026-09-20T18:42:10Z');

    const second = host([]);
    await refresh(second, home, freshCacheEntry());
    // The stamp the HOST wrote, not this machine's rendering of it. A client
    // two seconds fast excludes the PRs updated in that gap from every later
    // window — forever, because the window never reopens.
    expect(prListCall(second))
      .toBe('pr-list --rich --state all --limit 1000 --since 2026-09-20T18:42:10Z');
  });

  it('a delta whose window returns 3 rows still serves 933', async () => {
    // THE DEFECT THE PLAN DID NOT ANTICIPATE, and the one a store-only
    // assertion passes straight through. `entry.prs`, `prsByNumber` and
    // `prsByHead` were each built inside the parse loop and assigned wholesale
    // — correct for a full read, and for a delta it would replace the whole map
    // with the window's rows and report every other branch as having no PR.
    const home = storeHome();
    const many = Array.from({ length: 12 }, (_, i) =>
      line({ number: i + 1, head: `feature/b${i + 1}`, updatedAt: '2026-09-20T10:00:00Z' }));
    await refresh(host(many), home);
    expect(onDisk(home)?.rows).toHaveLength(12);

    // A new process, and a window answering about ONE pull request.
    const entry = await refresh(
      host([line({ number: 5, head: 'feature/b5', state: 'MERGED', updatedAt: '2026-09-20T18:00:00Z' })]),
      home, freshCacheEntry());

    // The store is right AND the maps are right. Asserting only the first is
    // what lets the board render 1 PR while the file holds 12.
    expect(onDisk(home)?.rows).toHaveLength(12);
    expect(entry.prsByNumber?.size).toBe(12);
    // The window's own row won, because the host has just spoken about it.
    expect(entry.prsByNumber?.get(5)?.state).toBe('MERGED');
    // And a row outside the window survived untouched.
    expect(entry.prsByNumber?.get(11)?.head).toBe('feature/b11');
    // `prs` is the open-only map `classify` reads: the merged one left it and
    // the other eleven stayed.
    expect(entry.prs?.has('feature/b5')).toBe(false);
    expect(entry.prs?.size).toBe(11);
    expect(entry.prsByHead?.get('feature/b11')?.number).toBe(11);
  });

  it('a delta never writes `complete: true`', async () => {
    // THE DONE-WHEN. `foldPrIndex` REPLACES on a complete answer, so a delta
    // claiming wholeness would delete every PR outside its window on the first
    // refresh — #912 reproduced on disk, where the next process inherits it.
    //
    // A successful delta exits 0 and carries no partial sentence, so reading
    // completeness from `partialSaid === null` alone is exactly the mistake.
    const home = storeHome();
    await refresh(host([line({ number: 1 }), line({ number: 2, head: 'feature/two' })]), home);
    expect(onDisk(home)?.complete).toBe(true);

    await refresh(host([line({ number: 2, head: 'feature/two', state: 'MERGED' })]),
      home, freshCacheEntry());
    expect(onDisk(home)?.complete).toBe(false);
    // The rows the window did not mention are still there, which is the same
    // fact seen from the store's side.
    expect(onDisk(home)?.rows.map((r) => r.number)).toEqual([1, 2]);
  });

  it('a delta returning zero rows is a success, not an outage', async () => {
    // THE NORMAL STEADY STATE ON A QUIET ESTATE. A path treating "nothing
    // changed" as "the host did not answer" would raise the outage banner every
    // minute on a healthy board.
    const home = storeHome();
    await refresh(host([line()]), home);
    const before = fs.readFileSync(path.join(home, 'github.json'), 'utf8');

    const entry = await refresh(host([]), home, freshCacheEntry());
    expect(entry.prError).toBeNull();
    // The rows survived the empty window — the fold merged nothing into them.
    expect(entry.prsByNumber?.get(1)?.head).toBe('feature/one');
    // `prAt` was stamped, because the host DID answer. An empty answer is an
    // answer, and reporting the data as older than it is would be the same lie
    // the seed path refuses to tell in the other direction.
    expect(entry.prAt).not.toBeNull();
    // The store is rewritten rather than left alone — `at` moves, so the next
    // full read is measured from this pass. The rows are unchanged.
    expect(onDisk(home)?.rows).toEqual(decodePrIndex(before)?.rows);
  });

  it('a failed delta leaves the watermark where it was', async () => {
    // THE ONE DIRECTION THIS FEATURE MAY NOT FAIL IN. A skipped window is a
    // change nobody ever sees again, so the window must still be open on the
    // next pass. Catches a `catch` block that writes a store before rethrowing.
    const home = storeHome();
    await refresh(host([line({ updatedAt: '2026-09-20T18:42:10Z' })]), home);
    const before = fs.readFileSync(path.join(home, 'github.json'), 'utf8');

    const failed = host([], 3, 'could not reach the host');
    const entry = await refresh(failed, home, freshCacheEntry());
    expect(entry.prError).toBeTruthy();
    // The file is untouched, watermark included.
    expect(fs.readFileSync(path.join(home, 'github.json'), 'utf8')).toBe(before);

    // AND THE NEXT PASS RE-ASKS THE SAME WINDOW, which is the half that
    // matters: a store left alone is only useful if the window reopens.
    const retry = host([]);
    await refresh(retry, home, freshCacheEntry());
    expect(prListCall(retry)).toContain('--since 2026-09-20T18:42:10Z');
  });

  it('a full read is issued again once the delta has run long enough', async () => {
    // A DELTA CANNOT SEE A DELETION: a PR the host no longer has changes
    // nothing, it simply stops being listed. Only a whole answer replaces the
    // store, and only a replacement drops the row.
    //
    // The cadence is reached by ageing the store's `at` rather than by waiting:
    // `at` is this machine's record of when it wrote the file, and a test that
    // slept a day would be a test nobody runs.
    const home = storeHome();
    await refresh(host([line({ number: 1 }), line({ number: 2, head: 'feature/two' })]), home);
    const file = path.join(home, 'github.json');
    const aged = decodePrIndex(fs.readFileSync(file, 'utf8'))!;
    fs.writeFileSync(file, JSON.stringify({ ...aged, at: '2026-01-01T00:00:00Z' }));

    // The full read answers about ONE PR, and the other leaves the store —
    // which is the whole point of keeping a full read at all.
    const full = host([line({ number: 1 })]);
    await refresh(full, home, freshCacheEntry());
    expect(prListCall(full)).toBe('pr-list --rich --state all --limit 1000');
    expect(onDisk(home)?.rows.map((r) => r.number)).toEqual([1]);
    expect(onDisk(home)?.complete).toBe(true);
  });

  it('a partial store is never narrowed against', async () => {
    // A partial store has rows it has NEVER seen — belonging to a state that
    // did not answer — and a window over `updated:>` would never see them
    // either, because they did not change. Narrowing against it makes the gap
    // permanent.
    const home = storeHome();
    await refresh(host([line({ updatedAt: '2026-09-20T18:42:10Z' })], 7, 'a state did not answer'), home);
    expect(onDisk(home)?.complete).toBe(false);
    expect(onDisk(home)?.watermark).toBe('2026-09-20T18:42:10Z');

    const next = host([line()]);
    await refresh(next, home, freshCacheEntry());
    expect(prListCall(next)).toBe('pr-list --rich --state all --limit 1000');
  });

  it('a partial DELTA merges and stays partial', async () => {
    // The two facts are separate and both point the same way here: the answer
    // was neither a full read nor whole, so it may only merge.
    const home = storeHome();
    await refresh(host([
      line({ number: 1, updatedAt: '2026-09-20T10:00:00Z' }),
      line({ number: 2, head: 'feature/two', updatedAt: '2026-09-20T11:00:00Z' }),
    ]), home);

    const entry = await refresh(
      host([line({ number: 2, head: 'feature/two', state: 'MERGED', updatedAt: '2026-09-20T18:00:00Z' })],
        7, 'the closed state did not answer'),
      home, freshCacheEntry());
    // The gap is still SAID — a short list reported as whole is the quiet wrong
    // answer this path refuses everywhere.
    expect(entry.prError).toContain('did not answer');
    expect(onDisk(home)?.complete).toBe(false);
    expect(onDisk(home)?.rows.map((r) => r.number)).toEqual([1, 2]);
    // And the maps carry both, not just the one row that answered.
    expect(entry.prsByNumber?.size).toBe(2);
  });
});
