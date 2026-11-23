/** Why a continuation was refused — each sends the reader somewhere different. */
export type ContinueRefusal =
  /** The current pulse does not list this branch. */
  | 'unknown-branch'
  /** No current fleet reading exists to look the branch up in. */
  | 'no-pulse'
  /** The board's scan has not finished, and neither it nor the last finished scan lists this branch. */
  | 'pulse-partial'
  /** The pulse knows the branch; this machine holds no worktree for it. */
  | 'no-worktree'
  /**
   * The worktree is here and holds no unanswered question.
   *
   * **The one refusal that is about the WORK rather than about this machine**,
   * and the reason it is a refusal at all is in `handleContinue`.
   */
  | 'no-question'
  /** No `Worker command` is configured, so nothing can be started. */
  | 'no-worker-command'
  /**
   * No manifest names this desk, or more than one does.
   *
   * **A CONTINUATION NEEDS ONE NAME TO STAMP**, because the new worker's
   * `PLOT_MANIFEST_FILE` is what lets its own wait end honestly if that
   * manifest later vanishes — see `loopRegistration`. `unnamed` is an
   * unregistered desk; `several` is an estate defect, two agents answering for
   * one worktree. Neither is tie-broken: a first match would hide the defect,
   * and the plan's second Open Point keeps this refusal rather than a guess.
   */
  | 'no-manifest'
  /**
   * A live process already holds this desk.
   *
   * **Refuse, never stop.** A stop can land mid-turn and lose work in
   * progress, so this route never signals the old loop — the caller who wants
   * it gone stops it and asks again. The detail names the pid found alive and
   * which of the three sources recorded it, so a person can act on it; a
   * recycled pid (a stale record whose number a new, unrelated process now
   * holds) reads the same way and is accepted, because a wrongly-skipped
   * refusal — a second loop on the desk — is the worse failure.
   */
  | 'loop-alive'
  /**
   * The slice has already started `Slice max runs` runs.
   *
   * **The limit wins over a person's answer, unconditionally.** A continuation
   * is itself a run, so one that would be the run AT the limit is refused
   * before it starts rather than let the slice overrun by one. There is no
   * bypass: a person who wants another run raises the limit and asks again.
   */
  | 'run-limit'
  /**
   * The slice's recorded spend has already reached `Slice max spend`.
   *
   * Refused the same way `run-limit` is, and for the same reason: the limit
   * wins. A project with no `Slice max spend` configured is never refused this
   * way — `sliceSpendRefusal` reads an unconfigured limit as "no limit", not
   * as zero.
   */
  | 'spend-limit'
  /** `restart`: the slice's pull request is open, merged or closed, so the work is in review. */
  | 'reached-review'
  /** `restart`: the host could not say whether the branch has a pull request. */
  | 'pr-unanswerable'
  /** `restart`: the worker state is `running`. */
  | 'worker-alive'
  /** `restart`: the worker finished; the reaper and `continue` own that desk. */
  | 'worker-finished'
  /** `restart`: an unanswered `PLOT-BLOCKED` marker sits in the tree; `continue` answers it. */
  | 'blocked-marker'
  /** The caller runs unattended; neither `continue` nor `restart` proceeds for one. */
  | 'unattended'
  /** `restart`: origin's ref for the branch could not be fetched or listed, or the plans could not be read. */
  | 'origin-unreadable'
  /** `restart`: no approved plan's slice names the branch, or origin carries no claim marker for it. */
  | 'not-claimed'
  /** `restart`: origin carries the branch's claim and no work. */
  | 'no-work'
  /** `restart`: a live agent's manifest names the branch. */
  | 'held-by-agent'
  /** `restart`: the local branch holds commits that origin lacks. */
  | 'local-unpushed'
  /**
   * The caller named the question it means to answer, and the desk's current
   * marker asks a different one.
   *
   * **PINNED THE WAY `merge` PINS TO A HEAD.** A caller that read the marker,
   * composed an answer, and sent it some time later can race a NEW question
   * replacing the one it read — the desk moved on while the answer was in
   * flight. Answering the new question with an answer written for the old one
   * is the failure this refusal exists to prevent, so the check compares the
   * question the caller named against the question the desk holds NOW, not
   * the one it held when the caller looked.
   *
   * **A caller that names no key is unaffected** — this refusal only fires
   * where `expectedAskedAt` is given, so today's behaviour is unchanged for a
   * caller that never pins.
   */
  | 'question-moved';
