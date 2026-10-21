import { describe, expect, it } from 'vitest';
import { checkoutHealthStatus } from '../src/rules/checkout-health.js';

describe('checkoutHealthStatus', () => {
  it('reports nothing when the checkout is clean and not behind', () => {
    expect(checkoutHealthStatus(true, 0)).toBeNull();
  });

  it('reports nothing when neither reading can be taken', () => {
    expect(checkoutHealthStatus(null, null)).toBeNull();
  });

  it('warns rose when the checkout is dirty', () => {
    const status = checkoutHealthStatus(false, 0);
    expect(status).not.toBeNull();
    expect(status?.tone).toBe('rose');
    expect(status?.text).toContain('uncommitted changes');
  });

  it('warns amber when the checkout is only behind', () => {
    const status = checkoutHealthStatus(true, 3);
    expect(status).not.toBeNull();
    expect(status?.tone).toBe('amber');
    expect(status?.text).toContain('3 commits behind');
  });

  it('uses the singular for exactly one commit behind', () => {
    expect(checkoutHealthStatus(true, 1)?.text).toContain('1 commit behind');
  });

  it('names both problems when dirty and behind at once', () => {
    const status = checkoutHealthStatus(false, 2);
    expect(status?.text).toContain('uncommitted changes');
    expect(status?.text).toContain('2 commits behind');
    expect(status?.tone).toBe('rose');
  });

  it('does not warn on an unreadable dirty state alone', () => {
    expect(checkoutHealthStatus(null, 0)).toBeNull();
  });

  it('does not warn on an unreadable behind state alone', () => {
    expect(checkoutHealthStatus(true, null)).toBeNull();
  });

  it('carries a stable key for status-panel identity', () => {
    expect(checkoutHealthStatus(false, null)?.key).toBe('checkout-health');
  });
});
