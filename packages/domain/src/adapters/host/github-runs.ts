import type { HostRefusal } from '../../ports/host.js';
import type { GhRun } from '../../rules/runs-for-sha.js';
import type { GithubApi } from './github-api.js';

/** The runs `plot-host.sh runs-for-sha` asks `gh run list` for. */
export const RUNS_FOR_SHA_LIMIT = 20;

/** The workflows one REST page holds, as `gh` asks them. */
const WORKFLOW_PAGE = 100;

/** The time `gh` exports for a REST time that is null: Go's zero time. */
const ZERO_TIME = '0001-01-01T00:00:00Z';

/** What one listing answered. */
export type GithubRunsAnswer =
  | { readonly ok: true; readonly runs: readonly GhRun[] }
  | { readonly ok: false; readonly refusal: HostRefusal };

/** The in-process GitHub Actions run listing. */
export interface GithubRuns {
  /** Lists a branch's newest runs. Never rejects. */
  list(branch: string, limit?: number): Promise<GithubRunsAnswer>;
}

/** A value read as an object, or an empty one. */
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** A value read as an array, or an empty one. */
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/** A REST string, or `''` for null, as `gh` exports it. */
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Builds the in-process GitHub Actions run listing over one client.
 *
 * It sends the REST requests `gh run list --branch <b> --limit <n> --json
 * headSha,conclusion,status,startedAt,url,databaseId,workflowName` sends:
 * `GET /repos/{owner}/{repo}/actions/runs` with the branch, `per_page` and
 * `exclude_pull_requests`; where a run came back, the repository's workflows
 * page by page; and `GET /actions/workflows/{id}` for each workflow id the
 * listing did not name. A workflow that answers `404` exports an empty name.
 *
 * Each run exports as `gh` exports it: `headSha`, the conclusion with null as
 * `''`, the status, `startedAt` from `run_started_at` with null as Go's zero
 * time, the page `url`, the id and the workflow's name.
 *
 * @param api - the in-process GitHub client.
 * @returns the listing.
 */
export const githubRuns = (api: GithubApi): GithubRuns => ({
  list: async (branch, limit = RUNS_FOR_SHA_LIMIT) => {
    const slug = api.origin.slug;
    if (slug === null) return { ok: false, refusal: { kind: 'failed', said: 'the origin remote names no GitHub owner/repo' } };
    const params = new URLSearchParams({ branch, exclude_pull_requests: 'true', per_page: String(limit) });
    const asked = await api.request({ method: 'GET', path: `/repos/${slug}/actions/runs?${params.toString()}`, label: 'actions runs' });
    if (!asked.ok) return { ok: false, refusal: asked.refusal };
    const raw = list(record(asked.reply.body).workflow_runs).map(record);
    const names = new Map<unknown, string>();
    if (raw.length > 0) {
      for (let page = 1, seen = 0; ; page += 1) {
        const query = new URLSearchParams({ page: String(page), per_page: String(WORKFLOW_PAGE) });
        const flows = await api.request({ method: 'GET', path: `/repos/${slug}/actions/workflows?${query.toString()}`, label: `actions workflows, page ${page}` });
        if (!flows.ok) return { ok: false, refusal: flows.refusal };
        const body = record(flows.reply.body);
        const found = list(body.workflows).map(record);
        for (const flow of found) names.set(flow.id, text(flow.name));
        seen += found.length;
        if (found.length === 0 || seen >= Number(body.total_count)) break;
      }
      for (const id of new Set(raw.map((run) => run.workflow_id))) {
        if (names.has(id)) continue;
        const one = await api.request({ method: 'GET', path: `/repos/${slug}/actions/workflows/${String(id)}`, label: `actions workflow ${String(id)}` });
        if (one.ok) names.set(id, text(record(one.reply.body).name));
        else if (one.reply?.status === 404) names.set(id, '');
        else return { ok: false, refusal: one.refusal };
      }
    }
    const runs = raw.map((run): GhRun => ({
      headSha: text(run.head_sha),
      conclusion: text(run.conclusion),
      status: text(run.status),
      startedAt: typeof run.run_started_at === 'string' && run.run_started_at !== '' ? run.run_started_at : ZERO_TIME,
      url: text(run.html_url),
      databaseId: run.id as number,
      workflowName: names.get(run.workflow_id) ?? '',
    }));
    return { ok: true, runs };
  },
});
