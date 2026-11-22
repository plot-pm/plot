import { useEffect, useRef, useState } from 'react';
import type { RowMenuItem, RowMenuView } from '../lib/agent-rows/delivery-view.js';
import { LooseDeleteButton } from './LooseDeleteButton.js';
import { ReleaseClaimButton } from './ReleaseClaimButton.js';

/** The menu of the grouped Unblock row, as the view-model built it. */
export type CleanUpMenuView = Extract<RowMenuView, { kind: 'branches' }>;

/**
 * Closes a popup on Escape and on a click outside its box. The click listener runs on capture, so it
 * hit-tests the target instead of relying on propagation.
 */
const useDismiss = (open: boolean, close: () => void) => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: globalThis.MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDown, true);
    };
  }, [open, close]);
  return box;
};

const POPUP_BOX = 'absolute z-10 mt-1 w-max max-w-[min(24rem,80vw)] rounded-md border border-slate-200 bg-white p-1 text-left shadow-lg dark:border-slate-700 dark:bg-slate-900';

/**
 * One item of a loose branch's set. An enabled Open is a link, an enabled Release claim and Delete branch are their
 * controllers' buttons, and a disabled item stays listed with its reason.
 *
 * @param branch - the branch the item acts on.
 * @param item - the item from `looseItems`.
 * @param open - the address Open links to.
 */
const LooseItem = ({ branch, item, open }: { branch: string; item: RowMenuItem; open: string }) => {
  if (!item.enabled) {
    return (
      <div role="menuitem" aria-disabled="true" data-menu-item={item.action} data-menu-reason={item.reason ?? ''} className="px-2 py-1 text-xs text-slate-400 dark:text-slate-500">
        {item.label} <span className="italic">· {item.reason}</span>
      </div>
    );
  }
  return (
    <div role="menuitem" data-menu-item={item.action} className="px-2 py-1">
      {item.action === 'open' && (
        <a href={open} target="_blank" rel="noreferrer" data-open-link aria-label={`Open ${branch} on the git host`} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
          {item.label}
        </a>
      )}
      {item.action === 'release-claim' && <ReleaseClaimButton branch={branch} label={item.label} confirmText={item.confirm ?? undefined} />}
      {item.action === 'delete-branch' && <LooseDeleteButton branch={branch} label={item.label} confirmText={item.confirm ?? undefined} />}
    </div>
  );
};

/**
 * The `⋯` menu of the grouped Unblock row: each loose branch by name, then its Open, Release claim and Delete
 * branch, each enabled or disabled with the reason the view-model gives. The menu decides nothing.
 *
 * @param menu - the grouped row's `branches` menu from `groupLooseItems`.
 * @param opens - the address Open links to, by branch.
 * @param label - the trigger's accessible name.
 */
export const CleanUpMenu = ({ menu, opens, label }: { menu: CleanUpMenuView; opens: ReadonlyMap<string, string>; label: string }) => {
  const [open, setOpen] = useState(false);
  const box = useDismiss(open, () => setOpen(false));
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        data-row-actions
        data-clean-up-menu
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        disabled={menu.trigger === 'none'}
        onClick={() => setOpen((v) => !v)}
        className="-my-1 -mr-0.5 inline-flex h-6 w-6 items-center justify-center rounded text-xs leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        ⋯
      </button>
      {open && (
        <div role="menu" className={`right-0 ${POPUP_BOX}`}>
          {menu.branches.map(({ branch, items }) => (
            <div key={branch} role="group" aria-label={branch} data-menu-branch={branch} className="py-0.5">
              <div className="px-2 pt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">{branch}</div>
              {items.map((it) => <LooseItem key={it.action} branch={branch} item={it} open={opens.get(branch) ?? ''} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
