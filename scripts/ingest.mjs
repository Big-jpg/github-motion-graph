#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_URL = 'https://github-motion-graph.vercel.app/api/ingest';
const DEFAULT_TIMEOUT_SECONDS = 310;
const AFFILIATIONS = new Set(['OWNER', 'COLLABORATOR', 'ORGANIZATION_MEMBER']);

function loadEnvFile(filename) {
  const envPath = path.resolve(filename);
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    process.env[match[1]] = value;
  }
}

function takeValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function splitValues(value) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function parseArgs(args) {
  const options = {
    username: process.env.GITHUB_USERNAME || process.env.GH_USERNAME || null,
    url: process.env.INGEST_URL || DEFAULT_URL,
    visibility: 'public',
    includeForks: true,
    allBranches: true,
    repositories: [],
    branches: [],
    affiliations: [],
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { ...options, help: true };
    if (arg === '--exclude-forks') {
      options.includeForks = false;
      continue;
    }
    if (arg === '--default-branch-only') {
      options.allBranches = false;
      continue;
    }

    const value = takeValue(args, index, arg);
    index++;
    if (arg === '--username' || arg === '-u') options.username = value;
    else if (arg === '--url') options.url = value;
    else if (arg === '--visibility') options.visibility = value.toLowerCase();
    else if (arg === '--repo' || arg === '-r') options.repositories.push(...splitValues(value));
    else if (arg === '--branch' || arg === '-b') options.branches.push(...splitValues(value));
    else if (arg === '--affiliation' || arg === '-a') {
      options.affiliations.push(...splitValues(value).map(item => item.toUpperCase()));
    } else if (arg === '--timeout') options.timeoutSeconds = Number(value);
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!['public', 'private', 'all'].includes(options.visibility)) {
    throw new Error('--visibility must be public, private, or all');
  }
  if (
    !Number.isFinite(options.timeoutSeconds) ||
    options.timeoutSeconds < 1 ||
    options.timeoutSeconds > 900
  ) {
    throw new Error('--timeout must be between 1 and 900 seconds');
  }
  for (const affiliation of options.affiliations) {
    if (!AFFILIATIONS.has(affiliation)) {
      throw new Error(`Unsupported affiliation: ${affiliation}`);
    }
  }
  try {
    new URL(options.url);
  } catch {
    throw new Error(`Invalid ingest URL: ${options.url}`);
  }

  return options;
}

function usage() {
  console.log(`
GitHub Motion Graph ingestion helper

Usage:
  pnpm ingest -- --username Big-jpg
  pnpm ingest -- --username Big-jpg --repo Big-jpg/github-motion-graph

Options:
  -u, --username <login>       Safety-check the server GH_TOKEN owner
  -r, --repo <owner/name>      Limit to a repository; repeat or comma-separate
  -b, --branch <name>          Limit branch history; repeat or comma-separate
  -a, --affiliation <value>    OWNER, COLLABORATOR, or ORGANIZATION_MEMBER
      --visibility <value>     public (default), private, or all
      --exclude-forks          Skip fork repositories
      --default-branch-only    Do not traverse every branch
      --url <endpoint>         Override INGEST_URL
      --timeout <seconds>      Client timeout (default: ${DEFAULT_TIMEOUT_SECONDS})
  -h, --help                   Show this help

Environment:
  INGEST_SECRET is required. INGEST_URL and GITHUB_USERNAME are optional.
  Values are loaded from .env.local and .env without overwriting shell variables.
`);
}

function count(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function printSummary(result) {
  const stats = result.stats || {};
  const fetched = stats.fetched || {};
  const expected = stats.expected || {};
  const unique = stats.unique || {};
  const written = stats.written || {};

  console.log('\nResult');
  console.log(`  Status:       ${result.status || (result.success ? 'complete' : 'failed')}`);
  if (result.viewer) console.log(`  Viewer:       ${result.viewer}`);
  console.log(
    `  Repositories: ${count(fetched.selectedRepositories)} processed / ` +
      `${count(fetched.repositories)} discovered` +
      (expected.repositories == null ? '' : ` / ${count(expected.repositories)} expected`),
  );
  console.log(`  Branches:     ${count(fetched.branches)}`);
  console.log(`  Commits:      ${count(unique.commits)} unique`);
  console.log(`  Pull requests:${String(count(fetched.pullRequests)).padStart(6)}`);
  console.log(`  Contributors: ${count(unique.users)} unique`);
  console.log(
    `  Links added:  ${
      count(written.repositoryCommitLinksCreated) +
      count(written.branchCommitLinksCreated) +
      count(written.commitPullRequestLinksCreated)
    }`,
  );

  if (Array.isArray(result.failures) && result.failures.length > 0) {
    console.error(`\nFailures (${result.failures.length})`);
    for (const failure of result.failures) {
      const location = [failure.repository, failure.branch, failure.pullRequest && `PR #${failure.pullRequest}`]
        .filter(Boolean)
        .join(' · ');
      console.error(`  - ${failure.scope}${location ? ` (${location})` : ''}: ${failure.message}`);
    }
  }
}

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');

  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const secret = process.env.INGEST_SECRET;
  if (!secret) {
    throw new Error('INGEST_SECRET is required in the shell, .env.local, or .env');
  }

  const body = {
    visibility: options.visibility,
    includeForks: options.includeForks,
    allBranches: options.allBranches,
  };
  if (options.username) body.username = options.username;
  if (options.repositories.length > 0) body.repositoryNames = [...new Set(options.repositories)];
  if (options.branches.length > 0) body.branches = [...new Set(options.branches)];
  if (options.affiliations.length > 0) body.affiliations = [...new Set(options.affiliations)];

  const scope = [
    options.visibility,
    options.includeForks ? 'forks included' : 'forks excluded',
    options.branches.length > 0
      ? `${options.branches.length} selected branch(es)`
      : options.allBranches
        ? 'all branches'
        : 'default branch only',
  ].join(' · ');
  console.log(`Ingesting ${options.username || 'the authenticated GitHub viewer'}`);
  console.log(`Endpoint: ${options.url}`);
  console.log(`Scope:    ${scope}`);
  if (options.repositories.length > 0) {
    console.log(`Repos:    ${options.repositories.join(', ')}`);
  }
  console.log('This can take several minutes for a deep backfill.\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutSeconds * 1000);
  let response;
  try {
    response = await fetch(options.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Ingestion exceeded the ${options.timeoutSeconds}-second client timeout`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let result;
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Ingest endpoint returned non-JSON (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }

  printSummary(result);
  if (!response.ok || result.success !== true) {
    throw new Error(result.error || result.message || `Ingestion failed with HTTP ${response.status}`);
  }
}

main().catch(error => {
  console.error(`\nIngestion failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
