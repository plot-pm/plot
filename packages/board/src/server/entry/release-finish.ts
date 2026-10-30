import { realpathSync } from 'node:fs';
import path from 'node:path';

import type { Caller, PlanStore, Refs, Host, Scripts, Trees } from '@plot-pm/domain';
import { releaseFinish, type ScopePlan } from '@plot-pm/domain/workflows/release-finish';
import { flipFrontMatterPhase, flipStatusValue, insertStatusRecord } from '@plot-pm/domain/rules/plan-record-edit';
import { deskRoot } from '@plot-pm/domain/rules/desk-root';

import { commitAndPush, localDate, recordStateReceipt, Refused, type Printer, type PushLock } from './ladder.js';
import { itemsFrom, sprintFrom } from './sprint-transition.js';

/** The ports and settings the finish reads and writes through. */
export interface FinishContext {
  repoRoot: string;
  refs: Refs;
  host: Host;
  planStore: PlanStore;
  scripts: Scripts;
  trees: Trees;
  caller: Caller;
  /** The longest the finish waits for the tag, in milliseconds (`Checks wait`). */
  tagWaitMs: number;
  /** The gap between tag polls, in milliseconds. */
  pollMs: number;
  /** Sleeps; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Passed to the push; replaced in tests. */
  retryWait?: () => Promise<void>;
  /** The default-branch push lock; the real one where absent. */
  lock?: PushLock;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The sprint file's `State:` edit: `Closed`, with the date as `Actual End:`. */
const closeSprintText = (content: string, on: string): string => {
  const status = content.match(/(## Status\s*\n)([\s\S]*?)(?=\n## |$)/);
  if (status === null) return content;
  let body = status[2] ?? '';
  body = body.replace(/^(- \*\*State:\*\*).*$/m, '$1 Closed');
  body = /^- \*\*Actual End:\*\*/m.test(body)
    ? body.replace(/^(- \*\*Actual End:\*\*).*$/m, `$1 ${on}`)
    : body.replace(/^(- \*\*State:\*\*.*)$/m, `$1\n- **Actual End:** ${on}`);
  return content.replace(status[0], `${status[1]}${body}`);
};

/**
 * Finishes a merged release in the person's own call.
 *
 * Reads the version from the release branch's `package.json` (the default
 * branch's, once the branch is gone), waits up to `tagWaitMs` for its tag, then
 * books every scope plan as Released and closes the sprint in ONE commit and
 * ONE push onto the default branch. The scope is the active sprint file at the
 * default branch's latest commit, struck items excluded.
 *
 * @param ctx - the ports, the caller and the wait bound.
 * @param prNumber - the merged release PR.
 * @param write - where progress goes.
 * @param warn - where a refusal goes.
 * @returns 0 when booked or `already-released`; 1 on a refusal, naming it.
 */
export const finishRelease = async (
  ctx: FinishContext,
  prNumber: number,
  write: Printer,
  warn: Printer,
): Promise<number> => {
  const sleep = ctx.sleep ?? realSleep;
  const main = await ctx.refs.defaultBranch();
  const mainBranch = main.ok && main.value !== '' ? main.value : 'main';
  const pr = await ctx.host.prState(prNumber);
  if (!pr.ok || pr.value === null) {
    warn(`plot-ask: release-approve: the host did not answer for PR #${prNumber}; the finish writes nothing.\n`);
    return 1;
  }
  await ctx.trees.fetch(ctx.repoRoot, [mainBranch, pr.value.head]);
  const pkg = await (async () => {
    for (const ref of [`origin/${pr.value!.head}`, `origin/${mainBranch}`]) {
      const shown = await ctx.refs.showFile(ref, 'package.json');
      if (shown.ok) return shown.value;
    }
    return '';
  })();
  const version = (() => {
    try {
      return String((JSON.parse(pkg) as { version?: string }).version ?? '');
    } catch {
      return '';
    }
  })();
  if (version === '') {
    warn('plot-ask: release-approve: cannot read a version from package.json; the finish writes nothing.\n');
    return 1;
  }
  const tag = version.startsWith('v') ? version : `v${version}`;

  const deadline = Date.now() + ctx.tagWaitMs;
  let tagExists = false;
  for (;;) {
    await ctx.trees.fetch(ctx.repoRoot, mainBranch);
    const dated = await ctx.refs.tagDate(tag);
    tagExists = dated.ok && dated.value !== '';
    if (tagExists || Date.now() >= deadline) break;
    await sleep(ctx.pollMs);
  }

  const on = localDate();
  const [planDirCfg, sprintDirCfg, worktreeCfg, userName] = await Promise.all([
    ctx.scripts.config('Plan directory', 'docs/plans/'),
    ctx.scripts.config('Sprint directory', 'docs/sprints/'),
    ctx.scripts.config('Worktree root', ''),
    ctx.trees.userName(ctx.repoRoot),
  ]);
  const planDir = planDirCfg.ok ? planDirCfg.value.trim() : 'docs/plans/';
  const sprintDir = sprintDirCfg.ok ? sprintDirCfg.value.trim() : 'docs/sprints/';
  const wtRoot = deskRoot({ configured: worktreeCfg.ok ? worktreeCfg.value.trim() : '', repoRoot: ctx.repoRoot });
  const bookbr = `plot/release-${tag}`;
  const tmpwt = path.join(wtRoot, `.plot-release-finish-${process.pid}`);
  const added = await ctx.trees.addBranch(tmpwt, bookbr, `origin/${mainBranch}`);
  if (!added.ok) {
    warn(`plot-ask: release-approve: could not prepare a booking worktree at ${tmpwt}; the finish writes nothing.\n`);
    return 1;
  }
  const cleanup = () => ctx.trees.removeWithBranch(tmpwt, bookbr);

  let refusal: { reason: string; detail: string } | null = null;
  let booked: readonly string[] = [];

  /** Decides from the text `wt` holds now, applies the edits, and stages them. */
  const book = async (wt: string): Promise<void> => {
    refusal = null;
    const active = await ctx.planStore.listDir(path.join(wt, sprintDir, 'active'));
    const sprintLink = (active.ok ? active.value : []).find((f) => f.endsWith('.md'));
    // The active entry is a symlink; the edit goes to the file it names, so the link survives.
    const sprintRel = sprintLink === undefined ? '' : (() => {
      try {
        return path.relative(realpathSync(wt), realpathSync(path.join(wt, sprintDir, 'active', sprintLink)));
      } catch {
        return path.join(sprintDir, 'active', sprintLink);
      }
    })();
    const sprintText = sprintRel === '' ? null : await ctx.planStore.readText(path.join(wt, sprintRel));
    const sprintContent = sprintText !== null && sprintText.ok ? sprintText.value : null;
    const struck = new Set(
      (sprintContent ?? '')
        .split('\n')
        .filter((l) => l.includes('~~'))
        .flatMap((l) => [...l.matchAll(/\[([a-z0-9][a-z0-9-]*)\]/g)].map((m) => m[1] ?? '')),
    );
    const slugs = sprintContent === null
      ? []
      : itemsFrom(sprintContent).map((i) => i.plan).filter((s) => s !== '' && !struck.has(s));

    const listed = await ctx.planStore.listDir(path.join(wt, planDir));
    const files = listed.ok ? listed.value : [];
    const scope: ScopePlan[] = [];
    for (const slug of slugs) {
      const name = files.find((f) => f.endsWith(`-${slug}.md`) || f === `${slug}.md`);
      if (name === undefined) {
        scope.push({ slug, file: '', type: '', phase: 'none', releasedRecord: '' });
        continue;
      }
      const rel = path.join(planDir, name);
      const read = await ctx.planStore.readPlan(path.join(wt, rel));
      scope.push({
        slug,
        file: read.ok ? rel : '',
        type: read.ok ? read.value.type : '',
        phase: read.ok ? String(read.value.phase) : 'none',
        releasedRecord: read.ok ? read.value.releasedRaw : '',
      });
    }

    const sprintSlug = sprintRel === '' ? '' : path.basename(sprintRel, '.md');
    const sprint = sprintContent === null ? null : {
      slug: sprintSlug,
      file: sprintRel,
      state: String(sprintFrom(sprintContent, sprintSlug).state).toLowerCase(),
    };
    const out = releaseFinish(
      { caller: ctx.caller, version: tag, tagExists, scope, sprint },
      { on },
    );
    if (out.outcome === 'refused') {
      refusal = { reason: out.reason, detail: out.detail };
      return;
    }
    booked = out.detail.booked;
    const staged: string[] = [];
    for (const p of scope.filter((s) => out.detail.booked.includes(s.slug))) {
      const target = path.join(wt, p.file);
      const text = await ctx.planStore.readText(target);
      if (!text.ok || text.value === null) throw new Refused(`could not read ${p.file}; nothing was pushed.`);
      const flip = flipStatusValue(text.value, 'delivered', 'Released');
      const front = flipFrontMatterPhase(flip.content, 'delivered', 'Released');
      const inserted = insertStatusRecord(front.content, 'Released', `${on}, ${tag}`);
      if (!inserted.changed && p.releasedRecord.trim() === '') {
        throw new Refused(`${p.file} has no '## Status' section, so nowhere to record the release. Nothing was pushed.`);
      }
      const written = await ctx.planStore.writeText(target, inserted.content);
      if (!written.ok) throw new Refused(`could not write ${p.file}; nothing was pushed.`);
      recordStateReceipt(ctx.repoRoot, p.file, 'Released');
      staged.push(p.file);
    }
    if (out.detail.closeSprint !== null && sprintContent !== null) {
      await ctx.planStore.writeText(path.join(wt, sprintRel), closeSprintText(sprintContent, on));
      recordStateReceipt(ctx.repoRoot, sprintRel, 'Closed');
      staged.push(sprintRel);
    }
    await ctx.trees.stage(wt, staged);
  };

  try {
    await book(tmpwt);
    if (refusal !== null) {
      const r = refusal as { reason: string; detail: string };
      if (r.reason === 'already-released') {
        write(`already-released: ${r.detail}\n`);
        await cleanup();
        return 0;
      }
      warn(`plot-ask: release-approve: ${r.reason}: ${r.detail}\n`);
      await cleanup();
      return 1;
    }
    const pushed = await commitAndPush(
      { repoRoot: ctx.repoRoot, scripts: ctx.scripts, trees: ctx.trees, retryWait: ctx.retryWait, lock: ctx.lock },
      tmpwt,
      bookbr,
      mainBranch,
      userName.ok && userName.value !== '' ? userName.value : 'plot',
      `plot: record ${tag}`,
      'release',
      `nothing to commit — ${tag} is already recorded on ${mainBranch}`,
      async (wt) => {
        await book(wt);
        if (refusal !== null) throw new Refused((refusal as { detail: string }).detail);
      },
      write,
    );
    if ('rejected' in pushed) {
      warn(`plot-ask: release-approve: the booking is committed on '${bookbr}' but did not reach ${mainBranch}. Run the finish again once the push works.\n`);
      await ctx.trees.removeOnly(tmpwt);
      return 1;
    }
    write(`finished: ${tag} booked ${booked.join(', ') || 'none'} (${pushed.pushed})\n`);
    await cleanup();
    return 0;
  } catch (err) {
    await cleanup();
    if (err instanceof Refused) {
      warn(`plot-ask: release-approve: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
};
