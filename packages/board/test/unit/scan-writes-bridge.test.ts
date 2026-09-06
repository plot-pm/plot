import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { readBridge, BRIDGE_MAX_AGE_MS } from '../../src/server/pulse-bridge.js';
import { FleetReadingSchema } from '../../src/contract/schema.js';

/**
 * The PULSE writes `last-pulse.json`, and the board reads what the scan it
 * spawned left behind.
 *
 * Until 2026-09-06 `fleet.ts:2804` was the ONLY writer and `plot-fleet-scan.sh`
 * named the file zero times, so `/plot-pulse` in a repository with no board had
 * nothing to diff against and every pulse read as the first one — while
 * `DESIGN-process.md` §1 requires the fleet to work with no board at all.
 *
 * THE FAILURE THIS FILE EXISTS TO CATCH IS SILENT. `pulse-bridge.ts:193`
 * returns null on a version mismatch and `readBridge` swallows every parse
 * error, so a scan writing a file the board cannot read renders an empty page
 * with no error anywhere to trace it by. A fixture asserting the shape by hand
 * would only agree with itself; these tests run the REAL scan and hand what it
 * wrote to the REAL reader.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../../../..');
const SCAN = path.join(REPO_ROOT, 'skills/plot/scripts/plot-fleet-scan.sh');
const BRIDGE = '.plot/state/last-pulse.json';

const PLAN = `# The pulse records itself

## Status
- **Phase:** Approved
- **Type:** feature

## Slices

### Continuity

- \`feature/a-pulse-writes-its-own-record\` — the scan writes the bridge
`;

/**
 * A repo with a real remote and a real claim, so the pulse it produces carries
 * a branch worth reading back.
 *
 * Same shape `bridge.test.mjs` builds, and for the same reason: a claim is an
 * empty `plot: claim …` commit pushed as a ref, not an annotation anybody
 * writes into the plan file.
 */
const makeRepo = (): { tmp: string; repo: string } => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-bridge-'));
  const repo = path.join(tmp, 'work');
  const remote = path.join(tmp, 'remote.git');
  fs.mkdirSync(repo, { recursive: true });

  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' });
  const g = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  g('init', '-b', 'main');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'Plot Test');
  g('config', 'commit.gpgsign', 'false');

  const plans = path.join(repo, 'docs/plans');
  fs.mkdirSync(path.join(plans, 'active'), { recursive: true });
  const planName = '2026-09-06-the-pulse-records-itself.md';
  fs.writeFileSync(path.join(plans, planName), PLAN, 'utf8');
  fs.symlinkSync(path.join(plans, planName), path.join(plans, 'active', planName));

  g('add', '-A');
  g('commit', '-m', 'plan: the pulse records itself');
  g('remote', 'add', 'origin', remote);
  g('push', '-u', 'origin', 'main');

  const claimed = 'feature/a-pulse-writes-its-own-record';
  g('checkout', '-b', claimed);
  g('commit', '--allow-empty', '-m', `plot: claim ${claimed}`);
  g('push', 'origin', claimed);
  g('checkout', 'main');

  return { tmp, repo };
};

/** Run the real scan to completion in `repo`, returning its stdout. */
const scan = (repo: string, ...args: string[]): string =>
  execFileSync('bash', [SCAN, '--offline', ...args], {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });

const bridgeFile = (repo: string): string => path.join(repo, BRIDGE);

describe('the scan writes its own bridge', () => {
  let tmp: string;
  let repo: string;

  beforeAll(() => { ({ tmp, repo } = makeRepo()); });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('records nothing when it was not asked to', () => {
    // The scan is stateless and read-only by design, and this keeps it that way
    // for every internal caller. `--next` is what `plot-implement` and
    // `plot-dispatch` invoke, and neither may leave a file behind as a side
    // effect of asking what to work on.
    fs.rmSync(bridgeFile(repo), { force: true });
    scan(repo);
    expect(fs.existsSync(bridgeFile(repo))).toBe(false);
  });

  it('writes a bridge the BOARD reads back, on the --json path', () => {
    // The board's path: it spawns the scan with `--stream`, which assembles the
    // document. The assertion that matters is `readBridge` returning non-null —
    // a version mismatch or a shape it cannot parse returns null SILENTLY and
    // renders an empty board with no error to trace.
    fs.rmSync(bridgeFile(repo), { force: true });
    const printed = scan(repo, '--json');

    const read = readBridge(repo);
    expect(read).not.toBeNull();

    // Not merely parseable — the SAME document. One composition, two
    // destinations: a scan whose printed answer and recorded answer differ has
    // two implementations of the reading, and they drift.
    //
    // BOTH SIDES GO THROUGH THE SCHEMA, because `readBridge` parses and the
    // parse is not identity: `FleetReadingSchema` renames `waves` to `slices`,
    // drops fields it does not carry and defaults `host`. Comparing a parsed
    // pulse against raw stdout would fail on the schema doing its job. What is
    // asserted here is that the recorded document and the printed one mean the
    // same thing to the board, which is the property that can actually break.
    expect(read!.pulse).toEqual(FleetReadingSchema.parse(JSON.parse(printed)));

    // A pulse about the repository rather than an empty document that happens
    // to validate.
    const branches = read!.pulse.plans.flatMap((p) => p.slices).flatMap((w) => w.branches);
    expect(branches.map((b) => b.branch)).toContain('feature/a-pulse-writes-its-own-record');
  });

  it('writes a bridge on the PROSE path, which is what /plot-pulse runs', () => {
    // The case the plan leads with: a repository with no board. `/plot-pulse`
    // passes `--log-pulse` and no `--json`, so a write wired only to the JSON
    // path would leave a boardless repo accumulating no history at all — and
    // every pulse would be the delta's `first run` case, permanently.
    fs.rmSync(bridgeFile(repo), { force: true });
    const out = scan(repo, '--log-pulse');
    expect(out).toMatch(/Pulse complete/);

    const read = readBridge(repo);
    expect(read).not.toBeNull();
    expect(read!.pulse.plans.length).toBeGreaterThan(0);
  });

  it('ages from when the scan completed, not from when it is read', () => {
    // `pulse-bridge.ts:81` asks for the scan's completion time, and `:200`
    // rejects a file from the FUTURE outright rather than clamping it. A write
    // in seconds rather than milliseconds reads as 1970 and is discarded as too
    // old; one in the other direction is discarded as impossible. Both fail
    // silently, so the clock is asserted rather than assumed.
    fs.rmSync(bridgeFile(repo), { force: true });
    const before = Date.now();
    scan(repo, '--json');
    const after = Date.now();

    const raw = JSON.parse(fs.readFileSync(bridgeFile(repo), 'utf8')) as { version: number; at: number };
    expect(raw.version).toBe(1);
    // One second of slack below: the scan writes whole seconds.
    expect(raw.at).toBeGreaterThanOrEqual(before - 1000);
    expect(raw.at).toBeLessThanOrEqual(after);
    expect(Date.now() - raw.at).toBeLessThan(BRIDGE_MAX_AGE_MS);
  });

  it('leaves the previous bridge intact when it is KILLED', async () => {
    // The property that had to survive the move, stated at `fleet.ts:2800`:
    // *"a scan that failed must not overwrite the last good answer — the only
    // thing standing between a `--watch` restart and an empty board."*
    //
    // So the write sits at the terminal point, and a scan killed before it
    // reaches one changes nothing. Asserted by killing a REAL scan mid-run
    // rather than by reading where the call sits.
    fs.rmSync(bridgeFile(repo), { force: true });
    scan(repo, '--json');
    const good = fs.readFileSync(bridgeFile(repo), 'utf8');

    const child = spawn('bash', [SCAN, '--offline', '--json'], {
      cwd: repo, stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Killed while it is still deriving: the scan spawns git per branch, so a
    // short wait lands inside the walk rather than before it starts.
    await new Promise((r) => setTimeout(r, 150));
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));

    expect(fs.readFileSync(bridgeFile(repo), 'utf8')).toBe(good);
    // And nothing was left half-written beside it.
    const strays = fs.readdirSync(path.join(repo, '.plot/state')).filter((n) => n.includes('.tmp'));
    expect(strays).toEqual([]);
  });

  it('still reports when it cannot write', () => {
    // `writeBridge` swallows every failure on purpose — a read-only checkout, a
    // full disk, a `.plot` nobody may write to — and this half of the contract
    // moves with it. None of that is a reason for a pulse to fail, and the cost
    // of the miss is exactly the behaviour before any of this existed.
    const ro = makeRepo();
    try {
      const state = path.join(ro.repo, '.plot/state');
      fs.mkdirSync(state, { recursive: true });
      fs.chmodSync(state, 0o500);

      const out = scan(ro.repo, '--log-pulse');
      expect(out).toMatch(/Pulse complete/);
      expect(fs.existsSync(path.join(ro.repo, BRIDGE))).toBe(false);

      fs.chmodSync(state, 0o700);
    } finally {
      fs.rmSync(ro.tmp, { recursive: true, force: true });
    }
  });
});
