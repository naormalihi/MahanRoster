import NotificationsIcon from "@mui/icons-material/NotificationsOutlined";
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isStaff } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ago, pushState, subscribePush, unsubscribePush, type AppNotification, type PushState } from "../lib/notifications";

/** Turning push on for this device, or why it cannot be. */
export function PushControl() {
  const { api } = useAuth();
  const [state, setState] = useState<PushState | null>(null);
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushState().then(setState).catch(() => setState("unsupported"));
    api!.vapidPublicKey().then(setKey).catch(() => setKey(null));
  }, [api]);
  if (!state || key === undefined) return null;
  if (key === null) return <Typography variant="caption" color="text.secondary">התראות לטלפון עוד לא הופעלו במערכת.</Typography>;
  if (state === "install_first")
    return (
      <Alert severity="info" icon={false}>
        כדי לקבל התראות באייפון: בספארי ← שיתוף ← <b>הוספה למסך הבית</b>, ופתח את האתר מהאייקון שנוסף.
      </Alert>
    );
  if (state === "unsupported") return <Typography variant="caption" color="text.secondary">הדפדפן הזה לא תומך בהתראות.</Typography>;
  if (state === "denied")
    return <Typography variant="caption" color="text.secondary">ההתראות חסומות בהגדרות הדפדפן לאתר הזה. אפשר לאשר אותן שם.</Typography>;
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2" sx={{ flex: 1 }}>
          התראות לטלפון במכשיר הזה: <b>{state === "on" ? "פעילות" : "כבויות"}</b>
        </Typography>
        <Button
          size="small"
          variant={state === "on" ? "text" : "contained"}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              if (state === "on") await unsubscribePush((e) => api!.deletePushSubscription(e));
              else await subscribePush(key, (s) => api!.savePushSubscription(s));
              setState(await pushState());
            } catch (e) {
              setError((e as Error).message);
            }
            setBusy(false);
          }}
        >
          {state === "on" ? "כיבוי" : "הפעלה"}
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}

/**
 * The bell in the top bar (version 2.0, stage 2.5): unread count, and a panel with the
 * notifications – opening it marks them read; a reserve activation waits for "קיבלתי".
 */
export function NotificationBell() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    api!.myNotifications().then(setItems).catch(() => undefined);
  }, [api]);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [load]);
  const unread = items.filter((n) => !n.read_at || (n.requires_ack && !n.acked_at)).length;

  async function openPanel() {
    setOpen(true);
    const ids = items.filter((n) => !n.read_at && !n.requires_ack).map((n) => n.id);
    if (ids.length) {
      await api!.markNotificationsRead(ids);
      load();
    }
  }

  return (
    <>
      <IconButton color="inherit" aria-label={`התראות${unread ? ` – ${unread} חדשות` : ""}`} onClick={openPanel}>
        <Badge badgeContent={unread} color="error">
          <NotificationsIcon />
        </Badge>
      </IconButton>
      <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
        <Box sx={{ width: { xs: "100vw", sm: 380 }, maxWidth: "100vw", p: 2 }} role="dialog" aria-label="התראות">
          <Stack direction="row" sx={{ alignItems: "center", mb: 1 }}>
            <Typography variant="h3" sx={{ flex: 1 }}>
              התראות
            </Typography>
            <Button onClick={() => setOpen(false)}>סגירה</Button>
          </Stack>
          <PushControl />
          <RequestAlertsControl />
          <Divider sx={{ my: 1.5 }} />
          {items.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              אין התראות.
            </Typography>
          )}
          <Stack divider={<Divider />}>
            {items.map((n) => (
              <Box
                key={n.id}
                sx={{ py: 1.25, cursor: "pointer", opacity: n.read_at && (!n.requires_ack || n.acked_at) ? 0.7 : 1 }}
                onClick={() => {
                  setOpen(false);
                  navigate(n.url || "/");
                }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
                  <Typography sx={{ fontWeight: 700, flex: 1 }}>{n.title}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                    {ago(n.created_at)}
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {n.body}
                </Typography>
                {n.requires_ack && !n.acked_at && (
                  <Button
                    size="small"
                    variant="contained"
                    sx={{ mt: 1 }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      await api!.ackNotification(n.id);
                      load();
                    }}
                  >
                    קיבלתי
                  </Button>
                )}
                {n.requires_ack && n.acked_at && (
                  <Typography variant="caption" color="success.main">
                    אישרת קבלה
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        </Box>
      </Drawer>
    </>
  );
}

/** נע"ת, מ"מ and gaf commanders: notices on new exemption requests – on unless turned off here. */
function RequestAlertsControl() {
  const { api, me } = useAuth();
  const [on, setOn] = useState(me?.requestAlerts ?? true);
  const [error, setError] = useState<string | null>(null);
  if (!me || !(isStaff(me) || me.roles.includes("gaf_commander"))) return null;
  return (
    <Box sx={{ mt: 1 }}>
      <FormControlLabel
        sx={{ m: 0, width: "100%", justifyContent: "space-between" }}
        labelPlacement="start"
        label={<Typography variant="body2">התראה על בקשת פטור חדשה{isStaff(me) ? "" : " במסגרת שלי"}</Typography>}
        control={
          <Switch
            checked={on}
            onChange={async (_, v) => {
              setOn(v);
              setError(null);
              try {
                await api!.setMyRequestAlerts(v);
                if (me) me.requestAlerts = v;
              } catch (e) {
                setOn(!v);
                setError((e as Error).message);
              }
            }}
          />
        }
      />
      {error && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}
    </Box>
  );
}
