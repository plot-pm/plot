import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { deskFixture } from '../src/adapters/desk/desk-fixture.js';
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
