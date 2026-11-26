import { expect, test } from "vitest";
import { dmy, tashText } from "../profile";

test("ת״ש in words", () => {
  expect(tashText(5, false)).toEqual({ value: "סוג 5", means: "עד 2 לילות בשבוע בבסיס" });
  expect(tashText(0, true).value).toBe("ת״ש 7");
  expect(tashText(0, false).value).toBe("אין");
  expect(dmy("2026-12-01")).toBe("01/12/2026");
});
