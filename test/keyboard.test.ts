// ---------------------------------------------------------------------------
// Keyboard space reservation — the sizing rules behind every bottom sheet.
//
// This is the fourth pass over the same area, so the rules are pinned here rather
// than left living in a component that only a device can exercise. The two that
// carry the weight:
//
//   1. The gap between the layout and visual viewports IS the keyboard (#119).
//   2. That gap only counts while something is being typed into (#221).
//
// Rule 2 exists because the gap LIES. WebKit stays silent when a focused field is
// removed from the DOM: the keyboard leaves, `visualViewport` keeps reporting it,
// and the sheet gets padded away from a keyboard that isn't there — stranded
// halfway up the screen with its content sliced off. Ryan, with a screenshot of
// exactly that: "When I'm building my plan, it bugs when typing".
//
// Pure, no clock, no DOM. Run: npx tsx test/keyboard.test.ts
// ---------------------------------------------------------------------------

import {
  SHEET_MAX_FRACTION,
  keyboardInset,
  raisesKeyboard,
  sheetMaxHeight,
  type ViewportReading,
} from "../lib/keyboard";

let checks = 0;
let failures = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}
function section(name: string) {
  console.log(`\n${name}`);
}

// An iPhone 14 Pro, the device the #221 screenshot came off: 844pt tall, with an
// alphabetic keyboard and an accessory bar taking 361 of them.
const SCREEN = 844;
const KEYBOARD = 361;
const down = (over: Partial<ViewportReading> = {}): ViewportReading => ({
  innerHeight: SCREEN,
  viewportHeight: SCREEN,
  viewportOffsetTop: 0,
  typing: false,
  ...over,
});
const up = (over: Partial<ViewportReading> = {}): ViewportReading =>
  down({ viewportHeight: SCREEN - KEYBOARD, typing: true, ...over });

section("the gap between the two viewports is the keyboard");
{
  ok(keyboardInset(down()) === 0, "nothing focused, nothing on screen → no reservation");
  ok(keyboardInset(up()) === KEYBOARD, "keyboard up → reserve exactly the gap");
  ok(
    keyboardInset(down({ typing: true })) === 0,
    "focused but the viewport is whole → the keyboard is hidden, reserve nothing",
  );
  // iOS scrolls the visual viewport within the layout viewport; that offset is part
  // of what the keyboard covers, not extra space.
  ok(
    keyboardInset(up({ viewportOffsetTop: 40 })) === KEYBOARD - 40,
    "an offset visual viewport eats into the gap",
  );
  ok(
    keyboardInset(up({ viewportHeight: SCREEN + 30, viewportOffsetTop: 0 })) === 0,
    "a viewport reported LARGER than the layout never yields a negative reservation",
  );
}

section("a reservation only lives as long as the focus that justified it (#221)");
{
  // The exact stuck state off Ryan's screenshot: the visual viewport still reports a
  // 361pt keyboard, but the field that raised it is gone, so nothing is being typed.
  const stranded = up({ typing: false });
  ok(keyboardInset(stranded) === 0, "focus gone → the stale gap reserves nothing");
  ok(sheetMaxHeight(stranded) === null, "focus gone → the panel cap is cleared, not recomputed");

  // And the measured consequence: with the reservation cleared, a full-height sheet
  // is free to fill the screen again instead of ending 361pt short of the bottom.
  const strandedBottom = SCREEN - keyboardInset(stranded);
  ok(strandedBottom === SCREEN, "the sheet reaches the bottom of the screen again");
}

section("what counts as typing");
{
  ok(raisesKeyboard({ tagName: "INPUT", type: "text" }), "a text input types");
  ok(raisesKeyboard({ tagName: "INPUT", type: "number" }), "a number input types");
  ok(raisesKeyboard({ tagName: "INPUT" }), "an input with no type defaults to text");
  ok(raisesKeyboard({ tagName: "input", type: "search" }), "tag case doesn't matter");
  ok(raisesKeyboard({ tagName: "TEXTAREA" }), "a textarea types");
  ok(raisesKeyboard({ tagName: "SELECT" }), "a select raises iOS's picker, which shrinks the viewport too");
  ok(raisesKeyboard({ tagName: "DIV", isContentEditable: true }), "contenteditable types");

  ok(!raisesKeyboard(null), "nothing focused is not typing");
  ok(!raisesKeyboard(undefined), "no active element is not typing");
  ok(!raisesKeyboard({ tagName: "BODY" }), "body — where focus lands after a blur — is not typing");
  ok(!raisesKeyboard({ tagName: "BUTTON" }), "a focused button is not typing");
  ok(!raisesKeyboard({ tagName: "DIV" }), "a plain div is not typing");
  ok(!raisesKeyboard({ tagName: "DIV", isContentEditable: false }), "a non-editable div is not typing");
  for (const type of ["button", "checkbox", "radio", "submit", "reset", "file", "image", "range", "color"]) {
    ok(!raisesKeyboard({ tagName: "INPUT", type }), `input[type=${type}] takes focus without a keyboard`);
  }
}

section("the panel cap");
{
  const cap = sheetMaxHeight(up());
  ok(cap !== null, "keyboard up → the panel is capped");
  ok(cap === Math.round((SCREEN - KEYBOARD) * SHEET_MAX_FRACTION), "capped to 92% of what's left");
  // The whole point of the cap: the panel must fit above the keyboard.
  ok((cap ?? 0) <= SCREEN - KEYBOARD, "the capped panel fits in the visible space");
  ok(sheetMaxHeight(down()) === null, "keyboard down → no cap, the stylesheet's 92vh governs");

  // Reproduces the geometry of the #221 screenshot, to prove the numbers are the ones
  // that produced it: a 443pt panel whose top edge sat 40pt down a 844pt screen.
  const strandedCap = sheetMaxHeight(up({ typing: true }));
  ok(strandedCap === 444, "the stuck panel measured 443–444pt — the same arithmetic");
  ok(SCREEN - KEYBOARD - (strandedCap ?? 0) === 39, "and its top edge sat ~40pt down the screen");
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
