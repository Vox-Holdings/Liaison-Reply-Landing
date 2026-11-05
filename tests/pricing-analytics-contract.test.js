const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const siteJs = fs.readFileSync(path.join(repoRoot, 'site.js'), 'utf8');

test('pricing CTAs preserve billing interval attributes', () => {
  assert.match(
    html,
    /data-billing-interval="month"[\s\S]*data-cta-surface="pricing-monthly"/,
    'monthly pricing CTA should carry month interval attribution'
  );

  assert.match(
    html,
    /data-billing-interval="year"[\s\S]*data-cta-surface="pricing-yearly"/,
    'yearly pricing CTA should carry year interval attribution'
  );
});

test('landing pricing CTA tracking emits interval and click events with beacon transport', () => {
  assert.match(
    siteJs,
    /trackLandingEvent\("landing_interval_selected"[\s\S]*trackLandingEvent\("landing_cta_clicked"/,
    'pricing CTA handler should emit interval-selected before CTA-clicked'
  );

  assert.match(
    siteJs,
    /window\.gtag\("event", eventName, \{[\s\S]*transport_type: "beacon"[\s\S]*\}\)/,
    'landing analytics should use beacon transport for navigational clicks'
  );
});
