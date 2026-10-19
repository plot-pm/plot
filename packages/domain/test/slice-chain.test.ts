import { describe, expect, it } from 'vitest';
import { isChainedHeading, type ChainedBranchLine } from '../src/rules/slice-chain.js';

describe('isChainedHeading', () => {
  it('reads a heading of one branch as a chain', () => {
    expect(isChainedHeading([{ branch: 'bug/a' }])).toBe(true);
  });

  it('reads an empty heading as a chain', () => {
    expect(isChainedHeading([])).toBe(true);
  });

  it('chains two branches where the second waits on the first', () => {
    const branches: ChainedBranchLine[] = [
      { branch: 'bug/a' },
      { branch: 'bug/b', waits_on: ['bug/a'] },
    ];
    expect(isChainedHeading(branches)).toBe(true);
  });

  it('stays uncut for two branches with no waits between them', () => {
    const branches: ChainedBranchLine[] = [{ branch: 'bug/a' }, { branch: 'bug/b' }];
    expect(isChainedHeading(branches)).toBe(false);
  });

  it('stays uncut when only one of three branches carries a waits', () => {
    // A heading of three where only two chain: catches a rule that tests pairs.
    const branches: ChainedBranchLine[] = [
      { branch: 'bug/a' },
      { branch: 'bug/b', waits_on: ['bug/a'] },
      { branch: 'bug/c' },
    ];
    expect(isChainedHeading(branches)).toBe(false);
  });

  it('chains three branches, each waiting on the one before', () => {
    const branches: ChainedBranchLine[] = [
      { branch: 'bug/a' },
      { branch: 'bug/b', waits_on: ['bug/a'] },
      { branch: 'bug/c', waits_on: ['bug/b'] },
    ];
    expect(isChainedHeading(branches)).toBe(true);
  });

  it('breaks the chain when the last branch waits on the first rather than the second', () => {
    const branches: ChainedBranchLine[] = [
      { branch: 'bug/a' },
      { branch: 'bug/b', waits_on: ['bug/a'] },
      { branch: 'bug/c', waits_on: ['bug/a'] },
    ];
    expect(isChainedHeading(branches)).toBe(false);
  });

  it('does not chain on a waits naming a branch under another heading', () => {
    const branches: ChainedBranchLine[] = [
      { branch: 'bug/a' },
      { branch: 'bug/b', waits_on: ['bug/elsewhere'] },
    ];
    expect(isChainedHeading(branches)).toBe(false);
  });

  it('reads an empty waits_on as waiting on nothing', () => {
    const branches: ChainedBranchLine[] = [
      { branch: 'bug/a' },
      { branch: 'bug/b', waits_on: [] },
    ];
    expect(isChainedHeading(branches)).toBe(false);
  });

  it('chains a waits_on carrying several names, one of which is the prior branch', () => {
    const branches: ChainedBranchLine[] = [
      { branch: 'bug/a' },
      { branch: 'bug/b', waits_on: ['bug/elsewhere', 'bug/a'] },
    ];
    expect(isChainedHeading(branches)).toBe(true);
  });

  it('reads the two real fixtures from manifest-retry-and-race-findings as chains', () => {
    // `### Start and stop`: the first branch's prerequisite lives under a
    // different heading, which does not matter here — the rule only asks
    // whether EACH branch chains onto the branch immediately before it in
    // THIS heading, and the first branch has none to chain onto.
    const startAndStop: ChainedBranchLine[] = [
      { branch: 'bug/a-continue-starts-one-loop', waits_on: ['bug/the-implement-lock-covers-its-start'] },
      { branch: 'bug/a-failed-continue-leaves-its-desk-whole', waits_on: ['bug/a-continue-starts-one-loop'] },
    ];
    expect(isChainedHeading(startAndStop)).toBe(true);

    const continuation: ChainedBranchLine[] = [
      { branch: 'bug/a-continuation-obeys-the-limits' },
      { branch: 'bug/an-unstarted-continue-resumes-no-stranger', waits_on: ['bug/a-continuation-obeys-the-limits'] },
    ];
    expect(isChainedHeading(continuation)).toBe(true);
  });
});
