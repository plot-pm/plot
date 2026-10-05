import { describe, expect, it } from 'vitest';
import {
  agentRunEnv,
  backgroundSwitchRefusal,
  BACKGROUND_TASKS_ENV_VAR,
  type SettingsEnvReading,
} from '../src/rules/agent-run-env.js';

describe('agentRunEnv', () => {
  it('merges the inherited environment with the PLOT_* values rather than replacing it', () => {
    const inherited = { PATH: '/usr/bin:/bin', HOME: '/home/op', LANG: 'en_US.UTF-8' };
    const plotEnv = { PLOT_BRANCH: 'infra/x', PLOT_WORKTREE: '/estate/.worktrees/x' };

    const result = agentRunEnv(inherited, plotEnv);

    expect(result.PATH).toBe('/usr/bin:/bin');
    expect(result.HOME).toBe('/home/op');
    expect(result.LANG).toBe('en_US.UTF-8');
    expect(result.PLOT_BRANCH).toBe('infra/x');
    expect(result.PLOT_WORKTREE).toBe('/estate/.worktrees/x');
  });

  it('forces the background-task switch to 1', () => {
    const result = agentRunEnv({ PATH: '/bin' }, {});
    expect(result[BACKGROUND_TASKS_ENV_VAR]).toBe('1');
  });

  // THE DEFECT A NAIVE REPLACE WOULD CAUSE: the SDK's own `env` option
  // REPLACES the child's environment rather than merging it (sdk.d.ts:1647).
  // A child missing PATH runs the plugin gates fail-open.
  it('given an input with a PLOT_BRANCH and a PATH, returns both', () => {
    const result = agentRunEnv({ PATH: '/usr/bin' }, { PLOT_BRANCH: 'infra/x' });
    expect(result.PATH).toBe('/usr/bin');
    expect(result.PLOT_BRANCH).toBe('infra/x');
  });

  it('fails for an output lacking PATH, HOME or a PLOT_* name of the input', () => {
    const inherited = { PATH: '/usr/bin', HOME: '/home/op' };
    const plotEnv = { PLOT_BRANCH: 'infra/x', PLOT_AGENT: 'worker-1' };
    const result = agentRunEnv(inherited, plotEnv);

    for (const key of ['PATH', 'HOME', 'PLOT_BRANCH', 'PLOT_AGENT']) {
      expect(result).toHaveProperty(key);
    }
    // An implementation that dropped any one of these would fail this
    // assertion — the test exists to catch that, not to describe behaviour
    // this rule doesn't have.
    expect(Object.keys(result).length).toBeGreaterThanOrEqual(5);
  });
});

describe('backgroundSwitchRefusal', () => {
  const reading = (path: string, env: Readonly<Record<string, string>>): SettingsEnvReading => ({
    path,
    env,
  });

  it('refuses when a project settings file sets the switch to 0, and names the file', () => {
    const envs = [
      reading('~/.claude/settings.json', {}),
      reading('.claude/settings.json', { [BACKGROUND_TASKS_ENV_VAR]: '0' }),
      reading('.claude/settings.local.json', {}),
    ];

    const refusal = backgroundSwitchRefusal(envs);
    expect(refusal).not.toBeNull();
    expect(refusal).toContain('.claude/settings.json');
    expect(refusal).toContain(BACKGROUND_TASKS_ENV_VAR);
  });

  it('allows a run whose three settings files name no switch at all', () => {
    const envs = [
      reading('~/.claude/settings.json', {}),
      reading('.claude/settings.json', { SOME_OTHER_KEY: 'x' }),
      reading('.claude/settings.local.json', {}),
    ];

    expect(backgroundSwitchRefusal(envs)).toBeNull();
  });

  it('refuses even when the switch is set to 1 — a stated key can be flipped later', () => {
    const envs = [reading('.claude/settings.json', { [BACKGROUND_TASKS_ENV_VAR]: '1' })];
    expect(backgroundSwitchRefusal(envs)).not.toBeNull();
  });
});
