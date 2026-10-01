import { describe, expect, it } from 'vitest';

import { freeAgentCommandRefusal, type LoopScript } from '../src/rules/free-agent-command.js';

/** The loop as `plot-dispatch.sh` names it; the rule itself names no script. */
const LOOP: LoopScript = {
  name: 'plot-worker-loop.sh',
  command: 'PLOT_UNATTENDED=1 skills/plot/scripts/plot-worker-loop.sh',
};
const LOOP_COMMAND = LOOP.command;

/**
 * The refusal in front of every free agent's `Worker command` (#1124).
 *
 * The case that matters is the one measured: a plain `claude -p "… $PLOT_BRANCH …"`
 * started as a free agent received an empty branch and exited.
 */
describe('freeAgentCommandRefusal', () => {
  describe('commands that run the loop', () => {
    it.each([
      ['the repo-relative form', LOOP_COMMAND],
      ['the bare name', 'plot-worker-loop.sh'],
      ['a plugin path', 'PLOT_UNATTENDED=1 /Users/x/.claude/plugins/cache/plot/2.22.0/skills/plot/scripts/plot-worker-loop.sh'],
      ['a quoted path through bash', 'bash "$PLOT_ROOT/plot-worker-loop.sh" --verbose'],
      ['a path followed by a separator', '/a/plot-worker-loop.sh; echo done'],
      ['a subshell', '(skills/plot/scripts/plot-worker-loop.sh)'],
    ])('answers none for %s', (_label, command) => {
      expect(freeAgentCommandRefusal(command, LOOP)).toBeUndefined();
    });
  });

  describe('answers the caller reports itself', () => {
    it.each([[''], ['   '], ['none'], ['NONE'], ['None']])('answers none for %j', (command) => {
      expect(freeAgentCommandRefusal(command, LOOP)).toBeUndefined();
    });
  });

  it('judges by the loop name it is given, not a name it knows', () => {
    const other: LoopScript = { name: 'run-agent.sh', command: 'run-agent.sh' };
    expect(freeAgentCommandRefusal('bin/run-agent.sh', other)).toBeUndefined();
    expect(freeAgentCommandRefusal('plot-worker-loop.sh', other)?.why).toContain('run-agent.sh');
  });

  describe('commands that cannot wait', () => {
    it('refuses the measured plain harness call', () => {
      const refusal = freeAgentCommandRefusal(
        'claude -p "Implementiere den Branch in $PLOT_BRANCH nach dem Plan" --session-id "$PLOT_SESSION_ID"',
        LOOP,
      );
      expect(refusal?.why).toContain('does not run plot-worker-loop.sh');
      expect(refusal?.why).toContain('empty PLOT_BRANCH');
      expect(refusal?.repair).toContain(LOOP_COMMAND);
      expect(refusal?.repair).toContain('.plot/worker-prompt.sh');
      expect(refusal?.repair).toContain('plot-install-prompt.sh');
    });

    it.each([
      ['a command that returns at once', 'true'],
      ['a name that only contains the loop', 'bash my-plot-worker-loop.sh.bak'],
      ['a prefixed name', 'old-plot-worker-loop.sh'],
      ['a different script', 'skills/plot/scripts/plot-worker-loop.bash'],
    ])('refuses %s', (_label, command) => {
      expect(freeAgentCommandRefusal(command, LOOP)).toBeDefined();
    });
  });
});
