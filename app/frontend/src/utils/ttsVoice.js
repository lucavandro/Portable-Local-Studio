import voices from "../config/tts-voices.json" with { type: "json" };

export const ITALIAN_VOICES = voices;
export const DEFAULT_TTS_VOICE = voices[0].id;

// Old browser preferences and saved English clips must not restore an unavailable voice.
export function normalizeTtsVoice(voice) {
  return voices.some((entry) => entry.id === voice) ? voice : DEFAULT_TTS_VOICE;
}
