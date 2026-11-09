import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentStartShell, workerRecordsFile } from '../src/adapters/worker-records/worker-records-file.js';
import type { LaunchRecordFiles } from '../src/ports/worker-records.js';

let desk: string;
let files: LaunchRecordFiles;

beforeEach(() => {
  desk = mkdtempSync(join(tmpdir(), 'worker-records-'));
  files = {
    exitFile: join(desk, '.plot-worker.exit'),
    pidFile: join(desk, '.plot-worker.pid'),
    pidStartedFile: join(desk, '.plot-worker.pid.startedAt'),
    wrapperPidFile: join(desk, '.plot-worker.wrapper.pid'),
  };
});
afterEach(() => {
  rmSync(desk, { recursive: true, force: true });
});

/** The C locale's `lstart` form, `Mon Nov  9 08:07:06 2026`, with the trailing padding macOS `ps` prints. */
const C_LSTART = /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4} *$/;

describe('workerRecordsFile', () => {
  it('writes each record as the value alone, with no newline', () => {
    const records = workerRecordsFile(files);

    expect(records.writeWrapperPid(11)).toBe(true);
    expect(records.writeAgentPid(12)).toBe(true);
    expect(records.writeAgentStarted('Mon Nov  9 08:07:06 2026')).toBe(true);
    expect(records.writeExit(143)).toBe(true);

    expect(readFileSync(files.wrapperPidFile, 'utf8')).toBe('11');
    expect(readFileSync(files.pidFile, 'utf8')).toBe('12');
    expect(readFileSync(files.pidStartedFile, 'utf8')).toBe('Mon Nov  9 08:07:06 2026');
    expect(readFileSync(files.exitFile, 'utf8')).toBe('143');
  });

  it('reports a write into a missing directory as not landed', () => {
    const records = workerRecordsFile({ ...files, exitFile: join(desk, 'gone', 'exit') });

    expect(records.writeExit(0)).toBe(false);
  });

  it("reads this process's start in the C locale's form under a German locale", () => {
    const saved = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL };
    process.env.LANG = 'de_CH.UTF-8';
    process.env.LC_ALL = 'de_CH.UTF-8';
    try {
      expect(workerRecordsFile(files).startedText(process.pid)).toMatch(C_LSTART);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('reads the start of a pid no process holds as empty', () => {
    expect(workerRecordsFile(files).startedText(2 ** 22 + 7)).toBe('');
  });

  it("reads a manifest's worktree, and an absent, unparseable or field-less manifest as empty", () => {
    const records = workerRecordsFile(files);
    const manifest = join(desk, 'm.json');

    expect(records.manifestWorktree('')).toBe('');
    expect(records.manifestWorktree(manifest)).toBe('');
    writeFileSync(manifest, '{ not json');
    expect(records.manifestWorktree(manifest)).toBe('');
    writeFileSync(manifest, 'null');
    expect(records.manifestWorktree(manifest)).toBe('');
    writeFileSync(manifest, '{"worktree": 3}');
    expect(records.manifestWorktree(manifest)).toBe('');
    writeFileSync(manifest, '{\n  "worktree": "/w/hopped"\n}\n');
    expect(records.manifestWorktree(manifest)).toBe('/w/hopped');
  });

  it("appends a line to the desk's WorkerMonitor findings", () => {
    const records = workerRecordsFile(files);

    expect(records.appendFinding(desk, 'one\n')).toBe(true);
    expect(records.appendFinding(desk, 'two\n')).toBe(true);
    expect(records.appendFinding(join(desk, 'gone'), 'three\n')).toBe(false);

    expect(readFileSync(join(desk, '.plot-worker.monitor.worker.jsonl'), 'utf8')).toBe('one\ntwo\n');
  });
});

describe('agentStartShell', () => {
  it('reads a normal exit as its code', async () => {
    const agent = agentStartShell().start('exit 3', process.env);

    expect(agent?.pid).toBeGreaterThan(0);
    expect(await agent?.ended).toEqual({ code: 3, signal: null });
  });

  it('reads a signal death as the signal number', async () => {
    const agent = agentStartShell().start('sleep 30', process.env);
    process.kill(agent?.pid ?? 0, 'SIGKILL');

    expect(await agent?.ended).toEqual({ code: null, signal: 9 });
  });

  it('hands the agent the environment it was given', async () => {
    const out = join(desk, 'env');
    const agent = agentStartShell().start(`printf %s "$PLOT_PROBE" > ${JSON.stringify(out)}`, {
      ...process.env,
      PLOT_PROBE: 'given',
    });
    await agent?.ended;

    expect(readFileSync(out, 'utf8')).toBe('given');
  });
});
