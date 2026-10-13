// Records or replays the answers of POST /api/analyze, so that two runs of the same screens get the same landmarks
// (the backend is not deterministic on wings it flags) and do not need the backend at all.
//   Run it in the page BEFORE run.js:
//     window.__REPLAY = null;                 record: the answers are kept in window.__RECORDED
//     window.__REPLAY = { "<key>": answer };  replay: the stored answers are returned, nothing is sent
//   the key is "<file name>|<x_size>|<y_size>|<model>"
(() => {
  const origFetch = window.fetch.bind(window);
  window.__RECORDED = {};
  window.__REPLAY = window.__REPLAY ?? null;
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!(url.includes("/api/analyze") && init && init.body instanceof FormData)) return origFetch(input, init);
    const f = init.body.get("file");
    const key = [f.name, init.body.get("x_size"), init.body.get("y_size"), init.body.get("model")].join("|");
    if (window.__REPLAY) {
      const answer = window.__REPLAY[key];
      if (!answer) return new Response("no recorded answer for " + key, { status: 500, statusText: "Not recorded" });
      return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const res = await origFetch(input, init);
    if (res.ok) window.__RECORDED[key] = await res.clone().json();
    return res;
  };
})();
