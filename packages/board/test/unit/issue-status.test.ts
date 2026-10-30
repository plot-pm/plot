// `plot-issue-status.mjs`: the flags it takes and the skip list that keeps a
// shared issue open. A run owing no write resolves no tracker, so nothing
// here reaches `plot-host.sh`.
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import { trackerFixture } from '@plot-pm/domain/adapters/tracker/tracker-fixture';
import type { StatusWrite } from '@plot-pm/domain/ports/tracker';
import { EXIT, flagsFrom, planFrom, run, wordsFromConfig, writeStatuses } from '../../src/server/entry/issue-status.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');

describe('the flags an issue-status write takes', () => {
  it('reads zero or more --skip-issue, defaulting to none', () => {
    expect(flagsFrom([])).toEqual({ skipIssues: [] });
    expect(flagsFrom(['--skip-issue', '7', '--skip-issue', '8'])).toEqual({ skipIssues: ['7', '8'] });
  });

  it('refuses a flag with no value, and the status-word flags that config now supplies', () => {
    expect(() => flagsFrom(['--skip-issue'])).toThrow('--skip-issue needs a value');
    expect(() => flagsFrom(['--approved', 'Open'])).toThrow("unknown argument '--approved'");
  });
});

describe('the status words read from config', () => {
  const scriptsOver = (answers: Record<string, string | null>): Scripts =>
    ({
      config: async (key: string) => {
        const value = answers[key];
        return value === null || value === undefined ? { ok: false, why: 'failed' } : { ok: true, value };
      },
    }) as unknown as Scripts;

  it('reads the three Tracker status keys, trimmed', async () => {
    const asked: string[] = [];
    const scripts = {
      config: async (key: string, fallback: string) => {
        asked.push(`${key}|${fallback}`);
        return { ok: true, value: ` ${key.split(' ')[1]} \n` };
      },
    } as unknown as Scripts;
    expect(await wordsFromConfig(scripts)).toEqual({ approved: 'approved', delivered: 'delivered', released: 'released' });
    expect(asked.sort()).toEqual(['Tracker approved status|', 'Tracker delivered status|', 'Tracker released status|']);
  });

  it('reads a key that cannot be read as the empty word', async () => {
    expect(await wordsFromConfig(scriptsOver({ 'Tracker approved status': 'Open', 'Tracker released status': null }))).toEqual({
      approved: 'Open',
      delivered: '',
      released: '',
    });
  });
});

describe('run', () => {
  it('refuses a status-word flag, and owes nothing for a plan naming no issue', async () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'plot-issue-status-run-'));
    try {
      writeFileSync(path.join(repo, 'CLAUDE.md'), '## Plot Config\n\n- **Tracker approved status:** Open\n');
      const out: string[] = [];
      const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const code = await run(['--approved', 'Open'], '{"phase":"Approved","issues":["7"]}', { repoRoot: repo, scriptDir: SCRIPT_DIR }, (s) => out.push(s));
      err.mockRestore();
      expect(code).toBe(EXIT.usage);
      out.length = 0;
      const none = await run([], '{"phase":"Approved","issues":[]}', { repoRoot: repo, scriptDir: SCRIPT_DIR }, (s) => out.push(s));
      expect(none).toBe(EXIT.ok);
      expect(out.join('')).toBe('summary: tracker=none\n');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('the plan read from stdin', () => {
  it('reads the phase, lowercased, and the issues as strings', () => {
    expect(planFrom('{"phase":"Approved","issues":[7,"#8"]}')).toEqual({ phase: 'approved', issues: ['7', '#8'] });
  });

  it('throws where stdin is not the parser’s JSON', () => {
    expect(() => planFrom('{"phase":"approved"}')).toThrow('no phase or no issues[]');
  });
});

describe('each owed write goes through the tracker port, skip-aware', () => {
  it('prints one line per issue and hands the port the issue and status', async () => {
    const written: StatusWrite[] = [];
    const { lines, outcomes } = await writeStatuses(
      { phase: 'approved', issues: ['7'], words: { approved: 'Open', delivered: '', released: '' } },
      trackerFixture({ written }),
    );
    expect(written).toEqual([{ prUrl: '', issue: '7', status: 'Open' }]);
    expect(lines).toEqual(['7\twritten\tOpen\n']);
    expect(outcomes).toEqual(['written']);
  });

  // #2374 (2): a skip list must reach this write — a shared issue another
  // unfinished plan also names must never be written here, regardless of
  // what the tracker port would have answered.
  it('skips a named issue without asking the tracker, and writes every other one', async () => {
    const written: StatusWrite[] = [];
    const { lines, outcomes } = await writeStatuses(
      { phase: 'released', issues: ['7', '8'], words: { approved: '', delivered: '', released: 'Done' } },
      trackerFixture({ written }),
      new Set(['7']),
    );
    expect(written).toEqual([{ prUrl: '', issue: '8', status: 'Done' }]);
    expect(lines).toEqual(['7\tskipped\tanother plan unfinished\n', '8\twritten\tDone\n']);
    expect(outcomes).toEqual(['skipped', 'written']);
  });

  it('skips every issue where every one is named, asking the tracker nothing', async () => {
    const written: StatusWrite[] = [];
    const { lines, outcomes } = await writeStatuses(
      { phase: 'released', issues: ['7'], words: { approved: '', delivered: '', released: 'Done' } },
      trackerFixture({ written }),
      new Set(['7']),
    );
    expect(written).toEqual([]);
    expect(lines).toEqual(['7\tskipped\tanother plan unfinished\n']);
    expect(outcomes).toEqual(['skipped']);
  });
});
