/* =========================================================
   Jobaro widget
   Add to any website:
     <script src="https://jobaro.netlify.app/widget.js" data-business="demo-cleaning"></script>

   Optional settings on the script tag:
     data-label="Get a quote"   text on the floating button
     data-button="false"        hide the floating button (use your own buttons)
     data-colour="#0F5257"      button colour (defaults to the business's brandColour)

   Any element with data-jobaro-open opens the quote form, e.g.
     <a href="#" data-jobaro-open>Get a quote</a>
     <button data-jobaro-open="end-of-tenancy-clean">Price an end of tenancy clean</button>
   (the value is optional and skips straight to that service)

   Everything the widget draws lives inside a shadow root, so it can't
   restyle the host website and the host website can't restyle it.
   ========================================================= */
(function () {
  "use strict";
  if (window.__jobaroWidget) return;
  window.__jobaroWidget = true;

  try {
    var script = document.currentScript || (function () {
      var all = document.querySelectorAll('script[src*="widget.js"][data-business]');
      return all[all.length - 1];
    })();
    if (!script) return;

    var business = (script.getAttribute("data-business") || "").trim().toLowerCase();
    if (!/^[a-z0-9-]{1,80}$/.test(business)) { console.warn("Jobaro: add data-business=\"your-id\" to the widget script tag."); return; }
    var base = new URL(".", script.src).href;
    var origin = new URL(base).origin;
    var label = script.getAttribute("data-label") || "Get a quote";
    var showButton = script.getAttribute("data-button") !== "false";
    var colour = script.getAttribute("data-colour") || "";
    var bizName = "";

    var canShadow = !!document.createElement("div").attachShadow;
    var state = { built: false, open: false, done: false, service: null, opener: null, overflow: "" };
    var host, root, btn, ov, frame, closeBtn;

    var BIRD = '<svg width="20" height="20" viewBox="0 0 64 64" aria-hidden="true"><path d="M11 45 L3 52 L15 50 Z" fill="#16181D"/><path d="M33 9 C48 9 56 21 56 35 C56 49 46 58 32 58 C18 58 9 49 9 36 C9 21 18 9 33 9Z" fill="#F2651C"/><ellipse cx="37" cy="45" rx="13" ry="9.5" fill="#FFD9C0"/><path d="M15 33 C17 45 25 49 34 47 C26 44 22 38 21 30 Z" fill="#C9480A"/><path d="M27 11 C27 5 31 2 36 3 C33 5 32 7 32.5 9.5 Z" fill="#16181D"/><circle cx="39" cy="26" r="7.5" fill="#fff"/><circle cx="41" cy="26.5" r="3.8" fill="#16181D"/><path d="M30.5 23.6 Q39 19.2 46.5 22.8 L46.5 16 L30.5 16 Z" fill="#F2651C"/><path d="M31 23.6 Q39 19.6 46.5 22.8" stroke="#16181D" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M54.5 27 L62 31 L54.5 35 Z" fill="#16181D"/></svg>';

    var CSS = [
      ":host{all:initial}",
      "*{box-sizing:border-box}",
      ".btn{position:fixed;right:max(20px,env(safe-area-inset-right));bottom:max(20px,env(safe-area-inset-bottom));z-index:2147483000;display:inline-flex;align-items:center;gap:10px;margin:0;padding:10px 20px 10px 10px;border:0;border-radius:999px;background:var(--c,#F2651C);color:var(--t,#fff);font:600 15px/1.2 'Instrument Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;letter-spacing:0;text-transform:none;box-shadow:0 12px 30px -10px rgba(0,0,0,.45),0 2px 6px rgba(0,0,0,.12);cursor:pointer;opacity:0;transform:translateY(10px);transition:opacity .3s,transform .3s,box-shadow .2s}",
      ".btn.ready{opacity:1;transform:none}",
      ".btn.ready.hide{opacity:0;pointer-events:none}",
      ".btn:hover{transform:translateY(-2px);box-shadow:0 16px 34px -10px rgba(0,0,0,.5),0 2px 6px rgba(0,0,0,.12)}",
      ".btn:focus-visible,.x:focus-visible{outline:3px solid #F2651C;outline-offset:3px}",
      ".chip{width:32px;height:32px;border-radius:50%;background:#fff;display:grid;place-items:center;flex:none}",
      ".ov{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(22,24,29,.55);opacity:0;transition:opacity .2s}",
      ".ov.open{display:flex}",
      ".ov.show{opacity:1}",
      ".panel{position:relative;width:460px;max-width:100%;height:min(760px,calc(100vh - 48px));background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 40px 80px -30px rgba(0,0,0,.5);transform:translateY(14px) scale(.98);transition:transform .25s cubic-bezier(.2,.8,.2,1)}",
      ".ov.show .panel{transform:none}",
      "iframe{display:block;width:100%;height:100%;border:0;background:#fff}",
      ".x{position:absolute;top:12px;right:12px;z-index:2;width:40px;height:40px;margin:0;padding:0;border:1px solid #E7E4DE;border-radius:12px;background:#fff;color:#3B3F48;display:grid;place-items:center;cursor:pointer}",
      ".x:hover{border-color:#16181D;color:#16181D}",
      "@media (max-width:560px){.ov{padding:0}.panel{width:100%;height:100%;border-radius:0}.btn{right:max(14px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));font-size:14.5px}}",
      "@media (prefers-reduced-motion:reduce){.btn,.ov,.panel{transition:none}}"
    ].join("\n");

    function textColourFor(hex) {
      var h = hex.replace("#", "");
      if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
      var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      if ([r, g, b].some(isNaN)) return "#fff";
      return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? "#16181D" : "#fff";
    }
    function setColour(c) {
      if (!/^#[0-9a-f]{3,8}$/i.test(c || "")) return;
      host.style.setProperty("--c", c);
      host.style.setProperty("--t", textColourFor(c));
    }

    function build() {
      if (state.built) return;
      state.built = true;
      host = document.createElement("div");
      host.setAttribute("data-jobaro-widget", "");
      host.style.cssText = "all:initial;position:static";
      root = host.attachShadow({ mode: "open" });
      root.innerHTML = "<style>" + CSS + "</style>" +
        (showButton ? '<button class="btn" type="button" aria-haspopup="dialog"><span class="chip">' + BIRD + '</span><span class="lbl"></span></button>' : "") +
        '<div class="ov" role="dialog" aria-modal="true" aria-label="Get a quote"><div class="panel"><button class="x" type="button" aria-label="Close quote form"><svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div></div>';
      btn = root.querySelector(".btn");
      ov = root.querySelector(".ov");
      closeBtn = root.querySelector(".x");
      if (btn) {
        btn.querySelector(".lbl").textContent = label;
        btn.addEventListener("click", function () { open(null, btn); });
      }
      closeBtn.addEventListener("click", close);
      ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
      document.body.appendChild(host);
      if (colour) setColour(colour);

      // brand colour + name from the business's settings file
      var shown = false;
      function reveal() { if (!shown && btn) { shown = true; btn.classList.add("ready"); } }
      setTimeout(reveal, 2500);
      fetch(base + "businesses/" + business + ".json").then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) {
        if (cfg) {
          if (!colour) setColour(cfg.brandColour);
          bizName = cfg.businessName || "";
          ov.setAttribute("aria-label", "Get a quote" + (bizName ? " from " + bizName : ""));
        }
        reveal();
      }).catch(reveal);
    }

    function quoteUrl(service) {
      var u = base + "quote/?b=" + encodeURIComponent(business) + "&embed=1&from=" + encodeURIComponent(location.href.slice(0, 300));
      if (service) u += "&s=" + encodeURIComponent(service);
      return u;
    }

    function open(service, opener) {
      if (!canShadow) { window.open(base + "quote/?b=" + encodeURIComponent(business) + (service ? "&s=" + encodeURIComponent(service) : ""), "_blank"); return; }
      build();
      service = service || null;
      if (!frame || state.done || service !== state.service) {
        if (frame) frame.remove();
        frame = document.createElement("iframe");
        frame.title = "Quote form" + (bizName ? " for " + bizName : "");
        frame.setAttribute("allow", "clipboard-write");
        frame.src = quoteUrl(service);
        ov.querySelector(".panel").appendChild(frame);
        state.done = false;
        state.service = service;
      }
      state.opener = opener || document.activeElement;
      state.overflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
      ov.classList.add("open");
      if (btn) btn.classList.add("hide");
      requestAnimationFrame(function () { requestAnimationFrame(function () { ov.classList.add("show"); }); });
      state.open = true;
      setTimeout(function () { try { frame.focus(); } catch (e) { closeBtn.focus(); } }, 60);
    }

    function close() {
      if (!state.open) return;
      state.open = false;
      ov.classList.remove("show");
      if (btn) btn.classList.remove("hide");
      document.documentElement.style.overflow = state.overflow;
      setTimeout(function () { if (!state.open) ov.classList.remove("open"); }, 200);
      if (state.opener && state.opener.focus) { try { state.opener.focus(); } catch (e) {} }
    }

    // messages from the quote form inside the pop-up
    window.addEventListener("message", function (e) {
      if (e.origin !== origin || !frame || e.source !== frame.contentWindow) return;
      var d = e.data;
      if (!d || d.jobaro !== true) return;
      if (d.type === "close") close();
      if (d.type === "done") state.done = true;
    });
    document.addEventListener("keydown", function (e) { if (state.open && e.key === "Escape") close(); });

    // any element with data-jobaro-open opens the form
    document.addEventListener("click", function (e) {
      var t = e.target, el = t && t.closest ? t.closest("[data-jobaro-open]") : null;
      if (!el) return;
      e.preventDefault();
      open((el.getAttribute("data-jobaro-open") || "").trim() || null, el);
    });

    function init() {
      if (canShadow) build(); // very old browsers skip the floating button and open the form in a new tab
    }
    if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);

    window.Jobaro = { open: function (service) { open(service); }, close: close };
  } catch (err) {
    console.error("Jobaro widget could not start:", err);
  }
})();
