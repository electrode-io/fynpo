import { describe, it, expect } from "@jest/globals";
import { deconstructMM, unrollMmMatch } from "../src/minimatch-group";
import mm from "minimatch";

describe("deconstructMM", function () {
  //
  it("should return two patterns for src/**", () => {
    const r = deconstructMM(new mm.Minimatch("src/**"));
    expect(r.mms.length).toBe(2);
    expect(r.mms[0].set[0]).toStrictEqual(["src"]);
    expect(r.mms[1].set[0]).toStrictEqual(["src", (mm as any).GLOBSTAR]);
  });

  it("should return one pattern for all strings", () => {
    const r = deconstructMM(new mm.Minimatch("src/abc/def"));
    expect(r.mms.length).toBe(1);
    expect(r.mms[0].set[0]).toStrictEqual(["src", "abc", "def"]);
  });
});

describe("unrollMmMatch", function () {
  it("should handle path with only one part", () => {
    const m0 = new mm.Minimatch("src");
    const m1 = new mm.Minimatch("src/**");
    const t1 = "src";
    expect(m0.match(t1)).toBe(true);
    expect(m1.match(t1)).toBe(false);
    expect(unrollMmMatch(t1, [m0])).toBe(true);
    expect(unrollMmMatch(t1, [m1])).toBe(false);
  });

  it("should handle path with two parts", () => {
    const m0 = new mm.Minimatch("src");
    const m1 = new mm.Minimatch("src/**");
    const t1 = "src/a";
    expect(m0.match(t1)).toBe(false);
    expect(m1.match(t1)).toBe(true);
    expect(unrollMmMatch(t1, [m0])).toBe(true);
    expect(unrollMmMatch(t1, [m1])).toBe(true);
  });

  it("should match partial prefix of a path", () => {
    const m0 = new mm.Minimatch("src");
    const m1 = new mm.Minimatch("src/**");
    const t1 = "src/test/a/b/c";
    expect(m0.match(t1)).toBe(false);
    expect(m1.match(t1)).toBe(true);
    expect(unrollMmMatch(t1, [m0])).toBe(true);
    expect(unrollMmMatch(t1, [m1])).toBe(true);
  });

  it("should match the full path only", () => {
    const m1 = new mm.Minimatch("src/**/xyz.js");
    const t1 = "src/test/a/b/c";
    const t2 = "src/test/a/b/c/xyz.js";
    expect(m1.match(t1)).toBe(false);
    expect(m1.match(t2)).toBe(true);
    expect(unrollMmMatch(t1, [m1])).toBe(false);
    expect(unrollMmMatch(t2, [m1])).toBe(true);
  });
});
