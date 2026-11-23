import { describe, expect, it } from "vitest";
import { countByStatus, deviceOf, draftProblem, screenLabel, type FeedbackItem } from "../feedback";

describe("feedback", () => {
  it("needs some text, up to 1000", () => {
    expect(draftProblem({ body: "  " })).toBeTruthy();
    expect(draftProblem({ body: "רעיון" })).toBeNull();
    expect(draftProblem({ body: "א".repeat(1001) })).toContain("1,000");
  });
  it("the screen by its name, the device by the window", () => {
    expect(screenLabel("/my")).toBe("המשימות שלי");
    expect(screenLabel("/cycle/draft")).toBe("מחזור");
    expect(screenLabel("/x")).toBe("/x");
    expect(deviceOf(400, false)).toBe("phone");
    expect(deviceOf(1400, true)).toBe("phone");
    expect(deviceOf(1400, false)).toBe("desktop");
  });
  it("counts by status", () => {
    const i = (status: FeedbackItem["status"]) => ({ status }) as FeedbackItem;
    expect(countByStatus([i("new"), i("new"), i("done")])).toEqual({ new: 2, in_progress: 0, done: 1, wont: 0 });
  });
});
