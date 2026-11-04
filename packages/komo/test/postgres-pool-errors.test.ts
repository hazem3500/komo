import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { postgresDatabase } from "../server/postgres";

// node-postgres reports an idle connection the database closes as a pool "error" event; with
// no listener, Node treats it as uncaught and the server exits.
it("survives the database closing an idle connection", () => {
  const pools: EventEmitter[] = [];
  class Pool extends EventEmitter { constructor() { super(); pools.push(this); } }
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  postgresDatabase("postgres://example.invalid/db", { Pool } as never);
  const terminated = Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" });
  expect(() => pools[0]!.emit("error", terminated)).not.toThrow();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("57P01"));
  warn.mockRestore();
});
