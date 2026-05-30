import { expect, type Page, test } from "@playwright/test";

import { signIn } from "../fixtures/auth";
import { editor, focusEditor, openFirstStudy, type } from "../fixtures/editor";

/**
 * Custom-colour picker regression: covers the two bugs we hit after the v1
 * landing — react-colorful steals focus on mousedown, which (a) collapsed the
 * editor's selection so `setColorMark` fell into the `empty` branch and only
 * added a stored mark (no visible highlight after click-away), and (b) made
 * the selection bubble's `focused` gate flip false and the bubble hide,
 * unmounting the picker mid-pick. The fixes:
 *
 *   - `ColorControl` captures the active editor's selection range when the
 *     user clicks "+ Custom" and restores it on Apply, so the mark always
 *     lands on the originally-selected text.
 *   - `selection-bubble.tsx` treats the bubble as "focused" whenever the
 *     focused element lives anywhere inside the bubble's DOM subtree.
 *   - `TooltipContent` is bumped to `zIndex: 100` so hover labels render
 *     above the bubble (zIndex: 60), not behind it.
 *
 * Per [[playwright-testing-notes]] Playwright teleports onto its targets, so
 * any test that touches floating UI uses explicit visibility waits before
 * clicking — there's no real cursor traversing the gap between the editor
 * selection and the bubble.
 */

/**
 * Walk the focused editor's doc and return the inline-style colours of every
 * `highlight` mark it carries. Lets us assert the mark *survived* a click-
 * away — the original bug only painted the highlight while the selection
 * was live.
 */
async function readHighlightColors(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __PM_DEBUG__?: { getDocJSON(): unknown };
    };
    if (!w.__PM_DEBUG__) {
      throw new Error("__PM_DEBUG__ hook missing");
    }
    const colors: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node !== "object" || node === null) return;
      const n = node as {
        marks?: { type: string; attrs?: { color?: string } }[];
        content?: unknown[];
      };
      if (n.marks) {
        for (const m of n.marks) {
          if (m.type === "highlight" && m.attrs?.color) {
            colors.push(m.attrs.color);
          }
        }
      }
      if (n.content) {
        for (const child of n.content) {
          walk(child);
        }
      }
    };
    walk(w.__PM_DEBUG__.getDocJSON());
    return colors;
  });
}

/**
 * Toggle the per-user "Custom colors" editor tool on. The toggle row is a
 * `role="switch"` whose `aria-checked` reflects state, so we click it and
 * wait for `aria-checked="true"` before moving on. The save is debounced
 * server-side; per the action's contract the local toggle flips
 * immediately on success.
 */
async function enableCustomColors(page: Page): Promise<void> {
  await page.goto("/account/preferences");
  const toggle = page.getByRole("switch", { name: /custom colors/i });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-checked")) !== "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  }
}

test.describe("custom colour picker", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await enableCustomColors(page);
    await page.goto("/dashboard");
    await openFirstStudy(page);
  });

  test("apply persists after click-away (selection survives focus theft)", async ({
    page,
  }) => {
    await focusEditor(page);
    await type(page, "highlight this run");
    // Select the just-typed text from the cursor leftward to the line start.
    await page.keyboard.press("Shift+Home");

    // The bubble's highlight control sits inside `role="toolbar"` and is
    // labelled "Highlight". Use `.first()` because the toolbar surface is
    // also mounted on the top bar — same control, different host.
    const bubble = page.getByRole("toolbar", { name: /text formatting/i });
    await expect(bubble).toBeVisible();
    await bubble.getByRole("button", { name: "Highlight" }).click();

    // The popover renders presets + a Custom palette chip.
    const customChip = page.getByRole("button", {
      name: /^Custom highlight$/i,
    });
    await expect(customChip).toBeVisible();
    await customChip.click();

    const picker = page.getByRole("dialog", {
      name: /custom highlight colour/i,
    });
    await expect(picker).toBeVisible();

    // Click somewhere safely inside the SV plane that we know clears 4.5:1
    // for highlight. The default seed is a pale yellow (h:50, s:25, v:95);
    // we move the handle by clicking ~25% into the plane on a position where
    // the contrast mask is open. The handle clamp catches anything that
    // somehow misses — `Apply` is otherwise disabled by construction.
    const plane = picker.locator(".react-colorful__saturation");
    await expect(plane).toBeVisible();
    const box = await plane.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.click(
        box.x + box.width * 0.25,
        box.y + box.height * 0.1,
      );
    }

    // The bubble must STILL be visible — fix B (bubbleRef contains
    // activeElement). Without this fix the bubble's `focused` gate flipped
    // false the moment react-colorful focused its own div, hiding the
    // bubble and dropping the picker.
    await expect(bubble).toBeVisible();

    await picker.getByRole("button", { name: /^Apply$/i }).click();

    // Click somewhere harmless to drop the selection — this is the moment
    // the original bug "lost" the highlight (stored-mark only, no doc
    // change). With the fix we should have a real range mark.
    await editor(page).click({ position: { x: 5, y: 5 } });

    const colors = await readHighlightColors(page);
    expect(colors.length).toBeGreaterThan(0);
    expect(colors[0]).toMatch(/^oklch\(/);
  });

  test("tooltip renders above the selection bubble", async ({ page }) => {
    await focusEditor(page);
    await type(page, "tooltip stacking probe");
    await page.keyboard.press("Shift+Home");

    const bubble = page.getByRole("toolbar", { name: /text formatting/i });
    await expect(bubble).toBeVisible();

    // Hover the Highlight control to invoke its tooltip. We compare effective
    // zIndex via `getComputedStyle` rather than a screenshot diff so the test
    // is robust to small visual changes.
    const highlightBtn = bubble.getByRole("button", { name: "Highlight" });
    await highlightBtn.hover();
    const tooltipContent = page.locator("[data-slot='tooltip-content']").last();
    await expect(tooltipContent).toBeVisible();

    const tooltipZ = await tooltipContent.evaluate(
      (el) => parseInt(window.getComputedStyle(el).zIndex, 10) || 0,
    );
    const bubbleZ = await bubble.evaluate(
      (el) => parseInt(window.getComputedStyle(el).zIndex, 10) || 0,
    );
    expect(tooltipZ).toBeGreaterThan(bubbleZ);
  });
});
