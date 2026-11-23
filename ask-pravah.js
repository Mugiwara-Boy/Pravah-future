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
    ["integration", "integrations", "connect", "crm", "link"],
    ["email", "emails", "communication", "communications", "mail"],
    ["update", "change", "edit", "fix", "set", "rename", "correct"],
    ["add", "new", "create", "invite"],
    ["show", "open", "go", "take", "see", "view", "list", "display"],
    ["live", "now", "happening", "feed"],
    ["photo", "picture", "upload", "image"],
    ["note", "notes"],
    ["name"], ["company"], ["title", "role", "designation"], ["phone", "mobile", "number"], ["linkedin"]
  ];
  var STOP = { the: 1, a: 1, an: 1, my: 1, me: 1, to: 1, for: 1, of: 1, this: 1, that: 1, please: 1, can: 1, you: 1, i: 1, want: 1, need: 1, it: 1, is: 1, our: 1, in: 1, on: 1, and: 1, us: 1, at: 1, with: 1, page: 1, screen: 1, tab: 1 };
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
  /* verb groups (update, add): an action phrase with a verb only counts when the ask has that verb too,
     so "order a pizza for the booth team" never starts "add a team member" on the word team alone */
  var VERBS = ["#" + GROUPS.findIndex(function (g) { return g[0] === "update"; }), "#" + GROUPS.findIndex(function (g) { return g[0] === "add"; })];
  var SHOWV = "#" + GROUPS.findIndex(function (g) { return g[0] === "show"; });
  function verbOk(qc, pc) {
    var need = VERBS.filter(function (v) { return pc[v]; });
    return !need.length || need.some(function (v) { return qc[v]; });
  }
  function score(q, phrases, needVerb) {
    var qc = concepts(q), best = 0, n = Object.keys(qc).length;
    if (!n) return 0;
    phrases.forEach(function (p) {
      var pc = concepts(p), pn = Object.keys(pc).length, hit = 0;
      if (needVerb && !verbOk(qc, pc)) return;
      var obj = 0;
      for (var k in qc) if (pc[k]) { hit++; if (k !== SHOWV) obj++; }
      /* a match on the verb alone (open, show, go, list) says nothing about where to go */
      if (!obj && n > 1) return;
      var s = pn ? (2 * hit) / (n + pn) : 0;
      if (s > best) best = s;
    });
    return best;
  }


  /* ---------- how people speak: turn speech into the text a field needs ---------- */
  var NUM = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
  function titleCase(t) { return t.replace(/\b([a-z])([a-z']*)/gi, function (m, a, b) { return a.toUpperCase() + b.toLowerCase(); }); }
  function joinSpelled(t) { /* "r o h i t" -> "rohit" */
    return t.replace(/\b(?:[a-z]\s){2,}[a-z]\b/gi, function (m) { return m.replace(/\s/g, ""); });
  }
  function spoken(t, type) {
    var x = " " + t.trim() + " ";
    x = x.replace(/\s+(?:capital|cap)\s+([a-z])\b/gi, function (m, c) { return " " + c.toUpperCase(); });
    if (type === "email" || type === "url") {
      x = x.replace(/\s(?:at the rate(?: of)?|at sign|at)\s/gi, "@")
           .replace(/\s(?:dot|period|point|full stop)\s/gi, ".")
           .replace(/\s(?:underscore|under score)\s/gi, "_")
           .replace(/\s(?:dash|hyphen|minus)\s/gi, "-")
           .replace(/\s(?:forward slash|slash)\s/gi, "/")
           .replace(/\scolon\s/gi, ":")
           .replace(/\s(?:space)\s/gi, " ");
      x = joinSpelled(x).replace(/\s+/g, "").toLowerCase();
      if (type === "url" && x && !/^https?:\/\//.test(x)) x = "https://" + x.replace(/^www\./, "www.");
      return x;
    }
    if (type === "phone") {
      x = x.toLowerCase().replace(/\bplus\b/g, "+").replace(/\bdouble (\w+)\b/g, "$1 $1").replace(/\btriple (\w+)\b/g, "$1 $1 $1");
      x = x.replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, function (m) { return NUM[m]; });
      return x.replace(/[^\d+]/g, "");
    }
    x = x.replace(/\snew line\s/gi, "\n").replace(/\s(?:full stop|period)\s/gi, ". ").replace(/\scomma\s/gi, ", ")
         .replace(/\squestion mark\s/gi, "? ").replace(/\s(?:space)\s/gi, " ").replace(/\s(?:hyphen|dash)\s/gi, "-");
    if (type === "name") {
      var fn = x.match(/first name\s+(.+?)(?=\s+(?:middle|last|surname)\s+name|\s+surname|$)/i),
          mn = x.match(/middle name\s+(.+?)(?=\s+(?:last|surname)\s+name|\s+surname|$)/i),
          ln = x.match(/(?:last name|surname)\s+(.+)$/i);
      if (fn || ln) x = [fn && fn[1], mn && mn[1], ln && ln[1]].filter(Boolean).join(" ");
      x = titleCase(joinSpelled(x).trim().replace(/\s+/g, " "));
      return x;
    }
    return x.trim().replace(/\s+([.,?])/g, "$1");
  }
  /* "name Rohit Sharma company Infosys email rohit at infosys dot com" -> slots */
  function slots(t, names) {
    var keys = names.map(function (n) { return n.toLowerCase(); }), out = {}, re = new RegExp("\\b(" + keys.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|") + ")\\b(?:\\s+is)?\\s+", "gi"), m, marks = [];
    while ((m = re.exec(t))) marks.push({ k: m[1].toLowerCase(), at: m.index, from: re.lastIndex });
    marks.forEach(function (mk, i) { out[mk.k] = t.slice(mk.from, i + 1 < marks.length ? marks[i + 1].at : t.length).trim(); });
    return out;
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
  function section(name) {
    var n = norm(name), heads = [].slice.call(document.querySelectorAll("h1,h2,h3,h4,strong,p,span,div")).filter(function (e) { return visible(e) && e.children.length === 0 && norm(e.innerText).indexOf(n) === 0; });
    for (var i = 0; i < heads.length; i++) {
      var box = heads[i];
      for (var k = 0; k < 6 && box; k++) { box = box.parentElement; if (box && box.querySelector("button")) return box; }
    }
    return null;
  }
  function button(text, within) {
    var root = within ? section(within) : document;
    if (within && !root) return null;
    var t = norm(text), all = [].slice.call(root.querySelectorAll("button,a,[role=button],[role=tab],label,[role=switch],input[type=checkbox]")).filter(visible);
    var byAria = all.filter(function (b) { return norm(b.getAttribute("aria-label")) === t || norm(b.placeholder) === t; })[0];
    if (byAria) return byAria;
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
    return els.filter(function (e) { return fieldLabel(e) === n; })[0] || els.filter(function (e) { return norm(e.placeholder) === n; })[0] || els.filter(function (e) { return fieldLabel(e).indexOf(n) === 0; })[0] || null;
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
    var then = function (dest, label) { waitFor(function () { return route() === dest; }).then(function () { setTimeout(function () { if (!applyHere(sc, q, label + ". ")) say(label + "."); afterOpen(sc, q); }, 500); }); };
    if (sc.level === "event") return resolveEvent(q, function (slug) { var d = fill(sc.route, slug); go(d); then(d, "Opened " + sc.name + " for " + eventName(slug)); });
    go(sc.route); then(sc.route, "Opened " + sc.name);
  }
  function afterOpen(sc, q) {
    /* a field named on the screen just opened (for example the ICP) */
    var f = bestField(sc, q);
    if (f && f.s > 0.45) waitFor(function () { return field(f.f.name); }).then(function (el) { if (el) editField(el, f.f, q); });
    var a = bestAction(sc, q);
    if (a && a.s > 0.5 && a.a.click) waitFor(function () { return button(a.a.click); }).then(function (b) { if (b) { b.click(); say(a.a.done || a.a.name + "."); } });
  }
  function editField(el, f, q) {
    var v = valueIn(q); if (v) v = spoken(v, f.type);
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


  /* ---------- guided flows on a screen (from the map) ---------- */
  function fieldType(sc, name) { var f = (sc.fields || []).filter(function (x) { return norm(x.name) === norm(name); })[0]; return f && f.type; }
  function runFlow(flow, sc, q) {
    var fid = state.flowId = (state.flowId || 0) + 1;
    var start = function (slug) {
      var dest = flow.route ? fill(flow.route, slug || "") : (sc.level === "event" ? fill(sc.route, slug) : sc.route);
      go(dest);
      var given = slots(q, flow.steps.filter(function (x) { return x.fill; }).map(function (x) { return x.fill; }));
      waitFor(function () { return route() === dest; }).then(function () { setTimeout(function () { if (fid === state.flowId) step(flow, sc, 0, given, fid); }, 250); });
    };
    var lvl = (flow.route || sc.route).indexOf(":slug") >= 0;
    return lvl ? resolveEvent(q, start) : start(null);
  }
  function indexOf(flow, id) { for (var i = 0; i < flow.steps.length; i++) if (flow.steps[i].id === id) return i; return -1; }
  function step(flow, sc, i, given, fid) {
    if (fid !== undefined && fid !== state.flowId) return;
    if (fid === undefined) fid = state.flowId;
    var st = flow.steps[i];
    if (!st) { state.pending = null; state.guided = false; setTimeout(clearSpot, 1500); return; }
    var next = function () { if (st.end) { state.pending = null; state.guided = false; return; } step(flow, sc, i + 1, given, fid); };
    if (st.ask) {
      return ask(st.ask, st.choices.map(function (c) {
        return { label: c.label, run: function () {
          if (c.click) { var b = button(c.click); if (b) b.click(); }
          if (c.go) return step(flow, sc, indexOf(flow, c.go), given, fid);
          say(c.say || "Done."); state.pending = null; state.guided = false; setTimeout(clearSpot, 1200);
        } };
      }));
    }
    if (state.guided && (st.click || st.fill)) {
      var gt = st.click ? function () { return button(st.click); } : function () { return field(st.fill); };
      var gtarget = gt();
      if (gtarget) { spotlight(gtarget, st.click ? "Clicking " + st.click : "Filling " + st.fill); }
      setTimeout(function () { if (fid !== state.flowId) return; var g = state.guided; state.guided = false; stepNow(flow, sc, i, given, fid); state.guided = g; }, gtarget ? 1600 : 0);
      return;
    }
    stepNow(flow, sc, i, given, fid);
  }
  function stepNow(flow, sc, i, given, fid) {
    var st = flow.steps[i];
    var next = function () { if (st.end) { state.pending = null; state.guided = false; return; } step(flow, sc, i + 1, given, fid); };
    if (st.click) {
      if (st.then && field(st.then.fill)) return sub(st.then, sc, function () { state.pending = null; });
      return waitFor(function () { return button(st.click); }).then(function (b) {
        if (fid !== state.flowId) return;
        if (!b) { say("I couldn't find " + st.click + " here."); return; }
        b.click();
        if (st.then) return sub(st.then, sc, function () { state.pending = null; });
        if (st.say) say(st.say);
        if (st.end) { state.pending = null; return; }
        if (st.say && /say next/i.test(st.say)) { state.pending = { kind: "flow", wait: true, next: next }; return; }
        next();
      });
    }
    if (st.fill) {
      return waitFor(function () { return field(st.fill); }).then(function (el) {
        if (fid !== state.flowId) return;
        if (!el) { if (st.optional) return next(); return say("I couldn't find " + st.fill + " here."); }
        var type = st.type || fieldType(sc, st.fill);
        var pre = given && given[st.fill.toLowerCase()];
        if (pre) { setValue(el, spoken(pre, type)); return next(); }
        focusField(el);
        say(st.fill + "?" + (st.optional ? " Or say skip." : ""));
        state.pending = { kind: "flow", el: el, f: { name: st.fill, type: type }, next: next };
      });
    }
    next();
  }
  function sub(spec, sc, done) {
    waitFor(function () { return field(spec.fill); }).then(function (el) {
      if (!el) return say("I couldn't find " + spec.fill + ".");
      focusField(el); say(spec.fill + "?");
      state.pending = { kind: "flow", el: el, f: { name: spec.fill }, next: function () {
        var b = button(spec.submit); if (b) b.click();
        if (spec.repeat) ask(spec.repeat, [{ label: "Yes", run: function () { sub(spec, sc, done); } }, { label: "No, done", run: function () { say("Done."); done(); } }]);
        else done();
      } };
    });
  }


  /* ---------- "how do I ...": show the steps on screen, highlighting each one ---------- */
  var hl = null;
  function spotlight(target, caption) {
    clearSpot();
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    var r = target.getBoundingClientRect();
    hl = document.createElement("div");
    hl.id = "ap-spot";
    hl.style.cssText = "position:fixed;z-index:2147482999;pointer-events:none;border:3px solid #F5B23B;border-radius:10px;box-shadow:0 0 0 9999px rgba(0,0,0,.35);transition:all .25s;left:" + (r.left - 6) + "px;top:" + (r.top - 6) + "px;width:" + (r.width + 12) + "px;height:" + (r.height + 12) + "px";
    var tip = document.createElement("div");
    tip.textContent = caption;
    tip.style.cssText = "position:absolute;left:0;top:" + (r.height + 18) + "px;background:#F5B23B;color:#111;font:600 13px Inter,system-ui,sans-serif;padding:6px 10px;border-radius:8px;white-space:nowrap";
    if (r.bottom + 60 > window.innerHeight) tip.style.top = "-40px";
    hl.appendChild(tip);
    document.body.appendChild(hl);
  }
  function clearSpot() { if (hl && hl.parentNode) hl.parentNode.removeChild(hl); hl = null; }
  function navLink(dest) { return [].slice.call(document.querySelectorAll('a[href="#' + dest + '"]')).filter(visible)[0] || null; }
  function pause(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  /* build the steps for a match, then walk them: highlight, explain, then do it */
  function showHow(c, q) {
    if (c.kind === "flow") { state.guided = true; say("I'll take you through it and do each step on screen."); return setTimeout(function () { runFlow(c.fl, c.sc, q); }, 900); }
    var steps = [];
    var dest = function (slug) { return slug ? fill(c.fl && c.fl.route || c.sc.route, slug) : (c.fl && c.fl.route) || c.sc.route; };
    var plan = function (slug) {
      var d = dest(slug).replace(/\/registrations\/:visitorId$/, "/registrations");
      var top = d.split("/").slice(0, slug ? 4 : 2).join("/");
      var cur = currentScreen();
      if (!(cur && cur.id === c.sc.id)) {
        if (c.sc.id === "S-23") return say("Open the visitor first, then ask me again.");
        steps.push({ find: function () { return navLink(d) || navLink(top); }, cap: "Open " + (c.sc.name.split(",")[0]), go: d });
      }
      if (c.kind === "field") steps.push({ find: function () { return c.sc.id === "S-23" ? button("Edit") : field(c.f.name); }, cap: c.sc.id === "S-23" ? "Click Edit" : "This is " + c.f.name, ask: c.f });
      if (c.kind === "action" && c.a.click) steps.push({ find: function () { return button(c.a.click); }, cap: "Click " + c.a.click, click: true });
      if (c.kind === "flow") c.fl.steps.forEach(function (st) {
        if (st.fill) steps.push({ find: function () { return field(st.fill); }, cap: "Fill in " + st.fill + (st.optional ? " (optional)" : "") });
        if (st.click && !st.end) steps.push({ find: function () { return button(st.click); }, cap: "Click " + st.click });
        if (st.then) { steps.push({ find: function () { return field(st.then.fill); }, cap: "Type it in " + st.then.fill }); steps.push({ find: function () { return button(st.then.submit); }, cap: "Click " + st.then.submit }); }
        if (st.click && st.end) steps.push({ find: function () { return button(st.click); }, cap: "Click " + st.click + " to finish" });
        if (st.ask) (st.choices || []).forEach(function (ch) { if (ch.click) steps.push({ find: function () { return button(ch.click); }, cap: "Then click " + ch.click }); });
      });
      state.walkId = (state.walkId || 0) + 1;
      walk(steps, 0, state.walkId);
    };
    (c.sc.level === "event" || (c.fl && (c.fl.route || "").indexOf(":slug") >= 0)) ? resolveEvent(q, plan) : plan(null);
  }
  function walk(steps, i, id) {
    if (id !== state.walkId) { return; }
    if (i >= steps.length) { setTimeout(clearSpot, 2500); if (!state.pending) say("Done."); return; }
    var st = steps[i];
    waitFor(st.find, 3000).then(function (target) {
      if (id !== state.walkId) return;
      say("Step " + (i + 1) + " of " + steps.length + ": " + st.cap + ".");
      spotlight(target, (i + 1) + ". " + st.cap);
      return pause(2200).then(function () {
        if (st.go && route() !== st.go) { if (target) target.click(); else go(st.go); }
        else if (st.click && target) target.click();
        else if (st.ask) {
          if (target && target.tagName === "BUTTON") { target.click(); return pause(700).then(function () { var el2 = field(st.ask.name); if (el2) { spotlight(el2, "Type or say the new " + st.ask.name.toLowerCase()); focusField(el2); state.pending = { kind: "value", el: el2, f: st.ask }; say("What should the " + st.ask.name.toLowerCase() + " be?"); } }); }
          if (target) { focusField(target); state.pending = { kind: "value", el: target, f: st.ask }; say("What should the " + st.ask.name.toLowerCase() + " be?"); }
          return pause(300);
        }
        return pause(900);
      });
    }).then(function () { walk(steps, i + 1, id); });
  }



  /* ---------- dropdown filters on the screen (choose actions in the map) ---------- */
  function optionsFor(a) { return a.options === "events" ? events().map(function (e) { return e.name; }) : (a.options || []); }
  function findBox(a) {
    var opts = optionsFor(a).map(norm);
    return [].slice.call(document.querySelectorAll("[role=combobox],select")).filter(visible).filter(function (b) {
      var t = norm(b.innerText || (b.options && b.options[b.selectedIndex] && b.options[b.selectedIndex].text));
      return t === norm(a.choose) || opts.indexOf(t) >= 0;
    })[0] || null;
  }
  function wantedOption(a, q) {
    if (a.options === "events") { var ne = namedEvents(q); return ne.length === 1 ? ne[0].name : null; }
    var lq = " " + q.toLowerCase().replace(/[^a-z0-9 ]/g, " ") + " ";
    var hit = optionsFor(a).slice().sort(function (x, y) { return y.length - x.length; }).filter(function (o) { return lq.indexOf(" " + o.toLowerCase().replace(/[^a-z0-9 ]/g, " ") + " ") >= 0; })[0];
    return hit || null;
  }
  function choose(a, opt) {
    var box = findBox(a);
    if (!box) return Promise.resolve(false);
    if (norm(box.innerText) === norm(opt)) return Promise.resolve(true);
    box.click();
    return waitFor(function () { return [].slice.call(document.querySelectorAll("[role=option]")).filter(function (o) { return visible(o) && norm(o.innerText) === norm(opt); })[0]; }, 2000).then(function (o) { if (o) { o.click(); return true; } document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return false; });
  }
  /* everything the user said that matches something on this screen, applied together */
  function screenMatches(sc, q) {
    var jobs = [];
    (sc.actions || []).forEach(function (a) {
      if (a.choose) { var o = wantedOption(a, q); if (o) jobs.push({ label: o, run: function () { return choose(a, o); } }); }
      else if (a.click && !a.confirm && !a.flow && score(q, (a.say || []).concat([a.name])) >= 0.6) jobs.push({ label: a.name.replace(/^Show /, ""), run: function () { var b = button(a.click, a.within); if (b) b.click(); return Promise.resolve(!!b); } });
    });
    return jobs;
  }
  function runJobs(jobs, i, done) {
    if (i >= jobs.length) return done();
    jobs[i].run().then(function () { setTimeout(function () { runJobs(jobs, i + 1, done); }, 350); });
  }
  function applyHere(sc, q, prefix) {
    var jobs = screenMatches(sc, q);
    if (!jobs.length) return false;
    runJobs(jobs, 0, function () { say((prefix || "") + "Showing " + jobs.map(function (j) { return j.label; }).join(" + ") + "."); });
    return true;
  }

  function bestField(sc, q) {
    var best = null;
    (sc.fields || []).forEach(function (f) { var s = score(q, f.say.concat([f.name])); if (!best || s > best.s) best = { f: f, s: s }; });
    return best;
  }
  function bestAction(sc, q) {
    var best = null;
    (sc.actions || []).forEach(function (a) { var s = score(q, (a.say || []).concat([a.name]), true); if (!best || s > best.s) best = { a: a, s: s }; });
    return best;
  }

  /* ---------- the matcher ---------- */
  function handle(raw) {
    var q = raw.trim();
    if (!q) return;
    /* the journal: an answer to Ask Pravah's own question stays in this command's row (settle(true));
       anything else is a new command (settle(false)): "no, ..." within 20 seconds marks the last command
       undone, otherwise the last row closes with what they said next. "No, open the team page" then runs
       as "open the team page". */
    var lq0 = q.toLowerCase(), now = Date.now(), settled = false;
    var mayAnswer = J.cur && now - J.cur.t0 < 60000 && ((state.choices && state.choices.length) || state.pending);
    var settle = function (asAnswer) {
      if (settled) return; settled = true;
      if (asAnswer) return jAnswer(q);
      var fresh = J.cur && Date.now() - J.cur.t0 < 20000;
      if (fresh && NEG.test(lq0) && !NEG.test(J.cur.words.toLowerCase())) { jThen("undone by: " + q); jFlush(); if (q.split(/\s+/).length > 2) jStart(q); }
      else { if (fresh) jThen("then said “" + q + "”"); jStart(q); }
    };
    if (!mayAnswer) settle(false);
    var rest0 = q.replace(/^(no|nope|not that|wrong)\b[,.!]?\s+(i (meant|said|asked( for)?)\s+)?|^i (meant|said|asked( for)?)\s+/i, "");
    if (rest0 !== q && rest0.split(/\s+/).length >= 2 && /^(open|show|go|take|find|search|filter|add|create|update|change|edit|set|scan|book|mark|export|invite|the|to)\b/i.test(rest0) && !(state.choices && state.choices.length)) { settle(false); q = rest0; }
    state.lastAt = now; state.lastScreen = route();
    state.log.unshift(q);
    state.walkId = (state.walkId || 0) + 1; clearSpot();
    if (!state.pending && !(state.choices && state.choices.length)) { state.flowId = (state.flowId || 0) + 1; state.guided = false; }
    var lq = q.toLowerCase();
    if (/^(save|save it|yes save|done|cancel|never mind|nevermind|wrong|that's wrong|thats wrong|not that|undo)$/.test(lq)) settle(!!state.pending);
    else if (/^(stop|stop listening|that's all|thats all|goodbye|bye|go back|back)\b/.test(lq)) settle(false);
    if (/^(stop|stop listening|that's all|thats all|goodbye|bye)\b/.test(lq)) { toggle(false); return; }
    if (/^(save|save it|yes save|done)$/.test(lq)) { var sv = button("Save") || button("Save ideal customer profile") || button("Save details") || button("Save defaults"); if (sv) { sv.click(); say("Saved."); state.pending = null; } else say("Nothing to save here."); return; }
    if (/^(cancel|never mind|nevermind|wrong|that's wrong|thats wrong|not that|undo)$/.test(lq)) { var c = button("Cancel"); if (c) c.click(); state.pending = null; say("Cancelled."); return; }
    if (/^(go back|back)$/.test(lq)) { history.back(); say("Back."); return; }

    /* answering a question by voice: say the choice, or yes / no */
    if (state.choices && state.choices.length) {
      var ch = state.choices, pick = null;
      ch.forEach(function (o) { if (!pick && (norm(o.label) === lq || norm(o.label).indexOf(lq) === 0 || lq.indexOf(norm(o.label)) >= 0)) pick = o; });
      if (!pick && /^(yes|yeah|yep|sure|ok|okay|go ahead|do it)\b/.test(lq)) pick = ch[0];
      if (!pick && /^(no|nope|not now|don't|dont)\b/.test(lq)) pick = ch.filter(function (o) { return /^(no|not)/i.test(o.label); })[0] || ch[ch.length - 1];
      if (!pick) { var bs = 0; ch.forEach(function (o) { var v = score(q, [o.label]); if (v > bs) { bs = v; pick = v >= 0.5 ? o : pick; } }); }
      if (pick) { settle(true); state.choices = null; pick.run(); return; }
    }
    state.choices = null;
    /* answering a step of a guided flow */
    if (state.pending && /^(open|go to|go back|take me|show|scan|update|change|edit|add|create|book|mark|how|stop|cancel)\b/.test(lq) && bestScore(q) >= 0.6) { state.pending = null; clearSpot(); }
    if (state.pending && state.pending.kind === "flow") {
      var pf = state.pending;
      if (/^(skip|next|no|none|continue|done)$/.test(lq)) { settle(true); state.pending = null; return pf.next(); }
      if (pf.wait) return settle(true);
      if (pf.el && document.contains(pf.el)) { settle(true); var fv = spoken(q, pf.f.type); setValue(pf.el, fv); say(pf.f.name + ": " + fv); state.pending = null; return setTimeout(pf.next, 600); }
    }
    /* dictating into the field we are in */
    if (state.pending && state.pending.kind === "value" && document.contains(state.pending.el) && !/\b(open|show|go to|take me|scan|update|change|add|edit)\b/.test(lq)) {
      settle(true); var nv = spoken(q, state.pending.f.type); setValue(state.pending.el, nv); say(state.pending.f.name + " set to “" + nv + "”. Say “save” to keep it."); return;
    }
    settle(false);
    if (/^(do it for me|do it|you do it)$/.test(lq) && state.lastHow) { var lh = state.lastHow; state.lastHow = null; state.howTo = false; return run(lh, state.lastHowQ || ""); }
    if (/^(next|skip|continue)$/.test(lq)) return say("Nothing is waiting for that right now.");
    var sm = lq.match(/^(?:please\s+)?(scroll|go|move|page)?\s*(down|up|to the top|to the bottom|top|bottom)\b/);
    if (sm && sm[2]) {
      var root = document.scrollingElement || document.documentElement;
      var panes = [].slice.call(document.querySelectorAll("body *")).filter(function (e) { return e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 200 && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && !e.closest("aside,nav,#ap-bar"); }).sort(function (a, b) { return b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth; });
      var pane = root.scrollHeight > root.clientHeight + 40 ? root : (panes[0] || root), h = (pane === root ? window.innerHeight : pane.clientHeight) * 0.8;
      var max = pane.scrollHeight - pane.clientHeight, at = pane.scrollTop;
      if (max < 40) return say("That's the whole page. Nothing more to scroll.");
      if (sm[2] === "up" && at <= 0 || /top/.test(sm[2]) && at <= 0) return say("Already at the top.");
      if ((sm[2] === "down" || /bottom/.test(sm[2])) && at >= max - 2) return say("Already at the bottom.");
      if (/top/.test(sm[2])) pane.scrollTo({ top: 0, behavior: "smooth" }); else if (/bottom/.test(sm[2])) pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
      else pane.scrollBy({ top: sm[2] === "up" ? -h : h, behavior: "smooth" });
      return say(sm[2] === "up" ? "Scrolled up." : /top/.test(sm[2]) ? "At the top." : /bottom/.test(sm[2]) ? "At the bottom." : "Scrolled down.");
    }
    if (/^(refresh|reload)( the page)?$/.test(lq)) { location.reload(); return; }
    if (/^(go to|open|show|take me to)( the| an| my| a)? (live )?(event|show)$/.test(lq)) return resolveEvent(q, function (slug) { go("/events/" + slug + "/registrations"); say("Opened " + eventName(slug) + "."); });
    var clickM = lq.match(/^(?:click|press|tap)\s+(.+)$/);
    if (clickM) { var b = button(clickM[1]); if (b) { b.click(); say("Clicked " + b.innerText.trim() + "."); } else miss(q, "no button called that here"); return; }

    var howTo = /^(how (do|can|would|should) (i|we|you)|how to|show me how|steps to|what are the steps|teach me|guide me)\b/.test(lq);
    if (howTo) { q = q.replace(/^(how (do|can|would|should) (i|we|you)|how to|show me how( to)?|steps to|what are the steps (to|for)|teach me( to| how to)?|guide me( to| through)?)\s*/i, ""); lq = q.toLowerCase(); }
    state.howTo = howTo;
    var ne = namedEvents(q);
    var here0 = currentScreen();
    /* the screen they are looking at comes first: filters and buttons on it, all at once */
    if (here0 && !howTo && applyHere(here0, q)) return;
    if (ne.length === 1 && /^(open|show|go to|take me to)\b/.test(lq) && !/\b(settings|visitors|registrations|report|analytics|leads|questions|feed|integrations|emails|communications|scan|badge|icps?|hot|warm|cold|intent|follow)\b/.test(lq)) { go("/events/" + ne[0].slug); say("Opened " + ne[0].name + "."); return; }
    var here = currentScreen();
    var cands = [];
    MAP.screens.forEach(function (sc) {
      cands.push({ sc: sc, kind: "screen", s: score(q, sc.say.concat([sc.name])) });
      (sc.fields || []).forEach(function (f) { if (f.edit) cands.push({ sc: sc, kind: "field", f: f, s: score(q, f.say) + (here && here.id === sc.id ? 0.08 : 0) }); });
      (sc.actions || []).forEach(function (a) { if (!a.flow) cands.push({ sc: sc, kind: "action", a: a, s: score(q, (a.say || []).concat([a.name]), true) + (here && here.id === sc.id ? 0.1 : 0) }); });
      (sc.flows || []).forEach(function (fl) { cands.push({ sc: sc, kind: "flow", fl: fl, s: score(q, fl.say, true) + 0.1 + (here && here.id === sc.id ? 0.1 : 0) }); });
    });
    cands = cands.filter(function (c) { return c.sc.verified !== false || c.kind !== "field" || c.sc.fields_verified !== false; });
    /* level hints: a named event or "this event" points to the event level; "company", "my", "org" without "event" to the org level */
    var wantsEvent = ne.length > 0 || /\b(this|the) (event|show)\b|\bfor (this|the) event\b|\bevent\b/.test(lq);
    var wantsOrg = !wantsEvent && /\b(company|org|organisation|organization|my|our|all)\b/.test(lq);
    cands.forEach(function (c) {
      if (c.kind !== "screen") c.s += 0.06;
      if (c.s >= 0.5 && wantsEvent && c.sc.level === "event") c.s += 0.15;
      if (c.s >= 0.5 && wantsOrg && c.sc.level === "org") c.s += 0.15;
    });
    cands.sort(function (a, b) { return b.s - a.s; });
    var top = cands[0];
    if (J.cur && top) J.cur.sure = top.s.toFixed(2) + ", best guess " + label(top) + " on " + top.sc.id;
    if ((!top || top.s < 0.5) && q.split(/\s+/).length > 12) { try { var ch = JSON.parse(localStorage.getItem("askpravah_chatter") || "[]"); ch.unshift({ at: new Date().toISOString(), words: q, screen: route() }); localStorage.setItem("askpravah_chatter", JSON.stringify(ch.slice(0, 50))); } catch (x) {} jDid("nothing: long, no match, taken as background talk"); return; }
    if (!top || top.s < (howTo ? 0.5 : 0.4)) {
      if (howTo) {
        var near = cands.slice(0, 2).filter(function (c) { return c.s >= 0.25; });
        if (near.length) return ask("Not sure. Did you mean", near.map(function (c) { return { label: label(c), run: function () { state.howTo = true; run(c, q); } }; }).concat([{ label: "None of these", run: function () { miss(q, "how-to with no match"); } }]));
        return miss(q, "how-to with no match");
      }
      if (/^(open|show|find|pull up|go to)\s+\w+/.test(lq) && openVisitor(q)) return;
      return miss(q, "no screen or action in the map matches");
    }
    var close = cands.filter(function (c) { return c.s >= top.s - 0.06 && label(c) !== label(top); }).slice(0, 2);
    if (close.length && top.s < 0.7) return ask("Did you mean", [top].concat(close).slice(0, 2).map(function (c) { return { label: label(c), run: function () { run(c, q); } }; }).concat([{ label: "None of these", run: function () { miss(q, "none of the guesses"); } }]));
    run(top, q);
  }
  function bestScore(q) {
    var b = 0;
    MAP.screens.forEach(function (sc) {
      b = Math.max(b, score(q, sc.say.concat([sc.name])));
      (sc.fields || []).forEach(function (f) { b = Math.max(b, score(q, f.say)); });
      (sc.actions || []).forEach(function (a) { b = Math.max(b, score(q, a.say || [], true)); });
      (sc.flows || []).forEach(function (fl) { b = Math.max(b, score(q, fl.say, true)); });
    });
    return b;
  }
  function label(c) { return c.kind === "screen" ? c.sc.name : c.kind === "field" ? c.f.name + " on " + c.sc.name : c.kind === "flow" ? c.fl.say[0].replace(/^./, function (x) { return x.toUpperCase(); }) : c.a.name; }
  function run(c, q) {
    if (c.sc.verified === false) return say(c.sc.name + " isn't confirmed in the map yet, so I won't act on it.");
    if (state.howTo) { state.lastHow = c; state.lastHowQ = q; return showHow(c, q); }
    if (c.kind === "screen") return openScreen(c.sc, q);
    if (c.kind === "flow") return runFlow(c.fl, c.sc, q);
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
      if (c.a.flow) { var fl = (c.sc.flows || []).filter(function (x) { return x.id === c.a.flow; })[0]; if (fl) return runFlow(fl, c.sc, q); }
      if (c.a.choose) return openScreen(c.sc, q);
      var here2 = currentScreen();
      var target = c.a.route || (here2 && here2.id === c.sc.id ? null : c.sc.route);
      if (target && target.indexOf(":visitorId") >= 0) return say("Open a visitor first, then say it again.");
      var act = function (slug) {
        if (target) go(slug ? fill(target, slug) : target);
        if (c.a.show) return waitFor(function () { return [].slice.call(document.querySelectorAll("h1,h2,h3")).filter(function (h) { return visible(h) && norm(h.innerText).indexOf(norm(c.a.show)) === 0; })[0]; }).then(function (h) { if (h) { h.scrollIntoView({ block: "start", behavior: "smooth" }); spotlight(h, c.a.name); setTimeout(clearSpot, 2000); } say(c.a.done || "Here it is."); });
        if (c.a.click) waitFor(function () { return button(c.a.click, c.a.within); }).then(function (b) {
          if (!b) return say("I couldn't find " + c.a.click + " here.");
          var doClick = function () { b.click(); var nm = c.a.name.replace(/^Show /, ""); var rest = screenMatches(c.sc, q).filter(function (j) { return j.label !== nm; }); if (rest.length) runJobs(rest, 0, function () { say("Showing " + [nm].concat(rest.map(function (j) { return j.label; })).join(" + ") + "."); }); else say(c.a.done || c.a.name + "."); };
          if (c.a.confirm) return ask(c.a.confirm, [{ label: "Yes", run: doClick }, { label: "No", run: function () { say("OK, left it."); } }]);
          doClick();
        });
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
  function whoAsked() {
    var team = [], org = {};
    try { team = JSON.parse(localStorage.getItem("pravah_team_v7") || "[]"); org = JSON.parse(localStorage.getItem("pravah_org_settings_v1") || "{}"); } catch (x) {}
    var side = ((document.querySelector("aside") || {}).innerText || "").split("\n").map(function (t) { return t.trim(); });
    var me = team.filter(function (m) { return side.indexOf(m.name) >= 0; })[0] || team.filter(function (m) { return m.isOwner; })[0] || {};
    var site = (org.businessWebsite || org.website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    var domain = (me.email || "").split("@")[1] || "";
    return { login: me.email || "unknown", user: (me.name || "unknown") + (me.access ? " (" + me.access + ")" : ""), account: site || domain || "unknown" };
  }
  /* ---------- the journal: every command, what Ask Pravah did, and what the user did next ----------
   * One row per command goes to the misses sheet (kind "miss", so the relay logs it and never emails):
   *   <words>  [screen: /route]  [sure: 0.62]  [did: Opened ICPs. | ...]  [then: stayed]  [ended on: /route]
   * "then" is what the user did in the next 20 seconds: stayed, said something else, clicked something
   * themselves, or undid it ("[undone by: ...]"). Jinbe's learning run reads every row, decides what the
   * app should have done, and teaches the map. Answers to Ask Pravah's own questions stay in the same row. */
  var J = { cur: null, t: null };
  var NEG = /^(no|nope|wrong|that's wrong|thats wrong|not that|not this|undo|cancel|never mind|nevermind|go back|back)\b|^i (meant|said|asked)\b/;
  function appName() { return /github\.io$|localhost|127\.0\.0\.1/.test(location.hostname) ? "dream app" : "product"; }
  function clip(t, n) { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; }
  function jStart(q) { jFlush(); J.cur = { at: new Date().toISOString(), words: q, screen: route(), did: [], ans: [], then: null, sure: null, t0: Date.now() }; J.t = setTimeout(jFlush, 20000); }
  function jDid(t) { if (J.cur && J.cur.did.length < 4 && J.cur.did[J.cur.did.length - 1] !== clip(t, 120)) J.cur.did.push(clip(t, 120)); }
  function jThen(t) { if (J.cur && !J.cur.then) J.cur.then = clip(t, 120); }
  function jAnswer(t) { if (!J.cur) return; if (J.cur.ans.length < 4) J.cur.ans.push(clip(t, 60)); clearTimeout(J.t); J.t = setTimeout(jFlush, 20000); }
  function jFlush() {
    clearTimeout(J.t); var r = J.cur; J.cur = null; if (!r) return;
    var w = clip(r.words, 160) + "  [screen: " + r.screen + "]" + (r.sure ? "  [sure: " + r.sure + "]" : "") + "  [did: " + (r.did.join(" | ") || "nothing") + "]";
    if (r.ans.length) w += "  [answered: " + r.ans.join(" | ") + "]";
    w += r.then && /^undone by: /.test(r.then) ? "  [" + r.then + "]" : "  [then: " + (r.then || "stayed") + "]";
    if (route() !== r.screen) w += "  [ended on: " + route() + "]";
    var who = whoAsked();
    sendRequest({ kind: "miss", at: r.at, words: w, screen: r.screen, app: appName(), account: who.account, login: who.login });
  }
  /* the user's own clicks (not Ask Pravah's) right after a command tell Jinbe what they wanted */
  document.addEventListener("click", function (e) {
    if (!e.isTrusted || !J.cur || Date.now() - J.cur.t0 > 20000) return;
    var t = e.target && e.target.closest ? e.target.closest("#ap-bar,#ap-btn") : null;
    if (t) return;
    var b = e.target && e.target.closest ? e.target.closest("a,button,[role=button],[role=option],[role=tab],input,select,textarea") : null;
    jThen("then clicked “" + clip(b ? (b.innerText || b.getAttribute("aria-label") || b.placeholder || b.tagName) : "the page", 40) + "” themselves");
  }, true);
  window.addEventListener("pagehide", function () { jFlush(); });

  /* the relay: the misses sheet (every command, see the journal); client requests (live product only) are emailed and filed in GitHub.
   * Tests on localhost never reach the sheet: their rows are kept in window.__askPravahSent (add ?relay=1 to send for real). */
  function sendRequest(rec) {
    var url = MAP && MAP.feature_request_relay;
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !/[?&]relay=1\b/.test(location.search)) { (window.__askPravahSent = window.__askPravahSent || []).push(rec); return; }
    if (!url) return;
    try { fetch(url, { method: "POST", mode: "no-cors", keepalive: true, headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(rec) }); } catch (x) {}
  }
  function miss(q, why) {
    var rec = { at: new Date().toISOString(), words: q, screen: route(), why: why };
    try { var m = JSON.parse(localStorage.getItem("askpravah_misses") || "[]"); m.unshift(rec); localStorage.setItem("askpravah_misses", JSON.stringify(m.slice(0, 200))); } catch (x) {}
    /* the miss rides in this command's journal row (log only, no email); Jinbe's learning run teaches it to the map */
    if (!J.cur) jStart(q);
    jDid("no match: " + why);
    var file = function (level) {
      rec.critical = level; rec.kind = "request";
      var who = whoAsked(); rec.login = who.login; rec.user = who.user; rec.account = who.account; rec.app = "dream app";
      sendRequest(rec);
      try { var f = JSON.parse(localStorage.getItem("askpravah_feature_requests") || "[]"); f.unshift(rec); localStorage.setItem("askpravah_feature_requests", JSON.stringify(f.slice(0, 200))); } catch (x) {}
    };
    if (/github\.io$|localhost|127\.0\.0\.1/.test(location.hostname)) { return say("Not yet. I've noted it so Jinbe can teach me.", true); }
    ask("I'm not sure Pravah can do that today. Is it critical for you?", [
      { label: "Critical", run: function () { file("critical"); say("Got it, marked critical. I've passed it to the team and I'll get back to you on this."); } },
      { label: "Nice to have", run: function () { file("nice to have"); say("Noted for the team. I'll get back to you on this."); } },
      { label: "Not needed", run: function () { file("not needed"); say("OK, noted."); } }
    ]);
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
    jDid(t);
    show('<span class="dot"></span><span class="t">' + esc(t) + "</span>", isMiss);
    /* "Not this": one tap tells Jinbe the last command did the wrong thing */
    if (!isMiss && J.cur) {
      var nb = document.createElement("button"); nb.type = "button"; nb.textContent = "Not this"; nb.title = "Ask Pravah did the wrong thing";
      nb.onclick = function () { jThen("undone by: Not this button"); jFlush(); show('<span class="dot"></span><span class="t">Noted. Say what you meant and I\u2019ll learn it.</span>', false, state.on); };
      el.bar.appendChild(nb);
    }
    if (state.on) hideT = setTimeout(function () { if (state.on) show('<span class="dot"></span><span class="t">Listening\u2026</span>', false, true); }, 4000);
  }
  function status(t) { say(t); }
  function heard(t) { if (t) show('<span class="dot"></span><span class="t heard">“' + esc(t) + '”</span>', false, true); }
  function ask(qtext, opts) {
    state.choices = opts;
    jDid("asked “" + qtext + "” (" + opts.slice(0, 3).map(function (o) { return o.label; }).join(" / ") + ")");
    show('<span class="dot"></span><span class="q">' + esc(qtext) + "</span>", false, true);
    opts.slice(0, 3).forEach(function (o) { var b = document.createElement("button"); b.type = "button"; b.textContent = o.label.split(":")[0]; b.title = o.label; b.onclick = function () { jAnswer("tapped " + o.label); state.choices = null; o.run(); }; el.bar.appendChild(b); });
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
