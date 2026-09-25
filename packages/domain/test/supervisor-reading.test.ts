import { describe, it, expect } from 'vitest';
import {
  supervisorState,
  supervisorProminence,
  supervisorShown,
  supervisorVerdict,
  tickStale,
  formatTickAge,
  FLEET_TICK_STALE_SECONDS,
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

describe('supervisorState — which stop it is, read beside the code and never from it', () => {
  it('reads exit 1 with a finished start behind it as died, not merely down', () => {
    // The unit is on disk and the last `--start` recorded that it finished.
    // `--stop` clears that record only after a clean unload, so nothing
    // unloaded this one — it went away on its own. A reader needs the log
    // before the restart, because whatever killed it will kill it again.
    expect(supervisorState(reading({ exitCode: 1, install: 'installed' }))).toBe('died');
  });

  it('reads the other not-loaded states as plain down', () => {
    // THE THREE THAT ARE HONESTLY DOWN, asserted together: no unit at all, a
    // unit launchd was never told about, and a machine with no init system.
    // Only `installed` means something died.
    //
    // `interrupted` IS THE STATE A CLEAN `--stop` LEAVES, and that is what this
    // case pins for it. A confirmed unload removes the start marker and leaves
    // the unit file on disk, which `--status` reports as `interrupted` with
    // exit 1 — so a deliberate stop must read as `down` here and never `died`.
    // Measured 2026-09-24: a `--stop` whose unload check gave a false negative
    // kept the marker, which made this same reading `installed` and rendered
    // FLEET STOPPED UNEXPECTEDLY at `alert` prominence for a stop somebody
    // asked for. The observation was fixed in `plot-fleetctl.sh --stop`; this
    // line is where a regression in the rule would surface.
    for (const install of ['not-installed', 'interrupted', 'none']) {
      expect(supervisorState(reading({ exitCode: 1, install }))).toBe('down');
    }
  });

  it('reads an ABSENT install field as down — the compatibility contract', () => {
    // THE PIN THIS SLICE OWES, and nothing else enforces it. A board running
    // against a script that predates the field must behave exactly as it did
    // before. Answering `unknown` here would look defensive and would silently
    // degrade every such board into *could not ask* — the one reading the whole
    // rule exists to keep rare. Absent is not false: read the code, not the
    // emptiness.
    expect(supervisorState(reading({ exitCode: 1 }))).toBe('down');
    expect(supervisorState(reading({ exitCode: 0 }))).toBe('up');
  });

  it('never lets the field overrule a run that was not asked or not finished', () => {
    // `died` REFINES `down` AND REPLACES NO CHECK. The gates above it are
    // unchanged, so a field carried by a run the board could not trust cannot
    // promote it into a definite answer.
    expect(supervisorState(reading({ asked: false, exitCode: null, install: 'installed' })))
      .toBe('unknown');
    expect(supervisorState(reading({ exitCode: 1, summarised: false, install: 'installed' })))
      .toBe('unknown');
    expect(supervisorState(reading({ exitCode: 127, install: 'installed' }))).toBe('unknown');
  });

  it('reads a loaded label with no process behind it as died', () => {
    // THE STATE THE SCRIPT LEARNED TO SEE, 2026-09-22. `--status` answered
    // `running` whenever launchd held the label, without asking whether a
    // process was behind it — so a dead daemon read as a healthy fleet twice
    // in ninety minutes while dispatched slices sat unserved.
    //
    // IT MUST NOT RENDER AS PLAIN `down`, which is the half of the fix that
    // lives here. `down` prints *start it*, and starting a crash-looping
    // supervisor runs straight back into whatever killed it. `died` prints
    // *find out what happened first*, which is the action this reading wants.
    expect(supervisorState(reading({ exitCode: 1, install: 'loaded-not-running' }))).toBe('died');
  });

  it('alerts on a loaded-but-dead supervisor with agents running', () => {
    // `died` TAKES `down`'s PROMINENCE RULE and the new word must inherit it
    // rather than fall through to `quiet` — grey, no `role="alert"`, no detail
    // sentence. A state whose whole purpose is to explain an unexplained death
    // would have arrived explaining nothing.
    expect(supervisorProminence(reading({ exitCode: 1, install: 'loaded-not-running', agentsRunning: 2 })))
      .toBe('alert');
  });

  it('reads exit 0 as up whatever the field says', () => {
    // A LOADED SUPERVISOR IS LOADED whatever the last run recorded — the same
    // precedence `fleet_install_state` applies, where liveness is tested first
    // and the marker is not consulted for it. A machine whose marker survives
    // a restart is running, not dead.
    expect(supervisorState(reading({ exitCode: 0, install: 'installed' }))).toBe('up');
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

  it('carries a died reading to the wire as its own word', () => {
    // THE WIRE NOW CARRIES ALL FOUR, and this test is the deliberate rewrite
    // its predecessor asked for: it pinned the narrowing while nothing
    // rendered the difference, and named the slice that would widen it.
    //
    // The seam is still asserted rather than left to the type checker, in the
    // other direction: the state must reach the wire unchanged, so a later
    // collapse back to `down` fails here rather than silently removing the
    // diagnosis from every board.
    const readings = reading({ exitCode: 1, install: 'installed', agentsRunning: 0 });
    expect(supervisorState(readings)).toBe('died');

    const verdict = supervisorVerdict(readings);
    expect(verdict.state).toBe('died');
    expect(verdict.label).not.toBe('FLEET STOPPED');
  });

  it('sends a died fleet to `--status` and never to `--start`', () => {
    // THE REPAIR IS THE DIFFERENCE, and it is why this state was worth a word.
    // Starting a fleet whose supervisor died runs back into whatever killed
    // it, so the banner asks the reader to find out first. Asserted as a PAIR:
    // a detail that gained `--status` while keeping `--start` would read as two
    // repairs and let the reader pick the one that does not work.
    for (const agentsRunning of [0, 3]) {
      const verdict = supervisorVerdict(reading({ exitCode: 1, install: 'installed', agentsRunning }));
      expect(verdict.detail).toContain('/plot-fleet --status');
      expect(verdict.detail).not.toContain('/plot-fleet --start');
    }
  });

  it('counts one agent in the singular for a died fleet too', () => {
    // THE SAME AGREEMENT `down` ALREADY HAS, and it is a separate test because
    // it is a separate sentence: the `died` arm carries its own `is`/`are` and
    // `agent`/`agents` pair, so the one covering `down` proves nothing here.
    // Caught by the domain package's 100% branch gate rather than by an
    // assertion — three agents and none both take the plural path, so the
    // singular was written and never executed.
    const verdict = supervisorVerdict(reading({ exitCode: 1, install: 'installed', agentsRunning: 1 }));
    expect(verdict.detail).toContain('1 agent is still running');
    expect(verdict.detail).not.toContain('agents are');
  });

  it('says a death happened rather than that nothing was ever there', () => {
    // The defect in one assertion. `installed` read as *no unit on this
    // machine* — false about the machine, and it hid an unexplained death from
    // an operator who then never opened the log.
    const verdict = supervisorVerdict(reading({ exitCode: 1, install: 'installed', agentsRunning: 3 }));
    expect(verdict.detail).toContain('nothing stopped it');
    expect(verdict.detail.toLowerCase()).toContain('no slice will be picked up');
  });

  it('alerts a died fleet with agents running, where quiet would hide the sentence', () => {
    // `quiet` RENDERS NO DETAIL SENTENCE AT ALL (`FleetControls.tsx`), so a
    // state that inherited the wrong prominence would arrive explaining
    // nothing — the exact failure that cost an hour on 2026-09-09. The rule
    // tests `down` by name, so `died` had to be added to it explicitly.
    expect(supervisorProminence(reading({ exitCode: 1, install: 'installed', agentsRunning: 1 }))).toBe('alert');
    expect(supervisorProminence(reading({ exitCode: 1, install: 'installed', agentsRunning: 6 }))).toBe('alert');
    // And quiet with none, the same half of the rule `down` already has.
    expect(supervisorProminence(reading({ exitCode: 1, install: 'installed', agentsRunning: 0 }))).toBe('quiet');
  });

  it('leaves the down and unknown banners byte-identical', () => {
    // THE STATES THIS SLICE DID NOT TOUCH, PINNED AS WHOLE OBJECTS. Widening a
    // rule is where neighbouring wording drifts, and these two are what an
    // operator has learnt to read. A field-by-field assertion would let a new
    // key through; `toEqual` will not.
    expect(supervisorVerdict(reading({ exitCode: 1, agentsRunning: 3 }))).toEqual({
      state: 'down',
      prominence: 'alert',
      shown: true,
      label: 'FLEET STOPPED',
      detail:
        'The fleet is stopped, and 3 agents are running. No slice will be picked up, and nothing reaps a finished desk or marks a spent one. Start it: /plot-fleet --start',
    });
    expect(supervisorVerdict(reading({ asked: false, exitCode: null, agentsRunning: 3 }))).toEqual({
      state: 'unknown',
      prominence: 'note',
      shown: true,
      label: 'fleet status unknown',
      detail:
        'The board could not ask `/plot-fleet --status`, so whether the fleet is running was never established. This is not the same fact as it being stopped.',
    });
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
    ['died with agents', reading({ exitCode: 1, install: 'installed', agentsRunning: 3 })],
    ['died with none', reading({ exitCode: 1, install: 'installed', agentsRunning: 0 })],
    ['could not ask', reading({ asked: false, exitCode: null, agentsRunning: 3 })],
    ['running and silent', reading({ exitCode: 0, tickAgeSeconds: 90_061, agentsRunning: 3 })],
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

  for (const [name, readings] of everyReading) {
    it(`keeps machine vocabulary out of the sentence too — ${name}`, () => {
      // THE DETAIL IS WHERE A SLIP WOULD GO. The label is four words a person
      // writes carefully; the sentence explains a mechanism, which is exactly
      // where the launchd label, `registryd` and the script's own `installed`
      // are nearest to hand. `installed` is the worst of them: it is correct
      // about the unit file and reads as the opposite of stopped.
      //
      // SCOPED TO WHAT IS SHOWN, and the exemption is a finding rather than a
      // convenience. `up` carries *"The fleet is supervised"* and returns
      // `shown: false`, so no reader meets the word — but it is the one detail
      // on this rule that would fail the label's own vocabulary list. It is
      // left alone here because rewriting a sentence nothing renders is
      // outside this slice, and asserting it as-is would be writing the test
      // to match the code.
      const verdict = supervisorVerdict(readings);
      if (!verdict.shown) return;
      const detail = verdict.detail.toLowerCase();
      for (const word of [...INTERNAL, 'installed']) {
        expect(detail).not.toContain(word);
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

describe('a running fleet that stopped ticking — the tick age', () => {
  it('shows a stale up with a warning, not silently', () => {
    // 2026-09-23: `--status` said running while the log was 25 hours old, and
    // the board rendered nothing because `up` was never shown.
    const verdict = supervisorVerdict(reading({ exitCode: 0, tickAgeSeconds: 90_061 }));
    expect(verdict.shown).toBe(true);
    expect(verdict.prominence).toBe('warn');
    expect(verdict.label).toBe('fleet silent for 25h');
    expect(verdict.detail).toContain('25h');
    expect(verdict.detail).toContain('/plot-fleet --status');
  });

  it('keeps a stale up at warn with agents running', () => {
    const verdict = supervisorVerdict(reading({ exitCode: 0, tickAgeSeconds: 90_061, agentsRunning: 3 }));
    expect(verdict.prominence).toBe('warn');
  });

  it('stays silent just under the threshold', () => {
    const verdict = supervisorVerdict(reading({ exitCode: 0, tickAgeSeconds: FLEET_TICK_STALE_SECONDS - 1 }));
    expect(verdict.shown).toBe(false);
    expect(verdict.prominence).toBe('quiet');
  });

  it('warns at the threshold', () => {
    expect(supervisorVerdict(reading({ exitCode: 0, tickAgeSeconds: FLEET_TICK_STALE_SECONDS })).shown).toBe(true);
  });

  it('never flags a busy healthy tick — 60 s wait plus a 49 s tick', () => {
    expect(FLEET_TICK_STALE_SECONDS).toBeGreaterThan(110);
    expect(tickStale(reading({ tickAgeSeconds: 109 }))).toBe(false);
  });

  it('flags the measured 25-hour silence', () => {
    expect(tickStale(reading({ tickAgeSeconds: 90_061 }))).toBe(true);
  });

  it('reads an absent tick age on up as exactly today\'s verdict', () => {
    const { tickAgeSeconds: _unused, ...without } = reading({ exitCode: 0, agentsRunning: 2 });
    expect(supervisorVerdict(without)).toEqual(supervisorVerdict(reading({ exitCode: 0, agentsRunning: 2 })));
    expect(supervisorVerdict(without)).toEqual({
      state: 'up',
      prominence: 'quiet',
      shown: false,
      label: 'fleet running',
      detail: 'The fleet is supervised — finished desks are reaped and spent agents are marked.',
    });
  });

  it('reads a non-finite or negative tick age as not stale', () => {
    for (const tickAgeSeconds of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const verdict = supervisorVerdict(reading({ exitCode: 0, tickAgeSeconds }));
      expect(verdict.shown).toBe(false);
      expect(verdict.prominence).toBe('quiet');
    }
  });

  it('keeps the state up for every tick age', () => {
    for (const tickAgeSeconds of [undefined, 0, 109, FLEET_TICK_STALE_SECONDS, 90_061]) {
      expect(supervisorState(reading({ exitCode: 0, tickAgeSeconds }))).toBe('up');
      expect(supervisorVerdict(reading({ exitCode: 0, tickAgeSeconds })).state).toBe('up');
    }
  });

  it('ignores the tick age on a run that was not asked or did not summarise', () => {
    expect(supervisorState(reading({ asked: false, exitCode: null, tickAgeSeconds: 90_061 }))).toBe('unknown');
    expect(supervisorState(reading({ exitCode: 0, summarised: false, tickAgeSeconds: 90_061 }))).toBe('unknown');
    expect(supervisorProminence(reading({ exitCode: 0, summarised: false, tickAgeSeconds: 90_061 }))).toBe('note');
  });

  it('ignores the tick age on a died or down fleet', () => {
    const died = reading({ exitCode: 1, install: 'loaded-not-running', agentsRunning: 2 });
    expect(supervisorVerdict({ ...died, tickAgeSeconds: 90_061 })).toEqual(supervisorVerdict(died));
    const down = reading({ exitCode: 1, agentsRunning: 0 });
    expect(supervisorVerdict({ ...down, tickAgeSeconds: 90_061 })).toEqual(supervisorVerdict(down));
  });

  it('formats the age in the largest whole unit', () => {
    expect(formatTickAge(45)).toBe('45s');
    expect(formatTickAge(600)).toBe('10m');
    expect(formatTickAge(90_061)).toBe('25h');
    expect(formatTickAge(3 * 86_400)).toBe('3d');
  });
});
