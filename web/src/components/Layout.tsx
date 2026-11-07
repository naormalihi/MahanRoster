import LogoutIcon from "@mui/icons-material/Logout";
import { AppBar, Box, Button, Chip, Container, Toolbar, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { isStaff } from "../lib/api";
import { useAuth } from "../lib/auth";

const ROLE_LABEL: Record<string, string> = {
  coordinator: "נע\"ת תורנויות",
  deputy: "ממלא מקום",
  viewer: "צפייה",
};

export function Layout({ children }: { children: ReactNode }) {
  const { me, api, signOut } = useAuth();
  const staff = isStaff(me);
  const links = staff
    ? [
        { to: "/", label: "לוח מפורסם" },
        { to: "/soldiers", label: "חיילים" },
        { to: "/roster", label: "טעינת כוח אדם" },
      ]
    : [];
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", "@media print": { bgcolor: "white" } }}>
      <AppBar position="sticky" color="primary" elevation={0} sx={{ "@media print": { display: "none" } }}>
        <Toolbar sx={{ gap: 1, flexWrap: "wrap" }}>
          <Typography variant="h3" component="div" sx={{ fontWeight: 700, ml: 2 }}>
            MahanRoster
          </Typography>
          {links.map((l) => (
            <Button key={l.to} component={NavLink} to={l.to} end color="inherit" sx={{ "&.active": { bgcolor: "rgba(255,255,255,.15)" } }}>
              {l.label}
            </Button>
          ))}
          <Box sx={{ flex: 1 }} />
          {api?.demo && <Chip size="small" label="מצב הדגמה – נתונים פיקטיביים" sx={{ bgcolor: "#f3c96b", color: "#3a2a00" }} />}
          {me && (
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              {me.username} · {me.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ")}
            </Typography>
          )}
          <Button color="inherit" startIcon={<LogoutIcon />} onClick={signOut}>
            יציאה
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3, px: { xs: 2, sm: 3 } }}>
        {children}
      </Container>
    </Box>
  );
}
