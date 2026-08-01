import crypto from "node:crypto";

/**
 * Join codes. Six characters from an alphabet with the ambiguous glyphs removed
 * (no O/0, I/1, or the letters that read as each other in a screenshot), so a
 * code can be read aloud across a table or typed off a photo without a retry.
 *
 * 30^6 ≈ 730M combinations. That's not a secret — a code is a convenience for
 * people who were already going to be invited, and the caller must still treat
 * "knows the code" as the whole authorization to join. Codes are rotatable
 * precisely because they leak: screenshots, group chats, ex-members.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
const LENGTH = 6;

export function generateInviteCode(): string {
  // rejection-free: 32-char alphabet divides 256 evenly, so no modulo bias
  const bytes = crypto.randomBytes(LENGTH);
  let out = "";
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Normalize whatever the user typed into the canonical form, or null if it
 *  can't be one of our codes. Forgiving about case, spaces and dashes — people
 *  paste "abc-123" from a message and expect it to work. */
export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== LENGTH) return null;
  for (const ch of code) if (!ALPHABET.includes(ch)) return null;
  return code;
}
