import { basename } from 'node:path';

import {
  RELEASE_BRANCH,
  planSlug,
  type ReleaseChangeset,
  type ReleaseChecksReading,
  type ReleasePrReading,
  type RunLog,
} from '@plot-pm/domain';
import { sprintScopeRef } from '@plot-pm/domain/adapters/sprint-scope-ref';
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
}

/** The directory the release PR consumes. */
const CHANGESET_DIR = '.changeset';

/** The `plan:` line of a changeset's trailing comment block, or `''`. */
const planOfChangeset = (text: string): string => /^plan:\s*(\S+)\s*$/m.exec(text)?.[1] ?? '';

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
  log: world.log,
  notifier: world.notifier,
});
