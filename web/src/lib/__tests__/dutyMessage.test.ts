import { describe, expect, it } from "vitest";
import { dutyMessageText, type DutyMessage } from "../dutyMessage";

const base: DutyMessage = {
  soldier_id: "s1",
  full_name: "דניאל פרץ",
  phone: "972501234567",
  has_account: false,
  code: "ABCDE-FGHJK",
  duties: [
    {
      assignment_id: "a1",
      task_name: "מטבח",
      role: "performer",
      starts_at: "2026-11-24T06:00:00Z",
      ends_at: "2026-11-24T18:00:00Z",
      brief: "התייצבות יום ב׳ 24.11 07:30, שער ראשי",
    },
  ],
};
const origin = "https://example.test";

describe("dutyMessageText", () => {
  it("one duty as performer, with the briefing line and the join link", () => {
    const t = dutyMessageText(base, origin);
    expect(t.startsWith("היי דניאל, שובצת למשימה:")).toBe(true);
    expect(t).toContain("מטבח – ");
    expect(t).toContain("08:00–20:00 (מבצע)");
    expect(t).toContain("התייצבות יום ב׳ 24.11 07:30, שער ראשי");
    expect(t).toContain(`${origin}/?join=1&code=ABCDE-FGHJK`);
    expect(t.endsWith('נא לאשר שקיבלת – תענה "קיבלתי".')).toBe(true);
  });

  it("reserve, no briefing: no empty lines for missing data", () => {
    const t = dutyMessageText({ ...base, duties: [{ ...base.duties[0], role: "reserve", brief: null }] }, origin);
    expect(t).toContain("(עתודה)");
    expect(t).not.toContain("התייצבות");
    expect(t.split("\n")).toHaveLength(5);
  });

  it("the duty's note, on one line under the briefing", () => {
    const t = dutyMessageText({ ...base, duties: [{ ...base.duties[0], note: "להגיע עם נשק אישי\nוכובע" }] }, origin);
    const lines = t.split("\n");
    expect(lines[lines.indexOf("התייצבות יום ב׳ 24.11 07:30, שער ראשי") + 1]).toBe("הערה: להגיע עם נשק אישי · וכובע");
  });

  it("several duties: plural greeting, each on its own", () => {
    const t = dutyMessageText({ ...base, duties: [base.duties[0], { ...base.duties[0], assignment_id: "a2", task_name: "שער" }] }, origin);
    expect(t).toContain("שובצת למשימות:");
    expect(t).toContain("שער – ");
  });

  it("an account holder gets the app link instead of a code", () => {
    const t = dutyMessageText({ ...base, has_account: true, code: null }, origin);
    expect(t).not.toContain("join=1");
    expect(t).toContain(`"ראיתי" בתורנצ׳יק: ${origin}`);
  });
});

describe("dutyLine", () => {
  it("overnight and several days", async () => {
    const { dutyLine } = await import("../dutyMessage");
    const d = base.duties[0];
    expect(dutyLine({ ...d, starts_at: "2026-11-24T18:00:00Z", ends_at: "2026-11-25T06:00:00Z" })).toContain("20:00–08:00 למחרת");
    expect(dutyLine({ ...d, starts_at: "2026-11-20T10:00:00Z", ends_at: "2026-11-22T06:00:00Z" })).toMatch(/12:00 עד יום א׳ 22\.11 08:00/);
  });
});
