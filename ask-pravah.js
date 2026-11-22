/* Ask Pravah: Jinbe in the product.
 * One tap keeps it listening; it moves through the product and does what the user says.
 * Runs on the product map (ask-pravah-map.json, built from pravah-brain product/map.yaml)
 * with the browser's own speech recognition and a built-in matcher. No AI tokens.
 * Source of truth for screens and words: Mugiwara-Boy/pravah-brain, product/map.yaml.
 */
(function () {
  "use strict";
  if (window.__askPravah) return;
  window.__askPravah = true;

  var IDLE_MS = 120000;
  var MAP = null;
  var state = { on: false, rec: null, idle: null, pending: null, lastField: null, log: [] };

  /* ---------- words ---------- */
  var GROUPS = [
    ["icp", "icps", "ideal", "customer", "profile", "target"],
    ["visitor", "visitors", "lead", "leads", "person", "people", "contact", "registration", "registrations", "attendee"],
    ["scan", "badge", "card", "camera", "qr"],
    ["event", "events", "show", "shows", "expo", "conference"],
    ["settings", "setting", "setup", "configure"],
    ["team", "rep", "reps", "member", "members", "teammate", "colleague", "staff"],
    ["meeting", "meetings", "booked", "calendar", "demo"],
    ["question", "questions", "unanswered"],
    ["stale", "quiet", "cold", "dormant"],
    ["report", "scorecard", "busiest", "load", "hours"],
    ["analytics", "results", "performance", "doing", "stats"],
    ["integration", "integrations", "connect", "crm", "salesforce", "hubspot", "slack"],
    ["email", "emails", "communication", "communications", "mail"],
    ["update", "change", "edit", "fix", "set", "rename", "correct"],
    ["add", "new", "create", "invite"],
    ["show", "open", "go", "take", "see", "view", "list", "display"],
    ["live", "now", "happening", "feed"],
    ["photo", "picture", "upload", "image"],
    ["note", "notes"],
    ["name"], ["company"], ["title", "role", "designation"], ["phone", "mobile", "number"], ["linkedin"]
  ];
  var STOP = { the: 1, a: 1, an: 1, my: 1, me: 1, to: 1, for: 1, of: 1, this: 1, that: 1, please: 1, can: 1, you: 1, i: 1, want: 1, need: 1, it: 1, is: 1, our: 1, in: 1, on: 1, and: 1, us: 1, all: 1, at: 1, with: 1 };
  function stem(w) {
    var s = ["ing", "ies", "es", "ed", "s"];
    for (var i = 0; i < s.length; i++) if (w.length > s[i].length + 2 && w.slice(-s[i].length) === s[i]) return w.slice(0, -s[i].length);
    return w;
  }
  function concepts(text) {
    var out = {};
    (text.toLowerCase().match(/[a-z0-9]+/g) || []).forEach(function (w) {
      if (STOP[w]) return;
      var g = -1;
      for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].indexOf(w) >= 0 || GROUPS[i].map(stem).indexOf(stem(w)) >= 0) { g = i; break; }
      out[g >= 0 ? "#" + g : stem(w)] = 1;
    });
    return out;
  }
  function score(q, phrases) {
    var qc = concepts(q), best = 0, n = Object.keys(qc).length;
    if (!n) return 0;
    phrases.forEach(function (p) {
      var pc = concepts(p), pn = Object.keys(pc).length, hit = 0;
      for (var k in qc) if (pc[k]) hit++;
      var s = pn ? (2 * hit) / (n + pn) : 0;
      if (s > best) best = s;
    });
    return best;
  }

  /* ---------- app context ---------- */
  function route() { return (location.hash || "#/").slice(1); }
  function events() {
    try { var e = JSON.parse(localStorage.getItem("pravah_events_v7") || "[]"); return Array.isArray(e) ? e : []; } catch (x) { return []; }
  }
  function slugInRoute() { var m = route().match(/^\/events\/([^/]+)/); return m && m[1] !== "new" ? m[1] : null; }
  function visitorInRoute() { var m = route().match(/registrations\/([^/]+)$/); return m && m[1] !== "new" ? m[1] : null; }
  function liveEvents() {
    var now = Date.now();
    return events().filter(function (e) { return e.startDate && e.endDate && Date.parse(e.startDate) <= now && now <= Date.parse(e.endDate); });
  }
  function lastEvent() { try { return localStorage.getItem("askpravah_last_event"); } catch (x) { return null; } }
  window.addEventListener("hashchange", function () { var s = slugInRoute(); if (s) try { localStorage.setItem("askpravah_last_event", s); } catch (x) {} });
  function eventName(slug) { var e = events().filter(function (x) { return x.slug === slug; })[0]; return e ? e.name : "this event"; }
  var GENERIC = { event: 1, events: 1, summit: 1, marketing: 1, conference: 1, expo: 1, show: 1, national: 1, america: 1, usa: 1, b2b: 1, annual: 1, world: 1, global: 1, week: 1, this: 1, that: 1, other: 1 };
  function namedEvents(q) {
    var qwords = (q.toLowerCase().match(/[a-z0-9]+/g) || []).filter(function (w) { return w.length >= 4 && !GENERIC[w] && !/^\d+$/.test(w); });
    var qcompact = q.toLowerCase().replace(/[^a-z0-9]/g, "");
    return events().filter(function (e) {
      var compact = e.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      var first = (e.name.toLowerCase().match(/[a-z0-9]+/g) || [""])[0];
      var firstCompact = e.name.toLowerCase().split(/\s/)[0].replace(/[^a-z0-9]/g, "");
      return (firstCompact.length >= 4 && qcompact.indexOf(firstCompact) >= 0) || qwords.some(function (w) { return w === first || compact.indexOf(w) === 0; });
    });
  }
  /* the event rule from the map: on screen, then live, then last opened, else ask */
  function resolveEvent(q, then) {
    var named = namedEvents(q);
    if (named.length === 1) return then(named[0].slug);
    var here = slugInRoute();
    if (here && !/\b(other|another|different)\b/.test(q)) return then(here);
    var live = liveEvents();
    if (live.length === 1) return then(live[0].slug);
    var last = lastEvent();
    if (!live.length && last && events().some(function (e) { return e.slug === last; })) return then(last);
    var opts = (live.length ? live : events()).slice(0, 6);
    ask("Which event?", opts.map(function (e) { return { label: e.name, run: function () { then(e.slug); } }; }));
  }

  /* ---------- DOM helpers ---------- */
  function go(path) { if (route() !== path) location.hash = "#" + path; }
  function waitFor(fn, ms) {
    return new Promise(function (res) {
      var t0 = Date.now();
      (function tick() { var v = fn(); if (v) return res(v); if (Date.now() - t0 > (ms || 4000)) return res(null); setTimeout(tick, 120); })();
    });
  }
  function visible(el) { return el && el.offsetParent !== null; }
  function norm(t) { return (t || "").replace(/\s+/g, " ").replace(/\*/g, "").trim().toLowerCase(); }
  function button(text) {
    var t = norm(text), all = [].slice.call(document.querySelectorAll("button,a,[role=button],[role=tab]")).filter(visible);
    return all.filter(function (b) { return norm(b.innerText) === t; })[0] || all.filter(function (b) { return norm(b.innerText).indexOf(t) === 0; })[0] || null;
  }
  function fieldLabel(el) {
    var t = el.getAttribute("aria-label") || "";
    if (!t && el.id) { var l = document.querySelector('label[for="' + el.id + '"]'); if (l) t = l.innerText; }
    if (!t) { var wrap = el.closest("label"); if (wrap) t = wrap.innerText; }
    if (!t) {
      var p = el;
      for (var i = 0; i < 5 && p && !t; i++) {
        p = p.parentElement; if (!p) break;
        var ins = p.querySelectorAll("input,textarea"), ls = p.querySelectorAll("label,h3,h4");
        if (ins.length === 1 && ls.length) t = ls[0].innerText;
      }
    }
    if (!t) { /* nearest text before the input, in reading order */
      var w = document.createTreeWalker(el.closest("[role=dialog]") || document.body, NodeFilter.SHOW_TEXT), last = "", n;
      while ((n = w.nextNode())) {
        if (el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) break;
        var s = n.textContent.trim(); if (s && s.length < 40) last = s;
      }
      t = last;
    }
    return norm(t);
  }
  function field(name) {
    var scope = [].slice.call(document.querySelectorAll("[role=dialog]")).filter(visible)[0] || document;
    var els = [].slice.call(scope.querySelectorAll("input,textarea")).filter(visible), n = norm(name);
    return els.filter(function (e) { return fieldLabel(e) === n; })[0] || els.filter(function (e) { return fieldLabel(e).indexOf(n) === 0; })[0] || null;
  }
  function setValue(el, v) {
    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function focusField(el) { el.scrollIntoView({ block: "center" }); el.focus(); flash(el); state.lastField = el; }
  function flash(el) { var o = el.style.boxShadow; el.style.boxShadow = "0 0 0 3px #F5B23B"; setTimeout(function () { el.style.boxShadow = o; }, 2500); }

  /* ---------- doing things ---------- */
  function fill(p, s) { return p.replace(":slug", s); }
  function valueIn(q) { var m = q.match(/\b(?:to|as|is|with)\s+(.{2,})$/i); return m ? m[1].trim().replace(/[.]$/, "") : null; }

  function openScreen(sc, q) {
    if (sc.level === "event") return resolveEvent(q, function (slug) { go(fill(sc.route, slug)); say("Opened " + sc.name + " for " + eventName(slug) + "."); afterOpen(sc, q); });
    go(sc.route); say("Opened " + sc.name + "."); afterOpen(sc, q);
  }
  function afterOpen(sc, q) {
    /* a field named on the screen just opened (for example the ICP) */
    var f = bestField(sc, q);
    if (f && f.s > 0.45) waitFor(function () { return field(f.f.name); }).then(function (el) { if (el) editField(el, f.f, q); });
    var a = bestAction(sc, q);
    if (a && a.s > 0.5 && a.a.click) waitFor(function () { return button(a.a.click); }).then(function (b) { if (b) { b.click(); say(a.a.done || a.a.name + "."); } });
  }
  function editField(el, f, q) {
    var v = valueIn(q);
    focusField(el);
    if (!v && /^(show|what|see|view|open)\b/i.test(q)) { say("Here's the " + f.name + ". Say \u201cchange it to\u2026\u201d to edit."); state.pending = { kind: "value", el: el, f: f }; return; }
    if (v) { setValue(el, v); say(f.name + " set to “" + v + "”. Say “save” to keep it."); }
    else say("In " + f.name + ". Say the new " + f.name.toLowerCase() + ", or type it.");
    state.pending = { kind: "value", el: el, f: f };
  }
  function visitorFieldEdit(f, q) {
    if (!visitorInRoute()) {
      var links = [].slice.call(document.querySelectorAll('a[href*="registrations/"]')).filter(function (a) { return !/registrations\/new/.test(a.getAttribute("href")) && visible(a); }).slice(0, 3);
      if (!links.length) return say("Open a visitor first, then tell me what to change.");
      return ask("Which visitor?", links.map(function (a) { return { label: a.innerText.split("\n")[0].trim(), run: function () { a.click(); setTimeout(function () { visitorFieldEdit(f, q); }, 900); } }; }));
    }
    var dialogOpen = [].slice.call(document.querySelectorAll("[role=dialog]")).some(visible);
    var p = dialogOpen ? Promise.resolve(true) : waitFor(function () { return button("Edit"); }).then(function (b) { if (b) b.click(); return b; });
    say("Opening Edit visitor\u2026");
    p.then(function () { return waitFor(function () { return field(f.label || f.name); }); }).then(function (el) {
      if (!el) return say("I couldn't find " + f.name + " on this screen.");
      editField(el, f, q);
    });
  }
  function openVisitor(q) {
    var name = q.replace(/^(open|show|go to|find|pull up)\s+/i, "").replace(/\b(visitor|profile|lead)\b/gi, "").trim().toLowerCase();
    var tryHere = function () {
      var a = [].slice.call(document.querySelectorAll('a[href*="registrations/"]')).filter(function (x) { return visible(x) && name && x.innerText.toLowerCase().indexOf(name) >= 0; })[0];
      if (a) { a.click(); say("Opened " + a.innerText.split("\n")[0] + "."); return true; }
      return false;
    };
    if (tryHere()) return true;
    var s = slugInRoute() || (liveEvents()[0] || {}).slug || lastEvent();
    if (!s) return false;
    go("/events/" + s + "/registrations");
    waitFor(tryHere, 3000).then(function (ok) { if (!ok) miss(q, "no visitor by that name in " + eventName(s)); });
    return true;
  }

  function bestField(sc, q) {
    var best = null;
    (sc.fields || []).forEach(function (f) { var s = score(q, f.say.concat([f.name])); if (!best || s > best.s) best = { f: f, s: s }; });
    return best;
  }
  function bestAction(sc, q) {
    var best = null;
    (sc.actions || []).forEach(function (a) { var s = score(q, (a.say || []).concat([a.name])); if (!best || s > best.s) best = { a: a, s: s }; });
    return best;
  }

  /* ---------- the matcher ---------- */
  function handle(raw) {
    var q = raw.trim();
    if (!q) return;
    state.log.unshift(q);
    var lq = q.toLowerCase();
    if (/^(stop|stop listening|that's all|thats all|goodbye|bye)\b/.test(lq)) { toggle(false); return; }
    if (/^(save|save it|yes save|done)$/.test(lq)) { var sv = button("Save") || button("Save ideal customer profile") || button("Save details") || button("Save defaults"); if (sv) { sv.click(); say("Saved."); state.pending = null; } else say("Nothing to save here."); return; }
    if (/^(cancel|never mind|nevermind)$/.test(lq)) { var c = button("Cancel"); if (c) c.click(); state.pending = null; say("Cancelled."); return; }
    if (/^(go back|back)$/.test(lq)) { history.back(); say("Back."); return; }

    /* dictating into the field we are in */
    if (state.pending && state.pending.kind === "value" && document.contains(state.pending.el) && !/\b(open|show|go to|take me|scan|update|change|add|edit)\b/.test(lq)) {
      setValue(state.pending.el, q); say(state.pending.f.name + " set to “" + q + "”. Say “save” to keep it."); return;
    }
    var clickM = lq.match(/^(?:click|press|tap)\s+(.+)$/);
    if (clickM) { var b = button(clickM[1]); if (b) { b.click(); say("Clicked " + b.innerText.trim() + "."); } else miss(q, "no button called that here"); return; }

    var ne = namedEvents(q);
    if (ne.length === 1 && /^(open|show|go to|take me to)\b/.test(lq) && !/\b(settings|visitors|registrations|report|analytics|leads|questions|feed|integrations|emails|communications|scan|badge)\b/.test(lq)) { go("/events/" + ne[0].slug); say("Opened " + ne[0].name + "."); return; }
    var here = currentScreen();
    var cands = [];
    MAP.screens.forEach(function (sc) {
      cands.push({ sc: sc, kind: "screen", s: score(q, sc.say.concat([sc.name])) });
      (sc.fields || []).forEach(function (f) { if (f.edit) cands.push({ sc: sc, kind: "field", f: f, s: score(q, f.say) + (here && here.id === sc.id ? 0.08 : 0) }); });
      (sc.actions || []).forEach(function (a) { cands.push({ sc: sc, kind: "action", a: a, s: score(q, (a.say || []).concat([a.name])) + (here && here.id === sc.id ? 0.1 : 0) }); });
    });
    cands = cands.filter(function (c) { return c.sc.verified !== false || c.kind !== "field" || c.sc.fields_verified !== false; });
    /* level hints: a named event or "this event" points to the event level; "company", "my", "org" without "event" to the org level */
    var wantsEvent = ne.length > 0 || /\b(this|the) (event|show)\b|\bfor (this|the) event\b|\bevent\b/.test(lq);
    var wantsOrg = !wantsEvent && /\b(company|org|organisation|organization|my|our|all)\b/.test(lq);
    cands.forEach(function (c) {
      if (c.kind !== "screen") c.s += 0.06;
      if (wantsEvent && c.sc.level === "event") c.s += 0.15;
      if (wantsOrg && c.sc.level === "org") c.s += 0.15;
    });
    cands.sort(function (a, b) { return b.s - a.s; });
    var top = cands[0];
    if (!top || top.s < 0.34) { if (/^(open|show|find|pull up|go to)\s+\w+/.test(lq) && openVisitor(q)) return; return miss(q, "no screen or action in the map matches"); }
    var close = cands.filter(function (c) { return c.s >= top.s - 0.06 && label(c) !== label(top); }).slice(0, 2);
    if (close.length && top.s < 0.7) return ask("Did you mean", [top].concat(close).map(function (c) { return { label: label(c), run: function () { run(c, q); } }; }));
    run(top, q);
  }
  function label(c) { return c.kind === "screen" ? c.sc.name : c.kind === "field" ? c.f.name + " on " + c.sc.name : c.a.name; }
  function run(c, q) {
    if (c.sc.verified === false) return say(c.sc.name + " isn't confirmed in the map yet, so I won't act on it.");
    if (c.kind === "screen") return openScreen(c.sc, q);
    if (c.kind === "field") {
      if (c.sc.id === "S-23") return visitorFieldEdit(c.f, q);
      var path = c.sc.route;
      var doIt = function (slug) {
        var dest = slug ? fill(path, slug) : path;
        go(dest);
        waitFor(function () { return route() === dest && field(c.f.label || c.f.name); }).then(function (el) { if (el) { editField(el, c.f, q); } else say("I couldn't find " + c.f.name + "."); });
      };
      return c.sc.level === "event" ? resolveEvent(q, doIt) : doIt(null);
    }
    if (c.kind === "action") {
      var here2 = currentScreen();
      var target = c.a.route || (here2 && here2.id === c.sc.id ? null : c.sc.route);
      if (target && target.indexOf(":visitorId") >= 0) return say("Open a visitor first, then say it again.");
      var act = function (slug) {
        if (target) go(slug ? fill(target, slug) : target);
        if (c.a.click) waitFor(function () { return button(c.a.click); }).then(function (b) { if (b) { b.click(); say(c.a.done || c.a.name + "."); } else say("Opened " + c.sc.name + "."); });
        else if (c.a.field) waitFor(function () { return field(c.a.field); }).then(function (el) { if (el) { focusField(el); say(c.a.done || "Ready."); state.pending = { kind: "value", el: el, f: { name: c.a.field } }; } });
        else say(c.a.done || (c.a.name + (slug && c.sc.level === "event" ? " for " + eventName(slug) : "") + "."));
      };
      return c.sc.level === "event" && target ? resolveEvent(q, act) : act(slugInRoute());
    }
  }
  function currentScreen() {
    var r = route().replace(/^\/events\/[^/]+/, "/events/:slug").replace(/registrations\/(?!new$)[^/]+$/, "registrations/:visitorId");
    return MAP.screens.filter(function (s) { return s.route === r; })[0] || null;
  }
  function miss(q, why) {
    try { var m = JSON.parse(localStorage.getItem("askpravah_misses") || "[]"); m.unshift({ at: new Date().toISOString(), words: q, screen: route(), why: why }); localStorage.setItem("askpravah_misses", JSON.stringify(m.slice(0, 200))); } catch (x) {}
    say("Pravah can't do that yet. I've noted it for the team.", true);
  }

  /* ---------- speech ---------- */
  function SR() { return window.SpeechRecognition || window.webkitSpeechRecognition; }
  function startRec() {
    var C = SR();
    if (!C) { typeBox(); return; }
    var r = new C();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onresult = function (e) {
      var interim = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var t = e.results[i][0].transcript;
        if (e.results[i].isFinal) { bump(); heard(t); var tt = t; setTimeout(function () { handle(tt); }, 350); } else interim += t;
      }
      heard(interim);
    };
    r.onerror = function (e) { if (e.error === "not-allowed") { toggle(false); say("Allow the microphone to talk to Pravah.", true); } };
    r.onend = function () { if (state.on) try { r.start(); } catch (x) {} };
    try { r.start(); } catch (x) {}
    state.rec = r;
  }
  function bump() { clearTimeout(state.idle); state.idle = setTimeout(function () { toggle(false); say("Stopped listening."); }, IDLE_MS); }
  function toggle(on) {
    state.on = on;
    el.btn.classList.toggle("on", on);
    if (on) { startRec(); bump(); if (SR()) show('<span class="dot"></span><span class="t">Listening\u2026</span>', false, true); }
    else { clearTimeout(state.idle); if (state.rec) try { state.rec.onend = null; state.rec.stop(); } catch (x) {} el.bar.style.display = "none"; }
  }

  /* ---------- UI: one slim strip beside the mic ---------- */
  var css = "#ap-btn{position:fixed;right:22px;bottom:22px;width:48px;height:48px;border-radius:50%;border:0;background:#111;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer;z-index:2147483000;display:flex;align-items:center;justify-content:center}" +
    "#ap-btn.on{background:#F5B23B;color:#111;animation:ap-p 1.6s infinite}@keyframes ap-p{0%{box-shadow:0 0 0 0 rgba(245,178,59,.6)}70%{box-shadow:0 0 0 12px rgba(245,178,59,0)}100%{box-shadow:0 0 0 0 rgba(245,178,59,0)}}" +
    "#ap-bar{position:fixed;right:80px;overflow:hidden;bottom:27px;max-width:min(520px,calc(100vw - 110px));background:#111;color:#fff;border-radius:999px;padding:8px 14px;font:13px/1.35 Inter,system-ui,sans-serif;z-index:2147483000;display:none;align-items:center;gap:8px;box-shadow:0 4px 14px rgba(0,0,0,.25)}" +
    "#ap-bar .dot{width:8px;height:8px;border-radius:50%;background:#F5B23B;flex:none}#ap-bar .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#ap-bar .heard{color:#bbb;font-style:italic}" +
    "#ap-bar.miss .dot{background:#f87171}#ap-bar button{border:1px solid #444;background:#222;color:#fff;border-radius:999px;padding:3px 9px;cursor:pointer;font:inherit;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis;flex:none}#ap-bar .q{flex:none;white-space:nowrap}" +
    "#ap-bar input{background:transparent;border:0;color:#fff;font:inherit;outline:none;min-width:180px}";
  var el = {}, hideT = null;
  function build() {
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    el.btn = document.createElement("button"); el.btn.id = "ap-btn"; el.btn.title = "Ask Pravah"; el.btn.setAttribute("aria-label", "Ask Pravah");
    el.btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v5"/></svg>';
    el.bar = document.createElement("div"); el.bar.id = "ap-bar"; el.bar.setAttribute("role", "status"); el.bar.setAttribute("aria-live", "polite");
    document.body.appendChild(el.bar); document.body.appendChild(el.btn);
    el.btn.onclick = function () { toggle(!state.on); };
  }
  function show(html, isMiss, sticky) {
    clearTimeout(hideT);
    el.bar.innerHTML = html; el.bar.className = isMiss ? "miss" : ""; el.bar.style.display = "flex";
    if (!sticky && !state.on) hideT = setTimeout(function () { el.bar.style.display = "none"; }, 5000);
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function say(t, isMiss) {
    show('<span class="dot"></span><span class="t">' + esc(t) + "</span>", isMiss);
    if (state.on) hideT = setTimeout(function () { if (state.on) show('<span class="dot"></span><span class="t">Listening\u2026</span>', false, true); }, 4000);
  }
  function status(t) { say(t); }
  function heard(t) { if (t) show('<span class="dot"></span><span class="t heard">“' + esc(t) + '”</span>', false, true); }
  function ask(qtext, opts) {
    show('<span class="dot"></span><span class="q">' + esc(qtext) + "</span>", false, true);
    opts.slice(0, 3).forEach(function (o) { var b = document.createElement("button"); b.type = "button"; b.textContent = o.label.split(":")[0]; b.title = o.label; b.onclick = function () { o.run(); }; el.bar.appendChild(b); });
  }
  function typeBox() {
    show('<span class="dot"></span><input placeholder="Voice isn’t available here. Type: scan a badge…" aria-label="Ask Pravah">', false, true);
    var i = el.bar.querySelector("input"); i.focus();
    i.onkeydown = function (e) { if (e.key === "Enter") { var v = i.value; i.value = ""; handle(v); } if (e.key === "Escape") el.bar.style.display = "none"; };
  }
  function renderLog() {}

  function boot() {
    build();
    fetch("./ask-pravah-map.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (m) { MAP = m; window.__askPravahMap = m; }).catch(function () { el.btn.style.display = "none"; });
    window.askPravah = handle; /* lets tests and typing drive it */
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
