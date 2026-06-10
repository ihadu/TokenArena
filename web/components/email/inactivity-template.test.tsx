import { describe, expect, it } from "vitest";
import { renderInactivityEmailTemplate } from "./inactivity-template";

describe("renderInactivityEmailTemplate", () => {
  it("renders the subject and username in body for English locale", () => {
    const html = renderInactivityEmailTemplate({
      username: "alice",
      inactiveDays: 5,
      lastActiveAt: new Date("2026-06-05T00:00:00Z"),
      subject: "We miss you on Token Arena",
      locale: "en",
    });
    expect(html).toContain("alice");
    expect(html).toContain("We miss you on Token Arena");
  });
  it("renders Chinese text for zh locale", () => {
    const html = renderInactivityEmailTemplate({
      username: "张三",
      inactiveDays: 5,
      lastActiveAt: new Date("2026-06-05T00:00:00Z"),
      subject: "Token Arena 想你了",
      locale: "zh",
    });
    expect(html).toContain("张三");
    expect(html).toContain("Token Arena");
  });
});
