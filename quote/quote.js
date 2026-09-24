/* =========================================================
   Jobaro quote form
   Reads /businesses/<id>.json (from ?b=<id>), asks the questions one
   step at a time, shows a price range (or a visit / quote request),
   collects contact details and sends everything to the business's
   formEndpoint. See HOW-TO-ADD-A-BUSINESS.md for the settings format.
   Optional URL settings:
     ?b=<id>        business settings file to load (required)
     &s=<service>   skip the "What do you need?" step
     &embed=1       set by widget.js when shown in the pop-up
   ========================================================= */
(function () {
  "use strict";

  /* ---------- PHOTO UPLOAD SETTINGS (Cloudinary) ----------
     Change these two values to use a different Cloudinary account.
     The upload preset must be set to "Unsigned" in Cloudinary. */
  var CLOUDINARY = {
    cloudName: "embzttb9",
    uploadPreset: "jobaro_quotes"
  };
  var PHOTO_MAX_MB = 10;        // reject files bigger than this
  var PHOTO_MAX_SIDE = 1600;    // resize so the longest side is at most this many pixels
  var PHOTO_QUALITY = 0.82;     // JPEG quality after resizing (0–1)

  var root = document.getElementById("q");
  var params = new URLSearchParams(location.search);
  var EMBED = params.get("embed") === "1";
  var JOBARO_URL = "https://jobaro.netlify.app/";
  if (EMBED) document.documentElement.classList.add("embed");

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function slug(s) { return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
  function num(v, d) { var n = Number(v); return v !== "" && v != null && isFinite(n) ? n : d; }
  function round5(n) { return Math.round(n / 5) * 5; }
  function money(n) { return "£" + Math.max(0, n).toLocaleString("en-GB"); }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function bird(s) { return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 64 64" aria-hidden="true"><use href="#jb-bird"/></svg>'; }
  var ICON_OK = '<svg width="26" height="26" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_TICK = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_LOCK = '<svg width="14" height="16" viewBox="0 0 10 12" aria-hidden="true"><rect x="1" y="5" width="8" height="6.5" rx="1.5" fill="#6D7079"/><path d="M3 5V3.5a2 2 0 014 0V5" stroke="#6D7079" stroke-width="1.3" fill="none"/></svg>';
  var ICON_CAM = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  function tomorrow() { var d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
  function niceDate(v) {
    if (!v) return "";
    var d = new Date(v + "T12:00:00");
    return isNaN(d) ? v : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  var POSTCODE = /^([A-Z]{1,2})[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}$/i;
  function post(msg) { if (EMBED && window.parent !== window) window.parent.postMessage({ jobaro: true, type: msg }, "*"); }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") post("close"); });

  /* ---------- state ---------- */
  var S = {
    biz: null, svc: null, fixed: false, steps: [], i: 0,
    ans: {}, visit: { dates: ["", "", ""], time: "Any time" },
    contact: { name: "", phone: "", email: "", postcode: "", date: "", flexible: false },
    status: "idle"
  };

  /* ---------- settings file ---------- */
  var TYPES = {
    "single": "single", "single choice": "single", "choice": "single", "radio": "single",
    "multiple": "multiple", "multiple choice": "multiple", "extras": "multiple", "checkbox": "multiple",
    "counter": "counter", "number": "counter",
    "counters": "counters", "counter group": "counters",
    "size": "size", "approximate size": "size", "area": "size",
    "date": "date",
    "text": "text", "free text": "text",
    "photos": "photos", "photo": "photos",
    "postcode": "postcode",
    "contact": "contact", "contact details": "contact"
  };
  var MODES = { price: 1, visit: 1, quote: 1 };
  var CONTACT_FIELDS = { name: 1, phone: 1, email: 1, postcode: 1, preferredDate: 1 };

  // Named prices: any value written as "@name" (or "@group.name") is looked up in the
  // "PRICES TO CONFIRM WITH OWNER" (or "prices") section of the settings file.
  function resolvePrices(c) {
    var table = c["PRICES TO CONFIRM WITH OWNER"] || c.prices || {};
    var missing = [];
    function look(ref) {
      var path = ref.slice(1).split("."), v = table;
      for (var i = 0; i < path.length; i++) v = v != null ? v[path[i]] : undefined;
      if (typeof v !== "number") missing.push(ref);
      return v;
    }
    function walk(x) {
      if (Array.isArray(x)) return x.map(walk);
      if (x && typeof x === "object") { var o = {}; for (var k in x) o[k] = walk(x[k]); return o; }
      if (typeof x === "string" && /^@[\w.+\-]+$/.test(x)) return look(x);
      return x;
    }
    c.services = walk(c.services);
    c.commonQuestions = walk(c.commonQuestions || []);
    return missing.length ? "These prices aren't in the prices section: " + missing.join(", ") + "." : null;
  }

  function check(c) {
    if (!c || typeof c !== "object") return "The settings file is empty.";
    if (!c.businessName) return "The settings file needs a businessName.";
    if (!c.formEndpoint || !/^https:\/\//.test(c.formEndpoint)) return "The settings file needs a formEndpoint starting with https://.";
    if (!Array.isArray(c.services) || !c.services.length) return "The settings file needs at least one service.";
    var bad = resolvePrices(c); if (bad) return bad;
    if (c.contactFields && !(Array.isArray(c.contactFields) && c.contactFields.every(function (f) { return CONTACT_FIELDS[f]; }))) return "contactFields can only contain: name, phone, email, postcode, preferredDate.";
    for (var i = 0; i < c.services.length; i++) {
      var s = c.services[i], where = "Service " + (i + 1) + (s && s.name ? " (" + s.name + ")" : "");
      if (!s || !s.name) return where + " needs a name.";
      var mode = String(s.mode || "price").toLowerCase();
      if (!MODES[mode]) return where + ": mode must be \"price\", \"visit\" or \"quote\".";
      if (mode === "price" && !(s.pricing && isFinite(Number(s.pricing.base)))) return where + " needs pricing with a base price (use 0 if the answers set the price).";
      var qs = (c.commonQuestions || []).concat(s.questions || []), ids = {};
      for (var j = 0; j < qs.length; j++) {
        var q = qs[j], t = TYPES[String(q && q.type || "").toLowerCase()], name = "question " + (j + 1) + (q && q.label ? " (\"" + q.label + "\")" : "");
        if (!t) return where + ", " + name + " has an unknown type \"" + (q && q.type) + "\".";
        if (!q.label && t !== "contact") return where + ", " + name + " needs a label.";
        if ((t === "single" || t === "multiple") && !(Array.isArray(q.options) && q.options.length)) return where + ", " + name + " needs options.";
        if (t === "counters" && !(Array.isArray(q.items) && q.items.length)) return where + ", " + name + " needs items.";
        if (q.showIf && !ids[q.showIf.question]) return where + ", " + name + ": showIf refers to \"" + q.showIf.question + "\", which isn't an earlier question id.";
        if (q.id) ids[q.id] = true;
      }
    }
    return null;
  }

  function normQuestion(q, n) {
    var t = TYPES[String(q.type).toLowerCase()];
    var out = {
      id: q.id || "q" + (n + 1), type: t, label: q.label || "", help: q.help || "", placeholder: q.placeholder || "",
      summaryLabel: q.summaryLabel || "",
      required: t === "multiple" || t === "text" || t === "photos" ? q.required === true : q.required !== false,
      unit: q.unit || "", min: num(q.min, t === "counter" ? 0 : 1), max: num(q.max, t === "counter" ? 10 : t === "photos" ? 5 : 500),
      maxLabel: q.maxLabel || "",
      pricePerUnit: num(q.pricePerUnit, 0), pricePerM2: num(q.pricePerM2, 0), priceByValue: q.priceByValue || null,
      allowFlexible: q.allowFlexible !== false, showIf: q.showIf || null,
      afterMultipliers: !!q.afterMultipliers, priceConfirmedByUs: !!q.priceConfirmedByUs,
      areas: (q.areas || []).map(function (a) { return String(a).toUpperCase(); }), outsideMessage: q.outsideMessage || ""
    };
    out.includedUnits = num(q.includedUnits, out.min);
    out.includedM2 = num(q.includedM2, 0);
    out.def = q.default;
    out.options = (q.options || []).map(function (o) {
      if (typeof o !== "object") o = { label: String(o) };
      return { label: String(o.label), hint: o.hint || "", price: num(o.price, 0), multiply: num(o.multiply, 1), multiplyOnly: o.multiplyOnly || null, noPrice: !!o.noPrice };
    });
    out.items = (q.items || []).map(function (it, k) {
      if (typeof it !== "object") it = { label: String(it) };
      return { id: it.id || "i" + k, label: String(it.label), price: num(it.price, 0), max: num(it.max, 10) };
    });
    return out;
  }

  function normalise(c) {
    var note = c.privacyNote || ("Your details are only shared with " + c.businessName + " so they can reply to your request.");
    if (!/Photos are only shared/i.test(note)) note += " Photos are only shared with " + c.businessName + " to prepare your quote.";
    var b = {
      id: c.id, businessName: String(c.businessName), email: c.email || "",
      initials: c.initials || String(c.businessName).split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase(),
      brandColour: /^#[0-9a-f]{3,8}$/i.test(c.brandColour || "") ? c.brandColour : "#16181D",
      formEndpoint: c.formEndpoint, demo: !!c.demo, banner: c.banner || "",
      privacyNote: note, priceLabel: c.priceLabel || "Your price range", priceNote: c.priceNote || "", confirmation: c.confirmation || "",
      contactFields: c.contactFields || ["name", "phone", "email", "postcode"]
    };
    var common = (c.commonQuestions || []).map(normQuestion);
    b.services = c.services.map(function (s) {
      var qs = common.concat((s.questions || []).map(function (q, n) { return normQuestion(q, n + common.length); }))
        .filter(function (q) { return q.type !== "contact"; });   // contact details are always the last step
      return {
        id: slug(s.id || s.name), name: String(s.name), mode: String(s.mode || "price").toLowerCase(), questions: qs,
        included: s.included || "",
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
        cfg.id = cfg.id || id;
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
    if (S.svc) S.svc.questions.forEach(function (q) { if (q.type === "photos") (S.ans[q.id] || []).forEach(dropPhoto); });
    var keep = {};   // answers to shared questions (e.g. postcode) survive a change of service
    if (S.svc) S.svc.questions.forEach(function (q) { if (q.type === "postcode") keep[q.id] = S.ans[q.id]; });
    S.svc = svc;
    S.ans = {};
    svc.questions.forEach(function (q) {
      if (q.type === "counter") S.ans[q.id] = Math.min(q.max, Math.max(q.min, num(q.def, q.min)));
      else if (q.type === "size") S.ans[q.id] = q.def != null ? String(q.def) : "";
      else if (q.type === "multiple" || q.type === "photos") S.ans[q.id] = [];
      else if (q.type === "date") S.ans[q.id] = { date: "", flexible: false };
      else if (q.type === "text") S.ans[q.id] = "";
      else if (q.type === "postcode") S.ans[q.id] = keep[q.id] || "";
      else if (q.type === "counters") { var o = {}; q.items.forEach(function (it) { o[it.id] = 0; }); S.ans[q.id] = o; }
    });
  }

  /* ---------- conditional questions ---------- */
  function qById(id) { return S.svc.questions.filter(function (q) { return q.id === id; })[0]; }
  function answerValue(q) {
    var a = S.ans[q.id];
    if (q.type === "single") return a == null ? null : q.options[a].label;
    if (q.type === "multiple") return (a || []).map(function (i) { return q.options[i].label; });
    return a;
  }
  function visible(q) {
    var c = q.showIf;
    if (!c) return true;
    var src = qById(c.question);
    if (!src || !visible(src)) return false;
    var v = answerValue(src);
    if (c.equals != null) return [].concat(c.equals).indexOf(v) > -1;
    if (c.notEquals != null) return v != null && [].concat(c.notEquals).indexOf(v) === -1;
    if (c.includes != null) return Array.isArray(v) && v.indexOf(c.includes) > -1;
    if (c.atLeast != null) return num(v, 0) >= c.atLeast;
    return !!v && (!Array.isArray(v) || v.length > 0);
  }
  function visibleQs() { return S.svc.questions.filter(visible); }

  // price / visit / quote. A chosen option with "noPrice": true turns a price service into a quote request.
  function mode() {
    if (S.svc.mode !== "price") return S.svc.mode;
    var noPrice = visibleQs().some(function (q) { return q.type === "single" && S.ans[q.id] != null && q.options[S.ans[q.id]].noPrice; });
    return noPrice ? "quote" : "price";
  }
  function hasPostcodeQ() { return visibleQs().some(function (q) { return q.type === "postcode"; }); }
  function contactFields() { return S.biz.contactFields.filter(function (f) { return !(f === "postcode" && hasPostcodeQ()); }); }

  function build() {
    var st = [];
    if (!S.fixed) st.push({ kind: "service", key: "service" });
    if (S.svc) {
      visibleQs().forEach(function (q) { st.push({ kind: "q", q: q, key: "q:" + q.id }); });
      var m = mode();
      if (m === "price") st.push({ kind: "price", key: "price" });
      if (m === "visit") st.push({ kind: "visit", key: "visit" });
      st.push({ kind: "contact", key: "contact" });
    }
    S.steps = st;
  }

  /* ---------- pricing ----------
     1. Start with the base price.
     2. Each answer adds a fixed amount (option price, counter price, per m² …).
     3. Multipliers (e.g. condition ×1.1) apply to the whole job, except questions marked
        "afterMultipliers". A multiplier with "multiplyOnly": ["rugs"] applies to those questions only.
     4. Apply the minimum charge, then show ±rangePercent rounded to the nearest £5. */
  function price() {
    var s = S.svc, parts = [{ id: "_base", v: s.pricing.base, after: false }], mults = [];
    visibleQs().forEach(function (q) {
      if (q.priceConfirmedByUs) return;
      var a = S.ans[q.id], v = 0;
      function opt(o) { v += o.price; if (o.multiply !== 1) mults.push({ f: o.multiply, only: o.multiplyOnly }); }
      if (q.type === "single" && a != null) opt(q.options[a]);
      if (q.type === "multiple") (a || []).forEach(function (i) { opt(q.options[i]); });
      if (q.type === "counter") v += q.priceByValue ? num(q.priceByValue[String(a)], 0) : (a - q.includedUnits) * q.pricePerUnit;
      if (q.type === "size" && a !== "") v += Math.max(0, num(a, 0) - q.includedM2) * q.pricePerM2;
      if (q.type === "counters") q.items.forEach(function (it) { v += (a[it.id] || 0) * it.price; });
      parts.push({ id: q.id, v: v, after: q.afterMultipliers });
    });
    var total = parts.reduce(function (sum, p) {
      var f = mults.reduce(function (m, x) { return (x.only ? x.only.indexOf(p.id) > -1 : !p.after) ? m * x.f : m; }, 1);
      return sum + p.v * f;
    }, 0);
    total = Math.max(total, s.pricing.minimum, 0);
    var r = s.pricing.rangePercent / 100;
    var low = round5(total * (1 - r)), high = round5(total * (1 + r));
    if (s.pricing.minimum > 0) low = Math.max(low, Math.ceil(s.pricing.minimum / 5) * 5);   // never show less than the minimum charge
    if (high <= low) high = low + 5;
    return { low: low, high: high, text: money(low) + "–" + money(high) };
  }

  function answerText(q) {
    var a = S.ans[q.id], t = "";
    if (q.type === "single") t = a == null ? "" : q.options[a].label;
    if (q.type === "multiple") t = (a || []).length ? a.map(function (i) { return q.options[i].label; }).join(", ") : "None";
    if (q.type === "counter") t = (a >= q.max && q.maxLabel ? q.maxLabel : String(a)) + (q.summaryLabel && q.unit ? " " + q.unit : "");
    if (q.type === "counters") { var list = q.items.filter(function (it) { return a[it.id] > 0; }).map(function (it) { return it.label + " × " + a[it.id]; }); t = list.length ? list.join(", ") : "None"; }
    if (q.type === "size") t = a === "" ? "Not given" : a + " m²";
    if (q.type === "date") t = a.flexible ? "Flexible" : niceDate(a.date);
    if (q.type === "text") t = a ? a : "Nothing added";
    if (q.type === "postcode") t = String(a || "").trim().toUpperCase();
    if (q.type === "photos") { var n = uploaded(a).length; t = n ? plural(n, "photo", "photos") : "None"; }
    if (q.priceConfirmedByUs && t && t !== "None") t += " (price confirmed by " + S.biz.businessName + ")";
    return t;
  }
  function outsideArea(q) {
    var m = POSTCODE.exec(String(S.ans[q.id] || "").trim());
    return !!(m && q.areas.length && q.areas.indexOf(m[1].toUpperCase()) === -1);
  }

  /* ---------- photos ---------- */
  var photoSeq = 0;
  function uploaded(list) { return (list || []).filter(function (p) { return p.status === "done"; }); }
  function pending(list) { return (list || []).filter(function (p) { return p.status === "processing" || p.status === "uploading"; }); }
  function allPhotos() { var out = []; if (S.svc) visibleQs().forEach(function (q) { if (q.type === "photos") out = out.concat(S.ans[q.id]); }); return out; }

  function addPhotos(q, files) {
    var list = S.ans[q.id], msgs = [];
    Array.prototype.forEach.call(files, function (f) {
      var isImg = /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name);
      if (!isImg) return msgs.push("“" + f.name + "” isn't a photo. Please choose a JPG or PNG image.");
      if (f.size > PHOTO_MAX_MB * 1024 * 1024) return msgs.push("“" + f.name + "” is over " + PHOTO_MAX_MB + "MB. Please choose a smaller photo.");
      if (list.length >= q.max) { if (msgs.indexOf("max") === -1) msgs.push("max"); return; }
      var p = { id: ++photoSeq, name: f.name, status: "processing", pct: 0 };
      list.push(p);
      prepare(f).then(function (blob) {
        if (p.removed) return;
        p.blob = blob; p.thumb = URL.createObjectURL(blob);
        upload(p);
      }).catch(function () {
        p.removed = true;
        list.splice(list.indexOf(p), 1);
        photoMsg(q, "We couldn't open “" + f.name + "”. If it's an iPhone (HEIC) photo, please choose a JPG or PNG instead.", true);
        drawPhotos(q); settle();
      });
    });
    photoMsg(q, msgs.map(function (m) { return m === "max" ? "You can add up to " + q.max + " photos." : m; }).join(" "));
    drawPhotos(q);
  }

  // resize in the browser so uploads are quick on mobile data
  function prepare(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, PHOTO_MAX_SIDE / Math.max(w, h));
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);   // transparent PNGs get a white background
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error("toBlob failed")); }, "image/jpeg", PHOTO_QUALITY);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
      img.src = url;
    });
  }

  function upload(p) {
    p.status = "uploading"; p.pct = 0; p.error = "";
    drawPhotos();
    var fd = new FormData();
    fd.append("file", p.blob, "photo-" + p.id + ".jpg");
    fd.append("upload_preset", CLOUDINARY.uploadPreset);
    fd.append("folder", "jobaro/" + S.biz.id);
    var x = new XMLHttpRequest();
    p.xhr = x;
    x.open("POST", "https://api.cloudinary.com/v1_1/" + encodeURIComponent(CLOUDINARY.cloudName) + "/image/upload");
    x.timeout = 90000;
    x.upload.onprogress = function (e) { if (e.lengthComputable) { p.pct = Math.round(e.loaded / e.total * 100); drawProgress(p); } };
    x.onload = function () {
      var r = null; try { r = JSON.parse(x.responseText); } catch (e) {}
      if (x.status >= 200 && x.status < 300 && r && r.secure_url) { p.status = "done"; p.url = r.secure_url; p.pct = 100; }
      else { p.status = "failed"; console.error("Jobaro: photo upload failed", x.status, x.responseText); }
      drawPhotos(); settle();
    };
    x.onerror = x.ontimeout = function () { p.status = "failed"; drawPhotos(); settle(); };
    x.send(fd);
  }
  function dropPhoto(p) {
    p.removed = true;
    if (p.xhr && p.status === "uploading") try { p.xhr.abort(); } catch (e) {}
    if (p.thumb) URL.revokeObjectURL(p.thumb);
  }

  // messages about rejected files add up (some arrive later, after a photo fails to open)
  function photoMsg(q, m, append) {
    q.msg = append && q.msg ? (m ? q.msg + " " + m : q.msg) : (m || "");
    var el = document.getElementById("pherr"); if (el) el.textContent = q.msg;
  }
  function drawProgress(p) {
    var bar = root.querySelector('[data-ph="' + p.id + '"] .ph-bar span');
    if (bar) bar.style.width = Math.max(4, p.pct) + "%";
  }
  function drawPhotos() {
    var grid = document.getElementById("phgrid"), st = S.steps[S.i];
    if (!grid || !st || !st.q || st.q.type !== "photos") return;
    var q = st.q, list = S.ans[q.id];
    grid.innerHTML = list.map(function (p) {
      var inner = p.thumb ? '<img src="' + p.thumb + '" alt="">' : '<span class="ph-wait">Preparing…</span>';
      var state = "";
      if (p.status === "uploading" || p.status === "processing") state = '<span class="ph-bar" aria-hidden="true"><span style="width:' + Math.max(4, p.pct) + '%"></span></span><span class="sr">Uploading</span>';
      if (p.status === "done") state = '<span class="ph-ok" title="Uploaded">' + ICON_TICK + '<span class="sr">Uploaded</span></span>';
      if (p.status === "failed") state = '<span class="ph-fail">Upload failed<button type="button" data-retry="' + p.id + '">Retry</button></span>';
      return '<div class="ph' + (p.status === "failed" ? " bad" : "") + '" data-ph="' + p.id + '">' + inner + state + '<button type="button" class="ph-x" data-rm="' + p.id + '" aria-label="Remove photo ' + esc(p.name) + '">×</button></div>';
    }).join("") + (list.length < q.max ? '<label class="ph-add">' + ICON_CAM + '<span>' + (list.length ? "Add more" : "Add photos") + '</span><input type="file" accept="image/*,.heic,.heif" multiple data-photos class="sr"></label>' : "");
    var input = grid.querySelector("[data-photos]");
    if (input) input.addEventListener("change", function () { addPhotos(q, input.files); input.value = ""; });
    grid.querySelectorAll("[data-rm]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = list.filter(function (x) { return x.id === +b.dataset.rm; })[0];
        if (!p) return;
        dropPhoto(p); list.splice(list.indexOf(p), 1); photoMsg(q, ""); drawPhotos(); settle();
        var add = grid.querySelector(".ph-add input"); if (add) add.focus();
      });
    });
    grid.querySelectorAll("[data-retry]").forEach(function (b) {
      b.addEventListener("click", function () { var p = list.filter(function (x) { return x.id === +b.dataset.retry; })[0]; if (p) upload(p); });
    });
    var status = document.getElementById("phstatus");
    if (status) {
      var up = pending(list).length, ok = uploaded(list).length, bad = list.filter(function (p) { return p.status === "failed"; }).length;
      status.textContent = up ? "Uploading " + plural(up, "photo", "photos") + "… you can carry on while they finish." :
        bad ? plural(bad, "photo", "photos") + " didn't upload. Tap Retry, or carry on without " + (bad === 1 ? "it" : "them") + "." :
        ok ? plural(ok, "photo", "photos") + " added." : "";
    }
  }
  var waiters = [];
  function settle() { if (!pending(allPhotos()).length) { var w = waiters; waiters = []; w.forEach(function (f) { f(); }); } }
  function whenPhotosSettle(ms) {
    return new Promise(function (resolve) {
      if (!pending(allPhotos()).length) return resolve();
      waiters.push(resolve);
      setTimeout(resolve, ms);
    });
  }

  /* ---------- rendering ---------- */
  function banner() { return S.biz && S.biz.banner ? '<div class="q-banner" role="note">' + esc(S.biz.banner) + "</div>" : ""; }
  function header() {
    var m = S.svc ? mode() : "price";
    var sub = m === "visit" ? "Site visit request" : m === "quote" ? "Quote request" : "Instant quote";
    return banner() + '<div class="q-top"><span class="q-av" aria-hidden="true">' + esc(S.biz.initials) + '</span><div class="q-biz"><b>' + esc(S.biz.businessName) + "</b><small>" + sub + "</small></div>" + (S.biz.demo ? '<span class="q-demo" title="This is a demo business">Demo</span>' : "") + "</div>";
  }
  function powered() {
    return '<a class="q-pow" href="' + JOBARO_URL + '" target="_blank" rel="noopener">Powered by ' + bird(13) + " <b>jobaro</b></a>";
  }
  function stepLabel(st) {
    if (st.kind === "price") return "Your price";
    if (st.kind === "visit") return "Book a visit";
    if (st.kind === "contact") return "Your details";
    var n = S.steps.filter(function (x) { return x.kind === "q" || x.kind === "service"; }).length;
    return S.svc ? "Step " + (S.i + 1) + " of " + n : "Step 1";
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
    if (st.q && st.q.type === "photos") drawPhotos();
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
          return '<button type="button" class="opt" role="radio" aria-checked="' + (S.svc === s) + '" data-svc="' + i + '"><span class="rd"></span><span>' + esc(s.name) + "</span><small>" + (s.mode === "visit" ? "Site visit" : s.mode === "quote" ? "Quote" : "Instant price") + "</small></button>";
        }).join("") + "</div>";
    }
    if (st.kind === "q") return question(st.q);
    if (st.kind === "price") {
      var p = price();
      var note = S.biz.priceNote || ("Based on your answers and " + b + "'s prices. " + b + " will confirm the final price.");
      return title("Here's your price") +
        '<div class="est"><div class="est-lbl">' + esc(S.biz.priceLabel) + '</div><div class="est-price">' + p.text + '</div><div class="est-note">' + esc(note) + "</div></div>" +
        (S.svc.included ? '<p class="q-included">' + ICON_TICK + "<span>" + esc(S.svc.included) + "</span></p>" : "") +
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
      var c = S.contact, m = mode();
      var help = m === "quote" ? b + " will look at your answers and send you a quote." : "So " + b + " can send your quote and book the job.";
      var f = contactFields().map(function (k) {
        if (k === "name") return field("name", "Full name", "text", c.name, "name");
        if (k === "phone") return field("phone", "Phone number", "tel", c.phone, "tel");
        if (k === "email") return field("email", "Email", "email", c.email, "email");
        if (k === "postcode") return field("postcode", "Postcode", "text", c.postcode, "postal-code");
        if (k === "preferredDate") return '<div class="f"><label for="c-date">Preferred date</label><input class="inp" id="c-date" data-cdate type="date" min="' + tomorrow() + '" value="' + esc(c.date) + '"><label class="chk" style="margin-top:6px"><input type="checkbox" data-cflex' + (c.flexible ? " checked" : "") + "> I'm flexible on the date</label><p class=\"q-err\" id=\"e-date\"></p></div>";
        return "";
      }).join("");
      return title("Your details", help) + '<div class="fields">' + f + "</div>" + '<p class="q-privacy">' + ICON_LOCK + "<span>" + esc(S.biz.privacyNote) + "</span></p>";
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
        return '<button type="button" class="chip" aria-pressed="' + (a.indexOf(i) > -1) + '" data-multi="' + i + '">' + esc(o.label) + (o.hint ? " <small>" + esc(o.hint) + "</small>" : "") + "</button>";
      }).join("") + "</div>" + (q.required ? "" : '<p class="q-opt-note">Nothing to add? Just press Continue.</p>');
    }
    if (q.type === "counter") {
      var shown = a >= q.max && q.maxLabel ? q.maxLabel : a;
      return title(q.label, q.help) + '<div class="ctr"><button type="button" class="ctr-b" data-step="-1" aria-label="Fewer"' + (a <= q.min ? " disabled" : "") + '>−</button><div><output class="ctr-v" id="ctrv" aria-live="polite">' + esc(shown) + "</output>" + (q.unit ? '<span class="ctr-u">' + esc(q.unit) + "</span>" : "") + '</div><button type="button" class="ctr-b p" data-step="1" aria-label="More"' + (a >= q.max ? " disabled" : "") + ">+</button></div>" +
        (q.priceConfirmedByUs ? '<p class="q-opt-note">Price confirmed by ' + esc(S.biz.businessName) + ".</p>" : "");
    }
    if (q.type === "counters") {
      return title(q.label, q.help) + '<div class="ctrs">' + q.items.map(function (it) {
        var n = a[it.id] || 0;
        return '<div class="ctr-row"><span>' + esc(it.label) + '</span><div class="ctr-mini"><button type="button" class="ctr-b" data-cstep="' + it.id + '|-1" aria-label="Fewer ' + esc(it.label) + '"' + (n <= 0 ? " disabled" : "") + '>−</button><output aria-live="polite">' + n + '</output><button type="button" class="ctr-b p" data-cstep="' + it.id + '|1" aria-label="More ' + esc(it.label) + '"' + (n >= it.max ? " disabled" : "") + ">+</button></div></div>";
      }).join("") + "</div>";
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
    if (q.type === "postcode") {
      return title(q.label, q.help) + '<label class="sr" for="pc">Postcode</label><input class="inp pc" id="pc" data-pc autocomplete="postal-code" autocapitalize="characters" placeholder="' + esc(q.placeholder || "e.g. CB1 2AB") + '" value="' + esc(a) + '">' +
        '<p class="q-note" id="pcnote" role="status">' + (outsideArea(q) ? esc(q.outsideMessage) : "") + "</p>";
    }
    if (q.type === "photos") {
      return title(q.label, q.help || "Photos help " + S.biz.businessName + " prepare an accurate quote.") +
        '<div class="ph-grid" id="phgrid"></div>' +
        '<p class="q-opt-note">Optional. Up to ' + q.max + " photos, " + PHOTO_MAX_MB + "MB each. No photos? Just press Continue.</p>" +
        '<p class="q-note" id="phstatus" role="status"></p><p class="q-err" id="pherr" role="alert">' + esc(q.msg || "") + "</p>";
    }
    return "";
  }

  function summary() {
    var rows = [["Service", S.svc.name]].concat(visibleQs().filter(function (q) { return q.type !== "text"; }).map(function (q) { return [shortLabel(q), answerText(q)]; }));
    return '<ul class="sum">' + rows.map(function (r) { return "<li><span>" + esc(r[0]) + "</span><span>" + esc(r[1]) + "</span></li>"; }).join("") + "</ul>";
  }
  function shortLabel(q) {
    if (q.summaryLabel) return q.summaryLabel;
    var map = { counter: q.unit ? cap(q.unit) : "", date: "Preferred date", size: "Size", photos: "Photos", postcode: "Postcode" };
    if (map[q.type]) return map[q.type];
    if (!/^q\d+$/.test(q.id)) return cap(q.id.replace(/[-_]+/g, " "));
    return q.label.replace(/\?$/, "");
  }

  function foot(st) {
    var first = S.i === 0, m = S.svc ? mode() : "price";
    var label = "Continue";
    if (st.kind === "contact") label = m === "visit" ? "Request a visit" : m === "quote" ? "Request my quote" : "Send my details";
    if (S.status === "failed" && st.kind === "contact") label = "Try again";
    var busy = S.status === "sending" || S.status === "photos";
    var busyText = S.status === "photos" ? "Finishing photo uploads…" : "Sending…";
    return '<div class="q-foot">' + (first ? "<span></span>" : '<button type="button" class="q-back" id="qback"' + (busy ? " disabled" : "") + ">Back</button>") +
      '<button type="submit" form="qf" class="q-next" id="qnext"' + (busy ? " disabled" : "") + ">" + (busy ? '<span class="spin" aria-hidden="true"></span>' + busyText : label + " <span aria-hidden=\"true\">→</span>") + "</button></div>";
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
    root.querySelectorAll("[data-cstep]").forEach(function (el) {
      el.addEventListener("click", function () {
        var parts = el.dataset.cstep.split("|"), it = q.items.filter(function (x) { return x.id === parts[0]; })[0];
        S.ans[q.id][it.id] = Math.min(it.max, Math.max(0, (S.ans[q.id][it.id] || 0) + +parts[1]));
        rerender("[data-cstep='" + el.dataset.cstep + "']");
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
    var pc = root.querySelector("[data-pc]");
    if (pc) pc.addEventListener("input", function () {
      S.ans[q.id] = pc.value; pc.classList.remove("bad");
      document.getElementById("pcnote").textContent = outsideArea(q) ? q.outsideMessage : "";
      document.getElementById("qerr").textContent = "";
    });
    root.querySelectorAll("[data-vd]").forEach(function (el) { el.addEventListener("input", function () { S.visit.dates[+el.dataset.vd] = el.value; }); });
    root.querySelectorAll("[data-tod]").forEach(function (el) { el.addEventListener("click", function () { S.visit.time = el.dataset.tod; rerender(); }); });
    root.querySelectorAll("[data-c]").forEach(function (el) { el.addEventListener("input", function () { S.contact[el.dataset.c] = el.value; el.classList.remove("bad"); var m = document.getElementById("e-" + el.dataset.c); if (m) m.textContent = ""; }); });
    var cd = root.querySelector("[data-cdate]"), cf = root.querySelector("[data-cflex]");
    if (cd) cd.addEventListener("input", function () { S.contact.date = cd.value; if (cd.value) { cf.checked = false; S.contact.flexible = false; } cd.classList.remove("bad"); document.getElementById("e-date").textContent = ""; });
    if (cf) cf.addEventListener("change", function () { S.contact.flexible = cf.checked; document.getElementById("e-date").textContent = ""; });
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

  // answers can show or hide later questions, so rebuild the step list before moving
  function go(d) {
    var key = S.steps[S.i] && S.steps[S.i].key;
    build();
    var at = S.steps.map(function (s) { return s.key; }).indexOf(key);
    if (at < 0) at = Math.min(S.i, S.steps.length - 1);
    S.i = Math.max(0, Math.min(S.steps.length - 1, at + d));
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
    if (S.status === "sending" || S.status === "photos") return;
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
      if (q.type === "postcode" && !POSTCODE.test(String(a).trim())) {
        document.getElementById("pc").classList.add("bad"); document.getElementById("pc").focus();
        return err("Add a full UK postcode, like CB4 1AB.");
      }
      if (q.type === "photos" && q.required && !uploaded(a).length && !pending(a).length) return err("Please add at least one photo.");
    }
    if (st.kind === "visit" && !S.visit.dates[0]) { err("Pick at least one date that suits you."); var d = document.getElementById("vd0"); if (d) d.focus(); return; }
    if (st.kind === "contact") {
      var c = S.contact, bad = [], fields = contactFields();
      if (fields.indexOf("name") > -1 && !c.name.trim()) bad.push(["name", "Add your name."]);
      if (fields.indexOf("phone") > -1 && (c.phone.match(/\d/g) || []).length < 10) bad.push(["phone", "Add a phone number, like 07700 900123."]);
      if (fields.indexOf("email") > -1 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) bad.push(["email", "Add an email address, like name@example.com."]);
      if (fields.indexOf("postcode") > -1 && !POSTCODE.test(c.postcode.trim())) bad.push(["postcode", "Add a full UK postcode, like CB4 1AB."]);
      if (fields.indexOf("preferredDate") > -1 && !c.date && !c.flexible) bad.push(["date", "Pick a date, or tick “I'm flexible”."]);
      if (bad.length) {
        bad.forEach(function (b) { err(b[1], b[0]); document.getElementById("c-" + b[0]).classList.add("bad"); });
        document.getElementById("c-" + bad[0][0]).focus();
        return;
      }
      return send(false);
    }
    go(1);
  }

  /* ---------- sending ---------- */
  function payload() {
    var b = S.biz, s = S.svc, c = S.contact, m = mode(), p = m === "price" ? price() : null, qs = visibleQs();
    var o = {};
    o._subject = m === "price" ? "New quote request: " + s.name + " – " + p.text : m === "visit" ? "New visit request: " + s.name : "New quote request: " + s.name;
    o._replyto = c.email.trim();
    o["Business"] = b.businessName;
    o["Service"] = s.name;
    o["Request type"] = m === "price" ? "Instant price range" : m === "visit" ? "Site visit request" : "Quote request (no instant price shown)";
    if (p) o["Price range shown"] = p.text;
    o["Name"] = c.name.trim();
    o["Phone"] = c.phone.trim();
    o["email"] = c.email.trim();
    var pcq = qs.filter(function (q) { return q.type === "postcode"; })[0];
    o["Postcode"] = pcq ? answerText(pcq) : c.postcode.trim().toUpperCase();
    if (pcq && outsideArea(pcq)) o["Postcode note"] = "Outside the usual area (" + pcq.areas.join(", ") + " postcodes)";
    if (contactFields().indexOf("preferredDate") > -1) o["Preferred date"] = c.flexible ? "Flexible" : niceDate(c.date);
    qs.forEach(function (q) { if (q.type !== "photos" && q.type !== "postcode") o[q.label] = answerText(q); });
    if (m === "visit") {
      o["Preferred visit dates"] = S.visit.dates.filter(Boolean).map(niceDate).join("; ");
      o["Best time of day"] = S.visit.time;
    }
    var photoQs = qs.filter(function (q) { return q.type === "photos"; });
    if (photoQs.length) {
      var all = [], failed = 0;
      photoQs.forEach(function (q) { all = all.concat(uploaded(S.ans[q.id])); failed += S.ans[q.id].length - uploaded(S.ans[q.id]).length; });
      o["Photos"] = all.length ? plural(all.length, "photo", "photos") + " attached" : "No photos";
      if (failed) o["Photos"] += " (" + plural(failed, "photo", "photos") + " couldn't be uploaded)";
      all.forEach(function (ph, i) { o["Photo " + (i + 1)] = ph.url; });
    } else {
      o["Photos"] = "The customer has been asked to reply to your email with any photos.";
    }
    o["Sent from"] = (params.get("from") || document.referrer || "Direct link to the quote form").slice(0, 300);
    o["Submitted"] = new Date().toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" });
    o["Business ID"] = b.id;
    return o;
  }

  function send(force) {
    // photos still uploading? give them a little longer, but never let them block the enquiry
    if (!force && pending(allPhotos()).length) {
      S.status = "photos"; render();
      return whenPhotosSettle(25000).then(function () { if (S.status === "photos") send(true); });
    }
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
    var s = S.svc, m = mode(), rows = [["Service", s.name]];
    if (m === "price") rows.push(["Price range", price().text]);
    if (m === "visit") rows.push(["Preferred dates", S.visit.dates.filter(Boolean).map(niceDate).join(", ")]);
    var nPhotos = uploaded(allPhotos()).length;
    if (nPhotos) rows.push(["Photos", plural(nPhotos, "photo", "photos") + " sent"]);
    var head, text;
    if (S.biz.confirmation) {
      var msg = S.biz.confirmation.replace(/\{name\}/g, first), cut = msg.indexOf(". ");
      head = cut > -1 ? msg.slice(0, cut + 1) : msg; text = cut > -1 ? msg.slice(cut + 2) : "";
    } else {
      head = "Thanks, " + first + ".";
      text = S.biz.businessName + " has your details and will be in touch. Reply to their email with any " + (nPhotos ? "more " : "") + "photos.";
    }
    root.innerHTML = header() + '<div class="q-prog"><span style="width:100%"></span></div>' +
      '<div class="q-msg"><span class="q-okc">' + ICON_OK + '</span><h1 class="q-title" tabindex="-1">' + esc(head) + "</h1>" + (text ? "<p>" + esc(text) + "</p>" : "") +
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
