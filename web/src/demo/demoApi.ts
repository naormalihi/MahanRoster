/**
 * Demo backend: a fictitious unit in memory. Lets the app run, be reviewed and
 * be screenshotted with no Supabase project. Nothing here is real.
 *
 * Users (any password): naat – נע"ת (asks for a 6-digit code, any code works)
 *                       board – the shared view account
 *                       new.user – a viewer who must change the password first
 */

import type { Api, ApplyResult, BoardRow, Me, MfaState, NamedRef, Role } from "../lib/api";
import type { ExistingSoldier, RosterPlan } from "../lib/roster";

const GAFIM = ["גף מבצעים", "גף טכני", "גף מודיעין", "גף לוגיסטיקה"];
const RANKS = ["טוראי", "רב\"ט", "סמל", "סמ\"ר", "רס\"ל", "רס\"ר", "רס\"מ", "סגן", "קמ\"א", "סרן", "רס\"ן", "סא\"ל"];
const FIRST = ["נועה", "איתי", "מאיה", "יונתן", "שירה", "עומר", "תמר", "אורי", "הילה", "דניאל", "רוני", "אלון", "ליה", "גיא", "עדי", "נדב"];
const LAST = ["כהן", "לוי", "מזרחי", "פרץ", "ביטון", "אברהם", "פרידמן", "שושן", "אזולאי", "דהן", "חדד", "גבאי"];

const TASKS: { name: string; category: string; color: string; start: number; hours: number; perf: number; res: number; days: number[] }[] = [
  { name: "ש\"ג – חול", category: "שמירה", color: "#3b6ea8", start: 8, hours: 24, perf: 2, res: 2, days: [0, 1, 2, 3, 4] },
  { name: "מגדלים", category: "שמירה", color: "#5a4fa0", start: 20, hours: 12, perf: 2, res: 2, days: [0, 1, 2, 3, 4] },
  { name: "קצין תורן – חול", category: "קצין תורן", color: "#2f7d5b", start: 8, hours: 24, perf: 1, res: 1, days: [0, 1, 2, 3, 4] },
  { name: "מפקד שער", category: "מפקד שער", color: "#9a6a1f", start: 8, hours: 24, perf: 1, res: 1, days: [0, 1, 2, 3, 4] },
  { name: "ש\"ג – שבת", category: "שמירה", color: "#3b6ea8", start: 8, hours: 48, perf: 2, res: 2, days: [5] },
  { name: "קצין תורן – שבת", category: "קצין תורן", color: "#2f7d5b", start: 8, hours: 48, perf: 1, res: 1, days: [5] },
  { name: "מטבח – שבת", category: "משימות", color: "#a04f5e", start: 12, hours: 44, perf: 2, res: 1, days: [5] },
];

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const iso = (d: Date) => d.toISOString().slice(0, 10);

export class DemoApi implements Api {
  readonly demo = true;
  private user: { name: string; roles: Role[]; mustChange: boolean; aal2: boolean } | null = null;
  private soldierList: ExistingSoldier[] = [];
  private gafList: NamedRef[] = GAFIM.map((name, i) => ({ id: `g${i}`, name }));
  private rankList: NamedRef[] = RANKS.map((name, i) => ({ id: `r${i}`, name }));
  private keyCheck: string | null = null;
  private boardRows: BoardRow[] = [];

  constructor() {
    const rand = rng(7);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    for (let i = 0; i < 60; i++) {
      const career = i % 3 === 0;
      this.soldierList.push({
        id: `s${i}`,
        soldier_key: `demo${String(i).padStart(60, "0")}`,
        full_name: `${pick(FIRST)} ${pick(LAST)}`,
        service_type: career ? "career" : "mandatory",
        gaf_name: pick(GAFIM),
        rank_name: career ? pick(RANKS.slice(4)) : pick(RANKS.slice(0, 4)),
        gender: rand() < 0.6 ? "male" : "female",
        enlistment_date: "2025-03-01",
        release_date: career ? null : "2027-09-01",
        career_start_date: career ? "2022-08-01" : null,
        range_valid_until: "2027-06-30",
        parent_status: false,
        is_active: true,
      });
    }
    // Published board: three weeks from the most recent Sunday.
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    const mand = this.soldierList.filter((s) => s.service_type === "mandatory");
    const car = this.soldierList.filter((s) => s.service_type === "career");
    for (let d = 0; d < 21; d++) {
      const day = new Date(start);
      day.setDate(start.getDate() + d);
      for (const t of TASKS) {
        if (!t.days.includes(day.getDay())) continue;
        const s = new Date(day);
        s.setHours(t.start, 0, 0, 0);
        const e = new Date(s.getTime() + t.hours * 3600_000);
        const pool = t.category === "שמירה" || t.category === "משימות" ? mand : car;
        const people = Array.from({ length: t.perf + t.res }, () => pick(pool));
        this.boardRows.push({
          slot_id: `${t.name}-${iso(day)}`,
          starts_at: s.toISOString(),
          ends_at: e.toISOString(),
          task_name: t.name,
          category_name: t.category,
          color: t.color,
          performers: people.slice(0, t.perf).map((p) => p.full_name),
          reserves: people.slice(t.perf).map((p) => p.full_name),
          gafim: [...new Set(people.slice(0, t.perf).map((p) => p.gaf_name))],
          report_at: new Date(s.getTime() - 30 * 60_000).toISOString(),
          report_place: t.category === "שמירה" ? "שער ראשי" : "חדר מבצעים",
          briefing_at: null,
          briefing_place: null,
          updated_at: s.toISOString(),
          changed_after_publish: rand() < 0.04,
        });
      }
    }
  }

  async signIn(username: string, password: string) {
    await delay();
    if (!password) throw new Error("שם משתמש או סיסמה שגויים");
    const u = username.trim().toLowerCase();
    if (u === "naat") this.user = { name: u, roles: ["coordinator"], mustChange: false, aal2: false };
    else if (u === "board") this.user = { name: u, roles: ["viewer"], mustChange: false, aal2: true };
    else if (u === "new.user") this.user = { name: u, roles: ["viewer"], mustChange: true, aal2: true };
    else throw new Error("שם משתמש או סיסמה שגויים");
  }

  async signOut() {
    this.user = null;
  }

  async me(): Promise<Me | null> {
    if (!this.user) return null;
    return { userId: this.user.name, username: this.user.name, roles: this.user.roles, mustChangePassword: this.user.mustChange };
  }

  async mfaState(): Promise<MfaState> {
    if (!this.user || this.user.aal2) return { needsVerify: false, needsEnroll: false };
    return { needsVerify: true, needsEnroll: false, factorId: "demo-factor" };
  }

  async mfaEnroll() {
    return { factorId: "demo-factor", qrSvg: "", secret: "DEMODEMODEMODEMO" };
  }

  async mfaVerify(_factorId: string, code: string) {
    await delay();
    if (!/^\d{6}$/.test(code)) throw new Error("הקוד שגוי או שפג תוקפו");
    if (this.user) this.user.aal2 = true;
  }

  async changePassword() {
    await delay();
    if (this.user) this.user.mustChange = false;
  }

  async board(fromIso: string, toIso: string) {
    await delay();
    return this.boardRows.filter((r) => r.starts_at >= fromIso && r.starts_at < toIso);
  }

  async soldiers() {
    await delay();
    return this.soldierList.map((s) => ({ ...s }));
  }

  async gafim() {
    return this.gafList;
  }

  async ranks() {
    return this.rankList;
  }

  async unitKeyCheck() {
    return this.keyCheck;
  }

  async setUnitKeyCheck(v: string) {
    this.keyCheck = v;
  }

  async applyRoster(plan: RosterPlan): Promise<ApplyResult> {
    await delay(400);
    for (const g of plan.unknownGafim) this.gafList.push({ id: `g${this.gafList.length}`, name: g });
    let n = this.soldierList.length;
    for (const a of plan.added) this.soldierList.push({ ...a, id: `s${n++}`, is_active: true });
    for (const u of plan.updated) {
      const s = this.soldierList.find((x) => x.id === u.id)!;
      for (const [k, v] of Object.entries(u.after)) if (v !== null) (s as unknown as Record<string, unknown>)[k] = v;
      s.is_active = true;
    }
    const gone = new Set(plan.removed.map((s) => s.id));
    for (const s of this.soldierList) if (gone.has(s.id)) s.is_active = false;
    return { added: plan.added.length, updated: plan.updated.length, deactivated: plan.removed.length, gafimCreated: plan.unknownGafim.length };
  }
}
