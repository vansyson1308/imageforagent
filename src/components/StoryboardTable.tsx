"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useAppStore } from "@/lib/store/useAppStore";
import { FrameRow } from "@/components/FrameRow";
import { SaveIndicator } from "@/components/SaveIndicator";
import { AiEditBar } from "@/components/AiEditBar";

export function StoryboardTable() {
  const frames = useAppStore((s) => s.frames);
  const reorderFrame = useAppStore((s) => s.reorderFrame);
  const addFrame = useAppStore((s) => s.addFrame);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const sorted = frames.slice().sort((a, b) => a.index - b.index);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const target = sorted.find((f) => f.id === over.id);
    if (!target) return;
    void reorderFrame(String(active.id), target.index);
  }

  return (
    <section className="fade-up rounded-card border border-line bg-card p-6" style={{ animationDelay: "60ms" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-bold">2. Bảng phân cảnh</h2>
          <span className="text-sm text-muted">{sorted.length} frame</span>
          <SaveIndicator />
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          Chưa có frame nào — nhập kịch bản ở mục 1, hoặc{" "}
          <button className="text-accent underline-offset-2 hover:underline" onClick={() => void addFrame()}>
            thêm frame thủ công
          </button>
          .
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-2">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={sorted.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                {sorted.map((frame) => (
                  <FrameRow key={frame.id} frame={frame} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
          <button
            onClick={() => void addFrame()}
            className="mt-3 w-full rounded-xl border border-dashed border-line px-4 py-2.5 text-sm text-muted transition hover:border-accent hover:text-accent"
          >
            + Thêm frame cuối
          </button>
        </>
      )}

      <AiEditBar />
    </section>
  );
}
