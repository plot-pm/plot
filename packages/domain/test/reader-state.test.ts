import { describe, expect, it } from 'vitest';

import {
  decodeReaderState,
  encodeReaderState,
  READER_STATE_VERSION,
  type ReaderState,
} from '../src/entities/reader-state.js';

const state = (overrides: Partial<ReaderState> = {}): ReaderState => ({
  v: READER_STATE_VERSION,
  prError: null,
  prNextAt: 1_756_700_000_000,
  prNextIsBackoff: false,
  prFullReadFailedAt: null,
  at: 1_756_700_000_000,
  ...overrides,
});

describe('reader state codec', () => {
  it('round-trips a state with every field populated', () => {
    const full = state({ prError: 'rate limited', prNextIsBackoff: true, prFullReadFailedAt: 1_756_700_000_500 });
    expect(decodeReaderState(encodeReaderState(full))).toEqual(full);
  });

  it('round-trips a state whose nullable fields are null', () => {
    expect(decodeReaderState(encodeReaderState(state()))).toEqual(state());
  });

  it('reads an empty file as nothing to start from', () => {
    expect(decodeReaderState('')).toBeNull();
    expect(decodeReaderState('   \n')).toBeNull();
  });

  it('reads unparseable text as nothing to start from', () => {
    expect(decodeReaderState('not json')).toBeNull();
  });

  it('reads an unrecognised version as nothing to start from', () => {
    expect(decodeReaderState(JSON.stringify({ ...state(), v: READER_STATE_VERSION + 1 }))).toBeNull();
  });

  it('reads a shape with an extra field as nothing to start from', () => {
    expect(decodeReaderState(JSON.stringify({ ...state(), extra: 'field' }))).toBeNull();
  });

  it('reads a shape missing a field as nothing to start from', () => {
    const { prError, ...rest } = state();
    void prError;
    expect(decodeReaderState(JSON.stringify(rest))).toBeNull();
  });
});
