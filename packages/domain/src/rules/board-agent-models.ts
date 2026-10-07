/**
 * What one board role's run on the SDK runner is asked to use: its model,
 * read in the plan's precedence.
 *
 * A board role has no charter — charters are worker-only — and no
 * context-window clamp: a single-shot run has no `autoCompactWindow` to cap.
 * So the model comes from the role's own entry in `Agent models`, then the
 * role's fragment's `--model` flag or `PLOT_MODEL=` prefix
 * ({@link fragmentModel}), then the CLI's default.
 */
import { agentModelFor } from './agent-models.js';
import { fragmentModel } from './fragment-model.js';

/** Where a board role's model came from. */
export type BoardModelSource = 'agent-models' | 'role-command' | 'default';

/** What {@link boardAgentModel} reads. */
export interface BoardAgentModelReading {
  /** `Agent models`, verbatim; `''` where absent. */
  readonly agentModels: string;
  /** The role's own command fragment, verbatim; `''` where the project names none. */
  readonly roleCommand: string;
}

/**
 * Reads one board role's model.
 *
 * @param role - the role asked about, such as `idea` or `brief`.
 * @param reading - `Agent models`, and the role's own command fragment.
 * @returns the model to run with (`''` leaves the CLI's default), and which
 *   reading named it.
 */
export const boardAgentModel = (
  role: string,
  reading: BoardAgentModelReading,
): { readonly model: string; readonly modelSource: BoardModelSource } => {
  const listed = agentModelFor(reading.agentModels, role);
  if (listed !== '') return { model: listed, modelSource: 'agent-models' };
  const fragment = fragmentModel(reading.roleCommand);
  if (fragment.named) return { model: fragment.model, modelSource: 'role-command' };
  return { model: '', modelSource: 'default' };
};
