/**
 * This week's promises - the MCP App view behind get_promises.
 *
 * Spoken, a week of promises is three sentences and "two more". Drawn, it is the
 * family's word laid out: what each person said yes to, where it stands, and the trail
 * behind it - the ask, the yes, the "still on?", the done, and what the doorbell saw
 * beside it. The trail is the point: anyone can tap a row and check how we know.
 *
 * Read-only on purpose. Promising is a person's act, so this view never makes one; it
 * shows them. Work due with nothing marked is drawn as "Checking in", never in an alarm
 * colour: no record is not a promise broken.
 *
 * Self-contained like the Care Board (./care-board.ts): no CDN, no fonts, no network
 * beyond the host bridge, so it asks for no CSP origins at all.
 */

export const PROMISES_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>This week's promises</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: var(--color-background-primary, transparent);
    --fg: var(--color-text-primary, #12151c);
    --muted: var(--color-text-secondary, #5b6472);
    --faint: var(--color-text-tertiary, #8b94a3);
    --line: var(--color-border-primary, rgba(128, 140, 160, 0.22));
    --card: var(--color-background-secondary, rgba(128, 140, 160, 0.07));
    --radius: var(--border-radius-lg, 14px);
    --font: var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
    --waiting: #b8791b;
    --kept: #2f8f6f;
    --quiet: #8b94a3;
  }
  [data-theme="dark"] {
    --fg: var(--color-text-primary, #eef1f6);
    --muted: var(--color-text-secondary, #a8b1c0);
    --faint: var(--color-text-tertiary, #78818f);
    --line: var(--color-border-primary, rgba(255, 255, 255, 0.14));
    --card: var(--color-background-secondary, rgba(255, 255, 255, 0.05));
    --waiting: #ffc45c;
    --kept: #6fe0b4;
    --quiet: #78818f;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2px; background: var(--bg); color: var(--fg);
    font-family: var(--font); font-size: 14px; line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }
  .head { display: flex; align-items: baseline; gap: 8px; margin: 2px 2px 12px; }
  .title { font-weight: 600; font-size: 15px; letter-spacing: -0.01em; }
  .count { color: var(--faint); font-size: 12.5px; }
  .spacer { flex: 1; }
  .refresh {
    border: 0; background: none; color: var(--faint); font: inherit; font-size: 12.5px;
    cursor: pointer; padding: 2px 6px; border-radius: 6px;
  }
  .refresh:hover { color: var(--fg); background: var(--card); }

  .row {
    display: grid; grid-template-columns: 3px 1fr; gap: 14px;
    padding: 12px 14px 12px 0; background: var(--card); border: 1px solid var(--line);
    border-radius: var(--radius); margin-bottom: 8px; overflow: hidden;
  }
  .rail { align-self: stretch; border-radius: 3px; min-height: 100%; }
  .body { min-width: 0; padding: 1px 0; }
  .what { font-weight: 550; letter-spacing: -0.005em; overflow-wrap: anywhere; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 7px; }
  .who { color: var(--muted); font-size: 12.5px; }
  .chip {
    font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    padding: 2.5px 7px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap;
  }
  .trail-btn {
    border: 0; background: none; padding: 0; margin: 0; font: inherit;
    color: var(--faint); font-size: 12px; cursor: pointer;
    text-decoration: underline; text-decoration-style: dotted;
    text-underline-offset: 3px; text-decoration-color: var(--line);
  }
  .trail-btn:hover { color: var(--fg); }
  .trail { margin: 8px 0 0; padding: 0 0 0 10px; border-left: 2px solid var(--line); list-style: none; }
  .trail li { color: var(--muted); font-size: 12.5px; margin: 3px 0; overflow-wrap: anywhere; }
  .seen { color: var(--faint); font-size: 12px; margin-top: 6px; }

  .note { color: var(--faint); font-size: 12.5px; padding: 10px 2px; }
  .err {
    color: var(--waiting); font-size: 12.5px; padding: 10px 12px;
    border: 1px solid currentColor; border-radius: var(--radius); margin-bottom: 8px;
  }
  .foot { color: var(--faint); font-size: 11.5px; margin: 10px 2px 2px; }
</style>
</head>
<body>
<div id="root"><div class="note">Loading this week's promises…</div></div>
<script>
(function () {
  "use strict";

  // ---- Host bridge: MCP JSON-RPC over postMessage (as in the Care Board) ----
  var PROTOCOL_VERSION = "2026-01-26";
  var nextId = 1;
  var pending = new Map();
  var host = { capabilities: {}, context: {} };
  var painted = false;

  function post(msg) {
    try { window.parent.postMessage(msg, "*"); } catch (e) { /* no host */ }
  }

  function request(method, params) {
    var id = nextId++;
    post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        pending.delete(id);
        reject(new Error("The host did not answer " + method + "."));
      }, 30000);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
    });
  }

  function notify(method, params) {
    post({ jsonrpc: "2.0", method: method, params: params || {} });
  }

  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;
    if (msg.id !== undefined && msg.method === undefined) {
      var waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.error) waiter.reject(new Error(msg.error.message || "Request failed."));
      else waiter.resolve(msg.result);
      return;
    }
    if (msg.method === "ui/notifications/tool-result") {
      painted = true;
      render(promisesFrom(msg.params));
      return;
    }
    if (msg.method === "ui/notifications/host-context-changed") {
      applyHostContext(msg.params && msg.params.hostContext);
    }
  });

  function applyHostContext(ctx) {
    if (!ctx) return;
    host.context = ctx;
    if (ctx.theme) {
      document.documentElement.setAttribute("data-theme", ctx.theme);
      document.documentElement.style.colorScheme = ctx.theme;
    }
    var styles = ctx.styles && (ctx.styles.variables || ctx.styles);
    if (styles && typeof styles === "object") {
      Object.keys(styles).forEach(function (k) {
        if (k.indexOf("--") === 0 && typeof styles[k] === "string") {
          document.documentElement.style.setProperty(k, styles[k]);
        }
      });
    }
  }

  var lastHeight = 0;
  function reportSize() {
    var h = Math.ceil(document.body.scrollHeight);
    if (h && h !== lastHeight) {
      lastHeight = h;
      notify("ui/notifications/size-changed", { height: h });
    }
  }

  // ---- Data ----------------------------------------------------------------

  function promisesFrom(result) {
    if (!result) return null;
    var sc = result.structuredContent;
    if (sc && Array.isArray(sc.promises)) return sc.promises;
    return null;
  }

  function canCallTools() {
    return !!(host.capabilities && host.capabilities.serverTools);
  }

  function refresh() {
    if (!canCallTools()) return Promise.resolve();
    return request("tools/call", { name: "get_promises", arguments: {} }).then(function (result) {
      var promises = promisesFrom(result);
      if (promises) render(promises);
    }).catch(function (err) { renderError(err.message); });
  }

  // ---- Rendering -----------------------------------------------------------

  var root = document.getElementById("root");

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  /** Where each promise stands, as a word and a colour. Nothing here is an alarm. */
  var STAGE = {
    checking: { label: "Checking in", tone: "waiting",
      title: "Past its time with nothing marked yet. The app asked if it's still on." },
    open: { label: "Back with nobody", tone: "waiting", title: "Handed back. Nobody has it right now." },
    asking: { label: "Asking someone", tone: "waiting", title: "Handed back, and someone new has been asked." },
    still_on: { label: "Still on", tone: "kept", title: "They said it's still on." },
    promised: { label: "Said yes", tone: "quiet", title: "Somebody said yes, and it is on its way." },
    done: { label: "Done", tone: "kept", title: "Marked done." },
    set_aside: { label: "Set aside", tone: "quiet", title: "Somebody said it was not needed after all." }
  };

  function renderError(message) {
    root.replaceChildren(el("div", "err", message));
    reportSize();
  }

  function render(promises) {
    if (!Array.isArray(promises)) return;
    root.replaceChildren();
    var head = el("div", "head");
    head.append(el("span", "title", "This week's promises"));
    head.append(el("span", "count", promises.length === 1 ? "1 promise" : promises.length + " promises"));
    head.append(el("span", "spacer"));
    if (canCallTools()) {
      var r = el("button", "refresh", "Refresh");
      r.addEventListener("click", function () { refresh(); });
      head.append(r);
    }
    root.append(head);

    if (!promises.length) {
      root.append(el("div", "note", "Nobody has said yes to anything this week yet."));
      reportSize();
      return;
    }
    promises.forEach(function (p) { root.append(renderRow(p)); });
    root.append(el("div", "foot",
      "Built only from what was recorded. Tap a trail to see how we know. "
        + "What the doorbell saw sits beside the record, never in place of it."));
    reportSize();
  }

  function renderRow(p) {
    var stage = STAGE[p.stage] || STAGE.promised;
    var row = el("div", "row");
    var rail = el("div", "rail");
    rail.style.background = "var(--" + stage.tone + ")";
    row.append(rail);

    var body = el("div", "body");
    body.append(el("div", "what", p.what));
    var meta = el("div", "meta");
    var chip = el("span", "chip", stage.label);
    chip.style.color = "var(--" + stage.tone + ")";
    chip.title = stage.title;
    meta.append(chip);
    var who = p.promisedBy ? p.promisedBy : "";
    if (p.due && p.stage !== "done" && p.stage !== "set_aside") who += (who ? " · due " : "Due ") + p.due;
    if (who) meta.append(el("span", "who", who));

    var steps = Array.isArray(p.steps) ? p.steps : [];
    if (steps.length) {
      var btn = el("button", "trail-btn", "How we know");
      var trail = null;
      btn.addEventListener("click", function () {
        if (trail) { trail.remove(); trail = null; reportSize(); return; }
        trail = el("ul", "trail");
        steps.forEach(function (s) { trail.append(el("li", null, s.detail)); });
        body.append(trail);
        reportSize();
      });
      meta.append(btn);
    }
    body.append(meta);

    if (Array.isArray(p.evidence) && p.evidence.length) {
      body.append(el("div", "seen", "The doorbell saw " + p.evidence.join(" and ")
        + ". Evidence beside the record, not proof on its own."));
    }
    row.append(body);
    return row;
  }

  // ---- Start ---------------------------------------------------------------

  request("ui/initialize", {
    appInfo: { name: "carecircle-promises", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
    protocolVersion: PROTOCOL_VERSION
  }).then(function (result) {
    host.capabilities = (result && result.hostCapabilities) || {};
    applyHostContext(result && result.hostContext);
    notify("ui/notifications/initialized", {});
    setTimeout(function () { if (!painted) refresh(); }, 400);
  }).catch(function (err) {
    renderError("This view could not reach its host. " + err.message);
  });

  window.addEventListener("resize", reportSize);
})();
</script>
</body>
</html>
`;
