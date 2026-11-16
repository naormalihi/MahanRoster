import { Box, type SxProps, type Theme } from "@mui/material";

/** Turanchik, the owl – the face of the app. Only on light backgrounds (his uniform is the app's navy). */
export type MascotPose = "wave" | "point" | "cheer" | "confused" | "sleep" | "clipboard";

const ALT: Record<MascotPose, string> = {
  wave: "תורנצ׳יק מנופף לשלום",
  point: "תורנצ׳יק מצביע",
  cheer: "תורנצ׳יק חוגג",
  confused: "תורנצ׳יק מבולבל",
  sleep: "תורנצ׳יק ישן",
  clipboard: "תורנצ׳יק עם לוח",
};

export function Mascot({ pose, height = 140, sx }: { pose: MascotPose; height?: number; sx?: SxProps<Theme> }) {
  return (
    <Box
      component="img"
      src={`/brand/owl/${pose}.webp`}
      alt={ALT[pose]}
      loading="lazy"
      decoding="async"
      sx={[{ height, width: "auto", maxWidth: "100%", objectFit: "contain", alignSelf: "center", flexShrink: 0, display: "block", userSelect: "none", pointerEvents: "none" }, ...(Array.isArray(sx) ? sx : [sx])]}
    />
  );
}
