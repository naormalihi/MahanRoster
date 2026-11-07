/**
 * Demo backend: a fictitious unit in memory. Lets the app run, be reviewed and
 * be screenshotted with no Supabase project. Nothing here is real.
 *
 * Users (any password): naat – נע"ת (asks for a 6-digit code, any code works)
 *                       board – the shared view account
 *                       new.user – a viewer who must change the password first
 */

import type { Api, ApplyResult, BoardRow, Me, MfaState, NamedRef, Role } from "../lib/api";
import { israeliHolidays, type CalendarDay, type Population, type ScoringSettings, type TaskType, type TaskTypeInput } from "../lib/catalog";
import {
  absenceSpan,
  addDaysIso,
  localMidnight,
  type Absence,
  type AbsenceInput,
  type Cycle,
  type CycleInput,
  type CycleStatus,
  type DateBlock,
  type DateBlockInput,
  type Exemption,
  type ExemptionDecision,
  type ExemptionInput,
  type ExemptionType,
} from "../lib/cycles";
import type { Alias, RankRef, SlotDraft, SlotRow } from "../lib/baseSchedule";
import type { ScheduleJob } from "../lib/schedule";
import type { DailyAvailability, PotentialCell, SnapshotSoldier } from "../lib/potential";
import type { ExistingSoldier, RosterPlan } from "../lib/roster";
import type { LoadRoleRef, SoldierDetail, SoldierLoadRole, SoldierPatch } from "../lib/soldiers";

type Extra = Omit<SoldierDetail, keyof ExistingSoldier | "gaf_id" | "load_roles"> & { load_roles: SoldierLoadRole[] };
const LOAD_ROLES: LoadRoleRef[] = [{ id: "lr1", name: "ראש צוות", factor: 0.5 }];

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

const CATEGORIES: NamedRef[] = ["הגנ\"ש", "קצין תורן", "מפקד שער", "ממלכ\"ת", "שמירות חובה", "משימות חיליות", "רס\"ר", "מפקד תורן"].map((name, i) => ({ id: `c${i}`, name }));
const POPULATIONS: Population[] = [
  { code: "mandatory", name: "חובה" },
  { code: "career", name: "קבע" },
  { code: "officer", name: "קצינים" },
  { code: "major", name: "רס\"ן ומעלה" },
];
const tt = (code: string, name: string, cat: number, weight: number, o: Partial<TaskTypeInput> = {}): TaskType => ({
  id: `t_${code}`, code, name, category_id: `c${cat}`, weight, min_rest_hours: 0, service_restriction: "any",
  requires_weapon: false, is_weekend_type: false, shachar_compatible: false, qualifying_duty: false,
  eligible_populations: [], rank_min_id: null, rank_max_id: null, gender: null,
  default_start_time: "08:00", default_end_time: "08:00", weekday_hours: null, color: null, is_active: true, ...o,
}) as TaskType;
const DEMO_TASKS: TaskType[] = [
  tt("hagnash", "הגנ\"ש – חול", 0, 1, { eligible_populations: ["officer", "career"], rank_max_id: "r9", requires_weapon: true, color: "#2f7d5b" }),
  tt("katzin_toran", "קצין תורן – חול", 1, 1, { eligible_populations: ["officer"], rank_max_id: "r9", color: "#3b6ea8" }),
  tt("katzin_toran_shabbat", "קצין תורן – שבת", 1, 3, { eligible_populations: ["officer"], rank_max_id: "r9", is_weekend_type: true, color: "#3b6ea8" }),
  tt("mamlachat_yom", "ממלכ\"ת יום – חול", 3, 0.75, { eligible_populations: ["major"], rank_max_id: "r10", qualifying_duty: true, shachar_compatible: true, default_end_time: "17:00", color: "#6a7ab0" }),
  tt("mamlachat_layla", "ממלכ\"ת לילה – חול", 3, 1, { eligible_populations: ["major"], rank_max_id: "r10", min_rest_hours: 12, default_start_time: "20:00", color: "#4a5a8a" }),
  tt("shmirot_chova", "שמירות חובה", 4, 1, { service_restriction: "mandatory", eligible_populations: ["mandatory"], rank_max_id: "r3", requires_weapon: true, min_rest_hours: 24, default_start_time: "13:00", default_end_time: "13:00", color: "#9a6a1f" }),
  tt("mefaked_shaar", "מפקד שער – חול", 2, 1, { eligible_populations: ["career", "officer"], rank_max_id: "r9", requires_weapon: true, color: "#9a6a1f" }),
  tt("mesimot_chayliyot", "משימות חיליות", 5, 1, { eligible_populations: ["officer"], rank_max_id: "r10", requires_weapon: true, min_rest_hours: 24, default_start_time: "10:00", default_end_time: "10:00", color: "#7a3e9d" }),
  tt("rasar", "רס\"ר – חול", 6, 0.75, { service_restriction: "mandatory", eligible_populations: ["mandatory"], rank_max_id: "r3", default_end_time: "17:00", color: "#a04f5e" }),
  tt("mefaked_toran", "מפקד תורן", 7, 1, {
    eligible_populations: ["major"], rank_max_id: "r10", min_rest_hours: 24, color: "#8a3b2e",
    weekday_hours: { "0": "06:00-08:00+1", "1": "08:00-08:00", "2": "08:00-08:00", "3": "08:00-08:00", "4": "08:00-18:00", after_holiday: "06:00-08:00+1" },
  }),
];

const EXEMPTION_TYPES: ExemptionType[] = [
  { id: "e_full", name: "פטור מלא", qualifies_day_only: false, allows_partial_restriction: true },
  { id: "e_part", name: "פטור חלקי", qualifies_day_only: false, allows_partial_restriction: true },
  { id: "e_qual", name: "פטור מזכה – ממלכ\"ת יום בלבד", qualifies_day_only: true, allows_partial_restriction: true },
  { id: "e_med", name: "רפואי", qualifies_day_only: false, allows_partial_restriction: true },
  { id: "e_kaps", name: "קפ\"ס", qualifies_day_only: false, allows_partial_restriction: true },
  { id: "e_shachar", name: "שח\"ר", qualifies_day_only: false, allows_partial_restriction: true },
  { id: "e_bereaved", name: "משפחה שכולה", qualifies_day_only: false, allows_partial_restriction: true },
];
const ABSENCE_TYPES = ["חופשה", "קורס", "יציאה לחו\"ל", "מחלה", "אחר"].map((name, i) => ({ id: `a${i}`, name }));

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
  private extra = new Map<string, Extra>();
  private tasks: TaskType[] = DEMO_TASKS.map((t) => ({ ...t }));
  private scoring: ScoringSettings = { weekend_multiplier: 1.5, holiday_multiplier: 2, night_multiplier: 1.25, night_window: "22:00-06:00", weekend_weekdays: [5, 6] };
  private cycleList: Cycle[] = [
    { id: "c1", name: "יוני–נובמבר 2026", start_date: "2026-06-01", end_date: "2026-11-30", exemption_deadline: null, status: "published", published_at: "2026-05-20T10:00:00Z" },
    { id: "c2", name: "דצמבר 2026 – מאי 2027", start_date: "2026-12-01", end_date: "2027-05-31", exemption_deadline: "2026-10-22T00:00:00+03:00", status: "collecting", published_at: null },
  ];
  private exemptionList: Exemption[] = [];
  private absenceList: Absence[] = [];
  private blockList: DateBlock[] = [];
  private seq = 0;
  private aliasList: Alias[] = [
    ["אמ\"ת גבעת המורה", "t_mesimot_chayliyot"], ["אמ\"ת חרבית", "t_mesimot_chayliyot"], ["שיפוט צד", "t_mesimot_chayliyot"],
    ["רסר הקלת\"ש", "t_rasar"], ["רסר טקס רלצד", "t_rasar"], ["ממלכת יום", "t_mamlachat_yom"],
    ["ש.ג דרום 7-11", "t_mefaked_shaar"], ["צפון 10-13,16-16", "t_mefaked_shaar"],
  ].map(([alias, task_type_id]) => ({ alias, task_type_id }));
  private slotsByCycle = new Map<string, SlotRow[]>();
  private jobs: (ScheduleJob & { cycle_id: string })[] = [];
  private overrides = new Map<string, { value: number; reason: string }>();
  private calendar: CalendarDay[] = israeliHolidays("2026-09-01", "2027-08-31");

  private extraOf(id: string): Extra {
    if (!this.extra.has(id))
      this.extra.set(id, {
        appointment_rank_id: null, appointment_rank_until: null, is_shachar: false, shachar_start_date: null,
        parent_override: null, parent_override_reason: null, parent_override_until: null, second_role_signed_at: null,
        home_nightly_override: null, home_nightly_override_reason: null, home_nightly_override_until: null,
        load_roles: [],
      });
    return this.extra.get(id)!;
  }

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
        home_nightly: i === 8 || i === 21,
        is_active: true,
      });
    }
    this.soldierList[3].range_valid_until = null;
    this.soldierList[5].range_valid_until = "2026-01-01";
    this.extraOf(this.soldierList[0].id).load_roles = [{ load_role_id: "lr1", name: "ראש צוות", factor: 0.5, valid_from: "2026-01-01", valid_to: null }];
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
    for (const a of plan.added) this.soldierList.push({ ...a, home_nightly: !!a.home_nightly, id: `s${n++}`, is_active: true });
    for (const u of plan.updated) {
      const s = this.soldierList.find((x) => x.id === u.id)!;
      for (const [k, v] of Object.entries(u.after)) if (v !== null) (s as unknown as Record<string, unknown>)[k] = v;
      s.is_active = true;
    }
    const gone = new Set(plan.removed.map((s) => s.id));
    for (const s of this.soldierList) if (gone.has(s.id)) s.is_active = false;
    return { added: plan.added.length, updated: plan.updated.length, deactivated: plan.removed.length, gafimCreated: plan.unknownGafim.length };
  }

  async soldierDetails(): Promise<SoldierDetail[]> {
    await delay();
    return this.soldierList
      .map((s) => ({
        ...s,
        gaf_id: this.gafList.find((g) => g.name === s.gaf_name)?.id ?? "",
        home_nightly: !!s.home_nightly,
        ...this.extraOf(s.id),
      }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "he"));
  }

  async updateSoldiers(ids: string[], patch: SoldierPatch) {
    await delay();
    for (const id of ids) {
      const s = this.soldierList.find((x) => x.id === id)!;
      const e = this.extraOf(id);
      for (const [k, v] of Object.entries(patch)) {
        if (k in s) (s as unknown as Record<string, unknown>)[k] = v;
        else (e as unknown as Record<string, unknown>)[k] = v;
      }
    }
  }

  async loadRoles() {
    return LOAD_ROLES;
  }

  async setSoldierLoadRoles(soldierId: string, roles: Omit<SoldierLoadRole, "name" | "factor">[]) {
    await delay();
    this.extraOf(soldierId).load_roles = roles.map((r) => {
      const lr = LOAD_ROLES.find((x) => x.id === r.load_role_id)!;
      return { ...r, name: lr.name, factor: lr.factor };
    });
  }

  async taskTypes() {
    await delay();
    return this.tasks.map((t) => ({ ...t })).sort((a, b) => a.name.localeCompare(b.name, "he"));
  }

  async saveTaskType(id: string | null, t: TaskTypeInput) {
    await delay();
    if (id) Object.assign(this.tasks.find((x) => x.id === id)!, t);
    else this.tasks.push({ ...t, id: `t_${t.code}` });
  }

  async dutyCategories() {
    return CATEGORIES;
  }

  async populations() {
    return POPULATIONS;
  }

  async scoringSettings() {
    await delay();
    return { ...this.scoring, weekend_weekdays: [...this.scoring.weekend_weekdays] };
  }

  async saveScoringSettings(s: ScoringSettings) {
    await delay();
    this.scoring = { ...s };
  }

  async calendarDays(fromIso: string, toIso: string) {
    await delay();
    return this.calendar.filter((d) => d.day >= fromIso && d.day <= toIso).map((d) => ({ ...d }));
  }

  async saveCalendarDays(days: CalendarDay[]) {
    await delay();
    for (const d of days) {
      this.calendar = this.calendar.filter((x) => x.day !== d.day);
      this.calendar.push({ ...d });
    }
    this.calendar.sort((a, b) => a.day.localeCompare(b.day));
  }

  async deleteCalendarDay(day: string) {
    await delay();
    this.calendar = this.calendar.filter((x) => x.day !== day);
  }

  private nextId(p: string) {
    return `${p}${++this.seq}`;
  }

  /** A few pending constraints for the demo, once soldiers exist. */
  private seedConstraints() {
    if (this.exemptionList.length || this.soldierList.length < 6) return;
    const s = this.soldierList;
    const ex = (i: number, type: string, from: string, to: string, status: Exemption["status"], proof: boolean): Exemption => ({
      id: this.nextId("x"), soldier_id: s[i].id, exemption_type_id: type, kind: "full", start_date: from, end_date: to,
      excluded_task_type_ids: null, restricted_hours: null, is_urgent: false, status, source: "coordinator",
      proof_checked_at: proof ? "2026-11-01T09:00:00Z" : null, decided_at: status === "pending" ? null : "2026-11-02T09:00:00Z",
      decision_reason: null, received_via: "in_person", received_at: "2026-11-01T09:00:00Z",
    });
    this.exemptionList.push(ex(0, "e_med", "2026-12-01", "2027-02-28", "pending", false), ex(1, "e_kaps", "2026-12-01", "2027-05-31", "pending", true), ex(2, "e_bereaved", "2026-12-01", "2027-05-31", "approved", true));
    this.absenceList.push({ id: this.nextId("ab"), soldier_id: s[3].id, absence_type_id: "a1", ...absenceSpan({ from: "2027-01-10", to: "2027-02-20" }), status: "active", cancel_reason: null, received_via: "excel" });
    this.blockList.push({ id: this.nextId("b"), soldier_id: s[4].id, cycle_id: "c2", day: "2026-12-24", status: "active", received_via: "excel" });
  }

  async cycles() {
    await delay();
    return this.cycleList.map((c) => ({ ...c })).sort((a, b) => b.start_date.localeCompare(a.start_date));
  }

  async saveCycle(id: string | null, c: CycleInput) {
    await delay();
    if (id) Object.assign(this.cycleList.find((x) => x.id === id)!, c);
    else this.cycleList.push({ ...c, id: this.nextId("c"), status: "draft", published_at: null });
  }

  async setCycleStatus(id: string, status: CycleStatus) {
    await delay();
    this.cycleList.find((x) => x.id === id)!.status = status;
  }

  async exemptionTypes() {
    return EXEMPTION_TYPES;
  }

  async absenceTypes() {
    return ABSENCE_TYPES;
  }

  async blockQuota() {
    return 1;
  }

  async exemptions(fromIso: string, toIso: string) {
    await delay();
    this.seedConstraints();
    return this.exemptionList.filter((e) => e.start_date <= toIso && e.end_date >= fromIso).map((e) => ({ ...e }));
  }

  async addExemption(e: ExemptionInput) {
    await delay();
    this.exemptionList.push({
      ...e, id: this.nextId("x"), status: "pending", source: "coordinator", proof_checked_at: null, decided_at: null,
      decision_reason: null, received_at: new Date().toISOString(),
    });
  }

  async markProofChecked(id: string) {
    await delay();
    this.exemptionList.find((x) => x.id === id)!.proof_checked_at = new Date().toISOString();
  }

  async decideExemption(id: string, d: ExemptionDecision) {
    await delay();
    const e = this.exemptionList.find((x) => x.id === id)!;
    if (d.action === "approve" && !e.proof_checked_at) throw new Error("לא ניתן לאשר לפני סימון \"אסמכתא נבדקה\"");
    e.status = d.action === "approve" ? "approved" : d.action === "reject" ? "rejected" : "cancelled";
    e.decision_reason = d.action === "approve" ? null : d.reason;
    e.decided_at = new Date().toISOString();
  }

  async absences(fromIso: string, toIso: string) {
    await delay();
    this.seedConstraints();
    const lo = localMidnight(fromIso), hi = localMidnight(addDaysIso(toIso, 1));
    return this.absenceList.filter((a) => Date.parse(a.starts_at) < Date.parse(hi) && Date.parse(a.ends_at) > Date.parse(lo)).map((a) => ({ ...a }));
  }

  async addAbsences(rows: AbsenceInput[]) {
    await delay();
    for (const a of rows)
      this.absenceList.push({ id: this.nextId("ab"), soldier_id: a.soldier_id, absence_type_id: a.absence_type_id, ...absenceSpan(a), status: "active", cancel_reason: null, received_via: a.received_via });
  }

  async cancelAbsence(id: string, reason: string) {
    await delay();
    Object.assign(this.absenceList.find((x) => x.id === id)!, { status: "cancelled", cancel_reason: reason });
  }

  async dateBlocks(fromIso: string, toIso: string) {
    await delay();
    this.seedConstraints();
    return this.blockList.filter((b) => b.day >= fromIso && b.day <= toIso).map((b) => ({ ...b }));
  }

  async addDateBlocks(rows: DateBlockInput[], cycleId: string | null) {
    await delay();
    for (const b of rows) {
      if (this.blockList.some((x) => x.status === "active" && x.soldier_id === b.soldier_id && x.day.slice(0, 7) === b.day.slice(0, 7)))
        throw new Error("לחייל כבר יש חסימה בחודש הזה");
      this.blockList.push({ ...b, id: this.nextId("b"), cycle_id: cycleId, status: "active" });
    }
  }

  async cancelDateBlock(id: string) {
    await delay();
    this.blockList.find((x) => x.id === id)!.status = "cancelled";
  }

  // ----- potential (rough demo rules by rank; the real one is computed in the database) -----

  private demoCells(cycleId: string): PotentialCell[] {
    const c = this.cycleList.find((x) => x.id === cycleId)!;
    const total = Math.round((Date.parse(c.end_date) - Date.parse(c.start_date)) / 86_400_000) + 1;
    const rankIdx = (n: string) => RANKS.indexOf(n);
    const out: PotentialCell[] = [];
    this.soldierList.filter((s) => s.is_active).forEach((s, i) => {
      const r = rankIdx(s.rank_name);
      const absent = i % 9 === 3 ? 0.67 : i % 13 === 5 ? 0.5 : 1;
      const rules: Record<string, boolean> = {
        c0: r >= 4 && r <= 9 && s.service_type === "career", // הגנ"ש
        c1: r >= 7 && r <= 9, // קצין תורן
        c2: r >= 4 && r <= 9, // מפקד שער
        c3: r === 10, // ממלכ"ת
        c4: r <= 3 && s.service_type === "mandatory", // שמירות חובה
        c5: r >= 7 && r <= 10, // משימות חיליות
        c6: r <= 3 && s.service_type === "mandatory", // רס"ר
        c7: r === 10, // מפקד תורן
      };
      for (const cat of CATEGORIES) {
        const ok = rules[cat.id];
        const o = this.overrides.get(`${cycleId}|${s.id}|${cat.id}`);
        out.push({
          soldier_id: s.id, category_id: cat.id, value: ok ? absent : 0, best_task_type_id: "t",
          reasons: ok ? [] : [r > 10 ? "rank" : "population"], available_days: Math.round(total * absent), cycle_days: total,
          override_value: o?.value ?? null, override_reason: o?.reason ?? null,
        });
      }
    });
    return out;
  }

  async computePotential(cycleId: string) {
    await delay(500);
    this.cycleList.find((x) => x.id === cycleId)!.potential_computed_at = new Date().toISOString();
    return this.soldierList.filter((s) => s.is_active).length;
  }

  async potentialMatrix(cycleId: string) {
    await delay(300);
    return this.demoCells(cycleId);
  }

  async potentialDaily(cycleId: string): Promise<DailyAvailability[]> {
    await delay(200);
    const c = this.cycleList.find((x) => x.id === cycleId)!;
    const cells = this.demoCells(cycleId);
    const out: DailyAvailability[] = [];
    for (let d = c.start_date, k = 0; d <= c.end_date; d = addDaysIso(d, 1), k++)
      for (const cat of CATEGORIES) {
        const base = cells.filter((x) => x.category_id === cat.id && x.value > 0).length;
        out.push({ day: d, category_id: cat.id, available: Math.max(0, base - ((k * 7 + cat.id.length) % 5) - (k > 20 && k < 34 ? 3 : 0)) });
      }
    return out;
  }

  async snapshotSoldiers(cycleId: string): Promise<SnapshotSoldier[]> {
    void cycleId;
    return this.soldierList.filter((s) => s.is_active).map((s) => ({
      soldier_id: s.id, rank_name: s.rank_name, service_type: s.service_type, is_parent: s.parent_status, qualifies_day_only: s.parent_status,
    }));
  }

  async setPotentialOverride(cycleId: string, soldierId: string, categoryId: string, value: number, reason: string) {
    await delay();
    this.overrides.set(`${cycleId}|${soldierId}|${categoryId}`, { value, reason });
  }

  async clearPotentialOverride(cycleId: string, soldierId: string, categoryId: string) {
    await delay();
    this.overrides.delete(`${cycleId}|${soldierId}|${categoryId}`);
  }

  // ----- base schedule -----

  async rankRefs(): Promise<RankRef[]> {
    return this.rankList.map((r, i) => ({ ...r, sort_order: r.name === "קמ\"א" ? i : i + 1 }));
  }

  async taskTypeAliases() {
    return this.aliasList.map((a) => ({ ...a }));
  }

  async saveTaskTypeAliases(aliases: Alias[]) {
    await delay();
    for (const a of aliases) {
      this.aliasList = this.aliasList.filter((x) => x.alias !== a.alias);
      this.aliasList.push({ ...a });
    }
  }

  async deleteTaskTypeAlias(alias: string) {
    this.aliasList = this.aliasList.filter((a) => a.alias !== alias);
  }

  async cycleSlots(cycleId: string) {
    await delay();
    return (this.slotsByCycle.get(cycleId) ?? []).map((s) => ({ ...s }));
  }

  async importSlots(cycleId: string, slots: SlotDraft[], replace: boolean) {
    await delay(400);
    const cur = this.slotsByCycle.get(cycleId) ?? [];
    const kept = replace ? cur.filter((s) => s.assigned > 0) : cur;
    const added: SlotRow[] = slots.map((d) => ({
      id: this.nextId("sl"), task_type_id: d.task_type_id, starts_at: d.starts_at, ends_at: d.ends_at,
      performers_needed: d.performers_needed, reserves_needed: d.reserves_needed, allowed_rank_ids: d.allowed_rank_ids,
      gender: d.gender, instructions: d.instructions, notes: d.notes, source_line: d.line, prefer_home_nightly: d.prefer_home_nightly, daily_hours: d.daily_hours, briefing_at: d.briefing_at, assigned: 0,
    }));
    this.slotsByCycle.set(cycleId, [...kept, ...added].sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
    return { inserted: added.length, deleted: cur.length - kept.length };
  }

  async deleteSlots(ids: string[]) {
    await delay();
    for (const [k, v] of this.slotsByCycle) this.slotsByCycle.set(k, v.filter((s) => !ids.includes(s.id)));
  }

  // ----- scheduling runs (simulated: waits 4 s, runs 12 s) -----

  private tick(j: ScheduleJob & { cycle_id: string }) {
    if (j.status === "failed" || j.status === "done") return;
    const age = (Date.now() - Date.parse(j.created_at)) / 1000;
    if (age < 4) return;
    if (j.status === "queued") Object.assign(j, { status: "running", started_at: new Date().toISOString(), params: { ...j.params, run_url: "https://github.com/" } });
    j.progress = Math.min(95, Math.round(5 + ((age - 4) / 12) * 90));
    if (age < 16) return;
    const slots = this.slotsByCycle.get(j.cycle_id) ?? [];
    Object.assign(j, {
      status: "done",
      progress: 100,
      finished_at: new Date().toISOString(),
      result_status: "FEASIBLE",
      wall_time: 12.4,
      unfilled: slots.slice(0, 1).map((s) => ({ slot_id: s.id, role: "reserve", missing: 1, eligible_count: 1, reasons: { rank: 31, population: 18, busy: 4, absence: 2 } })),
      warnings: [],
      pools: [
        { population: "mandatory", soldiers: 40, mean_before: 6.2, mean_after: 9.8, min_after: 8.5, max_after: 11, stdev_after: 0.6, max_weekends: 3, max_reserves: 4 },
        { population: "career", soldiers: 20, mean_before: 5.1, mean_after: 7.9, min_after: 6.8, max_after: 9.1, stdev_after: 0.7, max_weekends: 2, max_reserves: 3 },
      ],
    });
    const c = this.cycleList.find((x) => x.id === j.cycle_id);
    if (c && c.status === "scheduling") c.status = "review";
  }

  async scheduleJobs(cycleId: string) {
    await delay();
    const mine = this.jobs.filter((j) => j.cycle_id === cycleId);
    mine.forEach((j) => this.tick(j));
    return mine.map(({ cycle_id: _c, ...j }) => ({ ...j })).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async requestSchedule(cycleId: string) {
    await delay(300);
    if (this.jobs.some((j) => j.cycle_id === cycleId && (j.status === "queued" || j.status === "running")))
      throw new Error("a scheduling run is already in progress for this cycle");
    const id = this.nextId("job");
    this.jobs.push({
      id, cycle_id: cycleId, status: "queued", kind: "full", progress: 0, created_at: new Date().toISOString(), started_at: null,
      finished_at: null, error: null, params: { dispatch: "sent" }, result_status: null, wall_time: null, unfilled: null, warnings: null, pools: null,
    });
    const c = this.cycleList.find((x) => x.id === cycleId);
    if (c && ["slots", "potential", "review", "scheduling"].includes(c.status)) c.status = "scheduling";
    return id;
  }

  async redispatchSchedule() {
    return "sent";
  }

  async cancelScheduleJob(jobId: string) {
    const j = this.jobs.find((x) => x.id === jobId);
    if (j && (j.status === "queued" || j.status === "running")) Object.assign(j, { status: "failed", error: "בוטל על ידי נע\"ת", finished_at: new Date().toISOString() });
  }

  async dispatchConfigured() {
    return true;
  }

  async dispatchResponse() {
    return { status_code: 204, error: null, body: "" };
  }
}
