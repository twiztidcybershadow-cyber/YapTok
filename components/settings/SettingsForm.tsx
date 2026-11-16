"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  accountErrorText,
  normalizeUsername,
} from "@/lib/accounts/validation";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "../Avatar";
import { FormError, TextField } from "../auth/fields";
import { useUsernameCheck, usernameNote } from "../auth/useUsernameCheck";
import { DeleteAccount } from "./DeleteAccount";

export type SettingsProfile = {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
};

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="border-b border-divider py-6 last:border-0 md:grid md:grid-cols-[220px_1fr] md:gap-8">
      <div className="mb-4 md:mb-0">
        <h2 className="text-[16px] font-medium leading-[22px] text-text">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-[18px] text-text-2">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** The settings form. With `disabled` it renders as a preview (database not connected). */
export function SettingsForm({ profile, disabled }: { profile: SettingsProfile; disabled?: boolean }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const status = useUsernameCheck(username, profile.username);
  const note = usernameNote(status);

  const dirty =
    displayName !== profile.displayName ||
    normalizeUsername(username) !== profile.username ||
    bio !== profile.bio;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (status.state === "invalid" || status.state === "taken") return setError(note.error!);
    if (displayName.trim().length > DISPLAY_NAME_MAX) return setError(`Use at most ${DISPLAY_NAME_MAX} characters for your name.`);
    if (bio.length > BIO_MAX) return setError(`Use at most ${BIO_MAX} characters for your bio.`);
    const supabase = createClient();
    if (!supabase) return setError("database not connected");

    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim(),
        username: normalizeUsername(username),
        bio: bio.trim(),
      })
      .eq("id", profile.id);
    setBusy(false);
    if (error) {
      // 23505 is a unique violation: someone took the name in the meantime.
      return setError(error.code === "23505" ? accountErrorText("username_taken") : accountErrorText(error.message));
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div>
      <Section title="Picture" description="Your picture is the first letter of your name for now. Uploading one is a later feature.">
        <Avatar name={displayName || profile.username} url={profile.avatarUrl} size={96} />
      </Section>

      <form onSubmit={save}>
        <Section title="Name and username" description="Your name and username are public.">
          <div className="max-w-[440px] space-y-5">
            <TextField
              label="Name"
              value={displayName}
              maxLength={DISPLAY_NAME_MAX}
              disabled={disabled}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <TextField
              label="Username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={25}
              value={username}
              disabled={disabled}
              onChange={(e) => setUsername(e.target.value)}
              hint={normalizeUsername(username) === profile.username ? "Your current username" : note.hint}
              error={note.error}
            />
          </div>
        </Section>

        <Section title="About" description="Tell viewers about yourself.">
          <div className="max-w-[560px]">
            <textarea
              aria-label="Bio"
              className="field min-h-[120px] text-[14px]"
              maxLength={BIO_MAX}
              value={bio}
              disabled={disabled}
              onChange={(e) => setBio(e.target.value)}
            />
            <p className="mt-1 text-right text-[12px] text-text-2">
              {bio.length}/{BIO_MAX}
            </p>
          </div>
        </Section>

        <div className="flex items-center justify-end gap-4 py-4">
          {saved && !dirty && <span className="text-[14px] text-text-2">Saved</span>}
          <FormError message={error} />
          <button type="submit" disabled={disabled || busy || !dirty} className="btn-primary">
            {busy ? "Saving" : "Save"}
          </button>
        </div>
      </form>

      <Section title="Delete account" description="Removes your profile, your clips and your sign in for good.">
        <DeleteAccount username={profile.username} disabled={disabled} />
      </Section>
    </div>
  );
}
