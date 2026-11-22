import VisibilityIcon from "@mui/icons-material/VisibilityOutlined";
import { Alert, Box } from "@mui/material";
import type { ReactNode } from "react";
import { isStaff } from "../lib/api";
import { useAuth } from "../lib/auth";

/** Only staff change anything; gaf commanders read. The server enforces the same (RLS). */
export function useCanEdit(): boolean {
  const { me } = useAuth();
  return isStaff(me);
}

/**
 * Around the planning screens: for a reader every action button is shown greyed out and does
 * nothing. Buttons that only show or export carry data-read and stay active, as do switches and
 * checkboxes inside an element with data-read (view filters).
 */
export function ReadOnlyScope({ children }: { children: ReactNode }) {
  const canEdit = useCanEdit();
  if (canEdit) return <>{children}</>;
  return (
    <Box
      sx={{
        "& .MuiButton-root:not([data-read]), & .MuiIconButton-root:not([data-read]), & .MuiCheckbox-root:not([data-read] *), & .MuiSwitch-root:not([data-read] *)": {
          pointerEvents: "none",
          opacity: 0.4,
        },
      }}
    >
      <Alert severity="info" icon={<VisibilityIcon />} sx={{ mb: 2 }}>
        צפייה בלבד. אפשר לראות את כל נתוני היחידה; שינויים נעשים על ידי נע"ת התורנויות.
      </Alert>
      {children}
    </Box>
  );
}
