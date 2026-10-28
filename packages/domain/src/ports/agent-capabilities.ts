/** What an agent's charter declares it may touch, read synchronously. */
export type CapabilityReading =
  | { kind: 'none' }
  | { kind: 'declared'; list: string }
  | { kind: 'unreadable'; detail: string };

/**
 * Asks `plot-prompt.mjs --capabilities` what a named agent's charter declares,
 * synchronously.
 *
 * Synchronous because its caller decides inside a synchronous manifest write;
 * `resolveCapabilities` in `continuation.ts` is the one caller.
 */
export interface AgentCapabilities {
  /**
   * Reads one agent's declared capabilities.
   *
   * @param repoRoot - the repository the agent registry lives under.
   * @param agent - the agent name; empty names none.
   * @returns `none` for no agent, no bundle, no charter or no capabilities;
   *   `unreadable` for exit 3, with the bundle's stderr.
   */
  declaredFor(repoRoot: string, agent: string): CapabilityReading;
}
