/**
 * Demo backend: a fictitious unit in memory. Lets the app run, be reviewed and
 * be screenshotted with no Supabase project. Nothing here is real.
 *
 * Users (any password): naat – נע"ת (asks for a 6-digit code, any code works)
 *                       board – the shared view account
 *                       new.user – a viewer who must change the password first
 */

import type { MyDuty } from "../lib/me";
import type { MySwap, SwapLogRow, SwapOptions } from "../lib/swaps";
import type { Api, ApplyResult, BoardRow, Me, MfaState, NamedRef, Role, SlotPeople, SlotPerson } from "../lib/api";
import { DAY_TYPE_LABEL, HOLIDAY_KIND_NAME, HOLIDAY_NAME, israeliHolidays, type HolidayKey, type HolidayKind, type CalendarDay, type DayTypeRef, type Population, type ScoreMultiplier, type ScoreMultiplierInput, type ScoringSettings, type TaskType, type TaskTypeInput } from "../lib/catalog";
import {
  absenceSpan,
  addDaysIso,
  localMidnight,
  type Absence,
  type AbsenceInput,
  type Cycle,
  type CycleInput,
  type DateBlock,
  type DateBlockInput,
  type Exemption,
  type ExemptionDecision,
  type ExemptionInput,
  type ExemptionType,
  autoStatus,
  stageStates,
  type StageFacts,
} from "../lib/cycles";
import { dayKey } from "../lib/dates";
import type { Alias, NewSlot, RankRef, SlotDraft, SlotRow } from "../lib/baseSchedule";
import type { AppUser, CreatableRole } from "../lib/users";
import type { AppNotification } from "../lib/notifications";
import type { UnitDashboard } from "../lib/dashboard";
import type { Candidate, DraftAssignment, Role as DraftRole } from "../lib/draft";
import type { ScheduleJob } from "../lib/schedule";
import type { DailyAvailability, PotentialCell, SnapshotSoldier } from "../lib/potential";
import type { ExistingSoldier, RosterPlan } from "../lib/roster";
import type { LoadRoleRef, SoldierDetail, SoldierLoadRole, SoldierPatch } from "../lib/soldiers";

type Extra = Omit<SoldierDetail, keyof ExistingSoldier | "gaf_id" | "load_roles"> & { load_roles: SoldierLoadRole[] };
const LOAD_ROLES: LoadRoleRef[] = [
  { id: "lr1", name: "ראש צוות", factor: 0.5 },
  { id: "lr2", name: "כונן מבצעי", factor: 0.7 },
];

const GAFIM = ["גף מבצעים", "גף טכני", "גף מודיעין", "גף לוגיסטיקה"];
const RANKS = ["טוראי", "רב\"ט", "סמל", "סמ\"ר", "רס\"ל", "רס\"ר", "רס\"מ", "סגן", "קמ\"א", "סרן", "רס\"ן", "סא\"ל"];
const FIRST = ["נועה", "איתי", "מאיה", "יונתן", "שירה", "עומר", "תמר", "אורי", "הילה", "דניאל", "רוני", "אלון", "ליה", "גיא", "עדי", "נדב"];
const LAST = ["כהן", "לוי", "מזרחי", "פרץ", "ביטון", "אברהם", "פרידמן", "שושן", "אזולאי", "דהן", "חדד", "גבאי"];

const TASKS: { name: string; category: string; color: string; start: number; hours: number; perf: number; res: number; days: number[] }[] = [
  { name: "שמירות חובה", category: "שמירה", color: "#3b6ea8", start: 8, hours: 24, perf: 2, res: 2, days: [0, 1, 2, 3, 4] },
  { name: "ממלכת יום", category: "שמירה", color: "#5a4fa0", start: 8, hours: 9, perf: 2, res: 2, days: [0, 1, 2, 3, 4] },
  { name: "קצין תורן", category: "קצין תורן", color: "#2f7d5b", start: 8, hours: 24, perf: 1, res: 1, days: [0, 1, 2, 3, 4] },
  { name: "מפקד שער | ש.ג קבע", category: "מפקד שער", color: "#9a6a1f", start: 8, hours: 24, perf: 1, res: 1, days: [0, 1, 2, 3, 4] },
  { name: "שמירות חובה", category: "שמירה", color: "#3b6ea8", start: 8, hours: 48, perf: 2, res: 2, days: [5] },
  { name: "קצין הגנ\"ק", category: "קצין תורן", color: "#2f7d5b", start: 8, hours: 48, perf: 1, res: 1, days: [5] },
  { name: "מטבח", category: "משימות", color: "#a04f5e", start: 12, hours: 44, perf: 2, res: 1, days: [5] },
];

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

const CATEGORIES: NamedRef[] = ["הגנ\"ש", "קצין תורן", "מפקד שער", "ממלכת", "שמירות חובה", "משימות חיליות", "רס\"ר", "מפקד תורן", "מטבח"].map((name, i) => ({ id: `c${i}`, name }));
const POPULATIONS: Population[] = [
  { code: "mandatory", name: "חובה" },
  { code: "career", name: "קבע" },
  { code: "officer", name: "קצינים" },
  { code: "major", name: "רס\"ן ומעלה" },
];
const tt = (code: string, name: string, cat: number, weight: number, o: Partial<TaskTypeInput> = {}): TaskType => ({
  id: `t_${code}`, code, name, category_id: `c${cat}`, weight, min_rest_hours: 0, service_restriction: "any",
  requires_weapon: false, is_weekend_type: false, includes_holidays: false, shachar_compatible: false, shachar_only: false, tash_rule: "auto", qualifying_duty: false,
  allowed_rank_ids: null, gender: null,
  default_start_time: "08:00", default_end_time: "08:00", weekday_hours: null, color: null, is_active: true, ...o,
}) as TaskType;
// the unit's duty catalog (names, weights and what a weight covers) – a catalog, not personal data
const DEMO_TASKS: TaskType[] = [
  tt("hagnash", "הגנ\"ש", 0, 9, { includes_holidays: true, is_weekend_type: true, allowed_rank_ids: ["r4", "r5", "r6", "r7", "r8", "r9"], requires_weapon: true, color: "#2f7d5b" }),
  tt("katzin_toran", "קצין תורן", 1, 1, { allowed_rank_ids: ["r7", "r8", "r9"], color: "#3b6ea8" }),
  tt("katzin_toran_shabbat", "קצין הגנ\"ק", 1, 2.6, { allowed_rank_ids: ["r7", "r8", "r9"], is_weekend_type: true, color: "#3b6ea8" }),
  tt("mamlachat_yom", "ממלכת יום", 3, 1, { qualifying_duty: true, shachar_compatible: true, default_end_time: "17:00", color: "#6a7ab0" }),
  tt("shmirot_chova", "שמירות חובה", 4, 1, { service_restriction: "mandatory", allowed_rank_ids: ["r0", "r1", "r2", "r3"], requires_weapon: true, min_rest_hours: 24, default_start_time: "13:00", default_end_time: "13:00", color: "#9a6a1f" }),
  tt("mefaked_shaar", "מפקד שער | ש.ג קבע", 2, 2.6, { allowed_rank_ids: ["r4", "r5", "r6", "r7", "r8", "r9"], requires_weapon: true, color: "#9a6a1f" }),
  tt("mesimot_chayliyot", "אמ\"ת", 5, 13, { includes_holidays: true, is_weekend_type: true, allowed_rank_ids: ["r7", "r8", "r9", "r10"], requires_weapon: true, min_rest_hours: 24, default_start_time: "10:00", default_end_time: "10:00", color: "#7a3e9d" }),
  tt("rasar", "רס\"ר", 6, 7, { service_restriction: "mandatory", allowed_rank_ids: ["r0", "r1", "r2", "r3"], default_end_time: "17:00", color: "#a04f5e" }),
  tt("rasar_tash", "רס\"ר הקלת ת\"ש", 6, 5, { service_restriction: "mandatory", allowed_rank_ids: ["r0", "r1", "r2", "r3"], tash_rule: "home", color: "#a04f5e" }),
  tt("mitbach", "מטבח", 8, 4, { color: "#b0603a" }),
  tt("mitbach_pesach", "הכשרת מטבח לפסח", 8, 1, { color: "#b0603a" }),
  tt("mefaked_toran", "מפקד תורן", 7, 1, {
    allowed_rank_ids: ["r10"], min_rest_hours: 24, color: "#8a3b2e",
    weekday_hours: { "0": "06:00-08:00+1", "1": "08:00-08:00", "2": "08:00-08:00", "3": "08:00-08:00", "4": "08:00-18:00", after_holiday: "06:00-08:00+1" },
  }),
];

const EXEMPTION_TYPES: ExemptionType[] = [
  { id: "e_full", name: "פטור מלא", qualifies_day_only: false, allows_partial_restriction: true },
  { id: "e_part", name: "פטור חלקי", qualifies_day_only: false, allows_partial_restriction: true },
  { id: "e_qual", name: "פטור מזכה – ממלכת יום בלבד", qualifies_day_only: true, allows_partial_restriction: true },
  { id: "e_med", name: "רפואי", qualifies_day_only: false, allows_partial_restriction: true },
  { id: "e_kaps", name: "קפ\"ס", qualifies_day_only: false, allows_partial_restriction: true },
  { id: "e_shachar", name: "שח\"ר", qualifies_day_only: false, allows_partial_restriction: true },
  { id: "e_bereaved", name: "משפחה שכולה", qualifies_day_only: false, allows_partial_restriction: true },
  { id: "e_tash7", name: "ת\"ש 7 – לינה בבית", qualifies_day_only: false, allows_partial_restriction: false, home_nightly: true },
];
const ABSENCE_TYPES = ["חופשה", "קורס", "יציאה לחו\"ל", "מחלה", "אחר"].map((name, i) => ({ id: `a${i}`, name }));

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const iso = (d: Date) => d.toISOString().slice(0, 10);

export class DemoApi implements Api {
  readonly demo = true;
  private user: { name: string; roles: Role[]; mustChange: boolean; aal2: boolean } | null = null;
  // version 2.1: soldier accounts (username → soldier) and open invite codes (code → soldier, expiry)
  private accounts = new Map<string, string>();
  private invites = new Map<string, { soldier_id: string; created: string; expires: string; used: boolean; sent?: string }>();
  // stage 2.5: the demo soldier's notifications
  private notes: AppNotification[] = [
    { id: "n1", type: "reserve_activated", title: "העתודה שלך הופעלה – אתה מבצע את התורנות", body: "קצין תורן, ג׳ 05/01 08:00", url: "/",
      requires_ack: true, read_at: null, acked_at: null, created_at: new Date(Date.now() - 20 * 60_000).toISOString() },
    { id: "n2", type: "exemption_decided", title: "בקשת הפטור אושרה", body: "פטור מלא, 10/08–20/08", url: "/requests",
      requires_ack: false, read_at: null, acked_at: null, created_at: new Date(Date.now() - 5 * 3600_000).toISOString() },
    { id: "n3", type: "board_published", title: "לוח התורנויות פורסם – דצמבר 2026 – מאי 2027", body: "יש לך 3 תורנויות ו-2 עתודות. הראשונה: א׳ 03/01 08:00.",
      url: "/", requires_ack: false, read_at: new Date().toISOString(), acked_at: null, created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() },
  ];
  private soldierList: ExistingSoldier[] = [];
  private gafList: NamedRef[] = GAFIM.map((name, i) => ({ id: `g${i}`, name }));
  private rankList: NamedRef[] = RANKS.map((name, i) => ({ id: `r${i}`, name }));
  private keyCheck: string | null = null;
  private boardRows: BoardRow[] = [];
  // the people of a demo board duty, made on first use (the demo board is not built from assignments)
  private boardPeople = new Map<string, SlotPerson[]>();
  private extra = new Map<string, Extra>();
  private tasks: TaskType[] = DEMO_TASKS.map((t) => ({ ...t }));
  private scoring: ScoringSettings = { night_window: "22:00-06:00", weekend_weekdays: [5, 6], surprise_multiplier: 1.3, surprise_notice_hours: 72, exemption_deadline_days: 40, fairness_tolerance_pct: 20, grace_days: 90 };
  // the unit's additions: weekend +3; eves of the big holidays +6, the other holiday days +3
  private multipliers: ScoreMultiplier[] = [
    { id: "m_we", name: "סוף שבוע", value: 3, day_types: [], holidays: [], holiday_kinds: [], weekdays: [5, 6], time_window: null, date_from: null, date_to: null, skip_shabbat_types: true, is_active: true },
    ...(
      [
        ["rosh_hashana", "eve", 6], ["rosh_hashana", "day", 3], ["yom_kippur", "eve", 6], ["yom_kippur", "day", 3],
        ["sukkot", "eve", 6], ["sukkot", "day", 3], ["sukkot", "chol_hamoed", 3], ["pesach", "eve", 6], ["pesach", "day", 3],
        ["pesach", "chol_hamoed", 3], ["shavuot", "eve", 3], ["shavuot", "day", 3], ["independence", "day", 3],
        ["hanukkah", "day", 3], ["purim", "day", 3], ["fast", "eve", 3], ["fast", "day", 3], ["minor", "day", 3],
      ] as [HolidayKey, HolidayKind, number][]
    ).map(([h, k, value]) => ({
      id: `m_${h}_${k}`, name: `${HOLIDAY_NAME[h]} · ${HOLIDAY_KIND_NAME[k]}`, value, day_types: [], holidays: [h], holiday_kinds: [k],
      weekdays: [], time_window: null, date_from: null, date_to: null, skip_shabbat_types: false, is_active: true, holiday_cell: true,
    })),
  ];
  private dayTypeList: DayTypeRef[] = Object.entries(DAY_TYPE_LABEL).map(([code, name]) => ({ code, name }));
  private cycleList: Cycle[] = [
    { id: "c1", name: "יוני–נובמבר 2026", start_date: "2026-06-01", end_date: "2026-11-30", exemption_deadline: null, status: "published", published_at: "2026-05-20T10:00:00Z" },
    { id: "c2", name: "דצמבר 2026 – מאי 2027", start_date: "2026-12-01", end_date: "2027-05-31", exemption_deadline: "2026-10-22T23:59:59+03:00", status: "collecting", published_at: null },
  ];
  private exemptionList: Exemption[] = [];
  private rosterAt: string | null = "2026-11-01T08:00:00Z";
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
  private draft: (DraftAssignment & { cycle_id: string })[] = [];
  private overrides = new Map<string, { value: number; reason: string }>();
  private calendar: CalendarDay[] = israeliHolidays("2026-09-01", "2027-08-31");

  private extraOf(id: string): Extra {
    if (!this.extra.has(id))
      this.extra.set(id, {
        appointment_rank_id: null, appointment_rank_until: null, is_shachar: false, shachar_start_date: null, tash_level: null,
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
        phone: i % 4 === 3 ? null : `97250555${String(i).padStart(4, "0")}`, // fictitious
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
    else if (u === "cmd") this.user = { name: u, roles: ["gaf_commander"], mustChange: false, aal2: false };
    else if (u === "magad") this.user = { name: u, roles: ["unit_commander"], mustChange: false, aal2: true };
    else if (u === "chayal" || this.accounts.has(u)) this.user = { name: u, roles: ["soldier"], mustChange: false, aal2: true };
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

  async nextPublished(fromIso: string) {
    return this.boardRows.filter((r) => r.starts_at >= fromIso).map((r) => r.starts_at).sort()[0] ?? null;
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

  async rekeySoldiers(pairs: { id: string; key: string }[], check: string) {
    await delay(300);
    for (const p of pairs) {
      const s = this.soldierList.find((x) => x.id === p.id);
      if (s) s.soldier_key = p.key;
    }
    this.keyCheck = check;
    return pairs.length;
  }

  async applyRoster(plan: RosterPlan): Promise<ApplyResult> {
    await delay(400);
    this.rosterAt = new Date().toISOString();
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
    return LOAD_ROLES.map((r) => ({ ...r })).sort((a, b) => a.factor - b.factor);
  }

  async saveLoadRole(id: string | null, role: { name: string; factor: number }) {
    await delay();
    if (id) Object.assign(LOAD_ROLES.find((r) => r.id === id)!, { name: role.name.trim(), factor: role.factor });
    else LOAD_ROLES.push({ id: this.nextId("lr"), name: role.name.trim(), factor: role.factor });
  }

  async deleteLoadRole(id: string) {
    await delay();
    if (this.soldierList.some((s) => this.extraOf(s.id).load_roles?.some((r) => r.load_role_id === id)))
      throw new Error("יש חיילים עם ההקלה הזו, ולכן אי אפשר למחוק אותה. הסר אותה מהם קודם.");
    const i = LOAD_ROLES.findIndex((r) => r.id === id);
    if (i >= 0) LOAD_ROLES.splice(i, 1);
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

  async deleteTaskType(id: string) {
    await delay();
    const t = this.tasks.find((x) => x.id === id);
    if ([...this.slotsByCycle.values()].some((l) => l.some((s) => s.task_type_id === id)))
      throw new Error(`התורנות "${t?.name}" בשימוש (משבצות במחזור), ולכן אי אפשר למחוק אותה. אפשר להפוך אותה ללא פעילה.`);
    this.tasks = this.tasks.filter((x) => x.id !== id);
    this.aliasList = this.aliasList.filter((a) => a.task_type_id !== id);
  }

  async dutyCategories() {
    return CATEGORIES.map((c) => ({ ...c }));
  }

  async saveDutyCategory(name: string, id?: string) {
    await delay();
    if (CATEGORIES.some((c) => c.name === name && c.id !== id)) throw new Error("duplicate key value violates unique constraint \"duty_categories_name_key\"");
    if (id) CATEGORIES.find((c) => c.id === id)!.name = name;
    else CATEGORIES.push({ id: this.nextId("c"), name });
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

  async scoreMultipliers() {
    await delay();
    return this.multipliers.map((m) => ({ ...m }));
  }

  async saveScoreMultiplier(id: string | null, m: ScoreMultiplierInput) {
    await delay();
    if (id) Object.assign(this.multipliers.find((x) => x.id === id)!, m);
    else this.multipliers.push({ ...m, id: this.nextId("m") });
  }

  async deleteScoreMultiplier(id: string) {
    await delay();
    this.multipliers = this.multipliers.filter((m) => m.id !== id);
  }

  async dayTypes() {
    await delay();
    return this.dayTypeList.map((t) => ({ ...t }));
  }

  async deleteDayType(code: string) {
    await delay();
    if (this.calendar.some((d) => d.day_type === code)) throw new Error("יש ימים בלוח החגים מסוג זה. שנה או מחק אותם קודם.");
    this.dayTypeList = this.dayTypeList.filter((t) => t.code !== code);
    this.multipliers.forEach((m) => (m.day_types = m.day_types.filter((c) => c !== code)));
  }

  async addDayType(name: string) {
    await delay();
    const code = `custom_${this.nextId("t")}`;
    this.dayTypeList.push({ code, name: name.trim() });
    return code;
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

  private stageFacts(c: Cycle): StageFacts {
    const pending = this.exemptionList.filter((e) => e.status === "pending" && e.start_date <= c.end_date && e.end_date >= c.start_date).length;
    const job = this.jobs.filter((j) => j.cycle_id === c.id).at(-1)?.status ?? null;
    return { rosterAt: this.rosterAt, pending, slots: (this.slotsByCycle.get(c.id) ?? []).length, job: job as StageFacts["job"] };
  }

  async cycleStages(cycleId: string) {
    await delay();
    const c = this.cycleList.find((x) => x.id === cycleId)!;
    return stageStates(c, this.stageFacts(c), new Date());
  }

  async refreshCycleStages() {
    let n = 0;
    for (const c of this.cycleList) {
      const to = autoStatus(c, this.stageFacts(c), new Date(), dayKey(new Date()));
      if (to !== c.status) {
        c.status = to;
        n++;
      }
    }
    return n;
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

  async recentHolidayDuties(sinceIso: string) {
    void sinceIso;
    // a few soldiers did a holiday duty in the demo's past year
    return this.soldierList
      .filter((_, i) => i % 4 === 0)
      .map((s, i) => ({ soldier_id: s.id, day: i % 2 ? "2026-04-02" : "2026-09-21", task_name: i % 2 ? "קצין תורן" : "מפקד שער" }));
  }

  async snapshotSoldiers(cycleId: string): Promise<SnapshotSoldier[]> {
    void cycleId;
    return this.soldierList.filter((s) => s.is_active).map((s) => ({
      soldier_id: s.id, rank_name: s.rank_name, service_type: s.service_type, is_parent: s.parent_status, qualifies_day_only: s.parent_status,
      balance_population: s.service_type, baseline_score: 0, fairness_group: s.service_type, fairness_label: null, credit: 0, credit_days: 0,
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
    const live = (id: string) => this.draft.filter((a) => a.slot_id === id && a.status !== "draft").length;
    return (this.slotsByCycle.get(cycleId) ?? []).map((s) => ({ ...s, assigned: live(s.id) }));
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
    const slots = this.slotsByCycle.get(j.cycle_id) ?? [];
    // like the worker: duties staffed so far, month by month
    const months = Math.max(1, new Set(slots.map((k) => k.starts_at.slice(0, 7))).size);
    const month = Math.min(months, Math.floor(((age - 4) / 12) * months));
    j.params = { ...j.params, slots: slots.length, months, month, staffed: Math.round((slots.length * month) / months), phase: age > 6 ? "improving" : "searching" };
    if (age < 16) return;
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
    this.fillDraft(j.cycle_id, j.kind === "stability");
  }

  /** Rough demo draft: each slot gets the least-loaded soldiers of a fitting service. */
  private fillDraft(cycleId: string, onlyNew = false) {
    this.draft = this.draft.filter((a) => a.cycle_id !== cycleId || a.source === "manual" || a.status !== "draft");
    const load = new Map<string, number>();
    const tasks = new Map(this.tasks.map((t) => [t.id, t]));
    const live = new Set(this.draft.filter((a) => a.cycle_id === cycleId).map((a) => a.slot_id));
    const slots = onlyNew
      ? (this.slotsByCycle.get(cycleId) ?? []).filter((k) => !live.has(k.id))
      : (this.slotsByCycle.get(cycleId) ?? []).slice(1); // leave the first one unfilled
    for (const k of slots) {
      const t = tasks.get(k.task_type_id);
      const pool = this.soldierList.filter((s) => s.is_active && (!t || t.service_restriction === "any" || t.service_restriction === s.service_type));
      // the weight is the points of the whole duty, however many days it lasts
      const pts = Math.round((t?.weight ?? 1) * (k.is_surprise ? this.scoring.surprise_multiplier : 1) * 100) / 100;
      const pick = [...pool].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id.localeCompare(b.id)).slice(0, 2);
      pick.forEach((s, i) => {
        const role: DraftRole = i === 0 ? "performer" : "reserve";
        if (role === "performer") load.set(s.id, (load.get(s.id) ?? 0) + pts);
        this.draft.push({
          id: this.nextId("as"), cycle_id: cycleId, slot_id: k.id, soldier_id: s.id, role, status: "draft", source: "solver",
          points: role === "performer" ? pts : 0, normalized_points: role === "performer" ? pts : 0, weekend_units: 0,
          explanation: role === "performer" ? `שובץ כי הניקוד שלו ${(load.get(s.id)! - pts).toFixed(1)} לעומת ממוצע האוכלוסייה 3.0` : "עתודה",
          manual_reason: null,
        });
      });
    }
  }

  async scheduleJobs(cycleId: string) {
    await delay();
    const mine = this.jobs.filter((j) => j.cycle_id === cycleId);
    mine.forEach((j) => this.tick(j));
    return mine.map(({ cycle_id: _c, ...j }) => ({ ...j })).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async requestSchedule(cycleId: string, kind: "full" | "stability" | "update" = "full") {
    await delay(300);
    if (this.jobs.some((j) => j.cycle_id === cycleId && (j.status === "queued" || j.status === "running")))
      throw new Error("a scheduling run is already in progress for this cycle");
    const id = this.nextId("job");
    this.jobs.push({
      id, cycle_id: cycleId, status: "queued", kind, progress: 0, created_at: new Date().toISOString(), started_at: null,
      finished_at: null, error: null, params: { dispatch: "sent" }, result_status: null, wall_time: null, unfilled: null, warnings: null, pools: null,
    });
    const c = this.cycleList.find((x) => x.id === cycleId);
    if (c && ["slots", "potential", "review", "scheduling"].includes(c.status)) c.status = "scheduling";
    return id;
  }

  async updateSpecialSlot(slotId: string, name: string, points: number) {
    await delay();
    for (const rows of this.slotsByCycle.values()) {
      const k = rows.find((x) => x.id === slotId);
      if (k) Object.assign(k, { special_name: name, fixed_points: points });
    }
  }

  async addSlot(cycleId: string, k: NewSlot) {
    await delay();
    const row: SlotRow = {
      id: this.nextId("sl"), ...k, allowed_rank_ids: null, gender: null, instructions: null, notes: null, source_line: null,
      prefer_home_nightly: false, daily_hours: null, briefing_at: null, assigned: 0,
    };
    this.slotsByCycle.set(cycleId, [...(this.slotsByCycle.get(cycleId) ?? []), row].sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
  }

  private peopleOf(row: BoardRow): SlotPerson[] {
    let list = this.boardPeople.get(row.slot_id);
    if (!list) {
      list = [
        ...row.performers.map((name, i) => ({ id: `bp|${row.slot_id}|p${i}`, name, role: "performer" as const, status: "assigned", replaced_id: null })),
        ...row.reserves.map((name, i) => ({ id: `bp|${row.slot_id}|r${i}`, name, role: "reserve" as const, status: "reserve_idle", replaced_id: null })),
      ];
      this.boardPeople.set(row.slot_id, list);
    }
    return list;
  }

  private syncBoard(row: BoardRow) {
    const list = this.peopleOf(row);
    const performs = (p: SlotPerson) => (p.role === "performer" && p.status !== "dropped") || p.status === "reserve_activated";
    row.performers = list.filter(performs).map((p) => p.name);
    row.reserves = list.filter((p) => p.role === "reserve" && p.status === "reserve_idle").map((p) => p.name);
    row.activated = list.filter((p) => p.status === "reserve_activated").map((p) => p.name);
    row.replaced = list.filter((p) => list.some((x) => x.replaced_id === p.id)).map((p) => p.name);
    row.changed_after_publish = true;
    row.updated_at = new Date().toISOString();
    row.performer_gafim = undefined;
    row.reserve_gafim = undefined;
  }

  async slotPeople(slotId: string): Promise<SlotPeople | null> {
    await delay();
    const row = this.boardRows.find((r) => r.slot_id === slotId);
    if (row) {
      return {
        slot: { id: row.slot_id, cycle_id: "c1", starts_at: row.starts_at, ends_at: row.ends_at, task_name: row.task_name, published: true },
        people: this.peopleOf(row).map((p) => ({ ...p })),
      };
    }
    const k = [...this.slotsByCycle.entries()].flatMap(([cycle_id, l]) => l.map((s) => ({ ...s, cycle_id }))).find((s) => s.id === slotId);
    if (!k) return null;
    const names = new Map(this.soldierList.map((s) => [s.id, s.full_name]));
    return {
      slot: { id: k.id, cycle_id: k.cycle_id, starts_at: k.starts_at, ends_at: k.ends_at, task_name: this.tasks.find((t) => t.id === k.task_type_id)?.name ?? "", published: this.cycleList.find((c) => c.id === k.cycle_id)?.status === "published" },
      people: this.draft
        .filter((a) => a.slot_id === slotId && a.status !== "draft")
        .map((a) => ({ id: a.id, name: names.get(a.soldier_id) ?? "?", role: a.role, status: a.status, replaced_id: (a as { replaced_id?: string }).replaced_id ?? null })),
    };
  }

  async deleteSlot(slotId: string) {
    await delay(200);
    this.draft = this.draft.filter((a) => a.slot_id !== slotId);
    for (const [c, l] of this.slotsByCycle) this.slotsByCycle.set(c, l.filter((s) => s.id !== slotId));
  }

  async deletePendingSlot(slotId: string) {
    await delay(200);
    if (this.draft.some((a) => a.slot_id === slotId && a.status !== "draft")) throw new Error("בתורנות יש שיבוץ מפורסם – אי אפשר למחוק אותה");
    this.draft = this.draft.filter((a) => a.slot_id !== slotId);
    for (const [c, l] of this.slotsByCycle) this.slotsByCycle.set(c, l.filter((s) => s.id !== slotId));
  }

  async unassignPublished(assignmentId: string, reason: string) {
    await delay(300);
    if (!reason.trim()) throw new Error("חובה לכתוב סיבה");
    if (assignmentId.startsWith("bp|")) {
      const row = this.boardRows.find((r) => r.slot_id === assignmentId.split("|")[1])!;
      if (Date.parse(row.starts_at) <= Date.now()) throw new Error("התורנות כבר התחילה – במקום הסרה מפעילים עתודה");
      const p = this.peopleOf(row).find((x) => x.id === assignmentId)!;
      Object.assign(p, { status: "dropped" });
      return this.syncBoard(row);
    }
    const a = this.draft.find((x) => x.id === assignmentId);
    if (a) Object.assign(a, { status: "dropped" });
  }

  async undoReserveActivation(reserveId: string) {
    await delay(300);
    if (reserveId.startsWith("bp|")) {
      const row = this.boardRows.find((r) => r.slot_id === reserveId.split("|")[1])!;
      if (Date.parse(row.starts_at) <= Date.now()) throw new Error("התורנות כבר התחילה – אי אפשר לבטל את ההפעלה");
      const list = this.peopleOf(row);
      const r = list.find((p) => p.id === reserveId)!;
      const p = list.find((x) => x.id === r.replaced_id)!;
      Object.assign(p, { status: "assigned" });
      Object.assign(r, { status: "reserve_idle", replaced_id: null });
      return this.syncBoard(row);
    }
    const r = this.draft.find((a) => a.id === reserveId) as (DraftAssignment & { replaced_id?: string }) | undefined;
    if (!r || r.status !== "reserve_activated") throw new Error("זו לא עתודה שהופעלה");
    const p = this.draft.find((a) => a.id === r.replaced_id);
    if (p) p.status = "assigned";
    r.status = "reserve_idle";
    r.replaced_id = undefined;
  }

  async activateReserve(reserveId: string, fromUnit: number, performerId: string | null) {
    await delay(300);
    if (reserveId.startsWith("bp|")) {
      const row = this.boardRows.find((x) => x.slot_id === reserveId.split("|")[1])!;
      const list = this.peopleOf(row);
      const r = list.find((x) => x.id === reserveId);
      if (!r || r.status !== "reserve_idle") throw new Error("זו לא עתודה פעילה בלוח המפורסם");
      const p = list.find((x) => x.role === "performer" && x.status === "assigned" && (!performerId || x.id === performerId));
      if (!p) throw new Error("לא נמצא מבצע להחלפה – בחר את המבצע");
      p.status = fromUnit === 0 ? "dropped" : "done";
      Object.assign(r, { status: "reserve_activated", replaced_id: p.id });
      return this.syncBoard(row);
    }
    const r = this.draft.find((a) => a.id === reserveId);
    if (!r || r.role !== "reserve" || r.status !== "reserve_idle") throw new Error("זו לא עתודה פעילה בלוח המפורסם");
    const p = this.draft.find((a) => a.slot_id === r.slot_id && a.role === "performer" && a.status === "assigned" && (!performerId || a.id === performerId));
    if (!p) throw new Error("לא נמצא מבצע להחלפה – בחר את המבצע");
    const k = [...this.slotsByCycle.values()].flat().find((s) => s.id === r.slot_id)!;
    const units = Math.max(1, Math.ceil((Date.parse(k.ends_at) - Date.parse(k.starts_at)) / 86_400_000));
    const per = p.points / units;
    r.status = "reserve_activated";
    (r as DraftAssignment & { replaced_id?: string }).replaced_id = p.id;
    r.points = r.normalized_points = Math.round(per * (units - fromUnit) * 100) / 100;
    if (fromUnit === 0) Object.assign(p, { status: "dropped", points: 0, normalized_points: 0 });
    else Object.assign(p, { status: "done", points: Math.round(per * fromUnit * 100) / 100, normalized_points: Math.round(per * fromUnit * 100) / 100 });
  }

  async publishAdditions(cycleId: string) {
    await delay(300);
    const mine = this.draft.filter((a) => a.cycle_id === cycleId && a.status === "draft");
    mine.forEach((a) => (a.status = a.role === "performer" ? "assigned" : "reserve_idle"));
    return mine.length;
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

  // ----- draft editor -----

  async draftAssignments(cycleId: string) {
    await delay();
    const gone = ["dropped", "cancelled_approved", "swapped_out"];
    return this.draft.filter((a) => a.cycle_id === cycleId && !gone.includes(a.status)).map(({ cycle_id: _c, ...a }) => ({ ...a }));
  }

  async slotCandidates(slotId: string): Promise<Candidate[]> {
    await delay(300);
    const cycleId = [...this.slotsByCycle].find(([, v]) => v.some((s) => s.id === slotId))?.[0] ?? "";
    const mine = this.draft.filter((a) => a.cycle_id === cycleId);
    return this.soldierList
      .filter((s) => s.is_active)
      .map((s, i) => ({
        soldier_id: s.id,
        reasons: i % 5 === 0 ? ["rank"] : i % 7 === 0 ? ["absence"] : [],
        conflicts: i % 11 === 0 ? [{ slot_id: "x", task: "קצין תורן", role: "performer" as DraftRole, starts_at: new Date().toISOString(), ends_at: new Date().toISOString() }] : [],
        cycle_points: mine.filter((a) => a.soldier_id === s.id).reduce((n, a) => n + a.normalized_points, 0),
        cycle_duties: mine.filter((a) => a.soldier_id === s.id).length,
        in_slot: mine.find((a) => a.slot_id === slotId && a.soldier_id === s.id)?.role ?? null,
      }));
  }

  async manualAssign(slotId: string, role: DraftRole, soldierId: string, replaceId: string | null, reason: string) {
    await delay();
    if (!reason.trim()) throw new Error("a reason is required");
    const cycleId = [...this.slotsByCycle].find(([, v]) => v.some((s) => s.id === slotId))?.[0] ?? "";
    let points = 1;
    if (replaceId) {
      const old = this.draft.find((a) => a.id === replaceId)!;
      role = old.role;
      points = old.points || 1;
      this.draft = this.draft.filter((a) => a.id !== replaceId);
    }
    const id = this.nextId("as");
    this.draft.push({
      id, cycle_id: cycleId, slot_id: slotId, soldier_id: soldierId, role, status: "draft", source: "manual",
      points: role === "performer" ? points : 0, normalized_points: role === "performer" ? points : 0, weekend_units: 0,
      explanation: `שיבוץ ידני: ${reason}`, manual_reason: reason,
    });
    return id;
  }

  async assignPublished(slotId: string, role: DraftRole, soldierId: string, reason: string | null) {
    await delay();
    const cycleId = [...this.slotsByCycle].find(([, v]) => v.some((s) => s.id === slotId))?.[0] ?? "";
    if (this.draft.some((a) => a.slot_id === slotId && a.soldier_id === soldierId && !["draft", "dropped"].includes(a.status)))
      throw new Error("החייל כבר משובץ בתורנות הזו");
    this.draft = this.draft.filter((a) => !(a.slot_id === slotId && a.status === "draft" && (a.role === role || a.soldier_id === soldierId)));
    const id = this.nextId("as");
    this.draft.push({
      id, cycle_id: cycleId, slot_id: slotId, soldier_id: soldierId, role, status: role === "performer" ? "assigned" : "reserve_idle", source: "manual",
      points: 1, normalized_points: 1, weekend_units: 0,
      explanation: `שיבוץ ידני אחרי פרסום${reason ? `: ${reason}` : ""}`, manual_reason: reason ?? "שיבוץ ידני אחרי פרסום",
    });
    return id;
  }

  async removeAssignment(assignmentId: string) {
    await delay();
    this.draft = this.draft.filter((a) => a.id !== assignmentId);
  }

  async publishCycle(cycleId: string) {
    await delay(300);
    const c = this.cycleList.find((x) => x.id === cycleId)!;
    Object.assign(c, { status: "published", published_at: new Date().toISOString() });
    const mine = this.draft.filter((a) => a.cycle_id === cycleId && a.status === "draft");
    mine.forEach((a) => (a.status = a.role === "performer" ? "assigned" : "reserve_idle"));
    return mine.length;
  }

  private users: AppUser[] = [
    { user_id: "u-naat", username: "naat", soldier_id: null, soldier_name: null, is_locked: false, must_change_password: false, last_login_at: new Date().toISOString(), roles: [{ id: "r1", role: "coordinator", gaf_id: null, valid_from: null, valid_to: null }] },
    { user_id: "u-board", username: "board", soldier_id: null, soldier_name: null, is_locked: false, must_change_password: false, last_login_at: null, roles: [{ id: "r2", role: "viewer", gaf_id: null, valid_from: null, valid_to: null }] },
  ];

  async listUsers() {
    await delay();
    return this.users.map((u) => ({ ...u, roles: [...u.roles] }));
  }

  async createUser(username: string, password: string, soldierId: string | null, role: CreatableRole = "gaf_commander") {
    await delay(300);
    if (this.users.some((u) => u.username === username)) throw new Error("שם המשתמש כבר קיים");
    if (password.length < 10) throw new Error("סיסמה זמנית: לפחות 10 תווים");
    const s = this.soldierList.find((x) => x.id === soldierId);
    const id = crypto.randomUUID();
    this.users.push({ user_id: id, username, soldier_id: soldierId, soldier_name: s?.full_name ?? null, is_locked: false, must_change_password: true, last_login_at: null, roles: [{ id: crypto.randomUUID(), role, gaf_id: null, valid_from: null, valid_to: null }] });
    return id;
  }

  async resetUserPassword(userId: string, password: string) {
    await delay();
    if (password.length < 10) throw new Error("סיסמה זמנית: לפחות 10 תווים");
    const u = this.users.find((x) => x.user_id === userId);
    if (u) u.must_change_password = true;
  }

  async deleteUser(userId: string) {
    await delay(200);
    void userId;
    return "deleted" as const;
  }

  async setUserLocked(userId: string, locked: boolean) {
    await delay();
    const u = this.users.find((x) => x.user_id === userId);
    if (u) u.is_locked = locked;
  }

  async setUserSoldier(userId: string, soldierId: string | null) {
    await delay();
    const u = this.users.find((x) => x.user_id === userId);
    if (u) Object.assign(u, { soldier_id: soldierId, soldier_name: this.soldierList.find((x) => x.id === soldierId)?.full_name ?? null });
  }

  async markInvitesSent(soldierIds: string[]) {
    await delay(100);
    for (const i of this.invites.values()) if (soldierIds.includes(i.soldier_id) && !i.used && !i.sent) i.sent = new Date().toISOString();
  }

  async createSoldierInvites(soldierIds: string[], days: number) {
    await delay();
    const taken = new Set(this.accounts.values());
    const out: { soldier_id: string; code: string }[] = [];
    for (const id of soldierIds) {
      if (taken.has(id)) continue;
      for (const [c, i] of this.invites) if (i.soldier_id === id && !i.used) this.invites.delete(c);
      const raw = Array.from({ length: 10 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");
      this.invites.set(raw, { soldier_id: id, created: new Date().toISOString(), expires: new Date(Date.now() + days * 86_400_000).toISOString(), used: false });
      out.push({ soldier_id: id, code: `${raw.slice(0, 5)}-${raw.slice(5)}` });
    }
    return out;
  }

  async revokeSoldierInvites(soldierIds: string[]) {
    let n = 0;
    for (const [c, i] of this.invites) if (soldierIds.includes(i.soldier_id) && !i.used) (this.invites.delete(c), n++);
    return n;
  }

  async soldierAccounts() {
    await delay();
    const byUser = new Map([...this.accounts].map(([u, sid]) => [sid, u]));
    return this.soldierList.map((s) => {
      const inv = [...this.invites.values()].filter((i) => i.soldier_id === s.id).pop();
      return {
        soldier_id: s.id,
        username: byUser.get(s.id) ?? null,
        is_locked: byUser.has(s.id) ? false : null,
        invited_at: inv?.created ?? null,
        invite_expires_at: inv?.expires ?? null,
        invite_state: inv ? (inv.used ? ("used" as const) : ("open" as const)) : null,
        invite_sent_at: inv?.sent ?? null,
      };
    });
  }

  async redeemInvite(code: string, username: string, password: string) {
    await delay();
    const inv = this.invites.get(code.toUpperCase().replace(/[^A-Z0-9]/g, ""));
    if (!inv) throw new Error("הקוד לא תקין. בדוק אותו או בקש קוד חדש מנע\"ת התורנויות");
    if (inv.used) throw new Error("הקוד כבר נוצל. אם זה לא אתה – פנה לנע\"ת התורנויות");
    const u = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(u)) throw new Error("שם משתמש: 3–32 אותיות לטיניות קטנות, ספרות, נקודה, מקף או קו תחתון");
    if (password.length < 10) throw new Error("סיסמה: לפחות 10 תווים");
    if (this.accounts.has(u) || ["naat", "board", "cmd", "chayal", "new.user"].includes(u)) throw new Error("שם המשתמש תפוס. בחר שם אחר");
    inv.used = true;
    this.accounts.set(u, inv.soldier_id);
    return u;
  }

  /** The demo soldier "chayal" is the second soldier of the list. */
  private mySoldier() {
    if (!this.user) return null;
    return this.accounts.get(this.user.name) ?? (this.user.name === "chayal" ? this.soldierList[1]?.id : null) ?? null;
  }

  async myDuties() {
    await delay();
    const me = this.mySoldier();
    const out = [];
    for (const c of this.cycleList.filter((x) => x.status === "published" || x.status === "closed")) {
      const slots = new Map((this.slotsByCycle.get(c.id) ?? []).map((k) => [k.id, k]));
      for (const a of this.draft.filter((x) => x.cycle_id === c.id && x.soldier_id === me && !["draft", "dropped", "swapped_out", "cancelled_approved"].includes(x.status))) {
        const k = slots.get(a.slot_id);
        if (!k) continue;
        out.push({
          assignment_id: a.id, cycle_id: c.id, cycle_name: c.name, task_name: this.tasks.find((t) => t.id === k.task_type_id)?.name ?? "",
          starts_at: k.starts_at, ends_at: k.ends_at, role: a.role, status: a.status, points: a.normalized_points, explanation: a.explanation,
          report_at: null, report_place: null, briefing_at: null, briefing_place: null, equipment: null,
        });
      }
    }
    // the demo soldier gets two duties ahead, so swaps can be tried
    if (this.user?.name === "chayal" && !out.some((d) => Date.parse(d.starts_at) > Date.now())) out.push(...this.demoDuties());
    return out.sort((x, y) => x.starts_at.localeCompare(y.starts_at));
  }

  private demoDutyList: MyDuty[] | null = null;
  private demoDuties(): MyDuty[] {
    const at = (days: number, h: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 11) + `${String(h).padStart(2, "0")}:00:00+02:00`;
    this.demoDutyList ??= [
      { assignment_id: "demo-d1", cycle_id: "demo", cycle_name: "מחזור הדגמה", task_name: "שמירות חובה", starts_at: at(4, 8), ends_at: at(4, 20),
        role: "performer", status: "assigned", points: 1, explanation: "הניקוד שלך הנמוך בקבוצה", report_at: null, report_place: "שער ראשי",
        briefing_at: null, briefing_place: null, equipment: null },
      { assignment_id: "demo-d2", cycle_id: "demo", cycle_name: "מחזור הדגמה", task_name: "מפקד שער | ש.ג קבע", starts_at: at(11, 20), ends_at: at(12, 8),
        role: "reserve", status: "reserve_idle", points: 0, explanation: "עתודה לפי תור", report_at: null, report_place: null,
        briefing_at: null, briefing_place: null, equipment: null },
    ];
    return this.demoDutyList.filter((d) => d.status === "assigned" || d.status === "reserve_idle");
  }

  private swaps: MySwap[] = [];
  private swapsSeeded = false;
  private seedSwaps() {
    if (this.swapsSeeded) return;
    this.swapsSeeded = true;
    const at = (days: number) => new Date(Date.now() + days * 86400_000).toISOString();
    this.swaps.push({
      id: "demo-sw1", kind: "mutual", status: "pending_peer", mine: false, other_name: this.soldierList[5]?.full_name ?? "חייל",
      give_task: "מטבח", give_starts_at: at(6), give_ends_at: at(6.5), take_task: "שמירות חובה", take_starts_at: at(4), take_ends_at: at(4.5),
      reason: null, created_at: new Date().toISOString(), expired: false,
    });
  }

  async swapOptions(assignmentId: string): Promise<SwapOptions> {
    await delay();
    const d = this.demoDuties().find((x) => x.assignment_id === assignmentId);
    if (!d) throw new Error("זו לא תורנות שלך");
    const others = this.soldierList.filter((x) => x.id !== this.mySoldier()).slice(10, 22);
    return {
      handover: others.slice(0, 8).map((x) => ({ soldier_id: x.id, name: x.full_name })).sort((a, b) => a.name.localeCompare(b.name, "he")),
      mutual: others.slice(8).map((x, i) => {
        const t = new Date(Date.parse(d.starts_at) + (i + 1) * 2 * 86400_000);
        return { soldier_id: x.id, name: x.full_name, assignment_id: `demo-x${i}`, task: d.task_name, starts_at: t.toISOString(),
                 ends_at: new Date(t.getTime() + 12 * 3600_000).toISOString() };
      }),
    };
  }

  async requestSwap(assignmentId: string, targetSoldierId: string, counterAssignmentId: string | null = null) {
    await delay();
    this.seedSwaps();
    const d = this.demoDuties().find((x) => x.assignment_id === assignmentId)!;
    if (this.swaps.some((w) => w.mine && w.status === "pending_peer" && w.give_starts_at === d.starts_at)) throw new Error("כבר יש בקשת החלפה פתוחה על התורנות הזו");
    const opts = await this.swapOptions(assignmentId);
    const m = opts.mutual.find((x) => x.assignment_id === counterAssignmentId);
    const id = crypto.randomUUID();
    this.swaps.unshift({
      id, kind: counterAssignmentId ? "mutual" : "handover", status: "pending_peer", mine: true,
      other_name: this.soldierList.find((x) => x.id === targetSoldierId)?.full_name ?? "",
      give_task: d.task_name, give_starts_at: d.starts_at, give_ends_at: d.ends_at,
      take_task: m?.task ?? null, take_starts_at: m?.starts_at ?? null, take_ends_at: m?.ends_at ?? null,
      reason: null, created_at: new Date().toISOString(), expired: false,
    });
    return id;
  }

  async answerSwap(requestId: string, accept: boolean) {
    await delay();
    const w = this.swaps.find((x) => x.id === requestId);
    if (!w || w.mine || w.status !== "pending_peer") throw new Error("הבקשה לא נמצאה");
    w.status = accept ? "approved" : "rejected";
    return { status: w.status };
  }

  async cancelSwap(requestId: string) {
    await delay();
    const w = this.swaps.find((x) => x.id === requestId);
    if (!w || !w.mine || w.status !== "pending_peer") throw new Error("הבקשה לא נמצאה");
    w.status = "cancelled";
  }

  async mySwaps() {
    await delay();
    if (!this.user?.roles.includes("soldier")) return [];
    this.seedSwaps();
    return this.swaps.map((w) => ({ ...w }));
  }

  async swapLog(): Promise<SwapLogRow[]> {
    await delay();
    const at = (days: number) => new Date(Date.now() + days * 86400_000).toISOString();
    const n = (i: number) => this.soldierList[i]?.full_name ?? "חייל";
    return [
      { id: "demo-l1", kind: "handover", status: "approved", requester: n(3), target: n(7), give_task: "מטבח", give_starts_at: at(5),
        take_task: null, take_starts_at: null, reason: null, created_at: at(-1), decided_at: at(-0.9) },
      { id: "demo-l2", kind: "mutual", status: "approved", requester: n(12), target: n(20), give_task: "שמירות חובה", give_starts_at: at(3),
        take_task: "שמירות חובה", take_starts_at: at(9), reason: null, created_at: at(-2), decided_at: at(-1.8) },
      { id: "demo-l3", kind: "handover", status: "rejected", requester: n(30), target: n(31), give_task: "קצין הגנ\"ק", give_starts_at: at(8),
        take_task: null, take_starts_at: null, reason: null, created_at: at(-0.5), decided_at: at(-0.4) },
    ];
  }

  async myInputOptions() {
    await delay();
    const today = new Date().toISOString().slice(0, 10);
    return {
      exemption_types: EXEMPTION_TYPES.map((t) => ({ id: t.id, name: t.name })),
      absence_types: ABSENCE_TYPES.filter((t) => t.name !== "מחלה"),
      block_quota_per_month: 1,
      cycles: this.cycleList
        .filter((c) => c.end_date >= today)
        .map((c) => ({
          id: c.id, name: c.name, start_date: c.start_date, end_date: c.end_date, deadline: c.exemption_deadline,
          open: c.status !== "published" && c.status !== "closed" && (!c.exemption_deadline || Date.parse(c.exemption_deadline) > Date.now()),
        })),
    };
  }

  private demoOpen(day: string) {
    return !this.cycleList.some(
      (c) => c.start_date <= day && day <= c.end_date &&
        (c.status === "published" || c.status === "closed" || (!!c.exemption_deadline && Date.parse(c.exemption_deadline) <= Date.now())),
    );
  }

  async myRequests() {
    await delay();
    this.seedConstraints();
    const me = this.mySoldier();
    const exName = new Map(EXEMPTION_TYPES.map((t) => [t.id, t.name]));
    const abName = new Map(ABSENCE_TYPES.map((t) => [t.id, t.name]));
    return {
      exemptions: this.exemptionList
        .filter((e) => e.soldier_id === me && e.source !== "computed")
        .map((e) => ({ id: e.id, type: exName.get(e.exemption_type_id) ?? "", start_date: e.start_date, end_date: e.end_date, status: e.status,
          is_urgent: e.is_urgent, mine: e.source === "soldier", decision_reason: e.decision_reason })),
      blocks: this.blockList
        .filter((b) => b.soldier_id === me && b.status === "active")
        .map((b) => ({ id: b.id, day: b.day, mine: b.received_via === "system", open: this.demoOpen(b.day) })),
      absences: this.absenceList
        .filter((a) => a.soldier_id === me && a.status === "active")
        .map((a) => ({ id: a.id, type: abName.get(a.absence_type_id) ?? "", starts_at: a.starts_at, ends_at: a.ends_at,
          mine: a.received_via === "system", open: this.demoOpen(a.starts_at.slice(0, 10)) })),
    };
  }

  async submitExemption(typeId: string, from: string, to: string) {
    await delay();
    if (to < from) throw new Error("תאריכים לא תקינים");
    const me = this.mySoldier()!;
    const urgent = !this.demoOpen(from) || !this.demoOpen(to);
    this.exemptionList.push({
      id: `ex${Date.now()}`, soldier_id: me, exemption_type_id: typeId, kind: "full", start_date: from, end_date: to,
      excluded_task_type_ids: null, restricted_hours: null, is_urgent: urgent, status: "pending", source: "soldier",
      proof_checked_at: null, decided_at: null, decision_reason: null, received_via: "system", received_at: new Date().toISOString(),
    } as Exemption);
  }

  async withdrawMyExemption(id: string) {
    const e = this.exemptionList.find((x) => x.id === id && x.status === "pending");
    if (!e) throw new Error("אפשר לבטל רק בקשה שעוד ממתינה");
    Object.assign(e, { status: "cancelled", decision_reason: "בוטל על ידי החייל" });
  }

  async addMyDateBlock(day: string) {
    await delay();
    const me = this.mySoldier()!;
    if (!this.demoOpen(day)) throw new Error("איסוף האילוצים למחזור הזה נסגר. לשינוי פנה לנע\"ת");
    if (this.blockList.some((b) => b.soldier_id === me && b.status === "active" && b.day.slice(0, 7) === day.slice(0, 7)))
      throw new Error("כבר יש לך חסימה בחודש הזה (מכסה: 1 בחודש). בטל אותה כדי לבחור יום אחר");
    this.blockList.push({ id: `b${Date.now()}`, soldier_id: me, cycle_id: null, day, status: "active", received_via: "system" });
  }

  async cancelMyDateBlock(id: string) {
    const b = this.blockList.find((x) => x.id === id);
    if (b) b.status = "cancelled";
  }

  async addMyAbsence(typeId: string, from: string, to: string) {
    await delay();
    if (to < from) throw new Error("תאריכים לא תקינים");
    if (!this.demoOpen(from)) throw new Error("איסוף האילוצים למחזור הזה נסגר. לשינוי פנה לנע\"ת");
    const end = new Date(Date.parse(to) + 86_400_000).toISOString().slice(0, 10);
    this.absenceList.push({ id: `ab${Date.now()}`, soldier_id: this.mySoldier()!, absence_type_id: typeId, starts_at: `${from}T00:00:00+02:00`,
      ends_at: `${end}T00:00:00+02:00`, status: "active", cancel_reason: null, received_via: "system" });
  }

  async cancelMyAbsence(id: string) {
    const a = this.absenceList.find((x) => x.id === id);
    if (a) Object.assign(a, { status: "cancelled", cancel_reason: "בוטל על ידי החייל" });
  }

  async unitDashboard(): Promise<UnitDashboard> {
    await delay();
    this.seedConstraints();
    const c = this.cycleList.filter((x) => x.status === "published" || x.status === "closed").sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
    const live = this.draft.filter((a) => c && a.cycle_id === c.id && a.role === "performer" && !["draft", "dropped", "swapped_out", "cancelled_approved"].includes(a.status));
    const pts = (id: string) => live.filter((a) => a.soldier_id === id).reduce((n, a) => n + a.normalized_points, 0);
    const active = this.soldierList.filter((s) => s.is_active);
    const gafs = [...new Set(active.map((s) => s.gaf_name))].sort();
    const pops = (["career", "mandatory"] as const).map((pop) => {
      const v = active.filter((s) => s.service_type === pop).map((s) => pts(s.id));
      return { population: pop, soldiers: v.length, mean: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : 0,
        min: v.length ? Math.min(...v) : 0, max: v.length ? Math.max(...v) : 0, without: v.filter((x) => x === 0).length };
    });
    const planning = this.cycleList.find((x) => x.status !== "published" && x.status !== "closed");
    return {
      cycle: c ? { id: c.id, name: c.name, start_date: c.start_date, end_date: c.end_date } : null,
      planning: planning ? { name: planning.name, status: planning.status, deadline: planning.exemption_deadline } : null,
      by_gaf: gafs.map((g) => {
        const ss = active.filter((s) => s.gaf_name === g);
        return { gaf: g, soldiers: ss.length, duties: live.filter((a) => ss.some((s) => s.id === a.soldier_id)).length, points: ss.reduce((n, s) => n + pts(s.id), 0) };
      }),
      by_population: pops,
      requests: { pending: this.exemptionList.filter((e) => e.status === "pending").length, urgent: this.exemptionList.filter((e) => e.status === "pending" && e.is_urgent).length,
        by_soldiers: this.exemptionList.filter((e) => e.status === "pending" && e.source === "soldier").length },
      accounts: { soldiers: active.length, with_account: this.accounts.size + 1 },
      settings_changes: [
        { at: new Date(Date.now() - 2 * 86_400_000).toISOString(), action: "update", entity: "score_multipliers", name: "סוף שבוע", by: "naat" },
        { at: new Date(Date.now() - 9 * 86_400_000).toISOString(), action: "update", entity: "task_types", name: "קצין תורן", by: "naat" },
        { at: new Date(Date.now() - 20 * 86_400_000).toISOString(), action: "insert", entity: "calendar_days", name: "2027-04-22", by: "naat" },
      ],
    };
  }

  async myNotifications() {
    await delay();
    return this.user?.roles.includes("soldier") ? this.notes.map((n) => ({ ...n })) : [];
  }

  async markNotificationsRead(ids: string[] | null) {
    for (const n of this.notes) if (!ids || ids.includes(n.id)) n.read_at ??= new Date().toISOString();
  }

  async ackNotification(id: string) {
    const n = this.notes.find((x) => x.id === id);
    if (n) Object.assign(n, { acked_at: new Date().toISOString(), read_at: n.read_at ?? new Date().toISOString() });
  }

  async vapidPublicKey() {
    return null;
  }

  async savePushSubscription() {}

  async deletePushSubscription() {}

  async scoringRules() {
    await delay();
    const cat = new Map(CATEGORIES.map((c) => [c.id, c.name]));
    return {
      tasks: this.tasks
        .filter((t) => !t.is_special && t.is_active !== false)
        .map((t) => ({ name: t.name, weight: t.weight, includes_holidays: !!t.includes_holidays, weekend_type: !!t.is_weekend_type, category: (t.category_id && cat.get(t.category_id)) || null })),
      additions: this.multipliers.filter((m) => m.is_active).map((m) => ({ name: m.name, value: m.value })).sort((a, b) => b.value - a.value),
      surprise_multiplier: this.scoring.surprise_multiplier,
      surprise_notice_hours: this.scoring.surprise_notice_hours,
      window_months: 6,
      fairness_tolerance_pct: this.scoring.fairness_tolerance_pct,
      credit_min_days: 7,
    };
  }

  async myScores() {
    await delay();
    const me = this.mySoldier();
    const mine = this.soldierList.find((s) => s.id === me);
    return this.cycleList
      .filter((c) => c.status === "published" || c.status === "closed")
      .sort((a, b) => b.start_date.localeCompare(a.start_date))
      .map((c) => {
        const peers = this.soldierList.filter((s) => s.is_active && s.service_type === mine?.service_type);
        const pts = (id: string) =>
          this.draft.filter((a) => a.cycle_id === c.id && a.soldier_id === id && a.role === "performer" && a.status !== "draft").reduce((n, a) => n + a.normalized_points, 0);
        const mean = peers.length ? peers.reduce((n, s) => n + pts(s.id), 0) / peers.length : null;
        return {
          cycle_id: c.id, cycle_name: c.name, start_date: c.start_date, end_date: c.end_date,
          duties: this.draft.filter((a) => a.cycle_id === c.id && a.soldier_id === me && a.role === "performer" && a.status !== "draft").length,
          points: me ? pts(me) : 0, group_label: mine?.service_type === "career" ? "קבע" : "חובה", group_size: peers.length,
          group_mean: mean === null ? null : Math.round(mean * 100) / 100,
        };
      });
  }

  async unpublishCycle(cycleId: string) {
    await delay(300);
    const c = this.cycleList.find((x) => x.id === cycleId)!;
    if (c.status !== "published") throw new Error("המחזור לא במצב \"פורסם\"");
    Object.assign(c, { status: "review", published_at: null });
    const mine = this.draft.filter((a) => a.cycle_id === cycleId && (a.status === "assigned" || a.status === "reserve_idle"));
    mine.forEach((a) => (a.status = "draft"));
    return mine.length;
  }
}
