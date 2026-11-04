import { rm } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { expandPackages, packageDirectory, typeComparedNames } from "../vite/packages.mjs";
import { fixtureApp } from "./instrument-build.js";

let directory: string, app: string;
beforeAll(async () => ({ directory, app } = await fixtureApp(19)), 60_000);
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

it("expands a package glob to the subpaths its exports map lists", async () => {
  expect(await expandPackages(["@fixture/ui/*", "@other/kit"], app)).toEqual({ specifiers: ["@fixture/ui", "@fixture/ui/extras", "@other/kit"], warnings: [] });
  expect((await expandPackages(["@missing/ds/*"], app)).warnings).toEqual(["@missing/ds/*: package not found"]);
});

it("finds the components a package compares by element type", async () => {
  const names = await typeComparedNames(packageDirectory("@fixture/ui", app)!);
  expect([...names]).toEqual([["ListItem", "extras.js"]]);
});
