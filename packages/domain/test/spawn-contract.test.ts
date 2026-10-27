import { describe, expect, it } from 'vitest';
import {
  SPAWN_CONTRACT,
  SPAWN_CONTRACT_ENV,
  spawnContractEnv,
  spawnContractReading,
} from '../src/rules/spawn-contract.js';

describe('spawnContractEnv', () => {
  it('carries SPAWN_CONTRACT under SPAWN_CONTRACT_ENV', () => {
    expect(spawnContractEnv()).toEqual({ [SPAWN_CONTRACT_ENV]: String(SPAWN_CONTRACT) });
  });
});

describe('spawnContractReading', () => {
  it('reads an unset variable as absent', () => {
    expect(spawnContractReading({})).toBe('absent');
  });

  it('reads a variable set to the empty string as empty', () => {
    expect(spawnContractReading({ [SPAWN_CONTRACT_ENV]: '' })).toBe('empty');
  });

  it.each(['x', '0'])('reads %s as unreadable', (value) => {
    expect(spawnContractReading({ [SPAWN_CONTRACT_ENV]: value })).toBe('unreadable');
  });

  it('reads a positive integer string as its number', () => {
    expect(spawnContractReading({ [SPAWN_CONTRACT_ENV]: '3' })).toEqual({ number: 3 });
  });
});
