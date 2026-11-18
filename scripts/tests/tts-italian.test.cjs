const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const load = (file) => import(pathToFileURL(path.join(root, file)).href);

test("Italian voice preferences preserve Nicola and migrate old English voices to Sara", async () => {
  const { normalizeTtsVoice, ITALIAN_VOICES } = await load(
    "app/frontend/src/utils/ttsVoice.js",
  );
  assert.deepEqual(
    ITALIAN_VOICES.map((voice) => voice.id),
    ["if_sara", "im_nicola"],
  );
  assert.equal(
    ITALIAN_VOICES.every((voice) => voice.language === "it-IT"),
    true,
  );
  assert.equal(normalizeTtsVoice("im_nicola"), "im_nicola");
  assert.equal(normalizeTtsVoice("if_sara"), "if_sara");
  for (const value of [undefined, "", "af_heart", "bm_george", "unavailable"]) {
    assert.equal(normalizeTtsVoice(value), "if_sara");
  }
});

test("Italian phonemization selects Italian, preserves punctuation and compacts affricates", async () => {
  const { phonemizeItalian } = await load("scripts/workers/tts-italian.mjs");
  const languages = [];
  const espeak = {
    set_voice(language) {
      languages.push(language);
    },
    synthesize_ipa(text) {
      return {
        code: 0,
        ipa: text.includes("Ciao") ? "tʃ_ˈa_o\n" : "r_a_ɡ_ˈa_tsː_ɪ\n",
      };
    },
  };
  assert.equal(phonemizeItalian("Ciao, ragazzi!", espeak), "ʧˈao,raɡˈaʦːɪ!");
  assert.deepEqual(languages, ["it"]);
});

test("Italian generation passes Italian phoneme tokens directly to the local model", async () => {
  const { generateItalianAudio } = await load(
    "scripts/workers/tts-italian.mjs",
  );
  const inputIds = { dims: [1, 12] };
  const audio = { sampling_rate: 24000 };
  let received;
  const tts = {
    tokenizer(phonemes, options) {
      assert.equal(phonemes, "ʧˈao.");
      assert.equal(options.truncation, false);
      return { input_ids: inputIds };
    },
    generate() {
      throw new Error("English text generation must not be used");
    },
    async generate_from_ids(ids, options) {
      received = { ids, options };
      return audio;
    },
  };
  const espeak = {
    set_voice(language) {
      assert.equal(language, "it");
    },
    synthesize_ipa() {
      return { code: 0, ipa: "tʃ_ˈa_o" };
    },
  };
  assert.equal(
    await generateItalianAudio(tts, espeak, "Ciao.", {
      voice: "im_nicola",
      speed: 1.2,
    }),
    audio,
  );
  assert.equal(received.ids, inputIds);
  assert.deepEqual(received.options, { voice: "im_nicola", speed: 1.2 });
});

test("Italian synthesis reports failed pronunciation and refuses silent token truncation", async () => {
  const { phonemizeItalian, generateItalianAudio } = await load(
    "scripts/workers/tts-italian.mjs",
  );
  const failed = {
    set_voice() {},
    synthesize_ipa() {
      return { code: 1, ipa: "" };
    },
  };
  assert.throws(() => phonemizeItalian("Ciao", failed), /pronuncia italiana/);
  const espeak = {
    set_voice() {},
    synthesize_ipa() {
      return { code: 0, ipa: "ˈa" };
    },
  };
  const tts = {
    tokenizer() {
      return { input_ids: { dims: [1, 513] } };
    },
    generate_from_ids() {
      assert.fail("Overlong text must not reach synthesis");
    },
  };
  await assert.rejects(
    generateItalianAudio(tts, espeak, "Testo", { voice: "if_sara" }),
    /frase è troppo lunga/,
  );
});

test("Italian pronunciation receives decimal numbers intact", async () => {
  const { phonemizeItalian } = await load("scripts/workers/tts-italian.mjs");
  const fragments = [];
  const espeak = { set_voice() {}, synthesize_ipa(text) { fragments.push(text); return { code: 0, ipa: "ˈa" }; } };
  phonemizeItalian("Il valore è 3,14. La versione è 1.5!", espeak);
  assert.equal(fragments.some(text => text.includes("3,14")), true);
  assert.equal(fragments.some(text => text.includes("1.5")), true);
});
