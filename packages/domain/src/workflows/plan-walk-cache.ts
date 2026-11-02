import { answered, type PortResult } from '../port-result.js';
import type { PlanBlobRef, PlanRecord, PlanStore } from '../ports/plan-store.js';
import type {
  BranchTip,
  CommitSubject,
  Containment,
  MergeCommit,
  RefState,
  Refs,
  TreeBlob,
} from '../ports/refs.js';

/** A full object id: 40 hex digits (SHA-1) or 64 (SHA-256). */
const FULL_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The remote namespace the walk's branch reads cover. */
const REMOTE_PREFIX = 'refs/remotes/origin/';

/**
 * One cache of answers, each a pure function of the object ids in its key.
 *
 * Every `get` hit and every `set` marks its key as touched in the current beat;
 * {@link OidCache.sweep} removes the rest.
 *
 * @typeParam V - the answer kept.
 */
export interface OidCache<V> {
  /** The answer held for `key`, marking it touched, or `undefined`. */
  get(key: string): V | undefined;
  /** Holds `value` for `key` and marks it touched. */
  set(key: string, value: V): void;
  /** How many entries are held. */
  size(): number;
  /** Clears every mark; the next beat starts with nothing touched. */
  begin(): void;
  /** Removes every entry no `get` or `set` touched since `begin`; returns how many. */
  sweep(): number;
}

const oidCache = <V>(): OidCache<V> => {
  const held = new Map<string, V>();
  let touched = new Set<string>();
  return {
    get: (key) => {
      if (!held.has(key)) return undefined;
      touched.add(key);
      return held.get(key);
    },
    set: (key, value) => {
      held.set(key, value);
      touched.add(key);
    },
    size: () => held.size,
    begin: () => {
      touched = new Set();
    },
    sweep: () => {
      let removed = 0;
      for (const key of [...held.keys()]) {
        if (touched.has(key)) continue;
        held.delete(key);
        removed += 1;
      }
      return removed;
    },
  };
};

/** What the cache answered and how often the refs moved, for the hour's measurement. */
export interface WalkCacheStats {
  /** Beats whose snapshot was taken. */
  beats: number;
  /** Beats whose snapshot differed from the previous beat's. */
  changedBeats: number;
  /** Cache hits in the latest beat. */
  hits: number;
  /** Cache misses in the latest beat. */
  misses: number;
}

/**
 * The oid-keyed answers the plan walk keeps between beats.
 *
 * Holds no `unknown` and no failed read, no ref name in any key, and nothing
 * read from a checkout. It lives in the process that runs the walk and is
 * written to no file and no environment variable.
 */
export interface WalkCache {
  /** `ls-tree` listings, keyed by (commit oid, directory). */
  trees: OidCache<readonly TreeBlob[]>;
  /** Blob text, keyed by blob oid. */
  blobs: OidCache<string>;
  /** Parsed plans, keyed by (blob oid, path, prefixes, parser hash, config digest). */
  parses: OidCache<PlanRecord>;
  /** Settled ancestry, keyed by (ancestor oid, descendant oid). */
  contains: OidCache<'yes' | 'no'>;
  /** Merge-commit subjects, keyed by (default-branch oid, cap). */
  merges: OidCache<readonly MergeCommit[]>;
  /** Plan additions, keyed by (default-branch oid, directory). */
  additions: OidCache<ReadonlyMap<string, string>>;
  /** Commit ranges, keyed by (default-branch oid, branch oid). */
  ranges: OidCache<readonly CommitSubject[]>;
  /** Changed paths, keyed by (default-branch oid, branch oid). */
  changed: OidCache<readonly string[]>;
  /** Conflicting paths, keyed by (default-branch oid, branch oid). */
  conflicts: OidCache<readonly string[]>;
  /** Delivery-record commits, keyed by (default-branch oid, file, field). */
  recordCommit: OidCache<string | null>;
  /** Plan authors, keyed by (default-branch oid, directory). */
  planAuthors: OidCache<ReadonlyMap<string, string>>;
  /** Behind counts, keyed by (checked-out branch oid, default-branch oid). */
  countBehind: OidCache<number | null>;
  /** The default branch's name, keyed by the snapshot digest and the checked-out branch. */
  defaultBranch: OidCache<string>;
  /** The beat counters. */
  stats: WalkCacheStats;
  /** The previous beat's snapshot digest, or `null` before the first. */
  lastSnapshot: string | null;
  /** How many entries the cache holds across every kind. */
  size(): number;
  /** Starts a beat: clears every mark and the hit and miss counts. */
  begin(): void;
  /** Ends a completed beat: removes every entry the beat did not touch; returns how many. */
  sweep(): number;
}

/**
 * A cache as a fresh process holds it.
 *
 * @returns an empty cache.
 */
export const freshWalkCache = (): WalkCache => {
  const kinds = {
    trees: oidCache<readonly TreeBlob[]>(),
    blobs: oidCache<string>(),
    parses: oidCache<PlanRecord>(),
    contains: oidCache<'yes' | 'no'>(),
    merges: oidCache<readonly MergeCommit[]>(),
    additions: oidCache<ReadonlyMap<string, string>>(),
    ranges: oidCache<readonly CommitSubject[]>(),
    changed: oidCache<readonly string[]>(),
    conflicts: oidCache<readonly string[]>(),
    recordCommit: oidCache<string | null>(),
    planAuthors: oidCache<ReadonlyMap<string, string>>(),
    countBehind: oidCache<number | null>(),
    defaultBranch: oidCache<string>(),
  };
  const all = Object.values(kinds) as Array<OidCache<unknown>>;
  return {
    ...kinds,
    stats: { beats: 0, changedBeats: 0, hits: 0, misses: 0 },
    lastSnapshot: null,
    size: () => all.reduce((n, c) => n + c.size(), 0),
    begin() {
      for (const c of all) c.begin();
      this.stats.hits = 0;
      this.stats.misses = 0;
    },
    sweep: () => all.reduce((n, c) => n + c.sweep(), 0),
  };
};

/** The ref-to-oid pairs one beat reads once, before any cached read. */
export interface RefSnapshot {
  /**
   * The object id a ref name points at in this snapshot.
   *
   * @param ref - `origin/<branch>`, a full ref name, a local branch name, or a full object id.
   * @returns the oid, or `undefined` where the snapshot holds no such ref or the name is not one the snapshot covers.
   */
  oidOf(ref: string): string | undefined;
  /** Every ref and its oid, in `for-each-ref` order. */
  entries: readonly RefState[];
  /** One string that differs whenever any ref was created, deleted or moved. */
  digest: string;
  /** The full ref name of the attached local branch, or `undefined` on a detached HEAD or where the snapshot does not say. */
  headRef: string | undefined;
  /** The oid the attached local branch points at, or `undefined` where {@link RefSnapshot.headRef} is. */
  headOid: string | undefined;
}

/**
 * Builds a snapshot from ref-to-oid pairs.
 *
 * @param entries - the pairs, local and remote.
 * @returns the snapshot.
 */
export const snapshotOf = (entries: readonly RefState[]): RefSnapshot => {
  const byRef = new Map(entries.map((e) => [e.ref, e.sha] as const));
  const head = entries.find((e) => e.head === true);
  return {
    entries,
    headRef: head?.ref,
    headOid: head?.sha,
    digest: entries.map((e) => `${e.ref}=${e.sha}`).join('\n'),
    oidOf: (ref) => {
      if (FULL_OID.test(ref)) return ref;
      if (ref.startsWith('refs/')) return byRef.get(ref);
      if (ref.startsWith('origin/')) return byRef.get(`refs/remotes/${ref}`);
      return byRef.get(`refs/heads/${ref}`);
    },
  };
};

/**
 * Reads the beat's snapshot: every local and remote ref with its oid, in one call.
 *
 * @param refs - the ref reader.
 * @returns the snapshot, or a failure where the refs cannot be listed.
 */
export const readRefSnapshot = async (refs: Refs): Promise<PortResult<RefSnapshot>> => {
  if (typeof refs.refState !== 'function') return { ok: false, why: 'unaskable' };
  const state = await refs.refState('both');
  return state.ok ? answered(snapshotOf(state.value)) : (state as PortResult<never>);
};

/**
 * Whether a `for-each-ref` pattern selects a ref, as git matches it.
 *
 * A pattern ending in `/` or `/*` selects by prefix; any other selects the ref
 * itself or what sits below it.
 */
const patternSelects = (pattern: string, ref: string): boolean => {
  if (pattern.endsWith('*')) return ref.startsWith(pattern.slice(0, -1));
  if (pattern.endsWith('/')) return ref.startsWith(pattern);
  return ref === pattern || ref.startsWith(`${pattern}/`);
};

/**
 * Wraps a ref reader so the walk's reads are keyed by the snapshot's oids.
 *
 * EVERY KEY NAMES AN OBJECT, AND THE READ IS MADE BY THAT OBJECT. A name is
 * resolved once, through `snapshot`, and git is then asked about the oid, so a
 * fetch landing mid-beat cannot give an entry a key that differs from what was
 * read. A name the snapshot does not cover, or a read that is not keyed, goes
 * straight through uncached. A failed read stores nothing, and neither does a
 * `containsMany` answer of `unknown`.
 *
 * ANCESTRY IS TRUSTED FROM THE CACHE ONLY WHILE GIT CAN SEE ALL HISTORY. Before
 * serving a held answer the wrapper asks `inner` a self-containing pair once per
 * beat; a shallow repository or a non-empty `refs/replace` makes the inner
 * adapter answer `unknown`, and then every pair goes through uncached.
 *
 * @param inner - the ref reader the walk used before.
 * @param snapshot - this beat's ref-to-oid pairs.
 * @param cache - the process's cache.
 * @returns a ref reader that answers from the cache where an oid key holds an answer.
 */
export const cachedRefs = (inner: Refs, snapshot: RefSnapshot, cache: WalkCache): Refs => {
  const hit = <V>(value: V): V => {
    cache.stats.hits += 1;
    return value;
  };
  const miss = (): void => {
    cache.stats.misses += 1;
  };
  let ancestrySafe: Promise<boolean> | null = null;
  const canTrustAncestry = (probe: string): Promise<boolean> => {
    ancestrySafe ??= inner.containsMany([{ ancestor: probe, descendant: probe }]).then((r) => r.ok && r.value[0] === 'yes');
    return ancestrySafe;
  };

  /** Memoises a read keyed by oids; `read` receives the oids as names. */
  const keyed = async <V>(
    store: OidCache<V>,
    oids: readonly (string | undefined)[],
    extra: string,
    read: (oids: readonly string[]) => Promise<PortResult<V>>,
  ): Promise<PortResult<V> | null> => {
    if (oids.some((o) => o === undefined)) return null;
    const names = oids as readonly string[];
    const key = [...names, extra].join('\0');
    const held = store.get(key);
    if (held !== undefined) return answered(hit(held));
    miss();
    const fresh = await read(names);
    if (fresh.ok) store.set(key, fresh.value);
    return fresh;
  };

  return {
    ...inner,

    resolve: async (ref) => {
      const oid = snapshot.oidOf(ref);
      return oid === undefined ? inner.resolve(ref) : answered(oid);
    },

    branchTips: async (patterns) => {
      if (patterns.length === 0) return answered<readonly BranchTip[]>([]);
      if (!patterns.every((p) => p.startsWith(REMOTE_PREFIX))) return inner.branchTips(patterns);
      const tips: BranchTip[] = [];
      for (const { ref, sha } of snapshot.entries) {
        if (!ref.startsWith(REMOTE_PREFIX) || !patterns.some((p) => patternSelects(p, ref))) continue;
        const name = ref.slice(REMOTE_PREFIX.length);
        // `%(refname:short)` shortens the remote's HEAD to the bare remote name.
        tips.push({ branch: name === 'HEAD' ? 'origin' : name, sha });
      }
      return answered<readonly BranchTip[]>(tips);
    },

    listBlobs: async (ref, dir) =>
      (await keyed(cache.trees, [snapshot.oidOf(ref)], dir, ([oid]) => inner.listBlobs(oid!, dir))) ?? inner.listBlobs(ref, dir),

    readBlobs: async (shas) => {
      const found = new Map<string, string>();
      const wanted: string[] = [];
      for (const sha of shas) {
        const held = FULL_OID.test(sha) ? cache.blobs.get(sha) : undefined;
        if (held !== undefined) {
          cache.stats.hits += 1;
          found.set(sha, held);
        } else wanted.push(sha);
      }
      if (wanted.length === 0) return answered<ReadonlyMap<string, string>>(found);
      miss();
      const read = await inner.readBlobs(wanted);
      if (!read.ok) return read;
      for (const [sha, text] of read.value) {
        found.set(sha, text);
        if (FULL_OID.test(sha)) cache.blobs.set(sha, text);
      }
      return answered<ReadonlyMap<string, string>>(found);
    },

    mergeSubjects: async (ref, max) =>
      (await keyed(cache.merges, [snapshot.oidOf(ref)], String(max), ([oid]) => inner.mergeSubjects(oid!, max)))
        ?? inner.mergeSubjects(ref, max),

    planAdditions: async (ref, dir) =>
      (await keyed(cache.additions, [snapshot.oidOf(ref)], dir, ([oid]) => inner.planAdditions(oid!, dir)))
        ?? inner.planAdditions(ref, dir),

    commitSubjects: async (range) => {
      const parts = range.split('..');
      if (parts.length !== 2 || parts[1]!.startsWith('.') || parts[0] === '') return inner.commitSubjects(range);
      const [from, to] = [snapshot.oidOf(parts[0]!), snapshot.oidOf(parts[1]!)];
      return (await keyed(cache.ranges, [from, to], '', ([a, b]) => inner.commitSubjects(`${a}..${b}`)))
        ?? inner.commitSubjects(range);
    },

    changedFiles: async (branch, against) => {
      if (against === undefined) return inner.changedFiles(branch, against);
      const base = snapshot.oidOf(`origin/${against}`);
      return (await keyed(cache.changed, [base, snapshot.oidOf(branch)], '', ([a, b]) => inner.changedFiles(b!, a)))
        ?? inner.changedFiles(branch, against);
    },

    conflictPaths: async (base, branch) =>
      (await keyed(cache.conflicts, [snapshot.oidOf(base), snapshot.oidOf(branch)], '', ([a, b]) => inner.conflictPaths(a!, b!)))
        ?? inner.conflictPaths(base, branch),

    recordCommit: async (file, field, ref) =>
      (await keyed(cache.recordCommit, [snapshot.oidOf(ref)], `${file}\0${field}`, ([oid]) => inner.recordCommit(file, field, oid!)))
        ?? inner.recordCommit(file, field, ref),

    planAuthors: async (ref, dir) =>
      (await keyed(cache.planAuthors, [snapshot.oidOf(ref)], dir, ([oid]) => inner.planAuthors(oid!, dir)))
        ?? inner.planAuthors(ref, dir),

    // A detached HEAD has no attached branch in the snapshot, so it is never
    // keyed: the inner read answers `null` for it, and a branch that was
    // detached after a held count cannot replay that count.
    countBehind: async (ref) =>
      (await keyed(cache.countBehind, [snapshot.headOid, snapshot.oidOf(ref)], '', ([, oid]) => inner.countBehind(oid!)))
        ?? inner.countBehind(ref),

    // No oid is named, so `keyed` always answers.
    defaultBranch: async () =>
      (await keyed(cache.defaultBranch, [], `${snapshot.digest}\0${snapshot.headRef ?? ''}`, () => inner.defaultBranch()))!,

    containsMany: async (pairs) => {
      const settled = pairs.map((p) =>
        FULL_OID.test(p.ancestor) && FULL_OID.test(p.descendant) ? cache.contains.get(`${p.ancestor}\0${p.descendant}`) : undefined,
      );
      const anyHeld = settled.some((s) => s !== undefined);
      if (anyHeld && !(await canTrustAncestry(pairs[0]!.descendant))) return inner.containsMany(pairs);
      const askedAt = pairs.flatMap((_, at) => (settled[at] === undefined ? [at] : []));
      cache.stats.hits += pairs.length - askedAt.length;
      if (askedAt.length === 0) return answered(settled as readonly Containment[]);
      miss();
      const asked = await inner.containsMany(askedAt.map((at) => pairs[at]!));
      if (!asked.ok) return asked;
      if (asked.value.length !== askedAt.length) return { ok: false, why: 'failed' };
      const merged: Containment[] = settled.map((s) => s ?? 'unknown');
      askedAt.forEach((at, i) => {
        const answer = asked.value[i]!;
        merged[at] = answer;
        const p = pairs[at]!;
        if (answer !== 'unknown' && FULL_OID.test(p.ancestor) && FULL_OID.test(p.descendant)) {
          cache.contains.set(`${p.ancestor}\0${p.descendant}`, answer);
        }
      });
      return answered<readonly Containment[]>(merged);
    },
  };
};

/**
 * Wraps a plan store so a plan blob is parsed once per parse key.
 *
 * The key is the blob oid, its path, the prefixes, and `parseKey` — the hash of
 * the parser file on disk and the Plot Config digest, which the caller reads
 * every beat. A parse that fails stores nothing.
 *
 * @param inner - the plan store the walk used before.
 * @param cache - the process's cache.
 * @param parseKey - the parser-file hash joined to the config digest.
 * @returns a plan store whose `readPlansAt` answers from the cache.
 */
export const cachedPlans = (inner: PlanStore, cache: WalkCache, parseKey: string): PlanStore => ({
  ...inner,
  readPlansAt: async (blobs: readonly PlanBlobRef[], prefixes: readonly string[]) => {
    const keyOf = (b: PlanBlobRef): string => [b.sha, b.path, prefixes.join('|'), parseKey].join('\0');
    const held = blobs.map((b) => (FULL_OID.test(b.sha) ? cache.parses.get(keyOf(b)) : undefined));
    const askedAt = blobs.flatMap((_, at) => (held[at] === undefined ? [at] : []));
    cache.stats.hits += blobs.length - askedAt.length;
    if (askedAt.length === 0) return answered(held as readonly PlanRecord[]);
    cache.stats.misses += 1;
    const read = await inner.readPlansAt(askedAt.map((at) => blobs[at]!), prefixes);
    if (!read.ok) return read;
    if (read.value.length !== askedAt.length) return { ok: false, why: 'failed' };
    const records: PlanRecord[] = held.map((h) => h as PlanRecord);
    askedAt.forEach((at, i) => {
      records[at] = read.value[i]!;
      if (FULL_OID.test(blobs[at]!.sha)) cache.parses.set(keyOf(blobs[at]!), read.value[i]!);
    });
    return answered<readonly PlanRecord[]>(records);
  },
});
