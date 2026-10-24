import { describe, expect, it } from 'vitest';
import { gatesBriefPush, pushesBriefBranch } from '../src/rules/brief-push.js';

const B = 'bug/the-slice';

describe('pushesBriefBranch', () => {
  it.each([
    ['git push -u origin bug/the-slice', 'main'],
    ['git push origin bug/the-slice', 'main'],
    ['git push origin HEAD:bug/the-slice', 'main'],
    ['git push origin +bug/the-slice', 'main'],
    ['git push origin refs/heads/x:refs/heads/bug/the-slice', 'main'],
    ['git push', B],
    ['git push origin', B],
    ['git push origin HEAD', B],
    ['git -C /tmp/x push origin HEAD', B],
    ['git add -A && git commit -m x && git push --all', 'main'],
  ])('refuses %s on %s', (command, current) => {
    expect(pushesBriefBranch(command, B, current)).toBe(true);
  });

  it.each([
    ['git push origin main', B],
    ['git push', 'main'],
    ['git push origin HEAD', 'main'],
    ['git status', B],
    ['echo "git push origin bug/the-slice"', 'main'],
  ])('allows %s on %s', (command, current) => {
    expect(pushesBriefBranch(command, B, current)).toBe(false);
  });
});

describe('gatesBriefPush', () => {
  it('applies only to a brief-only run', () => {
    expect(gatesBriefPush({ PLOT_BRIEF_ONLY: '1' })).toBe(true);
    expect(gatesBriefPush({})).toBe(false);
  });
});
