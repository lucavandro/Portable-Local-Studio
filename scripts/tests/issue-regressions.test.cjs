const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("chat streams propagate backend and consumer errors", async (t) => {
  const { streamChatWithLlm } = await import(
    pathToFileURL(path.join(root, "app/frontend/src/services/api.js")).href
  );
  const delta = { choices: [{ delta: { content: "Partial answer" } }] };
  for (const scenario of [
    {
      name: "error before content",
      events: [{ error: { message: "Context size exceeded" } }],
      error: "Context size exceeded",
    },
    {
      name: "error after partial content",
      events: [delta, { error: { message: "Backend ran out of memory" } }],
      error: "Backend ran out of memory",
    },
    {
      name: "string error",
      events: [delta, { error: "Backend stopped" }],
      error: "Backend stopped",
    },
    {
      name: "consumer error",
      events: [delta],
      error: "Rendering failed",
      onToken() {
        throw new Error("Rendering failed");
      },
    },
  ]) {
    await t.test(scenario.name, async (t) => {
      const body = new ReadableStream({
        start(controller) {
          const events = scenario.events
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join("");
          controller.enqueue(
            new TextEncoder().encode(events + "data: [DONE]\n\n"),
          );
          controller.close();
        },
      });
      t.mock.method(global, "fetch", async () => new Response(body));
      await assert.rejects(
        streamChatWithLlm([], {}, scenario.onToken || (() => {})),
        { message: scenario.error },
      );
      assert.equal(body.locked, false);
    });
  }
});

test("chat streams preserve fragmented content, reasoning, sources and metadata", async (t) => {
  const { streamChatWithLlm } = await import(
    pathToFileURL(path.join(root, "app/frontend/src/services/api.js")).href
  );
  const sources = [{ title: "Example", url: "https://example.com/" }];
  const usage = { completion_tokens: 1 };
  const timings = { predicted_ms: 10 };
  const events = [
    `event: web_sources\r\ndata: ${JSON.stringify({ sources })}\r\n\r\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "Thinking" } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Caf\u00e9" }, finish_reason: "stop" }], usage, timings })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const bytes = new TextEncoder().encode(events.join(""));
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  t.mock.method(global, "fetch", async () => new Response(body));
  const updates = [];
  const result = await streamChatWithLlm([], {}, (...args) =>
    updates.push(args),
  );
  assert.deepEqual(result, {
    content: "Caf\u00e9",
    reasoningContent: "Thinking",
    webSources: sources,
    usage,
    timings,
    finishReason: "stop",
  });
  assert.equal(updates.length, 2);
  assert.equal(body.locked, false);
});

test("Windows launcher remains ASCII-safe for cmd.exe", () => {
  const launcher = fs.readFileSync(path.join(root, "windows.bat"));
  assert.equal(
    [...launcher].some((byte) => byte > 0x7f),
    false,
  );
});

test("Kokoro setup uses pinned online dependencies and skips optional CUDA payloads", () => {
  for (const relativePath of [
    "scripts/setup/setup-tts.ps1",
    "scripts/setup/setup-tts.sh",
  ]) {
    const setup = read(relativePath);
    assert.match(setup, /ONNXRUNTIME_NODE_INSTALL_CUDA/);
    assert.match(setup, /prefer-online/);
    assert.match(setup, /\bci\b/);
    assert.doesNotMatch(setup, /prefer-offline/);
  }
});

test("issue 101: Kokoro setup declares build dependencies for sharp compilation", () => {
  for (const relativePath of [
    "scripts/setup/setup-tts.ps1",
    "scripts/setup/setup-tts.sh",
  ]) {
    const setup = read(relativePath);
    assert.match(setup, /node-addon-api/);
    assert.match(setup, /node-gyp/);
  }
});

test("model imports retry locked files and explain large-drive failures", () => {
  const server = read("scripts/server/serve.cjs");
  assert.match(server, /function withFileRetrySync/);
  assert.match(server, /function replaceFileWithRetry/);
  assert.match(server, /fs\.openSync\(tempPath, "w"\)/);
  assert.match(server, /FAT32 ha un limite di 4 GB per file/);
  assert.match(server, /ensureStorageCapacity\(targetDir/);
});

test("issue 85: chat shows reasoning, scrolls only the message list, renders tables, math and PDFs", () => {
  const chat = read("app/frontend/src/components/TextChat.jsx");
  assert.doesNotMatch(chat, /<ThinkingBlock/);
  assert.match(chat, /<ChatThinkingSection/);
  assert.match(chat, /"<think>"/);
  assert.doesNotMatch(chat, /\.scrollIntoView\(/);
  assert.match(chat, /type: "table"/);
  assert.match(chat, /katex\.renderToString/);
  assert.match(chat, /extractPdfText/);
  const server = read("scripts/server/serve.cjs");
  assert.doesNotMatch(server, /async function planWebSearchQuery/);
});

test("issue 82: speech upload converts any browser-decodable audio to 16 kHz WAV", () => {
  const speech = read("app/frontend/src/components/SpeechTranscriber.jsx");
  assert.match(speech, /convertAudioFileTo16kWav/);
  assert.doesNotMatch(speech, /V1 accepts WAV files only/);
  assert.match(
    read("scripts/server/serve.cjs"),
    /readBinaryBody\(req, limitBytes = 1024 \* 1024 \* 1024\)/,
  );
});

test("launchers update a stale llama.cpp backend so existing installs get backend fixes", () => {
  assert.match(read("mac.sh"), /scripts\/setup\/update-llama\.sh/);
  assert.match(read("linux.sh"), /scripts\/setup\/update-llama\.sh/);
  assert.match(read("windows.bat"), /scripts\\setup\\update-llama\.ps1/);
  const sh = read("scripts/setup/update-llama.sh");
  assert.match(sh, /\.llama-release/);
  assert.match(sh, /setup-llama\.sh/);
  const ps1 = read("scripts/setup/update-llama.ps1");
  assert.match(ps1, /\.llama-release/);
  assert.match(ps1, /setup-llama\.ps1/);
  // The release the updater compares against must be the one setup-llama actually installs.
  assert.match(
    read("scripts/setup/setup-llama.sh"),
    /^RELEASE="\$\{LLAMA_RELEASE:-b\d+\}"$/m,
  );
  assert.match(
    read("scripts/setup/setup-llama.ps1"),
    /param\(\[string\]\$Release = "b\d+"\)/,
  );
});
