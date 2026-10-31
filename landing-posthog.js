(() => {
  const POSTHOG_API_KEY = "phc_KNoq3BA46Ao69GOxt6Y448otMgNgwVTcx7HkCwBDSjA";
  const POSTHOG_HOST = "https://us.i.posthog.com";
  const CONSENT_KEY = "liaison_cookie_consent";
  const DISTINCT_ID_KEY = "liaison_posthog_distinct_id";
  const QUARTILES = [25, 50, 75, 100];

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
      }
    });

    return clean;
  }

  function capture(eventName, props = {}) {
    try {
      const payload = {
        api_key: POSTHOG_API_KEY,
        event: eventName,
        distinct_id: distinctId(),
        properties: {
          ...sanitiseProps(props),
          page_path: pagePath(),
          page_type: pageType(pagePath()),
          $current_url: window.location.origin + pagePath(),
          $process_person_profile: false,
          consent_continuity: hasContinuityConsent(),
          landing_source: "landing_site",
        },
        timestamp: new Date().toISOString(),
      };

      window.fetch(`${POSTHOG_HOST}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
        mode: "cors",
      }).catch(() => {});
    } catch {
      // Analytics must never break the page.
    }
  }

  window.liaisonPostHogCapture = capture;

  capture("$pageview", {});

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
