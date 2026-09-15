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

import { sliceSpendFile, transcriptDirFor } from '../src/adapters/slice-spend/slice-spend-file.js';
import { recordSliceSpend, readSliceSpend } from '../src/workflows/slice-spend.js';

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
    expect(read.latest?.tokens.inputTokens).toBe(100);
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
    expect(read.latest?.tokens.inputTokens).toBe(55);
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

    expect(written.ok && written.record.tokens.inputTokens).toBe(111);
    expect(written.ok && written.record.turns).toBe(3);
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
    expect(read.history.map((entry) => entry.tokens.inputTokens)).toEqual([7, 77]);
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
    expect(read.latest?.tokens.inputTokens).toBe(100);
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
