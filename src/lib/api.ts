/** Client API — fetch wrapper typed theo error envelope {error:{code,message,hint}}. */

export interface ProjectDto {
  id: string;
  name: string;
  characterDesc: string | null;
  aspectRatio: string;
  resolution: string;
  playbackSpeed: number;
  sheetUrl: string | null;
  wmPosition: string;
  wmScale: number;
  wmOpacity: number;
  createdAt: string;
  updatedAt: string;
}

export interface FrameDto {
  id: string;
  projectId: string;
  index: number;
  shotType: string;
  description: string;
  status: string;
  imageUrl: string | null;
  errorMsg: string | null;
  generatedAt: string | null;
}

export interface AssetDto {
  id: string;
  projectId: string;
  kind: string;
  filePath: string;
  mimeType: string;
  order: number;
  url: string;
}

export interface MetaDto {
  serviceAccountEmail: string | null;
  imageProvider: string;
  dailyUsed: number;
  dailyLimit: number;
}

export interface ProjectListItemDto extends ProjectDto {
  frameCount: number;
  doneCount: number;
}

export interface JobStatusDto {
  jobId: string;
  frames: Array<{
    id: string;
    index: number;
    status: string;
    imageUrl: string | null;
    errorMsg: string | null;
  }>;
  done: boolean;
  lost?: boolean;
  cancelled?: boolean;
}

export interface AiEditFrameDto {
  index: number;
  shotType: string;
  description: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly status: number;

  constructor(code: string, message: string, status: number, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let code = "INTERNAL";
    let message = `HTTP ${res.status}`;
    let hint: string | undefined;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string; hint?: string };
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
      hint = body.error?.hint;
    } catch {
      // body không phải JSON
    }
    throw new ApiError(code, message, res.status, hint);
  }
  return res.json() as Promise<T>;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const api = {
  listProjects: () => request<ProjectListItemDto[]>("/api/projects"),
  createProject: (name: string) =>
    request<ProjectDto>("/api/projects", jsonInit("POST", { name })),
  getProject: (id: string) =>
    request<ProjectDto & { frames: FrameDto[]; assets: AssetDto[] }>(
      `/api/projects/${id}`,
    ),
  patchProject: (id: string, patch: Partial<ProjectDto>) =>
    request<ProjectDto>(`/api/projects/${id}`, jsonInit("PATCH", patch)),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  duplicateProject: (id: string) =>
    request<ProjectDto>(`/api/projects/${id}/duplicate`, { method: "POST" }),

  importScript: (body: {
    projectId: string;
    source: "sheet" | "tsv";
    sheetUrl?: string;
    tsvText?: string;
    confirmOverwrite?: boolean;
  }) => request<{ frames: FrameDto[] }>("/api/script/import", jsonInit("POST", body)),

  createFrame: (projectId: string, afterIndex?: number) =>
    request<FrameDto>("/api/frames", jsonInit("POST", { projectId, afterIndex })),
  patchFrame: (id: string, patch: { shotType?: string; description?: string }) =>
    request<FrameDto>(`/api/frames/${id}`, jsonInit("PATCH", patch)),
  deleteFrame: (id: string) =>
    request<{ ok: boolean }>(`/api/frames/${id}`, { method: "DELETE" }),
  reorderFrame: (projectId: string, frameId: string, targetIndex: number) =>
    request<{ frames: FrameDto[] }>(
      "/api/frames/reorder",
      jsonInit("POST", { projectId, frameId, targetIndex }),
    ),

  aiEdit: (projectId: string, instruction: string) =>
    request<{ frames: AiEditFrameDto[] }>(
      "/api/storyboard/ai-edit",
      jsonInit("POST", { projectId, instruction }),
    ),
  applyEdit: (projectId: string, frames: AiEditFrameDto[]) =>
    request<{ frames: FrameDto[] }>(
      "/api/storyboard/apply-edit",
      jsonInit("POST", { projectId, frames }),
    ),

  uploadAssets: (projectId: string, kind: string, files: File[]) => {
    const form = new FormData();
    form.set("projectId", projectId);
    form.set("kind", kind);
    for (const f of files) form.append("files", f);
    return request<AssetDto[]>("/api/assets/upload", { method: "POST", body: form });
  },
  deleteAsset: (id: string) =>
    request<{ ok: boolean }>(`/api/assets/${id}`, { method: "DELETE" }),

  generate: (projectId: string, frameIds?: string[]) =>
    request<{ jobId: string }>("/api/generate", jsonInit("POST", { projectId, frameIds })),
  jobStatus: (jobId: string) => request<JobStatusDto>(`/api/generate/${jobId}/status`),
  cancelJob: (jobId: string) =>
    request<{ ok: boolean }>(`/api/generate/${jobId}/cancel`, { method: "POST" }),

  reapplyWatermark: (projectId: string) =>
    request<{ ok: boolean; updated: number }>(
      "/api/watermark/reapply",
      jsonInit("POST", { projectId }),
    ),

  meta: () => request<MetaDto>("/api/meta"),
};
