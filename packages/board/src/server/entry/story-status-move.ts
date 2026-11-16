// THE STORY STATUS MOVE, SHARED by `plot-story-status.mjs` (`story-status.ts`)
// and the board's `POST /api/story-status` route. It holds no program guard, so
// the board bundle can import it without starting the command.
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { PlanStore, Refs, Scripts, Trees } from '@plot-pm/domain';
import { isRefusal, setStoryStatus, type Decision, type RefusalReason } from '@plot-pm/domain/transitions/story';
import { STORY_STATUS_SLUG, storyOfContent, withStoryStatus } from '@plot-pm/domain/rules/story-status-edit';
import { deskRoot, deskRootPlacement } from '@plot-pm/domain/rules/desk-root';
import { commitAndPush, cutBooking, localDate, Refused, type PushLock, type Printer } from './ladder.js';
import path from 'node:path';

/** What a story status move is asked to do. */
export interface StoryStatusArgs {
  /** The name the booking commit carries; `''` reads git `user.name`. */
  who: string;
  /** The story's slug, its directory name. */
  slug: string;
  /** The status to move to, as the caller spells it. */
  status: string;
}

/** The ports and paths a story status move needs. */
export interface Context {
  repoRoot: string;
  scriptDir: string;
  planStore: PlanStore;
  refs: Refs;
  scripts: Scripts;
  trees: Trees;
  /** Sleeps between push attempts; the ladder's jittered wait where absent. */
  retryWait?: () => Promise<void>;
  /** The default-branch push lock; the ladder's real lock where absent. */
  lock?: PushLock;
}

/**
 * The real adapters for a repository.
 *
 * @param repoRoot - the repository root.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @returns the context `setStoryStatusAt` takes.
 */
export const storyStatusContext = (repoRoot: string, scriptDir: string): Context => {
  const context = { repoRoot, scriptDir };
  return {
    repoRoot,
    scriptDir,
    planStore: planStoreShell(context),
    refs: refsGit(context),
    scripts: scriptsShell(context),
    trees: treesGit(context),
  };
};

/**
 * Why a story status move refused: `unattended`, `slug-invalid`,
 * `story-not-found`, `story-unreadable`, a domain refusal from
 * `setStoryStatus`, `push-rejected`, or `failed` for a write or booking step
 * that did not complete.
 */
export type StoryStatusRefusalReason =
  | 'unattended'
  | 'slug-invalid'
  | 'story-not-found'
  | 'story-unreadable'
  | RefusalReason
  | 'push-rejected'
  | 'failed';

/** What a story status move did. */
export type StoryStatusOutcome =
  | { outcome: 'moved'; summary: string }
  | { outcome: 'refused'; reason: StoryStatusRefusalReason; detail: string };

/** A refusal with its reason, thrown inside {@link setStoryStatusAt}. */
class Refusal extends Refused {
  constructor(readonly reason: StoryStatusRefusalReason, message: string) {
    super(message);
  }
}

/** Reads one config key, falling back where the read fails or is empty. */
const configured = async (scripts: Scripts, key: string, fallback: string): Promise<string> => {
  const read = await scripts.config(key, fallback);
  const value = read.ok ? read.value.trim() : '';
  return value === '' ? fallback : value;
};

/** The default branch: the local `origin/HEAD`, then the host, then `main`. */
const resolveMain = async (repoRoot: string, trees: Trees, scripts: Scripts): Promise<string> => {
  const local = await trees.originHead(repoRoot);
  if (local.ok && local.value.trim() !== '') return local.value.trim();
  const hosted = await scripts.host(['default-branch']);
  const named = hosted.ok ? hosted.value.trim() : '';
  return named !== '' ? named : 'main';
};

/**
 * Asks the domain for the move, from one copy of the story file's text.
 *
 * @returns the decision and the edited text.
 * @throws Refusal naming `story-unreadable` or the domain's reason.
 */
const decide = (text: string, args: StoryStatusArgs, rel: string, today: string): { decision: Decision; edited: string } => {
  const story = storyOfContent(text, args.slug, rel);
  if (story === null) {
    throw new Refusal('story-unreadable', `${rel} has no front matter with one of the six statuses — refusing rather than guessing.\n  Nothing was written.`);
  }
  const decision = setStoryStatus(story, { to: args.status, on: today });
  if (isRefusal(decision)) throw new Refusal(decision.reason, `${decision.detail}\n  Nothing was written; the story is unchanged.`);
  const edit = withStoryStatus(text, decision.status, decision.archived);
  if (!edit.changed) {
    throw new Refusal('story-unreadable', `${rel} has no 'status:' line in its front matter — nowhere to record the move.\n  Nothing was written.`);
  }
  const reread = storyOfContent(edit.content, args.slug, rel);
  if (reread?.status !== decision.status || reread.archived !== (decision.archived ?? story.archived)) {
    throw new Refusal('story-unreadable', `${rel} — wrote status '${decision.status}', but the front matter reads '${reread?.status ?? 'none'}'.\n  Nothing was written.`);
  }
  return { decision, edited: edit.content };
};

/**
 * Moves a story to a status and books the front-matter write on the default branch.
 *
 * Refuses under `PLOT_UNATTENDED=1` before it reads anything. Decides once on
 * the story as `origin/<default>` holds it, so a refusal cuts no booking
 * worktree; then decides again inside the booking worktree, writes only
 * `status:` (and `archived:` on a move to `done`), commits and pushes through
 * the shared ladder.
 *
 * @param ctx - the ports and paths.
 * @param args - the story, the status and the committer's name.
 * @param write - where `step:` and `summary:` lines go.
 * @param env - the process environment; only `PLOT_UNATTENDED` is read.
 * @returns `moved` with the summary line, or `refused` with its reason and detail.
 * @throws an error that is not a refusal, such as a failed process start.
 */
export const setStoryStatusAt = async (
  ctx: Context,
  args: StoryStatusArgs,
  write: Printer,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoryStatusOutcome> => {
  if (env.PLOT_UNATTENDED === '1') {
    return {
      outcome: 'refused',
      reason: 'unattended',
      detail: "a person moves a story's status, and this process runs under PLOT_UNATTENDED=1.\n  Refusing: the fleet never decides this. Run it from a session or the board.",
    };
  }
  try {
    return await perform(ctx, args, write);
  } catch (err) {
    if (err instanceof Refusal) return { outcome: 'refused', reason: err.reason, detail: err.message };
    if (err instanceof Refused) return { outcome: 'refused', reason: 'failed', detail: err.message };
    throw err;
  }
};

/** The move itself; a `Refused` thrown here becomes a refusal. */
const perform = async (ctx: Context, args: StoryStatusArgs, write: Printer): Promise<StoryStatusOutcome> => {
  const { slug } = args;
  if (!STORY_STATUS_SLUG.test(slug)) {
    throw new Refusal('slug-invalid', `'${slug}' is not a story slug — a slug is a directory name of letters, digits and dashes.`);
  }
  const storyDir = (await configured(ctx.scripts, 'Story directory', 'docs/stories/')).replace(/\/+$/, '');
  const rel = path.join(storyDir, slug, `STORY-${slug}.md`);
  const main = await resolveMain(ctx.repoRoot, ctx.trees, ctx.scripts);
  await ctx.trees.fetch(ctx.repoRoot, main);

  const shown = await ctx.refs.showFile(`origin/${main}`, rel);
  if (!shown.ok) {
    throw new Refusal('story-not-found', `no story file ${rel} on origin/${main}.\n  Check the slug: ls ${storyDir}`);
  }
  const today = localDate();
  const first = decide(shown.value, args, rel, today);
  write(`step: story ${rel} — ${storyOfContent(shown.value, slug, rel)?.status} -> ${first.decision.status}\n`);

  const userName = await ctx.trees.userName(ctx.repoRoot);
  const who = args.who.trim() || (userName.ok ? userName.value.trim() : '') || 'plot';
  const mainRootRead = await ctx.trees.mainRoot(ctx.repoRoot);
  const mainRoot = mainRootRead.ok ? mainRootRead.value : ctx.repoRoot;
  const deskReading = { configured: await configured(ctx.scripts, 'Worktree root', ''), repoRoot: mainRoot };
  const placement = deskRootPlacement(deskReading);
  if (placement.excludeLine) await ctx.trees.excludePath(mainRoot, placement.excludeLine);
  const tmpwt = path.join(deskRoot(deskReading), `.plot-story-status-${slug}.${process.pid}`);
  const bookbr = `plot/story-status-${slug}`;

  const added = await cutBooking(ctx, tmpwt, bookbr, main, 'add');
  if (!added.ok) {
    throw new Refused(`could not prepare a booking worktree at ${tmpwt}.\n  Most often origin/${main} is not fetched, or '${bookbr}' is checked out in\n  another worktree. Check both: git fetch origin ${main} && git worktree list\n  Nothing has been written locally; the story is untouched.`);
  }
  let keepBranch = false;
  try {
    const reapply = async (wt: string): Promise<void> => {
      const target = path.join(wt, rel);
      const held = await ctx.planStore.readText(target);
      if (!held.ok || held.value === null) throw new Refusal('story-not-found', `${rel} is not present in ${wt}.`);
      const { edited } = decide(held.value, args, rel, today);
      const written = await ctx.planStore.writeText(target, edited);
      if (!written.ok) throw new Refused(`could not write ${rel}.\n  The story is unchanged. Re-run this.`);
      await ctx.trees.stage(wt, [rel]);
    };
    await reapply(tmpwt);
    const landed = await commitAndPush(
      ctx,
      tmpwt,
      bookbr,
      main,
      who,
      `plot: move story ${slug} to ${first.decision.status}`,
      'story status',
      `nothing to commit — ${slug} is already ${first.decision.status} on ${main}`,
      reapply,
      write,
    );
    const archived = first.decision.archived === null ? 'untouched' : 'written';
    if ('rejected' in landed) {
      keepBranch = true;
      await ctx.trees.removeOnly(tmpwt);
      write(`summary: status=${first.decision.status} archived=${archived} push=rejected\n`);
      throw new Refusal('push-rejected', `the move is committed on '${bookbr}' but could not reach ${main}.\n  Land '${bookbr}' by hand, or re-run this command once the push works.`);
    }
    const summary = `summary: status=${first.decision.status} archived=${archived} push=${landed.pushed}`;
    write(`${summary}\n`);
    return { outcome: 'moved', summary };
  } finally {
    if (!keepBranch) await ctx.trees.removeWithBranch(tmpwt, bookbr);
  }
};
