import { realpathSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import type { Caller, PlanStore, Refs, Host, Scripts, Trees } from '@plot-pm/domain';
import { parseChangeset } from '@plot-pm/domain/rules/changeset';
import { releaseScopeSprintOf } from '@plot-pm/domain/rules/release-scope';
import { planSlug, type ReleaseChangeset } from '@plot-pm/domain';
import { releaseFinish, type FinishSprint, type ScopePlan } from '@plot-pm/domain/workflows/release-finish';
import { flipFrontMatterPhase, flipStatusValue, insertStatusRecord } from '@plot-pm/domain/rules/plan-record-edit';
import { deskRoot } from '@plot-pm/domain/rules/desk-root';
import { RELEASE_FINISH_RECORD_VERSION } from '@plot-pm/domain/entities/release-finish-record';
import type { ReleaseFinishRecordStore } from '@plot-pm/domain/ports/release-finish-record';

import { releaseFinishRecordIn, stateHomeFor } from '../state-home.js';

import { commitAndPush, cutBooking, localDate, recordStateReceipt, Refused, type Printer, type PushLock } from './ladder.js';
import { tellTrackerAbout } from './release-tracker.js';

/** The ports and settings the finish reads and writes through. */
export interface FinishContext {
  repoRoot: string;
  refs: Refs;
  host: Host;
  planStore: PlanStore;
  scripts: Scripts;
  trees: Trees;
  caller: Caller;
  /** Where `plot-*.sh` scripts resolve from; the tracker step's `Scripts`/`PlanStore` ports take it. */
  scriptDir: string;
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
  /** Where each finish's outcome is recorded; the file store under `repoRoot`'s state home where absent. */
  records?: ReleaseFinishRecordStore;
  /** The current time; replaced in tests. */
  now?: () => Date;
}

/**
 * The changesets a release merge removed, with the plan each names.
 *
 * Reads the merge's `.changeset/*.md` paths through `Refs.commitFiles`, and each
 * file's text at the merge's first parent: the version commit deleted them, so the
 * default branch holds none.
 *
 * @param refs - the refs port.
 * @param mergeCommit - the release PR's merge commit.
 * @returns the changesets, `[]` where the merge removed none, or `'unaskable'` where a read failed.
 */
const shippedChangesets = async (refs: Refs, mergeCommit: string): Promise<readonly ReleaseChangeset[] | 'unaskable'> => {
  if (mergeCommit === '') return 'unaskable';
  const changed = await refs.commitFiles(mergeCommit);
  if (!changed.ok) return 'unaskable';
  const files = changed.value.filter(
    (f) => /^\.changeset\/[^/]+\.md$/.test(f) && f !== '.changeset/README.md',
  );
  const out: ReleaseChangeset[] = [];
  for (const file of files) {
    const text = await refs.showFile(`${mergeCommit}^1`, file);
    if (!text.ok) return 'unaskable';
    out.push({ file: path.basename(file), plan: parseChangeset(text.value).plan ?? '' });
  }
  return out;
};

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The sprint file's close: `State: Closed`, with the date as `Actual End:`.
 *
 * The legacy `Phase:` line is rewritten as `State:`, as `plot-sprint-state.sh` does.
 */
const closeSprintText = (content: string, on: string): string => {
  const status = content.match(/(## Status\s*\n)([\s\S]*?)(?=\n## |$)/);
  if (status === null) return content;
  let body = status[2] ?? '';
  body = body.replace(/^- \*\*(?:State|Phase):\*\*.*$/m, '- **State:** Closed');
  body = /^- \*\*Actual End:\*\*/m.test(body)
    ? body.replace(/^(- \*\*Actual End:\*\*).*$/m, `$1 ${on}`)
    : body.replace(/^(- \*\*State:\*\*.*)$/m, `$1\n- **Actual End:** ${on}`);
  return content.replace(status[0], `${status[1]}${body}`);
};

/** How one finish ended: what it booked, the safe second-run answer, or the refusal by name. */
export type FinishOutcome =
  | {
      readonly outcome: 'booked';
      readonly version: string;
      readonly booked: readonly string[];
      readonly notes: readonly string[];
      /** The slug of the sprint the booking closed, or `null`. */
      readonly sprintClosed: string | null;
    }
  | { readonly outcome: 'already-released'; readonly version: string; readonly detail: string }
  | { readonly outcome: 'refused'; readonly reason: string; readonly detail: string };

/**
 * The exit code of a finish: 0 for `booked` and `already-released`, 1 for a refusal.
 *
 * @param outcome - the finish's outcome.
 */
export const finishExitCode = (outcome: FinishOutcome): number => (outcome.outcome === 'refused' ? 1 : 0);

/**
 * Writes the record of one finish's outcome to `.plot/state/release-finish/<version>.json`, replacing any earlier one.
 *
 * A failed write prints one line through `warn` and does not change the outcome.
 *
 * @param ctx - the finish's context; `records` and `now` are read.
 * @param version - the tag spelling `vN.N.N`.
 * @param outcome - the finish's outcome.
 * @param warn - where a failed write is named.
 * @returns `outcome`, unchanged.
 */
const recordedOutcome = async (
  ctx: FinishContext,
  version: string,
  outcome: FinishOutcome,
  warn: Printer,
): Promise<FinishOutcome> => {
  const records = ctx.records ?? releaseFinishRecordIn(stateHomeFor({ repoRoot: ctx.repoRoot }));
  const written = await records
    .write({
      v: RELEASE_FINISH_RECORD_VERSION,
      version,
      at: (ctx.now ?? (() => new Date()))().toISOString(),
      caller: ctx.caller,
      outcome: outcome.outcome,
      reason: outcome.outcome === 'refused' ? outcome.reason : '',
      booked: outcome.outcome === 'booked' ? outcome.booked : [],
      notes: outcome.outcome === 'booked' ? outcome.notes : [],
      sprintClosed: outcome.outcome === 'booked' ? outcome.sprintClosed : null,
    })
    .catch(() => ({ ok: false as const }));
  if (!written.ok) warn(`plot-ask: release-finish: record-unwritten: the outcome of ${version} was not recorded under .plot/state/release-finish/.\n`);
  return outcome;
};

/** What a finish's head resolved before the shared tail books. */
interface FinishHead {
  readonly mainBranch: string;
  /** The version's tag, `vN.N.N`. */
  readonly tag: string;
  readonly tagExists: boolean;
  readonly tagDate: string;
  /** The release merge commit; `''` where unread, which reads the shipped changesets as `unaskable`. */
  readonly mergeCommit: string;
}

const refusedWith = (label: string, warn: Printer, reason: string, detail: string): FinishOutcome => {
  warn(`plot-ask: ${label}: ${reason}: ${detail}\n`);
  return { outcome: 'refused', reason, detail };
};

/** The default branch's name, `main` where unread. */
const mainBranchOf = async (ctx: FinishContext): Promise<string> => {
  const main = await ctx.refs.defaultBranch();
  return main.ok && main.value !== '' ? main.value : 'main';
};

/**
 * Fetches the default branch and the tag by their own refspecs, up to `waitMs`, and reads the tag's date.
 *
 * `git fetch origin <branch>` follows no tag, and publish creates the tag on the
 * remote, so the tag is fetched by its own refspec. A failed fetch leaves the
 * tag unread locally, and the finish then refuses `tag-absent`.
 */
const awaitTag = async (
  ctx: FinishContext,
  mainBranch: string,
  tag: string,
  waitMs: number,
): Promise<{ tagExists: boolean; tagDate: string }> => {
  const sleep = ctx.sleep ?? realSleep;
  const deadline = Date.now() + waitMs;
  for (;;) {
    await ctx.trees.fetch(ctx.repoRoot, mainBranch);
    await ctx.trees.fetch(ctx.repoRoot, `refs/tags/${tag}:refs/tags/${tag}`);
    const dated = await ctx.refs.tagDate(tag);
    const tagExists = dated.ok && dated.value !== '';
    if (tagExists || Date.now() >= deadline) return { tagExists, tagDate: dated.ok ? dated.value : '' };
    await sleep(ctx.pollMs);
  }
};

/** The canonical `vN.N.N` spelling of a version argument, or `null` where it is not `N.N.N` or `vN.N.N`. */
export const releaseVersionArg = (given: string): string | null =>
  /^v?\d+\.\d+\.\d+$/.test(given) ? (given.startsWith('v') ? given : `v${given}`) : null;

/**
 * Finishes a merged release in the person's own call.
 *
 * Fetches the default branch on its own and refuses `default-branch-unfetched`
 * when that fetch fails. Reads the version from the fetched default branch's
 * `package.json` and never from the release branch, which the host may delete
 * on merge. Waits up to `tagWaitMs` for the version's tag, then books as
 * {@link finishReleaseVersion} does, from the PR's merge commit. Every outcome
 * past the version read is recorded as {@link finishReleaseVersion} records it;
 * `unaskable`, `default-branch-unfetched` and `version-unread` have no version
 * and record nothing.
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
): Promise<number> => finishExitCode(await finishReleaseOfPr(ctx, prNumber, write, warn));

const finishReleaseOfPr = async (
  ctx: FinishContext,
  prNumber: number,
  write: Printer,
  warn: Printer,
): Promise<FinishOutcome> => {
  const label = 'release-approve';
  const mainBranch = await mainBranchOf(ctx);
  const pr = await ctx.host.prState(prNumber);
  if (!pr.ok || pr.value === null) {
    return refusedWith(label, warn, 'unaskable', `the host did not answer for PR #${prNumber}; the finish writes nothing.`);
  }
  const fetched = await ctx.trees.fetch(ctx.repoRoot, mainBranch);
  if (!fetched.ok) {
    return refusedWith(label, warn, 'default-branch-unfetched', `could not fetch '${mainBranch}' from origin, so the released version is unknown. The finish writes nothing; run it again once the fetch works.`);
  }
  const shown = await ctx.refs.showFile(`origin/${mainBranch}`, 'package.json');
  const version = (() => {
    try {
      return String((JSON.parse(shown.ok ? shown.value : '') as { version?: string }).version ?? '');
    } catch {
      return '';
    }
  })();
  if (version === '') {
    return refusedWith(label, warn, 'version-unread', 'cannot read a version from package.json; the finish writes nothing.');
  }
  const tag = version.startsWith('v') ? version : `v${version}`;
  const { tagExists, tagDate } = await awaitTag(ctx, mainBranch, tag, ctx.tagWaitMs);
  const outcome = await finishTail(ctx, { mainBranch, tag, tagExists, tagDate, mergeCommit: pr.value.mergeCommit }, label, write, warn);
  return recordedOutcome(ctx, tag, outcome, warn);
};

/**
 * Finishes a merged release by its version, with no host call.
 *
 * Fetches the default branch and refuses `default-branch-unfetched` when that
 * fetch fails, fetches the version's tag by its own refspec once, and resolves
 * the release merge commit as `<tag>^{commit}` locally. A tag absent after that
 * one fetch refuses `tag-absent` and writes nothing. The booking is the PR
 * entry's: every scope plan is booked as Released, the open sprint of the
 * release closes and its active index entry goes, in ONE commit and ONE push
 * onto the default branch. A second call answers `already-released`.
 *
 * Every outcome past the version check is recorded in
 * `.plot/state/release-finish/<vN.N.N>.json` under the state home, replacing
 * the earlier record of the version; a failed write is named through `warn`
 * and changes no outcome.
 *
 * @param ctx - the ports and the caller; `tagWaitMs` is not read.
 * @param version - `N.N.N` or `vN.N.N`.
 * @param write - where progress goes.
 * @param warn - where a refusal goes.
 * @returns the outcome; `refused` with `version-invalid` for a malformed version.
 */
export const finishReleaseVersion = async (
  ctx: FinishContext,
  version: string,
  write: Printer,
  warn: Printer,
): Promise<FinishOutcome> => {
  const label = 'release-finish';
  const tag = releaseVersionArg(version);
  if (tag === null) return refusedWith(label, warn, 'version-invalid', `'${version}' is not N.N.N; the finish writes nothing.`);
  return recordedOutcome(ctx, tag, await finishVersionTag(ctx, tag, label, write, warn), warn);
};

/** The version entry past its version check, for the tag `vN.N.N`. */
const finishVersionTag = async (
  ctx: FinishContext,
  tag: string,
  label: string,
  write: Printer,
  warn: Printer,
): Promise<FinishOutcome> => {
  const mainBranch = await mainBranchOf(ctx);
  const fetched = await ctx.trees.fetch(ctx.repoRoot, mainBranch);
  if (!fetched.ok) {
    return refusedWith(label, warn, 'default-branch-unfetched', `could not fetch '${mainBranch}' from origin. The finish writes nothing; run it again once the fetch works.`);
  }
  const { tagExists, tagDate } = await awaitTag(ctx, mainBranch, tag, 0);
  const merge = tagExists ? await ctx.refs.resolve(`${tag}^{commit}`) : null;
  const mergeCommit = merge !== null && merge.ok ? merge.value.trim() : '';
  return finishTail(ctx, { mainBranch, tag, tagExists, tagDate, mergeCommit }, label, write, warn);
};

/**
 * The booking every entry shares, from the head it resolved.
 *
 * Reads the changesets the merge removed, cuts a booking worktree, decides
 * through `releaseFinish`, and commits and pushes onto the default branch.
 */
const finishTail = async (
  ctx: FinishContext,
  head: FinishHead,
  label: string,
  write: Printer,
  warn: Printer,
): Promise<FinishOutcome> => {
  const { mainBranch, tag, tagExists, tagDate } = head;
  const shipped = await shippedChangesets(ctx.refs, head.mergeCommit);
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
  const added = await cutBooking(ctx, tmpwt, bookbr, mainBranch, 'add');
  if (!added.ok) {
    return refusedWith(label, warn, 'booking-unprepared', `could not prepare a booking worktree at ${tmpwt}; the finish writes nothing.`);
  }
  const cleanup = () => ctx.trees.removeWithBranch(tmpwt, bookbr);

  let refusal: { reason: string; detail: string } | null = null;
  let booked: readonly string[] = [];
  let notes: readonly string[] = [];
  let bookedFiles: readonly { slug: string; file: string }[] = [];
  let sprintClosed: string | null = null;

  /** Decides from the text `wt` holds now, applies the edits, and stages them. */
  const book = async (wt: string): Promise<void> => {
    refusal = null;
    const linkOf = new Map<string, string>();
    const active = await ctx.planStore.listDir(path.join(wt, sprintDir, 'active'));
    for (const name of (active.ok ? active.value : []).filter((f) => f.endsWith('.md'))) {
      const link = path.join(sprintDir, 'active', name);
      // The active entry is a symlink; the edit goes to the file it names.
      try {
        linkOf.set(path.relative(realpathSync(wt), realpathSync(path.join(wt, link))), link);
      } catch {
        linkOf.set(link, link);
      }
    }
    const listedSprints = await ctx.planStore.listDir(path.join(wt, sprintDir));
    const sprintFiles = new Set((listedSprints.ok ? listedSprints.value : []).filter((f) => f.endsWith('.md')).map((f) => path.join(sprintDir, f)));
    for (const file of linkOf.keys()) sprintFiles.add(file);
    const sprints: FinishSprint[] = [];
    const contents = new Map<string, string>();
    for (const file of [...sprintFiles].sort()) {
      const text = await ctx.planStore.readText(path.join(wt, file));
      const content = text.ok && text.value !== null ? text.value : '';
      contents.set(file, content);
      sprints.push({ ...releaseScopeSprintOf(file, content), file, link: linkOf.get(file) ?? '' });
    }

    const listed = await ctx.planStore.listDir(path.join(wt, planDir));
    const files = listed.ok ? listed.value : [];
    const plans: ScopePlan[] = [];
    for (const name of files.filter((f) => f.endsWith('.md'))) {
      const slug = planSlug(name);
      const rel = path.join(planDir, name);
      const read = await ctx.planStore.readPlan(path.join(wt, rel));
      plans.push(
        read.ok
          ? { slug, file: rel, type: read.value.type, phase: String(read.value.phase), releasedRecord: read.value.releasedRaw }
          : { slug, file: '', type: '', phase: 'none', releasedRecord: '' },
      );
    }

    const out = releaseFinish(
      { caller: ctx.caller, version: tag, tagExists, tagDate, plans, shipped, sprints },
      { on },
    );
    if (out.outcome === 'refused') {
      refusal = { reason: out.reason, detail: out.detail };
      return;
    }
    booked = out.detail.booked;
    notes = out.detail.notes;
    sprintClosed = out.detail.closeSprint?.slug ?? null;
    const bookedScope = plans.filter((s) => s.file !== '' && out.detail.booked.includes(s.slug));
    bookedFiles = bookedScope.map((p) => ({ slug: p.slug, file: p.file }));
    const staged: string[] = [];
    for (const p of bookedScope) {
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
    const close = out.detail.closeSprint;
    if (close !== null) {
      const written = await ctx.planStore.writeText(path.join(wt, close.file), closeSprintText(contents.get(close.file) ?? '', close.actualEnd));
      if (!written.ok) throw new Refused(`could not write ${close.file}; nothing was pushed.`);
      recordStateReceipt(ctx.repoRoot, close.file, 'Closed');
      if (close.link !== '') {
        try {
          unlinkSync(path.join(wt, close.link));
        } catch {
          throw new Refused(`could not remove the active index entry ${close.link}; nothing was pushed.`);
        }
      }
      staged.push(close.file, ...(close.link === '' ? [] : [close.link]));
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
        return { outcome: 'already-released', version: tag, detail: r.detail };
      }
      await cleanup();
      return refusedWith(label, warn, r.reason, r.detail);
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
      await ctx.trees.removeOnly(tmpwt);
      return refusedWith(label, warn, 'push-rejected', `the booking is committed on '${bookbr}' but did not reach ${mainBranch}. Run the finish again once the push works.`);
    }
    const tracker = await tellTrackerAbout(
      tmpwt,
      tag,
      bookedFiles,
      { scripts: ctx.scripts, planStore: ctx.planStore, scriptDir: ctx.scriptDir },
      write,
    );
    const reasons = Object.entries(tracker.issues.reasons)
      .map(([reason, count]) => `${reason}=${count}`)
      .join(' ');
    for (const note of notes) write(`note: ${note}\n`);
    write(`finished: ${tag} booked ${booked.join(', ') || 'none'} (${pushed.pushed})\n`);
    write(`summary: issues closed=${tracker.issues.closed} left-open=${tracker.issues.leftOpen}${reasons === '' ? '' : ` (${reasons})`}\n`);
    await cleanup();
    return { outcome: 'booked', version: tag, booked, notes, sprintClosed };
  } catch (err) {
    await cleanup();
    if (err instanceof Refused) {
      return refusedWith(label, warn, 'write-failed', err.message);
    }
    throw err;
  }
};
