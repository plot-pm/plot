// THE LIVENESS TOKEN, MEASURED ON REAL PROCESSES.
//
// Each test starts the shipped `plot-worker-wrapper.mjs` detached on a fresh
// desk, as `plot-worker-start.mjs` does, with a stub `Worker command` shaped
// like the real chain: `bash -c` execs a node loop, and the loop starts a
// harness with fd 3 in its `stdio`, as `worker-loop.ts` does when
// `PLOT_WORKER_TOKEN_FD=3`. The harness is a bash `sleep 1` loop. Each desk is
// then read through `readWorkerReadings` with the FIFO token reader, the way
// fleetd reads it.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { deskFilesIo, processReadingOf, readWorkerReadings } from '@plot-pm/domain/adapters/processes/processes-files';
import { livenessTokenFifo } from '@plot-pm/domain/adapters/liveness-token/liveness-token-fifo';
import { RELEASED_WITH_NO_EXIT, TOKEN_FILENAME } from '@plot-pm/domain/rules/worker-liveness';

import { removeTree } from '../rm-tree.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'plot', 'scripts');
const BUNDLE = path.join(SCRIPTS, 'board', 'plot-worker-wrapper.mjs');
const BRANCH = 'feature/liveness-token';
const BOUND_SECONDS = 600;

const roots: string[] = [];
const groups: number[] = [];
const pids: number[] = [];
afterAll(() => {
  for (const pgid of groups) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch {
      /* the group already ended */
    }
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  for (const root of roots) removeTree(root);
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const readOr = (file: string): string | undefined => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

const until = async <T>(what: string, read: () => T | undefined, ms = 15_000): Promise<T> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A desk, a registry directory with its manifest, and the stub loop. */
const makeDesk = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-liveness-')));
  roots.push(root);
  const desk = path.join(root, 'desk');
  const agents = path.join(root, 'agents');
  fs.mkdirSync(desk);
  fs.mkdirSync(agents);
  const manifest = path.join(agents, 'session.json');
  fs.writeFileSync(
    manifest,
    ['{', '  "session": "liveness",', `  "branch": "${BRANCH}",`, `  "worktree": "${desk}",`, '  "command": "stub",', '  "pid": "",', `  "startedAt": "${new Date().toISOString()}"`, '}', ''].join('\n'),
  );
  // The node loop's own shape (`acquireToken` in worker-loop.ts): it opens the
  // token path again close-on-exec, closes fd 3, and names the new descriptor
  // in the harness's stdio and in no other child's. The harness starts a
  // long-lived child of its own, as a Bash tool shell or an MCP server would.
  const loop = path.join(root, 'loop.mjs');
  fs.writeFileSync(
    loop,
    [
      "import { spawn } from 'node:child_process';",
      "import { closeSync, constants, openSync, writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      'let hold = [];',
      "if (process.env.PLOT_WORKER_TOKEN_FD === '3') {",
      `  const fresh = openSync(join(process.cwd(), ${JSON.stringify(TOKEN_FILENAME)}), constants.O_RDWR);`,
      '  closeSync(3);',
      '  hold = [fresh];',
      '}',
      "const grand = join(process.cwd(), 'grandchild');",
      "const harness = spawn('bash', ['-c', `sleep 300 & echo $! > '${grand}'; while :; do sleep 1; done`], { stdio: ['ignore', 'ignore', 'ignore', ...hold] });",
      "const other = spawn('bash', ['-c', 'while :; do sleep 1; done'], { stdio: ['ignore', 'ignore', 'ignore'] });",
      "writeFileSync(process.argv[2], `${harness.pid} ${other.pid}`);",
      'setInterval(() => undefined, 1000);',
      '',
    ].join('\n'),
  );
  return { root, desk, agents, manifest, loop, children: path.join(root, 'children') };
};

type Desk = ReturnType<typeof makeDesk>;

/** Starts the wrapper detached on `d` with `command`, and waits for its agent pid. */
const launch = async (d: Desk, command: string, env: NodeJS.ProcessEnv = {}) => {
  fs.rmSync(path.join(d.desk, '.plot-worker.pid'), { force: true });
  const log = fs.openSync(path.join(d.desk, '.plot-worker.log'), 'a');
  const child = spawn(process.execPath, [BUNDLE, command], {
    cwd: d.desk,
    detached: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      PLOT_BRANCH: BRANCH,
      PLOT_WORKTREE: d.desk,
      PLOT_MANIFEST_FILE: d.manifest,
      PLOT_STAMP_STARTED: new Date().toISOString(),
      PLOT_AGENT_MONITOR: '',
      PLOT_EXIT_FILE: path.join(d.desk, '.plot-worker.exit'),
      PLOT_PID_FILE: path.join(d.desk, '.plot-worker.pid'),
      PLOT_PID_STARTED_FILE: path.join(d.desk, '.plot-worker.pid.startedAt'),
      PLOT_WRAPPER_PID_FILE: path.join(d.desk, '.plot-worker.wrapper.pid'),
      PLOT_SCRIPT_DIR: SCRIPTS,
      ...env,
    },
  });
  fs.closeSync(log);
  child.unref();
  const wrapper = child.pid!;
  groups.push(wrapper);
  const agent = await until('the agent pid', () => {
    const text = readOr(path.join(d.desk, '.plot-worker.pid'));
    return text !== undefined && /^\d+$/.test(text) ? Number(text) : undefined;
  });
  return { wrapper, agent };
};

/** Starts the stub loop chain and waits for its harness and its other child. */
const launchLoop = async (d: Desk) => {
  fs.rmSync(d.children, { force: true });
  fs.rmSync(path.join(d.desk, 'grandchild'), { force: true });
  const run = await launch(d, `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(d.loop)} ${JSON.stringify(d.children)}`);
  const [harness, other] = await until('the loop children', () => {
    const text = readOr(d.children);
    return text === undefined ? undefined : text.split(' ').map(Number);
  });
  const grandchild = Number(await until('the harness child', () => readOr(path.join(d.desk, 'grandchild'))?.trim() || undefined));
  pids.push(harness!, other!, grandchild);
  return { ...run, harness: harness!, other: other!, grandchild };
};

/** fleetd's reading of the desk. */
const readDesk = async (d: Desk, over: { now?: () => number; signalZero?: (pid: number) => boolean | null } = {}) => {
  const io = await deskFilesIo(
    { repoRoot: ROOT, scriptDir: SCRIPTS },
    { manifestDir: d.agents, workerBoundSeconds: BOUND_SECONDS, recordRelease: true, ...over },
  )();
  const gathered = await readWorkerReadings(d.desk, [], { ...io, startedAt: async () => null });
  return { gathered, reading: processReadingOf(gathered, false) };
};

/** Whether a pid holds the token on any descriptor: `lsof` where present, `/proc/<pid>/fd` on Linux otherwise. */
const holdsToken = (pid: number, token: string): boolean => {
  try {
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-Fn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').some((line) => line === `n${token}`);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') return false;
    try {
      const ino = fs.statSync(token).ino;
      return fs.readdirSync(`/proc/${pid}/fd`).some((fd) => fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === `pipe:[${ino}]`);
    } catch {
      return false;
    }
  }
};

const RESTARTABLE = ['stalled', 'failed', 'ended', 'none'];
const token = livenessTokenFifo();

describe('the liveness token on real processes', { timeout: 30_000 }, () => {
  it('the wrapper bundle is built', () => {
    expect(fs.existsSync(BUNDLE)).toBe(true);
  });

  it('reads a live agent as live after its wrapper is killed, for 3 reads over 3 s, and starts no restart', async () => {
    const d = makeDesk();
    const run = await launchLoop(d);
    process.kill(run.wrapper, 'SIGKILL');
    await until('the wrapper to end', () => (alive(run.wrapper) ? undefined : true));
    for (let i = 0; i < 3; i += 1) {
      const { gathered, reading } = await readDesk(d);
      expect(gathered.basis).toBe('token');
      expect(gathered.readings.liveness).toBe('live');
      expect(reading.state).toBe('running');
      expect(RESTARTABLE).not.toContain(reading.state);
      await sleep(1_000);
    }
  });

  it('reads a killed tree as dead with no exit record, and names the cause in the desk log and the findings', async () => {
    const d = makeDesk();
    const run = await launchLoop(d);
    process.kill(-run.wrapper, 'SIGKILL');
    await until('the group to end', () => ([run.agent, run.harness, run.grandchild].some(alive) ? undefined : true));
    expect(token.read(d.desk).state).toBe('released');
    const { gathered, reading } = await readDesk(d);
    expect(gathered.readings.liveness).toBe('dead');
    expect(reading).toMatchObject({ state: 'ended', exitCode: '' });
    expect(readOr(path.join(d.desk, '.plot-worker.exit'))).toBeUndefined();
    expect(readOr(path.join(d.desk, '.plot-worker.log'))).toContain(RELEASED_WITH_NO_EXIT);
    const finding = JSON.parse(readOr(path.join(d.desk, '.plot-worker.monitor.agent.jsonl'))!.trim());
    expect(finding).toMatchObject({ branch: BRANCH, finding: 'gone' });
    expect(finding.evidence).toContain(RELEASED_WITH_NO_EXIT);
  });

  it('a reused pid cannot hold the token: a released token reads ended even where the recorded pid answers', async () => {
    const d = makeDesk();
    const run = await launchLoop(d);
    process.kill(-run.wrapper, 'SIGKILL');
    await until('the group to end', () => ([run.agent, run.harness, run.grandchild].some(alive) ? undefined : true));
    const { gathered, reading } = await readDesk(d, { signalZero: () => true });
    expect(gathered.readings.liveness).toBe('dead');
    expect(reading.state).toBe('ended');
  });

  it('a finished desk does not stay running: the exit record wins over a background child holding fd 3', async () => {
    const d = makeDesk();
    await launch(d, 'bash -c "while :; do sleep 1; done" & echo $! > child; exit 0');
    await until('the exit record', () => readOr(path.join(d.desk, '.plot-worker.exit')));
    const child = Number(await until('the child pid', () => readOr(path.join(d.desk, 'child'))));
    pids.push(child);
    expect(alive(child)).toBe(true);
    expect(token.read(d.desk).state).toBe('held');
    const { reading } = await readDesk(d);
    expect(reading).toMatchObject({ state: 'finished', exitCode: '0' });
  });

  it('a loop killed alone does not read dead: its harness holds fd 3, and the desk reads stray-holder', async () => {
    const d = makeDesk();
    const run = await launchLoop(d);
    const tokenPath = path.join(d.desk, TOKEN_FILENAME);
    expect(holdsToken(run.harness, tokenPath)).toBe(true);
    expect(holdsToken(run.agent, tokenPath)).toBe(true);
    // A child of the harness inherits the token: the stray-holder bound is what ends it.
    expect(holdsToken(run.grandchild, tokenPath)).toBe(true);
    expect(holdsToken(run.other, tokenPath)).toBe(false);
    // A LIVE WRAPPER WRITES 137 FOR A LOOP KILLED UNDER IT, and rule 1 then
    // reads that exit record. The case the token answers is the one with no
    // record: the wrapper gone first, then the loop alone.
    process.kill(run.wrapper, 'SIGKILL');
    await until('the wrapper to end', () => (alive(run.wrapper) ? undefined : true));
    process.kill(run.agent, 'SIGKILL');
    await until('the loop to end', () => (alive(run.agent) ? undefined : true));
    expect(readOr(path.join(d.desk, '.plot-worker.exit'))).toBeUndefined();
    expect(alive(run.harness)).toBe(true);
    expect(token.read(d.desk).state).toBe('held');
    const { gathered, reading } = await readDesk(d);
    expect(gathered.readings.liveness).toBe('stray-holder');
    expect(reading.state).toBe('running');
    expect(RESTARTABLE).not.toContain(reading.state);
  });

  it('a stray holder has a bound: it reads stray-holder, then dead once Worker bound from startedAt has passed, while an answering pid stays live', async () => {
    const d = makeDesk();
    const run = await launchLoop(d);
    process.kill(run.wrapper, 'SIGKILL');
    await until('the wrapper to end', () => (alive(run.wrapper) ? undefined : true));
    process.kill(run.agent, 'SIGKILL');
    await until('the loop to end', () => (alive(run.agent) ? undefined : true));
    expect(alive(run.harness)).toBe(true);
    const stray = await readDesk(d);
    expect(stray.gathered.readings.liveness).toBe('stray-holder');
    expect(stray.reading.state).toBe('running');
    const later = await readDesk(d, { now: () => Date.now() + BOUND_SECONDS * 1000 });
    expect(later.gathered.readings.liveness).toBe('dead');
    expect(later.reading.state).toBe('ended');
    const liveLater = await readDesk(d, { now: () => Date.now() + BOUND_SECONDS * 1000, signalZero: () => true });
    // `Worker bound` limits one prompt run, not the loop's life: an answering pid stays live past it.
    expect(liveLater.gathered.readings.liveness).toBe('live');
  });

  it('a restart never inherits the old token: the new run renames a new FIFO, and reads dead once its own holders are gone', async () => {
    const d = makeDesk();
    const first = await launchLoop(d);
    process.kill(first.wrapper, 'SIGKILL');
    process.kill(first.agent, 'SIGKILL');
    await until('the first loop to end', () => ([first.wrapper, first.agent].some(alive) ? undefined : true));
    expect(alive(first.harness)).toBe(true);
    const oldMade = token.read(d.desk).madeAtMs;

    const second = await launchLoop(d);
    const now = token.read(d.desk);
    expect(now.state).toBe('held');
    expect(now.madeAtMs).not.toBe(oldMade);
    process.kill(-second.wrapper, 'SIGKILL');
    await until('the second group to end', () => ([second.agent, second.harness, second.grandchild].some(alive) ? undefined : true));
    expect(alive(first.harness)).toBe(true);
    const { gathered } = await readDesk(d);
    expect(gathered.readings.liveness).toBe('dead');
  });

  it('a failed mkfifo leaves no token and a reason, and the desk reads the start-time path', async () => {
    const d = makeDesk();
    const bin = path.join(d.root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'mkfifo'), '#!/bin/sh\necho "mkfifo: Operation not supported" >&2\nexit 1\n', { mode: 0o755 });
    const run = await launch(d, 'while :; do sleep 1; done', { PATH: `${bin}:${process.env.PATH ?? ''}` });
    await until('the manifest stamp', () => (readOr(d.manifest)?.includes('"token"') ? true : undefined));
    expect(fs.readdirSync(d.desk).filter((name) => name.startsWith(TOKEN_FILENAME))).toEqual([]);
    expect(readOr(path.join(d.desk, '.plot-worker.log'))).toContain('no liveness token');
    expect(JSON.parse(readOr(d.manifest)!).token).toMatch(/^none \(.*mkfifo: Operation not supported\)$/);
    const { gathered } = await readDesk(d);
    expect(gathered.basis).toBe('start-time');
    process.kill(-run.wrapper, 'SIGKILL');
  });

  it('a regular file at the token path reads the start-time path', async () => {
    const d = makeDesk();
    fs.writeFileSync(path.join(d.desk, TOKEN_FILENAME), 'not a fifo');
    fs.writeFileSync(path.join(d.desk, '.plot-worker.pid'), String(process.pid));
    const { gathered } = await readDesk(d);
    expect(gathered.basis).toBe('start-time');
  });
});
