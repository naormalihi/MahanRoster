import { describe, expect, it } from "vitest";
import { contactProblems, toSave } from "../contacts";

describe("contacts", () => {
  it("needs a name and a valid mobile number when one is written", () => {
    expect(contactProblems([{ user_id: "a", display_name: " ", phone: null }])).toEqual(["שורה 1: חסר שם"]);
    expect(contactProblems([{ user_id: "a", display_name: "נעה", phone: "123" }])).toEqual(["נעה: מספר טלפון לא תקין"]);
    expect(contactProblems([{ user_id: "a", display_name: "נעה", phone: "050-000-0001" }])).toEqual([]);
    expect(contactProblems([{ user_id: "a", display_name: "נעה", phone: "" }])).toEqual([]);
  });

  it("saves the phone as 9725…, or null to use the soldier card", () => {
    expect(toSave([{ user_id: "a", display_name: " נעה ", phone: "050-000-0001" }, { user_id: "b", display_name: "עידו", phone: "" }])).toEqual([
      { user_id: "a", display_name: "נעה", phone: "972500000001" },
      { user_id: "b", display_name: "עידו", phone: null },
    ]);
  });
});
