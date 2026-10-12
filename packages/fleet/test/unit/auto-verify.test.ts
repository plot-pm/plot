// The verify pass: a Delivered plan with no current record is judged when the
// switch, the command and the machine allow it, and every refusal is named.
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FleetReading } from '@plot-pm/domain';
import { removeTree as rmTree } from '../rm-tree.mjs';
import {
  readVerifyState,
  runAutoVerifyPass,
  sweepVerifyTrees,
  verifyStatePath,
  type VerifyCandidate,
  type VerifyPassWorld,
} from '../../src/shared/auto-verify.js';
import { boardRunsSettled } from '../../src/shared/board-run.js';

const made: string[] = [];
afterEach(async () => {
  await boardRunsSettled();
  while (made.length) rmTree(made.pop()!);
});

const pulse = { plans: [] } as unknown as FleetReading;
const readings = { headroom: 'clear' as const, machineOverride: false, held: [] };
const candidate: VerifyCandidate = { slug: 'alpha', tracer: false, deliveryCommit: 'abc1234', verified: false };
const world = (candidates: VerifyCandidate[], alive = (pid: number) => pid === process.pid): VerifyPassWorld => ({
  candidates: async () => candidates,
  alive,
});

const configScript = (autoVerify: string, command: string): string =>
  `#!/usr/bin/env bash\ncase "$2" in\n"Auto-verify") echo ${autoVerify};;\n"Verify command") cat <<'EOF_CMD'\n${command}\nEOF_CMD\n;;\n*) printf '%s\\n' "\${3:-}";;\nesac\n`;

const fixture = (autoVerify: string, command: string) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-autover-'));
  const repoRoot = path.join(parent, 'repo');
  fs.mkdirSync(repoRoot);
  const scriptsDir = path.join(parent, 'scripts');
  fs.mkdirSync(scriptsDir);
  made.push(parent);
  fs.writeFileSync(path.join(scriptsDir, 'plot-config.sh'), configScript(autoVerify, command), { mode: 0o755 });
  return { repoRoot, scriptsDir, marker: path.join(parent, 'ran.txt') };
};

describe('runAutoVerifyPass', () => {
  it('starts nothing and records "off" while Auto-verify is not true', async () => {
    const f = fixture('false', 'true');
    const started = await runAutoVerifyPass(f, pulse, readings, 1000, world([candidate]));
    expect(started).toEqual([]);
    expect(readVerifyState(f.repoRoot)?.refusals).toEqual({ alpha: 'off' });
  });

  it('starts one run for a plan with no current record, passing /plot-deliver --verify', async () => {
    const f = fixture('true', '');
    const command = `sh -c 'printf "%s\\n" "$1" >> ${f.marker}' sh`;
    fs.writeFileSync(
      path.join(f.scriptsDir, 'plot-config.sh'),
      configScript('true', command),
      { mode: 0o755 },
    );
    const started = await runAutoVerifyPass(f, pulse, readings, 1000, world([candidate]));
    expect(started).toEqual(['alpha']);
    await boardRunsSettled();
    expect(fs.readFileSync(f.marker, 'utf8').trim()).toBe('/plot-deliver --verify alpha');
  });

  it('skips a plan that already holds a current record', async () => {
    const f = fixture('true', 'true');
    const started = await runAutoVerifyPass(f, pulse, readings, 1000, world([{ ...candidate, verified: true }]));
    expect(started).toEqual([]);
  });

  it('halts the fleet after three failed runs across plans', async () => {
    const f = fixture('true', 'true');
    fs.mkdirSync(path.dirname(verifyStatePath(f.repoRoot)), { recursive: true });
    fs.writeFileSync(
      verifyStatePath(f.repoRoot),
      JSON.stringify({ failures: {}, failedAt: [1, 2, 3], lastSuccessAt: 0, running: {}, refusals: {} }),
    );
    const started = await runAutoVerifyPass(f, pulse, readings, 1000, world([candidate]));
    expect(started).toEqual([]);
    expect(readVerifyState(f.repoRoot)?.refusals).toEqual({ alpha: 'halted' });
  });

  it('counts an ended run with no record as a failure under its commit', async () => {
    const f = fixture('true', 'true');
    fs.mkdirSync(path.dirname(verifyStatePath(f.repoRoot)), { recursive: true });
    fs.writeFileSync(
      verifyStatePath(f.repoRoot),
      JSON.stringify({ failures: {}, failedAt: [], lastSuccessAt: 0, running: { alpha: { pid: 99999999, commit: 'abc1234', startedAt: 1 } }, refusals: {} }),
    );
    await runAutoVerifyPass(f, pulse, readings, 1000, world([candidate], () => false));
    const state = readVerifyState(f.repoRoot)!;
    expect(state.failures.alpha?.count).toBe(1);
    expect(state.failedAt).toEqual([1000]);
    expect(state.running).toEqual({});
  });
});

describe('sweepVerifyTrees', () => {
  it('removes a tree whose preparer is dead and that holds no run, and keeps one with a live run', () => {
    const f = fixture('true', 'true');
    for (const slug of ['dead', 'live']) {
      const pin = path.join(f.repoRoot, '.plot', 'state', 'verify', slug, 'pin');
      fs.mkdirSync(pin, { recursive: true });
      fs.writeFileSync(path.join(pin, '.plot-verify.pid'), '4242\n');
    }
    const swept = sweepVerifyTrees(f.repoRoot, { live: { pid: 7, commit: 'x', startedAt: 1 } }, (pid) => pid === 7);
    expect(swept).toEqual(['dead']);
    expect(fs.existsSync(path.join(f.repoRoot, '.plot', 'state', 'verify', 'live'))).toBe(true);
  });
});
