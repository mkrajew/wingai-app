// Do the two header switches (Orientation and Model) constrain each other as wingOptions.ts says, in the real page?
// Run it in the page of the Vite dev server, with the helper server of tools/pose/browser running (it serves this file); no backend is needed:
//   await (0, eval)(await (await fetch("http://127.0.0.1:8765/regression/switches.js", { cache: "no-store" })).text())
//
// It clicks the switches in a row of steps and reads, after each click, which button of each switch is checked.
(async () => {
  const tick = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => res(); c.port2.postMessage(0); });
  const ticks = async (n) => { for (let i = 0; i < n; i += 1) await tick(); };
  const radio = (label) => document.querySelector(`[role=radio][aria-label="${label}"]`);
  const ORIENTATION = { left: "Orient all wings to the left", original: "Keep original orientation", right: "Orient all wings to the right" };
  const MODEL = { precise: "Model for horizontally aligned wings", rotation: "Model for rotated wings" };
  const checked = (labels) => Object.keys(labels).filter((k) => radio(labels[k])?.getAttribute("aria-checked") === "true");
  const state = () => `${checked(MODEL).join("+")} / ${checked(ORIENTATION).join("+")}`;

  // [what is clicked, the state that has to follow] (model / orientation)
  const STEPS = [
    ["(start)", null, "rotation / original"],
    ["orientation right", ORIENTATION.right, "rotation / right"],
    ["model precise", MODEL.precise, "precise / right"], // the precise model can orient to the right
    ["orientation original", ORIENTATION.original, "precise / original"],
    ["orientation right", ORIENTATION.right, "precise / right"],
    ["orientation left", ORIENTATION.left, "rotation / left"], // but not to the left: the model changes
    ["model precise", MODEL.precise, "precise / original"], // and the orientation goes to original
    ["model rotation", MODEL.rotation, "rotation / original"],
    ["orientation left", ORIENTATION.left, "rotation / left"],
    ["orientation right", ORIENTATION.right, "rotation / right"],
  ];
  const rows = [];
  for (const [what, label, expected] of STEPS) {
    if (label) { radio(label).click(); await ticks(10); }
    const got = state();
    rows.push({ step: what, got, expected, ok: got === expected });
  }
  return { ok: rows.every((r) => r.ok), failing: rows.filter((r) => !r.ok), steps: rows.length };
})()
