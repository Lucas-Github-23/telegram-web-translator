/**
 * Telegram Web Translator - Content Script
 * - Tradução de leitura no hover (mensagens e respostas/citações) com suporte total a emojis
 * - Tradução instantânea ao digitar com retro-tradução de conferência
 * - Ajuste automático de padding no chat para nunca sobrepor a mensagem mais recente
 * - Fechamento automático imediato ao enviar a mensagem (Enter ou botão de envio)
 */

(function () {
  'use strict';

  // Configurações
  let settings = {
    enabled: true,
    targetLang: 'pt',
    writeTargetLang: 'ru',
    modifierKey: 'Control',
    operationMode: 'hold' // 'hold' ou 'toggle'
  };

  // Estados de controle
  let isHoldActive = false;
  let isToggleActive = false;
  let isScreenTranslated = false;
  let currentHoveredElement = null;
  const activeTranslations = new Map();
  const localCache = new Map();
  let requestCounter = 0;
  let toastElement = null;
  let toastTimeout = null;

  // Estados da tradução em tempo real
  let liveBoxElement = null;
  let liveDebounceTimer = null;
  let currentLiveState = null;
  let inputMutationObserver = null;
  let observedInputElement = null;

  // Remove resquícios de botões antigos
  function removeOldInjectedButtons() {
    const oldBtn = document.getElementById('tg-trans-input-btn');
    if (oldBtn) oldBtn.remove();
  }
  removeOldInjectedButtons();

  // Carrega configurações salvas
  chrome.storage.sync.get(
    ['enabled', 'targetLang', 'writeTargetLang', 'modifierKey', 'operationMode'],
    (data) => {
      if (data.enabled !== undefined) settings.enabled = data.enabled;
      if (data.targetLang !== undefined) settings.targetLang = data.targetLang;
      if (data.writeTargetLang !== undefined) settings.writeTargetLang = data.writeTargetLang;
      if (data.modifierKey !== undefined) settings.modifierKey = data.modifierKey;
      if (data.operationMode !== undefined) settings.operationMode = data.operationMode;
    }
  );

  // Atualizações dinâmicas via storage
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.enabled) {
        settings.enabled = changes.enabled.newValue;
        if (!settings.enabled) {
          restoreAll();
          hideLiveTranslationBox();
        }
      }
      if (changes.targetLang) {
        settings.targetLang = changes.targetLang.newValue;
        localCache.clear();
      }
      if (changes.writeTargetLang) {
        settings.writeTargetLang = changes.writeTargetLang.newValue;
      }
      if (changes.modifierKey) {
        settings.modifierKey = changes.modifierKey.newValue;
      }
      if (changes.operationMode) {
        settings.operationMode = changes.operationMode.newValue;
        if (isToggleActive) {
          isToggleActive = false;
          hideToast();
          restoreAll();
        }
      }
    }
  });

  // Listener para comandos do Popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'toggleScreenTranslation') {
      toggleScreenTranslation();
      sendResponse({ isScreenTranslated });
    } else if (msg.action === 'restoreAll') {
      restoreAll();
      sendResponse({ success: true });
    }
    return true;
  });

  function isKeyMatch(e) {
    if (settings.modifierKey === 'Control') return e.key === 'Control';
    if (settings.modifierKey === 'Alt') return e.key === 'Alt';
    if (settings.modifierKey === 'Shift') return e.key === 'Shift';
    return false;
  }

  function isMouseModifierActive(e) {
    if (settings.modifierKey === 'Control') return e.ctrlKey || isHoldActive;
    if (settings.modifierKey === 'Alt') return e.altKey || isHoldActive;
    if (settings.modifierKey === 'Shift') return e.shiftKey || isHoldActive;
    return isHoldActive;
  }

  // Toast discreto no canto superior direito
  function showToast(text, duration = 0) {
    if (!toastElement) {
      toastElement = document.createElement('div');
      toastElement.className = 'tg-trans-toast';
      document.body.appendChild(toastElement);
    }

    toastElement.innerHTML = `<span class="tg-trans-toast-dot"></span><span>${text}</span>`;
    toastElement.classList.remove('hiding');

    clearTimeout(toastTimeout);
    if (duration > 0) {
      toastTimeout = setTimeout(() => {
        hideToast();
      }, duration);
    }
  }

  function hideToast() {
    if (toastElement) {
      toastElement.classList.add('hiding');
      setTimeout(() => {
        if (toastElement && toastElement.classList.contains('hiding')) {
          toastElement.remove();
          toastElement = null;
        }
      }, 250);
    }
  }

  // Extrai texto limpo preservando todos os emojis (converte tags de imagem do Telegram em Unicode)
  function extractCleanText(el) {
    if (!el) return '';

    const state = activeTranslations.get(el);
    if (state && state.originalText) {
      return state.originalText;
    }

    const clone = el.cloneNode(true);

    clone
      .querySelectorAll(
        '.time, .message-time, .name, .reply-title, .reply-sender, .peer-title, .tg-trans-wrapper'
      )
      .forEach((n) => n.remove());

    clone.querySelectorAll('img, .emoji, [data-emoji], [data-alt]').forEach((node) => {
      const emojiChar =
        node.getAttribute('alt') ||
        node.getAttribute('data-emoji') ||
        node.getAttribute('data-alt') ||
        node.getAttribute('title') ||
        node.innerText ||
        '';
      if (emojiChar) {
        node.replaceWith(document.createTextNode(emojiChar));
      }
    });

    let text = clone.innerText ? clone.innerText.trim() : (clone.textContent ? clone.textContent.trim() : '');
    text = text.replace(/(\s*PT)+$/g, '').trim();
    return text;
  }

  // Localiza o texto específico de uma citação/resposta
  function getReplyTextElement(bubbleOrReply) {
    if (!bubbleOrReply) return null;

    const replyBox = bubbleOrReply.closest
      ? bubbleOrReply.closest('.reply, .reply-content, .reply-preview, .reply-container') ||
        bubbleOrReply.querySelector('.reply, .reply-content, .reply-preview, .reply-container')
      : null;

    if (!replyBox) return null;

    const direct = replyBox.querySelector('.reply-subtitle, .reply-text, .reply-message, .subtitle');
    if (direct && extractCleanText(direct).length > 1) {
      return direct;
    }

    const candidates = Array.from(replyBox.querySelectorAll('div, span, p')).filter((el) => {
      if (
        el.matches('.reply-title, .name, .reply-sender, .peer-title, .avatar, .photo, img, svg, i') ||
        el.closest('.reply-title, .name, .reply-sender, .peer-title')
      ) {
        return false;
      }
      if (el.querySelector('.reply-title, .name, .reply-sender, .peer-title')) {
        return false;
      }
      const txt = extractCleanText(el);
      return txt.length > 1;
    });

    if (candidates.length > 0) {
      return candidates[candidates.length - 1];
    }

    return null;
  }

  // Localiza o container estrito de texto a ser traduzido
  function findMessageTextElement(target) {
    if (!target || !(target instanceof Element)) return null;

    if (
      target.closest(
        '.time, .message-time, .Avatar, .avatar, .reactions, .Reactions, .reply-title, .reply-sender, .name, .ContextMenu, .media-container, .audio-player'
      )
    ) {
      return null;
    }

    // 1. Se o cursor está diretamente sobre a caixa de citação
    const replyBox = target.closest('.reply, .reply-preview, .reply-content, .reply-container');
    if (replyBox) {
      const replyText = getReplyTextElement(replyBox);
      if (replyText) return replyText;
    }

    // 2. Elementos específicos de texto puro da mensagem
    const translatable = target.closest('.translatable-message');
    if (translatable) return translatable;

    const textContent = target.closest('.text-content, .message-text');
    if (textContent) return textContent;

    // 3. Se estiver dentro do balão de mensagem
    const bubble = target.closest('.bubble, .Message');
    if (bubble) {
      const pure = bubble.querySelector('.translatable-message, .text-content, .message-text');
      if (pure && (pure === target || pure.contains(target))) {
        return pure;
      }

      const msg = bubble.querySelector('.message[dir], .message');
      if (msg && (msg === target || msg.contains(target))) {
        const innerPure = msg.querySelector('.translatable-message, .text-content');
        return innerPure || msg;
      }
    }

    return null;
  }

  // Localiza todas as mensagens e citações visíveis na tela
  function getAllVisibleMessageElements() {
    const elements = [];

    const pureElements = Array.from(
      document.querySelectorAll('.translatable-message, .text-content, .message-text')
    ).filter((el) => {
      if (el.closest('.time, .message-time, .reply, .reply-preview, .name, .Avatar, .reactions')) {
        return false;
      }
      return el.offsetParent !== null && extractCleanText(el).length > 1;
    });

    if (pureElements.length > 0) {
      elements.push(...pureElements);
    } else {
      const fallback = Array.from(document.querySelectorAll('.bubble .message, .Message .message')).filter((el) => {
        if (el.closest('.time, .reply, .name, .Avatar')) return false;
        return el.offsetParent !== null && extractCleanText(el).length > 1;
      });
      elements.push(...fallback);
    }

    const replyBoxes = Array.from(
      document.querySelectorAll('.reply, .reply-preview, .reply-content, .reply-container')
    );
    for (const box of replyBoxes) {
      if (box.offsetParent === null) continue;
      const replyText = getReplyTextElement(box);
      if (replyText && !elements.includes(replyText) && extractCleanText(replyText).length > 1) {
        elements.push(replyText);
      }
    }

    return elements;
  }

  // Inicia tradução de um elemento de leitura
  function translateElement(el, isBatch = false) {
    if (!settings.enabled || !el) return;

    const rawText = extractCleanText(el);
    if (!rawText || rawText.length < 2) return;

    if (!isBatch) {
      const bubble = el.closest('.bubble, .Message');
      if (bubble) {
        const replyTextEl = getReplyTextElement(bubble);
        if (replyTextEl && replyTextEl !== el && !activeTranslations.has(replyTextEl)) {
          translateElement(replyTextEl, isBatch);
        }
      }
    }

    if (activeTranslations.has(el)) return;

    const reqId = ++requestCounter;
    const state = {
      originalHTML: el.innerHTML,
      hiddenWrapper: null,
      transWrapper: null,
      requestId: reqId,
      originalText: rawText,
      isBatch
    };
    activeTranslations.set(el, state);

    const cacheKey = `${settings.targetLang}:${rawText}`;
    if (localCache.has(cacheKey)) {
      const cached = localCache.get(cacheKey);
      applyTranslation(el, cached.translatedText);
      return;
    }

    el.classList.add('tg-trans-loading');

    chrome.runtime.sendMessage(
      {
        action: 'translate',
        text: rawText,
        targetLang: settings.targetLang
      },
      (response) => {
        if (!activeTranslations.has(el) || activeTranslations.get(el).requestId !== reqId) {
          if (response && response.success && response.data) {
            localCache.set(cacheKey, response.data);
          }
          return;
        }

        el.classList.remove('tg-trans-loading');

        if (response && response.success && response.data) {
          localCache.set(cacheKey, response.data);

          const shouldApply =
            isBatch ||
            (settings.operationMode === 'toggle' && isToggleActive) ||
            (settings.operationMode === 'hold' && isHoldActive);

          if (shouldApply) {
            applyTranslation(el, response.data.translatedText);
          } else {
            restoreElement(el);
          }
        } else {
          restoreElement(el);
        }
      }
    );
  }

  // Aplica o texto traduzido sem afetar timestamps ou autores
  function applyTranslation(el, translatedText) {
    const state = activeTranslations.get(el);
    if (!state) return;

    el.classList.remove('tg-trans-loading');

    if (!state.hiddenWrapper) {
      const wrapper = document.createElement('span');
      wrapper.className = 'tg-trans-hidden-nodes';
      wrapper.style.display = 'none';

      const nodesToHide = [];
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const isMeta =
            child.classList.contains('time') ||
            child.classList.contains('message-time') ||
            child.classList.contains('reply') ||
            child.classList.contains('reply-preview') ||
            child.classList.contains('reply-content');
          if (isMeta) continue;
        }
        nodesToHide.push(child);
      }

      nodesToHide.forEach((n) => wrapper.appendChild(n));
      el.insertBefore(wrapper, el.firstChild);
      state.hiddenWrapper = wrapper;
    }

    if (state.transWrapper) {
      state.transWrapper.remove();
    }

    const wrapper = document.createElement('span');
    wrapper.className = 'tg-trans-wrapper';
    wrapper.textContent = translatedText;

    const timeNode = el.querySelector('.time, .message-time');
    if (timeNode && timeNode.parentElement === el) {
      el.insertBefore(wrapper, timeNode);
    } else {
      el.appendChild(wrapper);
    }

    state.transWrapper = wrapper;
  }

  // Restaura o elemento ao estado original
  function restoreElement(el) {
    if (!el || !activeTranslations.has(el)) return;

    const state = activeTranslations.get(el);
    el.classList.remove('tg-trans-loading');

    if (state.transWrapper) {
      state.transWrapper.remove();
      state.transWrapper = null;
    }

    if (state.hiddenWrapper) {
      while (state.hiddenWrapper.firstChild) {
        el.insertBefore(state.hiddenWrapper.firstChild, state.hiddenWrapper);
      }
      state.hiddenWrapper.remove();
      state.hiddenWrapper = null;
    } else if (state.originalHTML) {
      el.innerHTML = state.originalHTML;
    }

    activeTranslations.delete(el);
  }

  function restoreAll() {
    isScreenTranslated = false;
    for (const el of Array.from(activeTranslations.keys())) {
      restoreElement(el);
    }
  }

  function restoreHoverTranslations() {
    for (const [el, state] of Array.from(activeTranslations.entries())) {
      if (!state.isBatch) {
        restoreElement(el);
      }
    }
  }

  // Tradução da tela inteira (Alt + T)
  function toggleScreenTranslation() {
    if (isScreenTranslated) {
      restoreAll();
      showToast('Mensagens restauradas ao original', 1800);
      return;
    }

    const elements = getAllVisibleMessageElements();

    if (elements.length === 0) {
      showToast('Nenhuma mensagem de texto visível encontrada', 2000);
      return;
    }

    showToast(`Traduzindo ${elements.length} mensagens...`, 0);

    const itemsToFetch = [];
    elements.forEach((el, index) => {
      const text = extractCleanText(el);
      const cacheKey = `${settings.targetLang}:${text}`;

      if (localCache.has(cacheKey)) {
        const cached = localCache.get(cacheKey);
        activeTranslations.set(el, {
          originalHTML: el.innerHTML,
          hiddenWrapper: null,
          transWrapper: null,
          requestId: ++requestCounter,
          originalText: text,
          isBatch: true
        });
        applyTranslation(el, cached.translatedText);
      } else {
        itemsToFetch.push({ id: index, el, text });
        el.classList.add('tg-trans-loading');
      }
    });

    if (itemsToFetch.length === 0) {
      isScreenTranslated = true;
      showToast(`${elements.length} mensagens traduzidas • Alt+T para restaurar`, 3000);
      return;
    }

    chrome.runtime.sendMessage(
      {
        action: 'translateBatch',
        items: itemsToFetch.map((i) => ({ id: i.id, text: i.text })),
        targetLang: settings.targetLang
      },
      (response) => {
        itemsToFetch.forEach((item) => {
          item.el.classList.remove('tg-trans-loading');
        });

        if (response && response.success && Array.isArray(response.data)) {
          response.data.forEach((res) => {
            const item = itemsToFetch.find((i) => i.id === res.id);
            if (item && item.el) {
              const cacheKey = `${settings.targetLang}:${item.text}`;
              localCache.set(cacheKey, {
                translatedText: res.translatedText,
                detectedSourceLang: res.detectedSourceLang
              });

              activeTranslations.set(item.el, {
                originalHTML: item.el.innerHTML,
                hiddenWrapper: null,
                transWrapper: null,
                requestId: ++requestCounter,
                originalText: item.text,
                isBatch: true
              });

              applyTranslation(item.el, res.translatedText);
            }
          });

          isScreenTranslated = true;
          showToast(`${elements.length} mensagens traduzidas • Alt+T para restaurar`, 3000);
        } else {
          showToast('Falha ao traduzir algumas mensagens', 2500);
        }
      }
    );
  }

  // =========================================================================
  // TRADUÇÃO INSTANTÂNEA AO DIGITAR + RETRO-TRADUÇÃO + PREVENÇÃO DE OVERLAP
  // =========================================================================

  function getActiveMessageInput() {
    const active = document.activeElement;
    if (
      active &&
      (active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')
    ) {
      return active;
    }

    const candidate = document.querySelector(
      '.input-message-input[contenteditable="true"], #editable-message-text[contenteditable="true"], .chat-input-main [contenteditable="true"], div[contenteditable="true"][data-placeholder], .input-field-input'
    );
    return candidate;
  }

  // Ajusta o padding inferior do container de mensagens para empurrar a mensagem mais recente para cima do dock
  function adjustChatPadding(open) {
    const chatContainer = document.querySelector(
      '.bubbles, .messages-container, .MessageList, .chat-list-messages, .history, .messages-layout'
    );
    if (chatContainer) {
      if (open) {
        chatContainer.style.paddingBottom = '78px';
        // Suavemente garante que a última mensagem role para o topo do dock
        chatContainer.scrollTop = chatContainer.scrollHeight;
      } else {
        chatContainer.style.paddingBottom = '';
      }
    }
  }

  // Observa quando o input é esvaziado pelo Telegram (ex: ao enviar a mensagem com Enter ou clique)
  function setupInputObserver(inputEl) {
    if (observedInputElement === inputEl) return;
    if (inputMutationObserver) {
      inputMutationObserver.disconnect();
    }

    observedInputElement = inputEl;
    inputMutationObserver = new MutationObserver(() => {
      const currentText = extractCleanText(inputEl);
      if (currentText.length < 2) {
        hideLiveTranslationBox();
      }
    });

    inputMutationObserver.observe(inputEl, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  // Aplica o texto traduzido no campo de mensagem
  function applyLiveTranslation(inputEl, textToInsert) {
    if (!inputEl) inputEl = getActiveMessageInput();
    if (!inputEl || !textToInsert) return;

    inputEl.focus();

    if (inputEl.isContentEditable) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      selection.removeAllRanges();
      selection.addRange(range);

      const inserted = document.execCommand('insertText', false, textToInsert);
      if (!inserted) {
        inputEl.textContent = textToInsert;
      }
    } else {
      inputEl.value = textToInsert;
    }

    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));

    hideLiveTranslationBox();
    showToast(`Texto aplicado • Pressione Enter para enviar`, 2000);
  }

  // Renderiza o dock flutuante ancorado com precisão acima da barra de mensagem
  function renderLiveTranslationBox(inputEl, translatedText, backTranslatedText, targetLang) {
    if (!liveBoxElement) {
      liveBoxElement = document.createElement('div');
      liveBoxElement.className = 'tg-live-box';
      document.body.appendChild(liveBoxElement);
    }

    currentLiveState = {
      inputEl,
      translatedText,
      backTranslatedText,
      targetLang
    };

    setupInputObserver(inputEl);

    const rect = inputEl.getBoundingClientRect();
    const boxWidth = Math.min(Math.max(rect.width, 300), 620);

    // Posiciona exatamente ancorado acima da barra de input
    const bottomPos = Math.max(10, window.innerHeight - rect.top + 6);
    const leftPos = Math.max(10, rect.left);

    liveBoxElement.style.bottom = `${bottomPos}px`;
    liveBoxElement.style.top = 'auto';
    liveBoxElement.style.left = `${leftPos}px`;
    liveBoxElement.style.width = `${boxWidth}px`;

    liveBoxElement.innerHTML = `
      <div class="tg-live-top-row">
        <div class="tg-live-main-content">
          <span class="tg-live-lang-tag">${targetLang.toUpperCase()}</span>
          <span class="tg-live-main-text">${escapeHtml(translatedText)}</span>
        </div>
        <div class="tg-live-actions">
          <button type="button" class="tg-live-apply-btn" id="tgLiveApplyBtn" title="Inserir texto (Tab)">
            Aplicar (Tab)
          </button>
          <button type="button" class="tg-live-close-btn" id="tgLiveCloseBtn" title="Fechar (Esc)">✕</button>
        </div>
      </div>
      <div class="tg-live-back-row">
        <span class="tg-live-back-icon">↳</span>
        <span class="tg-live-back-label">Retradução:</span>
        <span class="tg-live-back-text">${escapeHtml(backTranslatedText)}</span>
      </div>
    `;

    liveBoxElement.classList.remove('hiding');
    adjustChatPadding(true);

    const applyBtn = document.getElementById('tgLiveApplyBtn');
    if (applyBtn) {
      applyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyLiveTranslation(inputEl, translatedText);
      });
    }

    const closeBtn = document.getElementById('tgLiveCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideLiveTranslationBox();
      });
    }
  }

  function hideLiveTranslationBox() {
    currentLiveState = null;
    adjustChatPadding(false);

    if (inputMutationObserver) {
      inputMutationObserver.disconnect();
      inputMutationObserver = null;
      observedInputElement = null;
    }

    if (liveBoxElement) {
      liveBoxElement.classList.add('hiding');
      setTimeout(() => {
        if (liveBoxElement && liveBoxElement.classList.contains('hiding')) {
          liveBoxElement.remove();
          liveBoxElement = null;
        }
      }, 180);
    }
  }

  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Dispara busca com tradução dupla (direta + retro-tradução garantida para o Português)
  function fetchLiveTranslation(inputEl, rawText) {
    if (!settings.enabled) return;

    const targetLang = settings.writeTargetLang || 'ru';

    chrome.runtime.sendMessage(
      {
        action: 'translateDouble',
        text: rawText,
        targetLang: targetLang,
        backLang: 'pt' // Sempre retro-traduz estritamente para o Português
      },
      (response) => {
        const currentText = extractCleanText(inputEl);
        if (currentText !== rawText || currentText.length < 2) {
          return;
        }

        if (response && response.success && response.data) {
          const { translatedText, backTranslatedText } = response.data;
          renderLiveTranslationBox(inputEl, translatedText, backTranslatedText, targetLang);
        }
      }
    );
  }

  // Observa a digitação em tempo real no campo de mensagem
  document.addEventListener(
    'input',
    (e) => {
      removeOldInjectedButtons();

      const inputEl = getActiveMessageInput();
      if (!inputEl) return;

      if (e.target !== inputEl && !inputEl.contains(e.target)) return;

      clearTimeout(liveDebounceTimer);

      const rawText = extractCleanText(inputEl);
      if (rawText.length < 2) {
        hideLiveTranslationBox();
        return;
      }

      liveDebounceTimer = setTimeout(() => {
        fetchLiveTranslation(inputEl, rawText);
      }, 320);
    },
    true
  );

  // Fecha o dock caso o usuário limpe o campo com Backspace/Delete
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const inputEl = getActiveMessageInput();
      if (inputEl) {
        const text = extractCleanText(inputEl);
        if (text.length < 2) {
          hideLiveTranslationBox();
        }
      }
    }
  });

  // Fecha o dock imediatamente quando o usuário clica no botão de enviar (aviãozinho) do Telegram
  document.addEventListener(
    'click',
    (e) => {
      // Se clicou no botão de envio
      const sendBtn = e.target.closest(
        '.btn-send, .btn-send-container, [title*="Send"], [title*="Enviar"], .tgico-send, .send'
      );
      if (sendBtn) {
        hideLiveTranslationBox();
        return;
      }

      // Se clicou fora do input e fora do live box, fecha
      if (
        liveBoxElement &&
        !liveBoxElement.contains(e.target) &&
        !e.target.closest('.input-message-input, #editable-message-text, [contenteditable="true"]')
      ) {
        hideLiveTranslationBox();
      }
    },
    true
  );

  // --- Eventos de Teclado Globais ---

  window.addEventListener(
    'keydown',
    (e) => {
      // Atalho Tab (ou Alt + Enter) para aplicar a tradução instantânea no campo de mensagem
      if ((e.key === 'Tab' && !e.shiftKey && !e.ctrlKey) || (e.altKey && e.key === 'Enter')) {
        const inputEl = getActiveMessageInput();
        if (inputEl) {
          const rawText = extractCleanText(inputEl);
          if (rawText.length > 0) {
            e.preventDefault();
            e.stopPropagation();

            if (currentLiveState && currentLiveState.translatedText) {
              applyLiveTranslation(inputEl, currentLiveState.translatedText);
            } else {
              fetchLiveTranslation(inputEl, rawText);
            }
            return;
          }
        }
      }

      // Enter normal para enviar: fecha IMEDIATAMENTE o dock flutuante!
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        hideLiveTranslationBox();
        setTimeout(hideLiveTranslationBox, 50);
        setTimeout(hideLiveTranslationBox, 150);
      }

      // Atalho Escape para fechar o dock flutuante
      if (e.key === 'Escape') {
        if (liveBoxElement) {
          hideLiveTranslationBox();
          return;
        }
      }

      // Atalho Alt + T para traduzir a tela inteira
      if (e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        toggleScreenTranslation();
        return;
      }

      if (!settings.enabled) return;

      if (isKeyMatch(e)) {
        if (settings.operationMode === 'toggle') {
          if (!e.repeat) {
            isToggleActive = !isToggleActive;
            if (isToggleActive) {
              showToast(`Tradutor Ativado • ${settings.modifierKey} para desligar`, 3500);
              if (currentHoveredElement) {
                translateElement(currentHoveredElement);
              }
            } else {
              showToast('Tradutor Desativado', 1800);
              restoreAll();
            }
          }
        } else {
          isHoldActive = true;
          if (currentHoveredElement && !activeTranslations.has(currentHoveredElement)) {
            translateElement(currentHoveredElement);
          }
        }
      }
    },
    true
  );

  window.addEventListener(
    'keyup',
    (e) => {
      if (isKeyMatch(e)) {
        if (settings.operationMode === 'hold') {
          isHoldActive = false;
          restoreHoverTranslations();
        }
      }
    },
    true
  );

  window.addEventListener('blur', () => {
    if (settings.operationMode === 'hold') {
      isHoldActive = false;
      restoreHoverTranslations();
    }
  });

  // --- Eventos de Mouse (Hover) ---

  document.addEventListener(
    'mouseover',
    (e) => {
      const textEl = findMessageTextElement(e.target);
      if (!textEl) return;

      currentHoveredElement = textEl;

      if (!settings.enabled) return;

      if (settings.operationMode === 'toggle') {
        if (isToggleActive) {
          translateElement(textEl);
        }
      } else {
        if (isMouseModifierActive(e)) {
          translateElement(textEl);
        }
      }
    },
    true
  );

  document.addEventListener(
    'mouseout',
    (e) => {
      const textEl = findMessageTextElement(e.target);
      if (!textEl) return;

      const related = e.relatedTarget;
      if (related && textEl.contains(related)) {
        return;
      }

      if (currentHoveredElement === textEl) {
        currentHoveredElement = null;
      }

      if (settings.operationMode === 'hold') {
        const state = activeTranslations.get(textEl);
        if (state && !state.isBatch) {
          restoreElement(textEl);

          const bubble = textEl.closest('.bubble, .Message');
          if (bubble) {
            const replyTextEl = getReplyTextElement(bubble);
            if (replyTextEl && activeTranslations.has(replyTextEl)) {
              restoreElement(replyTextEl);
            }
          }
        }
      }
    },
    true
  );
})();
