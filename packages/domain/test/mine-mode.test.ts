import { describe, it, expect } from 'vitest';
import { mineMode, type MineModeStorage, type Reader } from '../src/index.js';

const reader: Reader = { hostUser: 'jwloka' };
const storage = (mineOnly?: string, strict?: string): MineModeStorage => ({ mineOnly, strict });

describe('mineMode computes the effective «Mine» mode', () => {
  it('is all where the mineOnly key is absent', () => {
    expect(mineMode(reader, storage())).toBe('all');
  });

  it('is all where the mineOnly key is off', () => {
    expect(mineMode(reader, storage('0'))).toBe('all');
  });

  it('is mine-and-unknown where mineOnly is on and strict is absent', () => {
    expect(mineMode(reader, storage('1'))).toBe('mine-and-unknown');
  });

  it('is mine-and-unknown where mineOnly is on and strict is off', () => {
    expect(mineMode(reader, storage('1', '0'))).toBe('mine-and-unknown');
  });

  it('is mine where both keys are on', () => {
    expect(mineMode(reader, storage('1', '1'))).toBe('mine');
  });

  it('ignores strict while mineOnly is off, never reading mine with Mine off', () => {
    expect(mineMode(reader, storage(undefined, '1'))).toBe('all');
    expect(mineMode(reader, storage('0', '1'))).toBe('all');
  });

  it('reads an unparseable or other-valued key as off, never as an error', () => {
    expect(mineMode(reader, storage('yes'))).toBe('all');
    expect(mineMode(reader, storage('1', 'yes'))).toBe('mine-and-unknown');
  });

  it('is all where comparableLogin is empty, whatever either key holds — a reader with only a git email', () => {
    const emailOnly: Reader = { gitEmail: 'jan.wloka@quatico.com' };
    expect(mineMode(emailOnly, storage('1', '1'))).toBe('all');
  });

  it('is all for an email-shaped hostUser, whatever either key holds', () => {
    const emailLogin: Reader = { hostUser: 'jan.wloka@quatico.com' };
    expect(mineMode(emailLogin, storage('1', '1'))).toBe('all');
  });

  it('is all for a reader with no identity at all', () => {
    expect(mineMode({}, storage('1', '1'))).toBe('all');
  });
});
