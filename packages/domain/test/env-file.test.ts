import { describe, expect, it } from 'vitest';

import { envFileCandidates, pickEnvFile, readEnvVar } from '../src/rules/env-file.js';

describe('readEnvVar', () => {
  it('reads the first assignment, with export, quotes and surrounding whitespace removed', () => {
    expect(readEnvVar('A=1\nexport  B="two"  \nB=3\n', 'B')).toBe('two');
  });

  it('answers the empty string where the name is absent', () => {
    expect(readEnvVar('A=1\n', 'B')).toBe('');
  });

  it('escapes a name that carries regular-expression characters', () => {
    expect(readEnvVar('A.B=1\nAxB=2\n', 'A.B')).toBe('1');
  });

  it('keeps an assignment whose value is missing as the empty string', () => {
    expect(readEnvVar('A=\n', 'A')).toBe('');
  });
});

describe('envFileCandidates', () => {
  it('lists the worktree .env, then the parent of the common git directory', () => {
    expect(envFileCandidates('/r/desk', '/r/main/.git')).toEqual([
      { path: '/r/desk/.env', source: 'worktree' },
      { path: '/r/main/.env', source: 'main-checkout' },
    ]);
  });

  it('reads an unknown top level as the current directory', () => {
    expect(envFileCandidates(null, null)).toEqual([{ path: './.env', source: 'worktree' }]);
    expect(envFileCandidates('', '')).toEqual([{ path: './.env', source: 'worktree' }]);
  });

  it('takes the directory part as dirname does', () => {
    const main = (common: string): string | undefined => envFileCandidates('/t', common)[1]?.path;
    expect(main('/r/main/.git/')).toBe('/r/main/.env');
    expect(main('/.git')).toBe('//.env');
    expect(main('/')).toBe('//.env');
    expect(main('.git')).toBe('./.env');
    expect(main('///')).toBe('//.env');
  });
});

describe('pickEnvFile', () => {
  const candidate = (path: string, source: 'worktree' | 'main-checkout') => ({ path, source });

  it('skips an unreadable file and a file holding half the pair', () => {
    const picked = pickEnvFile(
      [
        { candidate: candidate('/a/.env', 'worktree'), text: null },
        { candidate: candidate('/b/.env', 'worktree'), text: 'X=1\n' },
        { candidate: candidate('/c/.env', 'main-checkout'), text: 'X=1\nY=2\n' },
      ],
      ['X', 'Y'],
    );
    expect(picked).toEqual({ path: '/c/.env', source: 'main-checkout', values: ['1', '2'] });
  });

  it('answers null where no file holds both', () => {
    expect(pickEnvFile([{ candidate: candidate('/a/.env', 'worktree'), text: 'X=1\nY=\n' }], ['X', 'Y'])).toBeNull();
  });
});
