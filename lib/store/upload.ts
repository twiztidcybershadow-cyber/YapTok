"use client";

import { create } from "zustand";
import { STATUS_POLL_MS, processingLine, type LiveStatus } from "@/lib/processing/status";
import { SpeedMeter, UploadCancelled, uploadParts, xhrPutPart, type SignedPart } from "@/lib/upload/parts";
import {
  DEFAULT_LIMITS,
  fileProblemCode,
  parseHashtags,
  uploadErrorText,
  videoTypeFor,
  type UploadLimits,
  type Visibility,
} from "@/lib/upload/rules";

/**
 * Where an upload is:
 *   idle        nothing picked
 *   editing     a clip is picked: caption, hashtags, cover frame
 *   signing     asking the server for the part URLs
 *   uploading   the parts are going to storage
 *   finishing   joining the parts
 *   processing  the encoder has it (or it waits in the queue)
 *   live        ready: it is in the feed
 *   failed      see `error`
 */
export type UploadPhase = "idle" | "editing" | "signing" | "uploading" | "finishing" | "processing" | "live" | "failed";

type SignResponse = { videoId: string; uploadId: string; parts: SignedPart[] };

type UploadState = {
  phase: UploadPhase;
  fileName: string;
  /** An object URL of the picked file, for the preview. */
  previewUrl: string | null;
  /** What the browser measured, or null when it could not tell (some recordings). */
  durationS: number | null;
  caption: string;
  hashtagsText: string;
  coverAt: number;
  visibility: Visibility;
  total: number;
  sent: number;
  speed: number;
  videoId: string | null;
  /** The encode: 0 to 100, or null while it waits. */
  progress: number | null;
  /** The line under the progress bar while processing. */
  line: string | null;
  error: string | null;
  /** A short line under the pick buttons, like "Upload cancelled". */
  notice: string | null;
  limits: UploadLimits;
  choose: (file: File, limits: UploadLimits) => void;
  /** The preview read the clip's length. Too long: back to idle with the reason. */
  setDuration: (seconds: number) => void;
  edit: (change: Partial<Pick<UploadState, "caption" | "hashtagsText" | "coverAt" | "visibility">>) => void;
  post: () => void;
  cancel: () => Promise<void>;
  reset: () => void;
};

// The running upload lives outside the store: it is not something to render.
let file: File | null = null;
let running: { controller: AbortController; videoId: string | null; uploadId: string | null } | null = null;
let pollTimer: ReturnType<typeof setTimeout> | undefined;

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(json.message || uploadErrorText(json.error));
  return json;
}

function blank() {
  return {
    phase: "idle" as UploadPhase,
    fileName: "",
    previewUrl: null,
    durationS: null,
    caption: "",
    hashtagsText: "",
    coverAt: 0,
    visibility: "public" as Visibility,
    total: 0,
    sent: 0,
    speed: 0,
    videoId: null,
    progress: null,
    line: null,
    error: null,
    notice: null,
  };
}

function dropFile(previewUrl: string | null) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  file = null;
}

export const useUpload = create<UploadState>((set, get) => {
  /** Asks how the encode is going until the clip is ready or failed. */
  function watch(videoId: string) {
    clearTimeout(pollTimer);
    const ask = async () => {
      if (get().videoId !== videoId || get().phase !== "processing") return;
      try {
        const res = await fetch(`/api/videos/${videoId}/status`, { cache: "no-store" });
        if (res.status === 403) {
          // The processing flag is off: the clip waits in the queue until the owner turns it on.
          return set({ line: "Uploaded. It goes live once processing is switched on." });
        }
        if (res.ok) {
          const s = (await res.json()) as LiveStatus;
          if (s.status === "ready") return set({ phase: "live", progress: 100, line: null });
          if (s.status === "failed") return set({ phase: "failed", error: s.error || "This clip could not be processed." });
          set({ progress: s.progress, line: processingLine(s) ?? "Waiting to process" });
        } else if (res.status >= 400 && res.status < 500) {
          return;
        }
      } catch {
        // Offline for a moment: ask again next time.
      }
      pollTimer = setTimeout(ask, STATUS_POLL_MS);
    };
    pollTimer = setTimeout(ask, 1500);
  }

  return {
    ...blank(),
    limits: DEFAULT_LIMITS,

    choose(picked, limits) {
      if (running) return;
      const problem = fileProblemCode(picked, limits);
      if (problem) return set({ ...blank(), limits, notice: uploadErrorText(problem, limits) });
      dropFile(get().previewUrl);
      file = picked;
      set({ ...blank(), limits, phase: "editing", fileName: picked.name, total: picked.size, previewUrl: URL.createObjectURL(picked) });
    },

    setDuration(seconds) {
      const { phase, limits, previewUrl } = get();
      if (phase !== "editing" || !file || !Number.isFinite(seconds) || seconds <= 0) return;
      const problem = fileProblemCode(file, limits, seconds);
      if (problem) {
        dropFile(previewUrl);
        return set({ ...blank(), limits, notice: uploadErrorText(problem, limits) });
      }
      // Start the cover a moment in: the very first frame is often black.
      set({ durationS: seconds, coverAt: get().coverAt || Math.min(1, seconds / 2) });
    },

    edit(change) {
      if (get().phase === "editing") set(change);
    },

    post() {
      const picked = file;
      const s = get();
      if (running || !picked || s.phase !== "editing") return;
      const mime = videoTypeFor(picked)!;
      const controller = new AbortController();
      const job = { controller, videoId: null as string | null, uploadId: null as string | null };
      running = job;
      set({ phase: "signing", sent: 0, speed: 0, error: null, notice: null });

      void (async () => {
        try {
          const signed = await postJson<SignResponse>(
            "/api/upload/sign",
            {
              caption: s.caption.trim(),
              hashtags: parseHashtags(s.hashtagsText),
              visibility: s.visibility,
              bytes: picked.size,
              mime,
              durationS: s.durationS,
              coverAt: s.durationS ? s.coverAt : null,
            },
            controller.signal,
          );
          job.videoId = signed.videoId;
          job.uploadId = signed.uploadId;
          set({ phase: "uploading", videoId: signed.videoId });

          const meter = new SpeedMeter();
          let lastPaint = 0;
          const parts = await uploadParts({
            file: picked,
            parts: signed.parts,
            putPart: xhrPutPart,
            signal: controller.signal,
            onProgress: (sent) => {
              const speed = meter.add(sent);
              const now = Date.now();
              // Paint at most five times a second.
              if (now - lastPaint > 200 || sent === picked.size) {
                lastPaint = now;
                set({ sent, speed });
              }
            },
          });

          set({ phase: "finishing", sent: picked.size });
          await postJson("/api/upload/complete", { videoId: signed.videoId, uploadId: signed.uploadId, parts }, controller.signal);
          running = null;
          set({ phase: "processing", progress: null, line: "Waiting to process" });
          watch(signed.videoId);
        } catch (err) {
          if (err instanceof UploadCancelled || controller.signal.aborted) return;
          running = null;
          // Throw the parts away so they do not sit in the bucket.
          if (job.videoId && job.uploadId) {
            void postJson("/api/upload/abort", { videoId: job.videoId, uploadId: job.uploadId }).catch(() => undefined);
          }
          set({ phase: "failed", error: (err as Error).message || uploadErrorText(null) });
        }
      })();
    },

    async cancel() {
      const job = running;
      running = null;
      const { previewUrl, limits } = get();
      dropFile(previewUrl);
      clearTimeout(pollTimer);
      set({ ...blank(), limits, notice: job ? "Upload cancelled." : null });
      if (!job) return;
      job.controller.abort();
      if (job.videoId && job.uploadId) {
        await postJson("/api/upload/abort", { videoId: job.videoId, uploadId: job.uploadId }).catch(() => undefined);
      }
    },

    reset() {
      if (running) return;
      clearTimeout(pollTimer);
      dropFile(get().previewUrl);
      set({ ...blank(), limits: get().limits });
    },
  };
});
