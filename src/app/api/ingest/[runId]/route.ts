import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getRun } from '@/lib/ingest-queue';

export const runtime = 'nodejs';

function authorized(request: NextRequest) {
  const expected = process.env.INGEST_SECRET;
  const submitted = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || request.headers.get('x-ingest-secret');
  if (!expected || !submitted) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(submitted);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { runId } = await context.params;
  const run = await getRun(runId);
  if (!run) return NextResponse.json({ error: 'Ingestion run not found' }, { status: 404 });
  return NextResponse.json(run);
}
