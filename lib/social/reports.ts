// The reasons a clip or comment can be reported for. Keep in step with the
// check in public.reports and report_content() (008_moderation.sql).
// No imports, so the tests load it directly.

export const REPORT_REASONS = [
  { key: "spam", label: "Spam or misleading" },
  { key: "nudity", label: "Nudity or sexual content" },
  { key: "violence", label: "Violence or gore" },
  { key: "harassment", label: "Harassment or bullying" },
  { key: "hate", label: "Hate speech" },
  { key: "dangerous", label: "Dangerous acts or self-harm" },
  { key: "minor_safety", label: "A child may be at risk" },
  { key: "copyright", label: "Uses my work without permission" },
  { key: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["key"];

export const REPORT_NOTE_MAX = 500;

export function reasonLabel(key: string): string {
  return REPORT_REASONS.find((r) => r.key === key)?.label ?? key;
}

export function isReportReason(value: unknown): value is ReportReason {
  return REPORT_REASONS.some((r) => r.key === value);
}
