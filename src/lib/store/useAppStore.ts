"use client";

import { create } from "zustand";
import {
  api,
  ApiError,
  type AiEditFrameDto,
  type AssetDto,
  type FrameDto,
  type MetaDto,
  type ProjectDto,
} from "@/lib/api";

export type SaveState = "idle" | "saving" | "saved" | "error";

interface JobState {
  id: string;
  running: boolean;
}

interface AppState {
  project: ProjectDto | null;
  frames: FrameDto[];
  assets: AssetDto[];
  meta: MetaDto | null;
  saveState: SaveState;
  job: JobState | null;
  toast: string | null;

  bootstrap: (projectId?: string) => Promise<void>;
  hydrate: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  setToast: (message: string | null) => void;

  patchProject: (patch: Partial<ProjectDto>) => Promise<void>;
  updateFrameLocal: (id: string, patch: Partial<FrameDto>) => void;
  saveFrame: (id: string, patch: { shotType?: string; description?: string }) => Promise<void>;
  addFrame: (afterIndex?: number) => Promise<void>;
  deleteFrame: (id: string) => Promise<void>;
  reorderFrame: (frameId: string, targetIndex: number) => Promise<void>;
  setFrames: (frames: FrameDto[]) => void;

  importScript: (body: {
    source: "sheet" | "tsv";
    sheetUrl?: string;
    tsvText?: string;
    confirmOverwrite?: boolean;
  }) => Promise<void>;

  uploadAssets: (kind: string, files: File[]) => Promise<void>;
  deleteAsset: (id: string) => Promise<void>;

  startGeneration: (frameIds?: string[]) => Promise<void>;
  cancelGeneration: () => Promise<void>;
  applyAiEdit: (frames: AiEditFrameDto[]) => Promise<void>;
  reapplyWatermark: () => Promise<void>;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.hint ? `${err.message} ${err.hint}` : err.message;
  }
  return err instanceof Error ? err.message : "Lỗi không xác định";
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  project: null,
  frames: [],
  assets: [],
  meta: null,
  saveState: "idle",
  job: null,
  toast: null,

  setToast: (message) => set({ toast: message }),

  bootstrap: async (projectId) => {
    let id = projectId;
    if (!id) {
      const projects = await api.listProjects();
      if (projects.length === 0) {
        const created = await api.createProject("Video mới");
        id = created.id;
      } else {
        id = projects[0].id;
      }
    }
    const data = await api.getProject(id);
    set({
      project: data,
      frames: data.frames,
      assets: data.assets,
    });
    await get().refreshMeta();
  },

  hydrate: async () => {
    const { project } = get();
    if (!project) return;
    const data = await api.getProject(project.id);
    set({ project: data, frames: data.frames, assets: data.assets });
  },

  refreshMeta: async () => {
    try {
      set({ meta: await api.meta() });
    } catch {
      // meta lỗi không chặn UI
    }
  },

  patchProject: async (patch) => {
    const { project } = get();
    if (!project) return;
    const prev = project;
    set({ project: { ...project, ...patch }, saveState: "saving" });
    try {
      const updated = await api.patchProject(project.id, patch);
      set({ project: updated, saveState: "saved" });
    } catch (err) {
      set({ project: prev, saveState: "error", toast: errorMessage(err) });
    }
  },

  updateFrameLocal: (id, patch) => {
    set({
      frames: get().frames.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    });
  },

  saveFrame: async (id, patch) => {
    const prev = get().frames;
    set({ saveState: "saving" });
    try {
      const updated = await api.patchFrame(id, patch);
      set({
        frames: get().frames.map((f) => (f.id === id ? updated : f)),
        saveState: "saved",
      });
    } catch (err) {
      set({ frames: prev, saveState: "error", toast: errorMessage(err) });
    }
  },

  addFrame: async (afterIndex) => {
    const { project } = get();
    if (!project) return;
    try {
      await api.createFrame(project.id, afterIndex);
      await get().hydrate();
    } catch (err) {
      set({ toast: errorMessage(err) });
    }
  },

  deleteFrame: async (id) => {
    const prev = get().frames;
    // optimistic: xoá + reindex local
    const remaining = prev
      .filter((f) => f.id !== id)
      .map((f, i) => ({ ...f, index: i + 1 }));
    set({ frames: remaining });
    try {
      await api.deleteFrame(id);
    } catch (err) {
      set({ frames: prev, toast: errorMessage(err) });
    }
  },

  reorderFrame: async (frameId, targetIndex) => {
    const { project, frames } = get();
    if (!project) return;
    const prev = frames;
    // optimistic reorder local
    const sorted = frames.slice().sort((a, b) => a.index - b.index);
    const from = sorted.findIndex((f) => f.id === frameId);
    if (from === -1) return;
    const clamped = Math.min(Math.max(targetIndex, 1), sorted.length);
    const without = sorted.filter((f) => f.id !== frameId);
    const moved = [
      ...without.slice(0, clamped - 1),
      sorted[from],
      ...without.slice(clamped - 1),
    ].map((f, i) => ({ ...f, index: i + 1 }));
    set({ frames: moved });
    try {
      const result = await api.reorderFrame(project.id, frameId, targetIndex);
      set({ frames: result.frames });
    } catch (err) {
      set({ frames: prev, toast: errorMessage(err) });
    }
  },

  setFrames: (frames) => set({ frames }),

  importScript: async (body) => {
    const { project } = get();
    if (!project) return;
    const result = await api.importScript({ projectId: project.id, ...body });
    set({ frames: result.frames });
    if (body.source === "sheet" && body.sheetUrl) {
      set({ project: { ...project, sheetUrl: body.sheetUrl } });
    }
  },

  uploadAssets: async (kind, files) => {
    const { project } = get();
    if (!project) return;
    try {
      await api.uploadAssets(project.id, kind, files);
      const data = await api.getProject(project.id);
      set({ assets: data.assets });
    } catch (err) {
      set({ toast: errorMessage(err) });
    }
  },

  deleteAsset: async (id) => {
    const prev = get().assets;
    set({ assets: prev.filter((a) => a.id !== id) });
    try {
      await api.deleteAsset(id);
    } catch (err) {
      set({ assets: prev, toast: errorMessage(err) });
    }
  },

  startGeneration: async (frameIds) => {
    const { project } = get();
    if (!project) return;
    try {
      const { jobId } = await api.generate(project.id, frameIds);
      set({ job: { id: jobId, running: true } });

      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        const current = get().job;
        if (!current) return;
        try {
          const status = await api.jobStatus(current.id);
          if (status.lost) {
            if (pollTimer) clearInterval(pollTimer);
            set({ job: null });
            await get().hydrate();
            return;
          }
          // Merge trạng thái frame từ job vào danh sách
          const byId = new Map(status.frames.map((f) => [f.id, f]));
          set({
            frames: get().frames.map((f) => {
              const update = byId.get(f.id);
              return update
                ? {
                    ...f,
                    status: update.status,
                    imageUrl: update.imageUrl,
                    errorMsg: update.errorMsg,
                  }
                : f;
            }),
          });
          if (status.done) {
            if (pollTimer) clearInterval(pollTimer);
            set({ job: null });
            await get().refreshMeta();
          }
        } catch {
          // lỗi mạng tạm thời — tiếp tục poll
        }
      }, 2000);
    } catch (err) {
      set({ toast: errorMessage(err) });
    }
  },

  cancelGeneration: async () => {
    const { job } = get();
    if (!job) return;
    try {
      await api.cancelJob(job.id);
    } catch (err) {
      set({ toast: errorMessage(err) });
    }
  },

  applyAiEdit: async (frames) => {
    const { project } = get();
    if (!project) return;
    const result = await api.applyEdit(project.id, frames);
    set({ frames: result.frames });
  },

  reapplyWatermark: async () => {
    const { project } = get();
    if (!project) return;
    try {
      await api.reapplyWatermark(project.id);
      await get().hydrate();
      set({ toast: "Đã áp dụng lại watermark ✓" });
    } catch (err) {
      set({ toast: errorMessage(err) });
    }
  },
}));
