import { describe, expect, it } from "vitest";

import { csvEscape } from "./weekly-export";

describe("csvEscape", () => {
  it("returns plain text unchanged", () => {
    expect(csvEscape("hello")).toBe("hello");
  });

  it("wraps commas in quotes", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
  });

  it("escapes embedded double quotes", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps newlines in quotes", () => {
    expect(csvEscape("a\nb")).toBe('"a\nb"');
  });

  it("wraps carriage returns in quotes", () => {
    expect(csvEscape("a\rb")).toBe('"a\rb"');
  });

  it("returns empty string unchanged", () => {
    expect(csvEscape("")).toBe("");
  });

  it("does not quote email-like strings", () => {
    expect(csvEscape("a@b.c")).toBe("a@b.c");
  });
});
