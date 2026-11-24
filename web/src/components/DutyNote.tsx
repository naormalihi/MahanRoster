import NoteIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import { Box, Stack } from "@mui/material";

/** A duty's own note (from the duties file or written by hand): shown as written, beside the briefing. */
export function DutyNote({ note, size = 13 }: { note?: string | null; size?: number }) {
  if (!note) return null;
  return (
    <Stack direction="row" sx={{ alignItems: "flex-start", gap: 0.5, fontSize: size, color: "text.primary" }}>
      <NoteIcon sx={{ fontSize: size + 2, mt: "2px", color: "text.secondary", flexShrink: 0 }} aria-label="הערה" />
      <Box component="span" sx={{ whiteSpace: "pre-line", lineHeight: 1.5, overflowWrap: "anywhere" }}>
        {note}
      </Box>
    </Stack>
  );
}
