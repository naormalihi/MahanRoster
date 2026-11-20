import CheckIcon from "@mui/icons-material/Check";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HelpIcon from "@mui/icons-material/HelpOutlined";
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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { useEffect, useState, type ReactNode } from "react";
import { Link as RouterLink, NavLink, useLocation, useNavigate } from "react-router-dom";
import { canRead, isSoldier, isStaff, isUnitCommander } from "../lib/api";
import { NotificationBell } from "./NotificationBell";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import { useReturnCounter } from "../lib/refreshOnReturn";
import { stageLabel } from "../lib/cycles";
import { APP_VERSION, BUILD_DATE, BUILD_SHA, CHANGELOG } from "../lib/changelog";
import { Mascot } from "./Mascot";
import { OwlTour } from "./OwlTour";
import { markTourSeen, tourKind, tourSeen, tourSteps } from "../lib/tour";
import ContactIcon from "@mui/icons-material/ContactPhoneOutlined";
import { ContactsDialog } from "./ContactCard";
import { FeedbackDialog } from "./FeedbackDialog";
import IdeaIcon from "@mui/icons-material/LightbulbOutlined";
import InboxIcon from "@mui/icons-material/InboxOutlined";
import { ThemeSync, ThemeToggle } from "./ThemePicker";

const ROLE_LABEL: Record<string, string> = {
  coordinator: "נע\"ת תורנויות",
  deputy: "ממלא מקום",
  viewer: "צפייה",
  gaf_commander: "מפקד גף",
  soldier: "חייל",
  unit_commander: "מפקד יחידה",
};

/** Four areas instead of a link per screen; the cycle steps live inside "מחזור". */
const STAFF_LINKS = [
  { to: "/", label: "תמונת מצב", match: (p: string) => p === "/" },
  { to: "/cycle", label: "תכנון ושיבוץ", match: (p: string) => p.startsWith("/cycle") },
  { to: "/soldiers", label: "כוח אדם", match: (p: string) => p.startsWith("/soldiers") },
  { to: "/board", label: "לוח התורנויות", match: (p: string) => p === "/board" },
  { to: "/dashboard", label: "נתוני היחידה", match: (p: string) => p === "/dashboard" },
  { to: "/admin", label: "הגדרות", match: (p: string) => p === "/admin" },
];

/** A soldier with his own account: his duties and the published board. */
const SOLDIER_LINKS = [
  { to: "/", label: "התורנויות שלי", match: (p: string) => p === "/" },
  { to: "/requests", label: "הבקשות שלי", match: (p: string) => p === "/requests" },
  { to: "/board", label: "לוח התורנויות", match: (p: string) => p === "/board" },
  { to: "/scoring", label: "איך מחושב הניקוד", match: (p: string) => p === "/scoring" },
];

/** Staff and commanders who do duties too: their own corner, next to the unit's screens. */
const MY_LINKS = [
  { to: "/my", label: "התורנויות שלי", match: (p: string) => p === "/my" },
  { to: "/requests", label: "הבקשות שלי", match: (p: string) => p === "/requests" },
];

/** The "שלי" menu on a wide screen. */
function MyMenu({ pathname }: { pathname: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const active = MY_LINKS.some((l) => l.match(pathname));
  return (
    <>
      <Button
        color="inherit"
        onClick={(e) => setAnchor(e.currentTarget)}
        endIcon={<ExpandMoreIcon />}
        aria-haspopup="menu"
        sx={active ? { bgcolor: "rgba(255,255,255,.15)" } : undefined}
      >
        שלי
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {MY_LINKS.map((l) => (
          <MenuItem key={l.to} component={NavLink} to={l.to} selected={l.match(pathname)} onClick={() => setAnchor(null)}>
            {l.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

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

function VersionFooter() {
  const [open, setOpen] = useState(false);
  const built = BUILD_DATE ? new Date(BUILD_DATE).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" }) : "";
  return (
    <>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`גרסה ${APP_VERSION} – מה חדש`}
        sx={{
          all: "unset",
          cursor: "pointer",
          px: 2,
          py: 1.25,
          borderTop: 1,
          borderColor: "divider",
          color: "text.secondary",
          fontSize: 12,
          "&:hover": { color: "primary.main" },
          "&:focus-visible": { outline: 2, outlineColor: "primary.main" },
        }}
      >
        גרסה {APP_VERSION}
        <Box component="span" sx={{ mx: 0.75, opacity: 0.6 }}>
          ·
        </Box>
        <Box component="span" sx={{ fontFamily: "monospace", direction: "ltr", unicodeBidi: "isolate" }}>
          {BUILD_SHA}
        </Box>
        {built && (
          <>
            <Box component="span" sx={{ mx: 0.75, opacity: 0.6 }}>
              ·
            </Box>
            {built}
          </>
        )}
      </Box>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Mascot pose="point" height={64} />
          מה חדש בתורנצ׳יק
        </DialogTitle>
        <DialogContent dividers>
          {CHANGELOG.map((r) => (
            <Box key={r.version} sx={{ "& + &": { mt: 2 } }}>
              <Typography sx={{ fontWeight: 700 }}>
                גרסה {r.version}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                  {r.date.split("-").reverse().join("/")}
                </Typography>
              </Typography>
              <Box component="ul" sx={{ m: 0, pr: 2.5, pl: 0 }}>
                {r.items.map((t) => (
                  <Typography component="li" variant="body2" key={t}>
                    {t}
                  </Typography>
                ))}
              </Box>
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>סגירה</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const returned = useReturnCounter();
  const { me, api, signOut } = useAuth();
  const staff = isStaff(me);
  const reader = canRead(me);
  const compact = useMediaQuery("(max-width:1099.95px)");
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const kind = tourKind(me);
  const [tour, setTour] = useState(false);
  const [contacts, setContacts] = useState(false);
  const [feedback, setFeedback] = useState(false);
  // נע"ת, מ"מ and the unit commander: how many new messages wait in "הצעות ומשוב"
  const [newFeedback, setNewFeedback] = useState(0);
  const seesFeedback = staff || isUnitCommander(me);
  useEffect(() => {
    if (!seesFeedback || !api) return;
    api.feedbackNewCount().then(setNewFeedback, () => setNewFeedback(0));
  }, [api, seesFeedback, open]);
  // the first time this user opens the app on this device
  useEffect(() => {
    if (me && kind && !me.mustChangePassword && !tourSeen(me.userId)) setTour(true);
  }, [me, kind]);
  const closeTour = () => {
    setTour(false);
    if (me) markTourSeen(me.userId);
  };
  const who = me ? `${me.username} · ${me.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ")}` : "";
  const links = staff
    ? STAFF_LINKS
    : reader
      ? STAFF_LINKS.filter((l) => l.to !== "/admin" && !(isUnitCommander(me) && l.to === "/dashboard"))
      : isSoldier(me)
        ? SOLDIER_LINKS
        : [];
  const mine = isSoldier(me) && (staff || reader);
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", "@media print": { bgcolor: "white" } }}>
      <AppBar position="sticky" color="primary" elevation={0} sx={{ "@media print": { display: "none" } }}>
        <Toolbar sx={{ gap: 1 }}>
          {compact && links.length > 0 && (
            <IconButton color="inherit" edge="start" aria-label="תפריט" onClick={() => setOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
          <Box component="img" src="/brand/owl/head-96.png" alt="" sx={{ height: 36, width: 36, ml: 1 }} />
          <Typography variant="h3" component="div" sx={{ fontWeight: 800, ml: 2 }}>
            תורנצ׳יק
          </Typography>
          {compact && (
            <Typography variant="body2" sx={{ opacity: 0.85, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} dir="auto">
              {me?.username}
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
          {!compact && mine && <MyMenu pathname={pathname} />}
          <Box sx={{ flex: 1 }} />
          {reader && !compact && <CycleSwitcher />}
          {api?.demo && <Chip size="small" label={compact ? "הדגמה" : "מצב הדגמה – נתונים פיקטיביים"} sx={{ bgcolor: "#f3c96b", color: "#3a2a00" }} />}
          {me && !compact && (
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              {who}
            </Typography>
          )}
          {/* soldiers, and נע"ת for the swaps soldiers made */}
          {(isSoldier(me) || staff) && <NotificationBell />}
          {kind && !compact && (
            <IconButton color="inherit" aria-label="סיור היכרות" title="סיור היכרות" onClick={() => setTour(true)}>
              <HelpIcon />
            </IconButton>
          )}
          {me && !compact && (
            <IconButton color="inherit" aria-label="הצעה לשיפור" title="הצעה לשיפור" onClick={() => setFeedback(true)}>
              <IdeaIcon />
            </IconButton>
          )}
          <ThemeToggle />
          {!(compact && links.length) && (
            <Button color="inherit" startIcon={<LogoutIcon />} onClick={signOut}>
              יציאה
            </Button>
          )}
        </Toolbar>
      </AppBar>
      <ThemeSync />
      {kind && (
        <OwlTour
          open={tour}
          steps={tourSteps(kind, mine)}
          onClose={closeTour}
          onFeedback={() => {
            closeTour();
            setFeedback(true);
          }}
        />
      )}
      {feedback && <FeedbackDialog onClose={() => setFeedback(false)} />}
      {contacts && <ContactsDialog onClose={() => setContacts(false)} />}
      <Drawer anchor="left" open={open} onClose={() => setOpen(false)}>
        <Box sx={{ width: 280, minHeight: "100%", display: "flex", flexDirection: "column" }} role="navigation">
          <Box sx={{ p: 2, display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box component="img" src="/brand/owl/head-96.png" alt="" sx={{ height: 40, width: 40 }} />
            <Box>
              <Typography sx={{ fontWeight: 800 }}>תורנצ׳יק</Typography>
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
          {mine && (
            <>
              <Divider />
              <List subheader={<ListSubheader>שלי</ListSubheader>}>
                {MY_LINKS.map((l) => (
                  <ListItemButton key={l.to} component={NavLink} to={l.to} end selected={l.match(pathname)} onClick={() => setOpen(false)}>
                    <ListItemText primary={l.label} />
                  </ListItemButton>
                ))}
              </List>
            </>
          )}
          <Divider />
          <List>
            {isSoldier(me) && (
              <ListItemButton
                onClick={() => {
                  setOpen(false);
                  setContacts(true);
                }}
              >
                <ContactIcon fontSize="small" sx={{ ml: 1.5 }} />
                <ListItemText primary="למי לפנות" />
              </ListItemButton>
            )}
            {seesFeedback && (
              <ListItemButton component={RouterLink} to={staff ? "/admin?tab=feedback" : "/feedback"} onClick={() => setOpen(false)}>
                <InboxIcon fontSize="small" sx={{ ml: 1.5 }} />
                <ListItemText primary={`הצעות ומשוב${newFeedback ? ` (${newFeedback} חדשות)` : ""}`} />
              </ListItemButton>
            )}
            <ListItemButton
              onClick={() => {
                setOpen(false);
                setFeedback(true);
              }}
            >
              <IdeaIcon fontSize="small" sx={{ ml: 1.5 }} />
              <ListItemText primary="הצעה לשיפור" />
            </ListItemButton>
            {kind && (
              <ListItemButton
                onClick={() => {
                  setOpen(false);
                  setTour(true);
                }}
              >
                <HelpIcon fontSize="small" sx={{ ml: 1.5 }} />
                <ListItemText primary="סיור היכרות עם תורנצ׳יק" />
              </ListItemButton>
            )}
            <ListItemButton onClick={signOut}>
              <LogoutIcon fontSize="small" sx={{ ml: 1.5 }} />
              <ListItemText primary="יציאה" />
            </ListItemButton>
          </List>
          <Box sx={{ flex: 1 }} />
          <VersionFooter />
        </Box>
      </Drawer>
      <Box sx={{ display: "none", "@media print": { display: "flex" }, alignItems: "center", gap: 2, px: 1, pt: 1, pb: 2, borderBottom: "2px solid #e8700f" }}>
        <Box component="img" src="/brand/owl/head-96.png" alt="" sx={{ height: 56, width: 56 }} />
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 18 }}>תורנצ׳יק – תורנויות</Typography>
          <Typography variant="body2">הודפס ב-{new Date().toLocaleDateString("he-IL")}</Typography>
        </Box>
      </Box>
      {/* back to the app after a while: the screen loads its data again */}
      <Container key={returned} maxWidth="lg" sx={{ py: 3, px: { xs: 2, sm: 3 } }}>
        <OfflineStrip />
        {children}
      </Container>
    </Box>
  );
}

/** Without reception, a line above every screen; "my duties" show the copy kept on the device. */
function OfflineStrip() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (online) return null;
  return (
    <Box role="status" sx={{ mb: 2, px: 1.5, py: 0.75, borderRadius: 1, bgcolor: "warning.main", color: "warning.contrastText", fontWeight: 600, fontSize: 14, "@media print": { display: "none" } }}>
      אין חיבור לאינטרנט – פעולות יחכו לחיבור.
    </Box>
  );
}
