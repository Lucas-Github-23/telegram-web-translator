// Background Service Worker para Telegram Web Translator (Google + Gemini AI)
const translationCache = new Map();
const MAX_CACHE_SIZE = 2000;

// Configurações em memória sincronizadas com chrome.storage
let currentConfig = {
  enabled: true,
  targetLang: 'pt',
  writeTargetLang: 'ru',
  modifierKey: 'Control',
  operationMode: 'hold',
  engine: 'google', // 'google' ou 'gemini'
  geminiApiKey: ''
};

// Carrega configurações iniciais
chrome.storage.sync.get(
  ['enabled', 'targetLang', 'writeTargetLang', 'modifierKey', 'operationMode', 'engine', 'geminiApiKey'],
  (data) => {
    Object.assign(currentConfig, data);
  }
);

// Atualiza configurações quando alteradas no popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    for (const key in changes) {
      currentConfig[key] = changes[key].newValue;
    }
  }
});

// Inicialização com configurações padrão ao instalar
chrome.runtime.onInstalled.addListener(async () => {
  chrome.storage.sync.get(
    ['enabled', 'targetLang', 'writeTargetLang', 'modifierKey', 'operationMode', 'engine', 'geminiApiKey'],
    (data) => {
      const defaults = {};
      if (data.enabled === undefined) defaults.enabled = true;
      if (data.targetLang === undefined) defaults.targetLang = 'pt';
      if (data.writeTargetLang === undefined) defaults.writeTargetLang = 'ru';
      if (data.modifierKey === undefined) defaults.modifierKey = 'Control';
      if (data.operationMode === undefined) defaults.operationMode = 'hold';
      if (data.engine === undefined) defaults.engine = 'google';
      if (data.geminiApiKey === undefined) defaults.geminiApiKey = '';

      if (Object.keys(defaults).length > 0) {
        chrome.storage.sync.set(defaults);
      }
    }
  );

  // Tenta injetar nas abas já abertas do Telegram Web
  try {
    const tabs = await chrome.tabs.query({ url: "*://web.telegram.org/*" });
    for (const tab of tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      }).catch(() => {});
      chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      }).catch(() => {});
    }
  } catch (e) {}
});

// Listener de mensagens do Content Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    handleTranslation(request.text, request.targetLang)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'translateDouble') {
    handleDoubleTranslation(request.text, request.targetLang, request.backLang)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'translateBatch') {
    handleBatchTranslation(request.items, request.targetLang)
      .then((results) => sendResponse({ success: true, data: results }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'clearCache') {
    translationCache.clear();
    sendResponse({ success: true });
    return true;
  }
});

const langNames = {
  pt: 'Portuguese (Brazil)',
  ru: 'Russian',
  en: 'English',
  es: 'Spanish',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  'zh-CN': 'Chinese (Simplified)',
  ko: 'Korean'
};

// Tradução principal (com suporte a Gemini e Google Translate)
async function handleTranslation(text, targetLang = 'pt') {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return { translatedText: text, detectedSourceLang: 'auto' };
  }

  const engine = currentConfig.engine || 'google';
  const apiKey = (currentConfig.geminiApiKey || '').trim();
  const cacheKey = `${engine}:${targetLang}:${trimmed}`;

  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  let result = null;

  // Se o motor for Gemini e houver chave configurada
  if (engine === 'gemini' && apiKey) {
    try {
      result = await translateWithGemini(trimmed, targetLang, apiKey);
    } catch (geminiError) {
      console.warn('[Hover Translator] Falha no Gemini AI, usando fallback Google:', geminiError.message);
      result = await translateWithGoogle(trimmed, targetLang);
    }
  } else {
    result = await translateWithGoogle(trimmed, targetLang);
  }

  // Armazena no cache LRU
  if (translationCache.size >= MAX_CACHE_SIZE) {
    const firstKey = translationCache.keys().next().value;
    translationCache.delete(firstKey);
  }
  translationCache.set(cacheKey, result);

  return result;
}

// Tradução via Gemini AI (Google Generative Language API)
async function translateWithGemini(text, targetLang, apiKey) {
  const targetName = langNames[targetLang] || targetLang;

  const prompt = `You are an expert real-time chat translator for Telegram.
Translate the following informal chat message into ${targetName}.
Rules:
1. Understand Russian/internet slang, abbreviations (e.g. "кст", "хз", "норм"), idioms, gaming terms, and informal nuances accurately.
2. Preserve all emojis, punctuation, capitalization, and emotional tone.
3. Output ONLY the translated message directly, without quotation marks, explanations, greetings, or extra markdown.

Message to translate:
${text}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens: 600
      }
    }),
    signal: controller.signal
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const candidate = data && data.candidates && data.candidates[0];
  const translated =
    candidate &&
    candidate.content &&
    candidate.content.parts &&
    candidate.content.parts[0] &&
    candidate.content.parts[0].text
      ? candidate.content.parts[0].text.trim()
      : '';

  if (!translated) {
    throw new Error('Gemini retornou resposta vazia.');
  }

  return {
    translatedText: translated,
    detectedSourceLang: 'auto'
  };
}

// Tradução via Google Translate clássico
async function translateWithGoogle(text, targetLang = 'pt', sourceLang = 'auto') {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: controller.signal
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`Google Translate HTTP ${response.status}`);
  }

  const data = await response.json();
  let translatedText = '';
  if (Array.isArray(data) && Array.isArray(data[0])) {
    translatedText = data[0].map((chunk) => (chunk && chunk[0] ? chunk[0] : '')).join('');
  }

  const detectedSourceLang = data && data[2] ? data[2] : 'auto';

  return {
    translatedText: translatedText || text,
    detectedSourceLang
  };
}

// Tradução dupla (Tradução direta + Retro-tradução garantida para o Português)
async function handleDoubleTranslation(text, targetLang = 'ru', backLang = 'pt') {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return { translatedText: '', backTranslatedText: '' };
  }

  // 1. Tradução para o idioma de envio
  const forwardResult = await handleTranslation(trimmed, targetLang);
  const translatedText = forwardResult.translatedText;

  // 2. Retradução para o Português (para conferência de sentido)
  let backTranslatedText = '';
  if (translatedText) {
    try {
      const engine = currentConfig.engine || 'google';
      const apiKey = (currentConfig.geminiApiKey || '').trim();

      if (engine === 'gemini' && apiKey) {
        const backResult = await translateWithGemini(translatedText, 'pt', apiKey);
        backTranslatedText = backResult.translatedText;
      } else {
        const backResult = await translateWithGoogle(translatedText, 'pt', targetLang);
        backTranslatedText = backResult.translatedText;
      }
    } catch (e) {
      console.warn('Falha na retro-tradução, usando Google fallback:', e);
      try {
        const backResult = await translateWithGoogle(translatedText, 'pt', targetLang);
        backTranslatedText = backResult.translatedText;
      } catch (err) {
        backTranslatedText = '';
      }
    }
  }

  return {
    translatedText,
    backTranslatedText: backTranslatedText || translatedText,
    detectedSourceLang: forwardResult.detectedSourceLang
  };
}

// Tradução em lote com controle de concorrência
async function handleBatchTranslation(items, targetLang = 'pt') {
  if (!Array.isArray(items)) return [];

  const results = [];
  const concurrency = 4;

  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const promises = chunk.map(async (item) => {
      try {
        const res = await handleTranslation(item.text, targetLang);
        return { id: item.id, ...res, success: true };
      } catch (err) {
        return { id: item.id, translatedText: item.text, success: false };
      }
    });

    const chunkResults = await Promise.all(promises);
    results.push(...chunkResults);
  }

  return results;
}
