const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { EventEmitter } = require("node:events");
const { Readable, Writable } = require("node:stream");
const { once } = require("node:events");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(
  path.join(root, "scripts/server/serve.cjs"),
  "utf8",
);

function gguf(architecture) {
  const string = (value) => {
    const bytes = Buffer.from(value);
    const length = Buffer.alloc(8);
    length.writeBigUInt64LE(BigInt(bytes.length));
    return Buffer.concat([length, bytes]);
  };
  const header = Buffer.alloc(24);
  header.write("GGUF");
  header.writeUInt32LE(3, 4);
  header.writeBigUInt64LE(1n, 16);
  const type = Buffer.alloc(4);
  type.writeUInt32LE(8);
  return Buffer.concat([
    header,
    string("general.architecture"),
    type,
    string(architecture),
  ]);
}

function loadRuntime(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "school-studio-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  let handler;
  const spawns = [];
  const originalRequire = createRequire(
    path.join(root, "scripts/server/serve.cjs"),
  );
  const context = {
    __dirname: path.join(folder, "scripts/server"),
    Buffer,
    URL,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    SharedArrayBuffer,
    Atomics,
    process: { ...process, env: {}, on() {}, exit() {} },
    module: { exports: {} },
    require(name) {
      if (name === "http")
        return {
          ...require("node:http"),
          createServer(callback) {
            handler = callback;
            return { listen() {} };
          },
        };
      if (name === "net")
        return {
          createServer() {
            const server = new EventEmitter();
            server.listen = () => {
              queueMicrotask(() => server.emit("listening"));
              return server;
            };
            server.close = (callback) => {
              callback?.();
              return server;
            };
            return server;
          },
        };
      if (name === "child_process")
        return {
          execSync: () => Buffer.from("4"),
          exec() {},
          execFile() {},
          spawnSync: () => ({ stdout: "--load-mode", stderr: "", status: 0 }),
          spawn(binary, args, options) {
            spawns.push({ binary, args, options });
            throw new Error("spawn intercepted");
          },
        };
      return originalRequire(name);
    },
  };
  vm.runInNewContext(
    source +
      `\nmodule.exports = { startLlmWithBackend, getLlmModels, getSpeechModels, getTtsModels, getAllLlmBackendCandidates, runExclusiveLlmOperation, runExclusiveSpeechOperation, runExclusiveTtsOperation, convertFloatWavToPcm16, settings:()=>llmSettings };`,
    context,
  );
  async function request(url, method = "GET", data) {
    const bytes =
      data === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(data));
    const req = Readable.from(bytes.length ? [bytes] : []);
    Object.assign(req, {
      url,
      method,
      headers: { host: "localhost", "content-length": String(bytes.length) },
    });
    const chunks = [];
    const res = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    });
    res.statusCode = 200;
    res.writeHead = (code) => {
      res.statusCode = code;
      res.headersSent = true;
    };
    const finished = once(res, "finish");
    await handler(req, res);
    await finished;
    return {
      status: res.statusCode,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    };
  }
  return { folder, runtime: context.module.exports, spawns, request };
}

test("school API exposes only local text and audio capabilities", async (t) => {
  const { request } = loadRuntime(t);
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(health.body.features, {
    chat: true,
    documents: true,
    speech: true,
    tts: true,
    images: false,
    webSearch: false,
    paidApis: false,
  });
  assert.equal(health.body.text.installed, false);
  for (const [route, method] of [
    ["/api/models", "GET"],
    ["/api/restart-backend", "POST"],
    ["/api/download-model", "POST"],
    ["/api/openvino-generate", "POST"],
    ["/sdapi/v1/txt2img", "POST"],
    ["/api/web-search", "POST"],
  ]) {
    assert.equal((await request(route, method, {})).status, 404, route);
  }
  assert.equal(
    (await request("/api/llm/chat", "POST", { messages: [] })).status,
    409,
  );
});

test("school catalogs retain lightweight multilingual speech and quantized voice", async (t) => {
  const { runtime, request } = loadRuntime(t);
  assert.equal(
    runtime
      .getAllLlmBackendCandidates()
      .every((backend) => backend.key === "cpu"),
    true,
  );
  const specs = (await request("/api/hardware-specs")).body;
  assert.equal(specs.recommended_models.length, 2);
  assert.equal(
    specs.recommended_models.every((model) =>
      model.url.startsWith("https://huggingface.co/Qwen/"),
    ),
    true,
  );
  const speech = (await request("/api/speech/models")).body.models;
  assert.equal(
    speech.every((model) => model.language === "Multilingual"),
    true,
  );
  const voice = (await request("/api/tts/models")).body.models;
  assert.equal(voice.length, 1);
  assert.equal(voice[0].dtype, "q8");
  const ttsStatus = (await request("/api/tts/status")).body;
  assert.equal(ttsStatus.settings.voice, "if_sara");
  assert.deepEqual(
    ttsStatus.voices.map((entry) => entry.id),
    ["if_sara", "im_nicola"],
  );
});

test("school chat persists conversations and allows deletion", async (t) => {
  const { request } = loadRuntime(t);
  const conversation = {
    id: "class-experiment",
    title: "Prima prova",
    timestamp: 1,
    messages: [{ role: "user", content: "Ciao" }],
  };
  assert.equal(
    (await request("/api/llm/save-conversation", "POST", { conversation }))
      .status,
    200,
  );
  const saved = (await request("/api/llm/conversations")).body.conversations;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].messages[0].content, "Ciao");
  await request("/api/llm/delete-conversation", "POST", {
    id: conversation.id,
  });
  assert.equal(
    (await request("/api/llm/conversations")).body.conversations.length,
    0,
  );
});

test("text loading rejects diffusion and projector weights before launching a process", async (t) => {
  const { folder, runtime, spawns } = loadRuntime(t);
  for (const [filename, architecture] of [
    ["diffusion.gguf", "flux"],
    ["mmproj.gguf", "clip"],
  ]) {
    fs.writeFileSync(
      path.join(folder, "app/llm-models", filename),
      gguf(architecture),
    );
    await assert.rejects(
      runtime.startLlmWithBackend(
        { model: filename },
        { path: "unused", mode: "CPU" },
      ),
      /solo modelli di testo/,
    );
  }
  assert.equal(spawns.length, 0);
});

test("text loading clamps legacy GPU and long-context settings for 8 GB PCs", async (t) => {
  const { folder, runtime, spawns } = loadRuntime(t);
  fs.writeFileSync(
    path.join(folder, "app/llm-models", "lesson.gguf"),
    gguf("qwen2"),
  );
  await assert.rejects(
    runtime.startLlmWithBackend(
      {
        model: "lesson.gguf",
        contextSize: 32768,
        threads: 64,
        gpuLayers: -1,
        mlock: true,
      },
      { path: "test-llama", mode: "CPU" },
    ),
    /spawn intercepted/,
  );
  const args = spawns[0].args;
  const argument = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(argument("--ctx-size"), "2048");
  assert.equal(argument("--threads"), "4");
  assert.equal(argument("--n-gpu-layers"), "0");
  assert.equal(argument("--load-mode"), "mmap");
  assert.equal(args.includes("--mlock"), false);
});

test("text, transcription and voice share one work queue", async (t) => {
  const { runtime } = loadRuntime(t);
  const events = [];
  let release;
  const text = runtime.runExclusiveLlmOperation(async () => {
    events.push("text-start");
    await new Promise((resolve) => {
      release = resolve;
    });
    events.push("text-end");
  });
  const speech = runtime.runExclusiveSpeechOperation(async () => {
    events.push("speech");
  });
  const voice = runtime.runExclusiveTtsOperation(async () => {
    events.push("voice");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["text-start"]);
  release();
  await Promise.all([text, speech, voice]);
  assert.deepEqual(events, ["text-start", "text-end", "speech", "voice"]);
});
