import { describe, expect, it } from "vitest";
import { frameSizeRecord, readFrameSize } from "../src/frame-size";

const fallback = { size: "window", actual: false };

describe("remembered Frame size", () => {
  it("defaults to the window at Fit for nothing stored and unreadable values", () => {
    expect(readFrameSize(null)).toEqual(fallback);
    expect(readFrameSize("not json")).toEqual(fallback);
    expect(readFrameSize("[]")).toEqual(fallback);
    expect(readFrameSize('{"v":2,"size":[1,"x"]}')).toEqual(fallback);
    expect(readFrameSize('{"v":2,"size":[100,200,300]}')).toEqual(fallback);
  });

  it("ignores unversioned entries from before the window-at-Fit default", () => {
    // Written by an older version: the old Fit default, a drag or a preset alike.
    expect(readFrameSize('{"size":[879,848],"actual":false}')).toEqual(fallback);
    expect(readFrameSize('{"size":"available","actual":true}')).toEqual(fallback);
    expect(readFrameSize('{"size":null,"actual":true}')).toEqual(fallback);
    expect(readFrameSize('{"v":1,"size":[1440,900],"actual":false}')).toEqual(fallback);
  });

  it("restores versioned choices, clamped to sane viewport bounds", () => {
    expect(readFrameSize('{"v":2,"size":[1440,900],"actual":true}')).toEqual({ size: [1440, 900], actual: true });
    expect(readFrameSize('{"v":2,"size":"available","actual":false}')).toEqual({ size: "available", actual: false });
    expect(readFrameSize('{"v":2,"size":null,"actual":true}')).toEqual({ size: "window", actual: true });
    expect(readFrameSize('{"v":2,"size":[100,9000]}')).toEqual({ size: [240, 2160], actual: false });
    expect(readFrameSize('{"v":2,"size":[9000.4,10]}')).toEqual({ size: [3840, 240], actual: false });
    expect(readFrameSize('{"v":2,"size":[390.6,844.2]}').size).toEqual([391, 844]);
  });

  it("remembers explicit choices and never pins the default", () => {
    expect(frameSizeRecord("window", false)).toBeNull();
    expect(JSON.parse(frameSizeRecord("window", true)!)).toEqual({ v: 2, size: null, actual: true });
    expect(JSON.parse(frameSizeRecord([390, 844], false)!)).toEqual({ v: 2, size: [390, 844], actual: false });
    expect(JSON.parse(frameSizeRecord("available", false)!)).toEqual({ v: 2, size: "available", actual: false });
    // What is written reads back the same.
    for (const [size, actual] of [[[562, 610], false], ["available", true], ["window", true]] as const)
      expect(readFrameSize(frameSizeRecord(size as never, actual))).toEqual({ size, actual });
  });
});
