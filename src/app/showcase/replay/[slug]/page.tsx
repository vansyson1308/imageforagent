import fs from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { ReplayPlayer } from "@/components/director/ReplayPlayer";
import type { Trace } from "@/lib/director/traceReplay";

/**
 * "Replay the real run" (SPEC v2 WP1.4): a stored showcase trace streamed
 * through the same run view at 10×, public, no tokens spent.
 */

export const dynamic = "force-dynamic";

interface IndexFilm {
  slug: string;
  title: string;
  film: string;
  poster: string;
  stills?: Record<string, string>;
  snapshots?: Record<string, string>;
}

export default async function ReplayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) notFound();
  const dir = path.join(process.cwd(), "public", "showcase");
  let film: IndexFilm | undefined;
  let trace: Trace;
  try {
    const index = JSON.parse(await fs.readFile(path.join(dir, "index.json"), "utf8")) as { films: IndexFilm[] };
    film = index.films.find((f) => f.slug === slug);
    if (!film) notFound();
    trace = JSON.parse(await fs.readFile(path.join(dir, slug, "trace.json"), "utf8")) as Trace;
  } catch {
    notFound();
  }
  const shots = Object.fromEntries(Object.entries(film.stills ?? {}).map(([k, v]) => [Number(k), v]));
  return <ReplayPlayer trace={trace} film={film.film} title={film.title} assets={{ shots, snapshots: film.snapshots }} />;
}
