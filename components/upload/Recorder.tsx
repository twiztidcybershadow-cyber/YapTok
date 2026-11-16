"use client";

import { useEffect, useRef, useState } from "react";
import { clipLength } from "@/lib/feed/format";

/** The container the browser can record, as a type the upload accepts. */
function recordType(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mime, ext] of [
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm", "webm"],
    ["video/mp4", "mp4"],
  ] as const) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return null;
}

/**
 * Films a clip with the camera of the phone or laptop. Nothing leaves the
 * device until the person presses Post: the recording is handed to the same
 * form as a picked file. It stops by itself at the longest length a clip can be.
 */
export function Recorder({ maxSeconds, onDone, onCancel }: { maxSeconds: number; onDone: (file: File) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  // The recorder only shows after a tap, in the browser, so this can ask the browser right away.
  const [error, setError] = useState<string | null>(() =>
    typeof navigator.mediaDevices?.getUserMedia === "function" && recordType() ? null : "This browser cannot record video. Choose a video from your files instead.",
  );
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  // Open the camera when the recorder shows; let it go when it closes.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia || !recordType()) return;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 9 / 16 } }, audio: true })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setReady(true);
      })
      .catch(() => setError("The camera or microphone is not available. Allow access in your browser and try again."));
    return () => {
      cancelled = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // The clock, and the automatic stop at the limit.
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const t = setInterval(() => {
      const s = (Date.now() - started) / 1000;
      setSeconds(s);
      if (s >= maxSeconds) recorder.current?.stop();
    }, 200);
    return () => clearInterval(t);
  }, [recording, maxSeconds]);

  function start() {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    const type = recordType();
    if (!stream || !type) return;
    chunks.current = [];
    const rec = new MediaRecorder(stream, { mimeType: type.mime });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      setRecording(false);
      const blob = new Blob(chunks.current, { type: type.mime.split(";")[0] });
      if (blob.size > 0) onDone(new File([blob], `recording.${type.ext}`, { type: blob.type }));
    };
    recorder.current = rec;
    rec.start(1000);
    setSeconds(0);
    setRecording(true);
  }

  return (
    <div className="mx-auto flex w-full max-w-[360px] flex-col items-center gap-4" data-recorder>
      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" />
        {recording && (
          <p className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-[13px] font-medium text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff4e45]" />
            {clipLength(seconds)} / {clipLength(maxSeconds)}
          </p>
        )}
        {error && <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-[14px] text-white">{error}</p>}
      </div>
      <div className="flex gap-2">
        {recording ? (
          <button type="button" onClick={() => recorder.current?.stop()} className="btn-primary">
            Stop
          </button>
        ) : (
          <button type="button" onClick={start} disabled={!ready} className="btn-primary">
            Start recording
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={recording} className="btn-ghost">
          Back
        </button>
      </div>
    </div>
  );
}
