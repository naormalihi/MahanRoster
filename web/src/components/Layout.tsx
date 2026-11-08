import CheckIcon from "@mui/icons-material/Check";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LogoutIcon from "@mui/icons-material/Logout";
import MenuIcon from "@mui/icons-material/Menu";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
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
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { canRead, isStaff } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import { stageLabel } from "../lib/cycles";

const ROLE_LABEL: Record<string, string> = {
  coordinator: "נע\"ת תורנויות",
  deputy: "ממלא מקום",
  viewer: "צפייה",
  gaf_commander: "מפקד גף",
};

/** Four areas instead of a link per screen; the cycle steps live inside "מחזור". */
const STAFF_LINKS = [
  { to: "/", label: "בית", match: (p: string) => p === "/" },
  { to: "/cycle", label: "מחזור", match: (p: string) => p.startsWith("/cycle") },
  { to: "/soldiers", label: "חיילים", match: (p: string) => p.startsWith("/soldiers") },
  { to: "/board", label: "לוח מפורסם", match: (p: string) => p === "/board" },
  { to: "/admin", label: "הגדרות", match: (p: string) => p === "/admin" },
];

/** The cycle every step works on, chosen here once. */
function CycleSwitcher({ dark }: { dark?: boolean }) {
  const { cycles, cycle, setCycleId } = useCycle();
  const staff = isStaff(useAuth().me);
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!cycles) return null;
  return (
    <>
      <Button
        color="inherit"
        endIcon={<ExpandMoreIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{
          border: 1,
          borderColor: dark ? "divider" : "rgba(255,255,255,.35)",
          borderRadius: 2,
          px: 1.25,
          py: 0.25,
          textAlign: "start",
          justifyContent: "space-between",
          width: dark ? "100%" : "auto",
        }}
      >
        <Box sx={{ lineHeight: 1.2 }}>
          <Box component="span" sx={{ display: "block", fontSize: 11, opacity: 0.75 }}>
            מחזור בעבודה
          </Box>
          <Box component="span" sx={{ display: "block", fontWeight: 700, fontSize: 14 }}>
            {cycle ? `${cycle.name} · ${stageLabel(cycle.status)}` : "אין מחזור"}
          </Box>
        </Box>
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <ListSubheader>בחירת מחזור – כל השלבים יעבדו עליו</ListSubheader>
        {cycles.map((c) => (
          <MenuItem
            key={c.id}
            selected={c.id === cycle?.id}
            onClick={() => {
              setCycleId(c.id);
              setAnchor(null);
            }}
          >
            <ListItemIcon>{c.id === cycle?.id ? <CheckIcon fontSize="small" /> : null}</ListItemIcon>
            <ListItemText primary={c.name} secondary={stageLabel(c.status)} />
          </MenuItem>
        ))}
        {staff && <Divider />}
        {staff && <MenuItem
          onClick={() => {
            setAnchor(null);
            navigate("/cycles");
          }}
        >
          <ListItemIcon>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          ניהול מחזורים (יצירה, תאריכים, שלבים)
        </MenuItem>}
      </Menu>
    </>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { me, api, signOut } = useAuth();
  const staff = isStaff(me);
  const reader = canRead(me);
  const compact = useMediaQuery("(max-width:1099.95px)");
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const who = me ? `${me.username} · ${me.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ")}` : "";
  const links = staff ? STAFF_LINKS : reader ? STAFF_LINKS.filter((l) => l.to !== "/admin") : [];
  const current = links.find((l) => l.match(pathname));
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", "@media print": { bgcolor: "white" } }}>
      <AppBar position="sticky" color="primary" elevation={0} sx={{ "@media print": { display: "none" } }}>
        <Toolbar sx={{ gap: 1 }}>
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
              {current?.label}
            </Typography>
          )}
          {!compact &&
            links.map((l) => (
              <Button
                key={l.to}
                component={NavLink}
                to={l.to}
                end
                color="inherit"
                className={l.match(pathname) ? "active" : undefined}
                sx={{ "&.active": { bgcolor: "rgba(255,255,255,.15)" } }}
              >
                {l.label}
              </Button>
            ))}
          <Box sx={{ flex: 1 }} />
          {reader && !compact && <CycleSwitcher />}
          {api?.demo && <Chip size="small" label={compact ? "הדגמה" : "מצב הדגמה – נתונים פיקטיביים"} sx={{ bgcolor: "#f3c96b", color: "#3a2a00" }} />}
          {me && !compact && (
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              {who}
            </Typography>
          )}
          {!(compact && links.length) && (
            <Button color="inherit" startIcon={<LogoutIcon />} onClick={signOut}>
              יציאה
            </Button>
          )}
        </Toolbar>
      </AppBar>
      <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
        <Box sx={{ width: 280 }} role="navigation">
          <Box sx={{ p: 2, display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box component="img" src="/brand/emblem-mark.png" alt="" sx={{ height: 36 }} />
            <Box>
              <Typography sx={{ fontWeight: 700 }}>MahanRoster</Typography>
              <Typography variant="caption" color="text.secondary">
                {who}
              </Typography>
            </Box>
          </Box>
          {reader && (
            <Box sx={{ px: 2, pb: 1.5 }}>
              <CycleSwitcher dark />
            </Box>
          )}
          <Divider />
          <List>
            {links.map((l) => (
              <ListItemButton key={l.to} component={NavLink} to={l.to} end selected={l.match(pathname)} onClick={() => setOpen(false)}>
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
