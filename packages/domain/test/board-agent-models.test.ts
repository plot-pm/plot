import { describe, expect, it } from 'vitest';
import { boardAgentModel, type BoardAgentModelReading } from '../src/rules/board-agent-models.js';

const reading = (over: Partial<BoardAgentModelReading> = {}): BoardAgentModelReading => ({
  agentModels: '',
  roleCommand: '',
  ...over,
});

describe('boardAgentModel', () => {
  it("takes the role's own Agent models entry over its fragment's --model flag", () => {
    const out = boardAgentModel('idea', reading({ agentModels: 'idea = opus', roleCommand: 'claude --model sonnet' }));
    expect(out).toEqual({ model: 'opus', modelSource: 'agent-models' });
  });

  it('runs on the model its own fragment names, with no Agent models entry for the role', () => {
    const out = boardAgentModel('brief', reading({ roleCommand: 'claude --model sonnet -p' }));
    expect(out).toEqual({ model: 'sonnet', modelSource: 'role-command' });
  });

  it('reads PLOT_MODEL= from the fragment the same way', () => {
    const out = boardAgentModel('implement', reading({ roleCommand: 'PLOT_MODEL=haiku claude -p' }));
    expect(out).toEqual({ model: 'haiku', modelSource: 'role-command' });
  });

  it("does not answer another role's Agent models entry", () => {
    const out = boardAgentModel('idea', reading({ agentModels: 'worker = sonnet; commission = opus' }));
    expect(out).toEqual({ model: '', modelSource: 'default' });
  });

  it('leaves the CLI default where nothing names a model', () => {
    const out = boardAgentModel('deliver', reading({ roleCommand: 'claude -p' }));
    expect(out).toEqual({ model: '', modelSource: 'default' });
  });
});
