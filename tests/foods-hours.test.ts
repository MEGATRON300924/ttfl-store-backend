import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isWithinConfiguredHours } from "../src/modules/foods/foods-hours";

const week = (overrides: Record<number, { isOpen: boolean; openTime: string | null; closeTime: string | null }>) =>
  Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isOpen: overrides[dayOfWeek]?.isOpen ?? false,
    openTime: overrides[dayOfWeek]?.openTime ?? null,
    closeTime: overrides[dayOfWeek]?.closeTime ?? null,
  }));

describe("Foods opening hours", () => {
  it("keeps existing restaurants orderable when no hours are configured", () => {
    assert.equal(isWithinConfiguredHours(week({}), new Date("2026-11-19T10:00:00Z"), false), true);
  });

  it("rejects orders when a configured schedule has every day closed", () => {
    assert.equal(isWithinConfiguredHours(week({}), new Date("2026-11-19T10:00:00Z"), true), false);
  });

  it("allows orders inside Africa/Lagos opening hours", () => {
    const hours = week({ 4: { isOpen: true, openTime: "09:00", closeTime: "18:00" } });
    assert.equal(isWithinConfiguredHours(hours, new Date("2026-11-19T10:00:00Z")), true);
  });

  it("rejects orders after closing time", () => {
    const hours = week({ 4: { isOpen: true, openTime: "09:00", closeTime: "18:00" } });
    assert.equal(isWithinConfiguredHours(hours, new Date("2026-11-19T18:30:00Z")), false);
  });

  it("supports overnight opening windows across midnight", () => {
    const hours = week({ 3: { isOpen: true, openTime: "18:00", closeTime: "02:00" } });
    assert.equal(isWithinConfiguredHours(hours, new Date("2026-11-19T00:30:00Z")), true);
  });

  it("rejects orders on a configured closed day", () => {
    const hours = week({ 4: { isOpen: true, openTime: "09:00", closeTime: "18:00" } });
    assert.equal(isWithinConfiguredHours(hours, new Date("2026-11-20T10:00:00Z")), false);
  });
});
