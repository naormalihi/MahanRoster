import PhoneIcon from "@mui/icons-material/PhoneOutlined";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { telHref, waHref, type MyContact } from "../lib/contacts";
import { formatPhone } from "../lib/phone";

/** The contacts, one row each: name, role, WhatsApp and call. Nothing when none was chosen. */
export function ContactRows({ rows }: { rows: MyContact[] }) {
  return (
    <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
      {rows.map((c, i) => (
        <Stack key={i} direction="row" spacing={1} sx={{ alignItems: "center", py: 0.75 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600 }}>{c.display_name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {c.role_label}
              {c.phone ? (
                <>
                  {" · "}
                  <span dir="ltr">{formatPhone(c.phone)}</span>
                </>
              ) : null}
            </Typography>
          </Box>
          {c.phone && (
            <>
              <Tooltip title="וואטסאפ">
                <IconButton color="success" component="a" href={waHref(c.phone)} target="_blank" rel="noopener" aria-label={`וואטסאפ ל${c.display_name}`}>
                  <WhatsAppIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="חיוג">
                <IconButton color="primary" component="a" href={telHref(c.phone)} aria-label={`חיוג ל${c.display_name}`}>
                  <PhoneIcon />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Stack>
      ))}
    </Stack>
  );
}

export function useMyContacts() {
  const { api } = useAuth();
  const [rows, setRows] = useState<MyContact[] | null>(null);
  useEffect(() => {
    api!.myContacts().then(setRows, () => setRows([]));
  }, [api]);
  return rows;
}

/** "למי לפנות" – at the bottom of my duties, in my requests when the deadline passed. */
export function ContactCard({ title = "למי לפנות", note }: { title?: string; note?: string }) {
  const rows = useMyContacts();
  if (!rows?.length) return null;
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Typography variant="h3" sx={{ mb: note ? 0.25 : 0.5 }}>
        {title}
      </Typography>
      {note && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          {note}
        </Typography>
      )}
      <ContactRows rows={rows} />
    </Paper>
  );
}

/** From the menu: the same contacts in a window. */
export function ContactsDialog({ onClose }: { onClose: () => void }) {
  const rows = useMyContacts();
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>למי לפנות</DialogTitle>
      <DialogContent dividers>
        {rows === null ? null : rows.length ? (
          <ContactRows rows={rows} />
        ) : (
          <Typography color="text.secondary">עוד לא הוגדרו אנשי קשר. אפשר לפנות לנע&quot;ת התורנויות דרך המפקד.</Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>סגירה</Button>
      </DialogActions>
    </Dialog>
  );
}
