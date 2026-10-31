const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

test("trackLandingEvent forwards landing events to PostHog capture", () => {
  const siteJs = read("site.js");

  assert.match(
    siteJs,
    /window\.liaisonPostHogCapture\(eventName, payload\)/,
    "trackLandingEvent should forward each event to the PostHog capture helper"
  );

  assert.match(
    siteJs,
    /window\.gtag\("event", eventName, \{[\s\S]*transport_type: "beacon"[\s\S]*\}\)/,
    "GA4 forwarding should stay in place alongside PostHog"
  );
});

test("PostHog capture helper emits pageview, scroll quartiles, pricing reach, and CTA clicks", () => {
  const helper = read("landing-posthog.js");

  assert.match(helper, /us\.i\.posthog\.com/, "capture should target the PostHog ingestion host");
  assert.match(helper, /capture\("\$pageview"/, "pageview record is the independent session denominator");
  assert.match(helper, /landing_scroll_depth/, "scroll quartile events should be emitted");
  assert.match(helper, /\[25, 50, 75, 100\]/, "quartiles should be 25, 50, 75, and 100");
  assert.match(helper, /landing_pricing_reached/, "pricing section reach should be recorded");
  assert.match(helper, /landing_cta_clicked/, "CTA clicks should be recorded");
  assert.match(
    helper,
    /\$process_person_profile: false/,
    "events should not create person profiles or identify visitors"
  );
  assert.doesNotMatch(helper, /posthog-js|posthog\.init/, "no heavy PostHog library should be loaded");
});

test("home page and scenario pages load the PostHog capture helper", () => {
  assert.match(read("index.html"), /<script src="\.\/landing-posthog\.js"><\/script>/);
  assert.match(read("scenarios/index.html"), /<script src="\.\.\/landing-posthog\.js"><\/script>/);
  assert.match(read("scenarios/left-on-read.html"), /<script src="\.\.\/landing-posthog\.js"><\/script>/);
});
