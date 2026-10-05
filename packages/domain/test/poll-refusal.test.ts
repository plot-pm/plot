import { describe, expect, it } from 'vitest';
import { pollRefusal, POLL_REFUSAL_PREFIX } from '../src/rules/poll-refusal.js';

const TASK_OUTPUT = '/private/tmp/claude-501/-Users-me-project/3f2a9c1e-session/tasks/b8k2.output';

describe('pollRefusal', () => {
  it.each([
    ['true', 'true'],
    ['sleep 60', 'sleep 60'],
    ['sleep 30 && gh pr checks', 'sleep 30 && gh pr checks'],
    ['gh run watch', 'gh run watch'],
    ['gh pr checks', 'gh pr checks'],
    ['ps -p 123', 'ps -p 123'],
    ['a while loop around gh pr checks', 'while ! gh pr checks; do sleep 30; done'],
    ['an until loop around gh pr checks', 'until gh pr checks 12; do sleep 10; done'],
    ['newline-separated sleep and gh pr checks', 'sleep 60\ngh pr checks 12'],
    ['sleep || true', 'sleep 5 || true'],
    ['a bare wait', 'wait'],
    ['a trailing-& background start', 'pnpm test > /tmp/o.log 2>&1 &'],
    ['a cat of a background task output file', `cat ${TASK_OUTPUT}`],
    ['a tail of a background task output file', `tail -n 50 ${TASK_OUTPUT}`],
    ['sleep then a head of a background task output file', `sleep 20; head ${TASK_OUTPUT}`],
    ['a less of a background task output file', `less ${TASK_OUTPUT}`],
  ])('refuses Bash: %s', (_label, command) => {
    const reason = pollRefusal('Bash', { command });
    expect(reason).not.toBeNull();
    expect(reason).toMatch(new RegExp(`^${POLL_REFUSAL_PREFIX}`));
  });

  it.each([
    ['a foreground pnpm test', 'pnpm test'],
    ['git diff with a true fallback', 'git diff --stat || true'],
    ['a build, a short sleep, then a script', 'pnpm build && sleep 1 && node x.js'],
    ['ps aux piped to grep', 'ps aux | grep vitest'],
    ['a redirect into 2>&1 run in the foreground', 'pnpm test > /tmp/o.log 2>&1'],
    ['gh pr view', 'gh pr view'],
    ['gh run list', 'gh run list'],
    ['a cat of an ordinary file', 'cat packages/domain/src/index.ts'],
    ['a command that is only separators', '&&'],
    ['an if around gh pr checks that does other work', 'if gh pr checks; then echo ok; fi'],
  ])('allows Bash: %s', (_label, command) => {
    expect(pollRefusal('Bash', { command })).toBeNull();
  });

  it('refuses a Read of a background task output file', () => {
    const reason = pollRefusal('Read', { path: TASK_OUTPUT });
    expect(reason).toMatch(new RegExp(`^${POLL_REFUSAL_PREFIX}`));
  });

  it('allows a Read of an ordinary file, and of a file merely named .output', () => {
    expect(pollRefusal('Read', { path: 'packages/domain/src/index.ts' })).toBeNull();
    expect(pollRefusal('Read', { path: '/repo/build.output' })).toBeNull();
  });

  it('refuses Bash run_in_background true', () => {
    expect(pollRefusal('Bash', { runInBackground: true, command: 'pnpm test' })).not.toBeNull();
  });

  it('refuses Agent run_in_background true', () => {
    expect(pollRefusal('Agent', { runInBackground: true })).not.toBeNull();
  });

  it('allows a foreground Agent call', () => {
    expect(pollRefusal('Agent', { runInBackground: false })).toBeNull();
  });

  it('allows a Bash call with an empty command', () => {
    expect(pollRefusal('Bash', { command: '' })).toBeNull();
  });

  it('names the CI status read rather than the sleep beside it', () => {
    expect(pollRefusal('Bash', { command: 'sleep 30 && gh pr checks' })).toContain('`gh pr checks`');
  });
});
