import { describe, expect, it } from "vitest";
import { changeNotice, isSharingLevel, SHARING_LEVELS, SHARING_OPTIONS } from "./data-sharing";

describe("OPS-04: data sharing wording", () => {
  it("knows the three levels and nothing else", () => {
    expect(SHARING_LEVELS.every(isSharingLevel)).toBe(true);
    expect(isSharingLevel("all")).toBe(false);
    expect(isSharingLevel(undefined)).toBe(false);
  });

  it("says nothing when nothing changes", () => {
    for (const l of SHARING_LEVELS) expect(changeNotice(l, l)).toBeNull();
  });

  it("says plainly that identified data is deleted when switching to none", () => {
    expect(changeNotice("identified", "none")).toContain("every event already stored with your business name is deleted");
    expect(changeNotice("anonymous", "none")).toContain("cannot be found or deleted");
  });

  it("says the name is removed when going from identified to anonymous", () => {
    expect(changeNotice("identified", "anonymous")).toContain("business name is removed");
  });

  it("uses no em dashes in any of its copy", () => {
    const copy = [...Object.values(SHARING_OPTIONS).flatMap((o) => [o.label, o.description])];
    for (const a of SHARING_LEVELS) for (const b of SHARING_LEVELS) copy.push(changeNotice(a, b) ?? "");
    expect(copy.join(" ")).not.toMatch(/—/);
  });
});

describe("OPS-04: opt-in", () => {
  it("starts at none", async () => {
    const { DEFAULT_SHARING } = await import("./data-sharing");
    expect(DEFAULT_SHARING).toBe("none");
  });

  it("confirms a first answer of none in plain words", async () => {
    const { savedMessage } = await import("./data-sharing");
    expect(savedMessage("none", "none")).toBe("Saved. Nothing is shared from your business.");
    expect(savedMessage(null, "anonymous")).toBe("Saved.");
    expect(savedMessage("none", "anonymous")).toBe("Saved. Anonymous sharing starts now.");
    expect(savedMessage("identified", "none")).toContain("deleted");
  });
});
