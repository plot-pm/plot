// `agentRunFor` reading a board role's fragment into `strictMcp`. No process
// starts: the config reader is injected and the connectors are only built.
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRun } from '@plot-pm/domain/ports/agent-run';
import { agentRunFor, useSdkConnector } from '../../src/shared/agent-run-for.js';

const opts = { repoRoot: '/estate', scriptsDir: '/estate/skills/plot/scripts' };
const config = (values: Record<string, string>) => (_opts: unknown, key: string, fallback: string) =>
  values[key] ?? fallback;
const STRICT = 'claude -p --model sonnet --strict-mcp-config --permission-mode bypassPermissions';
const LOOSE = 'claude -p --model sonnet --permission-mode bypassPermissions';

describe('agentRunFor: strictMcp follows the role fragment', () => {
  afterEach(() => useSdkConnector(undefined));

  it('answers true on the command runner where the fragment names --strict-mcp-config', async () => {
    const got = await agentRunFor(opts, 'idea', 'Idea command', config({ 'Idea command': STRICT, 'Agent runner': 'command' }));
    expect(got).toMatchObject({ runner: 'command', strictMcp: true });
  });

  it('answers false where the fragment does not name it', async () => {
    const got = await agentRunFor(opts, 'idea', 'Idea command', config({ 'Idea command': LOOSE, 'Agent runner': 'command' }));
    expect(got).toMatchObject({ runner: 'command', strictMcp: false });
  });

  it('carries the reading on the SDK runner', async () => {
    useSdkConnector(async () => ({}) as AgentRun);
    const strict = await agentRunFor(opts, 'brief', 'Brief command', config({ 'Brief command': STRICT, 'Agent runner': 'sdk' }));
    expect(strict).toMatchObject({ runner: 'sdk', strictMcp: true });
    const loose = await agentRunFor(opts, 'brief', 'Brief command', config({ 'Brief command': LOOSE, 'Agent runner': 'sdk' }));
    expect(loose).toMatchObject({ runner: 'sdk', strictMcp: false });
  });

  it('answers false for a role with no fragment', async () => {
    const got = await agentRunFor(opts, 'idea', 'Idea command', config({}));
    expect(got.strictMcp).toBe(false);
  });
});
