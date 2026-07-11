#!/usr/bin/env node
import fs from 'node:fs';

for (const file of ['.env.local', '.env']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim().replace(/\s+#.*$/, '');
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

const args = process.argv.slice(2);
const options = { url: process.env.INGEST_URL || 'https://github-motion-graph.vercel.app/api/ingest', username: process.env.GITHUB_USERNAME || null, visibility: 'public', includeForks: true, allBranches: true, forkMode: 'shallow', repositories: [], branches: [], affiliations: [], timeout: 7200, wait: true, runId: null };
const value = (i, flag) => { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${flag} requires a value`); return args[i + 1]; };
const list = input => input.split(',').map(item => item.trim()).filter(Boolean);

for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (flag === '-h' || flag === '--help') {
    console.log(`GitHub Motion Graph ingestion\n\n  pnpm ingest -- --username Big-jpg\n  pnpm ingest -- --repo owner/name\n  pnpm ingest -- --run <run-id>\n\nOptions:\n  -u, --username <login>\n  -r, --repo <owner/name>       Repeat or comma-separate\n  -b, --branch <name>           Repeat or comma-separate\n  -a, --affiliation <value>\n      --visibility public|private|all\n      --exclude-forks\n      --full-forks               Traverse forks at normal full depth\n      --default-branch-only\n      --url <endpoint>\n      --timeout <seconds>        Overall watch timeout (default 7200)\n      --run <id>                 Resume watching a durable run\n      --no-wait                  Queue and return immediately`);
    process.exit(0);
  }
  if (flag === '--exclude-forks') { options.includeForks = false; continue; }
  if (flag === '--default-branch-only') { options.allBranches = false; continue; }
  if (flag === '--full-forks') { options.forkMode = 'full'; continue; }
  if (flag === '--no-wait') { options.wait = false; continue; }
  const next = value(i, flag); i++;
  if (['-u', '--username'].includes(flag)) options.username = next;
  else if (['-r', '--repo'].includes(flag)) options.repositories.push(...list(next));
  else if (['-b', '--branch'].includes(flag)) options.branches.push(...list(next));
  else if (['-a', '--affiliation'].includes(flag)) options.affiliations.push(...list(next).map(x => x.toUpperCase()));
  else if (flag === '--visibility') options.visibility = next.toLowerCase();
  else if (flag === '--url') options.url = next;
  else if (flag === '--timeout') options.timeout = Number(next);
  else if (flag === '--run') options.runId = next;
  else throw new Error(`Unknown option: ${flag}`);
}

const secret = process.env.INGEST_SECRET;
if (!secret) throw new Error('INGEST_SECRET is required in the shell, .env.local, or .env');
const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
const count = input => Number(input) || 0;

async function json(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Endpoint returned non-JSON (HTTP ${response.status}): ${text.slice(0, 300)}`); }
}

async function main() {
  let runId = options.runId;
  let statusUrl;
  if (!runId) {
    const body = { username: options.username, visibility: options.visibility, includeForks: options.includeForks, allBranches: options.allBranches, forkMode: options.forkMode };
    if (options.repositories.length) body.repositoryNames = [...new Set(options.repositories)];
    if (options.branches.length) body.branches = [...new Set(options.branches)];
    if (options.affiliations.length) body.affiliations = [...new Set(options.affiliations)];
    console.log(`Queueing ingestion for ${options.username || 'the authenticated GitHub viewer'}…`);
    const response = await fetch(options.url, { method: 'POST', headers, body: JSON.stringify(body) });
    const accepted = await json(response);
    if (!response.ok || !accepted.runId) throw new Error(accepted.error || accepted.message || `Queue request failed with HTTP ${response.status}`);
    runId = accepted.runId;
    statusUrl = new URL(accepted.statusUrl, options.url).toString();
    console.log(`Run: ${runId}`);
    if (!options.wait) return;
  }
  statusUrl ||= new URL(`${options.url.replace(/\/$/, '')}/${runId}`).toString();
  const deadline = Date.now() + options.timeout * 1000;
  let previous = '';
  let lastDetailAt = 0;
  while (Date.now() < deadline) {
    const response = await fetch(statusUrl, { headers });
    const run = await json(response);
    if (!response.ok) throw new Error(run.error || `Status request failed with HTTP ${response.status}`);
    const line = `${run.status} · ${count(run.completed_jobs)}/${count(run.total_jobs)} complete · ${count(run.failed_jobs)} failed`;
    if (line !== previous) console.log(line);
    previous = line;
    if (Date.now() - lastDetailAt >= 30000) {
      const pending = (run.jobs || []).filter(job => !['complete', 'failed'].includes(job.status));
      for (const job of pending) {
        const name = String(job.dedupe_key || job.kind).replace(/^repository:/, '');
        const age = job.lease_age_seconds == null ? '?' : `${job.lease_age_seconds}s`;
        console.log(`  ↳ ${name} · ${job.health || job.status} · attempt ${job.attempts} · lease age ${age}`);
        if (job.last_error) console.log(`    last error: ${job.last_error}`);
      }
      lastDetailAt = Date.now();
    }
    if (['complete', 'partial', 'failed'].includes(run.status)) {
      for (const job of run.jobs || []) if (job.status === 'failed') console.error(`  ${job.dedupe_key}: ${job.last_error}`);
      if (run.status !== 'complete') throw new Error(`Run ${runId} finished ${run.status}; successful repository work was preserved`);
      console.log(`Completed ingestion for ${run.viewer_login || 'GitHub viewer'}.`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  throw new Error(`Stopped waiting. Resume the durable run with: pnpm ingest -- --run ${runId}`);
}

main().catch(error => { console.error(`\nIngestion failed: ${error.message || error}`); process.exitCode = 1; });
