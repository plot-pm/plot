import { describe, expect, it } from 'vitest';
import {
  fragmentCommandWord,
  runnerChoice,
  SDK_NEEDS_FRAGMENT_REASON,
  SDK_NEEDS_JS_LOOP_REASON,
  type RunnerChoiceReading,
} from '../src/rules/runner-choice.js';

const boardReading = (over: Partial<RunnerChoiceReading> = {}): RunnerChoiceReading => ({
  agentRunner: '',
  isWorker: false,
  workerLoop: '',
  fragment: 'claude -p --model opus',
  charterHarness: '',
  defaultsToSdkWhenNamed: false,
  ...over,
});

const workerReading = (over: Partial<RunnerChoiceReading> = {}): RunnerChoiceReading => ({
  agentRunner: '',
  isWorker: true,
  workerLoop: 'js',
  fragment: 'PLOT_MODEL=sonnet skills/plot/scripts/plot-worker-loop.sh',
  charterHarness: '',
  defaultsToSdkWhenNamed: false,
  ...over,
});

describe('runnerChoice', () => {
  it('runs the configured fragment when Agent runner is command', () => {
    expect(runnerChoice(boardReading({ agentRunner: 'command' }))).toMatchObject({ runner: 'command' });
  });

  it('runs the SDK when Agent runner is sdk', () => {
    expect(runnerChoice(boardReading({ agentRunner: 'sdk' }))).toMatchObject({ runner: 'sdk' });
  });

  it('refuses a worker under Worker loop: shell with Agent runner: sdk, with the exact reason', () => {
    const result = runnerChoice(workerReading({ agentRunner: 'sdk', workerLoop: 'shell' }));
    expect(result).toEqual({ runner: 'refused', reason: SDK_NEEDS_JS_LOOP_REASON });
  });

  it('runs the SDK for a worker under Worker loop: js with Agent runner: sdk', () => {
    expect(runnerChoice(workerReading({ agentRunner: 'sdk', workerLoop: 'js' }))).toMatchObject({
      runner: 'sdk',
    });
  });

  it('runs the SDK for a worker under an absent Worker loop with Agent runner: sdk — absent reads js', () => {
    expect(runnerChoice(workerReading({ agentRunner: 'sdk', workerLoop: '' }))).toMatchObject({
      runner: 'sdk',
    });
  });

  it('runs command for a worker whose charter names another harness, even with Agent runner: sdk', () => {
    const result = runnerChoice(workerReading({ agentRunner: 'sdk', charterHarness: 'codex' }));
    expect(result.runner).toBe('command');
    expect(result.reason).toContain('codex');
  });

  it('runs the SDK for a worker whose charter names claude', () => {
    expect(runnerChoice(workerReading({ agentRunner: 'sdk', charterHarness: 'claude' }))).toMatchObject({
      runner: 'sdk',
    });
  });

  it('a board role is unaffected by Worker loop — sdk runs regardless', () => {
    expect(
      runnerChoice(boardReading({ agentRunner: 'sdk', isWorker: false, workerLoop: 'shell' })),
    ).toMatchObject({ runner: 'sdk' });
  });

  describe('absent Agent runner', () => {
    it('answers command while defaultsToSdkWhenNamed is false, even where claude is named', () => {
      expect(runnerChoice(boardReading({ agentRunner: '' }))).toMatchObject({ runner: 'command' });
    });

    it('answers command for a fragment whose command word is not claude', () => {
      const reading = boardReading({
        agentRunner: '',
        fragment: 'gemini -p',
        defaultsToSdkWhenNamed: true,
      });
      expect(runnerChoice(reading)).toMatchObject({ runner: 'command' });
    });

    it('answers command for a charter that names another harness', () => {
      const reading = workerReading({
        agentRunner: '',
        workerLoop: 'js',
        charterHarness: 'gemini',
        defaultsToSdkWhenNamed: true,
      });
      expect(runnerChoice(reading)).toMatchObject({ runner: 'command' });
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
      expect(runnerChoice(reading)).toMatchObject({ runner: 'command' });
    });

    // THE DEFECT A PRESENCE-OF-BINARY DEFAULT WOULD CAUSE: `claude` on PATH
    // must decide nothing. This reading has no PATH field at all, so a
    // fragment naming `gemini` must answer `command` regardless of what any
    // binary resolution would have found.
    it('with claude on PATH and a fragment that starts gemini, answers command', () => {
      const reading = boardReading({
        agentRunner: '',
        fragment: 'gemini -p',
        defaultsToSdkWhenNamed: true,
      });
      expect(runnerChoice(reading)).toMatchObject({ runner: 'command' });
    });

    describe('the default flip (defaultsToSdkWhenNamed: true)', () => {
      it('a board role whose fragment starts with claude answers sdk', () => {
        const reading = boardReading({
          agentRunner: '',
          fragment: 'claude -p --model opus',
          defaultsToSdkWhenNamed: true,
        });
        expect(runnerChoice(reading)).toMatchObject({ runner: 'sdk' });
      });

      it('the worker role with Worker loop: js and an unstated charter harness answers sdk', () => {
        const reading = workerReading({
          agentRunner: '',
          workerLoop: 'js',
          charterHarness: '',
          defaultsToSdkWhenNamed: true,
        });
        expect(runnerChoice(reading)).toMatchObject({ runner: 'sdk' });
      });

      it('the worker role with Worker loop: js and charterHarness: claude answers sdk', () => {
        const reading = workerReading({
          agentRunner: '',
          workerLoop: 'js',
          charterHarness: 'claude',
          defaultsToSdkWhenNamed: true,
        });
        expect(runnerChoice(reading)).toMatchObject({ runner: 'sdk' });
      });

      it('the worker role with an absent Worker loop answers sdk — absent reads js', () => {
        const reading = workerReading({
          agentRunner: '',
          workerLoop: '',
          charterHarness: '',
          defaultsToSdkWhenNamed: true,
        });
        expect(runnerChoice(reading)).toMatchObject({ runner: 'sdk' });
      });
    });
  });

  it('derives the command word past NAME=value prefixes: a prefixed claude fragment answers sdk on the flip', () => {
    const reading = boardReading({
      fragment: 'PLOT_UNATTENDED=1 CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 claude -p --model opus',
      defaultsToSdkWhenNamed: true,
    });
    expect(runnerChoice(reading)).toMatchObject({ runner: 'sdk' });
  });

  it.each([
    ['PLOT_UNATTENDED=1 CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 claude -p --model opus', 'claude'],
    ['/usr/local/bin/claude -p', 'claude'],
    ['gemini -p', 'gemini'],
    ['PLOT_MODEL=sonnet', ''],
    ['', ''],
  ])('fragmentCommandWord(%j) is %j', (fragment, word) => {
    expect(fragmentCommandWord(fragment)).toBe(word);
  });

  it.each([[''], ['none'], ['  none  ']])('refuses a role whose fragment is %j under Agent runner: sdk', (fragment) => {
    expect(runnerChoice(boardReading({ agentRunner: 'sdk', fragment }))).toEqual({
      runner: 'refused',
      reason: SDK_NEEDS_FRAGMENT_REASON,
    });
  });

  it('carries a reason with every answer', () => {
    for (const reading of [
      boardReading({ agentRunner: 'command' }),
      boardReading({ agentRunner: 'sdk' }),
      boardReading({ agentRunner: '' }),
      boardReading({ agentRunner: '', defaultsToSdkWhenNamed: true }),
      boardReading({ agentRunner: '', fragment: 'gemini -p', defaultsToSdkWhenNamed: true }),
    ]) {
      expect(runnerChoice(reading).reason).not.toBe('');
    }
  });
});
