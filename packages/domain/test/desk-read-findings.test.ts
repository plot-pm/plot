import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { deskFixture, deskFixtureCalls } from '../src/adapters/desk/desk-fixture.js';
import { deskFs } from '../src/adapters/desk/desk-fs.js';
import type { Finding } from '../src/entities/finding.js';
import { findingsInText, MAX_LOG_BYTES } from '../src/rules/monitor-log.js';

const finding = (over: Partial<Finding> = {}): Finding => ({
  monitor: 'AgentMonitor',
  branch: 'feature/one',
  worktree: '/w/one',
  finding: 'owes a review',
  since: '2026-10-10T09:00:00Z',
  evidence: 'e',
  measuredAt: '2026-10-10T09:00:00Z',
  ...over,
});
const lines = (...fs: Finding[]): string => `${fs.map((f) => JSON.stringify(f)).join('\n')}\n`;

describe('findingsInText', () => {
  it('skips lines that are not findings, lets the last line per slot win and drops a cleared slot', () => {
    const text = [
      'not json',
      '{"monitor":"AgentMonitor"}',
      JSON.stringify(finding({ evidence: 'old' })),
      JSON.stringify(finding({ evidence: 'new' })),
      JSON.stringify(finding({ branch: 'feature/two' })),
      JSON.stringify(finding({ branch: 'feature/two', finding: 'clear' })),
      '{"monitor":"Agent',
    ].join('\n');
    expect(findingsInText(text).map((f) => [f.branch, f.evidence])).toEqual([['feature/one', 'new']]);
  });
});

describe('deskFs readFindings', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const desk = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'plot-desk-read-'));
    dirs.push(d);
    return d;
  };
  const port = () => deskFs({} as never);

  it('answers empty for a desk with no logs', async () => {
    expect(await port().readFindings(desk())).toEqual({ ok: true, value: [] });
  });

  it('reads the three named logs and ignores any other jsonl', async () => {
    const d = desk();
    writeFileSync(join(d, '.plot-worker.monitor.agent.jsonl'), lines(finding()));
    writeFileSync(join(d, '.plot-worker.monitor.build.jsonl'), lines(finding({ monitor: 'BuildMonitor', finding: 'build failed' })));
    writeFileSync(join(d, 'agent-output.jsonl'), lines(finding({ branch: 'feature/stray' })));
    const answer = await port().readFindings(d);
    expect(answer.ok && answer.value.map((f) => f.finding).sort()).toEqual(['build failed', 'owes a review']);
  });

  it('reads only the tail of a log longer than the bound', async () => {
    const d = desk();
    const head = lines(finding({ branch: 'feature/old' }));
    const filler = `${'x'.repeat(MAX_LOG_BYTES)}\n`;
    writeFileSync(join(d, '.plot-worker.monitor.agent.jsonl'), head + filler + lines(finding({ branch: 'feature/new' })));
    const answer = await port().readFindings(d);
    expect(answer.ok && answer.value.map((f) => f.branch)).toEqual(['feature/new']);
  });

  it('fails, rather than answering empty, where a log exists and cannot be read', async () => {
    const d = desk();
    const file = join(d, '.plot-worker.monitor.agent.jsonl');
    writeFileSync(file, lines(finding()));
    chmodSync(file, 0o000);
    try {
      if (process.getuid?.() === 0) return;
      expect(await port().readFindings(d)).toEqual({ ok: false, why: 'failed' });
    } finally {
      chmodSync(file, 0o600);
    }
  });
});

describe('deskFixture readFindings', () => {
  it('answers from its table and fails for an unreadable desk', async () => {
    const f = deskFixture({ findings: { '/w/one': [finding()] }, unreadableFindings: ['/w/bad'] });
    expect(await f.readFindings('/w/one')).toEqual({ ok: true, value: [finding()] });
    expect(await f.readFindings('/w/none')).toEqual({ ok: true, value: [] });
    expect(await f.readFindings('/w/bad')).toEqual({ ok: false, why: 'failed' });
  });
});

describe('deskFs publishAgentFinding and appendLog', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const desk = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'plot-desk-agent-'));
    dirs.push(d);
    return d;
  };
  const port = () => deskFs({} as never);

  it('appends the line in the shell field order, and readFindings reads it back', async () => {
    const d = desk();
    const line = finding({ worktree: d });
    expect(await port().publishAgentFinding(d, line)).toEqual({ ok: true, value: undefined });
    expect(readFileSync(join(d, '.plot-worker.monitor.agent.jsonl'), 'utf8')).toBe(
      `{"monitor":"AgentMonitor","branch":"feature/one","worktree":"${d}","finding":"owes a review","since":"2026-10-10T09:00:00Z","evidence":"e","measuredAt":"2026-10-10T09:00:00Z"}\n`,
    );
    expect(await port().readFindings(d)).toEqual({ ok: true, value: [line] });
  });

  it('appends a desk log line', async () => {
    const d = desk();
    expect(await port().appendLog(d, 'one')).toEqual({ ok: true, value: undefined });
    await port().appendLog(d, 'two');
    expect(readFileSync(join(d, '.plot-worker.log'), 'utf8')).toBe('one\ntwo\n');
  });

  it('fails where the desk is gone', async () => {
    const gone = join(desk(), 'gone');
    expect(await port().publishAgentFinding(gone, finding())).toEqual({ ok: false, why: 'failed' });
    expect(await port().appendLog(gone, 'x')).toEqual({ ok: false, why: 'failed' });
  });
});

describe('deskFixture publishAgentFinding and appendLog', () => {
  it('records each call', async () => {
    const calls = deskFixtureCalls();
    const f = deskFixture({ calls });
    await f.publishAgentFinding('/w/one', finding());
    await f.appendLog('/w/one', 'line');
    expect(calls.agentFindings).toEqual([{ worktree: '/w/one', finding: finding() }]);
    expect(calls.logLines).toEqual([{ worktree: '/w/one', line: 'line' }]);
  });
});
