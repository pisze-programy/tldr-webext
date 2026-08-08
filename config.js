const CONFIG = {
  API_URL: "https://api.deepseek.com/chat/completions",
  MODEL: "deepseek/deepseek-v4-flash",
  MAX_CHARS: 24000,
  TEMPERATURE: { summary: 0.2, relaxed: 0.0, fast: 0.2 },
  MAX_TOKENS: { summary: 1024, relaxed: 2048, fast: 2048 },
  FAST_WORD_RATIO: 0.18,
  FAST_WORD_MIN: 90,
  FAST_WORD_MAX: 550,
  PHRASE_PER_WORDS: 100,
  PHRASE_MIN: 6,
  PHRASE_MAX: 20
};
