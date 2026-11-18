// Kokoro's Italian voice weights use compact IPA affricates. eSpeak supplies
// pronunciation locally; kokoro-js supplies the tokenizer and the ONNX CPU model.
export function phonemizeItalian(text, espeak) {
  espeak.set_voice("it");
  return text
    .normalize("NFC")
    .split(/((?<!\d)[,.:]|[,.:](?!\d)|[;!?…()«»“”]+)/u)
    .map((part) => {
      if (!part.trim() || /^[;:,.!?…()«»“”]+$/u.test(part)) return part;
      const result = espeak.synthesize_ipa(part);
      if (result.code !== 0 || !result.ipa?.trim()) {
        throw new Error(
          "Impossibile ricavare la pronuncia italiana del testo.",
        );
      }
      return result.ipa.replaceAll("_", "").replaceAll("\n", " ").trim();
    })
    .join("")
    .replaceAll("tʃ", "ʧ")
    .replaceAll("dʒ", "ʤ")
    .replaceAll("ts", "ʦ")
    .replaceAll("dz", "ʣ")
    .replace(/[\u0361\u035c]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export async function generateItalianAudio(tts, espeak, text, options) {
  const phonemes = phonemizeItalian(text, espeak);
  const { input_ids } = tts.tokenizer(phonemes, { truncation: false });
  if (input_ids.dims.at(-1) > 512) {
    throw new Error(
      "La frase è troppo lunga per la sintesi vocale. Dividila in frasi più brevi.",
    );
  }
  return tts.generate_from_ids(input_ids, options);
}
