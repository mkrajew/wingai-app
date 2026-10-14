// Does the name field of the review screen show the name that the photo really has after a name is committed? A name typed without the extension of the photo
// comes out as the name it has already, a name that another photo has gets a number, text typed after the whole name stays and the extension goes to the end, and a
// blank name is put back. Run it in the page after run.js (S1, orientation right) has left the page on the review screen (see README):
//   window.__LABEL = "x"; await (0, eval)(await (await fetch("http://127.0.0.1:8765/regression/rename-review.js", { cache: "no-store" })).text());
// The result is posted to work/collected-rename-review-<label>.json and returned. `ok` says whether every check came out as it should.
(async () => {
  const BASE = "http://127.0.0.1:8765";
  const LABEL = window.__LABEL || "rename-review";
  const tick = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => res(); c.port2.postMessage(0); });
  const ticks = async (n) => { for (let i = 0; i < n; i += 1) await tick(); };
  const waitFor = async (fn, label, ms = 20000) => { const t0 = performance.now(); for (;;) { const v = fn(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("timeout: " + label); await tick(); } };
  const nameInput = () => document.querySelector("input[type=text].form-control");
  const listItems = () => [...document.querySelectorAll(".list-group button")];
  const setValue = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); };
  const typeAndEnter = async (text) => {
    nameInput().focus();
    setValue(nameInput(), text);
    await ticks(10);
    nameInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await ticks(25);
    return nameInput().value;
  };
  const typeAndLeave = async (text) => {
    nameInput().focus();
    setValue(nameInput(), text);
    await ticks(10);
    nameInput().blur();
    nameInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true })); // a window that does not have the focus sends no blur
    await ticks(25);
    return nameInput().value;
  };

  window.__runStage = "the review screen";
  await waitFor(() => nameInput() && !nameInput().disabled && listItems().length >= 2, "the review screen");
  listItems()[1].click();
  await ticks(20);
  const other = nameInput().value;
  listItems()[0].click();
  await ticks(20);
  const start = nameInput().value;
  const ending = ".dw.png";
  if (!start.endsWith(ending) || !other.endsWith(ending)) throw new Error(`the names are not of processed photos: ${start}, ${other}`);
  const base = start.slice(0, -ending.length);
  const result = { label: LABEL, start, other };

  window.__runStage = "names that come out as the photo has";
  result.noEndingEnter = await typeAndEnter(base);
  result.noEndingLeave = await typeAndLeave(base);
  result.otherEndingEnter = await typeAndEnter(`${base}.png`);
  result.spacesAroundLeave = await typeAndLeave(`  ${start}  `);

  window.__runStage = "text typed after the whole name";
  const appended = `${start}abc${ending}`;
  result.appendedEnter = await typeAndEnter(`${start}abc`);
  result.appendedInTheList = document.body.innerText.includes(appended);
  result.appendedLeave = await typeAndLeave(`${appended}_2`);

  window.__runStage = "a name that another photo has";
  const taken = other.slice(0, -ending.length) + `(2)${ending}`;
  result.takenEnter = await typeAndEnter(other);
  result.takenAgainEnter = await typeAndEnter(other);
  result.takenAgainLeave = await typeAndLeave(other);

  window.__runStage = "a blank name";
  result.blankLeave = await typeAndLeave("   ");

  result.ok = result.noEndingEnter === start && result.noEndingLeave === start && result.otherEndingEnter === start && result.spacesAroundLeave === start
    && result.appendedEnter === appended && result.appendedInTheList && result.appendedLeave === `${appended}_2${ending}`
    && result.takenEnter === taken && result.takenAgainEnter === taken && result.takenAgainLeave === taken
    && result.blankLeave === taken;
  window.__runStage = "reporting";
  await fetch(`${BASE}/regression/collect/rename-review-${LABEL}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
  return result;
})();
