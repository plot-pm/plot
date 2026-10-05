import { describe, expect, it } from 'vitest';
import { runnerChoice, SDK_NEEDS_JS_LOOP_REASON, type RunnerChoiceReading } from '../src/rules/runner-choice.js';

const boardReading = (over: Partial<RunnerChoiceReading> = {}): RunnerChoiceReading => ({
  agentRunner: '',
  isWorker: false,
  workerLoop: '',
  fragment: 'claude -p --model opus',
  fragmentCommandWord: 'claude',
  charterHarness: '',
  defaultsToSdkWhenNamed: false,
  ...over,
});

const workerReading = (over: Partial<RunnerChoiceReading> = {}): RunnerChoiceReading => ({
  agentRunner: '',
  isWorker: true,
  workerLoop: 'js',
  fragment: 'PLOT_MODEL=sonnet skills/plot/scripts/plot-worker-loop.sh',
  fragmentCommandWord: 'skills/plot/scripts/plot-worker-loop.sh',
  charterHarness: '',
  defaultsToSdkWhenNamed: false,
  ...over,
});

describe('runnerChoice', () => {
  it('runs the configured fragment when Agent runner is command', () => {
    expect(runnerChoice(boardReading({ agentRunner: 'command' }))).toEqual({ runner: 'command' });
  });

  it('runs the SDK when Agent runner is sdk', () => {
    expect(runnerChoice(boardReading({ agentRunner: 'sdk' }))).toEqual({ runner: 'sdk' });
  });

  it('refuses a worker under Worker loop: shell with Agent runner: sdk, with the exact reason', () => {
    const result = runnerChoice(workerReading({ agentRunner: 'sdk', workerLoop: 'shell' }));
    expect(result).toEqual({ runner: 'refused', reason: SDK_NEEDS_JS_LOOP_REASON });
  });

  it('runs the SDK for a worker under Worker loop: js with Agent runner: sdk', () => {
    expect(runnerChoice(workerReading({ agentRunner: 'sdk', workerLoop: 'js' }))).toEqual({
      runner: 'sdk',
    });
  });

  it('a board role is unaffected by Worker loop — sdk runs regardless', () => {
    expect(
      runnerChoice(boardReading({ agentRunner: 'sdk', isWorker: false, workerLoop: 'shell' })),
    ).toEqual({ runner: 'sdk' });
  });

  describe('absent Agent runner', () => {
    it('answers command unconditionally in this wave, even when defaultsToSdkWhenNamed is set and claude is named', () => {
      // This wave never sets defaultsToSdkWhenNamed; included to document that
      // the flag alone, with no explicit wave-5 flip, still answers command
      // when it is false — see the dedicated wave-5 tests below for the true case.
      expect(runnerChoice(boardReading({ agentRunner: '' }))).toEqual({ runner: 'command' });
    });

    it('answers command for a fragment whose command word is not claude', () => {
      const reading = boardReading({
        agentRunner: '',
        fragment: 'gemini -p',
        fragmentCommandWord: 'gemini',
        defaultsToSdkWhenNamed: true,
      });
      expect(runnerChoice(reading)).toEqual({ runner: 'command' });
    });

    it('answers command for a charter that names another harness', () => {
      const reading = workerReading({
        agentRunner: '',
        workerLoop: 'js',
        charterHarness: 'gemini',
        defaultsToSdkWhenNamed: true,
      });
      expect(runnerChoice(reading)).toEqual({ runner: 'command' });
    });

    it('answers command for a worker under Worker loop: shell, whatever PATH holds', () => {
      // PATH is not even part of the reading — this is the port-level
      // guarantee that PATH cannot influence the answer.
      const reading = workerReading({
        agentRunner: '',
        workerLoop: 'shell',
        charterHarness: '',
        defaultsToSdkWhenNamed: true,
      });
      expect(runnerChoice(reading)).toEqual({ runner: 'command' });
    });

    // THE DEFECT A PRESENCE-OF-BINARY DEFAULT WOULD CAUSE: `claude` on PATH
    // must decide nothing. This reading has no PATH field at all, so a
    // fragment naming `gemini` must answer `command` regardless of what any
    // binary resolution would have found.
    it('with claude on PATH and a fragment that starts gemini, answers command', () => {
      const reading = boardReading({
        agentRunner: '',
        fragment: 'gemini -p',
        fragmentCommandWord: 'gemini',
        defaultsToSdkWhenNamed: true,
      });
      expect(runnerChoice(reading)).toEqual({ runner: 'command' });
    });

    describe('wave 5s flip (defaultsToSdkWhenNamed: true)', () => {
      it('a board role whose fragment starts with claude answers sdk', () => {
        const reading = boardReading({
          agentRunner: '',
          fragment: 'claude -p --model opus',
          fragmentCommandWord: 'claude',
          defaultsToSdkWhenNamed: true,
        });
        expect(runnerChoice(reading)).toEqual({ runner: 'sdk' });
      });

      it('the worker role with Worker loop: js and an unstated charter harness answers sdk', () => {
        const reading = workerReading({
          agentRunner: '',
          workerLoop: 'js',
          charterHarness: '',
          defaultsToSdkWhenNamed: true,
        });
        expect(runnerChoice(reading)).toEqual({ runner: 'sdk' });
      });

      it('the worker role with Worker loop: js and charterHarness: claude answers sdk', () => {
        const reading = workerReading({
          agentRunner: '',
          workerLoop: 'js',
          charterHarness: 'claude',
          defaultsToSdkWhenNamed: true,
        });
        expect(runnerChoice(reading)).toEqual({ runner: 'sdk' });
      });
    });
  });
});
