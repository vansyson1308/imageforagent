import { Suspense } from "react";
import { Workspace } from "@/components/Workspace";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <Workspace />
    </Suspense>
  );
}
