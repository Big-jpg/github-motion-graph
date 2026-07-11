import { NextRequest } from 'next/server';
import { handleCallback } from '@vercel/queue';
import { githubGraphQL, githubGraphQLPages, REPOS_QUERY, VIEWER_QUERY, type GitHubConnection, type RepoNode } from '@/lib/github';
import { addRepositoryJob, claimJob, completeJob, retryJob, updateRunViewer, type IngestMessage } from '@/lib/ingest-queue';
import { runSynchronousIngestion } from '@/app/api/ingest/route';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface RepositoriesData { viewer: { repositories: GitHubConnection<RepoNode> } }

class PermanentIngestError extends Error {}

async function discover(runId: string, payload: Record<string, unknown>) {
  const viewer = await githubGraphQL<{ viewer: { login: string } }>(VIEWER_QUERY);
  const expected = typeof payload.username === 'string' ? payload.username : null;
  if (expected && expected.toLowerCase() !== viewer.viewer.login.toLowerCase()) {
    throw new PermanentIngestError(`GH_TOKEN belongs to ${viewer.viewer.login}, not ${expected}`);
  }
  await updateRunViewer(runId, viewer.viewer.login);

  const affiliations = Array.isArray(payload.affiliations)
    ? payload.affiliations
    : ['OWNER', 'COLLABORATOR', 'ORGANIZATION_MEMBER'];
  const visibility = typeof payload.visibility === 'string' ? payload.visibility : 'public';
  const includeForks = payload.includeForks !== false;
  const requested = Array.isArray(payload.repositoryNames)
    ? new Set(payload.repositoryNames.map(String).map((name) => name.toLowerCase()))
    : null;
  const matched = new Set<string>();

  for await (const page of githubGraphQLPages<RepositoriesData, RepoNode>(
    REPOS_QUERY,
    { affiliations, isFork: includeForks ? null : false, privacy: visibility === 'all' ? null : visibility.toUpperCase() },
    (data) => data.viewer.repositories,
  )) {
    for (const repo of page.nodes) {
      const normalized = repo.nameWithOwner.toLowerCase();
      if (requested && !requested.has(normalized)) continue;
      matched.add(normalized);
      await addRepositoryJob(runId, repo.nameWithOwner, payload);
    }
  }
  if (requested) {
    const missing = [...requested].filter((name) => !matched.has(name));
    if (missing.length) throw new PermanentIngestError(`Repositories not found in the selected scope: ${missing.join(', ')}`);
  }
  return { viewer: viewer.viewer.login, repositoriesQueued: matched.size };
}

async function ingestRepository(payload: Record<string, unknown>) {
  const secret = process.env.INGEST_SECRET || '';
  const request = new NextRequest('http://queue.internal/api/ingest', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const response = await runSynchronousIngestion(request);
  const result = await response.json();
  if (!response.ok || result.success !== true) {
    throw new Error(result.error || result.message || `Repository ingest failed with HTTP ${response.status}`);
  }
  return result;
}

export const POST = handleCallback<IngestMessage>(async (message, metadata) => {
  const job = await claimJob(message.jobId);
  if (!job) return; // completed jobs make duplicate deliveries harmless
  console.info('ingestion.job.started', {
    runId: message.runId,
    jobId: message.jobId,
    kind: job.kind,
    dedupeKey: job.dedupe_key,
    deliveryCount: metadata.deliveryCount,
    messageId: metadata.messageId,
  });
  try {
    const payload = (job.payload || {}) as Record<string, unknown>;
    const result = job.kind === 'discover'
      ? await discover(message.runId, payload)
      : await ingestRepository(payload);
    await completeJob(message.jobId, result);
    console.info('ingestion.job.completed', {
      runId: message.runId,
      jobId: message.jobId,
      dedupeKey: job.dedupe_key,
      deliveryCount: metadata.deliveryCount,
      messageId: metadata.messageId,
    });
  } catch (error) {
    const terminal = error instanceof PermanentIngestError || metadata.deliveryCount >= 5;
    await retryJob(message.jobId, error, terminal);
    console.error('ingestion.job.failed', {
      runId: message.runId,
      jobId: message.jobId,
      dedupeKey: job.dedupe_key,
      deliveryCount: metadata.deliveryCount,
      messageId: metadata.messageId,
      terminal,
      error: error instanceof Error ? error.message : String(error),
    });
    if (!terminal) throw error;
  }
}, { visibilityTimeoutSeconds: 300 });
