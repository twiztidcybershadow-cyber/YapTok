"use client";

const KEY = "yaptok-viewer";

/**
 * A random key this browser keeps, so a signed out visitor's view of a clip
 * counts once a day (record_view in 007_feed.sql hashes it). It says nothing
 * about the person and never leaves this site.
 */
export function viewerKey(): string | null {
  try {
    let key = localStorage.getItem(KEY);
    if (!key || !/^[A-Za-z0-9_-]{16,64}$/.test(key)) {
      key = crypto.randomUUID().replace(/-/g, "");
      localStorage.setItem(KEY, key);
    }
    return key;
  } catch {
    return null;
  }
}
