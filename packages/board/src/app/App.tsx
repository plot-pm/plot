import { useCallback, useEffect, useState } from 'react';
import type { Board, Card, Fleet } from '../contract/schema.js';
import { AgentList } from './components/AgentList.js';
import { BoardView } from './components/Board.js';
import { Swimlanes } from './components/Swimlanes.js';
import { PlanModal } from './components/PlanModal.js';
import { MultiSelect } from './components/ui/MultiSelect.js';
import {
  NO_SPRINT,
  NO_STORY,
  readList,
  sanitizeSelection,
  sprintFilterOptions,
  withCounts,
  writeList,
} from './lib/filters.js';

// Artifacts move in days, agents in minutes — different time axes, and the
// reason these are two tabs rather than one view. The split is also what lets
// them poll at different rates: the quiet board does not pay the price of the
// live one. The fleet poll is cheap because /api/fleet reads a cache the server
// refreshes on its own timer; it never runs a scan per request.
const POLL_MS = 30_000;
const FLEET_POLL_MS = 4_000;

/**
 * How fast the board re-reads git while a Start work click is outstanding.
 *
 * The plan's bound is "about three pulses (~12 s)", which is the FLEET's rate —
 * the board's own 30 s poll would make the same three pulses a minute and a
 * half of staring. Rather than raise the resting rate (30 s is right for a view
 * of artifacts that move in days), a pending start temporarily borrows the live
 * rate and gives it back the moment nothing is starting. The board still learns
 * the outcome the same way: by re-reading git.
 */
const STARTING_POLL_MS = FLEET_POLL_MS;

type Tab = 'board' | 'agents';

export function App() {
  const [board, setBoard] = useState<Board | null>(null);
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [tab, setTab] = useState<Tab>(
    () => (new URLSearchParams(location.search).get('tab') === 'agents' ? 'agents' : 'board'),
  );
  // Swimlanes are a LAYOUT of the same board, not a third tab: the question is
  // still "where does this work stand", only grouped by story as well as phase.
  // Off by default — with one story, rows cost width and add nothing.
  const [lanes, setLanes] = useState(
    () => new URLSearchParams(location.search).get('lanes') === '1',
  );
  const [error, setError] = useState<string | null>(null);
  const [sprintSel, setSprintSel] = useState<string[]>(() => readList('sprint'));
  const [storySel, setStorySel] = useState<string[]>(() => readList('story'));
  const [openPlan, setOpenPlan] = useState<Card | null>(null);
  // Counts board refreshes, not seconds. A Start work button waits for the row
  // to move, and what moves the row is a re-read of git — so re-reads are the
  // thing worth counting.
  const [pulse, setPulse] = useState(0);
  // How many Start work clicks are outstanding. Only used to decide the poll
  // rate: a live control deserves a live view, and only while it is live.
  const [starting, setStarting] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/board');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Board | { error: string };
      if ('error' in data) throw new Error(data.error);
      setBoard(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Bumped even on a failed poll: the button is counting attempts to learn
      // the outcome, and an attempt that failed still did not confirm anything.
      // Without this a dropped poll would leave the button spinning forever.
      setPulse((n) => n + 1);
    }
  }, []);

  const onStarting = useCallback((active: boolean) => {
    setStarting((n) => Math.max(0, n + (active ? 1 : -1)));
  }, []);

  const loadFleet = useCallback(async () => {
    try {
      const res = await fetch('/api/fleet');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // A Fleet carries its own `error` field (a failed scan, last pulse kept),
      // so presence of the key is not the discriminator the board endpoint uses
      // — `rows` is. A 500 body has no rows.
      const data = (await res.json()) as Fleet | { error: string };
      if (!('rows' in data)) throw new Error(data.error);
      setFleet(data);
    } catch {
      // Keep the last good fleet on screen with its age rather than blanking
      // it: the endpoint carries its own `error` field for scan failures, and
      // a dropped poll is not evidence that the fleet stopped.
    }
  }, []);

  // Load once, then poll — no manual refresh needed. The rate goes live while a
  // start is outstanding and drops back on its own; nothing else changes.
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), starting > 0 ? STARTING_POLL_MS : POLL_MS);
    return () => clearInterval(id);
  }, [load, starting]);

  // The fleet only polls while its tab is open: a background 4 s poll would
  // cost the same as a foreground one and answer a question nobody is asking.
  useEffect(() => {
    if (tab !== 'agents') return;
    void loadFleet();
    const id = setInterval(() => void loadFleet(), FLEET_POLL_MS);
    return () => clearInterval(id);
  }, [tab, loadFleet]);

  const onLanes = (next: boolean) => {
    setLanes(next);
    const url = new URL(location.href);
    if (next) url.searchParams.set('lanes', '1');
    else url.searchParams.delete('lanes');
    history.replaceState(null, '', url);
  };

  const onTab = (next: Tab) => {
    setTab(next);
    const url = new URL(location.href);
    if (next === 'agents') url.searchParams.set('tab', 'agents');
    else url.searchParams.delete('tab');
    history.replaceState(null, '', url);
  };

  // A story badge on a card in column layout has nowhere to scroll to — lanes
  // are what render a story as a row. So the jump turns lanes on FIRST, then
  // scrolls on the next frame, once the row it is aiming at exists. Without the
  // deferral the element is not in the document yet and the jump silently does
  // nothing, which looks exactly like a broken link.
  const onGoToStory = useCallback((story: string) => {
    setLanes(true);
    const url = new URL(location.href);
    url.searchParams.set('lanes', '1');
    history.replaceState(null, '', url);
    requestAnimationFrame(() => {
      document.getElementById(`story-${story}`)?.scrollIntoView({ block: 'start' });
    });
  }, []);

  const onSprint = (values: string[]) => {
    setSprintSel(values);
    writeList('sprint', values);
  };
  const onStory = (values: string[]) => {
    setStorySel(values);
    writeList('story', values);
  };

  // Sprint options come from the directory AND from inline plan values, so the
  // filter appears whenever any plan carries a sprint — even with no sprint
  // directory. Stories still derive from the directory only. Each option is
  // annotated with its plan count (over the whole board).
  const allCards = board ? board.columns.flatMap((c) => c.cards) : [];
  const sprintChoices = sprintFilterOptions(board);
  const sprintOptions = withCounts(
    [{ value: NO_SPRINT, label: 'No sprint' }, ...sprintChoices],
    allCards,
    'sprint',
    NO_SPRINT,
  );
  const storyOptions = withCounts(
    [
      { value: NO_STORY, label: 'No story' },
      ...(board?.stories ?? []).map((s) => ({ value: s.slug, label: s.title })),
    ],
    allCards,
    'story',
    NO_STORY,
  );

  // The plan promises URL filter values are "validated against known slugs".
  // A stale/typo slug in ?sprint=/?story= matches no option, so an unchecked
  // selection would hide every card (empty board). Drop unknown values here —
  // an all-invalid selection becomes "no filter" (show all). Pure derivation,
  // so no render/poll churn; the URL heals on the next filter change.
  const validSprintSel = sanitizeSelection(sprintSel, sprintOptions);
  const validStorySel = sanitizeSelection(storySel, storyOptions);

  const hasSprints = sprintChoices.length > 0;
  const hasStories = (board?.stories.length ?? 0) > 0;

  return (
    <div className="mx-auto min-h-screen max-w-[1600px] px-4 py-4">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight">Plot</h1>
        <nav className="mr-auto flex gap-1" aria-label="Views">
          {([
            ['board', 'Board'],
            ['agents', 'Agents'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onTab(key)}
              aria-current={tab === key ? 'page' : undefined}
              className={
                tab === key
                  ? 'rounded-md bg-slate-200 px-3 py-1 text-sm font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                  : 'rounded-md px-3 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900'
              }
            >
              {label}
            </button>
          ))}
        </nav>
        {/* Filters belong to the board; the agent list is grouped by waiting
            reason, which is not something a sprint or story narrows. */}
        {tab === 'board' && hasSprints && (
          <MultiSelect label="All sprints" options={sprintOptions} selected={validSprintSel} onChange={onSprint} />
        )}
        {tab === 'board' && hasStories && (
          <MultiSelect label="All stories" options={storyOptions} selected={validStorySel} onChange={onStory} />
        )}
        {/* Only offered where it can show something: with no stories, lanes
            would render one "(no story)" row, which is just the board with a
            wasted column. */}
        {tab === 'board' && hasStories && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={lanes}
              onChange={(e) => onLanes(e.target.checked)}
              className="h-3.5 w-3.5 accent-slate-500"
            />
            Story lanes
          </label>
        )}
      </header>
      <main>
        {tab === 'agents' ? (
          fleet ? (
            <AgentList fleet={fleet} />
          ) : (
            <p className="text-sm text-slate-500">Loading…</p>
          )
        ) : error ? (
          <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            Failed to load board: {error}
          </p>
        ) : board ? (
          lanes ? (
            <Swimlanes
              board={board}
              sprintSel={validSprintSel}
              storySel={validStorySel}
              pulse={pulse}
              onStarting={onStarting}
              onOpenPlan={setOpenPlan}
            />
          ) : (
            <BoardView
              board={board}
              sprintSel={validSprintSel}
              storySel={validStorySel}
              pulse={pulse}
              onStarting={onStarting}
              onOpenPlan={setOpenPlan}
              onGoToStory={onGoToStory}
            />
          )
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </main>
      {openPlan && <PlanModal card={openPlan} onClose={() => setOpenPlan(null)} />}
    </div>
  );
}
