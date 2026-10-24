/** Sentinel for "plans with no sprint assigned". Shared with the board's story filter. */
export const NO_SPRINT = '__no_sprint__';

/** A single option in a multi-select filter. */
export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Keep only selections that correspond to a currently-valid option. URL filter
 * state (`?sprint=a,b`) is arbitrary user input: a stale or mistyped slug that
 * matches no option would otherwise make a membership test hide every row,
 * leaving a mysteriously empty board. Dropping unknown values means an
 * all-invalid selection collapses to "no filter" (show all). Sentinels
 * (`__no_sprint__`) are themselves options, so they survive.
 *
 * @param selected - the slugs the reader has selected.
 * @param options - the currently-valid options.
 * @returns the selection, minus any slug naming no option.
 */
export const sanitizeSelection = (selected: string[], options: FilterOption[]): string[] => {
  const valid = new Set(options.map((o) => o.value));
  return selected.filter((v) => valid.has(v));
};

/**
 * Does a plan slug pass the sprint filter? Empty selection = no filter (show
 * all). A slug passes if it belongs to ANY selected sprint. The `NO_SPRINT`
 * sentinel matches slugs that belong to NO sprint.
 *
 * `selected` MUST be sanitized first ({@link sanitizeSelection}): a stale slug
 * naming no Active sprint must read as "no filter", not as "nothing matches",
 * and this function cannot tell a stale slug from a real one on its own.
 *
 * @param planSlug - the plan's slug; "" for plan-less rows.
 * @param selected - the sanitized sprint slugs selected by the reader; empty = no filter.
 * @param membership - sprint slug to the set of plan slugs it contains.
 * @returns true when the slug passes the filter.
 */
export const slugPassesSprintFilter = (
  planSlug: string,
  selected: string[],
  membership: Map<string, Set<string>>,
): boolean => {
  if (selected.length === 0) return true;

  let inAnySprint = false;
  for (const members of membership.values()) {
    if (members.has(planSlug)) {
      inAnySprint = true;
      break;
    }
  }

  for (const sprintSlug of selected) {
    if (sprintSlug === NO_SPRINT) {
      if (!inAnySprint) return true;
    } else {
      const members = membership.get(sprintSlug);
      if (members?.has(planSlug)) return true;
    }
  }
  return false;
};

/**
 * Does the Delivery tab's sprint filter let this row through without asking
 * about membership?
 *
 * Two kinds of row are exempt: the release row (`kind: 'release'`) and a PR
 * row that names no plan (`kind: 'pr'` with `plan === ''`). Every other row is
 * decided by {@link slugPassesSprintFilter} on its `plan`. A plan-less row of
 * any other kind — a loose `branch`, for example — is not exempt, and against
 * a selected sprint it is hidden.
 *
 * The row's mark and the control's count both read this predicate, so the two
 * cannot disagree about which rows were exempted.
 *
 * @param row - the row's kind and plan slug.
 * @returns true when the filter passes the row unconditionally.
 */
export const rowIsSprintExempt = (row: { kind: string; plan: string }): boolean =>
  row.kind === 'release' || (row.kind === 'pr' && row.plan === '');

/**
 * Is this row a member of the reader's current sprint selection?
 *
 * True when the selection is empty (every Active sprint counts) and the row
 * is in any Active sprint, or when the row is in a selected sprint. An exempt
 * row ({@link rowIsSprintExempt}) is always a member — it has no sprint to be
 * excluded from.
 *
 * `selected` MUST be sanitized first, the same requirement
 * {@link slugPassesSprintFilter} carries: a stale slug collapses to "every
 * Active sprint counts" rather than to "nothing matches".
 *
 * @param row - the row's kind and plan slug.
 * @param selected - the sanitized sprint slugs selected by the reader; empty = every Active sprint.
 * @param membership - sprint slug to the set of plan slugs it contains.
 * @returns true when the row belongs to the reader's current sprint selection.
 */
export const rowInSprintSelection = (
  row: { kind: string; plan: string },
  selected: string[],
  membership: Map<string, Set<string>>,
): boolean => rowIsSprintExempt(row) || slugPassesSprintFilter(row.plan, selected, membership);

/**
 * Should a row show which sprint it belongs to?
 *
 * True while more than one sprint is Active and the selection does not
 * narrow to exactly one sprint — with several sprints shown together, the row
 * needs to say which one it is in; with one Active sprint, or one selected,
 * every visible row is in the same sprint and the slug would say nothing new.
 *
 * @param activeSprintCount - how many sprints are currently Active.
 * @param selected - the sanitized sprint slugs selected by the reader.
 * @returns true when a row should show its sprint slug.
 */
export const showsSprintSlug = (activeSprintCount: number, selected: string[]): boolean =>
  activeSprintCount > 1 && selected.length !== 1;
