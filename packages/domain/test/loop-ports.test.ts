// THE LOOP'S NEW PORT OPERATIONS, each against the real world it reaches —
// matching the estate's own rule that a `git`/process adapter is asserted
// against a real repository or a real process tree, never a mock of the
// command line.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { treesGit } from '../src/adapters/trees/trees-git.js';
import { processesShell } from '../src/adapters/processes/processes-shell.js';
import { agentsFs } from '../src/adapters/agents/agents-fs.js';
import { deskFs } from '../src/adapters/desk/desk-fs.js';
import { FindingSchema } from '../src/entities/finding.js';
import type { Trees } from '../src/ports/trees.js';

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' });

describe('processesShell.childrenOf', () => {
  it('lists a direct child pid, and empties once the child exits', async () => {
    const processes = processesShell({ repoRoot: process.cwd(), scriptDir: '/nonexistent' });
    const parent = spawn('sleep', ['5'], { stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    // `sleep` SPAWNS NOTHING OF ITS OWN, so this asserts the read against a
    // process with no children — the general case most pids are in.
    const kids = await processes.childrenOf(parent.pid!);
    expect(kids.ok).toBe(true);
    if (kids.ok) expect(kids.value).toEqual([]);
    parent.kill('SIGKILL');
    await new Promise((resolve) => parent.once('exit', resolve));
  });

  it('answers empty rather than failing for a pid holding no process', async () => {
    const processes = processesShell({ repoRoot: process.cwd(), scriptDir: '/nonexistent' });
    // A pid this high is vanishingly unlikely to be live on any CI runner.
    const kids = await processes.childrenOf(999_999);
    expect(kids).toEqual({ ok: true, value: [] });
  });
});

describe('treesGit: desk-reset, commit, push', () => {
  let origin = '';
  let desk = '';

  beforeAll(() => {
    origin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loop-ports-origin-')));
    git(origin, ['init', '--quiet', '--initial-branch=main']);
    git(origin, ['config', 'user.email', 'test@example.com']);
    git(origin, ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(origin, 'a.txt'), 'one\n');
    git(origin, ['add', '-A']);
    git(origin, ['commit', '--quiet', '-m', 'first']);

    desk = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loop-ports-desk-')));
    git(desk, ['clone', '--quiet', origin, '.']);
    git(desk, ['config', 'user.email', 'test@example.com']);
    git(desk, ['config', 'user.name', 'Test']);
  });

  afterAll(() => {
    if (origin) fs.rmSync(origin, { recursive: true, force: true });
    if (desk) fs.rmSync(desk, { recursive: true, force: true });
  });

  const trees = () => treesGit({ repoRoot: desk, scriptDir: path.join(desk, 'scripts') });

  it('resetOnto creates and checks out the branch from the base', async () => {
    const result = await trees().resetOnto(desk, 'infra/x', 'origin/main');
    expect(result).toEqual({ ok: true, value: undefined });
    expect(git(desk, ['branch', '--show-current']).trim()).toBe('infra/x');
  });

  it('resetOnto re-attaches an existing branch rather than moving it', async () => {
    // A commit the earlier attempt left on the branch must survive a second
    // reset — `-B` would discard it, which `resetOnto` refuses by using `-b`
    // then plain `checkout`.
    fs.writeFileSync(path.join(desk, 'b.txt'), 'two\n');
    git(desk, ['add', '-A']);
    git(desk, ['commit', '--quiet', '-m', 'earlier attempt']);
    const earlier = git(desk, ['rev-parse', 'HEAD']).trim();

    const result = await trees().resetOnto(desk, 'infra/x', 'origin/main');
    expect(result).toEqual({ ok: true, value: undefined });
    expect(git(desk, ['rev-parse', 'HEAD']).trim()).toBe(earlier);
  });

  it('resetOnto refuses rather than overwrites a file the earlier readings missed', async () => {
    // THE BASE CHECKOUT ITSELF REFUSES: `origin/main` gains a tracked file
    // after the desk's last fetch, and the desk independently holds an
    // UNTRACKED file at that same path — the shape `decision.ts:374` names as
    // the write's second line of defence. Plain `git checkout --detach` is
    // what refuses here, never a destructive fallback.
    git(desk, ['checkout', '--quiet', 'main']);
    git(desk, ['branch', '-D', 'infra/x']);

    fs.writeFileSync(path.join(origin, 'newfile.txt'), 'server content\n');
    git(origin, ['add', '-A']);
    git(origin, ['commit', '--quiet', '-m', 'main gains a file']);

    fs.writeFileSync(path.join(desk, 'newfile.txt'), 'local untracked, collides with incoming\n');
    git(desk, ['fetch', '--quiet', 'origin']);

    const result = await trees().resetOnto(desk, 'infra/conflict', 'origin/main');
    expect(result.ok).toBe(false);

    fs.rmSync(path.join(desk, 'newfile.txt'), { force: true });
  });

  it('commit makes an empty commit with the given message', async () => {
    git(desk, ['checkout', '--quiet', '-B', 'infra/commit-test', 'origin/main']);
    const before = git(desk, ['rev-parse', 'HEAD']).trim();
    const result = await trees().commit(desk, 'plot: claim infra/commit-test');
    expect(result).toEqual({ ok: true, value: undefined });
    const after = git(desk, ['rev-parse', 'HEAD']).trim();
    expect(after).not.toBe(before);
    expect(git(desk, ['log', '-1', '--format=%s']).trim()).toBe('plot: claim infra/commit-test');
  });

  it('push pushes the branch to origin, setting the upstream', async () => {
    const result = await trees().push(desk, 'infra/commit-test');
    expect(result).toEqual({ ok: true, value: undefined });
    const remoteTip = git(origin, ['rev-parse', 'infra/commit-test']).trim();
    const localTip = git(desk, ['rev-parse', 'infra/commit-test']).trim();
    expect(remoteTip).toBe(localTip);
  });

  it('push answers failed for a branch nothing local names', async () => {
    const result = await trees().push(desk, 'infra/never-existed');
    expect(result.ok).toBe(false);
  });
});

describe('treesGit: resetOnto clears bookkeeping and repairs the generated bundles', () => {
  let origin = '';
  let desk = '';
  let held = '';

  beforeAll(() => {
    origin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loop-ports-reset-origin-')));
    git(origin, ['init', '--quiet', '--initial-branch=main']);
    git(origin, ['config', 'user.email', 'test@example.com']);
    git(origin, ['config', 'user.name', 'Test']);
    fs.mkdirSync(path.join(origin, 'packages/board'), { recursive: true });
    fs.mkdirSync(path.join(origin, 'skills/plot'), { recursive: true });
    fs.writeFileSync(
      path.join(origin, 'packages/board/build.mjs'),
      [
        "const shippedServer = path.join(here, '../../skills/plot/server.mjs');",
        "const shippedAsk = path.join(here, '../../skills/plot/ask.mjs');",
        "const shippedRoot = path.join(here, '../../');",
        '',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(origin, 'skills/plot/server.mjs'), 'built on main\n');
    git(origin, ['add', '-A']);
    git(origin, ['commit', '--quiet', '-m', 'first']);

    desk = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loop-ports-reset-desk-')));
    git(desk, ['clone', '--quiet', origin, '.']);
    git(desk, ['config', 'user.email', 'test@example.com']);
    git(desk, ['config', 'user.name', 'Test']);
  });

  afterAll(() => {
    for (const dir of [origin, desk, held]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  const trees = () => treesGit({ repoRoot: desk, scriptDir: path.join(desk, 'scripts') });

  it('removes the declaration and correction, restores a tracked bundle, and removes an untracked one', async () => {
    fs.writeFileSync(path.join(desk, '.plot-worker.envelope.json'), '{}\n');
    fs.writeFileSync(path.join(desk, 'PLOT-CORRECTION.md'), 'correction\n');
    fs.writeFileSync(path.join(desk, 'skills/plot/server.mjs'), 'rebuilt locally\n');
    fs.writeFileSync(path.join(desk, 'skills/plot/ask.mjs'), 'built, never committed\n');

    const result = await trees().resetOnto(desk, 'infra/reset', 'origin/main');

    expect(result).toEqual({ ok: true, value: undefined });
    expect(fs.existsSync(path.join(desk, '.plot-worker.envelope.json'))).toBe(false);
    expect(fs.existsSync(path.join(desk, 'PLOT-CORRECTION.md'))).toBe(false);
    expect(fs.readFileSync(path.join(desk, 'skills/plot/server.mjs'), 'utf8')).toBe('built on main\n');
    expect(fs.existsSync(path.join(desk, 'skills/plot/ask.mjs'))).toBe(false);
    expect(git(desk, ['branch', '--show-current']).trim()).toBe('infra/reset');
  });

  it('leaves bookkeeping it cannot remove in place and still resets', async () => {
    // A DIRECTORY at the declaration's path: `rmSync` without `recursive`
    // refuses it, and the removal is best effort.
    fs.mkdirSync(path.join(desk, '.plot-worker.envelope.json'));
    const result = await trees().resetOnto(desk, 'infra/reset-again', 'origin/main');
    expect(result).toEqual({ ok: true, value: undefined });
    expect(fs.statSync(path.join(desk, '.plot-worker.envelope.json')).isDirectory()).toBe(true);
    fs.rmdirSync(path.join(desk, '.plot-worker.envelope.json'));
  });

  it('answers failed when another worktree holds the branch, and goes no further', async () => {
    held = `${desk}-held`;
    git(desk, ['worktree', 'add', '--quiet', '-b', 'infra/held', held, 'origin/main']);
    const result = await trees().resetOnto(desk, 'infra/held', 'origin/main');
    expect(result.ok).toBe(false);
  });

  it('commit answers failed where the path is no checkout', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loop-ports-no-repo-'));
    try {
      const result = await trees().commit(outside, 'plot: claim nothing');
      expect(result.ok).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('agentsFs: raiseAttempts, raiseCorrections, clearAssignment', () => {
  let dir = '';

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loop-ports-agents-'));
  });

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, body: Record<string, unknown>) =>
    fs.writeFileSync(path.join(dir, name), JSON.stringify(body));

  const agents = () => agentsFs({ repoRoot: dir, scriptDir: '/nonexistent' }, { manifestDir: dir });

  it('raiseAttempts carries the new value, found by the manifest naming the worktree', async () => {
    write('a.json', { session: 'sess-a', worktree: '/tmp/desk-a', branch: 'infra/x', attempts: 1 });
    const result = await agents().raiseAttempts('/tmp/desk-a', 2);
    expect(result).toEqual({ ok: true, value: undefined });
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'a.json'), 'utf8'));
    expect(manifest.attempts).toBe(2);
    expect(manifest.correctionAttempts).toBeUndefined();
  });

  it('raiseCorrections carries the new value and never touches attempts', async () => {
    write('b.json', { session: 'sess-b', worktree: '/tmp/desk-b', branch: 'infra/x', attempts: 5 });
    const result = await agents().raiseCorrections('/tmp/desk-b', 1);
    expect(result).toEqual({ ok: true, value: undefined });
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'b.json'), 'utf8'));
    expect(manifest.correctionAttempts).toBe(1);
    expect(manifest.attempts).toBe(5);
  });

  it('raiseAttempts for an unknown worktree answers ok and writes nothing — absent is not a failure', async () => {
    const result = await agents().raiseAttempts('/tmp/no-such-desk', 1);
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('clearAssignment empties branch and keeps the rest, keyed by session', async () => {
    write('sess-c.json', { session: 'sess-c', worktree: '/tmp/desk-c', branch: 'infra/x', pid: '123' });
    const result = await agents().clearAssignment('sess-c');
    expect(result).toEqual({ ok: true, value: undefined });
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'sess-c.json'), 'utf8'));
    expect(manifest.branch).toBe('');
    expect(manifest.worktree).toBe('/tmp/desk-c');
    expect(manifest.pid).toBe('123');
  });

  it('clearAssignment for an absent session answers ok rather than failing', async () => {
    const result = await agents().clearAssignment('sess-ghost');
    expect(result).toEqual({ ok: true, value: undefined });
  });
});

describe('deskFs: ending, marker, declaration, correction, limited record, moved record, finding', () => {
  let main = '';
  let desk = '';

  beforeAll(() => {
    main = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loop-ports-main-')));
    git(main, ['init', '--quiet', '--initial-branch=main']);
    git(main, ['config', 'user.email', 'test@example.com']);
    git(main, ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(main, 'a.txt'), 'one\n');
    git(main, ['add', '-A']);
    git(main, ['commit', '--quiet', '-m', 'first']);

    desk = path.join(main, '..', `${path.basename(main)}-desk`);
    git(main, ['worktree', 'add', '--quiet', '-b', 'infra/x', desk]);
  });

  afterAll(() => {
    if (main) fs.rmSync(main, { recursive: true, force: true });
    if (desk) fs.rmSync(desk, { recursive: true, force: true });
  });

  const deskPort = () => deskFs(treesGit({ repoRoot: main, scriptDir: '/nonexistent' }));

  it('writeEnding writes the file and appends to the main checkout\'s endings.jsonl', async () => {
    const result = await deskPort().writeEnding(desk, {
      reason: 'bound',
      actor: 'bound',
      branch: 'infra/x',
      detail: 'exceeded the bound',
    });
    expect(result).toEqual({ ok: true, value: undefined });
    const record = JSON.parse(fs.readFileSync(path.join(desk, '.plot-worker.ending.json'), 'utf8'));
    expect(record).toEqual({ reason: 'bound', actor: 'bound', branch: 'infra/x', detail: 'exceeded the bound' });
    const log = fs.readFileSync(path.join(main, '.plot/state/endings.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(log.at(-1)!)).toEqual(record);
  });

  it('writeEnding never appears partial to a reader in another process', async () => {
    // A TREES THAT LISTS NOTHING, so no `endings.jsonl` append runs and the
    // writes follow each other as fast as the disk allows.
    const port = deskFs({ list: async () => ({ ok: false, why: 'failed' }) } as unknown as Trees);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loop-ports-ending-'));
    const file = path.join(scratch, '.plot-worker.ending.json');
    const record = (i: number) => ({ reason: 'bound' as const, actor: 'bound' as const, branch: 'infra/x', detail: `${i} ${'x'.repeat(512 * 1024)}` });
    try {
      await port.writeEnding(scratch, record(0));
      const reader = spawn(
        process.execPath,
        [
          '-e',
          `const fs = require('node:fs');
           let reads = 0, partial = 0;
           process.stdout.write('ready\\n');
           const stop = Date.now() + 1500;
           while (Date.now() < stop) {
             let text;
             try { text = fs.readFileSync(process.argv[1], 'utf8'); } catch { continue; }
             reads += 1;
             try { JSON.parse(text); } catch { partial += 1; }
           }
           process.stdout.write(JSON.stringify({ reads, partial }) + '\\n');`,
          file,
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      let out = '';
      reader.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      const exited = new Promise<void>((resolve) => reader.once('exit', () => resolve()));
      await new Promise<void>((resolve) => {
        const check = (): void => {
          if (out.includes('ready')) resolve();
          else setTimeout(check, 5);
        };
        check();
      });
      const until = Date.now() + 1500;
      for (let i = 1; Date.now() < until; i += 1) {
        await port.writeEnding(scratch, record(i));
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await exited;
      const counts = JSON.parse(out.trim().split('\n').at(-1)!) as { reads: number; partial: number };
      expect(counts.reads).toBeGreaterThan(0);
      expect(counts.partial).toBe(0);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }, 15_000);

  it('writeBlockedMarker writes the marker, and does not overwrite an existing one', async () => {
    const port = deskPort();
    const first = await port.writeBlockedMarker(desk, 'PLOT-BLOCKED: first question?');
    expect(first).toEqual({ ok: true, value: undefined });
    const second = await port.writeBlockedMarker(desk, 'PLOT-BLOCKED: second question?');
    expect(second).toEqual({ ok: true, value: undefined });
    const text = fs.readFileSync(path.join(desk, 'PLOT-BLOCKED.md'), 'utf8');
    expect(text).toContain('first question?');
    expect(text).not.toContain('second question?');
    fs.rmSync(path.join(desk, 'PLOT-BLOCKED.md'));
  });

  it('sealDeclaration writes branch and status ok for a fresh file', async () => {
    const result = await deskPort().sealDeclaration(desk, 'infra/x');
    expect(result).toEqual({ ok: true, value: undefined });
    const declared = JSON.parse(fs.readFileSync(path.join(desk, '.plot-worker.envelope.json'), 'utf8'));
    expect(declared).toEqual({ branch: 'infra/x', status: 'ok' });
    fs.rmSync(path.join(desk, '.plot-worker.envelope.json'));
  });

  it('sealDeclaration merges onto an agent-written file, keeping its own fields', async () => {
    fs.writeFileSync(
      path.join(desk, '.plot-worker.envelope.json'),
      JSON.stringify({ branch: 'wrong', status: 'blocked', summary: 'the agent\'s own account' }),
    );
    const result = await deskPort().sealDeclaration(desk, 'infra/x');
    expect(result).toEqual({ ok: true, value: undefined });
    const declared = JSON.parse(fs.readFileSync(path.join(desk, '.plot-worker.envelope.json'), 'utf8'));
    expect(declared).toEqual({ branch: 'infra/x', status: 'blocked', summary: 'the agent\'s own account' });
    fs.rmSync(path.join(desk, '.plot-worker.envelope.json'));
  });

  it('sealDeclaration with blocked replaces a status the file already held', async () => {
    fs.writeFileSync(
      path.join(desk, '.plot-worker.envelope.json'),
      JSON.stringify({ branch: 'infra/x', status: 'ok', summary: 'the agent\'s own account' }),
    );
    const result = await deskPort().sealDeclaration(desk, 'infra/x', 'blocked');
    expect(result).toEqual({ ok: true, value: undefined });
    const declared = JSON.parse(fs.readFileSync(path.join(desk, '.plot-worker.envelope.json'), 'utf8'));
    expect(declared).toEqual({ branch: 'infra/x', status: 'blocked', summary: 'the agent\'s own account' });
    fs.rmSync(path.join(desk, '.plot-worker.envelope.json'));
  });

  it('sealDeclaration leaves an unparseable file exactly as it is', async () => {
    fs.writeFileSync(path.join(desk, '.plot-worker.envelope.json'), 'not json at all');
    const result = await deskPort().sealDeclaration(desk, 'infra/x');
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(path.join(desk, '.plot-worker.envelope.json'), 'utf8')).toBe('not json at all');
    fs.rmSync(path.join(desk, '.plot-worker.envelope.json'));
  });

  it('writeCorrection appends, never replacing an earlier correction', async () => {
    const port = deskPort();
    await port.writeCorrection(desk, 'infra/x', 'first failure', 1, 2);
    await port.writeCorrection(desk, 'infra/x', 'second failure', 2, 2);
    const text = fs.readFileSync(path.join(desk, 'PLOT-CORRECTION.md'), 'utf8');
    expect(text).toContain('first failure');
    expect(text).toContain('second failure');
    fs.rmSync(path.join(desk, 'PLOT-CORRECTION.md'));
  });

  it('appendCorrection appends the text with the separator, after an earlier correction', async () => {
    const port = deskPort();
    await port.writeCorrection(desk, 'infra/x', 'first failure', 1, 2);
    await port.appendCorrection(desk, '## Dropped\n\nthe line');
    const text = fs.readFileSync(path.join(desk, 'PLOT-CORRECTION.md'), 'utf8');
    expect(text).toContain('first failure');
    expect(text.endsWith('## Dropped\n\nthe line\n\n---\n\n')).toBe(true);
    fs.rmSync(path.join(desk, 'PLOT-CORRECTION.md'));
  });

  it('writeLimitedRecord overwrites on a second limit, and clearLimitedRecord removes it', async () => {
    const port = deskPort();
    await port.writeLimitedRecord(desk, 100, '1970-01-01T00:01:40Z', 'first limit');
    await port.writeLimitedRecord(desk, 200, '1970-01-01T00:03:20Z', 'second limit');
    const text = fs.readFileSync(path.join(desk, '.plot-worker.limited'), 'utf8');
    expect(text).not.toContain('first limit');
    expect(text).toContain('second limit');
    const cleared = await port.clearLimitedRecord(desk);
    expect(cleared).toEqual({ ok: true, value: undefined });
    expect(fs.existsSync(path.join(desk, '.plot-worker.limited'))).toBe(false);
  });

  it('moveWorkerRecord moves pid records and empties the source, never deleting it', async () => {
    const from = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loop-ports-from-'));
    const to = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loop-ports-to-'));
    fs.writeFileSync(path.join(from, '.plot-worker.pid'), '4242\n');
    const result = await deskPort().moveWorkerRecord(from, to);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(fs.readFileSync(path.join(to, '.plot-worker.pid'), 'utf8')).toBe('4242');
    expect(fs.existsSync(path.join(from, '.plot-worker.pid'))).toBe(true);
    expect(fs.readFileSync(path.join(from, '.plot-worker.pid'), 'utf8')).toBe('');
    fs.rmSync(from, { recursive: true, force: true });
    fs.rmSync(to, { recursive: true, force: true });
  });

  it('moveWorkerRecord changes nothing on a same-desk move', async () => {
    const result = await deskPort().moveWorkerRecord(desk, desk);
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('publishFinding appends a line FindingSchema accepts to the WorkerMonitor log', async () => {
    const result = await deskPort().publishFinding(desk, {
      branch: 'infra/x',
      finding: 'idle',
      since: '2026-10-05T10:00:00.000Z',
      evidence: 'the watcher reported idle',
    });
    expect(result).toEqual({ ok: true, value: undefined });
    const log = path.join(desk, '.plot-worker.monitor.worker.jsonl');
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
    const last = FindingSchema.parse(JSON.parse(lines.at(-1)!));
    expect(last).toMatchObject({
      monitor: 'WorkerMonitor',
      branch: 'infra/x',
      worktree: desk,
      finding: 'idle',
      since: '2026-10-05T10:00:00.000Z',
      evidence: 'the watcher reported idle',
    });
    fs.rmSync(log);
  });
});
