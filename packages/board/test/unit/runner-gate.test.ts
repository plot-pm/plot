import { describe, expect, it } from 'vitest';
import { SDK_NEEDS_JS_LOOP_REASON } from '@plot-pm/domain';
import { sdkLoopRefusal } from '../../src/server/runner-gate.js';

const reader = (values: Record<string, string>) => (key: string, fallback: string) => values[key] ?? fallback;

describe('sdkLoopRefusal', () => {
  it('refuses Agent runner: sdk under Worker loop: shell, and under an absent Worker loop', () => {
    expect(sdkLoopRefusal(reader({ 'Agent runner': 'sdk', 'Worker loop': 'shell', 'Worker command': 'x' }))).toBe(SDK_NEEDS_JS_LOOP_REASON);
    expect(sdkLoopRefusal(reader({ 'Agent runner': 'sdk', 'Worker command': 'x' }))).toBe(SDK_NEEDS_JS_LOOP_REASON);
  });

  it('lets a worker start on sdk under Worker loop: js, with or without a Worker command', () => {
    expect(sdkLoopRefusal(reader({ 'Agent runner': 'sdk', 'Worker loop': 'js', 'Worker command': 'x' }))).toBeNull();
    expect(sdkLoopRefusal(reader({ 'Agent runner': 'sdk', 'Worker loop': 'js' }))).toBeNull();
  });

  it('lets a worker start on command, or with Agent runner absent', () => {
    expect(sdkLoopRefusal(reader({ 'Agent runner': 'command', 'Worker loop': 'shell' }))).toBeNull();
    expect(sdkLoopRefusal(reader({ 'Agent runner': 'bogus' }))).toBeNull();
    expect(sdkLoopRefusal(reader({}))).toBeNull();
  });
});
