import { describe, expect, test } from "vitest";
import { dmyToIso, isoToDmy } from "../dmy";

describe("dd/mm/yyyy", () => {
  test("shows day first", () => {
    expect(isoToDmy("2026-11-05")).toBe("05/11/2026");
    expect(isoToDmy("2026-11-05T08:30")).toBe("05/11/2026 08:30");
    expect(isoToDmy("")).toBe("");
  });
  test("reads day first, in the usual ways", () => {
    expect(dmyToIso("5/11/2026")).toBe("2026-11-05");
    expect(dmyToIso("05.11.26")).toBe("2026-11-05");
    expect(dmyToIso("05112026")).toBe("2026-11-05");
    expect(dmyToIso("05/11/2026 8:30", true)).toBe("2026-11-05T08:30");
  });
  test("not a real date", () => {
    expect(dmyToIso("31/02/2026")).toBeNull();
    expect(dmyToIso("11/25/2026")).toBeNull(); // month first
    expect(dmyToIso("05/11/20")).toBe("2020-11-05");
    expect(dmyToIso("05/11/2026", true)).toBeNull();
    expect(dmyToIso("05/11/2026 25:00", true)).toBeNull();
  });
});
