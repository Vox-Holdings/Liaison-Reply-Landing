const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const activeFiles = [
  path.join(root, "index.html"),
  path.join(root, "pricing.html"),
  path.join(root, "docs", "faq.md"),
  ...fs.readdirSync(path.join(root, "scenarios"))
    .filter((name) => name.endsWith(".html"))
    .map((name) => path.join(root, "scenarios", name)),
];

function readActiveSource() {
  return activeFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
}

test("active public copy uses lifetime credits and never promises replenishment", () => {
  const source = readActiveSource();
  const withoutCorrection = source.replace(/credits do not automatically reset or replenish/gi, "");
  assert.doesNotMatch(withoutCorrection, /(?:credits?|generations?|free allowance|free tier)[^.\n]*(?:48\s*[- ]?hour|2\s*[- ]?day|daily|reloaded|replenished|replenish(?:es|ing)?|reset(?:s|ting)? automatically)\b/i);
  assert.match(source, /15 lifetime credits/i);
  assert.match(source, /verified referrals?[^.]*bonus credits/i);
  assert.match(source, /unlimited generations for normal use/i);
  assert.match(source, /fair-use protections/i);
});

test("demo persona controls are wired to deterministic behavior", () => {
  const source = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.doesNotMatch(source + fs.readFileSync(path.join(root, "site.js"), "utf8"), /demo-copy|landing_experiment_exposed|data-demo-copy/);
  assert.match(source, /data-dm-persona-row="diplomat"/);
  assert.match(source, /data-dm-persona-row="charmer"/);
  assert.match(source, /data-dm-persona-row="closer"/);
  assert.match(source, /data-dm-persona-row="cool-head"/);
  assert.match(source, /function setPersona\(id\)/);
  assert.match(source, /querySelectorAll\("\[data-dm-persona-row\]"\).*addEventListener/);
  assert.match(source, /personaStrategy/);
  assert.match(source, /landing_demo_persona_selected/);
  assert.match(source, /landing_demo_steering_selected/);
});
