import type { DeliveryMine, DeliveryScopeKind, DeliverySection, TicketsSection } from '@plot-pm/domain';
import type { MachineHeadroom } from '@plot-pm/domain/rules/machine-health';
import type { Supervisor } from '../../../contract/schema.js';
import type { DeliveryView, SectionHiddenCounts } from './delivery-view.js';
import type { MachineHealth } from './machine-health.js';

/** What an empty section says: `clear` has nothing to do, `unread` lost a reading, `stopped` has a source that does not run. */
export type EmptyKind = 'clear' | 'unread' | 'stopped';

/** The frame an open section shows in place of its content. */
export interface SectionEmpty {
  kind: EmptyKind;
  /** The one sentence the frame shows, the scope named in it where the section reads the scope. */
  sentence: string;
  /** The failure or the source's own words under the sentence; `null` where none applies. */
  note: string | null;
  /** The items Mine hides from this section; `null` where Mine is off or hides nothing. */
  hidden: number | null;
}

/** The Delivery scope as a sentence names it: its kind and the names of the sprints in scope. */
export interface EmptyScope {
  kind: DeliveryScopeKind;
  sprints: readonly string[];
}

/** The input of one section, discriminated by `section`. */
export type SectionEmptyInput =
  | { section: 'release-delivery'; count: number; scope: EmptyScope }
  | {
    section: 'you';
    count: number;
    /** The items `view.notPlaced` holds with reason `unread`. */
    unread: number;
    issueAnswer: 'answered' | 'failed' | 'unsupported' | null;
    /** `issueNote` of the fleet: the failure and the age of the last good rows. */
    issueNote: string | null;
    scope: EmptyScope;
    mine: DeliveryMine;
    hidden: number;
  }
  | { section: 'work-items'; count: number; unread: number; scope: EmptyScope; mine: DeliveryMine; hidden: number }
  | {
    section: 'fleet';
    count: number;
    /** The agents `view.notPlaced` holds with reason `unread`. */
    unread: number;
    /** The payload's `fleet.supervisor`; `null` where the payload carries none. */
    supervisor: Supervisor | null;
    mine: DeliveryMine;
    hidden: number;
  }
  | { section: 'machine'; headroom: MachineHeadroom; health: MachineHealth }
  | {
    section: 'tickets';
    state: TicketsSection<unknown>['state'];
    count: number;
    /** `issueNote` of the fleet, else its `issueError`; read for state `failed`. */
    note: string | null;
    /** The fleet's `issueAbsence`; read for state `unsupported`. */
    absence: string | null;
    scope: EmptyScope;
    mine: DeliveryMine;
    hidden: number;
  };

const scoped = (base: string, scope: EmptyScope): string => {
  if (scope.kind !== 'my-sprint') return `${base}.`;
  const names = scope.sprints.join(', ');
  const which = scope.sprints.length > 1 ? 'my sprints' : 'my sprint';
  return names === '' ? `${base} in ${which}.` : `${base} in ${which} · ${names}.`;
};

const hiddenOf = (mine: DeliveryMine, hidden: number): number | null => (mine !== 'off' && hidden > 0 ? hidden : null);

const notRead = (n: number): string => `${n} not read.`;

/**
 * The empty kind of one Delivery section.
 *
 * An unread reading wins over clear: a section whose subjects sit in Not placed
 * with reason `unread`, a You section whose tracker read failed, and a Fleet
 * whose supervisor is not `up` never answer clear. A Fleet with no supervisor
 * reading answers stopped. Machine is empty only where its headroom is
 * unmeasured and no resource limits the fleet; a measured Machine shows its
 * meters. Fleet and Machine never name the scope.
 *
 * @param input - the section's counts and readings.
 * @returns `null` for a section with rows; otherwise the kind, the sentence, the note and the Mine-hidden count.
 */
export const sectionEmptyKind = (input: SectionEmptyInput): SectionEmpty | null => {
  switch (input.section) {
    case 'release-delivery':
      return input.count > 0 ? null
        : { kind: 'clear', sentence: scoped('No approved plan belongs to a release or sprint yet', input.scope), note: null, hidden: null };
    case 'you': {
      if (input.count > 0) return null;
      const hidden = hiddenOf(input.mine, input.hidden);
      if (input.unread > 0) return { kind: 'unread', sentence: notRead(input.unread), note: input.issueAnswer === 'failed' ? input.issueNote : null, hidden };
      if (input.issueAnswer === 'failed') return { kind: 'unread', sentence: scoped('The tracker gave no answer', input.scope), note: input.issueNote, hidden };
      return { kind: 'clear', sentence: scoped('Nothing waits on you', input.scope), note: null, hidden };
    }
    case 'work-items': {
      if (input.count > 0) return null;
      const hidden = hiddenOf(input.mine, input.hidden);
      return input.unread > 0
        ? { kind: 'unread', sentence: notRead(input.unread), note: null, hidden }
        : { kind: 'clear', sentence: scoped('No work item is at a gate, being built or queued', input.scope), note: null, hidden };
    }
    case 'fleet': {
      if (input.count > 0) return null;
      const hidden = hiddenOf(input.mine, input.hidden);
      const verdict = input.supervisor;
      if (verdict === null) return { kind: 'stopped', sentence: 'The fleet status is unknown.', note: null, hidden };
      if (verdict.state === 'down') return { kind: 'stopped', sentence: 'The fleet is not running.', note: null, hidden };
      if (verdict.state === 'died') return { kind: 'stopped', sentence: 'The fleet stopped unexpectedly.', note: verdict.detail, hidden };
      if (verdict.state === 'unknown') return { kind: 'stopped', sentence: 'The fleet status is unknown.', note: verdict.detail, hidden };
      if (input.unread > 0) return { kind: 'unread', sentence: notRead(input.unread), note: null, hidden };
      return { kind: 'clear', sentence: 'No agent runs.', note: null, hidden };
    }
    case 'machine':
      return input.headroom === 'unmeasured' && input.health.rows.length === 0
        ? { kind: 'stopped', sentence: `The machine is ${input.health.word}.`, note: input.health.line === '' ? null : input.health.line, hidden: null }
        : null;
    case 'tickets': {
      const hidden = hiddenOf(input.mine, input.hidden);
      if (input.state === 'failed') return { kind: 'unread', sentence: 'The tracker gave no answer.', note: input.note, hidden };
      if (input.state === 'unsupported') return { kind: 'stopped', sentence: 'The tracker cannot be read here.', note: input.absence, hidden };
      if (input.state === 'unasked') return { kind: 'unread', sentence: 'The tracker has not been read yet.', note: null, hidden };
      return input.count > 0 ? null : { kind: 'clear', sentence: scoped('No ticket waits for a plan', input.scope), note: null, hidden };
    }
  }
};

/** The mark of each empty kind: the clear ✓, the unread !, the stopped ■. */
export const EMPTY_MARK: Readonly<Record<EmptyKind, string>> = { clear: '✓', unread: '!', stopped: '■' };

/** The words of the frame's Mine button. */
export const hiddenByMineWords = (hidden: number): string => `${hidden} hidden by Mine`;

/** The words of the frame's scope button, which sets the scope to the release. */
export const SCOPE_OFF_WORDS = 'show the release';

/**
 * Whether the frame of a section offers the scope button.
 *
 * @param section - the section.
 * @param scope - the Delivery scope's kind.
 * @returns true for Release delivery, You, Work items and Tickets under `my-sprint`; Fleet and Machine never read the scope.
 */
export const offersScopeOff = (section: SectionEmptyInput['section'], scope: DeliveryScopeKind): boolean =>
  scope === 'my-sprint' && section !== 'fleet' && section !== 'machine';

/** What `deliveryEmpties` reads beyond the view: the filters, the tracker answer, the supervisor and the machine. */
export interface DeliveryEmptyContext {
  hidden: SectionHiddenCounts;
  scope: EmptyScope;
  mine: DeliveryMine;
  issueAnswer: 'answered' | 'failed' | 'unsupported' | null;
  issueNote: string | null;
  supervisor: Supervisor | null;
  headroom: MachineHeadroom;
  health: MachineHealth;
}

/**
 * The empty kind of each of the five Delivery sections.
 *
 * The unread count of You and Work items is the items `view.notPlaced` holds
 * with reason `unread`; the unread count of Fleet is its agents.
 *
 * @param view - the shown view.
 * @param context - the filters and readings the sentences name.
 * @returns `sectionEmptyKind` of each section.
 */
export const deliveryEmpties = (
  view: Pick<DeliveryView, 'sections' | 'notPlaced' | 'releasePlanCount'>,
  context: DeliveryEmptyContext,
): Record<DeliverySection, SectionEmpty | null> => {
  const unread = (subject: 'item' | 'agent'): number => view.notPlaced.filter((u) => u.reason === 'unread' && u.subject === subject).length;
  const count = (key: DeliverySection): number => view.sections.find((s) => s.key === key)?.count ?? 0;
  const { hidden, scope, mine } = context;
  return {
    'release-delivery': sectionEmptyKind({ section: 'release-delivery', count: view.releasePlanCount, scope }),
    you: sectionEmptyKind({
      section: 'you', count: count('you'), unread: unread('item'), issueAnswer: context.issueAnswer, issueNote: context.issueNote,
      scope, mine, hidden: hidden.you,
    }),
    'work-items': sectionEmptyKind({ section: 'work-items', count: count('work-items'), unread: unread('item'), scope, mine, hidden: hidden['work-items'] }),
    fleet: sectionEmptyKind({ section: 'fleet', count: count('fleet'), unread: unread('agent'), supervisor: context.supervisor, mine, hidden: hidden.fleet }),
    machine: sectionEmptyKind({ section: 'machine', headroom: context.headroom, health: context.health }),
  };
};
