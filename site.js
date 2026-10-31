(() => {
  const APP_ORIGIN = "https://app.liaisonreply.com";
  const ATTR_STORAGE_KEY = "lk_deeplink";
  const AUTH_HINT_KEY = "liaison_auth_hint";
  const COOKIE_CONSENT_KEY = "liaison_cookie_consent";
  const ROOT_COOKIE_DOMAIN = ".liaisonreply.com";
  window.__liaisonSiteJsPresent = true;

  const ANALYTICS_COOKIE_NAMES = [
    "_ga",
    "_ga_FMVPQNPPDD",
    "_gid",
    "_gat",
  ];

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

  function safeRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
  }

  function trackLandingEvent(eventName, payload = {}) {
    if (typeof window.liaisonPostHogCapture === "function") {
      window.liaisonPostHogCapture(eventName, payload);
    }

    if (typeof window.gtag !== "function") {
      return;
    }

    window.gtag("event", eventName, {
      ...payload,
      transport_type: "beacon",
    });
  }

  function readCookie(name) {
    const cookie = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${name}=`));
    return cookie
      ? decodeURIComponent(cookie.split("=").slice(1).join("="))
      : "";
  }

  function writeCookie(name, value, days = 30) {
    const expires = new Date(Date.now() + days * 86400000).toUTCString();
    document.cookie = `${name}=${
      encodeURIComponent(value)
    }; expires=${expires}; path=/; domain=${ROOT_COOKIE_DOMAIN}; SameSite=Lax; secure`;
  }

  function deleteCookie(name) {
    const expired = "Thu, 01 Jan 1970 00:00:00 GMT";
    const variants = [
      `expires=${expired}; path=/; domain=${ROOT_COOKIE_DOMAIN}; SameSite=Lax; secure`,
      `expires=${expired}; path=/; domain=${ROOT_COOKIE_DOMAIN}; SameSite=Lax`,
      `expires=${expired}; path=/; SameSite=Lax; secure`,
      `expires=${expired}; path=/; SameSite=Lax`,
    ];

    variants.forEach((attributes) => {
      document.cookie = `${name}=; ${attributes}`;
    });
  }

  function readConsent() {
    const raw = safeGet(COOKIE_CONSENT_KEY) || readCookie(COOKIE_CONSENT_KEY);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeConsent(consent) {
    const serialized = JSON.stringify(consent);
    safeSet(COOKIE_CONSENT_KEY, serialized);
    writeCookie(COOKIE_CONSENT_KEY, serialized, 180);
  }

  function toGoogleConsentState(continuityEnabled) {
    return {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: continuityEnabled ? "granted" : "denied",
    };
  }

  function updateGoogleConsent(continuityEnabled) {
    if (typeof window.gtag !== "function") {
      return;
    }

    window.gtag("consent", "update", toGoogleConsentState(continuityEnabled));
  }

  function allowsContinuityCookies(consent = readConsent()) {
    return Boolean(consent?.continuity);
  }

  function clearContinuityStorage() {
    safeRemove(ATTR_STORAGE_KEY);
    safeRemove(AUTH_HINT_KEY);
    ANALYTICS_COOKIE_NAMES.forEach(deleteCookie);
  }

  function currentQueryAttribution() {
    const params = new URLSearchParams(window.location.search);
    const next = {};

    ["utm_source", "ref_id", "scenario_id", "prefill", "billing_interval"]
      .forEach((key) => {
        const value = params.get(key);
        if (value) {
          next[key] = value;
        }
      });

    return next;
  }

  function currentAttribution() {
    const fromQuery = currentQueryAttribution();

    if (!allowsContinuityCookies()) {
      return fromQuery;
    }

    const stored = safeGet(ATTR_STORAGE_KEY) || readCookie(ATTR_STORAGE_KEY);
    if (!stored) {
      return fromQuery;
    }

    try {
      return { ...JSON.parse(stored), ...fromQuery };
    } catch {
      return fromQuery;
    }
  }

  function captureAttribution(extra = {}) {
    if (!allowsContinuityCookies()) {
      return;
    }

    const next = { ...currentAttribution(), ...extra };
    if (Object.keys(next).length > 0) {
      const serialized = JSON.stringify(next);
      safeSet(ATTR_STORAGE_KEY, serialized);
      writeCookie(ATTR_STORAGE_KEY, serialized, 30);
    }
  }

  function hasSessionHint() {
    const params = new URLSearchParams(window.location.search);
    const session = params.get("session");

    if (session === "1") {
      if (allowsContinuityCookies()) {
        safeSet(AUTH_HINT_KEY, "1");
        writeCookie(AUTH_HINT_KEY, "1", 14);
      }
      return true;
    }

    if (session === "0") {
      if (allowsContinuityCookies()) {
        safeSet(AUTH_HINT_KEY, "0");
        writeCookie(AUTH_HINT_KEY, "0", 1);
      }
      return false;
    }

    if (!allowsContinuityCookies()) {
      return false;
    }

    return safeGet(AUTH_HINT_KEY) === "1" || readCookie(AUTH_HINT_KEY) === "1";
  }

  function buildAppUrl(path, extraParams = {}) {
    const url = new URL(path, APP_ORIGIN);
    const merged = { ...currentAttribution(), ...extraParams };
    Object.entries(merged).forEach(([key, value]) => {
      if (value) {
        url.searchParams.set(key, String(value));
      }
    });
    return url.toString();
  }

  function getLinkExtraParams(link) {
    const billingInterval = link.getAttribute("data-billing-interval");
    const extraParams = {};

    if (billingInterval === "month" || billingInterval === "year") {
      extraParams.billing_interval = billingInterval;
    }

    return extraParams;
  }

  function formatUpdatedAt(value) {
    if (!value) {
      return "";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "";
    }

    return parsed.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function renderCookiePreferenceUI(consent = readConsent(), options = {}) {
    const status = document.querySelector("[data-cookie-preference-status]");
    const summary = document.querySelector("[data-cookie-preference-summary]");
    const meta = document.querySelector("[data-cookie-preference-meta]");
    const feedback = document.querySelector("[data-cookie-feedback]");
    const hasSavedPreference = Boolean(consent);
    const continuityEnabled = Boolean(consent?.continuity);
    const updatedAt = formatUpdatedAt(consent?.updatedAt);

    if (status) {
      status.textContent = hasSavedPreference
        ? continuityEnabled
          ? "Continuity cookies are active."
          : "Only necessary site storage is active."
        : "No optional cookie preference has been saved yet.";
    }

    if (summary) {
      summary.textContent = hasSavedPreference
        ? continuityEnabled
          ? "Liaison Reply can remember which scenario or link brought you here and help you pick up where you left off between the site and the app."
          : "Liaison Reply will not keep scenario or referral details after you leave, so each visit starts fresh."
        : "Choose whether Liaison Reply should remember the path into the app or keep storage limited to what the site needs to work.";
    }

    if (meta) {
      meta.textContent = hasSavedPreference
        ? updatedAt
          ? `Last updated ${updatedAt}.`
          : "Your preference is saved for this browser and shared across liaisonkeyboard.com when supported."
        : "Until you choose, optional continuity storage remains off by default.";
    }

    document.querySelectorAll("[data-cookie-action]").forEach((control) => {
      const action = control.getAttribute("data-cookie-action");
      const selected = hasSavedPreference
        ? (action === "accept-all" && continuityEnabled) ||
          (action === "necessary-only" && !continuityEnabled)
        : false;

      control.setAttribute("aria-pressed", selected ? "true" : "false");
      control.classList.toggle("is-selected", selected);
    });

    if (feedback && typeof options.feedback === "string") {
      feedback.textContent = options.feedback;
      feedback.hidden = options.feedback.length === 0;

      if (options.focusFeedback && !feedback.hidden) {
        feedback.setAttribute("tabindex", "-1");
        feedback.focus();
      }
    }
  }

  function hydrateSessionButtons() {
    const active = hasSessionHint();

    document.querySelectorAll("[data-session-primary]").forEach((link) => {
      const authText = link.getAttribute("data-auth-text") || "Start Free";
      const sessionText = link.getAttribute("data-session-text") ||
        "Open Liaison Reply";
      const authPath = link.getAttribute("data-auth-path") || "/auth/register";
      const sessionPath = link.getAttribute("data-session-path") || "/chat";
      const extraParams = getLinkExtraParams(link);

      link.textContent = active ? sessionText : authText;
      link.setAttribute(
        "href",
        buildAppUrl(active ? sessionPath : authPath, extraParams),
      );
    });

    document.querySelectorAll("[data-session-secondary]").forEach((link) => {
      const authText = link.getAttribute("data-auth-text") || "";
      const sessionText = link.getAttribute("data-session-text") ||
        link.textContent.trim() || "New Thread";
      const authPath = link.getAttribute("data-auth-path") || "/auth/register";
      const sessionPath = link.getAttribute("data-session-path") ||
        "/chat?new_thread=1";
      const extraParams = getLinkExtraParams(link);

      if (active) {
        link.textContent = sessionText;
        link.setAttribute("href", buildAppUrl(sessionPath, extraParams));
        link.hidden = false;
        link.classList.remove("is-hidden");
        return;
      }

      link.setAttribute("href", buildAppUrl(authPath, extraParams));

      if (authText) {
        link.textContent = authText;
        link.hidden = false;
        link.classList.remove("is-hidden");
      } else {
        link.hidden = true;
        link.classList.add("is-hidden");
      }
    });
  }

  function hydrateAppLinks() {
    const active = hasSessionHint();

    document.querySelectorAll("[data-app-link]").forEach((link) => {
      const authPath = link.getAttribute("data-auth-path") || "/auth/register";
      const sessionPath = link.getAttribute("data-session-path") || "/chat";
      const extraParams = getLinkExtraParams(link);

      link.setAttribute(
        "href",
        buildAppUrl(active ? sessionPath : authPath, extraParams),
      );
    });
  }

  function initPricingSectionTracking() {
    const pricingSection = document.querySelector("[data-pricing-section]");
    if (!pricingSection || pricingSection.dataset.pricingTracked === "true") {
      return;
    }

    pricingSection.dataset.pricingTracked = "true";

    const sessionState = hasSessionHint() ? "active" : "anonymous";

    const emitPricingViewed = () => {
      trackLandingEvent("landing_pricing_viewed", {
        cta_surface: "pricing-section",
        session_state: sessionState,
      });
    };

    if (typeof window.IntersectionObserver !== "function") {
      emitPricingViewed();
      return;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          emitPricingViewed();
          observer.disconnect();
        });
      },
      {
        threshold: 0.35,
      },
    );

    observer.observe(pricingSection);
  }

  function initCtaTracking() {
    document.querySelectorAll("[data-cta-surface]").forEach((link) => {
      if (link.dataset.ctaTracked === "true") {
        return;
      }

      link.dataset.ctaTracked = "true";
      link.addEventListener("click", () => {
        const href = link.getAttribute("href") || "";
        const billingInterval = link.getAttribute("data-billing-interval") ||
          undefined;
        const ctaSurface = link.getAttribute("data-cta-surface") || "unknown";
        const ctaLabel = link.getAttribute("data-cta-label") ||
          link.textContent.trim() || "cta";

        if (billingInterval === "month" || billingInterval === "year") {
          captureAttribution({ billing_interval: billingInterval });

          trackLandingEvent("landing_interval_selected", {
            cta_surface: ctaSurface,
            cta_label: ctaLabel,
            billing_interval: billingInterval,
            destination_path: href,
            session_state: hasSessionHint() ? "active" : "anonymous",
          });
        }

        trackLandingEvent("landing_cta_clicked", {
          cta_surface: ctaSurface,
          cta_label: ctaLabel,
          billing_interval: billingInterval,
          destination_path: href,
          session_state: hasSessionHint() ? "active" : "anonymous",
        });
      });
    });
  }

  function applyCookieConsent(continuityEnabled) {
    const nextConsent = {
      necessary: true,
      continuity: continuityEnabled,
      updatedAt: new Date().toISOString(),
    };

    writeConsent(nextConsent);

    updateGoogleConsent(continuityEnabled);

    if (continuityEnabled) {
      captureAttribution();
    } else {
      clearContinuityStorage();
    }

    const banner = document.querySelector("[data-cookie-banner]");
    if (banner) {
      banner.hidden = true;
      banner.style.display = "none";
    }

    hydrateSessionButtons();
    renderCookiePreferenceUI(nextConsent, {
      feedback: continuityEnabled
        ? "Liaison Reply can now remember the path between the site and the app, so picking back up feels smoother."
        : "Liaison Reply will now use necessary storage only. Saved handoff details and optional analytics cookies have been cleared where supported.",
      focusFeedback: true,
    });
  }

  function initScrollToButtons() {
    const buttons = document.querySelectorAll('[data-scroll-to]');
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const targetId = button.getAttribute('data-scroll-to');
        const target = document.getElementById(targetId);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  function initCookieControls() {
    const banner = document.querySelector("[data-cookie-banner]");
    const consent = readConsent();

    if (consent) {
      updateGoogleConsent(Boolean(consent.continuity));
    }

    if (banner) {
      if (consent) {
        banner.hidden = true;
        banner.style.display = "none";
      } else {
        banner.hidden = false;
        banner.style.display = "";
      }
    }

    renderCookiePreferenceUI(consent);

    document.querySelectorAll('[data-cookie-action="accept-all"]').forEach(
      (control) => {
        control.addEventListener("click", () => applyCookieConsent(true));
      },
    );

    document.querySelectorAll('[data-cookie-action="necessary-only"]').forEach(
      (control) => {
        control.addEventListener("click", () => applyCookieConsent(false));
      },
    );
  }

  function initFaqAccordion() {
    const toggles = document.querySelectorAll(".faq-toggle");
    if (toggles.length === 0) {
      return;
    }

    toggles.forEach((toggle) => {
      toggle.addEventListener("click", () => {
        const item = toggle.closest(".faq-item");
        if (!item) {
          return;
        }

        const panel = item.querySelector(".faq-panel");
        const icon = item.querySelector(".faq-icon");
        const isOpen = toggle.getAttribute("aria-expanded") === "true";

        if (isOpen) {
          toggle.setAttribute("aria-expanded", "false");
          panel.style.maxHeight = "0";
          panel.style.opacity = "0";
          if (icon) {
            icon.style.transform = "";
          }
        } else {
          toggle.setAttribute("aria-expanded", "true");
          panel.style.maxHeight = panel.scrollHeight + "px";
          panel.style.opacity = "1";
          if (icon) {
            icon.style.transform = "rotate(45deg)";
          }
        }
      });
    });
  }

  initCookieControls();
  initScrollToButtons();
  initFaqAccordion();
  captureAttribution();
  hydrateSessionButtons();
  hydrateAppLinks();
  initPricingSectionTracking();
  initCtaTracking();
})();
