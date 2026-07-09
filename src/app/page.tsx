// src/app/page.tsx
import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="max-w-2xl text-center space-y-8">
        <div className="space-y-4">
          <h1 className="text-4xl font-mono font-bold tracking-tight">
            <span className="text-zinc-100">GitHub</span>{' '}
            <span className="text-violet-400">Motion Graph</span>
          </h1>
          <p className="text-zinc-400 text-lg font-mono">
            Force-directed topology of collaborative development
          </p>
        </div>

        <div className="flex items-center justify-center gap-3">
          <Link
            href="/graph"
            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-6 py-3 rounded-lg font-mono text-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" />
              <circle cx="4" cy="6" r="2" />
              <circle cx="20" cy="6" r="2" />
              <circle cx="4" cy="18" r="2" />
              <circle cx="20" cy="18" r="2" />
              <line x1="6" y1="6" x2="9" y2="10" />
              <line x1="18" y1="6" x2="15" y2="10" />
              <line x1="6" y1="18" x2="9" y2="14" />
              <line x1="18" y1="18" x2="15" y2="14" />
            </svg>
            Enter Graph
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-4 pt-8 border-t border-zinc-800">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="w-2 h-2 rounded-full bg-pink-500" />
            </div>
            <p className="text-xs font-mono text-zinc-500">Human + AI</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-full bg-violet-500" />
              <span className="w-2 h-2 rounded-full bg-cyan-500" />
            </div>
            <p className="text-xs font-mono text-zinc-500">Repos + Branches</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="w-2 h-2 rounded-full bg-zinc-500" />
            </div>
            <p className="text-xs font-mono text-zinc-500">PRs + Commits</p>
          </div>
        </div>

        <div className="pt-4">
          <p className="text-xs font-mono text-zinc-600">
            Next.js · Neon Postgres · Drizzle · Edge Runtime · Vercel
          </p>
        </div>
      </div>
    </main>
  );
}
