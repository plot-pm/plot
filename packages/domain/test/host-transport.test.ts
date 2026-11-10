import { describe, expect, it } from 'vitest';

import {
  HOST_TRANSPORT_ENV,
  hostTransportLine,
  hostTransportOf,
  hostTransportStatusLine,
  shellReasonOf,
} from '../src/rules/host-transport.js';

const github = { backend: 'github', ci: 'github-actions', override: undefined, inProcessBackends: ['github'], shellCi: ['jenkins'] } as const;

describe('shellReasonOf', () => {
  it('names the switch where PLOT_HOST_TRANSPORT is shell', () => {
    expect(HOST_TRANSPORT_ENV).toBe('PLOT_HOST_TRANSPORT');
    expect(shellReasonOf({ ...github, override: 'shell' })).toBe('PLOT_HOST_TRANSPORT=shell');
    expect(shellReasonOf({ ...github, override: ' Shell ' })).toBe('PLOT_HOST_TRANSPORT=shell');
  });

  it('keeps the shell for a Bitbucket repository and for an unknown backend', () => {
    expect(shellReasonOf({ ...github, backend: 'bitbucket' })).toBe('the git host is bitbucket');
    expect(shellReasonOf({ ...github, backend: null })).toBe('the git host did not answer');
  });

  it('keeps the shell for a GitHub repository with CI: jenkins', () => {
    expect(shellReasonOf({ ...github, ci: ' Jenkins ' })).toMatch(/^CI is jenkins/);
  });

  it('answers null where nothing keeps the shell, an unknown switch value included', () => {
    expect(shellReasonOf(github)).toBeNull();
    expect(shellReasonOf({ ...github, override: '' })).toBeNull();
    expect(shellReasonOf({ ...github, override: 'in-process' })).toBeNull();
    expect(shellReasonOf({ ...github, ci: '' })).toBeNull();
  });
});

describe('hostTransportOf', () => {
  it('picks the in-process reads on GitHub with a token, and names its source', () => {
    expect(hostTransportOf({ ...github, tokenSource: 'GH_TOKEN' })).toEqual({
      transport: 'in-process',
      reason: 'the git host is github',
      tokenSource: 'GH_TOKEN',
    });
  });

  it('picks the shell where no token resolves', () => {
    expect(hostTransportOf({ ...github, tokenSource: null })).toEqual({
      transport: 'shell',
      reason: 'no token: GH_TOKEN, GITHUB_TOKEN and gh auth token answered none',
      tokenSource: null,
    });
  });

  it('picks the shell for github with CI: jenkins whatever the token', () => {
    const choice = hostTransportOf({ ...github, ci: 'jenkins', tokenSource: 'gh auth token' });
    expect(choice.transport).toBe('shell');
    expect(choice.reason).toMatch(/^CI is jenkins/);
    expect(choice.tokenSource).toBeNull();
  });

  it('picks the shell where the switch says so, before the backend', () => {
    expect(hostTransportOf({ ...github, backend: 'bitbucket', override: 'shell', tokenSource: null }).reason).toBe(
      'PLOT_HOST_TRANSPORT=shell',
    );
  });
});

describe('hostTransportLine', () => {
  it('names the transport, the reason and the token source, never a token', () => {
    expect(hostTransportLine({ transport: 'in-process', reason: 'the git host is github', tokenSource: 'gh auth token' })).toBe(
      'host reads: in-process (the git host is github; token from gh auth token)',
    );
  });

  it('names no token source for the shell', () => {
    expect(hostTransportLine({ transport: 'shell', reason: 'the git host is bitbucket', tokenSource: null })).toBe(
      'host reads: shell (the git host is bitbucket)',
    );
  });
});

describe('hostTransportStatusLine', () => {
  it('indents the line for --status', () => {
    expect(hostTransportStatusLine({ transport: 'shell', reason: 'PLOT_HOST_TRANSPORT=shell', tokenSource: null })).toBe(
      '  host reads: shell (PLOT_HOST_TRANSPORT=shell)\n',
    );
  });

  it('says so where the heartbeat names no transport', () => {
    expect(hostTransportStatusLine(undefined)).toBe('  host reads: not reported (fleetd published no transport)\n');
  });
});
