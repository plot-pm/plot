import { describe, expect, it } from 'vitest';
import { composeJenkins, type JenkinsComposition } from '@plot-pm/domain/adapters/build/jenkins-api';
import { hostTransportLine } from '@plot-pm/domain/rules/host-transport';
import { jenkinsTransportOf, withJenkinsTransport } from '../../src/server/entry/registryd-main.js';

const instance = async (): Promise<string> => 'jenkins.example.org/team/portal';
const choice = { transport: 'in-process', reason: 'a token resolved', tokenSource: 'GH_TOKEN' } as const;

describe('fleetd chooses the Jenkins transport once, at start', () => {
  it('has none where CI is not jenkins, and composes nothing', async () => {
    const lines: string[] = [];
    const composed = await jenkinsTransportOf('github-actions', {}, instance, (line) => lines.push(line), () => {
      throw new Error('composed');
    });
    expect(composed).toBeNull();
    expect(lines).toEqual([]);
  });

  it('keeps the shell under PLOT_HOST_TRANSPORT=shell, logs the reason and composes nothing', async () => {
    const lines: string[] = [];
    const composed = await jenkinsTransportOf('Jenkins', { PLOT_HOST_TRANSPORT: 'shell' }, instance, (line) => lines.push(line), () => {
      throw new Error('composed');
    });
    expect(composed).toEqual({ kind: 'shell', reason: 'PLOT_HOST_TRANSPORT=shell' });
    expect(lines).toEqual(['plot-fleetd: Jenkins reads stay on the shell: PLOT_HOST_TRANSPORT=shell\n']);
  });

  it('keeps the shell with no credential, and logs the reason in one line', async () => {
    const lines: string[] = [];
    const home = '/nonexistent/plot-fleetd-no-credential';
    const composed = await jenkinsTransportOf(
      'jenkins',
      {},
      instance,
      (line) => lines.push(line),
      (options, log) => composeJenkins({ ...options, env: { HOME: home, JEN_CONFIG_DIR: home }, instance: 'jenkins.example.org' }, log),
    );
    expect(composed?.kind).toBe('shell');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^plot-fleetd: Jenkins reads stay on the shell: /);
  });

  it('names the in-process transport and the credential source in the start line and the status line', () => {
    const inProcess = { kind: 'in-process', api: {}, source: 'jen-store', dir: '/home/me/.config/jen' } as unknown as JenkinsComposition;
    const extended = withJenkinsTransport(choice, inProcess);
    expect(extended.reason).toBe('a token resolved; Jenkins reads: in-process (credentials from /home/me/.config/jen)');
    expect(hostTransportLine(extended)).toContain('Jenkins reads: in-process (credentials from /home/me/.config/jen)');
  });

  it('names the shell and its reason beside the host transport', () => {
    const extended = withJenkinsTransport(choice, { kind: 'shell', reason: 'no credential' });
    expect(extended.reason).toBe('a token resolved; Jenkins reads: shell (no credential)');
    expect(hostTransportLine(extended)).toContain('Jenkins reads: shell (no credential)');
  });

  it('leaves the choice alone where the repository does not use Jenkins', () => {
    expect(withJenkinsTransport(choice, null)).toBe(choice);
  });
});
