import { describe, expect, it } from 'vitest';
import {
  controllerRefusal,
  mayRunController,
  unpinnedMerge,
  unpinnedMergeRefusal,
  withoutQuotedHeredocs,
} from '../src/rules/controller-gate.js';
import { controllerInvocation } from '../src/rules/ci-suite.js';

describe('withoutQuotedHeredocs', () => {
  it('drops the body of a single-quoted heredoc and keeps the opener and terminator', () => {
    const command = "cat <<'EOF'\nplot-deliver.sh x\nEOF\nls";
    expect(withoutQuotedHeredocs(command)).toBe("cat <<'EOF'\nEOF\nls");
  });

  it('accepts <<- with a tab-indented terminator', () => {
    expect(withoutQuotedHeredocs("cat <<-'END'\n\tbody\n\tEND\nls")).toBe("cat <<-'END'\n\tEND\nls");
  });

  it('keeps an unquoted or double-quoted body', () => {
    const unquoted = 'cat <<EOF\nplot-deliver.sh x\nEOF';
    expect(withoutQuotedHeredocs(unquoted)).toBe(unquoted);
    const double = 'cat <<"EOF"\nplot-deliver.sh x\nEOF';
    expect(withoutQuotedHeredocs(double)).toBe(double);
  });
});

describe('mayRunController', () => {
  it.each(['bash plot-deliver.sh x', 'node board/plot-approve.mjs x', 'bash *.sh', 'node b/plot-appro?e.mjs', 'gh pr merge 1', 'plot-host.sh pr-merge 1'])(
    'passes %s',
    (command) => expect(mayRunController(command)).toBe(true),
  );

  it.each(['ls -la', 'git commit -m x', 'pnpm test'])('skips %s', (command) => expect(mayRunController(command)).toBe(false));
});

describe('unpinnedMerge', () => {
  it.each([
    'gh pr merge 12 --squash',
    'gh pr merge 12',
    'gh -R o/r pr merge 12',
    'bash skills/plot/scripts/plot-host.sh pr-merge 12',
    'cd x && gh pr merge 12 --squash --delete-branch',
  ])('refuses %s', (command) => expect(unpinnedMerge(command)).toBe(true));

  it.each([
    'gh pr merge 12 --squash --match-head-commit abc123',
    'gh pr merge 12 --match-head abc123',
    'bash plot-host.sh pr-merge 12 --match-head-commit abc',
    'gh pr view 12',
    'gh pr list --search merge',
    'git commit -m "gh pr merge 12"',
    'git grep -l "gh pr merge"',
    'ls gh pr merge',
  ])('allows %s', (command) => expect(unpinnedMerge(command)).toBe(false));

  it('leaves controllerInvocation null for a merge', () => {
    expect(controllerInvocation('gh pr merge 123 --squash')).toBeNull();
  });
});

describe('the refusal texts', () => {
  const dir = '/plugins/plot/skills/plot/scripts';

  it('names the endpoint first for approve, deliver and release, and no bundle', () => {
    expect(controllerRefusal('approve', dir)).toContain('POST /api/approve {"slug":"<slug>"}');
    expect(controllerRefusal('deliver', dir)).toContain('POST /api/deliver {"slug":"<slug>"}');
    expect(controllerRefusal('release', dir)).toContain('POST /api/release {"slug":"<slug>","version":"<version>"}');
    for (const action of ['approve', 'deliver', 'release'] as const) {
      expect(controllerRefusal(action, dir)).not.toContain('.mjs');
    }
  });

  it('names the bundle for dispatch only', () => {
    expect(controllerRefusal('dispatch', dir)).toContain(`node ${dir}/board/plot-dispatch-command.mjs <slug>`);
  });

  it('names the two-call order and the receipt command', () => {
    const text = controllerRefusal('approve', dir);
    expect(text).toContain(`1. bash ${dir}/plot-state-receipt.sh --unowned-action approve <slug> "<reason>"`);
    expect(text).toContain('TWO calls');
  });

  it('quotes a path with a space as one word', () => {
    expect(controllerRefusal('approve', '/a b/scripts')).toContain("bash '/a b/scripts/plot-state-receipt.sh'");
  });

  it('names plot-ask.mjs merge for an unpinned merge', () => {
    expect(unpinnedMergeRefusal(dir)).toContain(`node ${dir}/board/plot-ask.mjs merge <pr> <sha>`);
  });
});
