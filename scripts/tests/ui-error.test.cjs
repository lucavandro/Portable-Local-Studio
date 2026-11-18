const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

test("browser failures give actionable Italian guidance and preserve specific application errors", async () => {
  const { describeUiError } = await import(pathToFileURL(
    path.resolve(__dirname, "../../app/frontend/src/utils/uiError.js"),
  ).href);
  assert.match(describeUiError({ name: "NotAllowedError", message: "Permission denied" }), /autorizzazioni del browser/);
  assert.match(describeUiError({ name: "NotFoundError", message: "Requested device not found" }), /Collega un microfono/);
  assert.match(describeUiError({ name: "NotReadableError" }), /occupato da un altro programma/);
  assert.match(describeUiError(new TypeError("Failed to fetch")), /server locale/);
  assert.match(describeUiError({ name: "NotSupportedError" }), /file WAV/);
  assert.equal(describeUiError(new Error("Il modello supera il limite scolastico di 2 GB.")), "Il modello supera il limite scolastico di 2 GB.");
});
