import { Suspense } from "react";
import { Workspace } from "@/components/Workspace";

/** The studio: the Director panel on top, the zero-key engine panels below. */
export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <Workspace />
    </Suspense>
  );
}
