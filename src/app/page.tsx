import { redirect } from "next/navigation";
import { Landing } from "@/components/Landing";

/** Landing. Old studio links (`/?p=<id>`) keep working: they move to /studio. */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { p } = await searchParams;
  if (typeof p === "string" && p) redirect(`/studio?p=${encodeURIComponent(p)}`);
  return <Landing />;
}
