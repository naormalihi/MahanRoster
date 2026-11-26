import NotificationsOffIcon from "@mui/icons-material/NotificationsOffOutlined";
import { Box, Link } from "@mui/material";
import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { pushState } from "../lib/notifications";

/** The duties screen: one small line while push is off on this device – turning it on is in "חשבון". */
export function PushOffLine() {
  const { api } = useAuth();
  const [off, setOff] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([pushState(), api!.vapidPublicKey()])
      .then(([s, key]) => live && setOff(!!key && s !== "on" && s !== "unsupported"))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api]);
  if (!off) return null;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        minHeight: 44,
        px: 1.5,
        py: 1,
        borderRadius: 2,
        border: 1,
        borderColor: "warning.main",
        bgcolor: (t) => (t.palette.mode === "dark" ? "rgba(255,180,0,0.08)" : "rgba(255,180,0,0.12)"),
        color: "warning.main",
        fontSize: 14,
      }}
    >
      <NotificationsOffIcon fontSize="small" />
      <Box sx={{ flex: 1, color: "text.primary" }}>התראות כבויות – בלי תזכורות למשימות</Box>
      <Link component={RouterLink} to="/account" sx={{ fontWeight: 700 }}>
        להפעלה
      </Link>
    </Box>
  );
}
