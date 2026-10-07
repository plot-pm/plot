import { describe, expect, it } from 'vitest';
import {
  fragmentCommandWord,
  runnerChoice,
  SDK_NEEDS_FRAGMENT_REASON,
  type RunnerChoiceReading,
} from '../src/rules/runner-choice.js';

const boardReading = (over: Partial<RunnerChoiceReading> = {}): RunnerChoiceReading => ({
  agentRunner: '',
  isWorker: false,
  fragment: 'claude -p --model opus',
  charterHarness: '',
  defaultsToSdkWhenNamed: false,
  ...over,
});

const workerReading = (over: Partial<RunnerChoiceReading> = {}): RunnerChoiceReading => ({
  agentRunner: '',
  isWorker: true,
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

  it('runs the SDK for a worker with Agent runner: sdk', () => {
    expect(runnerChoice(workerReading({ agentRunner: 'sdk' }))).toMatchObject({
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
        charterHarness: 'gemini',
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

      it('the worker role with an unstated charter harness answers sdk', () => {
        const reading = workerReading({
          agentRunner: '',
          charterHarness: '',
          defaultsToSdkWhenNamed: true,
        });
        expect(runnerChoice(reading)).toMatchObject({ runner: 'sdk' });
      });

      it('the worker role with charterHarness: claude answers sdk', () => {
        const reading = workerReading({
          agentRunner: '',
          charterHarness: 'claude',
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
