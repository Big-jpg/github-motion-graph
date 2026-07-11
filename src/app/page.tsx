import Link from "next/link";

const featureItems = [
  {
    title: "Repos + branches",
    copy: "See the structure behind each project.",
    colors: ["#c7b4e6", "#9fc8e7"],
  },
  {
    title: "Commits + pull requests",
    copy: "Follow the work from change to merge.",
    colors: ["#b7c8bd", "#f1d580"],
  },
  {
    title: "People + automation",
    copy: "Spot human and bot collaboration patterns.",
    colors: ["#82c7b6", "#e7ab9c"],
  },
];

export default function Home() {
  return (
    <main className="relative min-h-svh overflow-hidden bg-background px-4 py-4 sm:px-6 sm:py-6 lg:px-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-48 top-8 h-[30rem] w-[30rem] rounded-full bg-[#d3f2e6]/70 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-52 bottom-[-8rem] h-[34rem] w-[34rem] rounded-full bg-[#d9eefb]/65 blur-3xl"
      />

      <div className="relative mx-auto flex min-h-[calc(100svh-2rem)] w-full max-w-7xl flex-col sm:min-h-[calc(100svh-3rem)]">
        <header className="flex items-center justify-between gap-4">
          <div className="pastel-panel flex min-h-12 items-center gap-3 rounded-full px-3 py-1.5 shadow-[0_4px_0_var(--panel-shadow)]">
            <span className="grid size-9 place-items-center rounded-full border-2 border-[#75b5a5] bg-[#a3d9c9] text-[#345f54]">
              <svg
                aria-hidden="true"
                className="size-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="2.5" />
                <circle cx="5" cy="7" r="1.75" />
                <circle cx="19" cy="7" r="1.75" />
                <path d="m6.5 8 3.5 2.5M17.5 8 14 10.5M12 14.5v4" />
              </svg>
            </span>
            <span className="min-w-0">
              <strong className="block truncate font-display text-sm font-medium tracking-tight">
                GitHub Motion Graph
              </strong>
              <small className="hidden text-xs font-bold text-muted-foreground sm:block">
                A living activity atlas
              </small>
            </span>
          </div>
          <span className="hidden items-center gap-2 text-sm font-bold text-muted-foreground md:flex">
            <span className="size-2.5 rounded-full border border-[#4f8d7c] bg-primary" />
            GitHub data, connected
          </span>
        </header>

        <section className="grid flex-1 items-center gap-12 py-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(30rem,1.1fr)] lg:gap-16 lg:py-10">
          <div className="max-w-2xl">
            <p className="mb-5 text-xs font-extrabold uppercase tracking-[0.18em] text-[#4f7f70]">
              Personal development topology
            </p>
            <h1 className="max-w-[10ch] font-display text-[clamp(3.5rem,9vw,7.5rem)] font-medium leading-[0.9] tracking-[-0.055em]">
              Reveal the connections in git.
            </h1>
            <p className="mt-7 max-w-xl text-lg font-semibold leading-8 text-muted-foreground sm:text-xl">
              Explore repositories, branches, commits, pull requests, people, and
              automation as one calm, navigable map.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/graph"
                className="pastel-control pastel-primary gap-2.5 px-6 py-3 text-sm font-extrabold"
              >
                Open the graph
                <svg
                  aria-hidden="true"
                  className="size-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2.25"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              <span className="text-sm font-bold text-muted-foreground">
                Pan, zoom, filter, and inspect
              </span>
            </div>
          </div>

          <figure className="pastel-panel relative mx-auto w-full max-w-2xl overflow-hidden rounded-[2.25rem] bg-white p-4 shadow-[0_8px_0_var(--panel-shadow)] sm:p-6">
            <figcaption className="flex items-center justify-between gap-4 px-2 pb-4">
              <span className="font-display text-lg font-medium">Topology preview</span>
              <span className="flex items-center gap-2 text-xs font-extrabold text-muted-foreground">
                <span className="size-2.5 rounded-full border border-[#4f8d7c] bg-primary" />
                Connected
              </span>
            </figcaption>
            <div className="overflow-hidden rounded-[1.6rem] border-2 border-border bg-[#f8fbf9]">
              <svg
                aria-label="An illustrative network of repositories, branches, commits, pull requests, and contributors"
                className="h-auto w-full"
                role="img"
                viewBox="0 0 560 410"
              >
                <g fill="none" stroke="#cbded2" strokeLinecap="round" strokeWidth="3">
                  <path d="M105 120 215 82 314 152 445 98" />
                  <path d="M105 120 174 238 298 292 438 248" />
                  <path d="M215 82 248 198 314 152" />
                  <path d="M248 198 174 238M248 198 298 292M314 152 438 248" />
                  <path d="M174 238 92 312M298 292 365 348M438 248 485 326" />
                </g>

                <g strokeWidth="4">
                  <rect
                    x="72"
                    y="87"
                    width="66"
                    height="66"
                    rx="20"
                    fill="#c7b4e6"
                    stroke="#735f91"
                  />
                  <path d="m215 58 26 46h-52Z" fill="#9fc8e7" stroke="#557f9d" />
                  <circle cx="314" cy="152" r="19" fill="#b7c8bd" stroke="#5a6e62" />
                  <path d="m445 68 30 30-30 30-30-30Z" fill="#f1d580" stroke="#806b26" />
                  <circle cx="174" cy="238" r="28" fill="#82c7b6" stroke="#4f8d7c" />
                  <circle cx="174" cy="238" r="15" fill="none" stroke="#4f8d7c" strokeWidth="3" />
                  <circle cx="248" cy="198" r="13" fill="#b7c8bd" stroke="#5a6e62" />
                  <path d="m298 265 27 27-27 27-27-27Z" fill="#f1d580" stroke="#806b26" />
                  <circle cx="438" cy="248" r="27" fill="#e7ab9c" stroke="#965d51" />
                  <circle cx="438" cy="248" r="15" fill="none" stroke="#965d51" strokeWidth="3" />
                  <circle cx="92" cy="312" r="10" fill="#b7c8bd" stroke="#5a6e62" />
                  <path d="m365 329 20 35h-40Z" fill="#9fc8e7" stroke="#557f9d" />
                  <circle cx="485" cy="326" r="10" fill="#b7c8bd" stroke="#5a6e62" />
                </g>

                <g fill="#2d3a32" fontFamily="var(--font-nunito-sans)" fontSize="13" fontWeight="800">
                  <text x="67" y="174">repository</text>
                  <text x="194" y="44">branch</text>
                  <text x="411" y="52">pull request</text>
                  <text x="144" y="286">human</text>
                  <text x="418" y="296">automation</text>
                </g>
              </svg>
            </div>
          </figure>
        </section>

        <section
          aria-label="What the graph contains"
          className="grid gap-3 border-t-2 border-border py-5 sm:grid-cols-3"
        >
          {featureItems.map(item => (
            <article
              key={item.title}
              className="flex items-start gap-3 rounded-2xl px-2 py-3 sm:px-4"
            >
              <span className="mt-1 flex -space-x-1.5" aria-hidden="true">
                {item.colors.map(color => (
                  <span
                    key={color}
                    className="size-4 rounded-full border-2 border-white ring-1 ring-border"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span>
                <strong className="block font-display text-base font-medium">
                  {item.title}
                </strong>
                <span className="mt-0.5 block text-sm font-semibold text-muted-foreground">
                  {item.copy}
                </span>
              </span>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
