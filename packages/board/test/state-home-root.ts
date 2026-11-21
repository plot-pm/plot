import { execFileSync } from 'node:child_process';

import type { StateHome } from '@plot-pm/domain';
import { stateHomeAtSync } from '@plot-pm/domain/adapters/main-checkout';

/**
 * Initialise a git repository at `dir` and answer its state home.
 *
 * @param dir - an existing empty directory
 * @returns the state home `stateHomeAtSync` reads for `dir`
 * @throws where `git init` fails or the directory reads no state home
 */
export const gitStateHome = (dir: string): StateHome => {
  execFileSync('git', ['init', '-q', dir], { stdio: 'ignore' });
  const answer = stateHomeAtSync(dir);
  if (!('home' in answer)) throw new Error(`no state home under ${dir}`);
  return answer.home;
};
