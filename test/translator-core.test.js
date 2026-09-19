import test from "node:test";
import assert from "node:assert/strict";

import { createGeminiProvider, createTranslator } from "../src/translator-core.js";

test("gemini provider sends model request and parses text", async () => {
  let requestedUrl = "";
  let requestedBody = "";

  const provider = createGeminiProvider({
    apiKey: "abc123",
    model: "gemini-custom",
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedBody = options.body;
      return {
        ok: true,
        async json() {
          return { candidates: [{ content: { parts: [{ text: "Hola" }] } }] };
        }
      };
    }
  });

  const result = await provider.translate("Hello", { from: "en", to: "es" });
  assert.equal(result, "Hola");
  assert.match(requestedUrl, /gemini-custom:generateContent\?key=abc123$/);
  assert.match(requestedBody, /Translate this text from en to es/);
});

test("translator falls back when primary provider fails", async () => {
  const translator = createTranslator({
    primaryProvider: {
      name: "broken",
      async translate() {
        throw new Error("primary failed");
      }
    },
    fallbackProvider: {
      name: "ok",
      async translate(text) {
        return `${text} translated`;
      }
    }
  });

  const result = await translator.translate("test", { from: "en", to: "fr" });
  assert.equal(result, "test translated");
});

test("translator caches repeated requests", async () => {
  let calls = 0;
  const translator = createTranslator({
    primaryProvider: {
      name: "counter",
      async translate(text) {
        calls += 1;
        return `${text}-x`;
      }
    }
  });

  const one = await translator.translate("cache me", { from: "en", to: "de" });
  const two = await translator.translate("cache me", { from: "en", to: "de" });

  assert.equal(one, "cache me-x");
  assert.equal(two, "cache me-x");
  assert.equal(calls, 1);
});
