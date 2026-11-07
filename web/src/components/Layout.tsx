import LogoutIcon from "@mui/icons-material/Logout";
import MenuIcon from "@mui/icons-material/Menu";
import {
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Toolbar,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
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
  // nine links fit one row from about 1440px
  const compact = useMediaQuery("(max-width:1439.95px)");
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const who = me ? `${me.username} · ${me.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ")}` : "";
  const links = staff
    ? [
        { to: "/", label: "לוח מפורסם" },
        { to: "/cycles", label: "מחזורים" },
        { to: "/constraints", label: "אילוצים" },
        { to: "/potential", label: "פוטנציאל" },
        { to: "/slots", label: "לוח הבסיס" },
        { to: "/schedule", label: "שיבוץ" },
        { to: "/soldiers", label: "חיילים" },
        { to: "/roster", label: "טעינת כוח אדם" },
        { to: "/admin", label: "הגדרות" },
      ]
    : [];
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", "@media print": { bgcolor: "white" } }}>
      <AppBar position="sticky" color="primary" elevation={0} sx={{ "@media print": { display: "none" } }}>
        <Toolbar sx={{ gap: 1, flexWrap: "wrap" }}>
          {compact && links.length > 0 && (
            <IconButton color="inherit" edge="start" aria-label="תפריט" onClick={() => setOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
          <Box component="img" src="/brand/emblem-mark-light.png" alt="סמל יחידת מה״ן" sx={{ height: 34, ml: 1 }} />
          <Typography variant="h3" component="div" sx={{ fontWeight: 700, ml: 2 }}>
            MahanRoster
          </Typography>
          {compact && (
            <Typography variant="body2" sx={{ opacity: 0.85 }}>
              {links.find((l) => l.to === pathname)?.label}
            </Typography>
          )}
          {!compact && links.map((l) => (
            <Button key={l.to} component={NavLink} to={l.to} end color="inherit" sx={{ "&.active": { bgcolor: "rgba(255,255,255,.15)" } }}>
              {l.label}
            </Button>
          ))}
          <Box sx={{ flex: 1 }} />
          {api?.demo && <Chip size="small" label={compact ? "הדגמה" : "מצב הדגמה – נתונים פיקטיביים"} sx={{ bgcolor: "#f3c96b", color: "#3a2a00" }} />}
          {me && !(compact && links.length) && (
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              {who}
            </Typography>
          )}
          {compact && links.length > 0 ? null : (
            <Button color="inherit" startIcon={<LogoutIcon />} onClick={signOut}>
              יציאה
            </Button>
          )}
        </Toolbar>
      </AppBar>
      <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
        <Box sx={{ width: 260 }} role="navigation">
          <Box sx={{ p: 2, display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box component="img" src="/brand/emblem-mark.png" alt="" sx={{ height: 36 }} />
            <Box>
              <Typography sx={{ fontWeight: 700 }}>MahanRoster</Typography>
              <Typography variant="caption" color="text.secondary">
                {who}
              </Typography>
            </Box>
          </Box>
          <Divider />
          <List>
            {links.map((l) => (
              <ListItemButton key={l.to} component={NavLink} to={l.to} end selected={pathname === l.to} onClick={() => setOpen(false)}>
                <ListItemText primary={l.label} />
              </ListItemButton>
            ))}
          </List>
          <Divider />
          <List>
            <ListItemButton onClick={signOut}>
              <LogoutIcon fontSize="small" sx={{ ml: 1.5 }} />
              <ListItemText primary="יציאה" />
            </ListItemButton>
          </List>
        </Box>
      </Drawer>
      <Box sx={{ display: "none", "@media print": { display: "flex" }, alignItems: "center", gap: 2, px: 1, pt: 1, pb: 2, borderBottom: "2px solid #e8700f" }}>
        <Box component="img" src="/brand/emblem.png" alt="סמל יחידת מה״ן" sx={{ height: 70 }} />
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 18 }}>יחידת מה״ן – תורנויות</Typography>
          <Typography variant="body2">הודפס ב-{new Date().toLocaleDateString("he-IL")}</Typography>
        </Box>
      </Box>
      <Container maxWidth="lg" sx={{ py: 3, px: { xs: 2, sm: 3 } }}>
        {children}
      </Container>
    </Box>
  );
}
