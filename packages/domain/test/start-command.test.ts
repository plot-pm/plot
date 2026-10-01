import { describe, expect, it } from 'vitest';

import { startCommand, type LoopScript } from '../src/rules/start-command.js';

/** The loop as `plot-dispatch.sh` names it; the rule itself names no script. */
const LOOP: LoopScript = {
  name: 'plot-worker-loop.sh',
  command: 'PLOT_UNATTENDED=1 plot-worker-loop.sh',
};

/** The measured command from #1124. */
const PLAIN = 'claude -p "Implementiere den Branch in $PLOT_BRANCH nach dem Plan" --session-id "$PLOT_SESSION_ID"';

/**
 * Which command starts an agent (#1124).
 *
 * The case that matters is the one measured: a plain `claude -p "… $PLOT_BRANCH …"`
 * started as a free agent received an empty branch and exited.
 */
describe('startCommand', () => {
  describe('an absent key is not set up', () => {
    it.each([[''], ['   ']])('answers unconfigured for %j, free or assigned, naming the value to set', (configured) => {
      for (const agent of ['free', 'assigned'] as const) {
        expect(startCommand(configured, LOOP, agent)).toEqual({
          start: 'unconfigured',
          repair: "set 'Worker command' to 'PLOT_UNATTENDED=1 plot-worker-loop.sh', which /plot-dispatch offers to write",
        });
      }
    });
  });

  describe('`none` is declined', () => {
    it.each([['none'], ['NONE'], ['None'], [' none ']])('declines %j, free or assigned', (configured) => {
      expect(startCommand(configured, LOOP, 'free')).toEqual({ start: 'declined' });
      expect(startCommand(configured, LOOP, 'assigned')).toEqual({ start: 'declined' });
    });
  });

  describe('commands that run the loop', () => {
    it.each([
      ['the bare value /plot-init writes', 'PLOT_UNATTENDED=1 plot-worker-loop.sh'],
      ['the repo-relative form', 'PLOT_UNATTENDED=1 skills/plot/scripts/plot-worker-loop.sh'],
      ['the bare name', 'plot-worker-loop.sh'],
      ['a plugin path', 'PLOT_UNATTENDED=1 /Users/x/.claude/plugins/cache/plot/2.22.0/skills/plot/scripts/plot-worker-loop.sh'],
      ['a quoted path through bash', 'bash "$PLOT_ROOT/plot-worker-loop.sh" --verbose'],
      ['a path followed by a separator', '/a/plot-worker-loop.sh; echo done'],
      ['a subshell', '(skills/plot/scripts/plot-worker-loop.sh)'],
    ])('runs %s as configured for a free agent', (_label, configured) => {
      expect(startCommand(configured, LOOP, 'free')).toEqual({ start: 'run', command: configured });
    });
  });

  it('judges by the loop name it is given, not a name it knows', () => {
    const other: LoopScript = { name: 'run-agent.sh', command: 'run-agent.sh' };
    expect(startCommand('bin/run-agent.sh', other, 'free').start).toBe('run');
    const refused = startCommand('plot-worker-loop.sh', other, 'free');
    expect(refused.start === 'refused' && refused.why).toContain('run-agent.sh');
  });

  describe('a command that is not the loop', () => {
    it('runs as configured for an agent given a branch', () => {
      expect(startCommand(PLAIN, LOOP, 'assigned')).toEqual({ start: 'run', command: PLAIN });
    });

    it('refuses the measured plain harness call for a free agent, the bare value first in the repair', () => {
      const answer = startCommand(PLAIN, LOOP, 'free');
      expect(answer.start).toBe('refused');
      if (answer.start !== 'refused') return;
      expect(answer.why).toContain('does not run plot-worker-loop.sh');
      expect(answer.why).toContain('empty PLOT_BRANCH');
      expect(answer.repair.startsWith("set 'Worker command' to 'PLOT_UNATTENDED=1 plot-worker-loop.sh'")).toBe(true);
      expect(answer.repair).toContain('.plot/worker-prompt.sh');
      expect(answer.repair).toContain('plot-install-prompt.sh');
    });

    it.each([
      ['a command that returns at once', 'true'],
      ['a name that only contains the loop', 'bash my-plot-worker-loop.sh.bak'],
      ['a prefixed name', 'old-plot-worker-loop.sh'],
      ['a different script', 'skills/plot/scripts/plot-worker-loop.bash'],
    ])('refuses %s for a free agent', (_label, configured) => {
      expect(startCommand(configured, LOOP, 'free').start).toBe('refused');
    });
  });
});
