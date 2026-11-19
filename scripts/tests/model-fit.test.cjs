const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const load = () => import(pathToFileURL(path.resolve(__dirname, "../../app/frontend/src/utils/modelFit.js")).href);
const GIB = 1024 ** 3;
const pc = { cpu_cores_physical: 8, ram_total_gb: 8 };

test("model forecast waits for measured RAM and exact file size", async () => {
  const { estimateModelFit: fit } = await load();
  assert.equal(fit({ sizeBytes: GIB }, {}, pc, {}).known, false);
  assert.equal(fit({}, {}, pc, { ram_total_gb: 8, ram_used_gb: 3 }).known, false);
  assert.equal(fit({ sizeBytes: GIB }, {}, pc, { ram_total_gb: 0, ram_used_gb: 0 }).known, false);
});

test("larger quantizations and reduced free RAM worsen the forecast", async () => {
  const { estimateModelFit: fit } = await load();
  const telemetry = { ram_total_gb: 8, ram_used_gb: 3 };
  const small = fit({ sizeBytes: GIB }, {}, pc, telemetry);
  const large = fit({ sizeBytes: 3 * GIB }, {}, pc, telemetry);
  const busy = fit({ sizeBytes: 3 * GIB }, {}, pc, { ...telemetry, ram_used_gb: 6 });
  assert.equal(small.level, "comfortable");
  assert.equal(large.level, "tight");
  assert.equal(busy.level, "insufficient");
  assert.ok(large.high > small.high && large.low > small.low);
  assert.equal(small.threads, 4);
});

test("vision budget includes projector and refuses an unknown projector size", async () => {
  const { estimateModelFit: fit } = await load();
  const variant = { sizeBytes: 2 * GIB };
  const telemetry = { ram_total_gb: 8, ram_used_gb: 3 };
  const model = { projector: { sizeBytes: GIB } };
  const text = fit(variant, model, pc, telemetry);
  const vision = fit(variant, model, pc, telemetry, true);
  assert.ok(vision.low > text.low && vision.high > text.high);
  assert.equal(vision.load, "elevato");
  assert.equal(fit(variant, {}, pc, telemetry, true).known, false);
});
