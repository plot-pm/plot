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

  it('alerts when nothing supervises and one agent runs', () => {
    expect(supervisorProminence(reading({ exitCode: 1, agentsRunning: 1 }))).toBe('alert');
  });

  it('alerts on the measured failure — stopped with six agents running', () => {
    // `alert` AND NOT `warn`, and that is the level a chip cannot carry.
    // Measured 2026-09-09: the correct sentence rendered as a grey chip on a
    // stepper's status line and a person read it for an hour without acting.
    expect(supervisorProminence(reading({ exitCode: 1, agentsRunning: 6 }))).toBe('alert');
  });

  it('notes an unknown reading rather than alerting about it', () => {
    // The board's own inability to ask is not a fact about the fleet, so it is
    // never an alarm — even with agents running.
    expect(supervisorProminence(reading({ asked: false, exitCode: null, agentsRunning: 6 }))).toBe('note');
  });

  it('keeps unknown quieter than stopped at the same agent count', () => {
    // THE ASYMMETRY, ASSERTED AS A PAIR so a collapse in EITHER direction
    // fails. Alerting on `unknown` teaches an operator to dismiss the alert
    // that matters; demoting `stopped` to a note is the outage this plan was
    // written from. Each alone passes if both become one word.
    const stopped = supervisorProminence(reading({ exitCode: 1, agentsRunning: 3 }));
    const cannotAsk = supervisorProminence(reading({ asked: false, exitCode: null, agentsRunning: 3 }));
    expect(stopped).toBe('alert');
    expect(cannotAsk).toBe('note');
    expect(cannotAsk).not.toBe(stopped);
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
    expect(verdict.label).toBe('fleet running');
    expect(verdict.detail).toContain('reaped');
  });

  it('names the board, not the fleet, when it could not ask', () => {
    const verdict = supervisorVerdict(reading({ asked: false, exitCode: null }));
    expect(verdict).toMatchObject({ state: 'unknown', prominence: 'note', shown: true });
    expect(verdict.label).toBe('fleet status unknown');
    expect(verdict.detail).toContain('could not ask');
    // It must not claim the supervisor is down — that is the whole third state.
    expect(verdict.detail).toContain('not the same fact');
  });

  it('counts the agents in the warning, in the plural', () => {
    const verdict = supervisorVerdict(reading({ exitCode: 1, agentsRunning: 6 }));
    expect(verdict).toMatchObject({ state: 'down', prominence: 'alert', shown: true });
    expect(verdict.label).toBe('FLEET STOPPED');
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

  it('names the consequence and not the condition', () => {
    // *No slice will be picked up* is what a reader decides about.
    // `unsupervised` named a component and left the consequence to be derived,
    // which is what a person failed to do for an hour on 2026-09-09.
    for (const agentsRunning of [0, 3]) {
      const verdict = supervisorVerdict(reading({ exitCode: 1, agentsRunning }));
      expect(verdict.detail.toLowerCase()).toContain('no slice will be picked up');
    }
  });
});

describe('the vocabulary is FLEET, in every state and in both fields', () => {
  /**
   * THE WORDS A PERSON CAN ACT ON, AND NO OTHERS.
   *
   * `/plot-fleet --start`, `--status` and `--stop` are the three commands a
   * reader types. There is no `/plot-supervisor`, no skill by that name, and
   * nothing addressable — so a badge reading `unsupervised` named a component
   * its own repair sentence did not.
   *
   * `plot-registryd`, the launchd label `com.plot-pm.registryd` and the state
   * `up` are three machine-side vocabularies for one process, and they stay
   * correct where a machine reads them. This asserts only that none reaches a
   * board reader.
   */
  const INTERNAL = ['supervisor', 'supervised', 'unsupervised', 'registryd', 'launchd', 'launchctl'];

  const everyReading: ReadonlyArray<[string, SupervisorReadings]> = [
    ['loaded', reading({ exitCode: 0, agentsRunning: 3 })],
    ['stopped with agents', reading({ exitCode: 1, agentsRunning: 3 })],
    ['stopped with none', reading({ exitCode: 1, agentsRunning: 0 })],
    ['could not ask', reading({ asked: false, exitCode: null, agentsRunning: 3 })],
  ];

  for (const [name, readings] of everyReading) {
    it(`says fleet and no internal word — ${name}`, () => {
      const verdict = supervisorVerdict(readings);
      expect(verdict.label.toLowerCase()).toContain('fleet');
      for (const word of INTERNAL) {
        expect(verdict.label.toLowerCase()).not.toContain(word);
      }
    });
  }

  it('pairs the label with the repair it prints, rather than each alone', () => {
    // A badge naming one component while its fix names another is the
    // inconsistency this removes. Assert the PAIR: the repair's own noun has to
    // be the label's noun, so renaming one and not the other fails.
    const verdict = supervisorVerdict(reading({ exitCode: 1, agentsRunning: 3 }));
    expect(verdict.detail).toContain('/plot-fleet --start');
    const repairNoun = '/plot-fleet'.replace('/plot-', '');
    expect(verdict.label.toLowerCase()).toContain(repairNoun);
  });

  it('gives stopped and cannot-ask different words', () => {
    // One means *I asked and it is not there*; the other *I could not ask*.
    // Collapsing them is what made the 2026-09-09 outage silent.
    const stopped = supervisorVerdict(reading({ exitCode: 1, agentsRunning: 3 }));
    const cannotAsk = supervisorVerdict(reading({ asked: false, exitCode: null, agentsRunning: 3 }));
    expect(stopped.label).not.toBe(cannotAsk.label);
    expect(cannotAsk.label.toLowerCase()).toContain('unknown');
    expect(stopped.label.toLowerCase()).not.toContain('unknown');
  });
});
