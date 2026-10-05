import { describe, expect, it } from 'vitest';
import { pollRefusal, POLL_REFUSAL_PREFIX } from '../src/rules/poll-refusal.js';

describe('pollRefusal', () => {
  it.each([
    ['true', { command: 'true' }],
    ['sleep 60', { command: 'sleep 60' }],
    ['sleep 30 && gh pr checks', { command: 'sleep 30 && gh pr checks' }],
    ['gh run watch', { command: 'gh run watch' }],
    ['ps -p 123', { command: 'ps -p 123' }],
  ])('refuses Bash %s', (_label, input) => {
    const reason = pollRefusal('Bash', input);
    expect(reason).not.toBeNull();
    expect(reason).toMatch(new RegExp(`^${POLL_REFUSAL_PREFIX}`));
  });

  it('refuses a cat of a background task output file', () => {
    const reason = pollRefusal('Bash', { command: 'cat .plot/background-task-123.log' });
    expect(reason).not.toBeNull();
  });

  it('refuses a Read of a background task output file', () => {
    const reason = pollRefusal('Read', { path: '.plot/background-task-456.log' });
    expect(reason).not.toBeNull();
    expect(reason).toMatch(new RegExp(`^${POLL_REFUSAL_PREFIX}`));
  });

  it('allows a Read of an ordinary file', () => {
    expect(pollRefusal('Read', { path: 'packages/domain/src/index.ts' })).toBeNull();
  });

  it('refuses Bash run_in_background true', () => {
    expect(pollRefusal('Bash', { runInBackground: true, command: 'pnpm test' })).not.toBeNull();
  });

  it('refuses Agent run_in_background true', () => {
    expect(pollRefusal('Agent', { runInBackground: true })).not.toBeNull();
  });

  it('allows a foreground pnpm test', () => {
    expect(pollRefusal('Bash', { command: 'pnpm test' })).toBeNull();
  });

  it('allows a foreground Agent call', () => {
    expect(pollRefusal('Agent', { runInBackground: false })).toBeNull();
  });

  it('allows a command that is only separators, which segments to nothing', () => {
    expect(pollRefusal('Bash', { command: '&&' })).toBeNull();
  });

  it('allows gh with no status-reading subcommand', () => {
    expect(pollRefusal('Bash', { command: 'gh pr view' })).toBeNull();
  });

  it('allows gh run list, which is neither run watch nor pr checks', () => {
    expect(pollRefusal('Bash', { command: 'gh run list' })).toBeNull();
  });

  it('refuses gh pr checks on its own', () => {
    expect(pollRefusal('Bash', { command: 'gh pr checks' })).not.toBeNull();
  });
});
