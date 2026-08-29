# The board shows stories

> Stories are the strategic layer above plans — themes that span multiple plans and answer "why are we doing all this?" The board shows plans and agents but not the stories that organize them, so a reader who wants the big picture has to open story files by hand.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** 2026-W36-the-board-shows-the-strategic-layer
- **Issue:** <!-- optional -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 6
- **Approved:** 2026-08-29, Jan Wloka, in-session
- **Started:** 2026-08-29, Jan Wloka, `feature/story-card-schema`
- **Started:** 2026-08-29, Jan Wloka, `feature/story-file-parsing`
- **Started:** 2026-08-29, Jan Wloka, `feature/stories-tab`
- **Started:** 2026-08-29, Jan Wloka, `feature/story-modal`
- **Started:** 2026-08-29, Jan Wloka, `feature/tab-rename-reorder`

## Changelog

- The board gains a Stories tab showing all stories as cards grouped by status (Draft, Active, Done, Archived), with a tag cloud for topic navigation and expandable plan lists per story.
- Tabs are reordered to Stories · Plans · Agents, following the strategy → artifacts → execution funnel.
- Story cards display DESIGN-*.md document counts with expandable lists in the modal.

<!-- Board impact: significant. New tab, new API endpoint (/api/stories), new
     components (StoriesTab, StoryCard, StoryModal), schema additions (StoryCard,
     StoriesResponse), TypeScript-only story parsing (no shell script). The Plans
     tab is renamed from "Board". -->

## Motivation

### The gap

**Stories exist and the board cannot show them.** The repo has 9 story directories under `docs/stories/`, each with a `STORY-*.md` file containing objectives, decisions, open points and session logs. Plans reference them via the `Story:` field — 71 plans reference `plot-board` alone.

**A reader who wants the strategic view has to leave the board.** The sprint and story filters narrow the Plans tab, but neither shows the story itself — its objective, its progress, which plans belong to it, what's still open. That context lives in markdown files the board never reads.

**The tab order buries the overview.** Board (artifacts) comes before Agents (execution), but both are downstream of Stories (strategy). A new user lands on plan cards without knowing what themes organize them.

### What this enables

- **Topic navigation:** The tag cloud shows what the estate is about at a glance — `fleet`, `board`, `adoption`, `gates` — and clicking one filters to that theme.
- **Progress tracking:** A story card shows "4 plans · 2 delivered" without opening each plan.
- **Strategic planning:** The Ideation → Active → Done flow matches how work actually moves — stories are groomed, then implemented through plans, then closed.

## Design

### Tab structure

```
[ Stories ]  [ Plans ]  [ Agents ]
     ↓           ↓          ↓
  strategy   artifacts   execution
```

- **Stories** — new tab, story cards grouped by `status:` frontmatter field
- **Plans** — renamed from "Board", unchanged functionality
- **Agents** — unchanged

**Empty state:** If a repo has zero stories, redirect to the Plans tab automatically. The Stories tab remains accessible but lands on Plans by default.

**URL compatibility:** The rename from `?tab=board` to `?tab=plans` redirects silently — existing bookmarks continue to work.

### Story columns

Columns are driven by the story file's `status:` field in frontmatter:

| Column | `status:` value | Icon | Meaning |
|--------|-----------------|------|---------|
| Draft | `draft` | 📝 | Story being shaped, plans may not exist yet |
| Active | `active` | 🚀 | Story under implementation |
| Done | `done` | ✅ | All planned work delivered |
| Archived | `archived` | 📦 | Closed, historical reference |

**Archived handling:** The Archived column is hidden by default behind a "☐ Show archived" toggle. On a mature repo with many closed stories, this keeps the view focused on active work.

**Status drift:** When a story's manual `status:` field conflicts with its plan states (e.g., story says `active` but all plans are Released), the card displays a warning badge: "⚠️ All plans released". The author corrects manually — the board reports drift but does not auto-derive status.

**Empty stories:** A story with zero plans renders normally with "0 plans · 0 delivered". The objective is still valuable context even before plans exist.

### Story card

```
┌─────────────────────────────────────────────────────────┐
│ ▼ the-master-agent-holds-the-fleet              draft   │
│   4 plans · 0 delivered                                 │
│   Created: 2 days ago · Updated: today                  │
│                                                         │
│   "The supervisor holds the fleet — tools for the       │
│    questions a master agent actually has to answer"     │
│                                                         │
│   Sprints: W36 (2), W37 (1), W38 (1)                    │
│                                                         │
│   ┌─────────────────────────────────────────────────┐   │
│   │ ▸ the-domain-moves-out-of-the-board   Approved  │   │
│   │ ▸ the-domain-speaks-slices            Draft     │   │
│   │ ▸ +2 more                                       │   │
│   └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Card elements:**
- **Header:** Story slug + status badge (with drift warning if applicable)
- **Counts:** Plan count, delivered count
- **Age:** Created/updated from frontmatter
- **Objective:** First ~200 chars of `## Objective` section (truncated with ellipsis)
- **Sprints:** All sprints containing this story's plans, listed with plan counts per sprint
- **Plan list:** Expandable accordion, collapsed by default (shows count), expands to show linked plans with phase badges

**Orphan plans:** Plans without a `Story:` field do not appear on the Stories tab — they are visible only on the Plans tab. The Stories tab shows story-organized work; orphans are a different concern.

### Tag cloud

Top of the Stories tab, showing topic density:

```
┌─────────────────────────────────────────────────────────┐
│  plot-board(71)  fleet(23)  adoption(4)  gates(2)  ...  │
└─────────────────────────────────────────────────────────┘
```

- **Source:** Story slugs only (no plan-level `Type:` tags — type filtering stays on Plans tab)
- **Size:** Moderate scaling (1x to 2x) based on plan count. Logarithmic compression avoids extremes where `plot-board(71)` would dwarf `gates(2)`.
- **Click:** Filters the Stories tab to that story. Filter applies to Stories tab only — Plans tab retains its own story filter dropdown.
- **Color:** Matches story status

### Story modal

Clicking a story card opens `StoryModal`, similar to `PlanModal`:

**Sections:**
1. **Header:** Title, status badge, created/updated, drift warning if applicable
2. **Objective:** Full `## Objective` section
3. **Design:** Full `## Design` section (collapsed by default, expandable)
4. **Progress:** Plan list with phases, clickable (opens PlanModal)
5. **Sprints:** Which sprints contain this story's plans
6. **Design Documents:** Collapsed list of `DESIGN-*.md` files in the story folder (e.g., "▸ 14 design documents"), expands to show filenames
7. **Open Points:** From `## Open Points` section if present
8. **Session Log:** Recent entries from `## Session Log` if present
9. **Actions:** View file (opens in editor)

**Navigation:** Clicking a plan in the modal opens `PlanModal` for that plan. The PlanModal shows a "← Back to Story" link when opened from StoryModal, returning to the story context.

### API

```typescript
// GET /api/stories
interface StoriesResponse {
  stories: StoryCard[];
  tags: TagCount[];
}

interface StoryCard {
  slug: string;
  path: string;                    // docs/stories/<slug>/STORY-*.md
  title: string;                   // from frontmatter or # heading
  status: 'draft' | 'active' | 'done' | 'archived';
  statusDrift: string | null;      // Warning message if status conflicts with plan states
  author: string;
  created: string;                 // ISO date
  updated: string;                 // ISO date
  objective: string;               // First ~200 chars of ## Objective
  design: string;                  // Full ## Design section
  planCount: number;
  deliveredCount: number;
  plans: StoryPlanRef[];
  sprints: SprintRef[];            // Sprint slugs with plan counts
  designDocs: string[];            // DESIGN-*.md filenames in story folder
  hasOpenPoints: boolean;
  hasSessionLog: boolean;
}

interface StoryPlanRef {
  slug: string;
  title: string;
  phase: string;
  sprint?: string;
}

interface SprintRef {
  slug: string;
  planCount: number;
}

interface TagCount {
  slug: string;
  count: number;
  status: string;                  // Story status for coloring
}
```

**Caching:** The `/api/stories` endpoint uses a server-side cache with a 30-second refresh timer, matching the Plans tab cadence. Stories rarely change mid-session, so this provides adequate freshness without excessive scanning.

**Plan counts:** The stories endpoint computes plan counts by scanning all plans for matching `Story:` fields. This is a single source of truth — no client-side joins or duplicate scans.

**Parse errors:** Story files with malformed frontmatter (missing `status:`, bad YAML) are skipped silently. The server logs the error for debugging, but the Stories tab renders only valid stories.

### Story file parsing

Story parsing is implemented in TypeScript within the board server, not as a shell script. This matches the plan parsing approach and avoids subprocess overhead.

**Parsing rules:**
1. Find `STORY-*.md` in `docs/stories/<slug>/`
2. Parse YAML frontmatter for `title`, `author`, `status`, `created`, `updated`
3. Extract full `## Objective` and `## Design` sections
4. List `DESIGN-*.md` files in the story directory
5. Check for presence of `## Open Points` and `## Session Log`
6. Query plans with `Story: <slug>` to build plan list and counts
7. Compute status drift by comparing `status:` field against plan phases

## Branches

Waves are ordered: Schema must land before Backend (contract first), Backend before UI (implementation before consumption).

### Schema

- `feature/story-card-schema` — Add `StoryCard`, `StoriesResponse`, `TagCount`, `SprintRef` to contract schema; add `/api/stories` endpoint type; add `statusDrift` and `designDocs` fields

### Backend

- `feature/story-file-parsing` — Parse story files from `docs/stories/*/STORY-*.md` in TypeScript, extract frontmatter and sections, compute plan counts from plans with matching `Story:` field, detect status drift, list DESIGN-*.md files, implement 30s caching

### UI

- `feature/stories-tab` — New Stories tab component with column layout (Draft/Active/Done/Archived), story cards with drift warnings, tag cloud with moderate scaling, archived toggle, empty-state redirect to Plans
- `feature/story-modal` — StoryModal component with objective, design section, plan list with back-navigation, design docs list, open points, session log sections
- `feature/tab-rename-reorder` — Rename "Board" to "Plans", reorder tabs to Stories · Plans · Agents, redirect `?tab=board` to `?tab=plans`, update URL param handling

## Notes

### Definition of Done

- [ ] Stories tab renders all stories from `docs/stories/`
- [ ] Cards grouped by `status:` frontmatter into columns
- [ ] Archived column hidden by default with toggle
- [ ] Status drift warnings display on affected cards
- [ ] Tag cloud shows story slugs with plan counts (moderate 1x-2x scaling)
- [ ] Clicking tag filters Stories tab only
- [ ] Clicking card opens StoryModal
- [ ] Modal shows objective, design, plan list (clickable), design docs list, sprints
- [ ] Clicking plan in modal opens PlanModal with "Back to Story" link
- [ ] Tab order is Stories · Plans · Agents
- [ ] `?tab=board` redirects to `?tab=plans`
- [ ] Empty repo (no stories) redirects to Plans tab
- [ ] Unit tests for story parsing (frontmatter, sections, drift detection)
- [ ] Integration tests for `/api/stories` response shape and caching
- [ ] Component tests for Stories tab rendering
- [ ] `pnpm run test:board` passes
- [ ] Board artifact rebuilt

### Board impact checklist

- [x] Schema change: Yes — new types for stories, sprint refs, status drift
- [x] API change: Yes — new `/api/stories` endpoint with 30s cache
- [x] Plan format: No
- [x] Helper scripts: No — TypeScript parsing only
- [x] Template: No
- [x] UI: Yes — new tab, components, modal, tab rename/reorder
