import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { processesFiles, processReadingOf, readingsLine, readWorkerReadings, deskFilesIo } from '../src/adapters/processes/processes-files.js';
import { processesTable } from '../src/adapters/processes/processes-table.js';
import { shellContext } from '../src/adapters/scripts.js';
import { isAnswered } from '../src/port-result.js';
import { lstartMs, pidIsCurrent, type ProcessRow } from '../src/rules/pid-current.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';
import { readDesks, type AgentStateRow } from './production.js';

/**
 * A READER-VERSUS-SHELL COMPARISON: does `readWorkerReadings` gather what
 * `plot_worker_readings` prints, and does `processesFiles.workerState` answer
 * what `plot_worker_state` answers, on every desk of this estate and on
 * constructed desks?
 *
 * THE PAIR EXISTS ON PURPOSE. `plot_worker_state` runs once per desk per
 * shell pass in `plot-dispatch.sh` and `plot-fleetctl.sh`, so the shell keeps
 * its copy (`docs/shell-and-domain.md`). NEITHER SIDE IS AUTHORITATIVE: on a
 * disagreement the branch stops.
 *
 * THE ONE DECLARED DIVERGENCE is a German or French recorded start read under
 * `LC_ALL=C`: `_plot_lstart_epoch` parses it only with `date -j -f "%c"` in the
 * recording locale, and `lstartMs` reads it in any locale. The localized rows
 * below compare the reader with the shell under the recording locale, and
 * assert separately that the shell under `LC_ALL=C` reads nothing.
 *
 * THE TABLE RACE IS THE READER'S OWN. The shell reads `ps` per check; the
 * reader reads one table per pass, so a pid started after that read has no
 * row. The constructed desk `late` is that case, and both sides must answer
 * `running`.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const STATE_LIB = `${ROOT}/skills/plot/scripts/plot-worker-state.sh`;
const context = shellContext(ROOT);

const SIDES: Sides = { left: 'reader', right: 'shell' };
const report = describingAs(SIDES);

/** The grace both sides run the constructed desks under, in seconds. */
const GRACE = '12';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The environment the shell runs the constructed desks in: no agent process name, the corpus grace, the corpus registry. */
const shellEnv = (manifestDir: string): NodeJS.ProcessEnv => {
  const { PLOT_AGENT_PROCESS: _unset, ...env } = process.env;
  return { ...env, PLOT_MANIFEST_DIR: manifestDir, PLOT_AGENT_GRACE_SECONDS: GRACE };
};

/** `plot_worker_state` and `plot_worker_readings` for each desk, in one bash. */
const shellDesks = (desks: readonly string[], env: NodeJS.ProcessEnv): Map<string, { state: string; readings: string }> => {
  const program = [
    '. "$1"; shift',
    'for wt in "$@"; do',
    '  printf \'%s\\t%s\\t%s\\n\' "$wt" "$(plot_worker_state "$wt" "")" "$(plot_worker_readings "$wt")"',
    'done',
  ].join('\n');
  const out = execFileSync('bash', ['-c', program, 'bash', STATE_LIB, ...desks], { cwd: ROOT, env, encoding: 'utf8' });
  const rows = new Map<string, { state: string; readings: string }>();
  for (const line of out.split('\n').filter((l) => l !== '')) {
    const [wt = '', state = '', pid = '', code = '', ...readings] = line.split('\t');
    rows.set(wt, { state: [state, pid, code].join('\t'), readings: readings.join('\t') });
  }
  return rows;
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DE = {
  days: ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'],
  months: ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'],
};
const FR = {
  days: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
  months: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
};

const two = (n: number): string => String(n).padStart(2, '0');
const clock = (d: Date): string => `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;

/** Epoch seconds as `ps -o lstart=` prints them in the C locale. */
const cLstart = (seconds: number): string => {
  const d = new Date(seconds * 1000);
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${clock(d)} ${d.getFullYear()}`;
};

/** Epoch seconds as macOS `ps -o lstart=` prints them under a German or French locale. */
const localLstart = (seconds: number, names: typeof DE): string => {
  const d = new Date(seconds * 1000);
  return `${names.days[d.getDay()]} ${String(d.getDate()).padStart(2)} ${names.months[d.getMonth()]} ${clock(d)} ${d.getFullYear()}`;
};

/** Epoch seconds as a manifest `startedAt`. */
const iso = (seconds: number): string => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Whether this machine has a locale installed. */
const hasLocale = (locale: string): boolean => {
  const listed = spawnSync('locale', ['-a'], { encoding: 'utf8' });
  return listed.status === 0 && listed.stdout.split('\n').some((l) => l.toLowerCase().replace(/[-_]/g, '') === locale.toLowerCase().replace(/[-_]/g, ''));
};

describe('readWorkerReadings agrees with plot-worker-state.sh on this estate', () => {
  let desks: AgentStateRow[];
  const found: Disagreement[] = [];

  beforeAll(async () => {
    desks = readDesks({ root: ROOT });
    const table = await processesTable().read();
    if (!table.ok) throw new Error(`ps exited ${table.code}`);
    const io = await deskFilesIo(context)();
    for (const desk of desks) {
      const gathered = await readWorkerReadings(desk.worktree, table.rows, io, {}, true);
      compareField(found, desk.name, 'readings', readingsLine(gathered), desk.readings);
      compareField(found, desk.name, 'state', processReadingOf(gathered, false).state, desk.state);
    }
  }, 120_000);

  it('reads a corpus worth comparing', () => {
    expect(desks.length).toBeGreaterThan(0);
  });

  it('gathers every field and decides every state as the shell does', () => {
    expect(found.map(report)).toEqual([]);
  });
});

describe('the reader agrees with plot-worker-state.sh on constructed desks', () => {
  const made = mkdtempSync(join(tmpdir(), 'plot-worker-readings-'));
  const root = realpathSync(made);
  const manifests = join(root, 'manifests');
  const children: ChildProcess[] = [];
  const desks = new Map<string, string>();
  const readingsFound: Disagreement[] = [];
  const statesFound: Disagreement[] = [];
  const states = new Map<string, string>();
  const savedGrace = process.env.PLOT_AGENT_GRACE_SECONDS;

  /** Starts a process that outlives the read; `sh -c` keeps a wrapper above an agent named `claude`. */
  const start = (command: string, args: readonly string[]): number => {
    const child = spawn(command, [...args], { stdio: 'ignore' });
    children.push(child);
    if (child.pid === undefined) throw new Error(`could not start ${command}`);
    return child.pid;
  };

  const desk = (name: string, files: Record<string, string>, manifest?: Record<string, string>): string => {
    const worktree = join(root, 'desks', name);
    mkdirSync(worktree, { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(join(worktree, file), text);
    if (manifest !== undefined) {
      const body = Object.entries({ session: name, worktree, ...manifest }).map(([k, v]) => `  "${k}": "${v}"`);
      writeFileSync(join(manifests, `${name}.json`), `{\n${body.join(',\n')}\n}\n`);
    }
    desks.set(name, worktree);
    return worktree;
  };

  beforeAll(async () => {
    mkdirSync(manifests, { recursive: true });
    const agentBinary = join(root, 'claude');
    // A symlink, not a copy: macOS kills a copied platform binary at exec.
    symlinkSync(realpathSync('/bin/sleep'), agentBinary);

    const dead = spawnSync('true').pid ?? 999_999;
    const reused = start('sleep', ['600']);
    const plain = start('sleep', ['600']);
    const orphan = start('sleep', ['600']);
    const withAgent = start('sh', ['-c', `'${agentBinary}' 600; :`]);
    const freeProven = start('sleep', ['600']);
    const freeUnproven = start('sleep', ['600']);
    await wait(8_500);
    const young = start('sleep', ['600']);
    await wait(5_000);

    desk('no-manifest', { '.plot-worker.pid': `${plain}\n` });
    desk('reused-pid', {}, { pid: String(reused), startedAt: '2026-01-05T09:00:00Z', pidStartedAt: 'Mon Jan  5 10:00:00 2026' });
    desk('orphan-past-grace', { '.plot-worker.pid': `${orphan}\n`, '.plot-worker.wrapper.pid': `${orphan}\n` });
    desk('agent-present', { '.plot-worker.pid': `${withAgent}\n`, '.plot-worker.wrapper.pid': `${withAgent}\n` });
    desk('wrapper-5s-no-agent', { '.plot-worker.pid': `${young}\n`, '.plot-worker.wrapper.pid': `${young}\n` });
    desk('exit-abc', { '.plot-worker.pid': `${dead}\n`, '.plot-worker.exit': 'abc\n' });
    desk(
      'free-wait-proven',
      { '.plot-worker.wrapper.pid': `${freeProven}\n`, '.plot-worker.freewait': `${freeProven}\n` },
      { pid: String(freeProven), startedAt: '2026-01-01T00:00:00Z' },
    );
    desk('free-wait-unproven', {
      '.plot-worker.pid': `${freeUnproven}\n`,
      '.plot-worker.wrapper.pid': `${freeUnproven}\n`,
      '.plot-worker.freewait': `${freeUnproven}\n`,
    });

    process.env.PLOT_AGENT_GRACE_SECONDS = GRACE;
    const files = processesFiles(context, { manifestDir: manifests, tableHoldMs: 600_000 });
    const held = await files.table();
    if (!isAnswered(held)) throw new Error('the process table could not be read');

    const late = start('sleep', ['600']);
    const lateStart = execFileSync('ps', ['-o', 'lstart=', '-p', String(late)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' });
    desk('pid-after-table', {}, { pid: String(late), startedAt: iso(Math.floor(Date.now() / 1000) - 60), pidStartedAt: lateStart.trim() });

    const io = await deskFilesIo(context, { manifestDir: manifests })();
    const gathered = new Map<string, string>();
    for (const [name, worktree] of desks) {
      gathered.set(name, readingsLine(await readWorkerReadings(worktree, held.value, io, {}, true)));
      const reading = await files.workerState(worktree, false);
      if (!isAnswered(reading)) throw new Error(`${name}: no worker state`);
      states.set(name, [reading.value.state, reading.value.pid, reading.value.exitCode].join('\t'));
    }
    const shell = shellDesks([...desks.values()], shellEnv(manifests));
    for (const [name, worktree] of desks) {
      compareField(readingsFound, name, 'readings', gathered.get(name), shell.get(worktree)?.readings);
      compareField(statesFound, name, 'state', states.get(name), shell.get(worktree)?.state);
    }
  }, 90_000);

  afterAll(async () => {
    if (savedGrace === undefined) delete process.env.PLOT_AGENT_GRACE_SECONDS;
    else process.env.PLOT_AGENT_GRACE_SECONDS = savedGrace;
    for (const child of children) child.kill('SIGKILL');
    for (const child of children) spawnSync('pkill', ['-KILL', '-P', String(child.pid)]);
    rmSync(made, { recursive: true, force: true });
  });

  it('builds the constructed desks', () => {
    expect(desks.size).toBe(9);
  });

  it('gathers every field the shell prints, on every constructed desk', () => {
    expect(readingsFound.map(report)).toEqual([]);
  });

  it('answers the state, pid and code the shell answers, on every constructed desk', () => {
    expect(statesFound.map(report)).toEqual([]);
  });

  it('answers the cases the readings alone pass over', () => {
    expect(states.get('free-wait-proven')?.split('\t')[0]).toBe('running');
    expect(states.get('wrapper-5s-no-agent')?.split('\t')[0]).toBe('running');
    expect(states.get('pid-after-table')?.split('\t')[0]).toBe('running');
    expect(states.get('agent-present')?.split('\t')[0]).toBe('running');
    expect(states.get('orphan-past-grace')?.split('\t')[0]).toBe('finished');
    expect(states.get('reused-pid')?.split('\t')[0]).toBe('ended');
    expect(states.get('exit-abc')).toBe(`ended\t${states.get('exit-abc')?.split('\t')[1]}\t`);
  });
});

describe('pidIsCurrent agrees with plot_pid_is_current', () => {
  let live: ChildProcess;
  let startSeconds = 0;
  let startMs: number | null = null;

  /** `plot_pid_is_current` for each recorded pair, under one locale: `0` current, `1` stale. */
  const shellAnswers = (pairs: ReadonlyArray<readonly [string, string]>, locale: string): string[] => {
    const program = ['. "$1"; pid=$2; shift 2', 'while [ "$#" -gt 0 ]; do', '  plot_pid_is_current "$pid" "$1" "$2"; echo $?; shift 2', 'done'].join('\n');
    const out = execFileSync('bash', ['-c', program, 'bash', STATE_LIB, String(live.pid), ...pairs.flat()], {
      cwd: ROOT,
      env: { ...process.env, LC_ALL: locale, LANG: locale },
      encoding: 'utf8',
    });
    return out.split('\n').filter((l) => l !== '');
  };

  /** `_plot_lstart_epoch` for each text, under one locale; `''` where it reads nothing. */
  const shellEpochs = (texts: readonly string[], locale: string): string[] => {
    const program = ['. "$1"; shift', 'for t in "$@"; do printf "%s\\n" "$(_plot_lstart_epoch "$t")"; done'].join('\n');
    return execFileSync('bash', ['-c', program, 'bash', STATE_LIB, ...texts], {
      cwd: ROOT,
      env: { ...process.env, LC_ALL: locale, LANG: locale },
      encoding: 'utf8',
    })
      .split('\n')
      .slice(0, texts.length);
  };

  beforeAll(async () => {
    live = spawn('sleep', ['600'], { stdio: 'ignore' });
    await wait(200);
    const read = await processesTable().read();
    if (!read.ok) throw new Error(`ps exited ${read.code}`);
    const row: ProcessRow | undefined = read.rows.find((r) => r.pid === live.pid);
    startMs = row?.startedAt ?? null;
    startSeconds = Math.floor((startMs ?? 0) / 1000);
  });

  afterAll(() => {
    live.kill('SIGKILL');
  });

  /** Twelve recorded pairs, each `[startedAt, pidStartedAt]`, named. */
  const pairs = (): Array<[string, readonly [string, string]]> => {
    const s = startSeconds;
    return [
      ['own start equal', ['', cLstart(s)]],
      ['own start 3 s later', ['', cLstart(s + 3)]],
      ['own start 3 s earlier', ['', cLstart(s - 3)]],
      ['own start 4 s later', ['', cLstart(s + 4)]],
      ['own start 4 s earlier', ['', cLstart(s - 4)]],
      ['a reused pid: own start a day earlier', ['', cLstart(s - 86_400)]],
      ['missing pidStartedAt: stamp equal', [iso(s), '']],
      ['missing pidStartedAt: stamp 3 s later', [iso(s + 3), '']],
      ['missing pidStartedAt: stamp 4 s later', [iso(s + 4), '']],
      ['missing pidStartedAt: stamp a day earlier', [iso(s - 86_400), '']],
      ['own start wins over a later stamp', [iso(s + 3_600), cLstart(s)]],
      ['an unreadable stamp and no own start', ['yesterday', '']],
    ];
  };

  it('answers the shell\'s answer on 12 recorded pairs', () => {
    const rows = pairs();
    expect(rows).toHaveLength(12);
    const shell = shellAnswers(rows.map(([, pair]) => pair), 'C');
    const found: Disagreement[] = [];
    rows.forEach(([name, [startedAt, pidStartedAt]], at) => {
      const reader = pidIsCurrent({ startedAt, pidStartedAt }, startMs) ? '0' : '1';
      compareField(found, name, 'current', reader, shell[at]);
    });
    expect(found.map(report)).toEqual([]);
  });

  for (const [locale, names] of [
    ['de_CH.UTF-8', DE],
    ['fr_FR.UTF-8', FR],
  ] as const) {
    describe.runIf(process.platform === 'darwin' && hasLocale(locale))(`localized recorded starts, ${locale}`, () => {
      /** The 2nd to 10th of each month of 2026 at 12:14:40, as macOS prints them. */
      const texts = (): string[] =>
        Array.from({ length: 12 }, (_, m) => localLstart(Math.floor(new Date(2026, m, (m % 9) + 2, 12, 14, 40).getTime() / 1000), names));

      it('reads every month as _plot_lstart_epoch reads it in the recording locale', () => {
        const all = texts();
        const shell = shellEpochs(all, locale);
        const found: Disagreement[] = [];
        all.forEach((text, at) => {
          const ms = lstartMs(text);
          compareField(found, text, 'epoch', ms === null ? '' : String(Math.floor(ms / 1000)), shell[at]);
        });
        expect(found.map(report)).toEqual([]);
      });

      it('declares the divergence: the shell under LC_ALL=C reads no localized month', () => {
        expect(shellEpochs(texts(), 'C').every((epoch) => epoch === '')).toBe(true);
        expect(texts().every((text) => lstartMs(text) !== null)).toBe(true);
      });

      it('takes a localized own start of the live pid as current, as the shell does in the recording locale', () => {
        const pair = ['', localLstart(startSeconds, names)] as const;
        expect(shellAnswers([pair], locale)).toEqual(['0']);
        expect(pidIsCurrent({ startedAt: pair[0], pidStartedAt: pair[1] }, startMs)).toBe(true);
      });
    });
  }
});
