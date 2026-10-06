import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { transcriptFs } from '../src/adapters/transcript/transcript-fs.js';
import { transcriptDirFor } from '../src/adapters/slice-spend/slice-spend-file.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * THE SIXTH RULE-VERSUS-SHELL COMPARISON: does `transcriptFs().quietSeconds`
 * answer what `plot-transcript-quiet.sh`'s `plot_transcript_quiet_seconds`
 * answers, over a worktree in every transcript state a desk can be in?
 *
 * THE PAIR EXISTS ON PURPOSE. `docs/shell-and-domain.md` settles which side of
 * the cost rule the loop falls on: the idle watch asks this once per agent per
 * pass, so it duplicates the reading and this holds the pair. NEITHER SIDE IS
 * AUTHORITATIVE — on a disagreement the branch stops, and adjusting either
 * side to make this pass is the one move forbidden.
 *
 * THE CORPUS IS BUILT, matching `desk-reset.corpus.test.ts`'s reason: a
 * transcript directory is not in the repository, so each state — no
 * directory, an empty directory, one session file, several, a subagent file
 * alongside a worker's own — is constructed under a private `PLOT_TRANSCRIPT_HOME`
 * so the answer never depends on whichever transcripts happen to exist on the
 * machine running the test.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const TRANSCRIPT_LIB = `${ROOT}/skills/plot/scripts/plot-transcript-quiet.sh`;

/** The pair this file compares, and the words its report uses. */
const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

let home = '';

/** One case: the worktree's transcript directory state, and a name a failure can be read by. */
interface Case {
  name: string;
  /** Builds this case's directory under `home`; returns the worktree path it answers for. */
  build: () => string;
}

const dirFor = (wt: string): string => transcriptDirFor(wt, home);

const writeAt = (path: string, ageSeconds: number): void => {
  writeFileSync(path, '{}\n');
  const at = new Date(Date.now() - ageSeconds * 1000);
  utimesSync(path, at, at);
};

const cases: Case[] = [
  {
    name: 'no-directory',
    build: () => {
      const wt = join(home, 'desks', 'no-directory');
      return wt;
    },
  },
  {
    name: 'empty-directory',
    build: () => {
      const wt = join(home, 'desks', 'empty-directory');
      execFileSync('mkdir', ['-p', dirFor(wt)]);
      return wt;
    },
  },
  {
    name: 'one-session-fresh',
    build: () => {
      const wt = join(home, 'desks', 'one-session-fresh');
      const dir = dirFor(wt);
      execFileSync('mkdir', ['-p', dir]);
      writeAt(join(dir, 'sess-1.jsonl'), 5);
      return wt;
    },
  },
  {
    name: 'one-session-old',
    build: () => {
      const wt = join(home, 'desks', 'one-session-old');
      const dir = dirFor(wt);
      execFileSync('mkdir', ['-p', dir]);
      writeAt(join(dir, 'sess-1.jsonl'), 3600);
      return wt;
    },
  },
  {
    name: 'newest-of-several',
    build: () => {
      const wt = join(home, 'desks', 'newest-of-several');
      const dir = dirFor(wt);
      execFileSync('mkdir', ['-p', dir]);
      writeAt(join(dir, 'sess-old.jsonl'), 900);
      writeAt(join(dir, 'sess-new.jsonl'), 10);
      return wt;
    },
  },
  {
    name: 'subagent-file-excluded',
    build: () => {
      const wt = join(home, 'desks', 'subagent-file-excluded');
      const dir = dirFor(wt);
      execFileSync('mkdir', ['-p', dir]);
      // The subagent's own transcript is fresher than the worker's — if either
      // side read it, this case would answer the subagent's age instead.
      writeAt(join(dir, 'agent-sub.jsonl'), 1);
      writeAt(join(dir, 'sess-1.jsonl'), 200);
      return wt;
    },
  },
  {
    name: 'non-jsonl-file-ignored',
    build: () => {
      const wt = join(home, 'desks', 'non-jsonl-file-ignored');
      const dir = dirFor(wt);
      execFileSync('mkdir', ['-p', dir]);
      writeAt(join(dir, 'notes.txt'), 1);
      writeAt(join(dir, 'sess-1.jsonl'), 150);
      return wt;
    },
  },
];

let built: Map<string, string> = new Map();

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'plot-transcript-corpus-'));
  for (const one of cases) built.set(one.name, one.build());
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

/**
 * Every case's verdict from the SHIPPED shell function, in one bash process —
 * matching `sample.corpus.test.ts`'s reasoning: one process for the whole
 * corpus rather than one per case.
 */
const shellVerdicts = (): string[] => {
  const stdin = cases.map((one) => built.get(one.name)!).join('\n') + '\n';
  const script = `
    export PLOT_TRANSCRIPT_HOME=${JSON.stringify(home)}
    . ${JSON.stringify(TRANSCRIPT_LIB)}
    while IFS= read -r wt; do
      [ -n "$wt" ] || continue
      plot_transcript_quiet_seconds "$wt"
      printf '\\n'
    done
  `;
  const out = execFileSync('bash', ['-c', script], {
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });
  const words = out.split('\n');
  if (words[words.length - 1] === '') words.pop();
  return words;
};

/** The rule side's answer, as a string comparable to the shell's. */
const ruleVerdict = async (wt: string): Promise<string> => {
  const answer = await transcriptFs({ transcriptHome: home }).quietSeconds(wt);
  if (!answer.ok) return 'failed';
  return answer.value.quiet === 'unavailable' ? 'unavailable' : String(answer.value.seconds);
};

describe('transcriptFs().quietSeconds agrees with plot_transcript_quiet_seconds', () => {
  it('reads a corpus worth comparing', () => {
    expect(cases.length).toBeGreaterThanOrEqual(7);
    const shell = shellVerdicts();
    expect(shell.length).toBe(cases.length);
  });

  it('exercises both an available and an unavailable answer', () => {
    const shell = shellVerdicts();
    expect(shell.some((word) => word === 'unavailable')).toBe(true);
    expect(shell.some((word) => word !== 'unavailable')).toBe(true);
  });

  it('excludes a subagent transcript on both sides', async () => {
    const wt = built.get('subagent-file-excluded')!;
    const rule = await ruleVerdict(wt);
    // 200s old (sess-1), never the 1s-old agent-sub file — a tight bound
    // allows for the seconds the test itself spent running.
    expect(Number(rule)).toBeGreaterThanOrEqual(199);
    expect(Number(rule)).toBeLessThan(205);
  });

  it('answers what the shell answers, on every case, within clock tolerance', async () => {
    const shell = shellVerdicts();
    const found: Disagreement[] = [];
    for (let i = 0; i < cases.length; i += 1) {
      const wt = built.get(cases[i].name)!;
      const rule = await ruleVerdict(wt);
      if (rule === 'unavailable' || shell[i] === 'unavailable') {
        // A WORD, COMPARED AS A WORD. Both answer `unavailable` or neither does.
        compareField(found, cases[i].name, 'quiet-seconds', rule, shell[i]);
        continue;
      }
      // BOTH SIDES READ THE SAME FILESYSTEM MOMENTS APART, so a second of
      // process-start drift between the two readings is not a disagreement —
      // it is the clock, and `compareField` would otherwise fail on a healthy
      // pair every time CI runs it a beat slower.
      const ruleSeconds = Number(rule);
      const shellSeconds = Number(shell[i]);
      if (Math.abs(ruleSeconds - shellSeconds) > 5) {
        compareField(found, cases[i].name, 'quiet-seconds', rule, shell[i]);
      }
    }
    expect(found.map(report)).toEqual([]);
  });

  it('answers whether a conversation has written, as plot_transcript_exists does', async () => {
    const wt = built.get('one-session-fresh')!;
    const handles = ['sess-1', 'sess-2', ''];
    const script = `
      export PLOT_TRANSCRIPT_HOME=${JSON.stringify(home)}
      . ${JSON.stringify(TRANSCRIPT_LIB)}
      for h in ${handles.map((h) => `'${h}'`).join(' ')}; do
        if plot_transcript_exists ${JSON.stringify(wt)} "$h"; then echo yes; else echo no; fi
      done
    `;
    const shell = execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim().split('\n');
    const found: Disagreement[] = [];
    for (let i = 0; i < handles.length; i += 1) {
      const answer = await transcriptFs({ transcriptHome: home }).spoken(wt, handles[i]);
      compareField(found, `spoken:${handles[i] || 'empty'}`, 'spoken', answer.ok && answer.value ? 'yes' : 'no', shell[i]);
    }
    expect(shell).toEqual(['yes', 'no', 'no']);
    expect(found.map(report)).toEqual([]);
  });
});
