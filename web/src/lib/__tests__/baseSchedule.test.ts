import { describe, expect, it } from "vitest";
import type { TaskType } from "../catalog";
import { buildSlots, findHeader, genderHint, parseRanks, readRows, resolveDuty, slotTimes, weekendVariant } from "../baseSchedule";

const RANKS = ["טוראי", "רב\"ט", "סמל", "סמ\"ר", "רס\"ל", "רס\"ר", "רס\"מ", "רס\"ב", "רנ\"ג", "סג\"מ", "סגן", "קמ\"א", "סרן", "רס\"ן", "סא\"ל"].map((name, i) => ({
  id: `r${i}`,
  name,
  sort_order: name === "קמ\"א" ? 11 : i < 12 ? i + 1 : i,
}));
RANKS.push({ id: "civ", name: "אזרח עובד צה\"ל", sort_order: 50 });
const id = (n: string) => RANKS.find((r) => r.name === n)!.id;

const task = (id: string, name: string, o: Partial<TaskType> = {}): TaskType => ({
  id, code: id, name, category_id: "c", weight: 1, min_rest_hours: 0, service_restriction: "any", requires_weapon: false,
  is_weekend_type: false, includes_holidays: false, shachar_compatible: false, qualifying_duty: false, allowed_rank_ids: null,
  gender: null, default_start_time: "08:00", default_end_time: "08:00", weekday_hours: null, color: null, is_active: true, ...o,
}) as TaskType;
const TASKS = [
  task("kt", "קצין תורן – חול", { category_id: "kt" }),
  task("kts", "קצין תורן – שבת", { category_id: "kt", is_weekend_type: true }),
  task("khs", "ק. הגנ\"ק – שבת", { category_id: "kt", is_weekend_type: true }),
  task("shmira", "שמירות חובה", { default_start_time: "13:00", default_end_time: "13:00" }),
  task("mm", "ממלכ\"ת יום – חול", { default_start_time: "08:00", default_end_time: "17:00" }),
  task("ch", "משימות חיילות"),
];

describe("ranks column", () => {
  it("reads military rank names as the neutral names' aliases", () => {
    const neutral = [
      { id: "a", name: "חובה 3", sort_order: 3, aliases: ["סמל"] },
      { id: "b", name: "חובה 4", sort_order: 4, aliases: ['סמ"ר'] },
      { id: "c", name: "מקצועי 1", sort_order: 5, aliases: ['רס"ל'] },
      { id: "d", name: "בכיר 1", sort_order: 13, aliases: ['רס"ן'] },
    ];
    expect(parseRanks('סמל - רס"ל', neutral).rankIds?.sort()).toEqual(["a", "b", "c"]);
    expect(parseRanks('רס"ן', neutral).rankIds).toEqual(["d"]);
    expect(parseRanks("בכיר 1", neutral).rankIds).toEqual(["d"]);
  });
  it("all ranks / empty = no restriction", () => {
    expect(parseRanks("כלל הדרגות", RANKS).rankIds).toBeNull();
    expect(parseRanks("", RANKS).rankIds).toBeNull();
    expect(parseRanks("מבצעים אמהות/אבות במשרת הורה, אנשי קבע בעלי פטור רפואי - כלל הדרגות", RANKS).rankIds).toBeNull();
  });
  it("single rank and appointment", () => {
    expect(parseRanks("רס\"ן", RANKS).rankIds).toEqual([id("רס\"ן")]);
    expect(parseRanks("רס\"ן, סרן במינוי רס\"ן", RANKS)).toEqual({ rankIds: [id("רס\"ן")], unknown: [], homeNightly: false });
  });
  it("a list of ranges", () => {
    const r = parseRanks("סמל - רס\"ל, סג\"מ - סגן, קמ\"א", RANKS);
    expect(new Set(r.rankIds)).toEqual(new Set(["סמל", "סמ\"ר", "רס\"ל", "סג\"מ", "סגן", "קמ\"א"].map(id)));
    expect(r.unknown).toEqual([]);
    expect(new Set(parseRanks("סגן- סרן", RANKS).rankIds)).toEqual(new Set(["סגן", "קמ\"א", "סרן"].map(id)));
  });
  it("reports names it does not know, keeps the rest", () => {
    const r = parseRanks("רס\"ר-רס\"מ, סרן, קא\"ב", RANKS);
    expect(new Set(r.rankIds)).toEqual(new Set(["רס\"ר", "רס\"מ", "סרן"].map(id)));
    expect(r.unknown).toEqual(["קא\"ב"]);
  });
  it("ת\"ש 7 is not a rank: it marks the slot for soldiers home every night", () => {
    expect(parseRanks("ת\"ש 7", RANKS)).toEqual({ rankIds: null, unknown: [], homeNightly: true });
    expect(parseRanks("סמל - רס\"ל, תש 7", RANKS).homeNightly).toBe(true);
    expect(parseRanks("סמל - רס\"ל, תש 7", RANKS).unknown).toEqual([]);
  });
  it("gershayim variants", () => {
    expect(parseRanks("רס״ן", RANKS).rankIds).toEqual([id("רס\"ן")]);
  });
});

describe("duties", () => {
  it("resolves by alias, then by name without the חול/שבת suffix", () => {
    expect(resolveDuty("אמ\"ת גבעת המורה", [{ alias: "אמ\"ת גבעת המורה", task_type_id: "ch" }], TASKS)).toBe("ch");
    expect(resolveDuty("קצין תורן", [], TASKS)).toBe("kt");
    expect(resolveDuty("שמירות  חובה", [], TASKS)).toBe("shmira");
    expect(resolveDuty("ש.ג דרום 7-11", [], TASKS)).toBeNull();
  });
  it("switches to the Shabbat type on weekend days", () => {
    expect(weekendVariant("kt", "2026-07-10", TASKS, [5, 6])).toBe("kts"); // Friday
    expect(weekendVariant("kt", "2026-07-09", TASKS, [5, 6])).toBe("kt"); // Thursday
    expect(weekendVariant("kts", "2026-07-08", TASKS, [5, 6])).toBe("kt");
    expect(weekendVariant("shmira", "2026-07-10", TASKS, [5, 6])).toBe("shmira"); // no sibling
  });
  it("gender from the instructions", () => {
    expect(genderHint("משימת מרלו\"ג, יש להקצות בנים בלבד")).toBe("male");
    expect(genderHint("התייצבות 09:00")).toBeNull();
  });
});

describe("daily hours", () => {
  it("a day duty over several days is worked those hours each day", async () => {
    const { dailyHours } = await import("../baseSchedule");
    expect(dailyHours("2026-12-15", "2026-12-22", { default_start_time: "08:00", default_end_time: "17:00" })).toBe("08:00-17:00");
    expect(dailyHours("2026-12-15", "2026-12-15", { default_start_time: "08:00", default_end_time: "17:00" })).toBeNull();
    expect(dailyHours("2026-12-15", "2026-12-22", { default_start_time: "13:00", default_end_time: "13:00" })).toBeNull();
  });
});

describe("hours by weekday, briefing, population", () => {
  it("מפקד תורן: hours depend on the day and on a holiday the day before", async () => {
    const { slotTimes } = await import("../baseSchedule");
    const mt = { default_start_time: "08:00", default_end_time: "08:00", weekday_hours: { "0": "06:00-08:00+1", "1": "08:00-08:00", "4": "08:00-18:00", after_holiday: "06:00-08:00+1" } };
    expect(slotTimes("2027-01-03", "2027-01-03", mt)).toEqual({ starts_at: "2027-01-03T06:00:00+02:00", ends_at: "2027-01-04T08:00:00+02:00" }); // Sunday
    expect(slotTimes("2027-01-07", "2027-01-07", mt)).toEqual({ starts_at: "2027-01-07T08:00:00+02:00", ends_at: "2027-01-07T18:00:00+02:00" }); // Thursday
    expect(slotTimes("2027-01-05", "2027-01-05", mt).starts_at).toBe("2027-01-05T08:00:00+02:00"); // Tuesday: defaults
    expect(slotTimes("2027-04-29", "2027-04-29", mt, new Set(["2027-04-28"])).starts_at).toBe("2027-04-29T06:00:00+03:00"); // after a holiday
  });
  it("briefing from the instructions", async () => {
    const { parseBriefing } = await import("../baseSchedule");
    const guard = "התייצבות לתדריך ביום שלישי בגף הגנ\"ק בשעה 13:00, התדריכים מעודכנים מידי שבוע";
    expect(parseBriefing(guard, "2027-01-06")).toEqual({ at: "2027-01-05T13:00:00+02:00", ignored: false }); // Wed start → Tue
    expect(parseBriefing("התייצבות לתדריך בשעה 09:00 ביום שלישי בגף אבטחה פיזית", "2027-01-03")).toEqual({ at: null, ignored: true }); // Sun start, Tue is 5 days back
    expect(parseBriefing("ביצוע תדריך טלפוני מול מ\"ג תזונה בשעה 11:00", "2027-01-05")).toEqual({ at: null, ignored: false });
    expect(parseBriefing("התייצבות בשעה 09:00 ברס\"ר", "2027-01-05")).toEqual({ at: null, ignored: false });
  });
  it("population column against the duty type", async () => {
    const { populationMismatch } = await import("../baseSchedule");
    expect(populationMismatch("חובה", { service_restriction: "career" })).toBe(true);
    expect(populationMismatch("קצינים ונגדים", { service_restriction: "mandatory" })).toBe(true);
    expect(populationMismatch("קצינים ונגדים", { service_restriction: "any" })).toBe(false);
    expect(populationMismatch("משימות חיליות", { service_restriction: "mandatory" })).toBe(false);
  });
});

describe("times", () => {
  it("one-day duty 08:00–08:00 ends next morning; week duty ends on the end date", () => {
    expect(slotTimes("2026-07-05", "2026-07-05", TASKS[0])).toEqual({ starts_at: "2026-07-05T08:00:00+03:00", ends_at: "2026-07-06T08:00:00+03:00" });
    expect(slotTimes("2026-07-01", "2026-07-08", TASKS[3])).toEqual({ starts_at: "2026-07-01T13:00:00+03:00", ends_at: "2026-07-08T13:00:00+03:00" });
    expect(slotTimes("2026-07-12", "2026-07-12", TASKS[4]).ends_at).toBe("2026-07-12T17:00:00+03:00");
    expect(slotTimes("2027-01-12", "2027-01-12", TASKS[4]).starts_at).toBe("2027-01-12T08:00:00+02:00");
  });
});

describe("the base file", () => {
  // rows as in the base's file (after an earlier schedule, so names are filled in)
  const file: unknown[][] = [
    ["אוכלוסיה", "תאריך התחלה", "תאריך סיום", "חג", "משימה", "מבצע", "גף", "עתודה", "גף", "דרגות", "הנחיות", "הערות"],
    ["משימות חיליות", "14/06/2026", "21/06/2026", "X", "אמ\"ת גבעת המורה", "עופרי חרפוף", "תמנע", "", "", "סגן- סרן", "התייצבות עד השעה 10:00 בבוקר", ""],
    [],
    ["חובה", "28/06/2026", "02/07/2026", "X", "רס\"ר", "שחר שרעבי", "קרן אור", "איתי חנה", "קרן אור", "כלל הדרגות", "משימת מרלו\"ג, יש להקצות בנים בלבד", "מור סנגבי 050-0000000"],
    ["קצינים ונגדים", "05/07/2026", "05/07/2026", "X", "קצין תורן", "יוסף קטרי", "תמונא", "נועם כהן", "תמונא", "רס\"ר-רס\"מ, סרן, קא\"ב", "התייצבות בשעה 09:00 ברס\"ר", ""],
    ["קצינים ונגדים", "10/07/2026", "10/07/2026", "X", "קצין תורן", "", "", "", "", "רס\"ר-רס\"מ, סרן", "", ""],
    ["קצינים ונגדים", "05/07/2026", "07/07/2026", "X", "ש.ג דרום 7-11", "", "", "", "", "סמל - רס\"ל, סג\"מ - סגן, קמ\"א", "", ""],
    ["חובה", "13/07/2026", "20/07/2026", "", "שמירות חובה", "", "", "", "", "כלל הדרגות", "", ""],
    ["חובה", "31/02/2026", "", "X", "שמירות חובה", "", "", "", "", "", "", ""],
  ];
  it("reads only the date and the duty type; other columns are ignored", () => {
    expect(findHeader(file)?.columns).toEqual({ start: 1, duty: 4 });
    const r = readRows(file);
    expect(r.rows).toHaveLength(6);
    expect(r.errors).toEqual([{ line: 9, message: "שמירות חובה: מועד לא תקין" }]);
    expect(r.rows[0]).toMatchObject({ start: "2026-06-14", end: "2026-06-14", ranksText: "", instructions: "" });
  });
  it("a note column: kept as written, lines tidied, not read for times or gender", () => {
    const r = readRows([
      ["מועד", "סוג משימה", "הערה"],
      ["05/07/2026", "קצין תורן", "  להגיע   עם נשק אישי \r\n\r\n התייצבות לתדריך ביום שלישי בשעה 13:00, בנים בלבד "],
      ["06/07/2026", "קצין תורן", ""],
      ["07/07/2026", "קצין תורן", "א".repeat(301)],
    ]);
    expect(findHeader([["מועד", "סוג משימה", "דגשים"]])?.columns).toEqual({ start: 0, duty: 1, note: 2 });
    // "הערות" in the base's file holds phones – never read as the public note
    expect(findHeader([["מועד", "סוג משימה", "הערות"]])?.columns).toEqual({ start: 0, duty: 1 });
    expect(r.rows.map((x) => x.instructions)).toEqual(["להגיע עם נשק אישי\nהתייצבות לתדריך ביום שלישי בשעה 13:00, בנים בלבד", ""]);
    expect(r.errors).toEqual([{ line: 4, message: "קצין תורן: הערה ארוכה מ-300 תווים" }]);
    const res = buildSlots(r.rows, { aliases: [], tasks: TASKS, ranks: RANKS, weekendIsoDays: [5, 6], cycle: { start_date: "2026-06-20", end_date: "2026-12-31" } });
    expect(res.slots[0]).toMatchObject({ instructions: "להגיע עם נשק אישי\nהתייצבות לתדריך ביום שלישי בשעה 13:00, בנים בלבד", briefing_at: null, gender: null });
    expect(res.slots[1].instructions).toBeNull();
  });
  it("a two-column file (מועד, סוג משימה)", () => {
    const r = readRows([["מועד", "סוג משימה"], ["05/07/2026", "קצין תורן"], ["", ""], ["13/07/2026", "שמירות חובה"]]);
    expect(r.rows.map((x) => [x.start, x.duty])).toEqual([["2026-07-05", "קצין תורן"], ["2026-07-13", "שמירות חובה"]]);
  });
  it("builds slots for the cycle and lists unmapped duties", () => {
    const { rows } = readRows(file);
    const res = buildSlots(rows, {
      aliases: [{ alias: "אמ\"ת גבעת המורה", task_type_id: "ch" }],
      tasks: TASKS,
      ranks: RANKS,
      weekendIsoDays: [5, 6],
      cycle: { start_date: "2026-06-20", end_date: "2026-12-31" },
      holidays: new Set(["2026-07-05"]),
    });
    expect(res.outside.map((r) => r.line)).toEqual([2]); // starts before the cycle
    expect(res.unmapped).toEqual([
      { duty: "רס\"ר", count: 1, population: "" },
      { duty: "ש.ג דרום 7-11", count: 1, population: "" },
    ]);
    expect(res.slots.map((s) => s.task_type_id)).toEqual(["kt", "kts", "shmira"]);
    // who may do it comes from the duty type, not the file
    expect(res.slots.every((s) => s.allowed_rank_ids === null && s.instructions === null)).toBe(true);
    expect(res.slots[1].weekendSwitched).toBe(true);
    // one occurrence from the date, with the duty type's hours
    expect(res.slots[2].starts_at.slice(0, 10)).toBe("2026-07-13");
  });
});

describe("Excel dates", () => {
  it("reads date cells exactly, in any time zone", async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([["תאריך התחלה", "משימה"], [46362, "קצין תורן"]]);
    ws["A2"].t = "n";
    ws["A2"].z = "dd/mm/yyyy";
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "x");
    const back = XLSX.read(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const rows = XLSX.utils.sheet_to_json<unknown[]>(back.Sheets.x, { header: 1, raw: true, defval: "" });
    expect(readRows(rows).rows[0].start).toBe("2026-12-06");
  });
  it("a Date a few seconds before midnight is the next day", async () => {
    const { toIsoDate } = await import("../roster");
    expect(toIsoDate(new Date(2026, 11, 5, 23, 59, 20))).toBe("2026-12-06");
    expect(toIsoDate(new Date(2026, 11, 6, 0, 0, 0))).toBe("2026-12-06");
  });
});
