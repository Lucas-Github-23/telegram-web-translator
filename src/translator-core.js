export const DEFAULT_SETTINGS = {
  sourceLanguage: "auto",
  targetLanguage: "en",
  geminiModel: "gemini-1.5-flash",
  cacheTtlMs: 300000
};

const clean = (value) => `${value ?? ""}`.replace(/\s+/g, " ").trim();

export function createGeminiProvider({ apiKey, model = DEFAULT_SETTINGS.geminiModel, fetchImpl = fetch } = {}) {
  if (!apiKey) {
    return null;
  }

  return {
    name: "gemini",
    async translate(text, { from, to }) {
      const input = clean(text);
      if (!input) return "";

      const response = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Translate this text from ${from} to ${to}. Return only translated text with no explanation.\\n\\n${input}`
                  }
                ]
              }
            ]
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini request failed (${response.status})`);
      }

      const payload = await response.json();
      const output = clean(payload?.candidates?.[0]?.content?.parts?.[0]?.text);
      if (!output) {
        throw new Error("Gemini returned empty output");
      }
      return output;
    }
  };
}

export function createFallbackProvider({ fetchImpl = fetch } = {}) {
  return {
    name: "fallback",
    async translate(text, { from, to }) {
      const input = clean(text);
      if (!input) return "";

      const response = await fetchImpl(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(input)}&langpair=${encodeURIComponent(from)}|${encodeURIComponent(to)}`
      );

      if (!response.ok) {
        throw new Error(`Fallback request failed (${response.status})`);
      }

      const payload = await response.json();
      const output = clean(payload?.responseData?.translatedText);
      if (!output) {
        throw new Error("Fallback returned empty output");
      }
      return output;
    }
  };
}

export function createTranslator({ primaryProvider, fallbackProvider, cacheTtlMs = DEFAULT_SETTINGS.cacheTtlMs } = {}) {
  const cache = new Map();

  const readFromCache = (key) => {
    const cached = cache.get(key);
    if (!cached) return null;
    if (cached.expiresAt < Date.now()) {
      cache.delete(key);
      return null;
    }
    return cached.value;
  };

  const writeToCache = (key, value) => {
    cache.set(key, { value, expiresAt: Date.now() + cacheTtlMs });
  };

  const translate = async (text, { from = DEFAULT_SETTINGS.sourceLanguage, to = DEFAULT_SETTINGS.targetLanguage } = {}) => {
    const input = clean(text);
    if (!input) return "";

    const cacheKey = `${from}->${to}:${input}`;
    const cached = readFromCache(cacheKey);
    if (cached !== null) return cached;

    const providers = [primaryProvider, fallbackProvider].filter(Boolean);
    if (!providers.length) {
      throw new Error("No translation provider is configured");
    }

    let lastError = null;
    for (const provider of providers) {
      try {
        const value = clean(await provider.translate(input, { from, to }));
        if (!value) {
          throw new Error(`${provider.name || "provider"} returned empty output`);
        }
        writeToCache(cacheKey, value);
        return value;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Translation failed");
  };

  const backTranslate = async (text, { source = DEFAULT_SETTINGS.sourceLanguage, target = DEFAULT_SETTINGS.targetLanguage } = {}) => {
    const translated = await translate(text, { from: source, to: target });
    const backTranslated = await translate(translated, { from: target, to: source === "auto" ? "en" : source });

    return { translated, backTranslated };
  };

  return {
    translate,
    backTranslate,
    _cacheSize: () => cache.size
  };
}
