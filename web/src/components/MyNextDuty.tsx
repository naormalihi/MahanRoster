import { Alert, Button } from "@mui/material";
import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { isSoldier } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dayLabel, spanLabel } from "../lib/dates";
import { splitDuties, type MyDuty } from "../lib/me";

const WEEK = 7 * 86_400_000;

/** On the home of אחראי השיבוצים or a commander who does duties too: his own next duty, in the coming week. */
export function MyNextDuty() {
  const { api, me } = useAuth();
  const soldier = isSoldier(me);
  const [next, setNext] = useState<MyDuty | null>(null);
  useEffect(() => {
    if (!soldier) return;
    api!
      .myDuties()
      .then((d) => {
        const now = Date.now();
        const n = splitDuties(d, now).upcoming[0];
        setNext(n && Date.parse(n.starts_at) - now < WEEK ? n : null);
      })
      .catch(() => setNext(null));
  }, [api, soldier]);
  if (!next) return null;
  return (
    <Alert
      severity="info"
      action={
        <Button color="inherit" size="small" component={RouterLink} to="/my">
          המשימות שלי
        </Button>
      }
    >
      <b>המשימה הבאה שלך:</b> {next.task_name} · {dayLabel(next.starts_at)} · {spanLabel(next.starts_at, next.ends_at)}
      {next.role === "reserve" ? " · עתודה" : ""}
    </Alert>
  );
}
