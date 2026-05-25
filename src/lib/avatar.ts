/** Derive up-to-two-letter initials from a display name or email address. */
export function getInitials(nameOrEmail: string): string {
  const trimmed = nameOrEmail.trim();
  if (!trimmed) {
    return "?";
  }

  // For emails, use the local part (before "@").
  const base = trimmed.includes("@")
    ? trimmed.slice(0, trimmed.indexOf("@"))
    : trimmed;

  const words = base.split(/[\s._-]+/).filter((word) => word.length > 0);
  const first = words[0];
  if (!first) {
    return "?";
  }

  const firstChar = first[0] ?? "";
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const lastChar = last ? (last[0] ?? "") : "";

  return (firstChar + lastChar).toUpperCase() || "?";
}
