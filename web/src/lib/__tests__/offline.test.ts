import { beforeEach, describe, expect, it } from "vitest";
import { clearOffline, isOfflineError, OfflineError, readOffline, saveOffline } from "../offline";
import type { Me } from "../api";

// the tests run in node: a small in-memory localStorage
class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;

const me = (id: string): Me => ({ userId: id, username: id, roles: ["soldier"], mustChangePassword: false });

describe("offline copy", () => {
  beforeEach(() => localStorage.clear());

  it("per user, the last one remembered", () => {
    saveOffline(me("a"), []);
    saveOffline(me("b"), []);
    expect(readOffline("a")?.me.userId).toBe("a");
    expect(readOffline()?.me.userId).toBe("b");
  });

  it("not shown after 14 days", () => {
    const old = new Date("2026-11-01T08:00:00Z");
    saveOffline(me("a"), [], old);
    expect(readOffline("a", new Date("2026-11-14T08:00:00Z"))).not.toBeNull();
    expect(readOffline("a", new Date("2026-11-16T08:00:00Z"))).toBeNull();
  });

  it("sign-out removes every copy", () => {
    saveOffline(me("a"), []);
    localStorage.setItem("other", "x");
    clearOffline();
    expect(readOffline("a")).toBeNull();
    expect(readOffline()).toBeNull();
    expect(localStorage.getItem("other")).toBe("x");
  });

  it("tells no connection from a refusal", () => {
    expect(isOfflineError(new OfflineError())).toBe(true);
    expect(isOfflineError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isOfflineError(new Error("permission denied"))).toBe(false);
  });
});
