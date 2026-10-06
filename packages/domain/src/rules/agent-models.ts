/**
 * What one worker run on the SDK runner is asked to use: its model, its
 * effort and its context-window cap, read in the plan's precedence.
 *
 * A charter is an Agent fact a person wrote for one agent; a `## Plot Config`
 * key is a project default. So the charter wins, then the `worker` entry of
 * `Agent models`, then the model the `Worker command` names, then the CLI's
 * own default (an empty model).
 */
import { fragmentModel } from './fragment-model.js';

/** `Agent max turns` where the key is absent. */
export const DEFAULT_AGENT_MAX_TURNS = 150;

/** `Agent context window` where the key is absent, in tokens. */
export const DEFAULT_AGENT_CONTEXT_WINDOW = 200_000;

/**
 * The model one role names in an `Agent models` list.
 *
 * The list has the form of `Local checks`: `role = model` entries separated
 * by `;`, for example `worker = sonnet; idea = opus`.
 *
 * @param list - the key's value; `''` where the key is absent.
 * @param role - the role asked about, such as `worker`.
 * @returns the model the first entry for `role` names; `''` where none does.
 */
export const agentModelFor = (list: string, role: string): string => {
  for (const entry of list.split(';')) {
    const at = entry.indexOf('=');
    if (at > 0 && entry.slice(0, at).trim() === role) return entry.slice(at + 1).trim();
  }
  return '';
};

/** What {@link agentRunSettings} reads. */
export interface AgentModelReading {
  /** The charter's model; `''` where no charter names one. */
  readonly charterModel: string;
  /** The charter's effort; `''` where no charter names one. */
  readonly charterEffort: string;
  /** The charter's `bounds.contextWindow`; `0` where it states none. */
  readonly charterContextWindow: number;
  /** `Agent models`, verbatim; `''` where absent. */
  readonly agentModels: string;
  /** `Worker command`, verbatim; `''` where absent. */
  readonly workerCommand: string;
  /** `Agent context window`, in tokens. */
  readonly agentContextWindow: number;
}

/** Where a worker run's model came from. */
export type ModelSource = 'charter' | 'agent-models' | 'worker-command' | 'default';

/** What one worker run on the SDK runner is asked to use. */
export interface AgentRunSettings {
  /** The model; `''` leaves the CLI's default. */
  readonly model: string;
  /** Which reading named {@link model}. */
  readonly modelSource: ModelSource;
  /** The effort; `''` leaves the CLI's default. */
  readonly effort: string;
  /** The context-window cap in tokens; `0` for no cap. */
  readonly contextWindow: number;
}

/**
 * Reads one worker run's model, effort and context cap.
 *
 * The model comes from the charter, then `Agent models`' `worker` entry, then
 * the `Worker command`'s `--model` flag or `PLOT_MODEL=` prefix
 * ({@link fragmentModel}), then the CLI's default. The effort comes only from
 * the charter. A charter's stated context window caps `Agent context window`.
 *
 * @param reading - the charter's values and the three config keys.
 * @returns the settings the run is asked to use.
 */
export const agentRunSettings = (reading: AgentModelReading): AgentRunSettings => {
  const contextWindow =
    reading.charterContextWindow > 0 && (reading.agentContextWindow <= 0 || reading.charterContextWindow < reading.agentContextWindow)
      ? reading.charterContextWindow
      : reading.agentContextWindow;
  const settings = { effort: reading.charterEffort, contextWindow };
  if (reading.charterModel !== '') return { ...settings, model: reading.charterModel, modelSource: 'charter' };
  const listed = agentModelFor(reading.agentModels, 'worker');
  if (listed !== '') return { ...settings, model: listed, modelSource: 'agent-models' };
  const fragment = fragmentModel(reading.workerCommand);
  if (fragment.named) return { ...settings, model: fragment.model, modelSource: 'worker-command' };
  return { ...settings, model: '', modelSource: 'default' };
};
