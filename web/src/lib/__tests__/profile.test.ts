import { expect, test } from "vitest";
import { dmy, scoreWords, tashText } from "../profile";

test("ת״ש in words", () => {
  expect(tashText(5, false)).toEqual({ value: "סוג 5", means: "עד 2 לילות בשבוע בבסיס" });
  expect(tashText(0, true).value).toBe("ת״ש 7");
  expect(tashText(0, false).value).toBe("אין");
  expect(dmy("2026-12-01")).toBe("01/12/2026");
});

test("scoreWords says where the score stands against the average", () => {
    expect(scoreWords(10, null)).toBeNull();
    expect(scoreWords(83.5, 83.1)).toMatch(/^בדיוק בממוצע/);
    expect(scoreWords(88.1, 83.1)).toBe("מעט מעל הממוצע – המנוע ישבץ אותך קצת פחות בהמשך.");
    expect(scoreWords(110, 83.1)).toBe("מעל הממוצע – המנוע ישבץ אותך פחות בהמשך.");
    expect(scoreWords(3.5, 4.1)).toBe("מעט מתחת לממוצע – סביר שתשובץ קצת יותר בהמשך.");
    expect(scoreWords(40, 83)).toBe("מתחת לממוצע – סביר שתשובץ יותר בהמשך.");
});
