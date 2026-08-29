# The board shows stories

> Stories are the strategic layer above plans — themes that span multiple plans and answer "why are we doing all this?" The board shows plans and agents but not the stories that organize them, so a reader who wants the big picture has to open story files by hand.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** <!-- optional -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- The board gains a Stories tab showing all stories as cards grouped by status (Draft, Active, Done, Archived), with a tag cloud for topic navigation and expandable plan lists per story.
- Tabs are reordered to Stories · Plans · Agents, following the strategy → artifacts → execution funnel.

<!-- Board impact: significant. New tab, new API endpoint (/api/stories), new
     components (StoriesTab, StoryCard), schema additions (StoryCard, StoriesResponse),
     story file parsing. The Plans tab is renamed from "Board". -->

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

### Story columns

Columns are driven by the story file's `status:` field in frontmatter:

| Column | `status:` value | Icon | Meaning |
|--------|-----------------|------|---------|
| Draft | `draft` | 📝 | Story being shaped, plans may not exist yet |
| Active | `active` | 🚀 | Story under implementation |
| Done | `done` | ✅ | All planned work delivered |
| Archived | `archived` | 📦 | Closed, historical reference |

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
│   Sprint: the-domain-is-one-implementation (2 plans)    │
│                                                         │
│   ┌─────────────────────────────────────────────────┐   │
│   │ ▸ the-domain-moves-out-of-the-board   Approved  │   │
│   │ ▸ the-domain-speaks-slices            Draft     │   │
│   │ ▸ +2 more                                       │   │
│   └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Card elements:**
- **Header:** Story slug + status badge
- **Counts:** Plan count, delivered count
- **Age:** Created/updated from frontmatter
- **Objective:** First ~200 chars of `## Objective` section (truncated with ellipsis)
- **Sprints:** Which sprint(s) the story's plans belong to
- **Plan list:** Expandable accordion, collapsed by default (shows count), expands to show linked plans with phase badges

### Tag cloud

Top of the Stories tab, showing topic density:

```
┌─────────────────────────────────────────────────────────┐
│  plot-board(71)  fleet(23)  adoption(4)  gates(2)  ...  │
└─────────────────────────────────────────────────────────┘
```

- **Source:** Story slugs, with plan counts derived from `Story:` fields
- **Size:** Proportional to plan count (CSS font-size scaling)
- **Click:** Filters to that story (same as story filter dropdown)
- **Color:** Matches story status

### Story modal

Clicking a story card opens `StoryModal`, similar to `PlanModal`:

**Sections:**
1. **Header:** Title, status badge, created/updated
2. **Objective:** Full `## Objective` section
3. **Progress:** Plan list with phases, clickable (opens PlanModal)
4. **Sprints:** Which sprints contain this story's plans
5. **Open Points:** From `## Open Points` section if present
6. **Session Log:** Recent entries from `## Session Log` if present
7. **Actions:** View file (opens in editor)

**Navigation:** Clicking a plan in the modal opens `PlanModal` for that plan. Back button returns to `StoryModal`.

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
  author: string;
  created: string;                 // ISO date
  updated: string;                 // ISO date
  objective: string;               // First ~200 chars of ## Objective
  planCount: number;
  deliveredCount: number;
  plans: StoryPlanRef[];
  sprints: string[];               // Sprint slugs containing this story's plans
  hasOpenPoints: boolean;
  hasSessionLog: boolean;
}

interface StoryPlanRef {
  slug: string;
  title: string;
  phase: string;
  sprint?: string;
}

interface TagCount {
  slug: string;
  count: number;
  status: string;                  // Story status for coloring
}
```

### Story file parsing

New helper script `plot-story-meta.sh` (or extend existing parsing):

```bash
# Input: story slug or path
# Output: JSON with frontmatter + derived fields

plot-story-meta.sh the-master-agent-holds-the-fleet
# → { "slug": "...", "title": "...", "status": "active", ... }
```

**Parsing rules:**
1. Find `STORY-*.md` in `docs/stories/<slug>/`
2. Parse YAML frontmatter for `title`, `author`, `status`, `created`, `updated`
3. Extract first ~200 chars of `## Objective` section
4. Check for presence of `## Open Points` and `## Session Log`
5. Query plans with `Story: <slug>` to build plan list and counts

### Open Questions

- [ ] Should the tag cloud include plan-level tags (from `Type:` field) or only story slugs?
- [ ] How to handle stories with no `status:` field? Default to `draft`?
- [ ] Should the story modal show the full `## Design` section, or is Objective + Open Points enough?

## Branches

### Schema

- `feature/story-card-schema` — Add `StoryCard`, `StoriesResponse`, `TagCount` to contract schema; add `/api/stories` endpoint type

### Backend

- `feature/story-file-parsing` — Parse story files from `docs/stories/*/STORY-*.md`, extract frontmatter and sections, compute plan counts from plans with matching `Story:` field

### UI

- `feature/stories-tab` — New Stories tab component with column layout (Draft/Active/Done/Archived), story cards, tag cloud
- `feature/story-modal` — StoryModal component with objective, plan list, open points, session log sections
- `feature/tab-rename-reorder` — Rename "Board" to "Plans", reorder tabs to Stories · Plans · Agents, update URL param handling

## Notes

### Definition of Done

- [ ] Stories tab renders all stories from `docs/stories/`
- [ ] Cards grouped by `status:` frontmatter into columns
- [ ] Tag cloud shows story slugs with plan counts
- [ ] Clicking tag filters to that story
- [ ] Clicking card opens StoryModal
- [ ] Modal shows objective, plan list (clickable), sprints
- [ ] Clicking plan in modal opens PlanModal
- [ ] Tab order is Stories · Plans · Agents
- [ ] `pnpm run test:board` passes
- [ ] Board artifact rebuilt

### Board impact checklist

- [x] Schema change: Yes — new types for stories
- [x] API change: Yes — new `/api/stories` endpoint
- [x] Plan format: No
- [x] Helper scripts: Maybe — `plot-story-meta.sh` if not extending existing
- [x] Template: No
- [x] UI: Yes — new tab, components, modal
