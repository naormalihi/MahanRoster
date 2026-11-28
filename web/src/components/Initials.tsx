import { Avatar } from "@mui/material";
import { alpha } from "@mui/material/styles";

/** Soft, distinct hues – one per מסגרת, the same one every time (by its id). */
const HUES = ["#5b8def", "#e0874a", "#3fa37a", "#a678e0", "#d65f7a", "#3aa6b9", "#c9a227", "#7f8c9d"];

export function gafHue(gafId: string | null | undefined): string {
  if (!gafId) return HUES[HUES.length - 1];
  let h = 0;
  for (const ch of gafId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

/** The first letters of the first two words: "נעמה לוי" → "נל". */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("");
}

/** A round badge with the employee's initials, in his מסגרת's color (2.74). */
export function Initials({ name, gafId, size = 32 }: { name: string; gafId?: string | null; size?: number }) {
  const c = gafHue(gafId);
  return (
    <Avatar aria-hidden sx={{ width: size, height: size, fontSize: Math.round(size * 0.42), fontWeight: 700, color: c, bgcolor: alpha(c, 0.18) }}>
      {initials(name)}
    </Avatar>
  );
}
