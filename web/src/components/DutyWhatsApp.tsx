import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { Button, IconButton, Tooltip } from "@mui/material";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { dutyMessageText } from "../lib/dutyMessage";
import { whatsappUrl } from "../lib/invites";

type Query = { soldierId?: string; assignmentId?: string; cycleId?: string };

/**
 * One press: the server returns his duties (and a fresh join code if he has no account), and
 * WhatsApp opens on his chat with the message ready – or the contact picker without a phone.
 * The tab is opened before the request, so the browser does not block it as a popup.
 */
export function useDutyWhatsApp() {
  const { api } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  async function send(q: Query, key: string): Promise<boolean> {
    const w = window.open("", "_blank");
    setBusy(key);
    try {
      const m = await api!.dutyMessage(q);
      const url = whatsappUrl(dutyMessageText(m, window.location.origin), m.phone);
      if (w) w.location.href = url;
      else window.location.href = url;
      return true;
    } catch (e) {
      w?.close();
      throw e;
    } finally {
      setBusy(null);
    }
  }
  return { send, busy };
}

/** The small green button next to a soldier (a duty row, the slot window). */
export function DutyWhatsAppButton(props: { query: Query; name: string; compact?: boolean; onSent?: () => void; onError?: (m: string) => void }) {
  const { send, busy } = useDutyWhatsApp();
  const key = JSON.stringify(props.query);
  const go = () =>
    void send(props.query, key).then(
      () => props.onSent?.(),
      (e) => props.onError?.((e as Error).message),
    );
  if (props.compact)
    return (
      <Tooltip title="הודעת וואטסאפ על התורנות">
        <span>
          <IconButton size="small" color="success" disabled={busy === key} onClick={go} aria-label={`וואטסאפ ל${props.name}`}>
            <WhatsAppIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    );
  return (
    <Button size="small" color="success" startIcon={<WhatsAppIcon />} disabled={busy === key} onClick={go} sx={{ whiteSpace: "nowrap" }}>
      וואטסאפ
    </Button>
  );
}
