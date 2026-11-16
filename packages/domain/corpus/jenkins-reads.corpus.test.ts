import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildJenkins } from '../src/adapters/build/build-jenkins.js';
import { jenkinsApi, jenkinsReads } from '../src/adapters/build/jenkins-api.js';
import { budgetFile } from '../src/adapters/budget/budget-file.js';
import { shellContext } from '../src/adapters/scripts.js';
import { slotsFile } from '../src/adapters/slots/slots-file.js';
import type { CiBuildMap } from '../src/rules/ci-build-map.js';
import type { PortResult } from '../src/port-result.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Do the in-process Jenkins reads and `plot-host.sh` answer alike from one
 * recorded Jenkins?
 *
 * `corpus/record-jenkins-reads.mjs` ran `jenkins_build_map` and
 * `plot-host.sh runs` / `runs-for-sha` with the real `jen`, pointed at a stub
 * Jenkins, and recorded each answer the stub gave and each `jen` call (argv,
 * stdout, stderr, exit code). This test serves the same answers to
 * `jenkinsReads` and `buildJenkins(context, client)` over a stub HTTP server,
 * and replays the `jen` calls to the shell side through a stub `jen` on
 * `PATH`. `rules/ci-build-map.ts` and `rules/ci-sha-runs.ts` are declared
 * duplicates of the jq programs in `plot-host.sh`; neither side is
 * authoritative, and a disagreement stops the branch.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const FIXTURES = join(ROOT, 'packages/domain/corpus/fixtures/jenkins-reads');
const report = describingAs({ left: 'in-process', right: 'shell' });

interface Route {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: { builds?: unknown[] } & Record<string, unknown>;
  readonly text?: string;
  readonly destroy?: boolean;
}

interface Call {
  readonly argv: string[];
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

interface Op {
  readonly op: string;
  readonly branch?: string;
  readonly sha?: string;
  readonly limit?: number;
  readonly calls: Call[];
}

interface Scenario {
  readonly name: string;
  readonly kind: 'map' | 'runs';
  readonly job: string;
  readonly routes: Record<string, Route>;
  readonly ops: Op[];
}

interface Recording {
  readonly jen: string;
  readonly scenarios: Scenario[];
}

interface Stub {
  readonly port: number;
  readonly seen: string[];
  close(): Promise<void>;
}

/** A normalised answer: the class of the result, and its value where it answered. */
interface Said {
  readonly klass: 'answered' | 'failed' | 'unaskable';
  readonly value: unknown;
}

interface Pair {
  readonly scenario: Scenario;
  readonly op: Op;
  readonly inProcess: Said;
  readonly shell: Said;
  readonly otherHits: number;
}

const recording = JSON.parse(readFileSync(join(FIXTURES, 'reads.json'), 'utf8')) as Recording;
let sandbox = '';
let pairs: Pair[] = [];
let withheld: { clientStarts: number; scriptStarts: number } = { clientStarts: -1, scriptStarts: -1 };

/** Serves a scenario's routes on loopback under `/jenkins`, honouring the builds window and logging each request. */
const serve = async (routes: Record<string, Route>, fill: (text: string) => string): Promise<Stub> => {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    const url = req.url ?? '';
    seen.push(url);
    const route = routes[url.split('?')[0]?.replace(/^\/jenkins/, '') ?? ''];
    if (route === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<html>not found</html>');
      return;
    }
    if (route.destroy === true) {
      req.socket.destroy();
      return;
    }
    const headers = Object.fromEntries(Object.entries(route.headers ?? {}).map(([k, v]) => [k, fill(v)]));
    let text = route.text ?? JSON.stringify(route.body ?? {});
    const window = /%7B0,(\d+)%7D/.exec(url) ?? /\{0,(\d+)\}/.exec(url);
    if (route.body !== undefined && Array.isArray(route.body.builds) && window !== null) {
      text = JSON.stringify({ ...route.body, builds: route.body.builds.slice(0, Number(window[1])) });
    }
    res.writeHead(route.status ?? 200, { 'Content-Type': route.text === undefined ? 'application/json' : 'text/html', ...headers });
    res.end(fill(text));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

/** A stub `jen` that replays the recorded output for the recorded argv, and fails on any other argv. */
const stubJen = (dir: string, calls: readonly Call[], port: number): void => {
  calls.forEach((call, i) => {
    writeFileSync(join(dir, `call-${String(i)}.argv`), `${call.argv.join('\n')}\n`);
    writeFileSync(join(dir, `call-${String(i)}.out`), call.stdout.replaceAll('{{PORT}}', String(port)));
    writeFileSync(join(dir, `call-${String(i)}.err`), call.stderr.replaceAll('{{PORT}}', String(port)));
    writeFileSync(join(dir, `call-${String(i)}.code`), String(call.code));
  });
  writeFileSync(
    join(dir, 'jen'),
    [
      '#!/usr/bin/env bash',
      `dir=${JSON.stringify(dir)}`,
      'printf \'%s\\n\' "$@" > "$dir/asked"',
      'for f in "$dir"/call-*.argv; do',
      '  if cmp -s "$f" "$dir/asked"; then b="${f%.argv}"; cat "$b.out"; cat "$b.err" >&2; exit "$(cat "$b.code")"; fi',
      'done',
      'echo "stub jen: unrecorded argv: $*" >&2',
      'exit 1',
      '',
    ].join('\n'),
  );
  chmodSync(join(dir, 'jen'), 0o755);
};

/** A stub `plot-host.sh` that counts its starts and answers nothing. */
const sentinelScripts = (dir: string): string => {
  const scripts = join(dir, 'scripts');
  mkdirSync(scripts);
  writeFileSync(join(scripts, 'starts'), '');
  return scripts;
};

/** Runs a command to its end without blocking the event loop, which the stub servers in this process need. */
const runShell = (script: string, env: NodeJS.ProcessEnv): Promise<string> =>
  new Promise((resolve) => {
    const child = spawn('bash', ['-c', script], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });

/** The named function lifted out of `plot-host.sh`. */
const lifted = (name: string): string => {
  const lines = readFileSync(join(ROOT, 'skills/plot/scripts/plot-host.sh'), 'utf8').split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${name}() {`));
  const end = lines.findIndex((line, i) => i > start && line === '}');
  if (start < 0 || end < 0) throw new Error(`could not lift ${name}`);
  return lines.slice(start, end + 1).join('\n');
};

/** Runs one block with `process.env` set, and puts it back after. */
const withEnv = async <T>(set: Record<string, string>, block: () => Promise<T>): Promise<T> => {
  const saved = Object.fromEntries(Object.keys(set).map((name) => [name, process.env[name]]));
  Object.assign(process.env, set);
  try {
    return await block();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

const said = <T>(result: PortResult<T>): Said =>
  result.ok ? { klass: 'answered', value: result.value } : { klass: result.why, value: null };

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-jenkins-reads-corpus-'));
  pairs = [];
  for (const scenario of recording.scenarios) {
    const other = await serve({}, (text) => text);
    let port = 0;
    const fill = (text: string): string => text.replaceAll('{{ORIGIN}}', `http://127.0.0.1:${String(port)}`).replaceAll('{{OTHER}}', `http://127.0.0.1:${String(other.port)}`);
    const main = await serve(scenario.routes, fill);
    port = main.port;
    try {
      for (const [index, op] of scenario.ops.entries()) {
        const dir = join(sandbox, `${scenario.name}-${String(index)}`);
        mkdirSync(dir);
        const jenDir = join(dir, 'bin');
        mkdirSync(jenDir);
        stubJen(jenDir, op.calls, main.port);
        const home = join(dir, 'home');
        mkdirSync(home);
        const env = { JEN_URL: `http://127.0.0.1:${String(main.port)}/jenkins`, JEN_CONFIG_DIR: home, HOME: home, JEN_TOKEN: 'fixture-bearer', JENKINS_USER: 'fixture', JENKINS_API_TOKEN: 'fixture-api-token', JEN_REALM_URL: 'https://id.example.org/realms/r' };
        const api = jenkinsApi({ instance: 'jenkins.example.org', env, budget: budgetFile({ home }), slots: slotsFile({ home, isAlive: () => true }), now: Date.now, pollMs: 20, tornReadMs: 20 });
        const before = other.seen.length;
        let inProcess: Said;
        let shell: Said;
        if (scenario.kind === 'map') {
          const map = await jenkinsReads(api).colourMap(scenario.job);
          inProcess = { klass: 'answered', value: map };
          const out = await runShell(`${lifted('jenkins_build_map')}\njenkins_build_map ${JSON.stringify(`jenkins.example.org/${scenario.job}`)}`, { ...process.env, ...env, PATH: `${jenDir}:${process.env.PATH ?? ''}` });
          shell = { klass: 'answered', value: JSON.parse(out.trim().split('\n').pop() ?? 'null') as CiBuildMap };
        } else {
          const ask = (client: typeof api | undefined): Promise<PortResult<unknown>> => {
            const port_ = buildJenkins(shellContext(ROOT), client);
            const branch = op.branch ?? '';
            if (op.op === 'runs') return port_.runs(branch, op.limit);
            if (op.op === 'runForSha') return port_.runForSha(branch, op.sha ?? '', op.limit);
            return port_.runsForSha(branch, op.sha ?? '');
          };
          const jobEnv = { JENKINS_INSTANCE: 'jenkins.example.org/team/portal', PLOT_BUDGET_OFF: '1', PLOT_UNATTENDED: '' };
          inProcess = said((await withEnv(jobEnv, () => ask(api))) as PortResult<unknown>);
          shell = said(
            (await withEnv({ ...jobEnv, PATH: `${jenDir}:${process.env.PATH ?? ''}`, JEN_URL: env.JEN_URL, JEN_CONFIG_DIR: home, HOME: home, JEN_TOKEN: env.JEN_TOKEN, JENKINS_USER: env.JENKINS_USER, JENKINS_API_TOKEN: env.JENKINS_API_TOKEN }, () => ask(undefined))) as PortResult<unknown>,
          );
        }
        pairs.push({ scenario, op, inProcess, shell, otherHits: other.seen.length - before });
      }
    } finally {
      await main.close();
      await other.close();
    }
  }

  // The both-directions row: a client starts no plot-host.sh, and no client starts one.
  const scripts = sentinelScripts(sandbox);
  const marker = join(scripts, 'starts');
  writeFileSync(
    join(scripts, 'plot-host.sh'),
    ['#!/usr/bin/env bash', `echo started >> ${JSON.stringify(marker)}`, 'echo "[]"', ''].join('\n'),
  );
  chmodSync(join(scripts, 'plot-host.sh'), 0o755);
  const sentinelContext = { ...shellContext(ROOT), scriptDir: scripts };
  const hold = await serve({ '/job/team/job/portal/job/main/api/json': { body: { builds: [] } } }, (text) => text);
  const home = join(sandbox, 'sentinel-home');
  mkdirSync(home);
  const api = jenkinsApi({
    instance: 'jenkins.example.org',
    env: { JEN_URL: `http://127.0.0.1:${String(hold.port)}/jenkins`, JEN_CONFIG_DIR: home, HOME: home, JEN_TOKEN: 'fixture-bearer', JENKINS_USER: 'fixture', JENKINS_API_TOKEN: 'fixture-api-token' },
    budget: budgetFile({ home }),
    slots: slotsFile({ home, isAlive: () => true }),
    now: Date.now,
    pollMs: 20,
    tornReadMs: 20,
  });
  const starts = (): number => readFileSync(marker, 'utf8').split('\n').filter((line) => line !== '').length;
  try {
    await withEnv({ JENKINS_INSTANCE: 'jenkins.example.org/team/portal', PLOT_BUDGET_OFF: '1' }, async () => {
      const port = buildJenkins(sentinelContext, api);
      await port.runs('main');
      await port.runForSha('main', 'a'.repeat(40));
      await port.runsForSha('main', 'a'.repeat(40));
    });
    const clientStarts = starts();
    await withEnv({ JENKINS_INSTANCE: 'jenkins.example.org/team/portal', PLOT_BUDGET_OFF: '1' }, async () => {
      await buildJenkins(sentinelContext).runs('main');
    });
    withheld = { clientStarts, scriptStarts: starts() - clientStarts };
  } finally {
    await hold.close();
  }
}, 600_000);

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

const mapsOf = (): Pair[] => pairs.filter((p) => p.scenario.kind === 'map');
const runsOf = (): Pair[] => pairs.filter((p) => p.scenario.kind === 'runs');

describe('the in-process Jenkins reads agree with plot-host.sh', () => {
  it('replays reads recorded with the jen version the fixtures name', () => {
    expect(recording.jen).toBe('jen 0.4.0');
    expect(mapsOf().length).toBeGreaterThanOrEqual(11);
    expect(runsOf().length).toBeGreaterThanOrEqual(30);
  });

  it('builds the same branch-to-checks map, entry by entry', () => {
    const found: Disagreement[] = [];
    for (const { scenario, inProcess, shell } of mapsOf()) {
      const mine = inProcess.value as CiBuildMap;
      const theirs = shell.value as CiBuildMap;
      compareField(found, scenario.name, 'status', mine.status, theirs.status);
      for (const branch of new Set([...Object.keys(mine.map), ...Object.keys(theirs.map)])) {
        const a = (mine.map[branch] ?? {}) as unknown as Record<string, unknown>;
        const b = (theirs.map[branch] ?? {}) as unknown as Record<string, unknown>;
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) compareField(found, `${scenario.name} [${branch}]`, key, a[key], b[key]);
      }
    }
    expect(found.map(report)).toEqual([]);
  });

  it('holds every map shape, so the comparison is not vacuous', () => {
    const by = (name: string): CiBuildMap => mapsOf().find((p) => p.scenario.name === name)?.shell.value as CiBuildMap;
    expect(by('map-multibranch').status).toBe('ok');
    expect(Object.keys(by('map-multibranch').map)).toContain('feature/a');
    expect(Object.keys(by('map-multibranch').map)).toContain('bug/foo bar');
    expect(new Set(Object.values(by('map-multibranch').map).map((entry) => entry.checks))).toEqual(new Set(['green', 'pending', 'failing', 'none']));
    expect(Object.keys(by('map-plain').map)).toEqual(['deploy']);
    expect(by('map-freestyle').status).toBe('unknown');
    expect(by('map-unreachable').status).toBe('failed');
    expect(by('map-transport-failure').status).toBe('failed');
  });

  it('answers a run read with the same result class on both sides', () => {
    const found: Disagreement[] = [];
    for (const { scenario, op, inProcess, shell } of runsOf()) {
      compareField(found, `${scenario.name} ${op.op}`, 'result', inProcess.klass, shell.klass);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('picks the same runs, in the same order, field by field', () => {
    const found: Disagreement[] = [];
    for (const { scenario, op, inProcess, shell } of runsOf()) {
      if (inProcess.klass !== 'answered' || shell.klass !== 'answered') continue;
      const mine = (Array.isArray(inProcess.value) ? inProcess.value : [inProcess.value]) as Record<string, unknown>[];
      const theirs = (Array.isArray(shell.value) ? shell.value : [shell.value]) as Record<string, unknown>[];
      compareField(found, `${scenario.name} ${op.op}`, 'count', mine.length, theirs.length);
      theirs.forEach((run, i) => {
        const other = mine[i] ?? {};
        for (const key of new Set([...Object.keys(run ?? {}), ...Object.keys(other)])) {
          compareField(found, `${scenario.name} ${op.op} [${String(i)}]`, key, other[key], (run ?? {})[key]);
        }
      });
    }
    expect(found.map(report)).toEqual([]);
  });

  it('holds the shapes the pick reads, so the comparison is not vacuous', () => {
    const answered = runsOf().filter((p) => p.shell.klass === 'answered');
    const runs = answered.flatMap((p) => (Array.isArray(p.shell.value) ? (p.shell.value as Record<string, unknown>[]) : []));
    const conclusions = new Set(runs.map((run) => run.conclusion));
    expect(conclusions).toEqual(new Set(['FAILURE', 'SUCCESS', 'in_progress', null, 'success']));
    const by = (name: string, op: string): Pair | undefined => runsOf().find((p) => p.scenario.name === name && p.op.op === op);
    expect((by('runs-rebuild-of-one-commit', 'runsForSha')?.shell.value as unknown[]).length).toBe(1);
    expect((by('runs-many-aborted', 'runs')?.shell.value as unknown[]).length).toBeGreaterThan(0);
    expect(by('runs-never-indexed-multibranch', 'runs')?.shell.klass).toBe('answered');
    for (const name of ['runs-transport-failure', 'runs-html', 'runs-oauth-redirect', 'runs-third-host-redirect', 'runs-forbidden']) {
      expect(by(name, 'runsForSha')?.shell.klass, name).not.toBe('answered');
    }
  });

  it('sends nothing to a third host a redirect names', () => {
    const redirected = pairs.filter((p) => p.scenario.name.endsWith('third-host-redirect'));
    expect(redirected.length).toBeGreaterThanOrEqual(2);
    for (const { scenario, otherHits } of redirected) expect(otherHits, scenario.name).toBe(0);
  });

  it('starts no plot-host.sh for a read given the client, and starts one for a read without it', () => {
    expect(withheld).toEqual({ clientStarts: 0, scriptStarts: 1 });
  });
});
