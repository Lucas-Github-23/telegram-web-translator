// ==UserScript==
// @name         Telegram Web Translator
// @namespace    https://github.com/Lucas-Github-23/telegram-web-translator
// @version      0.1.0
// @description  Fast, native-feeling translator for Telegram Web.
// @match        https://web.telegram.org/*
// @grant        none
// ==/UserScript==

(() => {
  const DEFAULT_SETTINGS = {
    sourceLanguage: "auto",
    targetLanguage: "en",
    geminiModel: "gemini-1.5-flash",
    cacheTtlMs: 300000
  };

  const clean = (value) => `${value ?? ""}`.replace(/\s+/g, " ").trim();

  const createGeminiProvider = ({ apiKey, model, fetchImpl }) => {
    if (!apiKey) return null;

    return {
      name: "gemini",
      async translate(text, { from, to }) {
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
                      text: `Translate this text from ${from} to ${to}. Return only translated text with no explanation.\\n\\n${clean(text)}`
                    }
                  ]
                }
              ]
            })
          }
        );

        if (!response.ok) throw new Error(`Gemini request failed (${response.status})`);
        const payload = await response.json();
        const output = clean(payload?.candidates?.[0]?.content?.parts?.[0]?.text);
        if (!output) throw new Error("Gemini returned empty output");
        return output;
      }
    };
  };

  const createFallbackProvider = ({ fetchImpl }) => ({
    name: "fallback",
    async translate(text, { from, to }) {
      const response = await fetchImpl(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean(text))}&langpair=${encodeURIComponent(from)}|${encodeURIComponent(to)}`
      );

      if (!response.ok) throw new Error(`Fallback request failed (${response.status})`);
      const payload = await response.json();
      const output = clean(payload?.responseData?.translatedText);
      if (!output) throw new Error("Fallback returned empty output");
      return output;
    }
  });

  const createTranslator = ({ primaryProvider, fallbackProvider, cacheTtlMs }) => {
    const cache = new Map();
    const providers = [primaryProvider, fallbackProvider].filter(Boolean);

    const translate = async (text, { from, to }) => {
      const input = clean(text);
      if (!input) return "";
      const cacheKey = `${from}->${to}:${input}`;
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.value;

      let lastError = null;
      for (const provider of providers) {
        try {
          const result = clean(await provider.translate(input, { from, to }));
          if (!result) throw new Error("Empty translation");
          cache.set(cacheKey, { value: result, expiresAt: Date.now() + cacheTtlMs });
          return result;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError || new Error("Translation failed");
    };

    return {
      translate,
      async backTranslate(text, { source, target }) {
        const translated = await translate(text, { from: source, to: target });
        const backTranslated = await translate(translated, { from: target, to: source === "auto" ? "en" : source });
        return { translated, backTranslated };
      }
    };
  };

  const settings = {
    ...DEFAULT_SETTINGS,
    ...(window.TelegramWebTranslatorSettings || {})
  };

  const translator = createTranslator({
    primaryProvider: createGeminiProvider({
      apiKey: settings.geminiApiKey,
      model: settings.geminiModel,
      fetchImpl: window.fetch.bind(window)
    }),
    fallbackProvider: createFallbackProvider({ fetchImpl: window.fetch.bind(window) }),
    cacheTtlMs: settings.cacheTtlMs
  });

  const tooltip = document.createElement("div");
  tooltip.style.cssText = [
    "position:fixed",
    "display:none",
    "z-index:99999",
    "background:#1f1f24",
    "color:#fff",
    "padding:8px 10px",
    "border-radius:8px",
    "font-size:12px",
    "line-height:1.4",
    "max-width:360px",
    "box-shadow:0 8px 25px rgba(0,0,0,.25)",
    "pointer-events:none"
  ].join(";");
  document.body.appendChild(tooltip);

  let hoverToken = 0;

  const findMessageText = (node) => {
    if (!node || !(node instanceof Element)) return "";
    const holder = node.closest(".Message, .message, [class*='message'], [class*='bubble']");
    if (!holder) return "";
    const text = holder.querySelector(".text-content, .message-text, [class*='text']")?.innerText || holder.innerText;
    return clean(text);
  };

  const showTooltip = (x, y, text) => {
    tooltip.textContent = text;
    tooltip.style.left = `${Math.min(window.innerWidth - 380, x + 12)}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - 80, y + 12)}px`;
    tooltip.style.display = "block";
  };

  document.addEventListener("mousemove", async (event) => {
    const original = findMessageText(event.target);
    if (!original || original.length < 2) {
      tooltip.style.display = "none";
      return;
    }

    const current = ++hoverToken;
    try {
      const translated = await translator.translate(original, {
        from: settings.sourceLanguage,
        to: settings.targetLanguage
      });
      if (current !== hoverToken || !translated || translated === original) return;
      showTooltip(event.clientX, event.clientY, translated);
    } catch {
      tooltip.style.display = "none";
    }
  });

  let composer = null;
  let preview = null;
  let typingTimer = null;
  let composeToken = 0;

  const ensureComposerPreview = () => {
    composer = document.querySelector("div[contenteditable='true'][role='textbox'], div.input-message-input[contenteditable='true']");
    if (!composer || preview) return;

    preview = document.createElement("div");
    preview.style.cssText = [
      "margin-top:6px",
      "font-size:12px",
      "line-height:1.45",
      "opacity:.92"
    ].join(";");

    composer.parentElement?.appendChild(preview);
  };

  const updateTypingPreview = async () => {
    ensureComposerPreview();
    if (!composer || !preview) return;

    const input = clean(composer.innerText);
    if (!input) {
      preview.textContent = "";
      return;
    }

    const current = ++composeToken;

    try {
      const { translated, backTranslated } = await translator.backTranslate(input, {
        source: settings.sourceLanguage,
        target: settings.targetLanguage
      });

      if (current !== composeToken) return;
      preview.innerHTML = `<div><strong>Preview:</strong> ${translated}</div><div><strong>Back:</strong> ${backTranslated}</div>`;
    } catch {
      if (current !== composeToken) return;
      preview.textContent = "Translation unavailable";
    }
  };

  const onComposerInput = () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(updateTypingPreview, 250);
  };

  const observer = new MutationObserver(() => {
    ensureComposerPreview();
    if (!composer || composer.dataset.translatorBound === "1") return;

    composer.dataset.translatorBound = "1";
    composer.addEventListener("input", onComposerInput);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  ensureComposerPreview();
})();
