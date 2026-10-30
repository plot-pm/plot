import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type { ShellContext } from '../src/adapters/scripts.js';
import { trackerFixture } from '../src/adapters/tracker/tracker-fixture.js';
import { trackerJira } from '../src/adapters/tracker/tracker-jira.js';
import { trackerNone } from '../src/adapters/tracker/tracker-none.js';
import {
  githubPlanStateWrite,
  planStateLabelsToRemove,
  PLAN_STATE_WRITTEN_HOME_ENV,
} from '../src/adapters/tracker/tracker-plan-state.js';
import { planIssueComment } from '../src/rules/plan-issue-comment.js';
import { trackerGithub } from '../src/adapters/tracker/tracker-github.js';
import { isAnswered } from '../src/port-result.js';
import type { PlanStateWrite } from '../src/ports/tracker.js';

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/**
 * A `plot-host.sh` that keeps the issue's labels and one comment in files, so a
 * sequence of writes shows what the issue ends up holding. It parses the
 * arguments as the real operations do: `issue-label` adds one and removes a
 * comma list, `issue-comment` edits the comment holding the marker or posts.
 */
const issueHost = (): { context: ShellContext; labels: () => string[]; comments: () => string[]; closed: () => boolean } => {
  const root = mkdtempSync(join(tmpdir(), 'plot-plan-state-'));
  roots.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  const file = join(scriptDir, 'plot-host.sh');
  writeFileSync(
    file,
    `#!/usr/bin/env bash
state="${root}"
touch "$state/labels" "$state/comments"
case "$1" in
  issue-label)
    IFS=, read -ra drop <<<"\${4-}"
    for l in "\${drop[@]}"; do grep -vxF "$l" "$state/labels" >"$state/labels.new"; mv "$state/labels.new" "$state/labels"; done
    grep -qxF "$3" "$state/labels" || echo "$3" >>"$state/labels" ;;
  issue-comment)
    if grep -qF "$3" "$state/comments"; then
      grep -vF "$3" "$state/comments" >"$state/comments.new"; mv "$state/comments.new" "$state/comments"
    fi
    printf '%s\\n' "$4" | tr '\\n' '|' >>"$state/comments"; echo >>"$state/comments" ;;
  issue-comment-read)
    grep -F "$3" "$state/comments" | tr '|' '\\n' ;;
  issue-close) touch "$state/closed" ;;
  *) exit 4 ;;
esac
`,
  );
  chmodSync(file, 0o755);
  const lines = (name: string): string[] => {
    try {
      return readFileSync(join(root, name), 'utf8').split('\n').filter((l) => l !== '');
    } catch {
      return [];
    }
  };
  return {
    context: { repoRoot: root, scriptDir },
    labels: () => lines('labels'),
    comments: () => lines('comments'),
    closed: () => {
      try {
        readFileSync(join(root, 'closed'));
        return true;
      } catch {
        return false;
      }
    },
  };
};

const write = (phase: PlanStateWrite['phase'], extra: Partial<PlanStateWrite> = {}): PlanStateWrite => ({
  issue: '#1979',
  phase,
  planLink: 'https://github.com/o/r/blob/main/docs/plans/2026-10-17-a-planned-issue.md',
  ...extra,
});

describe('a plan-state write reflects the phase on a GitHub issue', () => {
  it('leaves one comment after two approved writes, linking the latest plan address', async () => {
    const host = issueHost();
    const tracker = trackerGithub(host.context);
    await tracker.planStateWrite(write('approved', { planLink: 'https://x/blob/branch/docs/plans/2026-10-17-a-planned-issue.md' }));
    const second = await tracker.planStateWrite(write('approved'));
    expect(isAnswered(second) && second.value).toBe('written');
    expect(host.comments()).toHaveLength(1);
    expect(host.comments()[0]).toContain('/blob/main/docs/plans/');
  });

  it('edits the draft comment in place when the approved write follows it', async () => {
    const host = issueHost();
    const tracker = trackerGithub(host.context);
    await tracker.planStateWrite(write('draft', { planLink: 'https://github.com/o/r/pull/123' }));
    await tracker.planStateWrite(write('approved', { planLink: 'docs/plans/2026-10-17-a-planned-issue.md' }));
    expect(host.comments()).toHaveLength(1);
    expect(host.comments()[0]).toContain('Plan approved: docs/plans/2026-10-17-a-planned-issue.md');
  });

  it('leaves exactly one plan label after a delivered write follows an approved one', async () => {
    const host = issueHost();
    const tracker = trackerGithub(host.context);
    await tracker.planStateWrite(write('approved'));
    await tracker.planStateWrite(write('delivered'));
    expect(host.labels()).toEqual(['plan:delivered']);
  });

  it('leaves exactly one plan label at released, where the issue already carries two phase labels', async () => {
    const host = issueHost();
    writeFileSync(join(host.context.repoRoot, 'labels'), 'plan:draft\nplan:approved\n');
    const tracker = trackerGithub(host.context);
    await tracker.planStateWrite(write('released', { version: 'v1' }));
    expect(host.labels()).toEqual(['plan:released']);
  });

  it('closes the issue and names the version at released, and not before', async () => {
    const host = issueHost();
    const tracker = trackerGithub(host.context);
    await tracker.planStateWrite(write('delivered'));
    expect(host.closed()).toBe(false);
    await tracker.planStateWrite(write('released', { version: 'v1.2.3' }));
    expect(host.closed()).toBe(true);
    expect(host.comments()[0]).toContain('v1.2.3');
  });

  it('reports a failed write and never throws', async () => {
    const host = issueHost();
    writeFileSync(join(host.context.scriptDir, 'plot-host.sh'), '#!/usr/bin/env bash\necho boom >&2\nexit 3\n');
    const tracker = trackerGithub(host.context);
    const result = await tracker.planStateWrite(write('approved'));
    expect(result).toEqual({ ok: false, why: 'failed' });
    expect(tracker.lastRefusal()).toContain('boom');
  });

  it('answers unaskable where plot-host.sh exits 4', async () => {
    const host = issueHost();
    writeFileSync(join(host.context.scriptDir, 'plot-host.sh'), '#!/usr/bin/env bash\necho nobody lists issues >&2\nexit 4\n');
    const result = await trackerGithub(host.context).planStateWrite(write('approved'));
    expect(result).toEqual(expect.objectContaining({ ok: false, why: 'unaskable' }));
  });

  it('answers no-target for an issue naming no number, writing nothing', async () => {
    const host = issueHost();
    const result = await trackerGithub(host.context).planStateWrite(write('approved', { issue: 'PROJ' }));
    expect(isAnswered(result) && result.value).toBe('no-target');
    expect(host.labels()).toEqual([]);
  });
});

describe('D6: the ticket record is not this machine’s to hold', () => {
  const stateHome = (): { env: Record<string, string>; refusals: (string | null)[]; refuse: (said: string | null) => void } => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-plan-state-written-'));
    roots.push(dir);
    const refusals: (string | null)[] = [];
    return { env: { PLOT_TRACKER: 'github-issues', [PLAN_STATE_WRITTEN_HOME_ENV]: dir }, refusals, refuse: (said) => refusals.push(said) };
  };

  it('keeps the comment’s existing ticket lines on a write naming no record of its own', async () => {
    const host = issueHost();
    const state = stateHome();
    const planStateWrite = githubPlanStateWrite(host.context, state.env, state.refuse);
    await planStateWrite(
      write('delivered', { sliceProgress: '1 of 2 slices merged', highTickets: [{ title: 'Fix it', url: 'https://x/9' }] }),
    );
    await planStateWrite(write('released', { version: 'v1' }));
    expect(host.comments()).toHaveLength(1);
    expect(host.comments()[0]).toContain('1 of 2 slices merged');
    expect(host.comments()[0]).toContain('[Fix it](https://x/9)');
  });

  it('issues no host call for label or comment on a second identical write', async () => {
    const host = issueHost();
    const state = stateHome();
    const first = await githubPlanStateWrite(host.context, state.env, state.refuse)(write('approved'));
    expect(isAnswered(first) && first.value).toBe('written');

    writeFileSync(
      join(host.context.scriptDir, 'plot-host.sh'),
      '#!/usr/bin/env bash\ncase "$1" in issue-comment-read) exit 0 ;; *) echo must-not-be-called >&2; exit 3 ;; esac\n',
    );
    const second = await githubPlanStateWrite(host.context, state.env, state.refuse)(write('approved'));
    expect(isAnswered(second) && second.value).toBe('written');
  });

  it('leaves exactly one comment after two concurrent writers find no marked comment', async () => {
    const host = issueHost();
    const state = stateHome();
    await Promise.all([
      githubPlanStateWrite(host.context, state.env, state.refuse)(write('approved')),
      githubPlanStateWrite(host.context, state.env, state.refuse)(write('approved')),
    ]);
    expect(host.comments()).toHaveLength(1);
  });
});

describe('the other trackers', () => {
  it('trackerNone answers unaskable at every phase, released included', async () => {
    for (const phase of ['draft', 'approved', 'delivered', 'released'] as const) {
      const result = await trackerNone('no tracker').planStateWrite(write(phase));
      expect(result).toEqual(expect.objectContaining({ ok: false, why: 'unaskable' }));
    }
  });

  it('a Jira tracker closes nothing and comments nothing at released', async () => {
    const host = issueHost();
    const result = await trackerJira(host.context).planStateWrite(write('released', { version: 'v1' }));
    expect(isAnswered(result) && result.value).toBe('no-target');
    expect(host.comments()).toEqual([]);
    expect(host.closed()).toBe(false);
  });

  it('the fixture records the write before it answers', async () => {
    const planStates: PlanStateWrite[] = [];
    await trackerFixture({ planStates }).planStateWrite(write('draft'));
    expect(planStates).toHaveLength(1);
  });
});

describe('the label and comment text', () => {
  it('removes every plan label except the one set', () => {
    expect(planStateLabelsToRemove('approved')).toBe('plan:draft,plan:delivered,plan:released');
  });

  it('names plan:released among the labels a released write asks to remove, even where the repo never created it', () => {
    expect(planStateLabelsToRemove('released')).toBe('plan:draft,plan:approved,plan:delivered');
  });

  it('keys the comment on one marker, so the draft PR link and the later plan path share it', () => {
    const draft = planIssueComment(write('draft', { planLink: 'https://github.com/o/r/pull/123' }));
    const approved = planIssueComment(write('approved', { planLink: 'docs/plans/2026-10-17-p.md' }));
    expect(draft.split('\n')[0]).toBe('<!-- plot:plan-link -->');
    expect(approved.split('\n')[0]).toBe(draft.split('\n')[0]);
  });
});
