# telegram-web-translator

Fast, native-feeling translator for Telegram Web. Features:

- Hover translation of message bubbles
- Live typing preview with back-translation
- Gemini AI support (with fallback provider)

## Quick start

1. Create `window.TelegramWebTranslatorSettings` before script load (or inject at runtime):

```js
window.TelegramWebTranslatorSettings = {
  sourceLanguage: "auto",
  targetLanguage: "en",
  geminiApiKey: "YOUR_GEMINI_API_KEY", // optional
  geminiModel: "gemini-1.5-flash",
  cacheTtlMs: 300000
};
```

2. Load `/telegram-web-translator.user.js` in a userscript manager (or bundle/inject it in your Telegram Web setup).

## Development

- Run tests: `npm test`
