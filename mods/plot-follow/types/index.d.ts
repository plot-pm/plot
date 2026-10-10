export type FollowedFinding = {
  monitor: string;
  branch: string;
  finding: string;
  since: string;
  evidence: string;
};

export type Held = { findings: FollowedFinding[]; heard: boolean };

declare module 'claude-code' {
  interface PluginState {
    'plot-follow': { held: Held };
  }
}
