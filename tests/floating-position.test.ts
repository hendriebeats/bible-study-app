import { describe, expect, it } from "vitest";

import { placeNearAnchor } from "@/lib/editor/floating-position";

/**
 * Pure-math tests for the shared popup placement helper. Every case passes an
 * explicit `viewport` so the math is deterministic without touching
 * `window.innerWidth/Height`.
 */

const VIEWPORT = { width: 1000, height: 800 };

describe("placeNearAnchor", () => {
  it("places below the anchor by default with a gap", () => {
    const placement = placeNearAnchor(
      { left: 100, top: 100, right: 200, bottom: 120 },
      { width: 200, height: 100 },
      { viewport: VIEWPORT, preferred: "below", gap: 8 },
    );
    expect(placement.side).toBe("below");
    expect(placement.top).toBe(128); // 120 + 8
    expect(placement.left).toBe(100); // start-aligned with anchor
  });

  it("flips above when there's no room below", () => {
    const placement = placeNearAnchor(
      // Anchor near the bottom of a small viewport — below doesn't fit.
      { left: 100, top: 600, right: 200, bottom: 700 },
      { width: 200, height: 200 },
      { viewport: VIEWPORT, preferred: "below", gap: 8 },
    );
    expect(placement.side).toBe("above");
    // top = anchor.top - gap - height = 600 - 8 - 200 = 392
    expect(placement.top).toBe(392);
  });

  it("respects 'preferred: above' when there's room", () => {
    const placement = placeNearAnchor(
      { left: 100, top: 400, right: 200, bottom: 420 },
      { width: 200, height: 50 },
      { viewport: VIEWPORT, preferred: "above", gap: 8 },
    );
    expect(placement.side).toBe("above");
    expect(placement.top).toBe(342); // 400 - 8 - 50
  });

  it("centres horizontally with align: 'center'", () => {
    const placement = placeNearAnchor(
      { left: 200, top: 100, right: 400, bottom: 120 },
      { width: 100, height: 50 },
      { viewport: VIEWPORT, align: "center" },
    );
    // anchor centre = 300, popup width 100 → left = 250
    expect(placement.left).toBe(250);
  });

  it("clamps left to keep the popup inside the viewport", () => {
    const placement = placeNearAnchor(
      // Anchor near the right edge of the viewport.
      { left: 950, top: 100, right: 990, bottom: 120 },
      { width: 200, height: 50 },
      { viewport: VIEWPORT, align: "start", margin: 8 },
    );
    // Without clamping left would be 950 + 200 = beyond viewport. The clamp
    // pulls the popup back to viewport.width - width - margin = 792.
    expect(placement.left).toBe(792);
  });

  it("clamps left to the left margin when the anchor sits past it", () => {
    const placement = placeNearAnchor(
      { left: -50, top: 100, right: 100, bottom: 120 },
      { width: 200, height: 50 },
      { viewport: VIEWPORT, align: "start", margin: 8 },
    );
    expect(placement.left).toBe(8);
  });

  it("keeps the preferred side when neither fits, accepting overlap", () => {
    const placement = placeNearAnchor(
      // Tall popup in a small viewport — neither side has room.
      { left: 100, top: 100, right: 200, bottom: 120 },
      { width: 200, height: 900 },
      { viewport: VIEWPORT, preferred: "below" },
    );
    expect(placement.side).toBe("below");
    // The final vertical clamp pulls top inside the viewport.
    expect(placement.top).toBeGreaterThanOrEqual(8);
  });
});
