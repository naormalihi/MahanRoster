/** "הצעה לשיפור": what a user sends, and how נע"ת, מ"מ and the unit commander see and close it. */

export type FeedbackKind = "idea" | "bug" | "note";
export type FeedbackStatus = "new" | "in_progress" | "done" | "wont";

export const KIND_LABEL: Record<FeedbackKind, string> = { idea: "הצעה לשיפור", bug: "משהו לא עובד", note: "הערה" };
export const STATUS_LABEL: Record<FeedbackStatus, string> = { new: "חדש", in_progress: "בטיפול", done: "בוצע", wont: "לא ייעשה" };
export const STATUS_COLOR: Record<FeedbackStatus, "info" | "warning" | "success" | "default"> = {
  new: "info",
  in_progress: "warning",
  done: "success",
  wont: "default",
};

export const MAX_BODY = 1000;
export const MAX_REPLY = 300;

export interface FeedbackItem {
  id: string;
  created_at: string;
  kind: FeedbackKind;
  body: string;
  sender_name: string | null;
  anonymous: boolean;
  screen: string | null;
  app_version: string | null;
  device: "phone" | "desktop" | null;
  status: FeedbackStatus;
  note: string | null;
  reply: string | null;
  handled_by_name: string | null;
  handled_at: string | null;
}

export interface FeedbackDraft {
  kind: FeedbackKind;
  body: string;
  anonymous: boolean;
  screen: string;
  version: string;
  device: "phone" | "desktop";
}

/** what stops sending (null = fine) */
export function draftProblem(d: Pick<FeedbackDraft, "body">): string | null {
  const t = d.body.trim();
  if (!t) return "כתוב מה תרצה לומר";
  if (t.length > MAX_BODY) return `עד ${MAX_BODY.toLocaleString("he-IL")} תווים`;
  return null;
}

export const deviceOf = (width: number, coarse: boolean): "phone" | "desktop" => (width < 900 || coarse ? "phone" : "desktop");

/** "/my" → "התורנויות שלי" – the screen as people call it; unknown paths as they are */
const SCREENS: Record<string, string> = {
  "/": "דף הבית",
  "/my": "התורנויות שלי",
  "/requests": "הבקשות שלי",
  "/board": "לוח התורנויות",
  "/soldiers": "כוח אדם",
  "/admin": "הגדרות",
  "/scoring": "איך מחושב הניקוד",
  "/dashboard": "תמונת יחידה",
};
export function screenLabel(path: string | null): string {
  if (!path) return "";
  if (SCREENS[path]) return SCREENS[path];
  if (path.startsWith("/cycle")) return "מחזור";
  return path;
}

/** counts by status, for the filter chips */
export function countByStatus(items: FeedbackItem[]): Record<FeedbackStatus, number> {
  const out: Record<FeedbackStatus, number> = { new: 0, in_progress: 0, done: 0, wont: 0 };
  for (const i of items) out[i.status]++;
  return out;
}

/** "2 חדשות · 1 בטיפול" */
export function openLabel(fresh: number, inProgress: number): string {
  const parts = [];
  if (fresh) parts.push(fresh === 1 ? "חדשה אחת" : `${fresh} חדשות`);
  if (inProgress) parts.push(`${inProgress} בטיפול`);
  return parts.join(" · ");
}
