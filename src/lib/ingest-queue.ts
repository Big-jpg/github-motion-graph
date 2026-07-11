import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { send } from '@vercel/queue';
import { ensureTables } from '@/db/migrate';

export const INGEST_TOPIC = 'github-ingestion';

export type IngestMessage = { runId: string; jobId: string };

function client() {
  return neon(process.env.DATABASE_URL!);
}

export async function createIngestionRun(options: Record<string, unknown>) {
  await ensureTables();
  const sql = client();
  const runId = randomUUID();
  const jobId = randomUUID();
  await sql.transaction([
    sql`INSERT INTO ingestion_runs (id, options) VALUES (${runId}, ${JSON.stringify(options)}::jsonb)`,
    sql`INSERT INTO ingestion_jobs (id, run_id, kind, dedupe_key, payload)
        VALUES (${jobId}, ${runId}, 'discover', 'discover', ${JSON.stringify(options)}::jsonb)`,
    sql`UPDATE ingestion_runs SET total_jobs = 1 WHERE id = ${runId}`,
  ]);
  try {
    await send(INGEST_TOPIC, { runId, jobId } satisfies IngestMessage);
  } catch (error) {
    await sql`UPDATE ingestion_runs SET status = 'failed', error = ${message(error)}, completed_at = NOW(), updated_at = NOW() WHERE id = ${runId}`;
    throw error;
  }
  return { runId, jobId };
}

export async function getJob(jobId: string) {
  const rows = await client()`SELECT * FROM ingestion_jobs WHERE id = ${jobId} LIMIT 1`;
  return rows[0] as Record<string, unknown> | undefined;
}

export async function claimJob(jobId: string) {
  const rows = await client()`
    UPDATE ingestion_jobs
    SET status = 'running', attempts = attempts + 1, started_at = COALESCE(started_at, NOW()), updated_at = NOW()
    WHERE id = ${jobId} AND (
      status IN ('queued', 'retrying')
      OR (status = 'running' AND updated_at < NOW() - INTERVAL '290 seconds')
    )
    RETURNING *
  `;
  return rows[0] as Record<string, unknown> | undefined;
}

export async function addRepositoryJob(runId: string, repository: string, options: Record<string, unknown>) {
  const sql = client();
  const jobId = randomUUID();
  const payload = { ...options, repositoryNames: [repository] };
  const inserted = await sql`
    INSERT INTO ingestion_jobs (id, run_id, kind, dedupe_key, payload)
    VALUES (${jobId}, ${runId}, 'repository', ${`repository:${repository.toLowerCase()}`}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (run_id, dedupe_key) DO NOTHING
    RETURNING id
  `;
  const effectiveJobId = inserted.length
    ? jobId
    : String((await sql`SELECT id FROM ingestion_jobs WHERE run_id = ${runId} AND dedupe_key = ${`repository:${repository.toLowerCase()}`} LIMIT 1`)[0].id);
  if (inserted.length) {
    await sql`UPDATE ingestion_runs SET total_jobs = total_jobs + 1, updated_at = NOW() WHERE id = ${runId}`;
  }
  await send(INGEST_TOPIC, { runId, jobId: effectiveJobId } satisfies IngestMessage);
}

export async function updateRunViewer(runId: string, viewer: string) {
  await client()`UPDATE ingestion_runs SET viewer_login = ${viewer}, status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW() WHERE id = ${runId}`;
}

export async function completeJob(jobId: string, result: unknown = null) {
  const sql = client();
  const rows = await sql`
    UPDATE ingestion_jobs SET status = 'complete', result = ${JSON.stringify(result)}::jsonb,
      last_error = NULL, completed_at = NOW(), updated_at = NOW()
    WHERE id = ${jobId} AND status <> 'complete' RETURNING run_id
  `;
  if (rows.length) await refreshRun(String(rows[0].run_id));
}

export async function retryJob(jobId: string, error: unknown, terminal = false) {
  const sql = client();
  const status = terminal ? 'failed' : 'retrying';
  const rows = await sql`
    UPDATE ingestion_jobs SET status = ${status}, last_error = ${message(error)},
      completed_at = ${terminal ? new Date() : null}, updated_at = NOW()
    WHERE id = ${jobId} RETURNING run_id
  `;
  if (terminal && rows.length) await refreshRun(String(rows[0].run_id));
}

export async function refreshRun(runId: string) {
  const sql = client();
  const counts = await sql`
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'complete')::int AS complete,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE status IN ('queued','running','retrying'))::int AS pending
    FROM ingestion_jobs WHERE run_id = ${runId}
  `;
  const count = counts[0];
  const pending = Number(count.pending);
  const failed = Number(count.failed);
  const status = pending > 0 ? 'running' : failed > 0 ? 'partial' : 'complete';
  await sql`
    UPDATE ingestion_runs SET status = ${status}, total_jobs = ${Number(count.total)},
      completed_jobs = ${Number(count.complete)}, failed_jobs = ${failed}, updated_at = NOW(),
      completed_at = ${pending === 0 ? new Date() : null}
    WHERE id = ${runId}
  `;
}

export async function getRun(runId: string) {
  await ensureTables();
  const sql = client();
  const runs = await sql`SELECT * FROM ingestion_runs WHERE id = ${runId} LIMIT 1`;
  if (!runs.length) return null;
  const jobs = await sql`
    SELECT id, kind, dedupe_key, status, attempts, last_error, result, created_at, started_at, updated_at, completed_at
    FROM ingestion_jobs WHERE run_id = ${runId} ORDER BY created_at ASC
  `;
  const now = Date.now();
  const observableJobs = jobs.map((job) => {
    const updatedAt = Date.parse(String(job.updated_at));
    const leaseAgeSeconds = Number.isFinite(updatedAt) ? Math.max(0, Math.floor((now - updatedAt) / 1_000)) : null;
    let health = job.status;
    if (job.status === 'running') {
      health = leaseAgeSeconds !== null && leaseAgeSeconds > 330 ? 'stale-lease' : 'in-flight';
    } else if (job.status === 'retrying') {
      health = 'waiting-for-retry';
    }
    return { ...job, health, lease_age_seconds: leaseAgeSeconds };
  });
  return { ...runs[0], jobs: observableJobs };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
