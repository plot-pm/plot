import { describe, expect, it } from 'vitest';
import { fragmentStrictMcp } from '../src/rules/fragment-strict-mcp.js';

describe('fragmentStrictMcp', () => {
  it('answers true where the fragment names --strict-mcp-config', () => {
    expect(fragmentStrictMcp('claude -p --model sonnet --strict-mcp-config --permission-mode bypassPermissions')).toBe(true);
  });

  it('answers false for a fragment without the flag', () => {
    expect(fragmentStrictMcp('claude -p --model sonnet --permission-mode bypassPermissions')).toBe(false);
  });

  it('answers false for an empty fragment', () => {
    expect(fragmentStrictMcp('')).toBe(false);
  });

  it('answers false for a longer flag that starts with the name', () => {
    expect(fragmentStrictMcp('claude -p --strict-mcp-config-x')).toBe(false);
  });
});
