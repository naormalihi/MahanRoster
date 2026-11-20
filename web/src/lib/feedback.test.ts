import { describe, expect, it } from "vitest";
import { openLabel } from "./feedback";

describe("feedback on the home screen", () => {
  it("says what still waits", () => {
    expect(openLabel(1, 0)).toBe("חדשה אחת");
    expect(openLabel(3, 2)).toBe("3 חדשות · 2 בטיפול");
    expect(openLabel(0, 1)).toBe("1 בטיפול");
  });
});
