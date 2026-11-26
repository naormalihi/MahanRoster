import VisibilityIcon from "@mui/icons-material/VisibilityOutlined";
import { Alert, Box, Button } from "@mui/material";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

/**
 * "צפייה כעובד" (2.63): a line above every screen while staff (or a gaf commander) see the app as one
 * employee, and the screens below it read only – the server blocks every action anyway.
 */
export function ViewAsScope({ children }: { children: ReactNode }) {
  const { me, api, refresh } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const v = me?.viewAs;
  if (!v) return <>{children}</>;
  const until = new Date(v.until).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  const back = async () => {
    setBusy(true);
    try {
      await api!.viewAsStop();
      await refresh();
      navigate("/soldiers");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Alert
        severity="warning"
        icon={<VisibilityIcon />}
        sx={{ mb: 2, position: "sticky", top: 8, zIndex: (t) => t.zIndex.appBar - 1, alignItems: "center" }}
        action={
          <Button color="inherit" size="small" variant="outlined" onClick={back} disabled={busy} sx={{ whiteSpace: "nowrap" }}>
            חזרה לחשבון שלי
          </Button>
        }
      >
        צופה כ<b>{v.name}</b> · תצוגה בלבד, עד {until}
      </Alert>
      <Box
        sx={{
          "& .MuiButton-root:not([data-read]), & .MuiIconButton-root:not([data-read]), & .MuiCheckbox-root, & .MuiSwitch-root, & .MuiFab-root": {
            pointerEvents: "none",
            opacity: 0.45,
          },
        }}
      >
        {children}
      </Box>
    </>
  );
}
