import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The words the user reads: "מסגרת" and "עובד" – never "גף" or "חייל". The few lines that must
 *  keep the old word read the source system (the HR file, its framework path) or old messages. */
const WORD = /(^|[^א-ת])[והבלמשכ]{0,3}(גף|גפים|גפי|חייל|חיילים|חיילי|חיילת)(?=[^א-ת]|$)/;
const ALLOWED = [
  /synonyms:/, // the HR file's column names
  /\/\^גף/, // reading the framework path
  /replace\(\/\^גף/,
  /\(\?:לעובד\|לחייל\)/, // warnings saved by earlier runs
  /החלק שמתחיל ב"גף"/, // tells where the name is taken from in the file
];
const root = new URL("../..", import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" ? [] : files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) && n !== "changelog.ts" ? [p] : [];
  });
}

describe("wording", () => {
  it("says מסגרת and עובד everywhere the user reads", () => {
    const bad: string[] = [];
    for (const f of files(root)) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments
          if (WORD.test(line) && !ALLOWED.some((a) => a.test(line))) bad.push(`${f.slice(root.length)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
  });
});
