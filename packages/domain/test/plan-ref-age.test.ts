import { describe, it, expect } from 'vitest';
import { serverPlanRefAgeSeconds, pagePlanRefAgeSeconds } from '../src/index.js';

describe('serverPlanRefAgeSeconds', () => {
  it('is null for a null fetchedAt', () => {
    expect(serverPlanRefAgeSeconds(null, 10_000)).toBeNull();
  });

  it('is whole seconds since the fetch', () => {
    expect(serverPlanRefAgeSeconds(1_000, 11_500)).toBe(10);
  });

  it('is never negative for a fetchedAt after nowMs', () => {
    expect(serverPlanRefAgeSeconds(10_000, 1_000)).toBe(0);
  });
});

describe('pagePlanRefAgeSeconds', () => {
  it('is null for a null serverAgeSeconds', () => {
    expect(pagePlanRefAgeSeconds(null, 1_000, 6_000)).toBeNull();
  });

  it('is null for an undefined serverAgeSeconds', () => {
    expect(pagePlanRefAgeSeconds(undefined, 1_000, 6_000)).toBeNull();
  });

  it('equals the server age at the receive time', () => {
    expect(pagePlanRefAgeSeconds(10, 1_000, 1_000)).toBe(10);
  });

  it('adds elapsed whole seconds on the page clock', () => {
    expect(pagePlanRefAgeSeconds(10, 1_000, 6_000)).toBe(15);
  });

  it('is never negative when nowMs precedes receivedAtMs', () => {
    expect(pagePlanRefAgeSeconds(10, 6_000, 1_000)).toBe(10);
  });
});
