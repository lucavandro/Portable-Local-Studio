const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("Windows setup continues from voice preparation to the interface without removed hardware helpers", {
  skip: process.platform !== "win32",
}, (t) => {
  const root = path.resolve(__dirname, "../..");
  const setup = fs.readFileSync(path.join(root, "scripts/setup/setup.ps1"), "utf8");
  const start = setup.indexOf("Print-Step 4 $steps");
  const end = setup.indexOf("Print-Step 5 $steps");
  assert.ok(start >= 0 && end > start, "Voice and interface setup stages must exist");

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "studio-setup-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  // Only the voice installer is replaced: execute the real transition in PowerShell,
  // with no network, package installation or changes to installed runtimes.
  fs.writeFileSync(path.join(folder, "setup-tts.ps1"), 'Write-Output "VOICE_READY"\n');
  const script = `
    $ErrorActionPreference = "Stop"
    Set-StrictMode -Version Latest
    function Print-Step { param($n, $total, $title) }
    $steps = 6
    $scriptDir = '${folder.replaceAll("'", "''")}'
    ${setup.slice(start, end)}
    Write-Output "INTERFACE_STAGE_REACHED"
  `;
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ], { encoding: "utf8", timeout: 15000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /VOICE_READY/);
  assert.match(result.stdout, /INTERFACE_STAGE_REACHED/);
});
