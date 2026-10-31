import { pathToFileURL } from "node:url";

export const INSPECTION_REPOSITORY = "Pedrooca4/redpro";
export const INSPECTION_ENVIRONMENT = "minepro-development-inspection";
const OWNER = "Pedrooca4";
const OWNER_ID = 289236254;

function refuse(): never {
  throw new Error("DB_INSPECTION_GATE_REFUSED");
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return refuse();
  return value as Record<string, unknown>;
};

export function validateInspectionInvocation(env: Readonly<Record<string, string | undefined>>) {
  if (
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_REPOSITORY !== INSPECTION_REPOSITORY ||
    env.GITHUB_REPOSITORY_ID !== "1436162515" ||
    env.GITHUB_ACTOR !== OWNER ||
    env.GITHUB_TRIGGERING_ACTOR !== OWNER ||
    !/^[a-f0-9]{40}$/.test(env.EXPECTED_SHA ?? "") ||
    env.EXPECTED_SHA !== env.GITHUB_SHA ||
    env.RUNNER_DEBUG === "1" ||
    env.ACTIONS_STEP_DEBUG === "true"
  )
    refuse();
  return env.EXPECTED_SHA!;
}

export function validateInspectionProtection(environment: unknown, policies: unknown) {
  const e = record(environment);
  const branch = record(e.deployment_branch_policy);
  const rules = e.protection_rules;
  const p = record(policies);
  const branches = p.branch_policies;
  if (
    e.name !== INSPECTION_ENVIRONMENT ||
    e.can_admins_bypass !== false ||
    branch.protected_branches !== false ||
    branch.custom_branch_policies !== true ||
    !Array.isArray(rules) ||
    !Array.isArray(branches) ||
    p.total_count !== 1 ||
    branches.length !== 1
  )
    refuse();
  const only = record(branches[0]);
  if (only.type !== "branch" || only.name !== "main") refuse();
  const review = rules.map(record).find((rule) => rule.type === "required_reviewers");
  if (!review || !Array.isArray(review.reviewers) || review.reviewers.length !== 1) refuse();
  const reviewer = record(review.reviewers[0]);
  const user = record(reviewer.reviewer);
  // The owner initiates and explicitly approves this read-only job. This is not
  // separation of duties; do not pretend self-review provides a second person.
  if (
    review.prevent_self_review !== false ||
    reviewer.type !== "User" ||
    user.login !== OWNER ||
    user.id !== OWNER_ID
  )
    refuse();
}

export function validateInspectionRepository(repository: unknown, main: unknown, sha: string) {
  const r = record(repository);
  if (
    r.id !== 1436162515 ||
    r.full_name !== INSPECTION_REPOSITORY ||
    r.private !== true ||
    r.default_branch !== "main" ||
    record(r.owner).id !== OWNER_ID ||
    record(record(main).commit).sha !== sha
  )
    refuse();
}

export function validateInspectionCI(runs: unknown, jobs: unknown, sha: string) {
  const list = record(runs).workflow_runs;
  if (!Array.isArray(list) || !list.length) refuse();
  const run = record(list[0]);
  if (
    run.head_sha !== sha ||
    run.head_branch !== "main" ||
    run.event !== "push" ||
    run.path !== ".github/workflows/ci.yml" ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  )
    refuse();
  const result = record(jobs);
  if (!Array.isArray(result.jobs) || result.total_count !== 2 || result.jobs.length !== 2) refuse();
  const names = new Set(["Quality and production smoke", "Disposable PostgreSQL migrations"]);
  for (const value of result.jobs) {
    const job = record(value);
    if (
      job.run_id !== run.id ||
      job.status !== "completed" ||
      job.conclusion !== "success" ||
      !names.delete(String(job.name))
    )
      refuse();
  }
  if (names.size) refuse();
}

export async function checkInspectionGate(
  env: Readonly<Record<string, string | undefined>>,
  request: typeof fetch = fetch,
) {
  const sha = validateInspectionInvocation(env);
  if (!env.GH_TOKEN) refuse();
  const get = async (resource: string) => {
    const response = await request(
      `https://api.github.com/repos/${INSPECTION_REPOSITORY}${resource}`,
      {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GH_TOKEN}`,
          "X-GitHub-Api-Version": "2026-03-10",
        },
      },
    );
    if (!response.ok) refuse();
    return response.json() as Promise<unknown>;
  };
  const repository = await get("");
  const main = await get("/branches/main");
  validateInspectionRepository(repository, main, sha);
  const root = `/environments/${INSPECTION_ENVIRONMENT}`;
  validateInspectionProtection(
    await get(root),
    await get(`${root}/deployment-branch-policies?per_page=100`),
  );
  const runs = await get(
    `/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=main&per_page=100`,
  );
  const list = record(runs).workflow_runs;
  if (!Array.isArray(list) || !Number.isSafeInteger(record(list[0]).id)) refuse();
  const id = record(list[0]).id;
  validateInspectionCI(runs, await get(`/actions/runs/${id}/jobs?filter=latest&per_page=100`), sha);
  return {
    event: "database.inspection.authorized",
    sha,
    target: "rdwchjjxaipkufgxlnvh",
    mode: "read-only",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await checkInspectionGate(process.env)));
  } catch {
    console.error('{"event":"database.inspection.refused","code":"DB_INSPECTION_GATE_REFUSED"}');
    process.exitCode = 1;
  }
}
