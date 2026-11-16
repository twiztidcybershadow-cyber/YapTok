// The worker RPCs from supabase/migrations/005_processing.sql (the encode
// queue and the storage_cleanup queue), called with the service role key. Only this box ever holds that key.
import { createClient } from "@supabase/supabase-js";

export function createSupabase(url, serviceRoleKey) {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function rpcError(name, error) {
  return new Error(`${name}: ${error.message ?? "database error"}`);
}

/** The queue, on top of a Supabase client. */
export function createDb(supabase) {
  return {
    /** The next job for this worker, or null when there is nothing to do. */
    async claim(worker) {
      const { data, error } = await supabase.rpc("claim_encode_job", { worker });
      if (error) throw rpcError("claim_encode_job", error);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.job_id) return null;
      return {
        jobId: row.job_id,
        videoId: row.video_id,
        ownerId: row.owner_id,
        sourceKey: row.source_key,
        sourceBytes: row.source_bytes === null ? null : Number(row.source_bytes),
        sourceMime: row.source_mime,
        attempt: Number(row.attempt),
        // Where the creator put the cover frame, in seconds, or null.
        coverAt: row.cover_at === null || row.cover_at === undefined ? null : Number(row.cover_at),
        // The longest a clip can be (the upload_max_seconds site setting), or null.
        maxSeconds: row.max_seconds === null || row.max_seconds === undefined ? null : Number(row.max_seconds),
      };
    },

    /** False when the job is not running any more (taken back as stale). */
    async progress(jobId, pct) {
      const { data, error } = await supabase.rpc("encode_progress", { job_id: jobId, pct });
      if (error) throw rpcError("encode_progress", error);
      return data !== false;
    },

    async done(jobId, r) {
      const { error } = await supabase.rpc("encode_done", {
        job_id: jobId,
        duration_s: r.durationS,
        width: r.width,
        height: r.height,
        hls_key: r.hlsKey,
        thumbnail_url: r.thumbnailUrl,
        preview_sprite_key: r.previewSpriteKey,
        renditions: r.renditions,
      });
      if (error) throw rpcError("encode_done", error);
    },

    /** 'queued' when it will be tried again, 'failed' when the video is failed. */
    async failed(jobId, message, retry = true) {
      const { data, error } = await supabase.rpc("encode_failed", { job_id: jobId, error: message, retry });
      if (error) throw rpcError("encode_failed", error);
      return data;
    },

    /** The next R2 folders to empty (005_processing.sql): [{ id, prefix, attempt }]. */
    async claimCleanup(worker, lim) {
      const { data, error } = await supabase.rpc("claim_cleanup", { worker, lim });
      if (error) throw rpcError("claim_cleanup", error);
      return (Array.isArray(data) ? data : []).map((r) => ({ id: r.id, prefix: r.prefix, attempt: Number(r.attempt) }));
    },

    async cleanupDone(id, deleted) {
      const { error } = await supabase.rpc("cleanup_done", { cleanup_id: id, deleted });
      if (error) throw rpcError("cleanup_done", error);
    },

    async cleanupFailed(id, message) {
      const { error } = await supabase.rpc("cleanup_failed", { cleanup_id: id, error: message });
      if (error) throw rpcError("cleanup_failed", error);
    },
  };
}
