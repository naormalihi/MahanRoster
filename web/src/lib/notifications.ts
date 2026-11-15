/** Version 2.0, stage 2.5: notifications in the system and on the phone (Web Push). */

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string;
  requires_ack: boolean;
  read_at: string | null;
  acked_at: string | null;
  created_at: string;
}

/** The VAPID public key (base64url) as the browser wants it. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export const isIos = (ua = navigator.userAgent) => /iPhone|iPad|iPod/.test(ua);
/** Installed to the home screen (iOS pushes only there). */
export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export type PushState = "unsupported" | "install_first" | "denied" | "off" | "on";

export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return "install_first";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

/** Ask, subscribe this device and hand the subscription to save. */
export async function subscribePush(vapidKey: string, save: (s: { endpoint: string; p256dh: string; auth: string }) => Promise<void>) {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("לא אושרו התראות בדפדפן");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
  const j = sub.toJSON();
  await save({ endpoint: sub.endpoint, p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "" });
}

export async function unsubscribePush(remove: (endpoint: string) => Promise<void>) {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await remove(sub.endpoint);
    await sub.unsubscribe();
  }
}

/** "לפני 5 דק׳", "היום 08:30", "12/01" */
export function ago(iso: string, now = Date.now()): string {
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  if (m < 1) return "עכשיו";
  if (m < 60) return `לפני ${m} דק׳`;
  if (m < 24 * 60) return `לפני ${Math.round(m / 60)} שע׳`;
  return iso.slice(5, 10).split("-").reverse().join("/");
}
