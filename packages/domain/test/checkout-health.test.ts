import { describe, expect, it } from 'vitest';
import { checkoutHealthStatus } from '../src/rules/checkout-health.js';

describe('checkoutHealthStatus', () => {
  it('reports nothing when the checkout is clean', () => {
    expect(checkoutHealthStatus(true)).toBeNull();
  });

  it('reports nothing when the dirty state cannot be read', () => {
    expect(checkoutHealthStatus(null)).toBeNull();
  });

  it('warns rose when the checkout is dirty', () => {
    const status = checkoutHealthStatus(false);
    expect(status?.tone).toBe('rose');
    expect(status?.text).toContain('uncommitted changes');
  });

  it('does not mention a behind count, which PlanSourceLine shows', () => {
    expect(checkoutHealthStatus(false)?.text).not.toContain('behind');
  });

  it('carries a stable key for status-panel identity', () => {
    expect(checkoutHealthStatus(false)?.key).toBe('checkout-health');
  });
});
