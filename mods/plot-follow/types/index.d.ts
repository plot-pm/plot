export type FollowedFinding = {
  monitor: string;
  branch: string;
  finding: string;
  since: string;
  evidence: string;
};

export type Held = {
  findings: FollowedFinding[];
  heard: boolean;
  /** Heard before a reload; the channel has not answered since. */
  stale?: boolean;
};

declare module 'claude-code' {
  interface PluginState {
    'plot-follow': { held: Held };
  }
}
