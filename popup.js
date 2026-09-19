// Popup Logic - Telegram Web Translator
document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggleEnabled');
  const modeSelector = document.getElementById('modeSelector');
  const modeCaption = document.getElementById('modeCaption');
  const targetLangSelect = document.getElementById('targetLangSelect');
  const writeTargetLangSelect = document.getElementById('writeTargetLangSelect');
  const keySelector = document.getElementById('keySelector');
  const btnTranslateScreen = document.getElementById('btnTranslateScreen');
  const btnRestoreAll = document.getElementById('btnRestoreAll');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const saveStatus = document.getElementById('saveStatus');

  const engineSelector = document.getElementById('engineSelector');
  const geminiSection = document.getElementById('geminiSection');
  const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
  const captions = {
    hold: 'Segure a tecla e passe o mouse. Soltou a tecla ou mouse, volta ao original.',
    toggle: 'Pressione a tecla para travar o tradutor. Passe o mouse nas mensagens. Pressione novamente para desativar.'
  };

  // Carrega configurações salvas
  chrome.storage.sync.get(['enabled', 'targetLang', 'writeTargetLang', 'modifierKey', 'operationMode', 'engine', 'geminiApiKey'], (data) => {
    const isEnabled = data.enabled !== undefined ? data.enabled : true;
    const lang = data.targetLang || 'pt';
    const writeLang = data.writeTargetLang || 'ru';
    const key = data.modifierKey || 'Control';
    const mode = data.operationMode || 'hold';
    const engine = data.engine || 'google';
    const geminiKey = data.geminiApiKey || '';

    toggleEnabled.checked = isEnabled;
    targetLangSelect.value = lang;
    writeTargetLangSelect.value = writeLang;
    geminiApiKeyInput.value = geminiKey;

    updateSegmentActive(modeSelector, mode, 'mode');
    updateSegmentActive(keySelector, key, 'key');
    updateSegmentActive(engineSelector, engine, 'engine');
    modeCaption.textContent = captions[mode] || captions.hold;

    // Exibe ou oculta seção do Gemini
    geminiSection.style.display = (engine === 'gemini') ? 'block' : 'none';
  });

  // Toggle geral (Ativar / Desativar)
  toggleEnabled.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: toggleEnabled.checked }, notifySaved);
  });

  // Motor de Tradução (Google vs Gemini IA)
  engineSelector.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment');
    if (!btn) return;

    const engine = btn.dataset.engine;
    updateSegmentActive(engineSelector, engine, 'engine');
    geminiSection.style.display = (engine === 'gemini') ? 'block' : 'none';
    chrome.storage.sync.set({ engine }, notifySaved);
  });

  // Chave de API do Gemini
  geminiApiKeyInput.addEventListener('input', () => {
    chrome.storage.sync.set({ geminiApiKey: geminiApiKeyInput.value.trim() }, notifySaved);
  });

  // Modo de Operação (Hold vs Toggle)
  modeSelector.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment');
    if (!btn) return;

    const mode = btn.dataset.mode;
    updateSegmentActive(modeSelector, mode, 'mode');
    modeCaption.textContent = captions[mode] || captions.hold;
    chrome.storage.sync.set({ operationMode: mode }, notifySaved);
  });

  // Idioma de Leitura (Mensagens Recebidas)
  targetLangSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ targetLang: targetLangSelect.value }, notifySaved);
  });

  // Idioma de Envio (O que o usuário digita)
  writeTargetLangSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ writeTargetLang: writeTargetLangSelect.value }, notifySaved);
  });

  // Tecla Modificadora
  keySelector.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment');
    if (!btn) return;

    const key = btn.dataset.key;
    updateSegmentActive(keySelector, key, 'key');
    chrome.storage.sync.set({ modifierKey: key }, notifySaved);
  });

  // Traduzir mensagens da tela atual
  btnTranslateScreen.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'toggleScreenTranslation' }, (res) => {
        if (chrome.runtime.lastError) {
          saveStatus.textContent = 'Abra o Telegram Web';
        } else {
          window.close(); // Fecha popup para o usuário ver a tela traduzindo
        }
      });
    }
  });

  // Restaurar mensagens
  btnRestoreAll.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'restoreAll' }, () => {
        saveStatus.textContent = 'Restaurado';
        setTimeout(() => { saveStatus.textContent = 'Pronto'; }, 1500);
      });
    }
  });

  // Limpar Cache
  clearCacheBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clearCache' }, () => {
      saveStatus.textContent = 'Cache limpo';
      setTimeout(() => { saveStatus.textContent = 'Pronto'; }, 1500);
    });
  });

  function updateSegmentActive(container, activeValue, dataAttr) {
    const buttons = container.querySelectorAll('.segment');
    buttons.forEach((btn) => {
      if (btn.dataset[dataAttr] === activeValue) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  let saveTimeout;
  function notifySaved() {
    saveStatus.textContent = 'Salvo';
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      saveStatus.textContent = 'Pronto';
    }, 1200);
  }
});
