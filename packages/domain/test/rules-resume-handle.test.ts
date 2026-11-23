import { describe, expect, it } from 'vitest';
import { resumeHandleUsable, type TranscriptHead } from '../src/rules/resume-handle.js';
import { ROLE_NAMES, roleCommand, type RoleName } from '../src/rules/role-command.js';

const H = '72aebb9c-09e4-4d6f-a6ab-e52846c8963c';
const BRANCH = 'bug/fleetd-counts-in-the-bb-ledger';

const head = (firstLine: string, gitBranch = ''): TranscriptHead => ({ firstLine, gitBranch });

const ask = (over: { handle?: string; roleSessions?: ReadonlySet<string>; head?: TranscriptHead | null } = {}) =>
  resumeHandleUsable({ handle: H, branch: BRANCH, roleSessions: new Set(), head: null, ...over });

/** The `--agent` argument the launch side passes for a role, read off the command it builds. */
const agentArgument = (name: RoleName): string => {
  const built = roleCommand({ name, agentsFile: '/tmp/agents.json', settingsFile: '/tmp/settings.json' }, 0);
  if (built.read !== 'command') throw new Error(built.why);
  const match = / --agent (\S+) /.exec(built.command);
  if (match === null) throw new Error(`no --agent argument in ${built.command}`);
  return match[1];
};

describe('resumeHandleUsable', () => {
  it('rejects an empty handle as empty', () => {
    expect(ask({ handle: '' })).toEqual({ usable: false, why: 'empty' });
  });

  it('rejects a handle the role-session record lists', () => {
    expect(ask({ roleSessions: new Set([H]) })).toEqual({ usable: false, why: 'role-listed' });
  });

  it.each(ROLE_NAMES)('rejects a transcript opened by the %s role', (name) => {
    const line = JSON.stringify({ type: 'agent-setting', agentSetting: agentArgument(name), sessionId: H });
    expect(ask({ head: head(line, BRANCH) })).toEqual({ usable: false, why: 'role-transcript' });
  });

  it('keeps a transcript whose agent-setting names no declared role', () => {
    const line = JSON.stringify({ type: 'agent-setting', agentSetting: 'implementer', sessionId: H });
    expect(ask({ head: head(line) })).toEqual({ usable: true });
  });

  it('keeps a queue-operation first line, an unparseable line and a missing transcript', () => {
    expect(ask({ head: head(JSON.stringify({ type: 'queue-operation', operation: 'enqueue' })) })).toEqual({ usable: true });
    expect(ask({ head: head('{"type":"agent-setting",') })).toEqual({ usable: true });
    expect(ask({ head: null })).toEqual({ usable: true });
  });

  it('keeps a first line that parses to JSON null or to a scalar', () => {
    expect(ask({ head: head('null') })).toEqual({ usable: true });
    expect(ask({ head: head('"agent-setting"') })).toEqual({ usable: true });
  });

  it('rejects a transcript recorded on another branch', () => {
    const line = JSON.stringify({ type: 'queue-operation' });
    expect(ask({ head: head(line, 'feature/the-fixer-scope-reads-every-open-pr') })).toEqual({ usable: false, why: 'other-branch' });
  });

  it('keeps a transcript on the same branch and one with no gitBranch', () => {
    const line = JSON.stringify({ type: 'queue-operation' });
    expect(ask({ head: head(line, BRANCH) })).toEqual({ usable: true });
    expect(ask({ head: head(line, '') })).toEqual({ usable: true });
  });
});
