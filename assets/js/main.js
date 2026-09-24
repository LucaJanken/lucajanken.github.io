/* lucajanken.github.io — small enhancements. The page works without this file. */
(function () {
  "use strict";

  var root = document.documentElement;
  var STORAGE_KEY = "lj-theme";

  /* ---------- Theme toggle ---------- */
  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function currentTheme() {
    var t = root.getAttribute("data-theme");
    if (t === "dark" || t === "light") return t;
    return systemPrefersDark() ? "dark" : "light";
  }
  var toggle = document.getElementById("theme-toggle");
  if (toggle) {
    var syncLabel = function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      toggle.setAttribute("aria-label", "Switch to " + next + " mode");
      toggle.setAttribute("title", "Switch to " + next + " mode");
    };
    syncLabel();
    toggle.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
      syncLabel();
    });
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function () { syncLabel(); };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  /* ---------- Active section in the nav ---------- */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".nav a[href^='#']"));
  if ("IntersectionObserver" in window && navLinks.length) {
    var byId = {};
    navLinks.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && byId[e.target.id]) {
          navLinks.forEach(function (a) { a.classList.remove("active"); });
          byId[e.target.id].classList.add("active");
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    Object.keys(byId).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }

  /* ---------- Click the email address to copy it ---------- */
  Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (btn) {
    var status = btn.querySelector(".copied");
    var timer;
    var flash = function (msg) {
      if (status) status.textContent = msg;
      btn.classList.add("is-copied");
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (status) status.textContent = "";
        btn.classList.remove("is-copied");
      }, 1600);
    };
    var selectText = function () {
      var target = document.getElementById("email-address");
      if (!target) return;
      var range = document.createRange();
      range.selectNodeContents(target);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { flash("Copied"); }, selectText);
      } else {
        selectText();
      }
    });
  });

  /* ---------- Contact form (delivered by formsubmit.co) ---------- */
  var form = document.getElementById("contact-form");
  if (form) {
    var status = document.getElementById("form-status");
    var sendBtn = form.querySelector(".send");
    var say = function (msg, kind) {
      status.textContent = msg;
      status.className = "form-status" + (kind ? " " + kind : "");
    };
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var fields = ["cf-name", "cf-email", "cf-message"].map(function (id) { return document.getElementById(id); });
      var firstBad = null;
      fields.forEach(function (f) {
        var ok = f.value.trim() !== "" && (f.type !== "email" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.value.trim()));
        f.setAttribute("aria-invalid", ok ? "false" : "true");
        if (!ok && !firstBad) firstBad = f;
      });
      if (firstBad) {
        say(firstBad.type === "email" && firstBad.value.trim() ? "Please enter a valid email address." : "Please fill in all three fields.", "err");
        firstBad.focus();
        return;
      }
      sendBtn.disabled = true;
      say("Sending…");
      fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } })
        .then(function (r) {
          if (!r.ok) throw new Error("bad status");
          return r.json();
        })
        .then(function (data) {
          if (data && String(data.success) === "false") throw new Error(data.message || "not sent");
          form.reset();
          fields.forEach(function (f) { f.removeAttribute("aria-invalid"); });
          say("Thanks, your message has been sent. I'll reply by email.", "ok");
        })
        .catch(function () {
          say("Your message couldn't be sent. Try again, or email luca.janken@math.au.dk.", "err");
        })
        .then(function () { sendBtn.disabled = false; });
    });
    form.addEventListener("input", function (ev) {
      if (ev.target.getAttribute("aria-invalid") === "true") ev.target.setAttribute("aria-invalid", "false");
    });
  }

  /* ---------- Year in footer ---------- */
  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
