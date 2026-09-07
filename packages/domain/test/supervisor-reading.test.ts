import { describe, it, expect } from 'vitest';
import {
  supervisorState,
  supervisorProminence,
  supervisorShown,
  supervisorVerdict,
  type SupervisorReadings,
} from '../src/index.js';

/**
 * The supervisor reading — asserted with NO BROWSER, NO BOARD SERVER, NO SHELL.
 *
 * Every case here is a plain record. That is the whole point of taking readings
 * as values: the badge's word, its prominence and its sentence are decided in a
 * rule, so proving them costs a function call rather than a rendered page.
 *
 * The measurement behind it, 2026-09-07: six workers ran 23–25 hours against an
 * 8-hour bound while `--status` said `supervisor=down`, and the board showed six
 * rows indistinguishable from six healthy ones.
 */

const reading = (over: Partial<SupervisorReadings> = {}): SupervisorReadings => ({
  asked: true,
  exitCode: 0,
  summarised: true,
  agentsRunning: 0,
  ...over,
});

describe('supervisorState — the exit code answers, and only 0 and 1 are answers', () => {
  it('reads exit 0 as up', () => {
    expect(supervisorState(reading({ exitCode: 0 }))).toBe('up');
  });

  it('reads exit 1 as down', () => {
    expect(supervisorState(reading({ exitCode: 1 }))).toBe('down');
  });

  it('reads a script that could not be run as unknown, never down', () => {
    // The file is absent, or the spawn failed. Silence is not an answer.
    expect(supervisorState(reading({ asked: false, exitCode: null }))).toBe('unknown');
  });

  it('reads exit 1 with no summary line as unknown, not as down', () => {
    // THE READING THAT EARNS ITS KEEP, and it has two measured origins that
    // arrive at the identical record — which is why one case covers both.
    //
    // A TIMEOUT: `execFile` maps a SIGTERM kill to code 1, the script's own word
    // for *not loaded*, and a killed process leaves partial stdout.
    //
    // A REFUSAL: measured 2026-09-07 in a bare temp directory, `--status` prints
    // `plot-fleetctl: not a git repository` and exits 1. It refuses before the
    // fleet walk, so no summary line is printed.
    //
    // The code alone cannot tell either from a real answer. Without the
    // corroboration the board would report an unsupervised fleet whenever it
    // was pointed at a directory that is not a repository — the alarm nobody
    // can act on.
    expect(supervisorState(reading({ exitCode: 1, summarised: false }))).toBe('unknown');
  });

  it('reads a code that is neither 0 nor 1 as unknown', () => {
    // `bash` exits 127 for a script that is not there.
    expect(supervisorState(reading({ exitCode: 127 }))).toBe('unknown');
  });

  it('reads a run with no exit code at all as unknown', () => {
    expect(supervisorState(reading({ exitCode: null }))).toBe('unknown');
  });
});

describe('supervisorProminence — the state alone decides nothing', () => {
  it('is quiet when a supervisor is loaded, however many agents run', () => {
    expect(supervisorProminence(reading({ exitCode: 0, agentsRunning: 6 }))).toBe('quiet');
  });

  it('is quiet when nothing supervises and nothing is running', () => {
    // Nothing is being neglected. A board that shouted here would train its
    // reader to ignore the case that matters.
    expect(supervisorProminence(reading({ exitCode: 1, agentsRunning: 0 }))).toBe('quiet');
  });

  it('warns when nothing supervises and one agent runs', () => {
    expect(supervisorProminence(reading({ exitCode: 1, agentsRunning: 1 }))).toBe('warn');
  });

  it('warns on the measured failure — down with six agents running', () => {
    expect(supervisorProminence(reading({ exitCode: 1, agentsRunning: 6 }))).toBe('warn');
  });

  it('notes an unknown reading rather than warning about it', () => {
    // The board's own inability to ask is not a fact about the fleet, so it is
    // never an alarm — even with agents running.
    expect(supervisorProminence(reading({ asked: false, exitCode: null, agentsRunning: 6 }))).toBe('note');
  });
});

describe('supervisorShown — silent when the news is good', () => {
  it('says nothing when a supervisor is loaded', () => {
    expect(supervisorShown(reading({ exitCode: 0 }))).toBe(false);
  });

  it('speaks when nothing supervises, even with no agents', () => {
    expect(supervisorShown(reading({ exitCode: 1, agentsRunning: 0 }))).toBe(true);
  });

  it('speaks when the reading could not be taken', () => {
    expect(supervisorShown(reading({ asked: false, exitCode: null }))).toBe(true);
  });
});

describe('supervisorVerdict — one reading decides the word and the styling together', () => {
  it('renders nothing for a loaded supervisor', () => {
    const verdict = supervisorVerdict(reading({ exitCode: 0, agentsRunning: 3 }));
    expect(verdict).toMatchObject({ state: 'up', prominence: 'quiet', shown: false });
    expect(verdict.label).toBe('supervised');
    expect(verdict.detail).toContain('reaped');
  });

  it('names the board, not the fleet, when it could not ask', () => {
    const verdict = supervisorVerdict(reading({ asked: false, exitCode: null }));
    expect(verdict).toMatchObject({ state: 'unknown', prominence: 'note', shown: true });
    expect(verdict.label).toBe('supervisor unknown');
    expect(verdict.detail).toContain('could not ask');
    // It must not claim the supervisor is down — that is the whole third state.
    expect(verdict.detail).toContain('not the same fact');
  });

  it('counts the agents in the warning, in the plural', () => {
    const verdict = supervisorVerdict(reading({ exitCode: 1, agentsRunning: 6 }));
    expect(verdict).toMatchObject({ state: 'down', prominence: 'warn', shown: true });
    expect(verdict.label).toBe('unsupervised');
    expect(verdict.detail).toContain('6 agents are running');
  });

  it('counts one agent in the singular', () => {
    const verdict = supervisorVerdict(reading({ exitCode: 1, agentsRunning: 1 }));
    expect(verdict.detail).toContain('1 agent is running');
  });

  it('states the quiet case without an alarm and still says how to start it', () => {
    const verdict = supervisorVerdict(reading({ exitCode: 1, agentsRunning: 0 }));
    expect(verdict).toMatchObject({ state: 'down', prominence: 'quiet', shown: true });
    expect(verdict.detail).toContain('nothing is being neglected');
    expect(verdict.detail).toContain('/plot-fleet --start');
  });
});
