(() => {
  const POSTHOG_API_KEY = "phc_KNoq3BA46Ao69GOxt6Y448otMgNgwVTcx7HkCwBDSjA";
  const POSTHOG_HOST = "https://us.i.posthog.com";
  const CONSENT_KEY = "liaison_cookie_consent";
  const DISTINCT_ID_KEY = "liaison_posthog_distinct_id";
  const QUARTILES = [25, 50, 75, 100];
  const SESSION_KEY = "liaison_posthog_session";
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const VITALS_MAX_VALUE_MS = 15 * 60 * 1000;
  const VITALS_FLUSH_MS = 5000;

  function safeGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Ignore storage failures.
    }
  }

  function readCookie(name) {
    const cookie = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${name}=`));
    return cookie
      ? decodeURIComponent(cookie.split("=").slice(1).join("="))
      : "";
  }

  function readConsent() {
    const raw = safeGet(CONSENT_KEY) || readCookie(CONSENT_KEY);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function hasContinuityConsent() {
    return Boolean(readConsent()?.continuity);
  }

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return `id-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  let ephemeralId = null;

  function distinctId() {
    if (hasContinuityConsent()) {
      let stored = safeGet(DISTINCT_ID_KEY);
      if (!stored) {
        stored = randomId();
        safeSet(DISTINCT_ID_KEY, stored);
      }
      return stored;
    }

    if (!ephemeralId) {
      ephemeralId = randomId();
    }
    return ephemeralId;
  }

  let sessionMemory = null;

  function readSessionRecord() {
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.id !== "string") {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function writeSessionRecord(record) {
    sessionMemory = record;
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(record));
    } catch {
      // Ignore storage failures.
    }
  }

  // One id per visit, shared by every event in that visit. Stored in
  // sessionStorage so it survives same-tab navigation but never crosses
  // sessions, and rotated after 30 minutes without an event.
  function sessionId() {
    const now = Date.now();
    const stored = readSessionRecord() || sessionMemory;
    if (
      stored &&
      stored.id &&
      now - (stored.lastSeen || 0) < SESSION_TIMEOUT_MS
    ) {
      const record = { id: stored.id, lastSeen: now };
      writeSessionRecord(record);
      return record.id;
    }
    const record = { id: randomId(), lastSeen: now };
    writeSessionRecord(record);
    return record.id;
  }

  function pagePath() {
    return window.location.pathname || "/";
  }

  function pageType(path) {
    if (path === "/scenarios/" || path === "/scenarios/index.html") {
      return "scenarios_hub";
    }
    if (path.startsWith("/scenarios/")) {
      return "scenario_guide";
    }
    if (path === "/" || path === "/index.html") {
      return "home";
    }
    return "landing";
  }

  function stripUrl(value) {
    try {
      return new URL(value, window.location.origin).pathname;
    } catch {
      return String(value).split(/[?#]/)[0];
    }
  }

  function sanitiseProps(props) {
    const clean = {};

    Object.entries(props || {}).forEach(([key, value]) => {
      if (typeof value === "string") {
        if (key.includes("path") || key.includes("url") || key === "href") {
          clean[key] = stripUrl(value);
        } else if (key === "cta_label") {
          clean[key] = value.trim().slice(0, 80);
        } else {
          clean[key] = value;
        }
      } else if (
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        clean[key] = value;
      } else if (
        key.startsWith("$web_vitals_") &&
        key.endsWith("_event") &&
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        clean[key] = value;
      }
    });

    return clean;
  }

  function exp2Variant() {
    const fromWindow =
      typeof window.__exp2Variant === "string" ? window.__exp2Variant : "";
    if (fromWindow === "A" || fromWindow === "B") {
      return fromWindow;
    }

    const stored = safeGet("liaison_exp2_variant");
    return stored === "A" || stored === "B" ? stored : null;
  }

  function capture(eventName, props = {}, options = {}) {
    try {
      const variant = exp2Variant();
      const payload = {
        api_key: POSTHOG_API_KEY,
        event: eventName,
        distinct_id: distinctId(),
        properties: {
          ...sanitiseProps(props),
          $session_id: sessionId(),
          page_path: pagePath(),
          page_type: pageType(pagePath()),
          $current_url: window.location.origin + pagePath(),
          $process_person_profile: false,
          consent_continuity: hasContinuityConsent(),
          landing_source: "landing_site",
          ...(variant ? { exp2_variant: variant } : {}),
        },
        timestamp: new Date().toISOString(),
      };

      const body = JSON.stringify(payload);
      if (
        options.beacon &&
        typeof window.navigator !== "undefined" &&
        typeof window.navigator.sendBeacon === "function"
      ) {
        try {
          const blob = new Blob([body], { type: "application/json" });
          if (window.navigator.sendBeacon(`${POSTHOG_HOST}/capture/`, blob)) {
            return;
          }
        } catch {
          // Fall through to fetch.
        }
      }

      window.fetch(`${POSTHOG_HOST}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
        mode: "cors",
      }).catch(() => {});
    } catch {
      // Analytics must never break the page.
    }
  }

  window.liaisonPostHogCapture = capture;

  capture("$pageview", {});

  capture("landing_session_started", {});

  const pageLoadedAt = Date.now();
  let pageleaveSent = false;

  function vitalsRating(name, value) {
    if (name === "LCP") {
      return value <= 2500 ? "good" : value <= 4000 ? "needs-improvement" : "poor";
    }
    if (name === "FCP") {
      return value <= 1800 ? "good" : value <= 3000 ? "needs-improvement" : "poor";
    }
    if (name === "INP") {
      return value <= 200 ? "good" : value <= 500 ? "needs-improvement" : "poor";
    }
    if (name === "CLS") {
      return value <= 0.1 ? "good" : value <= 0.25 ? "needs-improvement" : "poor";
    }
    return "good";
  }

  const vitals = {};
  let vitalsFlushTimer = null;
  const pageLoadId = randomId();

  function recordVital(name, value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return;
    }
    if (name !== "CLS" && value >= VITALS_MAX_VALUE_MS) {
      return;
    }
    const rounded =
      name === "CLS" ? Math.round(value * 1000) / 1000 : Math.round(value);
    vitals[name] = {
      name,
      value: rounded,
      rating: vitalsRating(name, rounded),
      delta: rounded,
      id: `vitals-${name}-${pageLoadId}`,
      navigationType: "navigate",
    };
    scheduleVitalsFlush();
  }

  function scheduleVitalsFlush() {
    if (vitalsFlushTimer) {
      return;
    }
    vitalsFlushTimer = setTimeout(() => flushWebVitals(false), VITALS_FLUSH_MS);
  }

  function flushWebVitals(onPageHide) {
    if (vitalsFlushTimer) {
      clearTimeout(vitalsFlushTimer);
      vitalsFlushTimer = null;
    }
    const names = Object.keys(vitals);
    if (names.length === 0) {
      return;
    }
    const props = {};
    names.forEach((name) => {
      const metric = vitals[name];
      props[`$web_vitals_${name}_event`] = { ...metric };
      props[`$web_vitals_${name}_value`] = metric.value;
      delete vitals[name];
    });
    capture("$web_vitals", props, onPageHide ? { beacon: true } : {});
  }

  function initWebVitals() {
    if (typeof window.PerformanceObserver !== "function") {
      return;
    }

    try {
      const paintObserver = new window.PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (entry.name === "first-contentful-paint") {
            recordVital("FCP", entry.startTime);
          }
        });
      });
      paintObserver.observe({ type: "paint", buffered: true });
    } catch {
      // PerformanceObserver unavailable or unsupported entry type.
    }

    try {
      const lcpObserver = new window.PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) {
          recordVital("LCP", last.renderTime || last.loadTime || last.startTime);
        }
      });
      lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // PerformanceObserver unavailable or unsupported entry type.
    }

    try {
      let clsValue = 0;
      const clsObserver = new window.PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
            recordVital("CLS", clsValue);
          }
        });
      });
      clsObserver.observe({ type: "layout-shift", buffered: true });
    } catch {
      // PerformanceObserver unavailable or unsupported entry type.
    }

    try {
      const interactions = {};
      const inpObserver = new window.PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (
            typeof entry.interactionId !== "number" &&
            typeof entry.interactionId !== "string"
          ) {
            return;
          }
          const end =
            typeof entry.processingEnd === "number"
              ? entry.processingEnd
              : entry.startTime + entry.duration;
          const latency = end - entry.startTime;
          const prev = interactions[entry.interactionId] || 0;
          if (latency > prev) {
            interactions[entry.interactionId] = latency;
          }
        });
        const worst = Math.max(0, ...Object.values(interactions));
        if (worst > 0) {
          recordVital("INP", worst);
        }
      });
      inpObserver.observe({ type: "event", buffered: true, durationThreshold: 16 });
    } catch {
      // PerformanceObserver unavailable or unsupported entry type.
    }
  }

  initWebVitals();

  function sendPageleave() {
    if (pageleaveSent) {
      return;
    }
    pageleaveSent = true;
    flushWebVitals(true);
    capture(
      "$pageleave",
      {
        time_on_page_seconds: Math.round((Date.now() - pageLoadedAt) / 1000),
      },
      { beacon: true },
    );
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      sendPageleave();
    }
  });
  window.addEventListener("pagehide", sendPageleave);

  const sentQuartiles = new Set();

  function currentScrollPercent() {
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const viewport = window.innerHeight || doc.clientHeight || 0;
    const fullHeight = Math.max(
      doc.scrollHeight || 0,
      document.body ? document.body.scrollHeight || 0 : 0,
    );

    if (fullHeight <= viewport) {
      return 100;
    }

    return Math.min(100, ((scrollTop + viewport) / fullHeight) * 100);
  }

  function checkScrollDepth() {
    const percent = currentScrollPercent();

    QUARTILES.forEach((quartile) => {
      const threshold = quartile === 100 ? 99 : quartile;
      if (percent >= threshold && !sentQuartiles.has(quartile)) {
        sentQuartiles.add(quartile);
        capture("landing_scroll_depth", { scroll_quartile: quartile });
      }
    });
  }

  let scrollTicking = false;

  function onScroll() {
    if (scrollTicking) {
      return;
    }
    scrollTicking = true;

    const run = () => {
      scrollTicking = false;
      checkScrollDepth();
    };

    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(run);
    } else {
      run();
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  checkScrollDepth();

  function initPricingReach() {
    const pricingSection = document.querySelector("[data-pricing-section]");
    if (!pricingSection) {
      return;
    }

    const emitPricingReached = () => {
      capture("landing_pricing_reached", {
        cta_surface: "pricing-section",
      });
    };

    if (typeof window.IntersectionObserver !== "function") {
      emitPricingReached();
      return;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          emitPricingReached();
          observer.disconnect();
        });
      },
      { threshold: 0.35 },
    );

    observer.observe(pricingSection);
  }

  initPricingReach();

  document.addEventListener("click", (event) => {
    if (window.__liaisonSiteJsPresent) {
      return;
    }

    const target = event.target;
    const link =
      target && typeof target.closest === "function"
        ? target.closest("a")
        : null;
    if (!link) {
      return;
    }

    const surface = link.getAttribute("data-cta-surface");
    const href = link.getAttribute("href") || "";

    if (surface) {
      capture("landing_cta_clicked", {
        cta_surface: surface,
        cta_label: link.textContent || "cta",
        destination_path: href,
      });
      return;
    }

    if (pageType(pagePath()) === "scenarios_hub") {
      let destination = "";
      try {
        destination = new URL(link.href).pathname;
      } catch {
        destination = "";
      }

      if (
        destination.startsWith("/scenarios/") &&
        destination.endsWith(".html") &&
        destination !== "/scenarios/index.html" &&
        destination !== pagePath()
      ) {
        capture("landing_cta_clicked", {
          cta_surface: "scenario_index_card",
          destination_path: destination,
        });
      }
    }
  });
})();
