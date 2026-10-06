import { describe, expect, it } from 'vitest';
import { agentModelFor, agentRunSettings, type AgentModelReading } from '../src/rules/agent-models.js';

const reading = (over: Partial<AgentModelReading> = {}): AgentModelReading => ({
  charterModel: '',
  charterEffort: '',
  charterContextWindow: 0,
  agentModels: '',
  workerCommand: '',
  agentContextWindow: 200_000,
  ...over,
});

describe('agentModelFor', () => {
  it('reads the entry for the role asked about', () => {
    expect(agentModelFor('worker = sonnet; idea = opus', 'idea')).toBe('opus');
    expect(agentModelFor('worker = sonnet; idea = opus', 'worker')).toBe('sonnet');
  });

  it('answers empty for an absent list, an absent role and an entry with no name', () => {
    expect(agentModelFor('', 'worker')).toBe('');
    expect(agentModelFor('idea = opus', 'worker')).toBe('');
    expect(agentModelFor('= opus; worker', 'worker')).toBe('');
  });
});

describe('agentRunSettings', () => {
  it('takes the charter model and effort over every config key', () => {
    const out = agentRunSettings(
      reading({ charterModel: 'opus', charterEffort: 'high', agentModels: 'worker = haiku', workerCommand: 'PLOT_MODEL=sonnet x' }),
    );
    expect(out).toEqual({ model: 'opus', modelSource: 'charter', effort: 'high', contextWindow: 200_000 });
  });

  it('takes the Agent models worker entry over the Worker command', () => {
    const out = agentRunSettings(reading({ agentModels: 'worker = haiku', workerCommand: 'PLOT_MODEL=sonnet x' }));
    expect(out.model).toBe('haiku');
    expect(out.modelSource).toBe('agent-models');
  });

  it('keeps the model a Worker command names with PLOT_MODEL=, with no Agent models entry', () => {
    const out = agentRunSettings(
      reading({ workerCommand: 'PLOT_UNATTENDED=1 PLOT_MODEL=sonnet skills/plot/scripts/plot-worker-loop.sh' }),
    );
    expect(out.model).toBe('sonnet');
    expect(out.modelSource).toBe('worker-command');
  });

  it('leaves the CLI default where nothing names a model', () => {
    expect(agentRunSettings(reading({ workerCommand: 'plot-worker-loop.sh' }))).toMatchObject({
      model: '',
      modelSource: 'default',
    });
  });

  it("caps Agent context window by a charter's smaller window, and never raises it", () => {
    expect(agentRunSettings(reading({ charterContextWindow: 100_000 })).contextWindow).toBe(100_000);
    expect(agentRunSettings(reading({ charterContextWindow: 500_000 })).contextWindow).toBe(200_000);
    expect(agentRunSettings(reading({ charterContextWindow: 100_000, agentContextWindow: 0 })).contextWindow).toBe(100_000);
  });
});
