/* =========================================================
   Jobaro quote form
   Reads /businesses/<id>.json (from ?b=<id>), asks the questions one
   step at a time, shows a price range (or a visit request), collects
   contact details and sends everything to the business's formEndpoint.
   Optional URL settings:
     ?b=<id>        business settings file to load (required)
     &s=<service>   skip the "What do you need?" step
     &embed=1       set by widget.js when shown in the pop-up
   ========================================================= */
(function () {
  "use strict";

  var root = document.getElementById("q");
  var params = new URLSearchParams(location.search);
  var EMBED = params.get("embed") === "1";
  var JOBARO_URL = "https://jobaro.netlify.app/";
  if (EMBED) document.documentElement.classList.add("embed");

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function slug(s) { return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function round5(n) { return Math.round(n / 5) * 5; }
  function money(n) { return "£" + Math.max(0, n).toLocaleString("en-GB"); }
  function bird(s) { return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 64 64" aria-hidden="true"><use href="#jb-bird"/></svg>'; }
  var ICON_OK = '<svg width="26" height="26" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_LOCK = '<svg width="14" height="16" viewBox="0 0 10 12" aria-hidden="true"><rect x="1" y="5" width="8" height="6.5" rx="1.5" fill="#6D7079"/><path d="M3 5V3.5a2 2 0 014 0V5" stroke="#6D7079" stroke-width="1.3" fill="none"/></svg>';
  function tomorrow() { var d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
  function niceDate(v) {
    if (!v) return "";
    var d = new Date(v + "T12:00:00");
    return isNaN(d) ? v : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  function post(msg) { if (EMBED && window.parent !== window) window.parent.postMessage({ jobaro: true, type: msg }, "*"); }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") post("close"); });

  /* ---------- state ---------- */
  var S = {
    biz: null, svc: null, fixed: false, steps: [], i: 0,
    ans: {}, visit: { dates: ["", "", ""], time: "Any time" },
    contact: { name: "", phone: "", email: "", postcode: "" },
    status: "idle", error: ""
  };

  /* ---------- settings file ---------- */
  var TYPES = {
    "single": "single", "single choice": "single", "choice": "single", "radio": "single",
    "multiple": "multiple", "multiple choice": "multiple", "extras": "multiple", "checkbox": "multiple",
    "counter": "counter", "number": "counter",
    "size": "size", "approximate size": "size", "area": "size",
    "date": "date",
    "text": "text", "free text": "text",
    "contact": "contact", "contact details": "contact"
  };

  function check(c) {
    if (!c || typeof c !== "object") return "The settings file is empty.";
    if (!c.businessName) return "The settings file needs a businessName.";
    if (!c.formEndpoint || !/^https:\/\//.test(c.formEndpoint)) return "The settings file needs a formEndpoint starting with https://.";
    if (!Array.isArray(c.services) || !c.services.length) return "The settings file needs at least one service.";
    for (var i = 0; i < c.services.length; i++) {
      var s = c.services[i], where = "Service " + (i + 1) + (s && s.name ? " (" + s.name + ")" : "");
      if (!s || !s.name) return where + " needs a name.";
      var mode = String(s.mode || "price").toLowerCase();
      if (mode !== "price" && mode !== "visit") return where + ": mode must be \"price\" or \"visit\".";
      if (mode === "price" && !(s.pricing && isFinite(Number(s.pricing.base)))) return where + " needs pricing with a base price.";
      var qs = s.questions || [];
      for (var j = 0; j < qs.length; j++) {
        var q = qs[j], t = TYPES[String(q && q.type || "").toLowerCase()];
        if (!t) return where + ", question " + (j + 1) + " has an unknown type \"" + (q && q.type) + "\".";
        if (!q.label && t !== "contact") return where + ", question " + (j + 1) + " needs a label.";
        if ((t === "single" || t === "multiple") && !(Array.isArray(q.options) && q.options.length)) return where + ", question \"" + q.label + "\" needs options.";
      }
    }
    return null;
  }

  function normalise(c) {
    var b = {
      id: c.id, businessName: String(c.businessName), email: c.email || "",
      initials: c.initials || String(c.businessName).split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase(),
      brandColour: /^#[0-9a-f]{3,8}$/i.test(c.brandColour || "") ? c.brandColour : "#16181D",
      formEndpoint: c.formEndpoint, demo: !!c.demo,
      privacyNote: c.privacyNote || ("Your details are only shared with " + c.businessName + " so they can reply to your request.")
    };
    b.services = c.services.map(function (s) {
      var mode = String(s.mode || "price").toLowerCase();
      var qs = (s.questions || []).map(function (q, n) {
        var t = TYPES[String(q.type).toLowerCase()];
        var out = {
          id: q.id || "q" + (n + 1), type: t, label: q.label || "", help: q.help || "", placeholder: q.placeholder || "",
          required: t === "multiple" || t === "text" ? q.required === true : q.required !== false,
          unit: q.unit || "", min: num(q.min, t === "counter" ? 0 : 1), max: num(q.max, t === "counter" ? 10 : 500),
          pricePerUnit: num(q.pricePerUnit, 0), pricePerM2: num(q.pricePerM2, 0), allowFlexible: q.allowFlexible !== false
        };
        out.includedUnits = num(q.includedUnits, out.min);
        out.includedM2 = num(q.includedM2, 0);
        out.def = q.default;
        out.options = (q.options || []).map(function (o) {
          if (typeof o !== "object") o = { label: String(o) };
          return { label: String(o.label), hint: o.hint || "", price: num(o.price, 0), multiply: num(o.multiply, 1) };
        });
        return out;
      }).filter(function (q) { return q.type !== "contact"; });   // contact details are always the last step
      return {
        id: slug(s.id || s.name), name: String(s.name), mode: mode, questions: qs,
        pricing: { base: num(s.pricing && s.pricing.base, 0), rangePercent: num(s.pricing && s.pricing.rangePercent, 10), minimum: num(s.pricing && s.pricing.minimum, 0) }
      };
    });
    return b;
  }

  function load() {
    var id = (params.get("b") || "").trim().toLowerCase();
    if (!id) return fatal("This quote form link isn't complete", "The link is missing the business's name. If you came from a business's website, please contact them directly.");
    if (!/^[a-z0-9-]{1,80}$/.test(id)) return fatal("We couldn't find this quote form", "Please check the link, or contact the business directly.");
    fetch("/businesses/" + id + ".json", { cache: "no-cache" }).then(function (res) {
      if (res.status === 404) return fatal("We couldn't find this quote form", "There's no quote form called “" + id + "”. Please check the link, or contact the business directly.");
      if (!res.ok) return fatal("We couldn't load this quote form", "Something went wrong on our side. Please try again in a moment.", true);
      return res.text().then(function (txt) {
        var cfg;
        try { cfg = JSON.parse(txt); } catch (e) {
          console.error("Jobaro: " + id + ".json is not valid JSON.", e);
          return fatal("This quote form isn't set up correctly", "The business's settings file couldn't be read. If this is your business, check it for a missing comma or quote mark.");
        }
        var problem = check(cfg);
        if (problem) { console.error("Jobaro settings problem:", problem); return fatal("This quote form isn't set up correctly", problem); }
        start(normalise(cfg));
      });
    }).catch(function () {
      fatal("We couldn't load this quote form", "Please check your internet connection and try again.", true);
    });
  }

  function start(biz) {
    S.biz = biz;
    document.title = "Get a quote · " + biz.businessName;
    document.documentElement.style.setProperty("--biz", biz.brandColour);
    var pre = slug(params.get("s"));
    var svc = biz.services.filter(function (s) { return s.id === pre; })[0] || (biz.services.length === 1 ? biz.services[0] : null);
    if (svc) { S.fixed = true; chooseService(svc); }
    build();
    render();
  }

  function chooseService(svc) {
    if (S.svc === svc) return;
    S.svc = svc;
    S.ans = {};
    svc.questions.forEach(function (q) {
      if (q.type === "counter") S.ans[q.id] = Math.min(q.max, Math.max(q.min, num(q.def, q.min)));
      else if (q.type === "size") S.ans[q.id] = q.def != null ? String(q.def) : "";
      else if (q.type === "multiple") S.ans[q.id] = [];
      else if (q.type === "date") S.ans[q.id] = { date: "", flexible: false };
      else if (q.type === "text") S.ans[q.id] = "";
    });
  }

  function build() {
    var st = [];
    if (!S.fixed) st.push({ kind: "service" });
    if (S.svc) {
      S.svc.questions.forEach(function (q) { st.push({ kind: "q", q: q }); });
      st.push({ kind: S.svc.mode === "visit" ? "visit" : "price" });
      st.push({ kind: "contact" });
    }
    S.steps = st;
  }

  /* ---------- pricing ---------- */
  function price() {
    var s = S.svc, total = s.pricing.base, mult = 1;
    s.questions.forEach(function (q) {
      var a = S.ans[q.id];
      if (q.type === "single" && a != null) { var o = q.options[a]; total += o.price; mult *= o.multiply; }
      if (q.type === "multiple") (a || []).forEach(function (i) { total += q.options[i].price; mult *= q.options[i].multiply; });
      if (q.type === "counter") total += (a - q.includedUnits) * q.pricePerUnit;
      if (q.type === "size" && a !== "") total += Math.max(0, num(a, 0) - q.includedM2) * q.pricePerM2;
    });
    total = Math.max(total * mult, s.pricing.minimum, 0);
    var r = s.pricing.rangePercent / 100;
    var low = round5(total * (1 - r)), high = round5(total * (1 + r));
    if (high <= low) high = low + 5;
    return { low: low, high: high, text: money(low) + "–" + money(high) };
  }

  function answerText(q) {
    var a = S.ans[q.id];
    if (q.type === "single") return a == null ? "" : q.options[a].label;
    if (q.type === "multiple") return (a || []).length ? a.map(function (i) { return q.options[i].label; }).join(", ") : "None";
    if (q.type === "counter") return String(a);
    if (q.type === "size") return a === "" ? "Not given" : a + " m²";
    if (q.type === "date") return a.flexible ? "Flexible" : niceDate(a.date);
    if (q.type === "text") return a ? a : "Nothing added";
    return "";
  }

  /* ---------- rendering ---------- */
  function header() {
    return '<div class="q-top"><span class="q-av" aria-hidden="true">' + esc(S.biz.initials) + '</span><div class="q-biz"><b>' + esc(S.biz.businessName) + '</b><small>' + (S.svc && S.svc.mode === "visit" ? "Site visit request" : "Instant quote") + '</small></div>' + (S.biz.demo ? '<span class="q-demo" title="This is a demo business">Demo</span>' : "") + "</div>";
  }
  function powered() {
    return '<a class="q-pow" href="' + JOBARO_URL + '" target="_blank" rel="noopener">Powered by ' + bird(13) + " <b>jobaro</b></a>";
  }
  function stepLabel(st) {
    if (st.kind === "price") return "Your price";
    if (st.kind === "visit") return "Book a visit";
    if (st.kind === "contact") return "Your details";
    return S.svc ? "Step " + (S.i + 1) + " of " + (S.steps.length - 2) : "Step 1";
  }

  function render() {
    var st = S.steps[S.i];
    var total = S.svc ? S.steps.length : 6;
    var pct = Math.round((S.i + 1) / total * 100);
    root.innerHTML = header() +
      '<div class="q-prog" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="width:' + pct + '%"></span></div>' +
      '<form class="q-body in" id="qf" novalidate><p class="q-step">' + esc(stepLabel(st)) + "</p>" + body(st) + '<p class="q-err" id="qerr" role="alert"></p>' +
      (st.kind === "contact" && S.status === "failed" ? failBox() : "") + "</form>" +
      foot(st) + powered();
    bind(st);
    var h = root.querySelector(".q-title");
    if (h && render.moved) h.focus({ preventScroll: true });
    render.moved = false;
  }

  function title(t, help) { return '<h1 class="q-title" tabindex="-1">' + esc(t) + "</h1>" + (help ? '<p class="q-help">' + esc(help) + "</p>" : ""); }

  function body(st) {
    var b = S.biz.businessName;
    if (st.kind === "service") {
      return title("What do you need?", "Choose a service to get started.") + '<div class="opts" role="radiogroup" aria-label="Service">' +
        S.biz.services.map(function (s, i) {
          return '<button type="button" class="opt" role="radio" aria-checked="' + (S.svc === s) + '" data-svc="' + i + '"><span class="rd"></span><span>' + esc(s.name) + "</span><small>" + (s.mode === "visit" ? "Site visit" : "Instant price") + "</small></button>";
        }).join("") + "</div>";
    }
    if (st.kind === "q") return question(st.q);
    if (st.kind === "price") {
      var p = price();
      return title("Here's your price") +
        '<div class="est"><div class="est-lbl">Your price range</div><div class="est-price">' + p.text + '</div><div class="est-note">Based on your answers and ' + esc(b) + "'s prices. " + esc(b) + " will confirm the final price.</div></div>" +
        summary() + '<p class="q-ready">Ready to book? Add your details next.</p>';
    }
    if (st.kind === "visit") {
      return title("This job needs a visit", b + " will come and measure up before giving you a price. When would suit you?") +
        '<div class="visit-dates">' + ["First choice", "Second choice", "Third choice"].map(function (l, i) {
          return '<div class="f"><label for="vd' + i + '">' + l + (i ? " <small>(optional)</small>" : "") + '</label><input class="inp" type="date" id="vd' + i + '" data-vd="' + i + '" min="' + tomorrow() + '" value="' + esc(S.visit.dates[i]) + '"></div>';
        }).join("") + "</div>" +
        '<p class="q-sub" id="tod">Best time of day</p><div class="chips" role="radiogroup" aria-labelledby="tod">' + ["Morning", "Afternoon", "Any time"].map(function (t) {
          return '<button type="button" class="chip" role="radio" aria-checked="' + (S.visit.time === t) + '" aria-pressed="' + (S.visit.time === t) + '" data-tod="' + t + '">' + t + "</button>";
        }).join("") + "</div>";
    }
    if (st.kind === "contact") {
      var c = S.contact;
      return title("Your details", "So " + b + " can send your quote and book the job.") + '<div class="fields">' +
        field("name", "Full name", "text", c.name, "name") +
        field("phone", "Phone number", "tel", c.phone, "tel") +
        field("email", "Email", "email", c.email, "email") +
        field("postcode", "Postcode", "text", c.postcode, "postal-code") +
        "</div>" + '<p class="q-privacy">' + ICON_LOCK + "<span>" + esc(S.biz.privacyNote) + "</span></p>";
    }
    return "";
  }

  function field(id, label, type, val, ac) {
    return '<div class="f"><label for="c-' + id + '">' + label + '</label><input class="inp" id="c-' + id + '" data-c="' + id + '" type="' + type + '" autocomplete="' + ac + '" value="' + esc(val) + '"' + (id === "postcode" ? ' autocapitalize="characters"' : "") + (type === "tel" ? ' inputmode="tel"' : "") + '><p class="q-err" id="e-' + id + '"></p></div>';
  }

  function question(q) {
    var a = S.ans[q.id];
    if (q.type === "single") {
      return title(q.label, q.help) + '<div class="opts" role="radiogroup" aria-label="' + esc(q.label) + '">' + q.options.map(function (o, i) {
        return '<button type="button" class="opt" role="radio" aria-checked="' + (a === i) + '" data-opt="' + i + '"><span class="rd"></span><span>' + esc(o.label) + "</span>" + (o.hint ? "<small>" + esc(o.hint) + "</small>" : "") + "</button>";
      }).join("") + "</div>";
    }
    if (q.type === "multiple") {
      return title(q.label, q.help || "Choose any that apply.") + '<div class="chips" role="group" aria-label="' + esc(q.label) + '">' + q.options.map(function (o, i) {
        return '<button type="button" class="chip" aria-pressed="' + (a.indexOf(i) > -1) + '" data-multi="' + i + '">' + esc(o.label) + "</button>";
      }).join("") + "</div>" + (q.required ? "" : '<p class="q-opt-note">Nothing to add? Just press Continue.</p>');
    }
    if (q.type === "counter") {
      return title(q.label, q.help) + '<div class="ctr"><button type="button" class="ctr-b" data-step="-1" aria-label="Fewer"' + (a <= q.min ? " disabled" : "") + '>−</button><div><output class="ctr-v" id="ctrv" aria-live="polite">' + a + "</output>" + (q.unit ? '<span class="ctr-u">' + esc(q.unit) + "</span>" : "") + '</div><button type="button" class="ctr-b p" data-step="1" aria-label="More"' + (a >= q.max ? " disabled" : "") + ">+</button></div>";
    }
    if (q.type === "size") {
      var v = a === "" ? q.min : num(a, q.min);
      return title(q.label, q.help || "A best guess is fine.") + '<label class="sr" for="size">Size in square metres</label><div class="size"><input class="inp" id="size" type="number" inputmode="decimal" min="' + q.min + '" max="' + q.max + '" step="1" value="' + esc(a) + '" data-size><span>m²</span></div>' +
        '<input class="range" type="range" min="' + q.min + '" max="' + q.max + '" step="1" value="' + Math.min(q.max, v) + '" aria-label="Size slider" data-range><div class="range-v"><span>' + q.min + " m²</span><span>" + q.max + " m²+</span></div>";
    }
    if (q.type === "date") {
      return title(q.label, q.help) + '<label class="sr" for="date">Date</label><input class="inp" id="date" type="date" min="' + tomorrow() + '" value="' + esc(a.date) + '" data-date>' +
        (q.allowFlexible ? '<label class="chk"><input type="checkbox" data-flex' + (a.flexible ? " checked" : "") + "> I'm flexible on the date</label>" : "");
    }
    if (q.type === "text") {
      return title(q.label, q.help) + '<label class="sr" for="txt">' + esc(q.label) + '</label><textarea class="inp" id="txt" data-text placeholder="' + esc(q.placeholder) + '">' + esc(a) + "</textarea>" + (q.required ? "" : '<p class="q-opt-note">Optional</p>');
    }
    return "";
  }

  function summary() {
    var rows = [["Service", S.svc.name]].concat(S.svc.questions.filter(function (q) { return q.type !== "text"; }).map(function (q) { return [shortLabel(q), answerText(q)]; }));
    return '<ul class="sum">' + rows.map(function (r) { return "<li><span>" + esc(r[0]) + "</span><span>" + esc(r[1]) + "</span></li>"; }).join("") + "</ul>";
  }
  function shortLabel(q) {
    var map = { counter: q.unit ? q.unit.charAt(0).toUpperCase() + q.unit.slice(1) : "", date: "Preferred date", size: "Size" };
    if (map[q.type]) return map[q.type];
    if (!/^q\d+$/.test(q.id)) { var t = q.id.replace(/[-_]+/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); }
    return q.label.replace(/\?$/, "");
  }

  function foot(st) {
    var first = S.i === 0;
    var label = "Continue";
    if (st.kind === "contact") label = S.svc.mode === "visit" ? "Request a visit" : "Send my details";
    if (S.status === "failed" && st.kind === "contact") label = "Try again";
    var sending = S.status === "sending";
    return '<div class="q-foot">' + (first ? "<span></span>" : '<button type="button" class="q-back" id="qback"' + (sending ? " disabled" : "") + ">Back</button>") +
      '<button type="submit" form="qf" class="q-next" id="qnext"' + (sending ? " disabled" : "") + ">" + (sending ? '<span class="spin" aria-hidden="true"></span>Sending…' : label + " <span aria-hidden=\"true\">→</span>") + "</button></div>";
  }

  function failBox() {
    return '<div class="q-fail" role="alert"><b>Your details haven\'t been sent yet.</b>We couldn\'t reach ' + esc(S.biz.businessName) + (/\.$/.test(S.biz.businessName) ? " " : ". ") + "Please check your internet connection and press Try again." +
      (S.biz.email ? ' If it still doesn\'t work, email <a href="mailto:' + esc(S.biz.email) + '">' + esc(S.biz.email) + "</a>." : "") + "</div>";
  }

  /* ---------- events ---------- */
  function bind(st) {
    var form = document.getElementById("qf");
    form.addEventListener("submit", function (e) { e.preventDefault(); next(); });
    var back = document.getElementById("qback");
    if (back) back.addEventListener("click", function () { go(-1); });

    root.querySelectorAll("[data-svc]").forEach(function (el) {
      el.addEventListener("click", function () { chooseService(S.biz.services[+el.dataset.svc]); build(); rerender(); });
    });
    var q = st.q;
    root.querySelectorAll("[data-opt]").forEach(function (el) {
      el.addEventListener("click", function () { S.ans[q.id] = +el.dataset.opt; rerender(); });
    });
    root.querySelectorAll("[data-multi]").forEach(function (el) {
      el.addEventListener("click", function () {
        var i = +el.dataset.multi, a = S.ans[q.id], k = a.indexOf(i);
        if (k > -1) a.splice(k, 1); else a.push(i);
        el.setAttribute("aria-pressed", String(k === -1));
      });
    });
    root.querySelectorAll("[data-step]").forEach(function (el) {
      el.addEventListener("click", function () {
        S.ans[q.id] = Math.min(q.max, Math.max(q.min, S.ans[q.id] + +el.dataset.step));
        rerender("[data-step='" + el.dataset.step + "']");
      });
    });
    var size = root.querySelector("[data-size]"), range = root.querySelector("[data-range]");
    if (size) {
      size.addEventListener("input", function () { S.ans[q.id] = size.value; if (size.value !== "") range.value = size.value; });
      range.addEventListener("input", function () { S.ans[q.id] = range.value; size.value = range.value; });
    }
    var date = root.querySelector("[data-date]"), flex = root.querySelector("[data-flex]");
    if (date) date.addEventListener("input", function () { S.ans[q.id].date = date.value; if (date.value && flex) { flex.checked = false; S.ans[q.id].flexible = false; } });
    if (flex) flex.addEventListener("change", function () { S.ans[q.id].flexible = flex.checked; });
    var txt = root.querySelector("[data-text]");
    if (txt) txt.addEventListener("input", function () { S.ans[q.id] = txt.value; });
    root.querySelectorAll("[data-vd]").forEach(function (el) { el.addEventListener("input", function () { S.visit.dates[+el.dataset.vd] = el.value; }); });
    root.querySelectorAll("[data-tod]").forEach(function (el) { el.addEventListener("click", function () { S.visit.time = el.dataset.tod; rerender(); }); });
    root.querySelectorAll("[data-c]").forEach(function (el) { el.addEventListener("input", function () { S.contact[el.dataset.c] = el.value; el.classList.remove("bad"); var m = document.getElementById("e-" + el.dataset.c); if (m) m.textContent = ""; }); });
  }

  // re-render the same step (after a tap) without the slide-in animation, keeping focus where it was
  function rerender(focusSel) {
    var active = document.activeElement, key = focusSel || (active && active.dataset ? selectorFor(active) : null);
    render();
    var b = root.querySelector(".q-body"); if (b) b.classList.remove("in");
    var el = key && root.querySelector(key);
    if (el && !el.disabled) el.focus(); else if (key) { var t = root.querySelector(".q-title"); if (t) t.focus(); }
  }
  function selectorFor(el) {
    var ds = el.dataset;
    for (var k in ds) if (Object.prototype.hasOwnProperty.call(ds, k)) return "[data-" + k.replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); }) + "='" + ds[k] + "']";
    return null;
  }

  function go(d) {
    S.i = Math.max(0, Math.min(S.steps.length - 1, S.i + d));
    if (S.status === "failed") S.status = "idle";
    render.moved = true;
    render();
    window.scrollTo(0, 0);
  }

  function err(msg, fieldId) {
    var el = fieldId ? document.getElementById("e-" + fieldId) : document.getElementById("qerr");
    if (el) el.textContent = msg;
  }

  function next() {
    if (S.status === "sending") return;
    var st = S.steps[S.i];
    document.querySelectorAll(".q-err").forEach(function (e) { e.textContent = ""; });
    if (st.kind === "service" && !S.svc) return err("Choose a service to continue.");
    if (st.kind === "q") {
      var q = st.q, a = S.ans[q.id];
      if (q.type === "single" && a == null && q.required) return err("Choose an option to continue.");
      if (q.type === "multiple" && q.required && !a.length) return err("Choose at least one option to continue.");
      if (q.type === "size") {
        if (a === "" && q.required) return err("Enter a rough size in square metres. A best guess is fine.");
        if (a !== "" && !(num(a, 0) > 0)) return err("Enter the size as a number, for example 40.");
      }
      if (q.type === "date" && q.required && !a.date && !a.flexible) return err(q.allowFlexible ? "Pick a date, or tick “I'm flexible”." : "Pick a date to continue.");
      if (q.type === "text" && q.required && !a.trim()) return err("Please add a few words to continue.");
    }
    if (st.kind === "visit" && !S.visit.dates[0]) { err("Pick at least one date that suits you."); var d = document.getElementById("vd0"); if (d) d.focus(); return; }
    if (st.kind === "contact") {
      var c = S.contact, bad = [];
      if (!c.name.trim()) bad.push(["name", "Add your name."]);
      if ((c.phone.match(/\d/g) || []).length < 10) bad.push(["phone", "Add a phone number, like 07700 900123."]);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) bad.push(["email", "Add an email address, like name@example.com."]);
      if (!/^[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}$/i.test(c.postcode.trim())) bad.push(["postcode", "Add a full UK postcode, like CB4 1AB."]);
      if (bad.length) {
        bad.forEach(function (b) { err(b[1], b[0]); document.getElementById("c-" + b[0]).classList.add("bad"); });
        document.getElementById("c-" + bad[0][0]).focus();
        return;
      }
      return send();
    }
    go(1);
  }

  /* ---------- sending ---------- */
  function payload() {
    var b = S.biz, s = S.svc, c = S.contact, isPrice = s.mode === "price", p = isPrice ? price() : null;
    var o = {};
    o._subject = isPrice ? "New quote request: " + s.name + " – " + p.text : "New visit request: " + s.name;
    o._replyto = c.email.trim();
    o["Business"] = b.businessName;
    o["Service"] = s.name;
    o["Request type"] = isPrice ? "Instant price range" : "Site visit request";
    if (isPrice) o["Price range shown"] = p.text;
    o["Name"] = c.name.trim();
    o["Phone"] = c.phone.trim();
    o["email"] = c.email.trim();
    o["Postcode"] = c.postcode.trim().toUpperCase();
    s.questions.forEach(function (q) { o[q.label] = answerText(q); });
    if (!isPrice) {
      o["Preferred visit dates"] = S.visit.dates.filter(Boolean).map(niceDate).join("; ");
      o["Best time of day"] = S.visit.time;
    }
    o["Photos"] = "The customer has been asked to reply to your email with any photos.";
    o["Sent from"] = (params.get("from") || document.referrer || "Direct link to the quote form").slice(0, 300);
    o["Submitted"] = new Date().toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" });
    o["Business ID"] = b.id;
    return o;
  }

  function send() {
    S.status = "sending";
    render();
    var ctrl = "AbortController" in window ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, 20000);
    fetch(S.biz.formEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload()),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error("Form service replied " + res.status);
      S.status = "done";
      done();
      post("done");
    }).catch(function (e) {
      clearTimeout(timer);
      console.error("Jobaro: sending failed.", e);
      S.status = "failed";
      render();
      var f = root.querySelector(".q-fail"); if (f) f.scrollIntoView({ block: "nearest" });
    });
  }

  function done() {
    var first = S.contact.name.trim().split(/\s+/)[0];
    var s = S.svc, rows = [["Service", s.name]];
    if (s.mode === "price") rows.push(["Price range", price().text]);
    else rows.push(["Preferred dates", S.visit.dates.filter(Boolean).map(niceDate).join(", ")]);
    root.innerHTML = header() + '<div class="q-prog"><span style="width:100%"></span></div>' +
      '<div class="q-msg"><span class="q-okc">' + ICON_OK + '</span><h1 class="q-title" tabindex="-1">Thanks, ' + esc(first) + ".</h1><p>" + esc(S.biz.businessName) + " has your details and will be in touch. Reply to their email with any photos.</p>" +
      '<ul class="sum">' + rows.map(function (r) { return "<li><span>" + esc(r[0]) + "</span><span>" + esc(r[1]) + "</span></li>"; }).join("") + "</ul>" +
      (EMBED ? '<button type="button" class="q-btn2" id="qclose">Close</button>' : "") + "</div>" + powered();
    var cl = document.getElementById("qclose"); if (cl) cl.addEventListener("click", function () { post("close"); });
    root.querySelector(".q-title").focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function fatal(t, msg, retry) {
    root.innerHTML = '<div class="q-msg">' + bird(52) + "<h1>" + esc(t) + "</h1><p>" + esc(msg) + "</p>" +
      (retry ? '<button type="button" class="q-btn2" id="qretry">Try again</button>' : "") + "</div>" + powered();
    var r = document.getElementById("qretry"); if (r) r.addEventListener("click", function () { location.reload(); });
  }

  load();
})();
