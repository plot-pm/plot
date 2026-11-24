import { basename } from 'node:path';

import {
  RELEASE_BRANCH,
  planSlug,
  type ReleaseChangeset,
  type ReleaseChecksReading,
  type ReleaseHeadReading,
  type ReleasePrReading,
  type ReleaseUnbookedReadings,
  type RunLog,
} from '@plot-pm/domain';
import { releaseScopeSprintOf, type ReleaseScopePlan, type ReleaseScopeSprint } from '@plot-pm/domain/rules/release-scope';
import { sprintScopeRef } from '@plot-pm/domain/adapters/sprint-scope-ref';
import { parseChangeset } from '@plot-pm/domain/rules/changeset';
import type { BuildPort } from '@plot-pm/domain/ports/build';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Notifier } from '@plot-pm/domain/ports/notifier';
import type { PlanStore } from '@plot-pm/domain/ports/plan-store';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import type { ReleaseTickPorts } from './release-tick.js';

/** The adapters one release tick reads and writes through. */
export interface ReleaseWorld {
  readonly refs: Refs;
  readonly scripts: Scripts;
  readonly plans: Pick<PlanStore, 'listPlans' | 'readPlans'>;
  readonly host: Pick<Host, 'backend'>;
  readonly index: PrIndexStore;
  readonly build: Pick<BuildPort, 'runsForSha'>;
  readonly log: RunLog;
  readonly notifier: Notifier;
  /** The revision the plans, sprint and changesets are read at. */
  readonly ref: string;
  /** The configured `Sprint directory`, without a trailing slash; `null` where the read failed. */
  readonly sprintDir?: string | null;
  /** The channel the `release unbooked` finding goes to; `null` where none runs. */
  readonly channel?: ReleaseTickPorts['channel'];
  /** Receives one line per channel publish or retraction. */
  readonly say?: (line: string) => void;
}

/** The directory the release PR consumes. */
const CHANGESET_DIR = '.changeset';

/** The `.changeset/*.md` paths a commit's diff names, README excluded. */
const changesetPaths = (files: readonly string[]): readonly string[] =>
  files.filter((f) => /^\.changeset\/[^/]+\.md$/.test(f) && f !== '.changeset/README.md');

/**
 * What `releaseUnbooked` reads, from local git at `world.ref`.
 *
 * The tag is the newest `vN.N.N` tag merged into the ref. The sprints are every
 * sprint file at the ref outside `active/`. The changesets are the files the
 * tag's merge removed, each read at `<tag>^1`. An empty plan list answers
 * `unaskable`: the fleet's plan store answers no plans where the default
 * branch did not read.
 *
 * @param world - the adapters.
 * @returns the readings, each `unaskable` where its read failed.
 */
export const releaseUnbookedReadingsFor = async (world: ReleaseWorld): Promise<ReleaseUnbookedReadings> => {
  const tags = await world.refs.releaseTagsMerged(world.ref);
  const newest = tags.ok ? (tags.value.at(-1) ?? null) : undefined;
  const dated = newest === undefined || newest === null ? null : await world.refs.tagDate(newest);
  const tag: ReleaseUnbookedReadings['tag'] =
    newest === undefined ? 'unaskable' : newest === null ? 'none' : dated?.ok ? { tag: newest, date: dated.value } : 'unaskable';

  const sprints = async (): Promise<readonly ReleaseScopeSprint[] | 'unaskable'> => {
    if (world.sprintDir === null || world.sprintDir === undefined) return 'unaskable';
    const dir = world.sprintDir.replace(/\/+$/, '');
    const blobs = await world.refs.listBlobs(world.ref, dir);
    if (!blobs.ok) return 'unaskable';
    const files = blobs.value.filter((b) => b.mode !== '120000' && b.path.endsWith('.md') && !b.path.slice(dir.length + 1).includes('/'));
    const texts = await world.refs.readBlobs(files.map((b) => b.sha));
    if (!texts.ok) return 'unaskable';
    return files.map((b) => releaseScopeSprintOf(b.path, texts.value.get(b.sha) ?? ''));
  };

  const plans = async (): Promise<readonly ReleaseScopePlan[] | 'unaskable'> => {
    const files = await world.plans.listPlans();
    if (!files.ok || files.value.length === 0) return 'unaskable';
    const records = await world.plans.readPlans(files.value);
    if (!records.ok) return 'unaskable';
    return records.value.map((r) => ({
      slug: planSlug(basename(r.file)),
      file: r.error === undefined ? r.file : '',
      phase: r.phase.toLowerCase(),
      releasedRecord: r.releasedRaw,
    }));
  };

  const shipped = async (): Promise<readonly ReleaseChangeset[] | 'unaskable'> => {
    if (typeof tag !== 'object') return [];
    const changed = await world.refs.commitFiles(`${tag.tag}^{commit}`);
    if (!changed.ok) return 'unaskable';
    const out: ReleaseChangeset[] = [];
    for (const file of changesetPaths(changed.value)) {
      const text = await world.refs.showFile(`${tag.tag}^1`, file);
      if (!text.ok) return 'unaskable';
      out.push({ file: basename(file), plan: planOfChangeset(text.value) });
    }
    return out;
  };

  const [s, p, c] = await Promise.all([sprints(), plans(), shipped()]);
  return { tag, sprints: s, plans: p, shipped: c };
};

/** The `plan:` line of a changeset's trailing comment block, or `''`. */
export const planOfChangeset = (text: string): string => parseChangeset(text).plan ?? '';

/**
 * The production readings of the release tick.
 *
 * Every read answers `unaskable` where its port failed. An absent index row is
 * `unaskable` too: the index never says there is no release PR.
 *
 * @param world - the adapters.
 * @returns the ports {@link import('./release-tick.js').releaseTick} takes.
 */
export const releasePortsFor = (world: ReleaseWorld): ReleaseTickPorts => ({
  scope: () => sprintScopeRef(world.refs, world.scripts, world.ref),
  phases: async () => {
    const files = await world.plans.listPlans();
    if (!files.ok) return 'unaskable';
    const records = await world.plans.readPlans(files.value);
    if (!records.ok) return 'unaskable';
    return new Map(records.value.map((record) => [planSlug(basename(record.file)), record.phase.toLowerCase()]));
  },
  pr: async (): Promise<ReleasePrReading> => {
    const backend = await world.host.backend();
    if (!backend.ok) return 'unaskable';
    const held = await world.index.read(backend.value);
    if (!held.ok || held.value === null) return 'unaskable';
    const rows = held.value.rows.filter((row) => RELEASE_BRANCH.test(row.head) && row.state === 'OPEN');
    return rows.length === 1 ? rows[0]! : 'unaskable';
  },
  runs: async (branch, sha): Promise<ReleaseChecksReading> => {
    const runs = await world.build.runsForSha(branch, sha);
    return runs.ok
      ? { read: 'runs', runs: runs.value.map((run) => ({ workflow: run.workflow, status: run.status, conclusion: run.conclusion })) }
      : { read: 'unaskable' };
  },
  headChanges: async (sha): Promise<ReleaseHeadReading | null> => {
    const backend = await world.host.backend();
    if (backend.ok && backend.value !== 'github') return null;
    const changes = await world.refs.headChanges(sha);
    return changes.ok ? changes.value : 'unaskable';
  },
  changesets: async (): Promise<readonly ReleaseChangeset[] | 'unaskable'> => {
    const blobs = await world.refs.listBlobs(world.ref, CHANGESET_DIR);
    if (!blobs.ok) return 'unaskable';
    const files = blobs.value.filter((blob) => blob.path.endsWith('.md') && basename(blob.path) !== 'README.md');
    const texts = await world.refs.readBlobs(files.map((blob) => blob.sha));
    if (!texts.ok) return 'unaskable';
    return files.map((blob) => ({
      file: basename(blob.path),
      plan: planOfChangeset(texts.value.get(blob.sha) ?? ''),
    }));
  },
  finish: async () => 'none',
  unbooked: () => releaseUnbookedReadingsFor(world),
  log: world.log,
  notifier: world.notifier,
  channel: world.channel ?? null,
  ...(world.say === undefined ? {} : { say: world.say }),
});
