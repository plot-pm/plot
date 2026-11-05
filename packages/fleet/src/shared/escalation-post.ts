import { join } from 'node:path';

import { hostShell, planStoreShell, scriptsShell, trackerForIssues } from '@plot-pm/domain/adapters';
import type { Tracker } from '@plot-pm/domain/ports/tracker';
import { escalationComment, planIssueId } from '@plot-pm/domain/rules/escalation';
import { planForBranch, plansMentioning } from '@plot-pm/domain/rules/plan-for-branch';

/** What {@link postEscalation} reads and writes through. */
export interface EscalationPostWorld {
  /** The issue the plan naming `branch` states, or `null` where no plan or no `Issue:` line reads. */
  issueOf: (branch: string) => Promise<string | null>;
  /** The tracker the repository declares. */
  tracker: () => Promise<Pick<Tracker, 'issueComment' | 'lastRefusal'>>;
}

/** One escalated question to put on its plan's issue. */
export interface EscalationPost {
  branch: string;
  askedAt: string;
  question: string;
  reason: string;
}

/** What {@link postEscalation} did. */
export type EscalationPosted = { posted: true } | { posted: false; why: string };

/**
 * Posts one escalated question as a comment on the plan's issue.
 *
 * The comment carries a marker keyed on the branch and `askedAt`, so a repeat
 * edits the comment in place. A plan with no `Issue:` line, a tracker that
 * answers `unaskable` and a tracker that answers `failed` each make no
 * further call and answer `posted: false` with the reason. Never throws.
 *
 * @param world - where the plan and the tracker are read.
 * @param post - the desk, the question key, the question and the reason.
 * @returns `posted: true`, or `posted: false` with one line saying why.
 */
export const postEscalation = async (world: EscalationPostWorld, post: EscalationPost): Promise<EscalationPosted> => {
  try {
    const issue = await world.issueOf(post.branch);
    if (issue === null) return { posted: false, why: 'the plan names no issue' };
    const tracker = await world.tracker();
    const { body, marker } = escalationComment(post);
    const result = await tracker.issueComment(issue, body, marker);
    if (result.ok) return { posted: true };
    const refusal = tracker.lastRefusal();
    return { posted: false, why: `tracker ${result.why}${refusal ? `: ${refusal}` : ''}` };
  } catch (error) {
    return { posted: false, why: error instanceof Error ? error.message : String(error) };
  }
};

/**
 * The production {@link EscalationPostWorld}: the plan found as
 * `revertWorldOf` finds it, the tracker as `ticketTick` builds it.
 *
 * @param repoRoot - the repository root.
 * @param scriptsDir - where the helper scripts are.
 * @returns the world.
 */
export const escalationPostWorldFor = (repoRoot: string, scriptsDir: string): EscalationPostWorld => {
  const context = { repoRoot, scriptDir: scriptsDir };
  const scripts = scriptsShell(context);
  const host = hostShell(context);
  return {
    issueOf: async (branch) => {
      const dir = await scripts.config('Plan directory', 'docs/plans/');
      if (!dir.ok) return null;
      const planDir = dir.value.trim() === '' ? 'docs/plans/' : dir.value.trim();
      const store = planStoreShell(context);
      const listed = await store.listDir(planDir);
      if (!listed.ok) return null;
      const texts = [];
      for (const name of listed.value.filter((entry) => entry.endsWith('.md'))) {
        const file = join(planDir, name);
        const read = await store.readText(file);
        if (read.ok && read.value !== null) texts.push({ file, text: read.value });
      }
      const parsed = await store.readPlans(plansMentioning(texts, branch));
      const file = parsed.ok ? planForBranch(parsed.value, branch)?.file : undefined;
      if (file === undefined) return null;
      const plan = texts.find((entry) => entry.file === file);
      return plan === undefined ? null : planIssueId(plan.text);
    },
    tracker: async () => {
      const [declared, backend] = await Promise.all([scripts.config('Tracker', ''), host.backend()]);
      return trackerForIssues(declared.ok ? declared.value.trim() : '', backend.ok ? backend.value : '', context);
    },
  };
};
