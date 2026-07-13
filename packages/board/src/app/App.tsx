import { useCallback, useEffect, useState } from 'react';
import type { Board } from '../contract/schema.js';
import { BoardView } from './components/Board.js';
import { MultiSelect } from './components/ui/MultiSelect.js';
import { NO_SPRINT, NO_STORY, readList, writeList } from './lib/filters.js';

const POLL_MS = 30_000;

export function App() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sprintSel, setSprintSel] = useState<string[]>(() => readList('sprint'));
  const [storySel, setStorySel] = useState<string[]>(() => readList('story'));

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
    }
  }, []);

  // Load once, then poll — no manual refresh needed.
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const onSprint = (values: string[]) => {
    setSprintSel(values);
    writeList('sprint', values);
  };
  const onStory = (values: string[]) => {
    setStorySel(values);
    writeList('story', values);
  };

  const sprintOptions = [
    { value: NO_SPRINT, label: 'No sprint' },
    ...(board?.sprints ?? []).map((s) => ({ value: s.slug, label: s.title })),
  ];
  const storyOptions = [
    { value: NO_STORY, label: 'No story' },
    ...(board?.stories ?? []).map((s) => ({ value: s.slug, label: s.title })),
  ];

  const hasSprints = (board?.sprints.length ?? 0) > 0;
  const hasStories = (board?.stories.length ?? 0) > 0;

  return (
    <div className="mx-auto min-h-screen max-w-[1600px] px-4 py-4">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-lg font-bold tracking-tight">Plot</h1>
        {hasSprints && (
          <MultiSelect label="All sprints" options={sprintOptions} selected={sprintSel} onChange={onSprint} />
        )}
        {hasStories && (
          <MultiSelect label="All stories" options={storyOptions} selected={storySel} onChange={onStory} />
        )}
      </header>
      <main>
        {error ? (
          <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            Failed to load board: {error}
          </p>
        ) : board ? (
          <BoardView board={board} sprintSel={sprintSel} storySel={storySel} />
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </main>
    </div>
  );
}
