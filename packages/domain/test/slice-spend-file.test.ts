import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { budgetFile } from '../src/adapters/budget/budget-file.js';
import { sliceSpendFile, transcriptDirFor } from '../src/adapters/slice-spend/slice-spend-file.js';
import { decodeEntry } from '../src/entities/budget.js';
import type { SliceSpendRun, SliceSpendSeal } from '../src/entities/slice-spend.js';
import type { AgentRunResult } from '../src/ports/agent-run.js';
import { recordRunLimits } from '../src/workflows/run-limits.js';
import { recordSliceRun, recordSliceSpend, readSliceSpend } from '../src/workflows/slice-spend.js';

/** Runs git quietly in a directory. */
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let root: string;
/** The main checkout. */
let main: string;
/** A linked worktree, standing in for a dispatch desk. */
let desk: string;
/** A transcript home, standing in for `~`. */
let home: string;

/** Writes one session file for a desk, as the runtime would. */
const writeSession = (worktree: string, name: string, lines: unknown[]): void => {
  const dir = transcriptDirFor(worktree, home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
};

/** One assistant turn, as a transcript writes it. */
const turn = (gitBranch: string, inputTokens: number, model = 'claude-opus-5') => ({
  type: 'assistant',
  gitBranch,
  message: {
    model,
    usage: {
      input_tokens: inputTokens,
      output_tokens: 1,
      cache_creation_input_tokens: 2,
      cache_read_input_tokens: 3,
    },
  },
});

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'plot-slice-spend-'));
  main = join(root, 'checkout');
  home = join(root, 'home');
  mkdirSync(main, { recursive: true });
  mkdirSync(home, { recursive: true });
  git(main, 'init', '--quiet', '--initial-branch=main');
  git(main, 'config', 'user.email', 'test@example.com');
  git(main, 'config', 'user.name', 'Test');
  writeFileSync(join(main, 'README.md'), 'x\n');
  git(main, 'add', 'README.md');
  git(main, 'commit', '--quiet', '-m', 'init');
  desk = join(root, 'desks', 'feature-a');
  git(main, 'worktree', 'add', '--quiet', '-b', 'feature/a', desk);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the record path', () => {
  it('resolves to the SAME file from a dispatch desk and from the main checkout', () => {
    // `--git-common-dir`, NEVER `--show-toplevel`. In a linked worktree the
    // latter returns the DESK, and `plot-reap.sh` runs `git worktree remove
    // --force` over exactly those — so the record would be destroyed by the
    // reap on the machine that measured it, with every gate green, because a
    // test run only in the main checkout cannot see the difference.
    const fromMain = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: main,
      encoding: 'utf8',
    }).trim();
    const fromDesk = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: desk,
      encoding: 'utf8',
    }).trim();

    // The desk's own toplevel is NOT the main checkout — the trap this avoids.
    const deskTop = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: desk,
      encoding: 'utf8',
    }).trim();

    // RESOLVED AGAINST THE CWD, NEVER JOINED TO IT, which is the adapter's own
    // rule at `slice-spend-file.ts`. `--git-common-dir` answers RELATIVELY in a
    // main checkout (`.git`) and ABSOLUTELY in a linked worktree — measured both
    // ways on this machine — so `join` prefixes the desk onto an already
    // absolute path and invents a directory that exists nowhere. `resolve`
    // discards the base when the second argument is absolute and handles both.
    // `realpathSync` because macOS answers `/var` as `/private/var`.
    expect(realpathSync(resolve(main, fromMain))).toBe(realpathSync(resolve(desk, fromDesk)));
    expect(deskTop).not.toBe(main);
  });

  it('writes from the desk and reads back from the main checkout', async () => {
    writeSession(desk, 'session-one.jsonl', [turn('feature/a', 100)]);

    const written = await recordSliceSpend(
      sliceSpendFile({ cwd: desk, transcriptHome: home }),
      { worktree: desk, branch: 'feature/a', at: '2026-09-15T10:00:00.000Z' },
    );
    expect(written.ok).toBe(true);

    const read = await readSliceSpend(sliceSpendFile({ cwd: main, transcriptHome: home }), 'feature/a');

    expect(read.state).toBe('measured');
    expect(read.tokens?.inputTokens).toBe(100);
  });

  it('survives the desk being removed', async () => {
    // The reap removes checkouts. The record must outlive one.
    const gone = join(root, 'desks', 'feature-gone');
    git(main, 'worktree', 'add', '--quiet', '-b', 'feature/gone', gone);
    writeSession(gone, 'session-gone.jsonl', [turn('feature/gone', 55)]);
    await recordSliceSpend(sliceSpendFile({ cwd: gone, transcriptHome: home }), {
      worktree: gone,
      branch: 'feature/gone',
      at: '2026-09-15T11:00:00.000Z',
    });

    git(main, 'worktree', 'remove', '--force', gone);
    expect(existsSync(gone)).toBe(false);

    const read = await readSliceSpend(
      sliceSpendFile({ cwd: main, transcriptHome: home }),
      'feature/gone',
    );

    expect(read.state).toBe('measured');
    expect(read.tokens?.inputTokens).toBe(55);
  });

  it('writes exactly four counters to the FILE and no summed fifth', async () => {
    // The key-set assertion on the line as it lands on disk, not only on the
    // schema. A total beside `contextSpend` is a two-line change no review would
    // flag, and the record is what every later reader consults — so the shape is
    // pinned where a reader actually meets it.
    const written = readFileSync(
      join(main, '.git', '.plot', 'state', 'slice-spend.jsonl'),
      'utf8',
    )
      .split('\n')
      .filter((line) => line !== '');
    const parsed = JSON.parse(written[0]!) as Record<string, unknown>;

    expect(Object.keys(parsed.tokens as object).sort()).toEqual([
      'cacheCreationTokens',
      'cacheReadTokens',
      'inputTokens',
      'outputTokens',
    ]);
    expect(Object.keys(parsed).sort()).toEqual(['at', 'branch', 'models', 'tokens', 'turns']);
  });

  it('never writes into the desk itself', async () => {
    // The record is git-ignored and machine-local; one appearing in a desk is
    // the path resolution being wrong.
    expect(existsSync(join(desk, '.plot', 'state', 'slice-spend.jsonl'))).toBe(false);
  });
});

describe('reading a desk’s sessions', () => {
  it('sums EVERY main session and excludes every agent- one', async () => {
    // The brief's correction, pinned: a fixture directory holding three main
    // sessions beside a subagent's, where the record counts all three and none
    // of the subagent's turns. Measured: 40 of 41 desks hold more than one.
    const many = join(root, 'desks', 'feature-many');
    git(main, 'worktree', 'add', '--quiet', '-b', 'feature/many', many);
    writeSession(many, 'session-a.jsonl', [turn('feature/many', 1)]);
    writeSession(many, 'session-b.jsonl', [turn('feature/many', 10)]);
    writeSession(many, 'session-c.jsonl', [turn('feature/many', 100)]);
    writeSession(many, 'agent-helper.jsonl', [turn('feature/many', 1_000_000)]);

    const written = await recordSliceSpend(sliceSpendFile({ cwd: many, transcriptHome: home }), {
      worktree: many,
      branch: 'feature/many',
      at: '2026-09-15T12:00:00.000Z',
    });

    const seal = written.ok ? (written.record as SliceSpendSeal) : null;
    expect(seal?.tokens.inputTokens).toBe(111);
    expect(seal?.turns).toBe(3);
  });

  it('records NOTHING for a desk whose transcripts do not exist', async () => {
    // Recording 0 is the failure the whole plan is built to avoid.
    const bare = join(root, 'desks', 'feature-bare');
    git(main, 'worktree', 'add', '--quiet', '-b', 'feature/bare', bare);

    const written = await recordSliceSpend(sliceSpendFile({ cwd: bare, transcriptHome: home }), {
      worktree: bare,
      branch: 'feature/bare',
      at: '2026-09-15T13:00:00.000Z',
    });

    expect(written).toEqual({ ok: false, refusal: 'no-turns' });

    const read = await readSliceSpend(
      sliceSpendFile({ cwd: main, transcriptHome: home }),
      'feature/bare',
    );
    expect(read.state).toBe('absent');
    expect(read.latest).toBeNull();
  });

  it('refuses a run that names no branch', async () => {
    const written = await recordSliceSpend(sliceSpendFile({ cwd: main, transcriptHome: home }), {
      worktree: desk,
      branch: '',
      at: '2026-09-15T14:00:00.000Z',
    });

    expect(written).toEqual({ ok: false, refusal: 'no-branch' });
  });

  it('writes NO seal line for an SDK-only slice — every session already has a run line', async () => {
    // Build item 3: an SDK run writes its own line per run. Summing its
    // transcript again into a seal would double-count the session.
    const sdkOnly = join(root, 'desks', 'feature-sdk-only');
    git(main, 'worktree', 'add', '--quiet', '-b', 'feature/sdk-only', sdkOnly);
    writeSession(sdkOnly, 'session-sdk.jsonl', [turn('feature/sdk-only', 10)]);
    const record = sliceSpendFile({ cwd: sdkOnly, transcriptHome: home });
    const run: SliceSpendRun = {
      kind: 'run',
      branch: 'feature/sdk-only',
      at: '2026-09-15T17:00:00.000Z',
      sessionId: 'session-sdk',
      role: 'worker',
      models: {
        'claude-opus-5': {
          inputTokens: 10,
          outputTokens: 1,
          cacheCreationTokens: 2,
          cacheReadTokens: 3,
          costUsd: 1,
        },
      },
      costUsd: 1,
      turns: 1,
    };
    await record.append(run);

    const written = await recordSliceSpend(record, {
      worktree: sdkOnly,
      branch: 'feature/sdk-only',
      at: '2026-09-15T17:05:00.000Z',
    });

    expect(written).toEqual({ ok: false, refusal: 'run-lines-only' });
  });

  it('writes its seal line as before for a command-only slice', async () => {
    // The unchanged path: no run line exists for any session, so the seal
    // covers the whole desk exactly as it always has.
    const commandOnly = join(root, 'desks', 'feature-command-only');
    git(main, 'worktree', 'add', '--quiet', '-b', 'feature/command-only', commandOnly);
    writeSession(commandOnly, 'session-cmd.jsonl', [turn('feature/command-only', 20)]);

    const written = await recordSliceSpend(
      sliceSpendFile({ cwd: commandOnly, transcriptHome: home }),
      { worktree: commandOnly, branch: 'feature/command-only', at: '2026-09-15T17:10:00.000Z' },
    );

    const seal = written.ok ? (written.record as SliceSpendSeal) : null;
    expect(seal?.tokens.inputTokens).toBe(20);
  });

  it('seals only the command sessions of a slice that changed runner', async () => {
    // A slice that ran one `command` session and then one SDK session gets
    // one seal line for the `command` session only — the SDK session already
    // has its own run line and must not be summed twice.
    const changed = join(root, 'desks', 'feature-changed-runner');
    git(main, 'worktree', 'add', '--quiet', '-b', 'feature/changed-runner', changed);
    writeSession(changed, 'session-cmd.jsonl', [turn('feature/changed-runner', 30)]);
    writeSession(changed, 'session-sdk.jsonl', [turn('feature/changed-runner', 999)]);
    const record = sliceSpendFile({ cwd: changed, transcriptHome: home });
    const run: SliceSpendRun = {
      kind: 'run',
      branch: 'feature/changed-runner',
      at: '2026-09-15T17:15:00.000Z',
      sessionId: 'session-sdk',
      role: 'worker',
      models: {
        'claude-opus-5': {
          inputTokens: 999,
          outputTokens: 1,
          cacheCreationTokens: 2,
          cacheReadTokens: 3,
          costUsd: 5,
        },
      },
      costUsd: 5,
      turns: 1,
    };
    await record.append(run);

    const written = await recordSliceSpend(record, {
      worktree: changed,
      branch: 'feature/changed-runner',
      at: '2026-09-15T17:20:00.000Z',
    });

    const seal = written.ok ? (written.record as SliceSpendSeal) : null;
    expect(seal?.tokens.inputTokens).toBe(30);
  });

  it('writes a SECOND record on a second run rather than mutating the first', async () => {
    const twice = join(root, 'desks', 'feature-twice');
    git(main, 'worktree', 'add', '--quiet', '-b', 'feature/twice', twice);
    writeSession(twice, 'session-one.jsonl', [turn('feature/twice', 7)]);
    const record = sliceSpendFile({ cwd: twice, transcriptHome: home });

    await recordSliceSpend(record, {
      worktree: twice,
      branch: 'feature/twice',
      at: '2026-09-15T15:00:00.000Z',
    });
    writeSession(twice, 'session-two.jsonl', [turn('feature/twice', 70)]);
    await recordSliceSpend(record, {
      worktree: twice,
      branch: 'feature/twice',
      at: '2026-09-15T16:00:00.000Z',
    });

    const read = await readSliceSpend(
      sliceSpendFile({ cwd: main, transcriptHome: home }),
      'feature/twice',
    );

    expect(read.history).toHaveLength(2);
    expect(read.history.map((entry) => (entry as SliceSpendSeal).tokens.inputTokens)).toEqual([7, 77]);
    expect(read.latest?.at).toBe('2026-09-15T16:00:00.000Z');
  });
});

describe('the read-back path', () => {
  it('opens NO .jsonl — the board must never re-derive per refresh', async () => {
    // A per-refresh scan passes every correctness test and reintroduces the
    // cost the record exists to remove. The proof is that the read succeeds
    // with the transcript home pointed at a directory that holds nothing.
    const empty = join(root, 'no-transcripts');
    mkdirSync(empty, { recursive: true });

    const read = await readSliceSpend(
      sliceSpendFile({ cwd: main, transcriptHome: empty }),
      'feature/a',
    );

    expect(read.state).toBe('measured');
    expect(read.tokens?.inputTokens).toBe(100);
  });

  it('holds every branch in one file, each readable on its own', async () => {
    // ONE file under the COMMON git dir, holding every branch this machine has
    // measured — not one file per desk and not one per branch.
    const path = join(main, '.git', '.plot', 'state', 'slice-spend.jsonl');
    expect(existsSync(path)).toBe(true);

    const read = await readSliceSpend(
      sliceSpendFile({ cwd: main, transcriptHome: home }),
      'feature/many',
    );
    expect(read.state).toBe('measured');
    expect(read.history).toHaveLength(1);
  });
});

describe('an SDK run’s records, through the file adapters', () => {
  /** One SDK result whose session has spent `costUsd` so far. */
  const sdkResult = (sessionId: string, costUsd: number, inputTokens: number): AgentRunResult => ({
    sessionId,
    end: { answer: 'ran', handBack: null },
    usageByModel: {
      'claude-opus-5': { inputTokens, outputTokens: 1, cacheCreationTokens: 2, cacheReadTokens: 3 },
    },
    costUsd,
    costUsdByModel: { 'claude-opus-5': costUsd },
    turns: 4,
    limitReadings: [
      { status: 'allowed', resetsAt: 1791302400, rateLimitType: 'five_hour', utilization: 0.14 },
      { status: 'rejected', resetsAt: 1791475200, rateLimitType: 'seven_day', utilization: 0.66 },
    ],
    account: 'jan@example.com',
  });

  it('appends one run line per run, read back from the main checkout', async () => {
    const sdkDesk = join(root, 'desks', 'feature-sdk-run');
    git(main, 'worktree', 'add', '--quiet', '-b', 'feature/sdk-run', sdkDesk);

    const written = await recordSliceRun(
      sliceSpendFile({ cwd: sdkDesk, transcriptHome: home }),
      { branch: 'feature/sdk-run', role: 'worker', at: '2026-10-06T10:00:00.000Z' },
      sdkResult('session-run', 2.5, 100),
    );

    expect(written.ok).toBe(true);
    const read = await readSliceSpend(sliceSpendFile({ cwd: main, transcriptHome: home }), 'feature/sdk-run');
    expect(read.history).toHaveLength(1);
    expect(read.costUsd).toBe(2.5);
    expect(read.runCount).toBe(1);
  });

  it('reads one checks resume and two corrections of one session as the session’s cost, once', async () => {
    const resumed = join(root, 'desks', 'feature-resumed');
    git(main, 'worktree', 'add', '--quiet', '-b', 'feature/resumed', resumed);
    const record = sliceSpendFile({ cwd: resumed, transcriptHome: home });
    const at = '2026-10-06T11:00:00.000Z';
    // The first run, the `checks` resume and two corrections: four runs of ONE
    // session, each line carrying the session's cumulative figure.
    for (const [cost, tokens] of [[3, 100], [4, 150], [6, 210], [7, 260]] as const) {
      await recordSliceRun(record, { branch: 'feature/resumed', role: 'worker', at }, sdkResult('session-resumed', cost, tokens));
    }

    const read = await readSliceSpend(sliceSpendFile({ cwd: main, transcriptHome: home }), 'feature/resumed');
    expect(read.runCount).toBe(1);
    expect(read.costUsd).toBe(7);
    expect(read.tokens?.inputTokens).toBe(260);
    expect(read.turns).toBe(16);
  });

  it('appends one budget entry per rate_limit_event the run observed', async () => {
    const budgetHome = join(root, 'budget-home');
    const record = budgetFile({ home: budgetHome });

    const outcome = await recordRunLimits(record, sdkResult('session-limits', 1, 1), 1_791_300_000_000);

    expect(outcome).toEqual({ written: 2, failed: 0 });
    const lines = await record.lines();
    const entries = (lines.ok ? lines.value : []).map(decodeEntry);
    expect(entries).toEqual([
      {
        key: { connector: 'claude', account: 'jan@example.com', bucket: 'five_hour' },
        at: 1_791_300_000_000,
        spent: 0,
        limit: 1,
        remaining: 0.86,
        resetAt: 1_791_302_400_000,
        basis: 'actual',
      },
      {
        key: { connector: 'claude', account: 'jan@example.com', bucket: 'seven_day' },
        at: 1_791_300_000_000,
        spent: 0,
        limit: 1,
        remaining: 0,
        resetAt: 1_791_475_200_000,
        basis: 'actual',
      },
    ]);
  });

  it('counts an append the record refuses and still writes the next reading', async () => {
    let calls = 0;
    const refusing = {
      ...budgetFile({ home: join(root, 'budget-refusing') }),
      append: async () => {
        calls += 1;
        return calls === 1 ? ({ ok: false, why: 'failed' } as const) : ({ ok: true, value: undefined } as const);
      },
    };

    const outcome = await recordRunLimits(refusing, sdkResult('session-refused', 1, 1), 0);

    expect(outcome).toEqual({ written: 1, failed: 1 });
  });
});
