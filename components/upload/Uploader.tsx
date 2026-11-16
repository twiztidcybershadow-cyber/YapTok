"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { CameraIcon, CheckIcon, UploadIcon } from "@/components/icons";
import { clipLength } from "@/lib/feed/format";
import type { PublicSettings } from "@/lib/site/settings-core";
import { useUpload } from "@/lib/store/upload";
import { ACCEPT, CAPTION_MAX, HASHTAGS_MAX, formatBytes, formatSpeed, parseHashtags, percentDone } from "@/lib/upload/rules";
import { Recorder } from "./Recorder";

function Bar({ value }: { value: number | null }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[var(--progress-track)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
      <div
        className={`h-full rounded-full bg-[var(--progress)] transition-[width] duration-300 ${value === null ? "w-1/3 animate-pulse" : ""}`}
        style={value === null ? undefined : { width: `${value}%` }}
      />
    </div>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[480px] py-10 text-center" data-upload-step>
      <h2 className="text-[20px] font-medium leading-7 text-text">{title}</h2>
      <div className="mt-4 space-y-3 text-[14px] leading-5 text-text-2">{children}</div>
    </div>
  );
}

/**
 * The upload page: pick or record a clip, write the caption and hashtags,
 * choose the cover frame, post. The file goes straight to storage in parts;
 * then the page follows the encoder until the clip is live.
 *
 * `blocked` says why posting is not possible right now (database not
 * connected, storage not set up): the form still shows, as a preview.
 */
export function Uploader({ settings, recordOn, blocked }: { settings: PublicSettings; recordOn: boolean; blocked: string | null }) {
  const s = useUpload();
  const input = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const limits = { maxBytes: settings.uploadMaxMb * 1024 * 1024, maxSeconds: settings.uploadMaxSeconds };

  // Leaving the page while a file is on its way would lose it.
  const busy = s.phase === "signing" || s.phase === "uploading" || s.phase === "finishing";
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) s.choose(f, limits);
  }

  if (recording) {
    return (
      <Recorder
        maxSeconds={limits.maxSeconds}
        onCancel={() => setRecording(false)}
        onDone={(f) => {
          setRecording(false);
          s.choose(f, limits);
        }}
      />
    );
  }

  if (s.phase === "idle") {
    return (
      <div
        data-upload-pick
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mx-auto flex max-w-[560px] flex-col items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center ${dragging ? "border-[var(--brand)] bg-hover" : "border-divider"}`}
      >
        <span className="grid h-20 w-20 place-items-center rounded-full bg-hover text-[var(--link)]">
          <UploadIcon className="h-9 w-9" />
        </span>
        <h2 className="mt-5 text-[20px] font-medium leading-7 text-text">Post a clip</h2>
        <p className="mt-2 text-[14px] leading-5 text-text-2" data-upload-limits>
          Vertical works best. Up to {settings.uploadMaxSeconds} seconds and {formatBytes(limits.maxBytes)}.
          <br />
          MP4, MOV, WebM or MKV.
        </p>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) s.choose(f, limits);
            e.target.value = "";
          }}
        />
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => input.current?.click()} className="btn-primary">
            Choose a video
          </button>
          {recordOn && (
            <button type="button" onClick={() => setRecording(true)} className="btn-ghost">
              <CameraIcon className="h-5 w-5" />
              Record
            </button>
          )}
        </div>
        {blocked && (
          <p role="status" className="mt-5 rounded-xl border border-divider bg-hover px-4 py-3 text-left text-[14px] text-text" data-upload-blocked>
            {blocked}
          </p>
        )}
        {s.notice && (
          <p role="alert" className="mt-4 text-[14px] text-error" data-upload-notice>
            {s.notice}
          </p>
        )}
      </div>
    );
  }

  if (s.phase === "editing") {
    const tags = parseHashtags(s.hashtagsText);
    return (
      <div className="grid gap-6 desk:grid-cols-[280px_1fr]" data-upload-form>
        <div>
          <div className="mx-auto aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-2xl bg-black">
            {s.previewUrl && (
              <video
                ref={preview}
                src={s.previewUrl}
                muted
                loop
                playsInline
                controls
                preload="metadata"
                className="h-full w-full object-contain"
                onLoadedMetadata={(e) => s.setDuration(e.currentTarget.duration)}
              />
            )}
          </div>
          <label className="mx-auto mt-3 block max-w-[280px] text-[13px] text-text-2">
            <span className="flex justify-between">
              <span className="font-medium text-text">Cover frame</span>
              <span>{s.durationS ? `${clipLength(s.coverAt)} of ${clipLength(s.durationS)}` : "picked for you"}</span>
            </span>
            <input
              type="range"
              min={0}
              max={s.durationS ?? 0}
              step={0.1}
              disabled={!s.durationS}
              value={s.coverAt}
              data-cover-range
              onChange={(e) => {
                const at = Number(e.target.value);
                s.edit({ coverAt: at });
                // Show the frame the person is choosing.
                if (preview.current) {
                  preview.current.pause();
                  preview.current.currentTime = at;
                }
              }}
              className="mt-2 w-full accent-[var(--brand)]"
            />
            <span className="mt-1 block">Slide to the frame people see first, in the feed and on your profile.</span>
          </label>
        </div>

        <div className="min-w-0 space-y-5">
          <label className="block">
            <span className="mb-1.5 flex justify-between text-[13px] text-text-2">
              <span className="font-medium text-text">Caption</span>
              <span>
                {s.caption.length}/{CAPTION_MAX}
              </span>
            </span>
            <textarea
              className="field min-h-[110px] text-[15px]"
              placeholder="What is this clip about?"
              maxLength={CAPTION_MAX}
              value={s.caption}
              onChange={(e) => s.edit({ caption: e.target.value })}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 flex justify-between text-[13px] text-text-2">
              <span className="font-medium text-text">Hashtags</span>
              <span>
                {tags.length}/{HASHTAGS_MAX}
              </span>
            </span>
            <input
              className="field text-[15px]"
              placeholder="cats funny first_clip"
              autoCapitalize="none"
              spellCheck={false}
              value={s.hashtagsText}
              onChange={(e) => s.edit({ hashtagsText: e.target.value })}
            />
            <span className="mt-2 flex min-h-[22px] flex-wrap gap-1.5" data-hashtag-chips>
              {tags.length === 0 ? (
                <span className="text-[13px] text-text-2">Letters, numbers and underscores. Separate them with spaces.</span>
              ) : (
                tags.map((t) => (
                  <span key={t} className="pill !text-[var(--link)]">
                    #{t}
                  </span>
                ))
              )}
            </span>
          </label>

          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-text">Who can see it</legend>
            <div className="flex gap-2">
              {(
                [
                  ["public", "Everyone"],
                  ["private", "Only me"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={`flex h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-[14px] ${s.visibility === value ? "border-[var(--brand)] bg-hover text-text" : "border-divider text-text-2"}`}
                >
                  <input type="radio" name="visibility" value={value} checked={s.visibility === value} onChange={() => s.edit({ visibility: value })} className="sr-only" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          {blocked && (
            <p role="status" className="rounded-xl border border-divider bg-hover px-4 py-3 text-[14px] text-text" data-upload-blocked>
              {blocked}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button type="button" onClick={() => s.post()} disabled={blocked !== null} className="btn-primary min-w-[120px]" data-upload-post>
              Post
            </button>
            <button type="button" onClick={() => s.reset()} className="btn-ghost">
              Discard
            </button>
            <span className="truncate text-[13px] text-text-2">
              {s.fileName} · {formatBytes(s.total)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (busy) {
    const pct = percentDone(s.sent, s.total);
    return (
      <Step title={s.phase === "finishing" ? "Almost there" : "Uploading your clip"}>
        <Bar value={s.phase === "signing" ? null : pct} />
        <p>
          {s.phase === "signing" ? "Getting ready" : `${pct}% · ${formatBytes(s.sent)} of ${formatBytes(s.total)}${s.speed > 0 ? ` · ${formatSpeed(s.speed)}` : ""}`}
        </p>
        <p>Keep this page open until the upload is done.</p>
        <button type="button" onClick={() => void s.cancel()} className="btn-ghost">
          Cancel
        </button>
      </Step>
    );
  }

  if (s.phase === "processing") {
    return (
      <Step title="Processing your clip">
        <Bar value={s.progress} />
        <p data-upload-line>{s.line ?? "Waiting to process"}</p>
        <p>The upload is done. You can leave this page; the clip goes live by itself when it is ready.</p>
        <button type="button" onClick={() => s.reset()} className="btn-ghost">
          Post another
        </button>
      </Step>
    );
  }

  if (s.phase === "live") {
    return (
      <Step title="Your clip is live">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[color-mix(in_srgb,var(--ok)_18%,transparent)] text-ok">
          <CheckIcon className="h-8 w-8" />
        </span>
        <div className="flex justify-center gap-2 pt-2">
          {s.videoId && (
            <Link href={`/v/${s.videoId}`} className="btn-primary">
              Watch it
            </Link>
          )}
          <button type="button" onClick={() => s.reset()} className="btn-ghost">
            Post another
          </button>
        </div>
      </Step>
    );
  }

  return (
    <Step title="That did not work">
      <p role="alert" className="text-error" data-upload-error>
        {s.error}
      </p>
      <button type="button" onClick={() => s.reset()} className="btn-primary">
        Try again
      </button>
    </Step>
  );
}
