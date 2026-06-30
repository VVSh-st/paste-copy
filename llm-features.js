// file_name: llm-features.js
window.LLMFeatures = (() => {
  let _State   = null;
  let _Storage = null;
  let _LLMCore = null;
  function _isEnabled() { return !!_State?.getLayout()?.llm?.enabled; }
  function _guard() {
    if (!_isEnabled()) {
      window.Toast?.show('LLM-модуль отключён. Включите в Настройки LLM → Общее.', 'error');
      return false;
    }
    if (!_State?.getLayout()?.llm?.activeProfileId) {
      window.Toast?.show('Выберите LLM-профиль в тулбаре.', 'error');
      return false;
    }
    return true;
  }
  function _withAutoSnap(label) {
    if (_State?.getLayout()?.llm?.autoSnapshot) _State.saveNamedSnapshot('[LLM] ' + label);
  }
  function _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const _LANG_INSTR =
  '\n\nОТВЕЧАЙ ТОЛЬКО НА РУССКОМ ЯЗЫКЕ. ПОКАЗЫВАЙ ТОЛЬКО ИТОГОВЫЙ ОТВЕТ: без пояснений, анализа, вступлений и Markdown-обёрток.';
  let _thinkingTimer = null;
  let _thinkingRafId = null;
  let _thinkingHideDelay = 260;
  function _showThinking(msg = '◕ Думаю...') {
    if (_thinkingTimer !== null) {
      clearTimeout(_thinkingTimer);
      _thinkingTimer = null;
    }
    if (_thinkingRafId !== null) {
      cancelAnimationFrame(_thinkingRafId);
      _thinkingRafId = null;
    }
    let el = document.getElementById('llm-thinking-bar');
    const isNew = !el;
    if (isNew) {
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      _thinkingHideDelay = prefersReduced ? 10 : 260;
      const dur = prefersReduced ? '0s' : '.25s';
      el = document.createElement('div');
      el.id = 'llm-thinking-bar';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.style.cssText = [
        'position:fixed;bottom:20px;left:50%;transform:translateX(-50%)',
        'background:var(--bg2,#1e1e2e);color:var(--text1,#cdd6f4)',
        'border:1px solid var(--border,#45475a);border-radius:10px',
        'padding:7px 18px;font-size:12px;z-index:9000',
        'box-shadow:0 4px 16px rgba(0,0,0,.35);pointer-events:none',
        'display:flex;align-items:center;gap:8px',
        'opacity:0;visibility:hidden',
        `transition:opacity ${dur} ease,visibility ${dur} ease`,
      ].join(';');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    if (el.style.opacity === '1' && el.style.visibility === 'visible') {
      return el;
    }
    if (isNew) {
      _thinkingRafId = requestAnimationFrame(() => {
        _thinkingRafId = null;
        el.style.visibility = 'visible';
        el.style.opacity = '1';
      });
    } else {
      el.style.visibility = 'visible';
      el.style.opacity = '1';
    }
    return el;
  }
  function _hideThinking() {
    if (_thinkingRafId !== null) {
      cancelAnimationFrame(_thinkingRafId);
      _thinkingRafId = null;
    }
    if (_thinkingTimer !== null) {
      clearTimeout(_thinkingTimer);
      _thinkingTimer = null;
    }
    const el = document.getElementById('llm-thinking-bar');
    if (!el) return;
    el.style.opacity = '0';
    _thinkingTimer = setTimeout(() => {
      _thinkingTimer = null;
      el.style.visibility = 'hidden';
    }, _thinkingHideDelay);
  }
  function renderProfileBar() {
    if (!_State) return;
    const lay      = _State.getLayout();
    const profiles = lay?.llm?.profiles ?? [];
    const activeId = lay?.llm?.activeProfileId;
    const profile  = profiles.find(p => p.id === activeId);
    const nameEl = document.getElementById('llm-profile-name');
    const dotEl  = document.getElementById('llm-status-dot');
    const menuEl = document.getElementById('llm-profile-menu');
    if (nameEl) nameEl.textContent = profile?.name ?? 'Нет профиля';
    if (dotEl) {
      dotEl.className = 'llm-dot';
      if (lay?.llm?.enabled && profile) dotEl.classList.add('llm-dot--ok');
    }
    if (menuEl) {
      menuEl.innerHTML = '';
      if (!profiles.length) {
        const note = document.createElement('div');
        note.style.cssText = 'padding:10px 14px;font-size:12px;color:var(--text3)';
        note.textContent = 'Нет профилей — добавьте в настройках';
        menuEl.appendChild(note);
      }
      profiles.forEach(p => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'llm-profile-item' + (p.id === activeId ? ' active-prf' : '');
        btn.dataset.profileId = p.id;
        const dot = document.createElement('span');
        dot.className = 'llm-dot' + (p.id === activeId ? ' llm-dot--ok' : '');
        btn.appendChild(dot);
        btn.appendChild(document.createTextNode(p.name ?? p.id));
        menuEl.appendChild(btn);
      });
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      menuEl.appendChild(sep);
      const histBtn = document.createElement('button');
      histBtn.type = 'button';
      histBtn.textContent = '🕐 История запросов';
      histBtn.addEventListener('click', e => {
        e.stopPropagation();
        document.getElementById('llm-profile-bar')?.classList.remove('open');
        window.LLMFeatures?.LLMHistoryPanel?.open?.();
      });
      menuEl.appendChild(histBtn);
      const settingsBtn = document.createElement('button');
      settingsBtn.type = 'button';
      settingsBtn.textContent = '⚙️ Настройки LLM';
      settingsBtn.addEventListener('click', e => {
        e.stopPropagation();
        document.getElementById('llm-profile-bar')?.classList.remove('open');
        _LLMCore?.LLMSettingsModal?.open('profiles');
      });
      menuEl.appendChild(settingsBtn);
    }
  }
  function setActiveProfile(id) {
    if (!_State) return;
    const lay     = _State.getLayout();
    const profile = (lay?.llm?.profiles ?? []).find(p => p.id === id);
    _State.setLayout({ llm: { ...(lay?.llm ?? {}), activeProfileId: id } });
    renderProfileBar();
    window.Toast?.show('Профиль: ' + (profile?.name ?? id), 'success');
  }
  function handleAction(action) {
    window.Intelligence?.track?.('llm.action.requested', { action });
    switch (action) {
      case 'open-settings':   _LLMCore?.LLMSettingsModal?.open('profiles'); break;
      case 'open-chat':       MiniChat.open(); break;
      case 'open-history':    LLMHistoryPanel.open(); break;
      case 'audit':           if (_guard()) PromptAudit.audit(); break;
      case 'compress':        if (_guard()) TokenOptimizer.compress(); break;
      case 'grade':           if (_guard()) PromptGrader.grade(); break;
      case 'rephrase':        if (_guard()) PromptRephrase.rephrase(); break;
      case 'expand':          if (_guard()) PromptExpander.expand(); break;
      case 'autotitle': {
        if (!_guard()) break;
        const t = _State?.getActive();
        if (!t) break;
        const block = t.blocks.find(b =>
          b.type === 'text' && (b.subtabs?.[b.activeSubtab ?? 0]?.value ?? '').trim()
        );
        if (block) AutoTitle.autoTitle(block.id);
        else window.Toast?.show('Нет текстового блока', 'error');
        break;
      }
      case 'groom': {
        if (!_guard()) break;
        const t = _State?.getActive();
        if (!t) break;
        const block = t.blocks.find(b =>
          b.type === 'text' && (b.subtabs?.[b.activeSubtab ?? 0]?.value ?? '').trim()
        );
        if (block) groomBlock(block.id, 'edit');
        else window.Toast?.show('Нет текстового блока для груминга', 'error');
        break;
      }
      case 'fill-placeholders': if (_guard()) SmartPlaceholders.fillAll(); break;
      case 'negatives':         if (_guard()) _runOnPreview('negatives'); break;
      case 'summary':           if (_guard()) _runOnPreview('summary'); break;
      case 'thesaurus':         if (_guard()) _thesaurusAtCursor(); break;
      default:
        window.Toast?.show(`Функция «${action}» будет реализована в следующем шаге`, 'success');
    }
  }
  function _getCurrentPromptText() {
    try {
      const text = window.Preview?.getText?.() ?? '';
      if (String(text).trim()) return text;
    } catch (err) {
      console.warn('[LLMFeatures] Preview.getText failed:', err);
    }

    const tab = _State?.getActive?.();
    if (!tab) return '';
    const parts = [];
    const collect = blocks => (blocks || []).forEach(b => {
      if (b.previewDisabled === true || b.type === 'commands' || b.type === 'variable') return;
      if (b.type === 'text') {
        const idx = b.activeSubtab ?? 0;
        const val = (b.subtabs?.[idx]?.value || '').trim();
        if (val) parts.push(val);
      } else if (b.type === 'snippets') {
        (b.items || []).forEach(item => {
          if (item.enabled && String(item.value || '').trim()) parts.push(String(item.value).trim());
        });
      } else if (b.type === 'group' && b.enabled !== false) {
        collect(b.children);
      }
    });
    collect(tab.blocks);
    return parts.join(tab.separator ?? '\n\n');
  }

  async function _runOnPreview(featureKey) {
    const text = _getCurrentPromptText();
    if (!String(text).trim()) { window.Toast?.show('Текущая вкладка пуста', 'error'); return; }
    const isSummary = featureKey === 'summary';
    MiniChat.newSession();
    MiniChat.open();
    MiniChat.addSystemMessage(isSummary ? '∋ Готовлю резюме вкладки...' : featureKey + '...');
    MiniChat.pushToHistory('user', text);
    _showThinking(isSummary ? '∋ Резюме вкладки...' : '◕ Думаю...');
    try {
      const result = await _LLMCore.request({
        messages:   [{ role: 'system', content: _LLMCore.getPrompt(featureKey) + _LANG_INSTR }, { role: 'user', content: text }],
        stream:     !isSummary,
        timeoutMs:  isSummary ? 180_000 : undefined,
        onChunk:    isSummary ? undefined : chunk => MiniChat.appendChunk(chunk),
        featureTag: featureKey,
      });
      if (isSummary && String(result ?? '').trim()) MiniChat.appendChunk(result);
      MiniChat.finalizeLastMessage(result);
      if (String(result ?? '').trim()) window.PromptLoom?.record?.(result, 'llm', { via: 'preview-feature', featureKey });
      window.Intelligence?.track?.('llm.action.success', {
        featureKey,
        outputChars: String(result ?? '').length
      });
      if (!String(result ?? '').trim()) MiniChat.addSystemMessage('LLM вернул пустой ответ');
    } catch (e) {
      if (e.name !== 'AbortError') {
        MiniChat.addSystemMessage('Ошибка: ' + e.message);
        window.Intelligence?.track?.('llm.action.error', {
          featureKey,
          message: e?.message || ''
        });
        window.Toast?.show(e.message, 'error');
      }
    } finally {
      _hideThinking();
    }
  }
  let _thesaurusPopup = null;
  let _thesaurusItems = [];
  let _thesaurusIdx = -1;
  let _thesaurusTa = null;
  let _thesaurusOrig = '';
  let _thesaurusStart = 0;
  let _thesaurusEnd = 0;
  let _thesaurusLeadSpace = '';
  let _thesaurusTrailSpace = '';
  let _thesaurusCloseOnClick = null;
  let _thesaurusCloseOnContext = null;

  function _closeThesaurus() {
    if (_thesaurusPopup) { _thesaurusPopup.remove(); _thesaurusPopup = null; }
    _thesaurusItems = [];
    _thesaurusIdx = -1;
    _thesaurusTa = null;
    document.removeEventListener('keydown', _onThesaurusKey, true);
    if (_thesaurusCloseOnClick) {
      document.removeEventListener('click', _thesaurusCloseOnClick, true);
      _thesaurusCloseOnClick = null;
    }
    if (_thesaurusCloseOnContext) {
      document.removeEventListener('contextmenu', _thesaurusCloseOnContext, true);
      _thesaurusCloseOnContext = null;
    }
  }

  function _onThesaurusKey(e) {
    if (!_thesaurusPopup || !_thesaurusItems.length || !_thesaurusTa) return;
    if (e.key === 'ArrowRight' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      _thesaurusIdx = (_thesaurusIdx + 1) % _thesaurusItems.length;
      _applyThesaurusItem();
    } else if (e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      const ta = _thesaurusTa;
      const endPos = _thesaurusEnd;
      _closeThesaurus();
      if (ta) {
        ta.focus();
        ta.setSelectionRange(endPos, endPos);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      _thesaurusTa._skipWordComplete = true;
      _thesaurusTa.setRangeText(_thesaurusOrig, _thesaurusStart, _thesaurusEnd, 'end');
      _thesaurusTa.dispatchEvent(new Event('input', { bubbles: true }));
      _thesaurusTa._skipWordComplete = false;
      _closeThesaurus();
    }
  }

  function _applyThesaurusItem() {
    if (!_thesaurusTa || _thesaurusIdx < 0) return;
    const item = _thesaurusItems[_thesaurusIdx];
    if (!item) return;
    const replacement = _thesaurusLeadSpace + item.word + _thesaurusTrailSpace;
    _thesaurusTa._skipWordComplete = true;
    _thesaurusTa.focus();
    _thesaurusTa.setRangeText(replacement, _thesaurusStart, _thesaurusEnd, 'select');
    _thesaurusTa.dispatchEvent(new Event('input', { bubbles: true }));
    _thesaurusTa._skipWordComplete = false;
    const newEnd = _thesaurusStart + replacement.length;
    _thesaurusEnd = newEnd;
    if (_thesaurusPopup) {
      const dot = _thesaurusPopup.querySelector('.thesaurus-dot');
      if (dot) dot.textContent = `${_thesaurusIdx + 1}/${_thesaurusItems.length}`;
      const label = _thesaurusPopup.querySelector('.thesaurus-word');
      if (label) label.textContent = item.word;
    }
  }

  function _showThesaurusPopupInline() {
    const popup = document.createElement('div');
    popup.className = 'thesaurus-popup';
    popup.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:9500;background:var(--bg2);border:1px solid var(--border2);border-radius:10px;padding:8px 14px;box-shadow:0 4px 20px rgba(0,0,0,.4);display:flex;align-items:center;gap:10px;font-size:12px;color:var(--text1);';
    popup.innerHTML =
      '<span class="thesaurus-dot" style="color:var(--text3);font-size:10px;min-width:30px">0/0</span>' +
      '<span class="thesaurus-word" style="font-weight:600;color:#4ade80"></span>' +
      '<span style="color:var(--text3);font-size:10px;margin-left:8px">иконка: цикл · клик: ✓ · Esc ✕</span>';
    document.body.appendChild(popup);
    _thesaurusPopup = popup;
    document.addEventListener('keydown', _onThesaurusKey, true);
    _thesaurusCloseOnClick = (e) => {
      if (e.target.closest('.font-ctrl-btn[title*="Тезаурус"]')) {
        e.preventDefault();
        e.stopPropagation();
        _thesaurusIdx = (_thesaurusIdx + 1) % _thesaurusItems.length;
        _applyThesaurusItem();
        return;
      }
      if (!popup.contains(e.target)) {
        _closeThesaurus();
      }
    };
    setTimeout(() => document.addEventListener('click', _thesaurusCloseOnClick, true), 0);

    _thesaurusCloseOnContext = (e) => {
      if (!popup.contains(e.target)) {
        e.preventDefault();
        if (_thesaurusTa && _thesaurusOrig != null) {
          _thesaurusTa._skipWordComplete = true;
          _thesaurusTa.setRangeText(_thesaurusOrig, _thesaurusStart, _thesaurusEnd, 'end');
          _thesaurusTa.dispatchEvent(new Event('input', { bubbles: true }));
          _thesaurusTa._skipWordComplete = false;
        }
        _closeThesaurus();
      }
    };
    setTimeout(() => document.addEventListener('contextmenu', _thesaurusCloseOnContext, true), 0);
  }

  function _showThesaurusPopup(ta) {
    _closeThesaurus();
    _thesaurusTa = ta;
    _thesaurusStart = ta.selectionStart;
    _thesaurusEnd = ta.selectionEnd;
    const raw = ta.value.slice(_thesaurusStart, _thesaurusEnd);
    _thesaurusOrig = raw;
    const leadMatch = raw.match(/^(\s*)/);
    const trailMatch = raw.match(/(\s*)$/);
    _thesaurusLeadSpace = leadMatch ? leadMatch[1] : '';
    _thesaurusTrailSpace = trailMatch ? trailMatch[1] : '';

    const popup = document.createElement('div');
    popup.className = 'thesaurus-popup';
    popup.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:9500;background:var(--bg2);border:1px solid var(--border2);border-radius:10px;padding:8px 14px;box-shadow:0 4px 20px rgba(0,0,0,.4);display:flex;align-items:center;gap:10px;font-size:12px;color:var(--text1);';
    popup.innerHTML =
      '<span class="thesaurus-dot" style="color:var(--text3);font-size:10px;min-width:30px">0/0</span>' +
      '<span class="thesaurus-word" style="font-weight:600;color:var(--accent)"></span>' +
      '<span style="color:var(--text3);font-size:10px;margin-left:8px">Tab/→ · Space ✓ · Esc ✕</span>';
    document.body.appendChild(popup);
    _thesaurusPopup = popup;
    document.addEventListener('keydown', _onThesaurusKey, true);
    _thesaurusCloseOnClick = (e) => {
      if (!popup.contains(e.target)) {
        _closeThesaurus();
      }
    };
    setTimeout(() => document.addEventListener('click', _thesaurusCloseOnClick), 0);

    _thesaurusCloseOnContext = (e) => {
      if (!popup.contains(e.target)) {
        e.preventDefault();
        if (_thesaurusTa && _thesaurusOrig != null) {
          _thesaurusTa._skipWordComplete = true;
          _thesaurusTa.setRangeText(_thesaurusOrig, _thesaurusStart, _thesaurusEnd, 'end');
          _thesaurusTa.dispatchEvent(new Event('input', { bubbles: true }));
          _thesaurusTa._skipWordComplete = false;
        }
        _closeThesaurus();
      }
    };
    setTimeout(() => document.addEventListener('contextmenu', _thesaurusCloseOnContext, true), 0);
  }

  async function _thesaurusAtCursor() {
    let ta = document.activeElement;
    if (ta?.tagName !== 'TEXTAREA' || !ta.classList.contains('block-textarea')) {
      const activeTab = _State?.getActive?.();
      if (activeTab) {
        for (const b of activeTab.blocks || []) {
          if (b.type === 'text') {
            const blockEl = document.querySelector(`[data-id="${CSS.escape(b.id)}"]`);
            ta = blockEl?.querySelector('textarea.block-textarea');
            if (ta) break;
          }
        }
      }
    }
    if (!ta || ta.tagName !== 'TEXTAREA') {
      window.Toast?.show('Поставьте курсор в текстовый блок', 'error');
      return;
    }
    const savedStart = ta.selectionStart;
    const savedEnd = ta.selectionEnd;
    const savedValue = ta.value;
    const sel = savedValue.slice(savedStart, savedEnd).trim();
    const pos = savedStart;
    const wordRe = /[\wА-Яа-яЁёA-Za-z\u00C0-\u024F]/;
    let start = pos, end = pos;
    while (start > 0 && wordRe.test(savedValue[start - 1])) start--;
    while (end < savedValue.length && wordRe.test(savedValue[end])) end++;
    const word = sel || savedValue.slice(start, end).trim();
    if (!word) { window.Toast?.show('Выделите слово или поставьте курсор', 'error'); return; }
    const ctx = savedValue.slice(Math.max(0, pos - 100), pos + 100);
    _showThinking(`◕ Тезаурус: «${word}»`);
    try {
      const result = await _LLMCore.request({
        messages:   [{ role: 'user', content: _LLMCore.getPrompt('thesaurus', { word, ctx }) }],
        stream:     false,
        maxTokens:  600,
        featureTag: 'thesaurus',
      });
      _hideThinking();
      if (!result?.trim()) { window.Toast?.show('Нет синонимов', 'info'); return; }
      const lines = result.trim().split('\n');
      const items = [];
      for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        let m = line.match(/^\d+[\.\)]\s*(.+?)(?:\s*\[.*?\])?\s*$/i);
        if (!m) m = line.match(/^[-•·]\s*(.+?)\s*$/);
        if (!m) m = line.match(/^(.+?)\s*$/);
        if (m && m[1].trim().length > 1 && m[1].trim().length < 40) {
          const w = m[1].trim().replace(/\s+/g, ' ');
          if (!items.some(x => x.word === w)) items.push({ word: w });
        }
      }
      if (!items.length) { window.Toast?.show('Не удалось распарсить синонимы', 'error'); return; }
      _thesaurusItems = items;
      _thesaurusIdx = 0;
      _thesaurusTa = ta;
      _thesaurusStart = start;
      _thesaurusEnd = end;
      const raw = savedValue.slice(start, end);
      _thesaurusOrig = raw;
      const leadMatch = raw.match(/^(\s*)/);
      const trailMatch = raw.match(/(\s*)$/);
      _thesaurusLeadSpace = leadMatch ? leadMatch[1] : '';
      _thesaurusTrailSpace = trailMatch ? trailMatch[1] : '';
      _showThesaurusPopupInline();
      _applyThesaurusItem();
    } catch (e) {
      _hideThinking();
      if (e.name !== 'AbortError') window.Toast?.show(e.message, 'error');
    }
  }

  async function _thesaurusAtBlock(blockId) {
    const tab = _State?.getActive?.();
    const block = tab?.blocks?.find(b => b.id === blockId);
    if (!block || block.type !== 'text') return;
    const blockEl = document.querySelector(`[data-id="${CSS.escape(blockId)}"]`);
    const ta = blockEl?.querySelector('textarea.block-textarea');
    if (!ta) { window.Toast?.show('Textarea не найдена', 'error'); return; }
    const savedStart = ta.selectionStart;
    const savedEnd = ta.selectionEnd;
    const savedValue = ta.value;
    const sel = savedValue.slice(savedStart, savedEnd).trim();
    const pos = savedStart;
    const wordRe = /[\wА-Яа-яЁёA-Za-z\u00C0-\u024F]/;
    let ws = pos, we = pos;
    while (ws > 0 && wordRe.test(savedValue[ws - 1])) ws--;
    while (we < savedValue.length && wordRe.test(savedValue[we])) we++;
    const word = sel || savedValue.slice(ws, we).trim();
    if (!word) { window.Toast?.show('Выделите слово или поставьте курсор', 'error'); return; }
    const ctx = savedValue.slice(Math.max(0, pos - 100), pos + 100);
    _showThinking(`◕ Тезаурус: «${word}»`);
    try {
      const result = await _LLMCore.request({
        messages:   [{ role: 'user', content: _LLMCore.getPrompt('thesaurus', { word, ctx }) }],
        stream:     false,
        maxTokens:  600,
        featureTag: 'thesaurus',
      });
      _hideThinking();
      if (!result?.trim()) { window.Toast?.show('Нет синонимов', 'info'); return; }
      const lines = result.trim().split('\n');
      const items = [];
      for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        let m = line.match(/^\d+[\.\)]\s*(.+?)(?:\s*\[.*?\])?\s*$/i);
        if (!m) m = line.match(/^[-•·]\s*(.+?)\s*$/);
        if (!m) m = line.match(/^(.+?)\s*$/);
        if (m && m[1].trim().length > 1 && m[1].trim().length < 40) {
          const w = m[1].trim().replace(/\s+/g, ' ');
          if (!items.some(x => x.word === w)) items.push({ word: w });
        }
      }
      if (!items.length) { window.Toast?.show('Не удалось распарсить синонимы', 'error'); return; }
      _thesaurusItems = items;
      _thesaurusIdx = 0;
      _thesaurusTa = ta;
      _thesaurusStart = ws;
      _thesaurusEnd = we;
      const raw = savedValue.slice(ws, we);
      _thesaurusOrig = raw;
      const leadMatch = raw.match(/^(\s*)/);
      const trailMatch = raw.match(/(\s*)$/);
      _thesaurusLeadSpace = leadMatch ? leadMatch[1] : '';
      _thesaurusTrailSpace = trailMatch ? trailMatch[1] : '';
      _showThesaurusPopupInline();
      _applyThesaurusItem();
    } catch (e) {
      _hideThinking();
      if (e.name !== 'AbortError') window.Toast?.show(e.message, 'error');
    }
  }

  async function _thesaurusAntonymsAtBlock(blockId) {
    const tab = _State?.getActive?.();
    const block = tab?.blocks?.find(b => b.id === blockId);
    if (!block || block.type !== 'text') return;
    const blockEl = document.querySelector(`[data-id="${CSS.escape(blockId)}"]`);
    const ta = blockEl?.querySelector('textarea.block-textarea');
    if (!ta) { window.Toast?.show('Textarea не найдена', 'error'); return; }
    const savedStart = ta.selectionStart;
    const savedEnd = ta.selectionEnd;
    const savedValue = ta.value;
    const sel = savedValue.slice(savedStart, savedEnd).trim();
    const pos = savedStart;
    const wordRe = /[\wА-Яа-яЁёA-Za-z\u00C0-\u024F]/;
    let ws = pos, we = pos;
    while (ws > 0 && wordRe.test(savedValue[ws - 1])) ws--;
    while (we < savedValue.length && wordRe.test(savedValue[we])) we++;
    const word = sel || savedValue.slice(ws, we).trim();
    if (!word) { window.Toast?.show('Выделите слово или поставьте курсор', 'error'); return; }
    const ctx = savedValue.slice(Math.max(0, pos - 100), pos + 100);
    _showThinking(`◕ Антонимы: «${word}»`);
    try {
      const result = await _LLMCore.request({
        messages:   [{ role: 'user', content: _LLMCore.getPrompt('thesaurus_antonyms', { word, ctx }) }],
        stream:     false,
        maxTokens:  600,
        featureTag: 'thesaurus_antonyms',
      });
      _hideThinking();
      if (!result?.trim()) { window.Toast?.show('Нет антонимов', 'info'); return; }
      const lines = result.trim().split('\n');
      const items = [];
      for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        let m = line.match(/^\d+[\.\)]\s*(.+?)(?:\s*\[.*?\])?\s*$/i);
        if (!m) m = line.match(/^[-•·]\s*(.+?)\s*$/);
        if (!m) m = line.match(/^(.+?)\s*$/);
        if (m && m[1].trim().length > 1 && m[1].trim().length < 40) {
          const w = m[1].trim().replace(/\s+/g, ' ');
          if (!items.some(x => x.word === w)) items.push({ word: w });
        }
      }
      if (!items.length) { window.Toast?.show('Не удалось распарсить антонимы', 'error'); return; }
      _thesaurusItems = items;
      _thesaurusIdx = 0;
      _thesaurusTa = ta;
      _thesaurusStart = ws;
      _thesaurusEnd = we;
      const raw = savedValue.slice(ws, we);
      _thesaurusOrig = raw;
      const leadMatch = raw.match(/^(\s*)/);
      const trailMatch = raw.match(/(\s*)$/);
      _thesaurusLeadSpace = leadMatch ? leadMatch[1] : '';
      _thesaurusTrailSpace = trailMatch ? trailMatch[1] : '';
      _showThesaurusPopupInline();
      _applyThesaurusItem();
    } catch (e) {
      _hideThinking();
      if (e.name !== 'AbortError') window.Toast?.show(e.message, 'error');
    }
  }

  async function _thesaurusTransformAtBlock(blockId, promptKey, featureTag, thinkingMsg) {
    const tab = _State?.getActive?.();
    const block = tab?.blocks?.find(b => b.id === blockId);
    if (!block || block.type !== 'text') return;
    const blockEl = document.querySelector(`[data-id="${CSS.escape(blockId)}"]`);
    const ta = blockEl?.querySelector('textarea.block-textarea');
    if (!ta) { window.Toast?.show('Textarea не найдена', 'error'); return; }
    const savedStart = ta.selectionStart;
    const savedEnd = ta.selectionEnd;
    const savedValue = ta.value;
    const hasSelection = savedEnd > savedStart;
    const text = hasSelection ? savedValue.slice(savedStart, savedEnd) : savedValue;
    if (!text.trim()) { window.Toast?.show('Текст пустой', 'error'); return; }
    _showThinking(thinkingMsg);
    try {
      const result = await _LLMCore.request({
        messages:   [{ role: 'user', content: _LLMCore.getPrompt(promptKey) + '\n\n' + text }],
        stream:     false,
        maxTokens:  2000,
        featureTag,
      });
      _hideThinking();
      if (!result?.trim()) { window.Toast?.show('Пустой ответ', 'info'); return; }
      const replacement = result.trim();
      const leadSpace = text.match(/^(\s*)/)[1];
      const trailSpace = text.match(/(\s*)$/)[1];
      const fullReplacement = leadSpace + replacement + trailSpace;
      ta._skipWordComplete = true;
      ta.focus();
      if (hasSelection) {
        ta.setRangeText(fullReplacement, savedStart, savedEnd, 'end');
      } else {
        ta.setRangeText(fullReplacement, 0, savedValue.length, 'end');
      }
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta._skipWordComplete = false;
      window.Toast?.show('✓ Выполнено', 'success');
    } catch (e) {
      _hideThinking();
      if (e.name !== 'AbortError') window.Toast?.show(e.message, 'error');
    }
  }

  async function _thesaurusExplainAtBlock(blockId) {
    const tab = _State?.getActive?.();
    const block = tab?.blocks?.find(b => b.id === blockId);
    if (!block || block.type !== 'text') return;
    const blockEl = document.querySelector(`[data-id="${CSS.escape(blockId)}"]`);
    const ta = blockEl?.querySelector('textarea.block-textarea');
    if (!ta) { window.Toast?.show('Textarea не найдена', 'error'); return; }
    const savedStart = ta.selectionStart;
    const savedEnd = ta.selectionEnd;
    const savedValue = ta.value;
    const hasSelection = savedEnd > savedStart;
    const text = hasSelection ? savedValue.slice(savedStart, savedEnd) : savedValue;
    if (!text.trim()) { window.Toast?.show('Текст пустой', 'error'); return; }
    MiniChat.newSession();
    MiniChat.open();
    MiniChat.addSystemMessage('◕ Объясняю как для пятилетки...');
    MiniChat.pushToHistory('user', text);
    _showThinking('◕ Объясняю...');
    try {
      const result = await _LLMCore.request({
        messages:   [{ role: 'user', content: _LLMCore.getPrompt('thesaurus_explain') + '\n\n' + text }],
        stream:     true,
        onChunk:    chunk => MiniChat.appendChunk(chunk),
        featureTag: 'thesaurus_explain',
      });
      MiniChat.finalizeLastMessage(result);
      MiniChat.pushToHistory('assistant', result);
    } catch (e) {
      MiniChat.finalizeLastMessage('');
      if (e.name !== 'AbortError') {
        MiniChat.addSystemMessage('Ошибка: ' + e.message);
        window.Toast?.show(e.message, 'error');
      }
    } finally {
      _hideThinking();
    }
  }

  function _executeThesaurusMode(mode, blockId) {
    switch (mode) {
      case 'antonyms':  return _thesaurusAntonymsAtBlock(blockId);
      case 'rephrase':  return _thesaurusTransformAtBlock(blockId, 'thesaurus_rephrase', 'thesaurus_rephrase', '↬ Перефразирую...');
      case 'explain':   return _thesaurusExplainAtBlock(blockId);
      case 'structure': return _thesaurusTransformAtBlock(blockId, 'thesaurus_structure', 'thesaurus_structure', '☰ Структурирую...');
    }
  }

  const PromptRephrase = (() => {
    async function rephrase() {
      if (!_guard()) return;
      const text = window.Preview?.getText?.() ?? '';
      if (!text.trim()) { window.Toast?.show('Превью пустое', 'error'); return; }
      MiniChat.newSession();
      MiniChat.open();
      MiniChat.addSystemMessage('↬ Перефразирую промпт...');
      MiniChat.pushToHistory('user', text);
      _showThinking('↬ Перефразирую...');
      try {
        const sysPrompt =
  'Ты — редактор промптов. Улучши данный промпт, не выполняя его. ' +
  'Сохрани исходный смысл, цель, ограничения, переменные и структуру, если она есть. ' +
  'Сделай формулировки яснее, конкретнее и проще для слабой LLM. ' +
  'Убери двусмысленность, добавь недостающие уточнения только если они напрямую следуют из смысла. ' +
  'Верни только переработанный промпт.' + _LANG_INSTR;
        const result = await _LLMCore.request({
          messages:   [{ role: 'system', content: sysPrompt }, { role: 'user', content: text }],
          stream:     true,
          onChunk:    chunk => MiniChat.appendChunk(chunk),
          featureTag: 'rephrase',
        });
        MiniChat.finalizeLastMessage(result);
        if (String(result ?? '').trim()) window.PromptLoom?.record?.(result, 'llm', { via: 'rephrase' });
      } catch (e) {
        if (e.name !== 'AbortError') {
          MiniChat.addSystemMessage('Ошибка: ' + e.message);
          window.Toast?.show(e.message, 'error');
        }
      } finally {
        _hideThinking();
      }
    }
    return { rephrase };
  })();
  const PromptExpander = (() => {
    async function expand() {
      if (!_guard()) return;
      const text = window.Preview?.getText?.() ?? '';
      if (!text.trim()) { window.Toast?.show('Превью пустое', 'error'); return; }
      MiniChat.newSession();
      MiniChat.open();
      MiniChat.addSystemMessage('📝 Разворачиваю промпт...');
      MiniChat.pushToHistory('user', text);
      _showThinking('📝 Разворачиваю...');
      try {
        const sysPrompt =
  'Ты — эксперт по промпт-инженерии. Возьми краткий промпт и аккуратно разверни его, не выполняя задачу. ' +
  'Сохрани исходную цель, добавь понятный контекст, роль модели, формат ответа, ограничения и критерии качества. ' +
  'Если уместно, добавь короткий пример ожидаемого результата. ' +
  'Пиши ясно и конкретно, чтобы промпт хорошо работал на слабых LLM. ' +
  'Верни только расширенный промпт.' + _LANG_INSTR;
        const result = await _LLMCore.request({
          messages:   [{ role: 'system', content: sysPrompt }, { role: 'user', content: text }],
          stream:     true,
          onChunk:    chunk => MiniChat.appendChunk(chunk),
          featureTag: 'expand',
        });
        MiniChat.finalizeLastMessage(result);
        if (String(result ?? '').trim()) window.PromptLoom?.record?.(result, 'llm', { via: 'expand' });
      } catch (e) {
        if (e.name !== 'AbortError') {
          MiniChat.addSystemMessage('Ошибка: ' + e.message);
          window.Toast?.show(e.message, 'error');
        }
      } finally {
        _hideThinking();
      }
    }
    return { expand };
  })();

  const AutoTitle = (() => {
    let _variants = [];
    let _current = 0;
    let _blockId = null;
    let _popup = null;

    async function autoTitle(blockId) {
      if (!_guard()) return;

      const t = _State.getActive();
      const block = _State.findBlock(t?.blocks ?? [], blockId);
      if (!block) return;

      const text = (block.subtabs?.[block.activeSubtab ?? 0]?.value ?? '').slice(0, 500).trim();
      if (!text) {
        window.Toast?.show('Блок пустой', 'error');
        return;
      }

      _closePopup();

      if (_variants.length > 0 && _blockId === blockId) {
        _current = (_current + 1) % _variants.length;
        _showPopup(blockId);
        return;
      }

      let result;
      try {
        _showThinking('◕ Генерирую варианты...');
        result = await _LLMCore.request({
          messages: [
            { role: 'system', content: _LLMCore.getPrompt('autotitle') + (_LANG_INSTR ?? '') },
            { role: 'user',   content: text },
          ],
          maxTokens: 300,
          stream: false,
          featureTag: 'autotitle',
        });
      } catch (e) {
        if (e.name !== 'AbortError') window.Toast?.show('Ошибка: ' + e.message, 'error');
        return;
      } finally { _hideThinking(); }

      if (result == null || typeof result !== 'string') {
        window.Toast?.show('Пустой ответ модели', 'error');
        return;
      }

      _variants = result.trim().split('\n')
        .map(l => l.replace(/^\d+[.):\s]+/, '').replace(/[""]/g, '').trim())
        .filter(l => {
          if (!l || l.length > 60) return false;
          const fw = l.split(/\s+/)[0] || '';
          return fw.length >= 4 && fw.length <= 6;
        })
        .slice(0, 4);

      if (_variants.length === 0) {
        _variants = result.trim().split('\n')
          .map(l => l.replace(/^\d+[.):\s]+/, '').replace(/[""]/g, '').trim())
          .filter(l => l.length > 0 && l.length <= 60)
          .slice(0, 4);
      }

      if (_variants.length === 0) {
        window.Toast?.show('Не удалось распарсить варианты', 'error');
        return;
      }

      _blockId = blockId;
      _current = 0;
      _showPopup(blockId);
    }

    function _showPopup(blockId) {
      _closePopup();

      let anchor;
      try {
        anchor = document.querySelector(`[data-id="${CSS.escape(blockId)}"] .block-title`);
      } catch {
        anchor = document.querySelector(`[data-id="${blockId}"] .block-title`);
      }
      if (!anchor) return;

      const variant = _variants[_current];
      const counter = `(${_current + 1}/${_variants.length})`;

      const popup = document.createElement('div');
      popup.className = 'llm-inline-popup';
      popup.setAttribute('role', 'dialog');
      popup.setAttribute('aria-modal', 'true');
      popup.setAttribute('aria-label', 'Подтверждение заголовка');
      popup.innerHTML =
        `<span class="llm-inline-popup-text">${_esc(variant)} <small style="opacity:.5">${counter}</small></span>` +
        `<button type="button" class="btn-sm btn-sm-accent" data-action="accept" title="Применить">✓</button>` +
        `<button type="button" class="btn-sm" data-action="next" title="Следующий вариант">↺</button>` +
        `<button type="button" class="btn-sm" data-action="cancel">✕</button>`;

      const r = anchor.getBoundingClientRect();
      popup.style.cssText = `position:fixed;top:${r.bottom + 6}px;left:${r.left}px;z-index:700`;
      document.body.appendChild(popup);

      const pr = popup.getBoundingClientRect();
      if (pr.bottom > window.innerHeight) popup.style.top = Math.max(8, r.top - pr.height - 6) + 'px';
      if (pr.right > window.innerWidth) popup.style.left = Math.max(8, window.innerWidth - pr.width - 8) + 'px';

      popup.querySelector('[data-action="accept"]').focus();
      _popup = popup;

      popup.addEventListener('click', function onPopupClick(e) {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (!action) return;

        if (action === 'accept') {
          _State.update(tab => {
            const b = _State.findBlock(tab.blocks, blockId);
            if (b) b.title = _variants[_current];
          });
          _variants = [];
          _current = 0;
          _blockId = null;
          _closePopup();
          window.Toast?.show('Заголовок обновлён ✓', 'success');
        } else if (action === 'next') {
          _current = (_current + 1) % _variants.length;
          _closePopup();
          _showPopup(blockId);
        } else if (action === 'cancel') {
          _variants = [];
          _current = 0;
          _blockId = null;
          _closePopup();
        }
      });

      popup._docClick = e => {
        if (!popup.contains(e.target)) {
          _variants = [];
          _current = 0;
          _blockId = null;
          _closePopup();
        }
      };
      setTimeout(() => document.addEventListener('click', popup._docClick), 0);

      popup._escKey = e => {
        if (e.key === 'Escape') {
          _variants = [];
          _current = 0;
          _blockId = null;
          _closePopup();
        }
      };
      document.addEventListener('keydown', popup._escKey);
    }

    function _closePopup() {
      if (!_popup) return;
      if (_popup._docClick) document.removeEventListener('click', _popup._docClick);
      if (_popup._escKey) document.removeEventListener('keydown', _popup._escKey);
      _popup._docClick = null;
      _popup._escKey = null;
      _popup.remove();
      _popup = null;
    }

    return { autoTitle };
  })();

  const SubtabAutoTitle = (() => {
    let _variants = [];
    let _current = 0;
    let _blockId = null;
    let _popup = null;

    async function autoTitle(blockId) {
      if (!_guard()) return;
      const t = _State.getActive();
      const block = _State.findBlock(t?.blocks ?? [], blockId);
      if (!block) return;

      const sub = block.subtabs?.[block.activeSubtab ?? 0];
      if (!sub) return;
      const text = (sub.value || '').slice(0, 500).trim();
      if (!text) { window.Toast?.show('Вкладка пустая', 'error'); return; }

      _closePopup();

      if (_variants.length > 0 && _blockId === blockId) {
        _current = (_current + 1) % _variants.length;
        _showPopup(blockId);
        return;
      }

      let result;
      try {
        _showThinking('◕ Генерирую варианты...');
        result = await _LLMCore.request({
          messages: [
            { role: 'system', content: _LLMCore.getPrompt('subtab_autotitle') + (_LANG_INSTR ?? '') },
            { role: 'user',   content: text },
          ],
          maxTokens: 200,
          stream: false,
          featureTag: 'subtab_autotitle',
        });
      } catch (e) {
        if (e.name !== 'AbortError') window.Toast?.show('Ошибка: ' + e.message, 'error');
        return;
      } finally { _hideThinking(); }

      if (result == null || typeof result !== 'string') {
        window.Toast?.show('Пустой ответ модели', 'error');
        return;
      }

      _variants = result.trim().split('\n')
        .map(l => l.replace(/^\d+[.):\s]+/, '').replace(/[""]/g, '').trim())
        .filter(l => {
          if (!l || l.length > 60) return false;
          const fw = l.split(/\s+/)[0] || '';
          return fw.length >= 4 && fw.length <= 6;
        })
        .slice(0, 4);

      if (_variants.length === 0) {
        _variants = result.trim().split('\n')
          .map(l => l.replace(/^\d+[.):\s]+/, '').replace(/[""]/g, '').trim())
          .filter(l => l.length > 0 && l.length <= 60)
          .slice(0, 4);
      }

      if (_variants.length === 0) {
        window.Toast?.show('Не удалось распарсить варианты', 'error');
        return;
      }

      _blockId = blockId;
      _current = 0;
      _showPopup(blockId);
    }

    function _showPopup(blockId) {
      _closePopup();

      let anchor;
      try {
        anchor = document.querySelector(`[data-id="${CSS.escape(blockId)}"] .block-subtabs-nav`);
      } catch {
        anchor = document.querySelector(`[data-id="${blockId}"] .block-subtabs-nav`);
      }
      if (!anchor) return;

      const variant = _variants[_current];
      const counter = `(${_current + 1}/${_variants.length})`;

      const popup = document.createElement('div');
      popup.className = 'llm-inline-popup';
      popup.setAttribute('role', 'dialog');
      popup.setAttribute('aria-modal', 'true');
      popup.setAttribute('aria-label', 'Авто-заголовок вкладки');
      popup.innerHTML =
        `<span class="llm-inline-popup-text">${_esc(variant)} <small style="opacity:.5">${counter}</small></span>` +
        `<button type="button" class="btn-sm btn-sm-accent" data-action="accept" title="Применить">✓</button>` +
        `<button type="button" class="btn-sm" data-action="next" title="Следующий вариант">↺</button>` +
        `<button type="button" class="btn-sm" data-action="cancel">✕</button>`;

      const r = anchor.getBoundingClientRect();
      popup.style.cssText = `position:fixed;top:${r.bottom + 6}px;left:${r.left}px;z-index:700`;
      document.body.appendChild(popup);

      const pr = popup.getBoundingClientRect();
      if (pr.bottom > window.innerHeight) popup.style.top = Math.max(8, r.top - pr.height - 6) + 'px';
      if (pr.right > window.innerWidth) popup.style.left = Math.max(8, window.innerWidth - pr.width - 8) + 'px';

      popup.querySelector('[data-action="accept"]').focus();
      _popup = popup;

      popup.addEventListener('click', function onPopupClick(e) {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (!action) return;

        if (action === 'accept') {
          const t = _State.getActive();
          const block = _State.findBlock(t?.blocks ?? [], blockId);
          if (block) {
            const sub = block.subtabs?.[block.activeSubtab ?? 0];
            if (sub) sub.name = _variants[_current];
          }
          _variants = [];
          _current = 0;
          _blockId = null;
          _closePopup();
          _State.update(() => {});
          window.Toast?.show('Название вкладки обновлено ✓', 'success');
        } else if (action === 'next') {
          _current = (_current + 1) % _variants.length;
          _closePopup();
          _showPopup(blockId);
        } else if (action === 'cancel') {
          _variants = [];
          _current = 0;
          _blockId = null;
          _closePopup();
        }
      });

      popup._docClick = e => {
        if (!popup.contains(e.target)) {
          _variants = [];
          _current = 0;
          _blockId = null;
          _closePopup();
        }
      };
      setTimeout(() => document.addEventListener('click', popup._docClick), 0);

      popup._escKey = e => {
        if (e.key === 'Escape') {
          _variants = [];
          _current = 0;
          _blockId = null;
          _closePopup();
        }
      };
      document.addEventListener('keydown', popup._escKey);
    }

    function _closePopup() {
      if (!_popup) return;
      if (_popup._docClick) document.removeEventListener('click', _popup._docClick);
      if (_popup._escKey) document.removeEventListener('keydown', _popup._escKey);
      _popup._docClick = null;
      _popup._escKey = null;
      _popup.remove();
      _popup = null;
    }

    return { autoTitle };
  })();

  const DiffEngine = (() => {
    const ENTITIES = {
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    };

    function escapeHtml(str) {
      return str.replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
    }

    function compute(oldText, newText) {
      const a = oldText == null ? '' : String(oldText);
      const b = newText == null ? '' : String(newText);

      if (a === b) return a.length === 0 ? [] : [{ type: 'eq', text: a }];

      const oldToks = a.split(/(\s+)/);
      const newToks = b.split(/(\s+)/);
      const m = oldToks.length;
      const n = newToks.length;

      if (m * n > 150_000) {
        return computeByLine(a, b);
      }

      const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          dp[i][j] =
            oldToks[i - 1] === newToks[j - 1]
              ? dp[i - 1][j - 1] + 1
              : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }

      const ops = [];
      let i = m, j = n;
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldToks[i - 1] === newToks[j - 1]) {
          ops.push({ type: 'eq', text: oldToks[i - 1] });
          i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
          ops.push({ type: 'ins', text: newToks[j - 1] });
          j--;
        } else {
          ops.push({ type: 'del', text: oldToks[i - 1] });
          i--;
        }
      }
      ops.reverse();
      return ops;
    }

    function splitLinesPreserveBreaks(text) {
      const source = String(text ?? '');
      if (!source) return [];
      return source.match(/[^\n]*\n|[^\n]+/g) || [];
    }

    function computeByLine(oldText, newText) {
      const oldLines = splitLinesPreserveBreaks(oldText);
      const newLines = splitLinesPreserveBreaks(newText);
      const m = oldLines.length;
      const n = newLines.length;

      if (!m && !n) return [];
      if (m * n > 80_000) {
        return trimCommonEdgesFallback(oldText, newText);
      }

      const dp = Array.from({ length: m + 1 }, () => new Int16Array(n + 1));
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          dp[i][j] =
            oldLines[i - 1] === newLines[j - 1]
              ? dp[i - 1][j - 1] + 1
              : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }

      const ops = [];
      let i = m, j = n;
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
          ops.push({ type: 'eq', text: oldLines[i - 1] });
          i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
          ops.push({ type: 'ins', text: newLines[j - 1] });
          j--;
        } else {
          ops.push({ type: 'del', text: oldLines[i - 1] });
          i--;
        }
      }
      ops.reverse();
      return mergeAdjacentOps(ops);
    }

    function trimCommonEdgesFallback(oldText, newText) {
      const a = String(oldText ?? '');
      const b = String(newText ?? '');
      let start = 0;
      const minLen = Math.min(a.length, b.length);
      while (start < minLen && a[start] === b[start]) start++;

      let oldEnd = a.length;
      let newEnd = b.length;
      while (oldEnd > start && newEnd > start && a[oldEnd - 1] === b[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }

      const ops = [];
      if (start > 0) ops.push({ type: 'eq', text: a.slice(0, start) });
      if (oldEnd > start) ops.push({ type: 'del', text: a.slice(start, oldEnd) });
      if (newEnd > start) ops.push({ type: 'ins', text: b.slice(start, newEnd) });
      if (oldEnd < a.length) ops.push({ type: 'eq', text: a.slice(oldEnd) });
      return ops;
    }

    function mergeAdjacentOps(ops) {
      const merged = [];
      for (const op of ops) {
        if (!op.text) continue;
        const prev = merged[merged.length - 1];
        if (prev && prev.type === op.type) prev.text += op.text;
        else merged.push({ ...op });
      }
      return merged;
    }

    const MATRIX_CHARS = 'абвгдежзийклмнопрстуфхцчшщьыъэюяABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    function _matrixNoise(text) {
      return Array.from(text).map(ch => /\s/u.test(ch) ? ch : MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)]).join('');
    }

    function _clampEffectMs(value, fallback = 3500) {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(1000, Math.min(10000, Math.round(n / 50) * 50));
    }

    function _stableHash(str) {
      let hash = 2166136261;
      const s = String(str ?? '');
      for (let i = 0; i < s.length; i++) {
        hash ^= s.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    function _renderWhitespaceChange(op, text, idxRef, totalTokens, matrix = false, durationMs = 3500) {
      const tag = op.type === 'del' ? 'del' : 'ins';
      const cls = op.type === 'del'
        ? `diff-del ${matrix ? 'diff-matrix-token diff-matrix-del' : 'diff-classic-token diff-classic-del'} diff-whitespace-token`
        : `diff-ins ${matrix ? 'diff-matrix-token diff-matrix-ins' : 'diff-classic-token diff-classic-ins'} diff-whitespace-token`;
      const i = idxRef.value++;
      const denom = Math.max(1, totalTokens - 1);
      const visible = String(text ?? '')
        .replace(/ /g, '·')
        .replace(/\t/g, '⇥')
        .replace(/\n/g, '↵\n');

      if (matrix) {
        const maxDelay = Math.max(0, durationMs * 0.72);
        const effectMs = Math.max(700, Math.round(durationMs * 0.36));
        const hash = _stableHash(`${i}:${visible}:${op.type}:ws`);
        const order = totalTokens <= 1 ? 0 : hash % totalTokens;
        const jitter = ((hash >>> 8) % 101) - 50;
        const delayMs = Math.max(0, Math.min(maxDelay, Math.round((maxDelay * order) / denom + jitter)));
        return `<${tag} class="${cls}" data-matrix="${escapeHtml(_matrixNoise(visible))}" title="изменённый пробел" style="--delay:${delayMs}ms;--dur:${effectMs}ms">${escapeHtml(visible)}</${tag}>`;
      }

      const delayMs = Math.round((380 * i) / denom);
      return `<${tag} class="${cls}" title="изменённый пробел" style="--delay:${delayMs}ms">${escapeHtml(visible)}</${tag}>`;
    }

    function _renderClassicOp(op, idxRef, totalTokens) {
      if (op.type === 'eq') return escapeHtml(op.text);

      const tag = op.type === 'del' ? 'del' : 'ins';
      const cls = op.type === 'del' ? 'diff-del diff-classic-token diff-classic-del' : 'diff-ins diff-classic-token diff-classic-ins';
      const denom = Math.max(1, totalTokens - 1);

      return String(op.text ?? '').split(/(\s+)/u).map(part => {
        if (!part) return '';
        if (/^\s+$/u.test(part)) return _renderWhitespaceChange(op, part, idxRef, totalTokens, false);

        const i = idxRef.value++;
        const delayMs = Math.round((380 * i) / denom);
        return `<${tag} class="${cls}" style="--delay:${delayMs}ms">${escapeHtml(part)}</${tag}>`;
      }).join('');
    }

    function _renderMatrixOp(op, idxRef, totalTokens, durationMs) {
      if (op.type === 'eq') return escapeHtml(op.text);

      const tag = op.type === 'del' ? 'del' : 'ins';
      const cls = op.type === 'del' ? 'diff-del diff-matrix-token diff-matrix-del' : 'diff-ins diff-matrix-token diff-matrix-ins';
      const maxDelay = Math.max(0, durationMs * 0.72);
      const effectMs = Math.max(700, Math.round(durationMs * 0.36));
      const denom = Math.max(1, totalTokens - 1);

      return String(op.text ?? '').split(/(\s+)/u).map(part => {
        if (!part) return '';
        if (/^\s+$/u.test(part)) return _renderWhitespaceChange(op, part, idxRef, totalTokens, true, durationMs);

        const i = idxRef.value++;
        const hash = _stableHash(`${i}:${part}:${op.type}`);
        const order = totalTokens <= 1 ? 0 : hash % totalTokens;
        const jitter = ((hash >>> 8) % 101) - 50;
        const delayMs = Math.max(0, Math.min(maxDelay, Math.round((maxDelay * order) / denom + jitter)));
        return `<${tag} class="${cls}" data-matrix="${escapeHtml(_matrixNoise(part))}" style="--delay:${delayMs}ms;--dur:${effectMs}ms">${escapeHtml(part)}</${tag}>`;
      }).join('');
    }

    function _countChangedTokens(ops) {
      return ops.reduce((sum, op) => {
        if (op.type === 'eq') return sum;
        return sum + String(op.text ?? '').split(/(\s+)/u).filter(part => part).length;
      }, 0);
    }

    function renderHtml(ops, mode = 'classic', options = {}) {
      if (mode === 'matrix') {
        const idxRef = { value: 0 };
        const durationMs = _clampEffectMs(options.durationMs);
        const totalTokens = _countChangedTokens(ops);
        return ops.map(op => _renderMatrixOp(op, idxRef, totalTokens, durationMs)).join('');
      }

      const idxRef = { value: 0 };
      const totalTokens = _countChangedTokens(ops);
      return ops.map(op => _renderClassicOp(op, idxRef, totalTokens)).join('');
    }

    return { compute, renderHtml };
  })();

  function _getDiffMode() {
    return _State?.getLayout?.()?.llm?.diffMode === 'matrix' ? 'matrix' : 'classic';
  }

  function _getDiffEffectMs() {
    const n = parseInt(_State?.getLayout?.()?.llm?.diffEffectMs, 10);
    if (!Number.isFinite(n)) return 3500;
    return Math.max(1000, Math.min(10000, Math.round(n / 50) * 50));
  }

  function _getBlockTextarea(blockId) {
    const el = document.querySelector(`[data-id="${blockId}"]`);
    if (!el) return null;
    return el.querySelector('textarea.block-textarea') ?? el.querySelector('textarea');
  }

  function _getScope(ta) {
    const hasSel = ta.selectionStart !== ta.selectionEnd;
    if (hasSel) {
      return {
        text:     ta.value.slice(ta.selectionStart, ta.selectionEnd),
        selStart: ta.selectionStart,
        selEnd:   ta.selectionEnd,
        hasSel:   true,
      };
    }
    return {
      text:     ta.value,
      selStart: 0,
      selEnd:   ta.value.length,
      hasSel:   false,
    };
  }

  function _applyToScope(ta, selStart, selEnd, newText) {
    ta.setRangeText(newText, selStart, selEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function _setBlockLoading(blockId, active) {
    document.querySelector(`[data-id="${blockId}"]`)?.classList.toggle('llm-loading', active);
  }

  function _showResultPanel(blockId, original, result, onDecide) {
    const blockEl = document.querySelector(`[data-id="${blockId}"]`);
    if (!blockEl) return;
    blockEl.querySelector('.llm-result-panel')?.remove();

    const tokBefore = _LLMCore.estimateTokens(original);
    const tokAfter  = _LLMCore.estimateTokens(result);
    const delta     = tokBefore > 0 ? Math.round((1 - tokAfter / tokBefore) * 100) : 0;

    const panel = document.createElement('div');
    panel.className = 'llm-result-panel';
    panel.innerHTML =
      `<div class="llm-result-toolbar">` +
        `<span class="llm-result-stats">~${tokBefore} → ~${tokAfter} токенов (${delta >= 0 ? '−' : '+'}${Math.abs(delta)}%)</span>` +
        `<button type="button" class="btn-sm btn-sm-accent" data-action="accept">✓ Принять</button>` +
        `<button type="button" class="btn-sm" data-action="reject">✕ Отклонить</button>` +
      `</div>` +
      `<div class="llm-result-content llm-result-content--${_getDiffMode()}">${DiffEngine.renderHtml(DiffEngine.compute(original, result), _getDiffMode(), { durationMs: _getDiffEffectMs() })}</div>`;

    const ta = _getBlockTextarea(blockId);
    if (ta?.parentNode) ta.parentNode.insertBefore(panel, ta.nextSibling);
    else blockEl.appendChild(panel);

    panel.querySelector('[data-action="accept"]').addEventListener('click', () => { panel.remove(); onDecide(true); });
    panel.querySelector('[data-action="reject"]').addEventListener('click', () => { panel.remove(); onDecide(false); });
  }

  async function groomBlock(blockId, mode) {
    if (!_guard()) return;
    if (mode === 'fill-placeholders') {
      SmartPlaceholders.fillAll();
      return;
    }
    const ta = _getBlockTextarea(blockId);
    if (!ta) { window.Toast?.show('Не найдена textarea блока', 'error'); return; }

    const { text, selStart, selEnd, hasSel } = _getScope(ta);
    if (!text.trim()) { window.Toast?.show('Нет текста для обработки', 'error'); return; }

    try { _withAutoSnap('groom ' + mode); } catch {}

    const modeAlias = mode === 'grammar' ? 'edit' : mode;
    if (modeAlias === 'grade') { PromptGrader.grade(); return; }

    const _chatModes     = ['positive_instr', 'negatives', 'summary', 'variations'];
    const _alwaysDiff    = ['grammar'];
    const _alwaysDirect  = ['edit', 'format', 'expand', 'formal', 'casual',
                            'tech', 'friendly', 'shrink_20', 'shrink_40', 'shrink_60'];

    let promptKey;
    if (modeAlias === 'positive_instr') promptKey = 'positive_instr';
    else if (modeAlias === 'negatives') promptKey = 'negatives';
    else if (modeAlias === 'summary') promptKey = 'summary';
    else if (modeAlias === 'variations') promptKey = 'variations';
    else promptKey = 'groom_' + modeAlias;

    const _groomNoLang = ['edit', 'format', 'shrink_20', 'shrink_40', 'shrink_60',
                          'expand', 'formal', 'casual', 'tech', 'friendly',
                          'negatives'];
    const _groomLang   = _groomNoLang.includes(modeAlias) ? '' : _LANG_INSTR;
    const basePrompt   = _LLMCore.getPrompt(promptKey);
    if (!basePrompt) {
      window.Toast?.show(`Не найден промпт: ${promptKey}`, 'error');
      return;
    }
    const systemPrompt = basePrompt + _groomLang;

    if (_chatModes.includes(modeAlias)) {
      _runGroomInChat(blockId, text, systemPrompt, mode, modeAlias);
      return;
    }

    const useDiff = _alwaysDiff.includes(mode) ||
                    (!_alwaysDirect.includes(modeAlias) && !!_State?.getLayout?.()?.llm?.visualDiff);

    _setBlockLoading(blockId, true);
    _showThinking('◕ Обрабатываю текст...');

    let accumulated = '';
    const blockEl   = document.querySelector(`[data-id="${blockId}"]`);
    if (!blockEl) { _setBlockLoading(blockId, false); _hideThinking(); return; }

    blockEl.querySelector('.llm-result-panel')?.remove();

    let previewPanel = null;
    let _streamRenderPending = false;

    if (useDiff) {
      previewPanel = document.createElement('div');
      previewPanel.className = 'llm-result-panel llm-result-panel--streaming';
      previewPanel.innerHTML =
        `<div class="llm-result-toolbar">` +
          `<span class="llm-result-stats">◕ Генерирую...</span>` +
          `<button type="button" class="btn-sm" data-action="cancel-stream">✕ Отмена</button>` +
        `</div>` +
        `<div class="llm-result-content" id="_groom-stream-${blockId}"></div>`;

      const currentTa = _getBlockTextarea(blockId);
      if (currentTa?.parentNode) currentTa.parentNode.insertBefore(previewPanel, currentTa.nextSibling);
      else blockEl.appendChild(previewPanel);
    }

    const abortCtrl = new AbortController();
    if (previewPanel) {
      previewPanel.querySelector('[data-action="cancel-stream"]')
        ?.addEventListener('click', () => abortCtrl.abort());
    }

    const _scheduleStreamRender = () => {
      if (!useDiff || _streamRenderPending) return;
      _streamRenderPending = true;
      requestAnimationFrame(() => {
        _streamRenderPending = false;
        const el = document.getElementById('_groom-stream-' + blockId);
        if (el) {
          const dm = _getDiffMode();
          el.classList.toggle('llm-result-content--matrix', dm === 'matrix');
          el.classList.toggle('llm-result-content--classic', dm !== 'matrix');
          el.innerHTML = DiffEngine.renderHtml(DiffEngine.compute(text, accumulated), dm, { durationMs: _getDiffEffectMs() });
        }
      });
    };

    try {
      const _groomStream = _State.getLayout()?.llm?.profiles
        ?.find(p => p.id === _State.getLayout()?.llm?.activeProfileId)
        ?.streaming ?? true;

      const result = await _LLMCore.request({
        messages:   [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }],
        stream:     _groomStream,
        signal:     abortCtrl.signal,
        onChunk:    delta => {
          if (!_groomStream) return;
          accumulated += delta;
          _scheduleStreamRender();
        },
        featureTag: 'groom',
      });

      if (previewPanel) previewPanel.remove();
      const _resultTrimmed = (result ?? '').trim();
      if (!_resultTrimmed) {
        window.Toast?.show('Модель вернула пустой ответ. Попробуйте снова.', 'error');
        return;
      }
      window.PromptLoom?.record?.(_resultTrimmed, 'llm', { via: 'groom-result', mode, blockId });

      if (useDiff) {
        _showResultPanel(blockId, text, _resultTrimmed, accepted => {
          if (!accepted) return;
          const applyTa = _getBlockTextarea(blockId);
          if (!applyTa) { window.Toast?.show('Не найден целевой блок', 'error'); return; }
          const applyStart = hasSel ? selStart : 0;
          const applyEnd   = hasSel ? selEnd   : applyTa.value.length;
          _applyToScope(applyTa, applyStart, applyEnd, _resultTrimmed);
          window.Toast?.show('Текст обновлён ✓', 'success');
        });
      } else {
        const applyTa = _getBlockTextarea(blockId);
        if (applyTa) {
          const applyStart = hasSel ? selStart : 0;
          const applyEnd   = hasSel ? selEnd   : applyTa.value.length;
          _applyToScope(applyTa, applyStart, applyEnd, _resultTrimmed);
          window.Toast?.show('Текст обновлён ✓', 'success');
        }
      }
    } catch (e) {
      if (previewPanel) previewPanel.remove();
      if (e.name !== 'AbortError') {
        window.Toast?.show('Ошибка причёсывания: ' + e.message, 'error');
      }
    } finally {
      _setBlockLoading(blockId, false);
      _hideThinking();
    }
  }

  function _runGroomInChat(blockId, text, systemPrompt, mode, modeAlias) {
    const labels = {
      positive_instr: 'Позитивные инструкции',
      negatives:      'Что пойдёт не так?',
      summary:        'Резюме вкладки',
      variations:     '3 варианта',
    };
    MiniChat.newSession();
    MiniChat.open();
    MiniChat.addSystemMessage('📊 ' + (labels[modeAlias] || modeAlias) + '...');
    MiniChat.pushToHistory('system', '📊 ' + (labels[modeAlias] || modeAlias) + '...');
    _showThinking('◕ Обрабатываю...');

    const isSummary = modeAlias === 'summary';
    const targetSessionIdx = MiniChat.getSessionIndex();

    _LLMCore.request({
      messages:   [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }],
      stream:     !isSummary,
      timeoutMs:  isSummary ? 180_000 : undefined,
      signal:     undefined,
      onChunk:    isSummary ? undefined : chunk => MiniChat.appendChunk(chunk),
      featureTag: 'groom',
    }).then(result => {
      MiniChat.ensureSession(targetSessionIdx);
      if (isSummary && String(result ?? '').trim()) MiniChat.appendChunk(result);
      MiniChat.finalizeLastMessage(result);
      if (String(result ?? '').trim()) {
        MiniChat.pushToHistory('assistant', result);
        window.PromptLoom?.record?.(result, 'llm', { via: 'groom-chat', mode, blockId });
      } else {
        MiniChat.pushToHistory('system', 'LLM вернул пустой ответ');
      }
    }).catch(e => {
      MiniChat.ensureSession(targetSessionIdx);
      if (e.name !== 'AbortError') {
        MiniChat.addSystemMessage('Ошибка: ' + e.message);
        MiniChat.pushToHistory('system', 'Ошибка: ' + e.message);
        window.Toast?.show(e.message, 'error');
      }
    }).finally(() => {
      _hideThinking();
    });
  }

  const PromptGrader = (() => {
    const CRITERIA = [
      { key: 'clarity',      label: 'Ясность',          desc: 'Понятно ли написано' },
      { key: 'specificity',  label: 'Точность',         desc: 'Конкретность инструкций' },
      { key: 'completeness', label: 'Полнота',          desc: 'Все ли контексты учтены' },
      { key: 'consistency',  label: 'Согласованность',  desc: 'Нет ли противоречий' },
      { key: 'conciseness',  label: 'Краткость',        desc: 'Нет ли лишнего' },
    ];

    function _escLocal(str) {
      const div = document.createElement('div');
      div.appendChild(document.createTextNode(str));
      return div.innerHTML;
    }

    let _busy = false;
    function _busyRelease() { _busy = false; }

    async function grade() {
      if (!_guard()) return;
      if (_busy) return;
      _busy = true;

      const text = window.Preview?.getText?.() ?? '';
      if (!text.trim()) {
        window.Toast?.show('Превью пустое', 'error');
        _busyRelease();
        return;
      }

      MiniChat.newSession();
      MiniChat.open();
      MiniChat.addSystemMessage('📊 Оцениваю промпт...');
      MiniChat.pushToHistory('user', 'Оцениваю промпт...');
      _showThinking('📊 Оцениваю промпт...');

      const targetSessionIdx = MiniChat.getSessionIndex();

      let raw;
      try {
        const systemPrompt = _LLMCore.getPrompt('grade_prompt');
        if (!systemPrompt) throw new Error('Prompt "grade_prompt" не найден');

        raw = await _LLMCore.request({
          messages: [
            { role: 'system', content: systemPrompt + _LANG_INSTR },
            { role: 'user',   content: text },
          ],
          stream:     false,
          maxTokens:  200,
          cacheKey:   _LLMCore.hashStr('grade|' + text),
          featureTag: 'grade',
        });
      } catch (e) {
        if (e.name !== 'AbortError') {
          const msg = 'Ошибка: ' + e.message;
          MiniChat.addSystemMessage(msg);
          window.Toast?.show(e.message, 'error');
        }
        _busyRelease();
        return;
      } finally {
        _hideThinking();
      }

      if (!raw || !raw.trim()) {
        MiniChat.addSystemMessage('Не удалось получить оценку — пустой ответ');
        _busyRelease();
        return;
      }

      let data;
      try {
        try {
          data = JSON.parse(raw.trim());
        } catch {
          const match = raw.match(/\{(?:[^{}]|(?:\{[^{}]*\}))*\}/);
          data = match ? JSON.parse(match[0]) : null;
        }
      } catch {
        MiniChat.finalizeLastMessage(raw);
        _busyRelease();
        return;
      }

      if (!data || typeof data !== 'object') {
        MiniChat.finalizeLastMessage(raw);
        _busyRelease();
        return;
      }

      MiniChat.ensureSession(targetSessionIdx);
      _renderScorecard(data);
      MiniChat.pushScorecard(data);
      _busyRelease();
    }

    function _renderScorecard(data, msgsEl) {
      const el = msgsEl || document.getElementById('llm-chat-messages');
      if (!el) return;

      const scores = CRITERIA.map(c => {
        const rawVal = data[c.key];
        const num = (rawVal != null && rawVal !== '') ? Number(rawVal) : NaN;
        const val = Number.isFinite(num) ? Math.min(10, Math.max(0, num)) : 0;
        return { ...c, val };
      });

      const avg      = scores.reduce((s, c) => s + c.val, 0) / scores.length;
      const avgStr   = avg.toFixed(1);
      const avgColor = avg >= 7 ? '#22c55e' : avg >= 5 ? '#f59e0b' : '#ef4444';

      const barsHtml = scores.map(c => {
        const color = c.val >= 7 ? '#22c55e' : c.val >= 5 ? '#f59e0b' : '#ef4444';
        const pct   = Math.round(c.val * 10);
        return `
          <div style="display:flex;align-items:center;gap:8px;margin:4px 0" title="${_escLocal(c.desc)}">
            <span style="width:110px;font-size:11px;color:var(--text2);flex-shrink:0">${_escLocal(c.label)}</span>
            <div style="width:55%;min-width:60px;height:6px;background:var(--bg1);border-radius:3px;overflow:hidden">
              <div data-bar="${pct}%" style="width:0;height:100%;background:${color};border-radius:3px"></div>
            </div>
            <span style="width:22px;text-align:right;font-size:12px;font-weight:600;color:${color}">${c.val}</span>
          </div>`;
      }).join('');

      const summaryHtml = data.summary
        ? `<p style="margin:10px 0 0;font-size:12px;color:var(--text2);border-top:1px solid var(--border);padding-top:8px">${_escLocal(data.summary)}</p>`
        : '';

      const card = document.createElement('div');
      card.className = 'llm-chat-msg assistant';
      card.innerHTML = `
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px">
          <span>📊 Оценка промпта</span>
          <span style="font-size:18px;font-weight:700;color:${avgColor}">${avgStr}</span>
          <span style="font-size:11px;color:var(--text3)">/ 10</span>
        </div>
        ${barsHtml}
        ${summaryHtml}`;

      el.appendChild(card);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          card.querySelectorAll('[data-bar]').forEach(b => {
            b.style.width = b.dataset.bar;
          });
        });
      });
      el.scrollTop = el.scrollHeight;
    }

    return { grade };
  })();

  const PromptAudit = (() => {
    let _busy = false;

    async function audit() {
      if (_busy) return;
      if (!_guard()) return;

      const text = window.Preview?.getText?.() ?? '';
      if (!text) {
        window.Toast?.show?.('Превью пустое', 'error');
        return;
      }

      _busy = true;
      MiniChat.newSession();
      MiniChat.open();
      MiniChat.addSystemMessage('🔎 Анализирую промпт...');
      MiniChat.pushToHistory('user', text);
      _showThinking('🔎 Анализирую...');

      try {
        const systemPrompt = (_LLMCore.getPrompt('audit') ?? '') + (_LANG_INSTR ?? '');
        const result = await _LLMCore.request({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: text },
          ],
          stream:     true,
          maxTokens:  1500,
          onChunk:    chunk => MiniChat.appendChunk(chunk),
          featureTag: 'audit',
        });
        MiniChat.finalizeLastMessage(result);
        if (String(result ?? '').trim()) MiniChat.pushToHistory('assistant', result);
      } catch (e) {
        if (e?.name !== 'AbortError') {
          const message = e?.message ?? 'Неизвестная ошибка';
          MiniChat.addSystemMessage('Ошибка: ' + message);
          window.Toast?.show?.(message, 'error');
        }
      } finally {
        _busy = false;
        _hideThinking();
      }
    }

    return { audit };
  })();

  const TokenOptimizer = (() => {
    let _compressing = false;

    async function compress() {
      if (!_guard()) return;
      if (_compressing) return;
      const text = window.Preview?.getText?.() ?? '';
      if (!text) { window.Toast?.show('Превью пустое', 'error'); return; }

      _compressing = true;
      try {
        _withAutoSnap('compress');
        const toksBefore = _LLMCore.estimateTokens(text) || 0;
        MiniChat.newSession();
        MiniChat.open();
        MiniChat.addSystemMessage('✂️ Сжимаю токены...');
        MiniChat.pushToHistory('user', text);
        _showThinking('✂️ Сжимаю...');

        const result = await _LLMCore.request({
          messages: [
            { role: 'system', content: _LLMCore.getPrompt('compress') + (_LANG_INSTR ?? '') },
            { role: 'user',   content: text },
          ],
          stream:     true,
          onChunk:    chunk => MiniChat.appendChunk(chunk),
          featureTag: 'compress',
        });

        if (result != null) {
          MiniChat.finalizeLastMessage(result);
          if (String(result ?? '').trim()) MiniChat.pushToHistory('assistant', result);
          const toksAfter = _LLMCore.estimateTokens(result) || 0;
          const pct = toksBefore > 0 ? Math.round((1 - toksAfter / toksBefore) * 100) : 0;
          MiniChat.addSystemMessage(`Было ~${toksBefore} → стало ~${toksAfter} токенов (−${pct}%)`);
          window.Intelligence?.track?.('llm.action.success', {
            featureKey: 'compress',
            inputTokens: toksBefore,
            outputTokens: toksAfter,
            outputChars: String(result ?? '').length
          });
        } else {
          MiniChat.addSystemMessage('Сжатие вернуло пустой результат');
        }
      } catch (e) {
        if (e?.name !== 'AbortError') {
          const msg = e?.message || 'Неизвестная ошибка';
          MiniChat.addSystemMessage('Ошибка: ' + msg);
          window.Intelligence?.track?.('llm.action.error', {
            featureKey: 'compress',
            message: msg
          });
          window.Toast?.show(msg, 'error');
        }
      } finally {
        _hideThinking();
        _compressing = false;
      }
    }

    return { compress };
  })();

  const SmartPlaceholders = (() => {
    async function fillAll() {
      const t = _State?.getActive();
      if (!t) return;
      if (!_guard()) return;

      const RE   = /\{\{llm:\s*([^}]+)\}\}/gi;
      const jobs = [];

      for (const block of t.blocks ?? []) {
        if (block.type !== 'text') continue;
        for (const [si, st] of (block.subtabs ?? []).entries()) {
          let m;
          RE.lastIndex = 0;
          while ((m = RE.exec(st.value ?? '')) !== null) {
            const instruction = m[1].trim();
            if (!instruction) continue;
            jobs.push({
              blockId: block.id, subtabIdx: si,
              full: m[0], instruction,
              index: m.index, end: m.index + m[0].length,
            });
          }
        }
      }

      if (!jobs.length) {
        window.Toast?.show('Плейсхолдеры {{llm:...}} не найдены', 'info');
        return;
      }

      _withAutoSnap('fill placeholders');
      _showThinking(`◕ Заполняю ${jobs.length} плейсхолдеров...`);

      let results;
      try {
        results = await Promise.allSettled(
          jobs.map(job =>
            _LLMCore.request({
              messages:   [{ role: 'user', content: _LLMCore.getPrompt('fill_ph', { instruction: job.instruction }) + _LANG_INSTR }],
              maxTokens:  200,
              cacheKey:   _LLMCore.hashStr('placeholder|' + job.instruction),
              featureTag: 'placeholder',
            }).then(res => ({ ...job, result: String(res ?? '').trim() }))
          )
        );
      } catch (err) {
        _hideThinking();
        console.error('SmartPlaceholders: request start failed', err);
        window.Toast?.show('Ошибка при заполнении плейсхолдеров', 'error');
        return;
      }

      _hideThinking();

      const grouped = new Map();
      let failedCount = 0;

      for (const r of results) {
        if (r.status === 'fulfilled') {
          const key = r.value.blockId + ':' + r.value.subtabIdx;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push(r.value);
        } else {
          failedCount++;
        }
      }

      let filledCount = 0;

      if (grouped.size > 0) {
        _State.update(tab => {
          for (const [, group] of grouped) {
            const { blockId, subtabIdx } = group[0];
            const block = _State.findBlock(tab.blocks, blockId);
            if (!block?.subtabs?.[subtabIdx]) continue;

            let val = block.subtabs[subtabIdx].value ?? '';
            group.sort((a, b) => b.index - a.index).forEach(job => {
              val = val.slice(0, job.index) + job.result + val.slice(job.end);
              filledCount++;
            });
            block.subtabs[subtabIdx].value = val;
          }
        });
      }

      let msg, severity;
      if (filledCount > 0) {
        msg = `Заполнено ${filledCount} плейсхолдеров ✓`;
        if (failedCount > 0) msg += `, ${failedCount} не удалось`;
        severity = 'success';
      } else if (failedCount > 0) {
        msg = `Не удалось заполнить плейсхолдеры (${failedCount} ошибок)`;
        severity = 'warning';
      } else {
        msg = 'Плейсхолдеры не заполнены: вкладка была изменена';
        severity = 'warning';
      }

      window.Toast?.show(msg, severity);
    }

    return { fillAll };
  })();

  const BroTags = (() => {
    const _extShowThinking = typeof _showThinking === 'function' ? _showThinking : null;
    const _extHideThinking = typeof _hideThinking === 'function' ? _hideThinking : null;

    const _blockChats = new Map();
    const _blockModes = new Map();
    const _processing = new Set();

    const _TAGS = {
      '!бро':    { action: 'chat', useTabContext: false },
      '!вопрос': { action: 'ask',  useTabContext: true  },
      '!фикс':   { action: 'fix',  useTabContext: false },
      '!ру':     { action: 'ru',   useTabContext: true  },
      '!эн':     { action: 'eng',  useTabContext: true  },
      '!сум':    { action: 'sum',  useTabContext: true  },
      '!план':   { action: 'plan', useTabContext: true  },
    };

    const _START_TAG = '!старт';

    const _MODE_PROMPTS = {
  'кратко':
    '\n\nВАЖНО: Отвечай кратко и по делу: 1–3 предложения. Не добавляй примеры, списки и пояснения, если их не просили явно. Без вступлений и выводов.',
  'подробно':
    '\n\nВАЖНО: Отвечай развёрнуто и структурно. Дай пояснения, примеры и альтернативные варианты, если это помогает задаче. Не уходи в лишние детали.',
};

    function handle(e, ta, blockId) {
      if (_processing.has(blockId)) return false;

      const lineInfo = _getBroCommandAtCursor(ta);
      if (!lineInfo) return false;
      const line = lineInfo.command.trim();

      if (line.toLowerCase() === _START_TAG) {
        e.preventDefault();
        clearHistory(blockId);
        _deleteBroCommand(ta, lineInfo);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        _showSuccess('История диалога блока сброшена');
        return true;
      }

      const match = line.match(/^(!!?[^\s]+)(?:\s+(.*))?$/);
      if (!match) return false;

      const rawTag = match[1] || '';
      const tag   = rawTag.toLowerCase().replace(/^!!/, '!');
      const query = (match[2] ?? '').trim();

      if (tag === '!режим') {

        e.preventDefault();
        _setMode(blockId, query);
        _deleteBroCommand(ta, lineInfo);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }

      if (tag === '!история') {
        e.preventDefault();
        _showBlockHistory(ta, blockId, lineInfo);
        return true;
      }

      const tagDef = _getTagDef(tag);
      if (!tagDef) return false;

      if (typeof _guard === 'function' && !_guard()) return false;

      const replaceWholeTab = rawTag.startsWith('!!') && !!tagDef.custom;

      e.preventDefault();
      _execute(ta, blockId, tag, query, tagDef, { replaceWholeTab, lineInfo });

      return true;
    }

    function clearHistory(blockId) {
      _blockChats.delete(blockId);
      _blockModes.delete(blockId);
    }

    function _getTagDef(tag) {
      if (_TAGS[tag]) return _TAGS[tag];
      const custom = (_State.getLayout()?.llm?.bro?.tags ?? []).find(t => t.custom && t.tag === tag);
      if (!custom?.prompt?.trim()) return null;
      return { action: 'custom', custom: true, useTabContext: custom.useTabContext !== false, prompt: custom.prompt.trim(), profileId: custom.profileId || null };

    }

    function _setMode(blockId, modeQuery) {
      const mode = (modeQuery ?? '').toLowerCase().trim();

      if (!mode || mode === 'сброс' || mode === 'reset') {
        _blockModes.delete(blockId);
        _showSuccess('Режим сброшен — стандартные ответы');
        return;
      }

      if (_MODE_PROMPTS[mode]) {
        _blockModes.set(blockId, mode);
        _showSuccess('Режим: «' + mode + '» ✓');
        return;
      }

      _showError(
        'Неизвестный режим: «' + modeQuery + '». ' +
        'Доступно: !режим кратко, !режим подробно, !режим сброс'
      );
    }

    function _showBlockHistory(ta, blockId, lineInfo = null) {
      const history = _blockChats.get(blockId) ?? [];
      _deleteBroCommand(ta, lineInfo);

      if (!history.length) {
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        _showSuccess('Память диалога текущего блока пуста');
        return;
      }

      const depth = _State.getLayout()?.llm?.bro?.chatDepth ?? 6;
      const lines = history.map((m, i) => {
        const pair = Math.floor(i / 2) + 1;
        const label = m.role === 'user' ? 'Вы' : 'БРО';
        return `${pair}. ${label}: ${String(m.content ?? '').trim()}`;
      });

      _appendAtCursor(
        ta,
        '\n[Память БРО-диалога: последние ' + Math.ceil(history.length / 2) + ' из ' + depth + ']\n' +
        lines.join('\n\n') +
        '\n[/Память БРО-диалога]\n\n'
      );
      _showSuccess('Память диалога вставлена в блок');
    }

    function _getCurrentLine(ta) {
      const val = ta.value, end = ta.selectionStart;
      return val.slice(val.lastIndexOf('\n', end - 1) + 1, end);
    }

    function _getBroCommandAtCursor(ta) {
      if (!ta) return null;
      const val = String(ta.value || '');
      const cursor = Math.max(0, Math.min(ta.selectionStart ?? 0, val.length));
      const lineStart = val.lastIndexOf('\n', cursor - 1) + 1;
      const lineEndRaw = val.indexOf('\n', cursor);
      const lineEnd = lineEndRaw >= 0 ? lineEndRaw : val.length;
      const lineText = val.slice(lineStart, lineEnd);
      const fullLineTrimmed = lineText.trim();
      if (!fullLineTrimmed) return null;

      const tokenRegex = /(^|\s)(!!?[^\s\n]+)(?:\s+([^\n]*))?/g;
      let match;
      let best = null;

      while ((match = tokenRegex.exec(lineText)) !== null) {
        const leading = match[1] || '';
        const rawTag = match[2] || '';
        const args = match[3] || '';
        const tokenStart = lineStart + match.index + leading.length;
        const tagEnd = tokenStart + rawTag.length;
        const commandEnd = lineEnd;
        const isCursorInside = cursor >= tokenStart && cursor <= commandEnd;
        const isCursorAfter = cursor > commandEnd;

        if (!rawTag.startsWith('!')) continue;
        if (!isCursorInside && !isCursorAfter) continue;

        best = {
          command: lineText.slice(tokenStart - lineStart, commandEnd - lineStart),
          rawTag,
          query: args.trim(),
          lineStart,
          lineEnd,
          commandStart: tokenStart,
          commandEnd,
          tagEnd,
          isFullLineCommand: fullLineTrimmed.startsWith(rawTag) && fullLineTrimmed === lineText.slice(tokenStart - lineStart).trim(),
        };
      }

      return best;
    }

    function _getLineStart(ta) {
      return ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    }

    function _deleteBroCommand(ta, lineInfo = null) {
      const info = lineInfo || _getBroCommandAtCursor(ta);
      if (!info) return;
      const val = String(ta.value || '');
      const start = info.commandStart;
      const end = info.commandEnd;
      const before = val.slice(0, start);
      const after = val.slice(end);
      ta.value = before + after;
      const nextPos = start;
      ta.selectionStart = ta.selectionEnd = nextPos;
    }

    function _deleteBroLine(ta) {
      const val       = ta.value;
      const cursor    = ta.selectionStart;
      const lineStart = val.lastIndexOf('\n', cursor - 1) + 1;
      const lineEnd   = val.indexOf('\n', cursor);
      ta.value = val.slice(0, lineStart) + (lineEnd >= 0 ? val.slice(lineEnd + 1) : '');
      ta.selectionStart = ta.selectionEnd = lineStart;
    }

    function _getTabTextWithoutTagLine(ta, lineInfo = null) {
      const info = lineInfo || _getBroCommandAtCursor(ta);
      if (!info) return String(ta.value || '');
      const val = String(ta.value || '');
      const before = val.slice(0, info.commandStart);
      const after = val.slice(info.commandEnd);
      return before + after;
    }

    function _appendAtCursor(ta, text) {
      const pos = ta.selectionStart;
      ta.setRangeText(text, pos, pos, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function _replaceAll(ta, newText) {
      ta.value = newText;
      ta.selectionStart = ta.selectionEnd = newText.length;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function _removePlaceholder(ta, expectedPos) {
      const val   = ta.value;
      const phIdx = val.indexOf('◔ ...', Math.max(0, expectedPos - 2));
      if (phIdx < 0) return;
      const pLineStart = val.lastIndexOf('\n', phIdx) + 1;
      const pLineEnd   = val.indexOf('\n', phIdx);
      ta.setRangeText('', pLineStart, pLineEnd >= 0 ? pLineEnd + 1 : val.length, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function _showError(msg) {
      if (typeof window !== 'undefined' && window.Toast?.show) {
        window.Toast.show(msg, 'error');
      } else {
        console.error('[BroTags]', msg);
      }
    }

    function _showSuccess(msg) {
      if (typeof window !== 'undefined' && window.Toast?.show) {
        window.Toast.show(msg, 'success');
      }
    }

    function _showThinkingSafe(msg) {
      if (_extShowThinking) _extShowThinking(msg);
    }

    function _hideThinkingSafe() {
      if (_extHideThinking) _extHideThinking();
    }

    function _getSystemPrompt(action, blockId) {
      const map = {
        chat: 'bro_system',
        fix:  'fix_system',
        eng:  'eng_system',
        ru:   'ru_system',
        sum:  'sum_system',
        ask:  'ask_system',
        plan: 'plan_system',
      };
      const prompt    = (_LLMCore.getPrompt(map[action] ?? 'bro_system') ?? '');
      const langInstr = (typeof _LANG_INSTR === 'string') ? _LANG_INSTR : '';
      const mode      = _blockModes.get(blockId);
      const modeInstr = mode ? (_MODE_PROMPTS[mode] ?? '') : '';
      return prompt + langInstr + modeInstr;
    }

    function _findStartContext(ta, endPos) {
      const searchEnd    = endPos ?? ta.selectionStart;
      const beforeCursor = ta.value.slice(0, searchEnd);
      const lowerBefore  = beforeCursor.toLowerCase();
      const startIdx     = lowerBefore.lastIndexOf(_START_TAG);
      if (startIdx < 0) return null;
      const ctx = beforeCursor.slice(startIdx + _START_TAG.length).replace(/^\n/, '').trimEnd();
      return ctx || null;
    }

    function _formatResult(text, action) {
      const trimmed = text.trim();
      if (!trimmed) return '\n\n';
      if (action === 'ask') {
        return '\n' + trimmed.split('\n').map(l => '> ' + l).join('\n') + '\n\n';
      }
      return '\n' + trimmed + '\n\n';
    }

    function _trackCustomTagUse(tag) {
      if (!tag || _TAGS[tag]) return;
      const lay = _State.getLayout();
      const customTag = (lay?.llm?.bro?.tags ?? []).find(t => t.custom && t.tag === tag);
      if (!customTag) return;
      const usage = { ...(lay?.llm?.bro?.usage ?? {}) };
      usage[tag] = (parseInt(usage[tag], 10) || 0) + 1;
      _State.setLayout({ llm: { ...(lay?.llm ?? {}), bro: { ...(lay?.llm?.bro ?? {}), usage } } });
    }

    async function _execute(ta, blockId, tag, query, tagDef, options = {}) {

      if (_processing.has(blockId)) return;
      _processing.add(blockId);

      const streaming = _State.getLayout()?.llm?.streaming ?? true;
      const replaceWholeTab = !!options.replaceWholeTab;
      ta.classList.add('llm-bro-processing');

      let placeholderStart = null;

      try {
        const action = tagDef.action;
        const isConv = action === 'chat' || action === 'ask';

        const msgs = [{ role: 'system', content: (tagDef.prompt ? tagDef.prompt + _LANG_INSTR + (_blockModes.get(blockId) ? (_MODE_PROMPTS[_blockModes.get(blockId)] ?? '') : '') : _getSystemPrompt(action, blockId)) }];
        if (isConv) msgs.push(...(_blockChats.get(blockId) ?? []));

        let userContent;
        if (tagDef.useTabContext) {
          const cleaned = _getTabTextWithoutTagLine(ta, options.lineInfo).trim();
          userContent   = query ? `${cleaned}\n\n${query}` : cleaned;
        } else {
          const lineStart = options.lineInfo?.commandStart ?? _getLineStart(ta);
          const startCtx  = _findStartContext(ta, lineStart);
          userContent     = startCtx ? `${startCtx}\n\n${query}` : query;
        }

        if (!userContent.trim()) {
          _showError('Нет текста для обработки');
          return;
        }

        msgs.push({ role: 'user', content: userContent });

        _deleteBroCommand(ta, options.lineInfo);

        const lay        = _State.getLayout();
        const tagProfile = (lay?.llm?.bro?.tags ?? []).find(t => t.tag === tag)?.profileId;
        const profileId  = tagDef.profileId || tagProfile || lay?.llm?.activeProfileId || null;

        let result = '';

        if (action === 'sum') {
          MiniChat.newSession();
          MiniChat.open();
          MiniChat.addSystemMessage('📝 Суммаризирую...');
          MiniChat.pushToHistory('user', userContent);
          _showThinkingSafe('📝 Суммаризирую...');
          try {
            result = await _LLMCore.request({
              profileId,
              messages:   msgs,
              stream:     true,
              onChunk:    chunk => MiniChat.appendChunk(chunk),
              featureTag: 'bro_sum',
            });
            MiniChat.finalizeLastMessage(result);
            if (String(result ?? '').trim()) MiniChat.pushToHistory('assistant', result);
          } finally {
            _hideThinkingSafe();
          }

        } else if (action === 'ru' || action === 'eng') {
          _showThinkingSafe(action === 'ru' ? '🔤 ↶ ⓇⓊ' : '🔤 ↷ ⒺⓃ');
          try {
            result = await _LLMCore.request({
              profileId,
              messages:   msgs,
              stream:     false,
              featureTag: 'bro_' + tag,
            });
            _replaceAll(ta, result.trim());
            _showSuccess(action === 'ru' ? 'ⓇⓊ ✓' : 'ⒺⓃ ✓');
          } finally {
            _hideThinkingSafe();
          }

        } else if (streaming && !replaceWholeTab) {
          const insertPos   = ta.selectionStart;
          const placeholder = '\n◔ ...\n';
          ta.setRangeText(placeholder, insertPos, insertPos, 'end');
          const phStart = insertPos + 1;
          placeholderStart = phStart;

          result = await _LLMCore.request({
            profileId,
            messages:   msgs,
            stream:     true,
            onChunk:    () => {},
            featureTag: 'bro_' + tag,
          });

          const formatted  = _formatResult(result, action);
          const currentVal = ta.value;
          const phIdx      = currentVal.indexOf('◔ ...', Math.max(0, phStart - 2));

          if (phIdx >= 0) {
            const pLineStart = currentVal.lastIndexOf('\n', phIdx) + 1;
            const pLineEnd   = currentVal.indexOf('\n', phIdx);
            const replaceText = formatted.replace(/^\n/, '');
            ta.setRangeText(replaceText, pLineStart, pLineEnd >= 0 ? pLineEnd + 1 : currentVal.length, 'end');
          } else {
            _appendAtCursor(ta, formatted);
          }
          ta.dispatchEvent(new Event('input', { bubbles: true }));

        } else {
          result = await _LLMCore.request({
            profileId,
            messages:   msgs,
            stream:     false,
            featureTag: 'bro_' + tag,
          });
          if (replaceWholeTab) _replaceAll(ta, result.trim());
          else _appendAtCursor(ta, _formatResult(result, action));
        }

        if (isConv && result) {
          const history = _blockChats.get(blockId) ?? [];
          history.push({ role: 'user', content: userContent });
          history.push({ role: 'assistant', content: result });
          const depth = _State.getLayout()?.llm?.bro?.chatDepth ?? 6;
          if (history.length > depth * 2) history.splice(0, history.length - depth * 2);
          _blockChats.set(blockId, history);
        }

        _trackCustomTagUse(tag);

      } catch (err) {

        if (err.name !== 'AbortError') {
          console.error('[BroTags] _execute error:', err);
          _showError('BroTags ошибка: ' + (err.message || String(err)));
        }
        if (placeholderStart !== null) {
          try { _removePlaceholder(ta, placeholderStart); } catch (_) {}
        }
      } finally {
        ta.classList.remove('llm-bro-processing');
        _processing.delete(blockId);
      }
    }

    function getQuickMenuItems(query = '') {
      const lay = _State.getLayout();
      const usage = lay?.llm?.bro?.usage ?? {};
      const builtinOrder = ['!бро', '!фикс', '!вопрос', '!план', '!сум', '!эн', '!ру', '!история', '!режим', '!старт'];
      const builtinDefs = [
        { tag: '!бро', label: '!бро' },
        { tag: '!фикс', label: '!фикс' },
        { tag: '!вопрос', label: '!вопрос' },
        { tag: '!план', label: '!план' },
        { tag: '!сум', label: '!сум' },
        { tag: '!эн', label: '!эн' },
        { tag: '!ру', label: '!ру' },
        { tag: '!история', label: '!история' },
        { tag: '!режим', label: '!режим' },
        { tag: '!старт', label: '!старт' },
      ];
      const customDefs = Array.from(new Map(
        (lay?.llm?.bro?.tags ?? [])
          .filter(t => t.custom && t.tag && String(t.prompt || '').trim())
          .map(t => {
            const tag = String(t.tag).toLowerCase().trim();
            return [tag, {
              tag,
              label: tag,
              custom: true,
              uses: parseInt(usage[tag], 10) || 0,
            }];
          })
      ).values());

      const q = String(query || '').trim().toLowerCase();
      const customSorted = [...customDefs].sort((a, b) => {
        if ((b.uses || 0) !== (a.uses || 0)) return (b.uses || 0) - (a.uses || 0);
        return a.tag.localeCompare(b.tag, 'ru');
      });
      const builtinSorted = builtinDefs.sort((a, b) => builtinOrder.indexOf(a.tag) - builtinOrder.indexOf(b.tag));
      const merged = [...customSorted, ...builtinSorted];
      const filtered = q ? merged.filter(item => item.tag.includes(q)) : merged;
      return filtered.slice(0, 10);
    }

    return { handle, clearHistory, getQuickMenuItems };

  })();

// =AutoPoet=
const AutoPoet = (() => {
  let _ghost = null;
  let _debounceTimer = null;
  let _matrixTimer = null;
  let _reqSeq = 0;
  let _resizeBound = false;
  let _observer = null;
  let _lastGoodSeed = '';
  let _requesting = false;

  const _acceptedMarks = new WeakMap();
  const _suppressNextAuto = new WeakSet();

  const _WORD_RE = /(\p{L}[\p{L}\p{N}'’_-]*|\p{N}+)$/u;
  const _SENTENCE_END_RE = /[.!?…](?:["'»”)]*)?\s*$/u;
  const _SOFT_BREAK_RE = /(?:^|[\n.!?…])\s*([^\n.!?…]{0,240})$/u;
  const _PUNCT_RE = /^[.,!?;:…]$/u;
  const _PUNCT_AFTER_SPACE_RE = /\s([.,!?;:…])$/u;
  const _MATRIX_CHARS = 'абвгдежзийклмнопрстуфхцчшщьыъэюяABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  function _getConfig() {
    return _State?.getLayout()?.llm?.ghost ?? {};
  }

  function _hasReadyProfile(cfg) {
    if (!_isEnabled()) return false;
    const lay = _State?.getLayout?.();
    const profileId = cfg.profileId || lay?.llm?.activeProfileId;
    if (!profileId) return false;
    return (lay?.llm?.profiles ?? []).some(p => p.id === profileId);
  }

  function _escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function _cssBlockSelector(blockId) {
    const id = String(blockId ?? '');
    if (typeof CSS !== 'undefined' && CSS.escape) {
      return `[data-id="${CSS.escape(id)}"]`;
    }
    return `[data-id="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
  }

  function _ensureFallbackGhost() {
    let el = document.getElementById('llm-autopoet-ghost');
    if (!el) {
      el = document.createElement('div');
      el.id = 'llm-autopoet-ghost';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = [
        'position:fixed',
        'display:none',
        'pointer-events:none',
        'user-select:none',
        'white-space:pre',
        'overflow:hidden',
        'z-index:9000',
        'background:transparent',
        'color:rgba(102,255,198,.72)',
        'text-shadow:0 0 8px rgba(80,255,190,.45)',
      ].join(';');
      document.body.appendChild(el);
    }
    return el;
  }

  function _getCaretXY(ta, pos) {
    const cs = window.getComputedStyle(ta);
    const mirror = document.createElement('div');
    const props = [
      'boxSizing',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
      'letterSpacing', 'wordSpacing', 'lineHeight',
      'textIndent', 'textTransform', 'tabSize', 'MozTabSize',
      'wordBreak', 'overflowWrap',
    ];

    props.forEach(p => { mirror.style[p] = cs[p]; });
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';
    mirror.style.top = '-9999px';
    mirror.style.left = '-9999px';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.overflow = 'hidden';

    const pl = parseFloat(cs.paddingLeft) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    mirror.style.boxSizing = 'content-box';
    mirror.style.width = Math.max(0, ta.clientWidth - pl - pr) + 'px';

    const before = document.createTextNode(ta.value.slice(0, pos));
    const marker = document.createElement('span');
    marker.style.cssText = 'display:inline-block;width:0;height:0;overflow:hidden;vertical-align:top;';
    mirror.appendChild(before);
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    const taRect = ta.getBoundingClientRect();
    const mRect = marker.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();

    const x = mRect.left - mirrorRect.left + taRect.left - ta.scrollLeft;
    const y = mRect.top - mirrorRect.top + taRect.top - ta.scrollTop;

    mirror.remove();

    const fontSize = parseFloat(cs.fontSize) || 12;
    const lh = parseFloat(cs.lineHeight) || fontSize * 1.4;

    return { x, y, lh };
  }

  function _showFallbackGhost(ta, text, pos) {
    const el = _ensureFallbackGhost();
    const cs = window.getComputedStyle(ta);
    const caret = _getCaretXY(ta, pos);
    const rect = ta.getBoundingClientRect();

    if (caret.y < rect.top || caret.y + caret.lh > rect.bottom) {
      _hideFallbackGhost();
      return;
    }

    el.style.fontFamily = cs.fontFamily;
    el.style.fontSize = cs.fontSize;
    el.style.fontWeight = cs.fontWeight;
    el.style.lineHeight = cs.lineHeight;
    el.style.letterSpacing = cs.letterSpacing;
    el.style.left = Math.round(caret.x + 5) + 'px';
    el.style.top = Math.round(caret.y) + 'px';
    el.style.maxWidth = Math.max(0, rect.right - caret.x - 8) + 'px';
    el.innerHTML = _escHtml(text);
    el.style.display = 'block';
  }

  function _hideFallbackGhost() {
    const el = document.getElementById('llm-autopoet-ghost');
    if (!el) return;
    el.style.display = 'none';
    el.textContent = '';
  }

  function _showGhost(ta, text, pos, forceFallback = false) {
    if (!forceFallback && window.InlineHint?.show) {
      _hideFallbackGhost();
      window.InlineHint.show(ta, text);
      return;
    }
    _showFallbackGhost(ta, text, pos);
  }

  function _clearMatrixTimer() {
    if (_matrixTimer !== null) {
      clearTimeout(_matrixTimer);
      _matrixTimer = null;
    }
  }

  function _matrixEnabled(cfg) {
    return !!(cfg.matrixEffect === true || cfg.matrix === true);
  }

  function _clampMatrixEffectMs(value, fallback = 3500) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1000, Math.min(10000, Math.round(n / 50) * 50));
  }

  function _buildMatrixRevealPlan(text, durationMs) {
    const chars = Array.from(text);
    const indexes = chars
      .map((ch, i) => (/\s/u.test(ch) ? null : i))
      .filter(i => i !== null);

    indexes.sort(() => Math.random() - 0.5);

    const revealAt = new Map();
    const start = Math.min(220, durationMs * 0.08);
    const span = Math.max(600, durationMs * 0.78);
    indexes.forEach((idx, order) => {
      const t = order / Math.max(1, indexes.length - 1);
      const jitter = (Math.random() - 0.5) * Math.min(240, durationMs * 0.10);
      revealAt.set(idx, Math.max(0, Math.min(durationMs - 80, start + span * t + jitter)));
    });

    return { chars, revealAt };
  }

  function _randomMatrixText(plan, elapsedMs, durationMs) {
    let out = '';
    const phase = Math.min(1, Math.max(0, elapsedMs / Math.max(1, durationMs)));

    for (let i = 0; i < plan.chars.length; i++) {
      const ch = plan.chars[i];

      if (/\s/u.test(ch) || elapsedMs >= (plan.revealAt.get(i) ?? durationMs)) {
        out += ch;
      } else if (phase > 0.86 && Math.random() > 0.72) {
        out += ch;
      } else {
        out += _MATRIX_CHARS[Math.floor(Math.random() * _MATRIX_CHARS.length)];
      }
    }

    return out;
  }

  function _showGhostMaybeMatrix(ta, text, pos, cfg) {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    _clearMatrixTimer();

    if (!_matrixEnabled(cfg) || reduced || text.length < 2) {
      _showGhost(ta, text, pos);
      return;
    }

    const seq = _ghost?.seq;
    const durationMs = _clampMatrixEffectMs(cfg?.matrixEffectMs ?? cfg?.matrixMs);
    const plan = _buildMatrixRevealPlan(text, durationMs);
    const startedAt = performance.now();

    const tick = () => {
      if (!_ghost || _ghost.seq !== seq || _ghost.ta !== ta) return;

      const elapsed = performance.now() - startedAt;
      const done = elapsed >= durationMs;
      const visibleText = done ? text : _randomMatrixText(plan, elapsed, durationMs);

      // =matrix всегда через fallback=
      _showGhost(ta, visibleText, pos, true);

      if (!done) {
        _matrixTimer = setTimeout(tick, 50);
      } else {
        _matrixTimer = null;
      }
    };

    tick();
  }

  function _hideGhostView() {
    _clearMatrixTimer();

    if (window.InlineHint?.getActiveTa?.() === _ghost?.ta) {
      window.InlineHint.hide();
    }

    _hideFallbackGhost();
  }

  function _clearGhost() {
    _ghost = null;
    _hideGhostView();
  }

  function _getCurrentWord(beforeCursor) {
    return beforeCursor.match(_WORD_RE)?.[1] ?? '';
  }

  function _getTriggerText(beforeCursor) {
    const m = beforeCursor.match(_SOFT_BREAK_RE);
    return (m?.[1] ?? beforeCursor).trim();
  }

  function _getWordsLimit(cfg) {
    const raw =
      cfg.words ??
      cfg.maxWords ??
      cfg.wordsInHint ??
      cfg.suggestionWords ??
      cfg.wordCount ??
      5;

    return Math.max(1, Math.min(30, Number(raw) || 5));
  }

  function _getMinChars(cfg) {
    return Math.max(0, Number(cfg.minChars) || 0);
  }

  function _getSeed(beforeCursor, cfg) {
    return beforeCursor.slice(-Math.max(40, _getMinChars(cfg) + 20));
  }

  function _hasEnoughFreshText(beforeCursor, cfg, manual) {
    if (manual) return true;

    const minChars = _getMinChars(cfg);
    if (minChars <= 0) return true;

    const triggerText = _getTriggerText(beforeCursor);
    return triggerText.length >= minChars;
  }

  function _isBadContext(ta, cfg, manual = false) {
    if (ta.selectionStart !== ta.selectionEnd) return true;

    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const tail = before.slice(-120);

    if (!before.trim()) return true;
    if (!manual && !_hasEnoughFreshText(before, cfg, false)) return true;
    if (cfg.noVars && /\{\{[^}\n]*$/.test(tail)) return true;
    if (cfg.noVars && /(^|\n)\s*![^\s]*$/u.test(tail)) return true;
    if (cfg.noCode && /(?:[{};=<>()[\]]|```)\s*$/u.test(tail)) return true;
    if (cfg.noLists && /(^|\n)\s*(?:[-*+]|\d+[.)])\s*$/u.test(tail)) return true;
    if (!manual && /(^|\n)\s*$/u.test(tail)) return true;

    return false;
  }

  function _sliceByWords(text, n) {
    const parts = String(text ?? '').trim().match(/\S+/gu) ?? [];
    return parts.slice(0, Math.max(1, n)).join(' ');
  }

  function _sliceBySentence(text) {
    const trimmed = String(text ?? '').trimStart();
    const m = trimmed.match(/^.+?[.!?…](?=\s|$)/u);
    return (m ? m[0] : trimmed).trimEnd();
  }

  function _stripThinking(raw) {
    let txt = String(raw ?? '').replace(/^\uFEFF/, '');

    txt = txt
      .replace(/<think>[\s\S]*?<\/think>/giu, '')
      .replace(/<thinking>[\s\S]*?<\/thinking>/giu, '')
      .replace(/<reasoning>[\s\S]*?<\/reasoning>/giu, '')
      .replace(/^\s*(?:Thinking|Reasoning|Analysis|Мысли|Размышления)\s*[:：][\s\S]*?(?:\n\s*(?:Final|Answer|Ответ|Continuation)\s*[:：]\s*)/iu, '')
      .replace(/^\s*(?:Final|Answer|Ответ|Continuation)\s*[:：]\s*/iu, '');

    const openThink = txt.search(/<think>|<thinking>|<reasoning>/iu);
    if (openThink >= 0) txt = txt.slice(0, openThink);

    return txt;
  }

  function _stripEcho(beforeCursor, raw) {
    let txt = _stripThinking(raw)
      .replace(/^```[a-zа-я0-9_-]*\s*/iu, '')
      .replace(/```$/u, '')
      .replace(/^\s*(?:Продолжение|Continuation|Autocomplete|Completion|Suggestion)\s*[:—-]\s*/iu, '');

    txt = txt.replace(/\r\n/g, '\n');

    const beforeTail = beforeCursor.slice(-240).trim();
    if (beforeTail && txt.trimStart().startsWith(beforeTail)) {
      txt = txt.trimStart().slice(beforeTail.length);
    }

    const tailWords = beforeCursor.trim().split(/\s+/).slice(-12).join(' ');
    if (tailWords && txt.trimStart().startsWith(tailWords)) {
      txt = txt.trimStart().slice(tailWords.length);
    }

    return txt;
  }

  function _normalizeCompletion(beforeCursor, raw, cfg) {
    const wordsLimit = _getWordsLimit(cfg);
    const strategy = cfg.strategy ?? 'word';

    let txt = _stripEcho(beforeCursor, raw);

    txt = txt
      .replace(/[ \t]*\n+[ \t]*/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^[\s"'«“”]+/u, match => match.includes('\n') ? '' : match.replace(/["'«“”]/g, ''));

    if (/\s$/.test(beforeCursor)) {
      txt = txt.replace(/^\s+/, '');
    } else {
      txt = txt.replace(/^\s{2,}/, ' ');
    }

    if (!txt.trim()) return '';

    if (strategy === 'sentence') {
      txt = _sliceBySentence(txt);
    } else if (strategy === 'paragraph') {
      txt = txt.split(/\n{2,}/)[0].trimEnd();
    }

    // =жёсткий лимит слов=
    txt = _sliceByWords(txt, wordsLimit);

    const currentWord = _getCurrentWord(beforeCursor);
    if (currentWord) {
      const lowerCurrent = currentWord.toLowerCase();
      const lowerTxt = txt.toLowerCase();

      if (lowerTxt.startsWith(lowerCurrent)) {
        txt = txt.slice(currentWord.length).replace(/^\s+/u, '');
      }

      if (/^[\p{L}\p{N}'’_-]/u.test(txt)) {
        txt = txt.replace(/^\s+/, '');
      }
    }

    if (!/\s$/.test(beforeCursor) && !currentWord && /^[\p{L}\p{N}]/u.test(txt)) {
      txt = ' ' + txt;
    }

    if (_SENTENCE_END_RE.test(beforeCursor) && /^[a-zа-яё]/u.test(txt)) {
      txt = txt.charAt(0).toUpperCase() + txt.slice(1);
    }

    txt = txt.replace(/^[\r\n]+/u, '').replace(/\s+$/u, '');
    return txt;
  }

  function _buildPrompt(before, after, cfg) {
    const words = _getWordsLimit(cfg);
    const minWords = Math.max(1, Math.floor(words * 0.7));
    const contextBefore = before.slice(-650);
    const contextAfter = after.slice(0, 100);

    return (
      `Continue the text at the cursor. Return about ${words} words, ideally ${minWords}-${words} words. ` +
      `Never exceed ${words} words. Complete the current word if it is unfinished. No line break.\n\n` +
      'Text before cursor:\n' + contextBefore +
      (contextAfter ? '\n\nText after cursor:\n' + contextAfter : '') +
      '\n\nOutput rules:\n' +
      '- Output only the text to insert at the cursor.\n' +
      '- No reasoning, no analysis, no explanation, no markdown.\n' +
      '- Do not repeat surrounding context.\n' +
      `- Hard limit: ${words} words maximum.\n` +
      '- Keep grammar natural and continue the current thought.'
    );
  }

  function _getAutoPoetSystemPrompt(cfg) {
    const words = _getWordsLimit(cfg);
    const template = _LLMCore?.getPrompt?.('autopot', { N: String(words) }) || '';
    if (template.trim()) return template;
    throw new Error('Prompt "autopot" не найден');
  }

  function _buildMessages(before, after, cfg) {
    return [
      { role: 'system', content: _getAutoPoetSystemPrompt(cfg) },
      { role: 'user', content: _buildPrompt(before, after, cfg) },
    ];
  }

  function _getMaxTokens(cfg) {
    const words = _getWordsLimit(cfg);
    return Math.max(192, Math.min(768, words * 72));
  }

  function _markAcceptedText(ta, from, insertedText, hadSpace) {
    _acceptedMarks.set(ta, {
      from,
      to: from + insertedText.length,
      hadSpace,
      ts: Date.now(),
    });
  }

  function _getFreshAcceptedMark(ta) {
    const mark = _acceptedMarks.get(ta);
    if (!mark) return null;

    if (Date.now() - mark.ts > 30000) {
      _acceptedMarks.delete(ta);
      return null;
    }

    return mark;
  }

  function _cleanupPunctuationText(ta, inserted) {
    const mark = _getFreshAcceptedMark(ta);
    if (!mark || !inserted) return false;

    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return false;

    if (_PUNCT_RE.test(inserted)) {
      const before = ta.value.slice(0, pos);

      if (mark.hadSpace && pos === mark.to && before.endsWith(' ')) {
        ta.setRangeText(inserted, pos - 1, pos, 'end');
        mark.to = pos;
        mark.hadSpace = false;
        mark.ts = Date.now();

        _suppressNextAuto.add(ta);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    }

    if (inserted === ' ') {
      const before = ta.value.slice(0, pos);

      if (pos >= mark.from && pos <= mark.to + 2 && _PUNCT_AFTER_SPACE_RE.test(before)) {
        const punct = before.match(_PUNCT_AFTER_SPACE_RE)?.[1] ?? '';
        if (!punct) return true;

        ta.setRangeText(punct + ' ', pos - 2, pos, 'end');
        mark.to = pos;
        mark.hadSpace = true;
        mark.ts = Date.now();

        _suppressNextAuto.add(ta);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    }

    return false;
  }

  function _onBeforeInput(e, ta) {
    if (e.defaultPrevented || e.inputType !== 'insertText') return;
    if (!_cleanupPunctuationText(ta, e.data ?? '')) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function _cleanupPunctuationBeforeInput(e, ta) {
    if (!_cleanupPunctuationText(ta, e.key)) return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  function _attach(ta, blockId) {
    if (!ta || ta._llmPoetBound) return;
    ta._llmPoetBound = true;

    ta.addEventListener('beforeinput', e => _onBeforeInput(e, ta));
    ta.addEventListener('input', () => _onInput(ta, blockId));
    ta.addEventListener('keydown', e => _onKeydown(e, ta, blockId));
    ta.addEventListener('blur', () => _clearGhost());
    ta.addEventListener('scroll', () => {
      if (_ghost?.ta === ta && _ghost?.text) _showGhost(ta, _ghost.text, ta.selectionStart, _matrixEnabled(_getConfig()));
    }, { passive: true });

    if (!_resizeBound) {
      _resizeBound = true;
      window.addEventListener('resize', () => {
        if (_ghost?.ta && _ghost?.text) _showGhost(_ghost.ta, _ghost.text, _ghost.ta.selectionStart);
      }, { passive: true });
    }
  }

  function _onInput(ta, blockId) {
    clearTimeout(_debounceTimer);
    _clearGhost();

    if (_suppressNextAuto.has(ta)) {
      _suppressNextAuto.delete(ta);
      return;
    }

    const cfg = _getConfig();
    if (!cfg.enabled || cfg.strategy === 'manual') return;
    if (_requesting) return;
    if (!_hasReadyProfile(cfg)) return;

    const cursorPos = ta.selectionStart;
    const before = ta.value.slice(0, cursorPos);
    const seed = _getSeed(before, cfg);

    if (_isBadContext(ta, cfg, false)) return;
    if (_lastGoodSeed && seed === _lastGoodSeed) return;

    const delay = Math.max(150, Number(cfg.debounce) || 800);
    _debounceTimer = setTimeout(() => _requestCompletion(ta, blockId, false), delay);
  }

  async function _requestCompletion(ta, blockId, manual) {
    const cfg = _getConfig();
    if (!manual && (!cfg.enabled || cfg.strategy === 'manual')) return;

    if (_requesting && !manual) return;

    if (!_hasReadyProfile(cfg)) {
      if (manual) window.Toast?.show('Выберите LLM-профиль для автопоэта', 'error');
      return;
    }

    if (_isBadContext(ta, cfg, manual)) return;

    const cursorPos = ta.selectionStart;
    const text = ta.value;
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);

    if (!before.trim()) return;
    if (!manual && !_hasEnoughFreshText(before, cfg, false)) return;

    const seed = _getSeed(before, cfg);
    const seq = ++_reqSeq;
    const profileId = cfg.profileId || _State?.getLayout?.()?.llm?.activeProfileId;

    _ghost = {
      ta,
      blockId,
      seq,
      text: '',
      before,
      anchorValue: ta.value,
      anchorPos: cursorPos,
      manual: !!manual,
    };

    _requesting = true;

    try {
      const raw = await _LLMCore.request({
        profileId,
        messages: _buildMessages(before, after, cfg),
        maxTokens: _getMaxTokens(cfg),
        temperature: Math.min(0.65, Number(cfg.temperature) || 0.3),
        stream: false,
        skipLog: true,
        featureTag: 'autopoet',
        timeoutMs: Number(cfg.timeoutMs) || 180_000,
      });

      if (!_ghost || _ghost.seq !== seq || _ghost.ta !== ta) return;
      if (ta.value !== _ghost.anchorValue || ta.selectionStart !== _ghost.anchorPos) {
        _clearGhost();
        return;
      }

      const cleaned = _normalizeCompletion(before, raw, cfg);
      if (!cleaned) {
        if (_lastGoodSeed === seed) _lastGoodSeed = '';
        _clearGhost();
        return;
      }

      _lastGoodSeed = seed;
      _ghost.text = cleaned;
      _showGhostMaybeMatrix(ta, cleaned, ta.selectionStart, cfg);
    } catch (err) {
      if (err?.name !== 'AbortError') console.debug('[AutoPoet] request failed:', err);
      if (_ghost?.seq === seq) _clearGhost();
    } finally {
      _requesting = false;
    }
  }

  function _onKeydown(e, ta, blockId) {
    if (e.defaultPrevented) return;

    if (_cleanupPunctuationBeforeInput(e, ta)) return;

    if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      _clearGhost();
      clearTimeout(_debounceTimer);
      _requestCompletion(ta, blockId, true);
      return;
    }

    if (!_ghost?.text || _ghost.ta !== ta) return;

    const cfg = _getConfig();
    const acceptKey = cfg.acceptKey || 'Tab';

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      _clearGhost();
      return;
    }

    if (e.key !== acceptKey) return;

    const ghost = _ghost;
    const insertText = ghost.text;

    if (!insertText) {
      _clearGhost();
      return;
    }

    if (ta.value !== ghost.anchorValue || ta.selectionStart !== ghost.anchorPos || ta.selectionEnd !== ghost.anchorPos) {
      _clearGhost();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    _clearGhost();

    // =пробел после принятия=
    const nextChar = ta.value.charAt(ghost.anchorPos);
    const needSpace =
      !/\s$/u.test(insertText) &&
      !/^[\s.,!?;:…)\]}»”]/u.test(nextChar);

    const textToInsert = insertText + (needSpace ? ' ' : '');

    ta.setRangeText(textToInsert, ghost.anchorPos, ghost.anchorPos, 'end');
    _markAcceptedText(ta, ghost.anchorPos, textToInsert, needSpace);

    // Принятый AutoPoet-вариант попадает в Prompt Loom как отдельный источник.
    // Сохраняем именно вставленный текст: так быстрый доступ через "\\" повторяет реальное действие пользователя.
    window.PromptLoom?.record?.(textToInsert.trim(), 'autopoet', {
      via: 'autopoet-accept',
      blockId: ghost.blockId || '',
      manual: !!ghost.manual,
    });

    _suppressNextAuto.add(ta);
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    if (window.State?.blockSnapshot && ghost.blockId) {
      window.State.blockSnapshot(ghost.blockId);
    }

    if (window.WordDict?.scheduleBuild) {
      window.WordDict.scheduleBuild();
    }
  }

  function attachToBlock(blockId) {
    const selector = _cssBlockSelector(blockId);
    const ta = document.querySelector(`${selector} textarea.block-textarea, ${selector} textarea`);
    if (ta) _attach(ta, blockId);
  }

  function _attachAllExisting() {
    document.querySelectorAll('[data-id] textarea.block-textarea, [data-id] textarea').forEach(ta => {
      const blockId = ta.closest('[data-id]')?.dataset?.id;
      if (blockId) _attach(ta, blockId);
    });
  }

  function _watchDOM() {
    if (_observer) return;

    _observer = new MutationObserver(muts => {
      for (const mut of muts) {
        for (const node of mut.addedNodes) {
          if (node.nodeType !== 1) continue;

          if (node.matches?.('[data-id] textarea.block-textarea, [data-id] textarea')) {
            const blockId = node.closest('[data-id]')?.dataset?.id;
            if (blockId) _attach(node, blockId);
          }

          node.querySelectorAll?.('[data-id] textarea.block-textarea, [data-id] textarea').forEach(ta => {
            const blockId = ta.closest('[data-id]')?.dataset?.id;
            if (blockId) _attach(ta, blockId);
          });
        }
      }
    });

    if (document.body) {
      _observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function nextVariant(target) {
    _clearGhost();
    clearTimeout(_debounceTimer);

    const ta = target ?? document.activeElement;
    if (ta?.tagName !== 'TEXTAREA') {
      window.Toast?.show('Поставьте курсор в текстовый блок', 'error');
      return;
    }

    const blockId = ta.closest('[data-id]')?.dataset?.id ?? '';
    _requestCompletion(ta, blockId, true);
  }

  function setMatrixEffect(enabled) {
    localStorage.setItem('llmAutoPoetMatrix', enabled ? '1' : '0');

    const lay = _State?.getLayout?.();
    if (_State?.setLayout && lay?.llm) {
      _State.setLayout({
        llm: {
          ...lay.llm,
          ghost: {
            ...(lay.llm.ghost ?? {}),
            matrixEffect: !!enabled,
          },
        },
      });
    }

    window.Toast?.show(enabled ? 'Matrix-эффект включён' : 'Matrix-эффект отключён', 'success');
  }

  function init() {
    _attachAllExisting();
    _watchDOM();
  }

  return { init, attachToBlock, nextVariant, setMatrixEffect };
})();

// -------------------------------------------------------------------------------------------------

  const MiniChat = (() => {
    let _history      = [];
    let _currentAbort = null;
    let _streaming    = false;
    let _dragging     = false;
    let _resizing     = false;
    let _dragOffset   = { x: 0, y: 0 };
    let _dragBound    = false;
    let _initialised  = false;

    let _inputHistory = [];
    let _historyIdx   = -1;
    let _draftInput   = '';

    let _fontSize     = 12;
    let _sessions     = [];
    let _sessionIdx   = 0;
    let _noAutoScroll = false;
    const STORAGE_KEY = 'llmChatSessions';

    const _panel  = () => document.getElementById('llm-chat-panel');
    const _msgsEl = () => document.getElementById('llm-chat-messages');
    const _inputEl= () => document.getElementById('llm-chat-input');

    function _open()  {
      const p = _panel();
      if (!p) return;
      _loadSessions();
      _history = [...(_sessions[_sessionIdx]?.history ?? [])];
      _applyFontSize();
      p.style.display = 'flex';
      p.classList.remove('llm-chat-collapsed');
      _updateCtxLabel();
      const el = _msgsEl();
      if (el) {
        el.innerHTML = '';
        _history.forEach(m => _appendMsg(m.role, m.content));
      }
      _updateNavButtons();
      _inputEl()?.focus();
    }
    function close() { const p = _panel(); if (p) p.style.display = 'none'; }

    function _saveSessions() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions: _sessions, sessionIdx: _sessionIdx, fontSize: _fontSize }));
      } catch {}
    }

    function _loadSessions() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          _sessions = Array.isArray(data.sessions) ? data.sessions : [];
          _sessionIdx = typeof data.sessionIdx === 'number' ? data.sessionIdx : 0;
          _fontSize = typeof data.fontSize === 'number' ? data.fontSize : 12;
        }
      } catch {}
      if (_sessions.length === 0) {
        _sessions.push({ id: Date.now().toString(36), history: [], title: 'Новый чат' });
        _sessionIdx = 0;
      }
      if (_sessionIdx >= _sessions.length) _sessionIdx = _sessions.length - 1;
    }

    function _applyFontSize() {
      const p = _panel();
      if (p) p.style.setProperty('--chat-font', _fontSize + 'px');
    }

    function _changeFontSize(delta) {
      _fontSize = Math.round(Math.min(24, Math.max(8, _fontSize + delta)) * 2) / 2;
      _applyFontSize();
      _saveSessions();
      const downBtn = document.getElementById('llm-chat-font-down');
      const upBtn = document.getElementById('llm-chat-font-up');
      if (downBtn) downBtn.title = `Уменьшить шрифт (${_fontSize - 0.5})`;
      if (upBtn) upBtn.title = `Увеличить шрифт (${_fontSize + 0.5})`;
      window.Toast?.show(`Шрифт: ${_fontSize}`, 'info');
    }

    function _updateNavButtons() {
      const prev = document.getElementById('llm-chat-prev');
      const next = document.getElementById('llm-chat-next');
      if (prev) {
        prev.disabled = _sessionIdx <= 0;
        prev.title = _sessionIdx > 0 ? `Предыдущий: ${_sessions[_sessionIdx - 1]?.title || 'Чат'}` : 'Предыдущий чат';
      }
      if (next) {
        next.disabled = _sessionIdx >= _sessions.length - 1;
        next.title = _sessionIdx < _sessions.length - 1 ? `Следующий: ${_sessions[_sessionIdx + 1]?.title || 'Чат'}` : 'Следующий чат';
      }
      const label = document.getElementById('llm-chat-session-label');
      if (label) label.textContent = `${_sessionIdx + 1}/${_sessions.length}`;
      const titleEl = document.getElementById('llm-chat-session-title');
      if (titleEl) titleEl.textContent = _sessions[_sessionIdx]?.title || '';
    }

    function _saveCurrentSession() {
      if (_sessions[_sessionIdx]) {
        _sessions[_sessionIdx].history = [..._history];
        if (_history.length > 0) {
          const firstUser = _history.find(m => m.role === 'user');
          if (firstUser) _sessions[_sessionIdx].title = firstUser.content.slice(0, 40) || 'Новый чат';
        }
      }
      _saveSessions();
    }

    function _switchSession(idx) {
      if (idx < 0 || idx >= _sessions.length) return;
      _saveCurrentSession();
      _sessionIdx = idx;
      _history = [...(_sessions[_sessionIdx]?.history ?? [])];
      _inputHistory = [];
      _historyIdx = -1;
      _draftInput = '';
      const el = _msgsEl();
      if (el) { el.innerHTML = ''; }
      _noAutoScroll = true;
      _history.forEach(m => _appendMsg(m.role, m.content));
      _noAutoScroll = false;
      if (el) el.scrollTop = 0;
      _updateScrollDownBtn();
      _updateNavButtons();
      _saveSessions();
      _inputEl()?.focus();
      window.Toast?.show(`Чат ${_sessionIdx + 1}/${_sessions.length}`, 'info');
    }

    function _newSession() {
      _saveCurrentSession();
      _sessions.push({ id: Date.now().toString(36), history: [], title: 'Новый чат' });
      _sessionIdx = _sessions.length - 1;
      _history = [];
      _inputHistory = [];
      _historyIdx = -1;
      _draftInput = '';
      const el = _msgsEl();
      if (el) el.innerHTML = '';
      const inputEl = _inputEl();
      if (inputEl) {
        inputEl.value = '';
        _resizeInput();
      }
      _updateScrollDownBtn();
      _updateNavButtons();
      _saveSessions();
      _inputEl()?.focus();
      window.Toast?.show('Новый чат создан', 'info');
    }

    function clearAllSessions() {
      stop();
      _sessions = [{ id: Date.now().toString(36), history: [], title: 'Новый чат' }];
      _sessionIdx = 0;
      _history = [];
      _inputHistory = [];
      _historyIdx = -1;
      _draftInput = '';
      const el = _msgsEl();
      if (el) el.innerHTML = '';
      const inputEl = _inputEl();
      if (inputEl) { inputEl.value = ''; _resizeInput(); }
      _updateNavButtons();
      _saveSessions();
      window.Toast?.show('Все чаты очищены', 'success');
    }

    let _collapsed = false;
    function toggleCollapse() {
      const p = _panel();
      if (!p) return;
      _collapsed = !_collapsed;
      p.classList.toggle('llm-chat-collapsed', _collapsed);
      const toggleBtn = document.getElementById('llm-chat-toggle');
      if (toggleBtn) {
        toggleBtn.querySelector('svg').innerHTML = _collapsed
          ? '<path d="M4 6l4 4 4-4"/>'
          : '<path d="M4 10l4-4 4 4"/>';
        toggleBtn.setAttribute('aria-label', _collapsed ? 'Развернуть чат' : 'Свернуть чат');
      }
    }

    function stop() {
      _currentAbort?.abort();
      _currentAbort = null;
      const stopBtn = document.getElementById('llm-chat-stop');
      if (stopBtn) stopBtn.style.display = 'none';
      _streaming = false;
    }

    function clearHistory() {
      stop();
      _history    = [];
      _inputHistory = [];
      _streaming  = false;
      _historyIdx = -1;
      _draftInput = '';
      const el = _msgsEl();
      if (el) el.innerHTML = '';
      const inputEl = _inputEl();
      if (inputEl) {
        inputEl.value = '';
        _resizeInput();
      }
      const ctxEl = document.getElementById('llm-chat-ctx');
      if (ctxEl) ctxEl.textContent = '';
      _saveCurrentSession();
    }

    function addSystemMessage(text) { _appendMsg('system', text); }

    function _resizeInput() {
      const el = _inputEl();
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    function _applyHistoryToInput(inputEl) {
      if (_historyIdx === -1) {
        inputEl.value = _draftInput;
      } else {
        inputEl.value = _inputHistory[_inputHistory.length - 1 - _historyIdx] ?? '';
      }
      _resizeInput();
    }

    function _updateScrollDownBtn() {
      const msgsEl = _msgsEl();
      const btn = document.querySelector('.llm-chat-scroll-down');
      if (!msgsEl || !btn) return;
      const dist = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight;
      btn.classList.toggle('visible', dist > 50);
    }

    function _initScrollDown() {
      const panel  = _panel();
      const msgsEl = _msgsEl();
      if (!panel || !msgsEl) return;

      const btn = document.createElement('button');
      btn.className = 'llm-chat-scroll-down';
      btn.innerHTML = '↓';
      btn.title     = 'Прокрутить вниз';
      btn.addEventListener('click', () => {
        msgsEl.scrollTo({ top: msgsEl.scrollHeight, behavior: 'smooth' });
      });
      panel.appendChild(btn);

      msgsEl.addEventListener('scroll', _updateScrollDownBtn, { passive: true });
    }

    function _appendMsg(role, text) {
      const el = _msgsEl();
      if (!el) return;
      if (role === 'scorecard') {
        _appendScorecardToDOM(JSON.parse(text), el);
        return;
      }
      const div = document.createElement('div');
      div.className = 'llm-chat-msg ' + role;
      const span = document.createElement('span');
      span.className = 'llm-chat-msg-text';
      span.textContent = text;
      div.appendChild(span);
      el.appendChild(div);
      if (role === 'assistant' && text) {
        _addCopyButton(div, text);
        _addTranslateButton(div, text);
      }
      if (!_noAutoScroll) el.scrollTop = el.scrollHeight;
      _updateScrollDownBtn();
    }

    function _appendScorecardToDOM(data, el) {
      const CRITERIA = [
        { key: 'clarity',      label: 'Ясность',          desc: 'Понятно ли написано' },
        { key: 'specificity',  label: 'Точность',         desc: 'Конкретность инструкций' },
        { key: 'completeness', label: 'Полнота',          desc: 'Все ли контексты учтены' },
        { key: 'consistency',  label: 'Согласованность',  desc: 'Нет ли противоречий' },
        { key: 'conciseness',  label: 'Краткость',        desc: 'Нет ли лишнего' },
      ];
      const escFn = (s) => { const d = document.createElement('div'); d.appendChild(document.createTextNode(s)); return d.innerHTML; };
      const scores = CRITERIA.map(c => {
        const rawVal = data[c.key];
        const num = (rawVal != null && rawVal !== '') ? Number(rawVal) : NaN;
        const val = Number.isFinite(num) ? Math.min(10, Math.max(0, num)) : 0;
        return { ...c, val };
      });
      const avg = scores.reduce((s, c) => s + c.val, 0) / scores.length;
      const avgStr = avg.toFixed(1);
      const avgColor = avg >= 7 ? '#22c55e' : avg >= 5 ? '#f59e0b' : '#ef4444';
      const barsHtml = scores.map(c => {
        const color = c.val >= 7 ? '#22c55e' : c.val >= 5 ? '#f59e0b' : '#ef4444';
        const pct = Math.round(c.val * 10);
        return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0" title="${escFn(c.desc)}"><span style="width:110px;font-size:11px;color:var(--text2);flex-shrink:0">${escFn(c.label)}</span><div style="width:55%;min-width:60px;height:6px;background:var(--bg1);border-radius:3px;overflow:hidden"><div data-bar="${pct}%" style="width:0;height:100%;background:${color};border-radius:3px"></div></div><span style="width:22px;text-align:right;font-size:12px;font-weight:600;color:${color}">${c.val}</span></div>`;
      }).join('');
      const summaryHtml = data.summary ? `<p style="margin:10px 0 0;font-size:12px;color:var(--text2);border-top:1px solid var(--border);padding-top:8px">${escFn(data.summary)}</p>` : '';
      const card = document.createElement('div');
      card.className = 'llm-chat-msg assistant';
      card.innerHTML = `<div style="font-size:13px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px"><span>📊 Оценка промпта</span><span style="font-size:18px;font-weight:700;color:${avgColor}">${avgStr}</span><span style="font-size:11px;color:var(--text3)">/ 10</span></div>${barsHtml}${summaryHtml}`;
      el.appendChild(card);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          card.querySelectorAll('[data-bar]').forEach(b => {
            b.style.width = b.dataset.bar;
          });
        });
      });
      if (!_noAutoScroll) el.scrollTop = el.scrollHeight;
      _updateScrollDownBtn();
    }

    function pushScorecard(data) {
      _history.push({ role: 'scorecard', content: JSON.stringify(data) });
      _saveCurrentSession();
    }

    function pushToHistory(role, content) {
      _history.push({ role, content });
      _saveCurrentSession();
    }

    function appendChunk(chunk) {
      const el = _msgsEl();
      if (!el) return;

      const typing = el.querySelector('.llm-chat-typing');
      if (typing) typing.remove();

      let last = el.querySelector('.llm-chat-msg.assistant.streaming');
      if (!last) {
        last = document.createElement('div');
        last.className = 'llm-chat-msg assistant streaming';
        const span = document.createElement('span');
        span.className = 'llm-chat-msg-text';
        last.appendChild(span);
        el.appendChild(last);
      }
      const span = last.querySelector('.llm-chat-msg-text');
      if (span) span.textContent += chunk;
      el.scrollTop = el.scrollHeight;
      _updateScrollDownBtn();
    }

    function finalizeLastMessage(full) {
      const el   = _msgsEl();
      const last = el?.querySelector('.llm-chat-msg.assistant.streaming');
      if (last) {
        last.classList.remove('streaming');
        const span = last.querySelector('.llm-chat-msg-text');
        if (full && span) span.textContent = full;
        const textToCopy = full || span?.textContent || '';
        if (textToCopy) {
          _addCopyButton(last, textToCopy);
          _addTranslateButton(last, textToCopy);
        }
      }
      const typing = el?.querySelector('.llm-chat-typing');
      if (typing) typing.remove();

      const stopBtn = document.getElementById('llm-chat-stop');
      if (stopBtn) stopBtn.style.display = 'none';
      _streaming = false;
      _updateScrollDownBtn();
    }

    function _addCopyButton(container, text) {
      if (container.querySelector('.llm-chat-msg-copy')) return;

      const btn = document.createElement('button');
      btn.className = 'llm-chat-msg-copy';
      btn.innerHTML = '➱';
      btn.title     = 'Копировать';
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (!navigator.clipboard) {
          _fallbackCopy(text, btn);
          return;
        }
        navigator.clipboard.writeText(text).then(() => {
          btn.innerHTML = '✓';
          setTimeout(() => { btn.innerHTML = '➱'; }, 1500);
        }).catch(() => {
          _fallbackCopy(text, btn);
        });
      });
      container.appendChild(btn);
    }

    function _addTranslateButton(container, text) {
      if (container.querySelector('.llm-chat-msg-translate')) return;
      if (typeof Translator === 'undefined') return;

      const TRANSLATE_CHAT_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15"/><path d="M10 2.5c2.5 2.5 3.5 5 3.5 7.5s-1 5-3.5 7.5"/><path d="M10 2.5c-2.5 2.5-3.5 5-3.5 7.5s1 5 3.5 7.5"/></svg>';
      const btn = document.createElement('button');
      btn.className = 'llm-chat-msg-translate';
      btn.innerHTML = TRANSLATE_CHAT_SVG;
      btn.title = 'Перевести RU↔EN';
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (btn.dataset.translated === '1') {
          const span = container.querySelector('.llm-chat-msg-text');
          if (span && btn.dataset.original) {
            span.textContent = btn.dataset.original;
            btn.dataset.translated = '0';
            btn.innerHTML = TRANSLATE_CHAT_SVG;
            btn.title = 'Перевести RU↔EN';
          }
          return;
        }
        const span = container.querySelector('.llm-chat-msg-text');
        if (!span) return;
        const srcText = span.textContent;
        const lang = Translator.detectLang(srcText);
        const targetLang = (lang?.code === 'ru') ? 'en' : 'ru';
        const langName = Translator.LANG_BY_CODE[targetLang]?.name || targetLang;
        btn.innerHTML = '⏳';
        btn.title = 'Перевод → ' + langName + '...';
        Translator.translateProtected(srcText, targetLang).then(result => {
          if (!result || result === srcText) { btn.innerHTML = TRANSLATE_CHAT_SVG; btn.title = 'Перевести RU↔EN'; return; }
          btn.dataset.original = srcText;
          btn.dataset.translated = '1';
          span.textContent = result;
          btn.innerHTML = '↩';
          btn.title = 'Вернуть оригинал';
        }).catch(() => { btn.innerHTML = TRANSLATE_CHAT_SVG; btn.title = 'Перевести RU↔EN'; });
      });
      container.appendChild(btn);
    }

    function _fallbackCopy(text, btn) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); btn.innerHTML = '✓'; }
      catch (_) { btn.innerHTML = '✗'; }
      setTimeout(() => { btn.innerHTML = '➱'; }, 1500);
      document.body.removeChild(ta);
    }

    function _guardLocal() { return true; }

    async function send(text, opts = {}) {
      const userText = text ?? _inputEl()?.value?.trim();
      if (!userText || _streaming) return;
      if (!_guardLocal()) return;

      const inputEl = _inputEl();
      if (inputEl) {
        inputEl.value = '';
        _resizeInput();
      }

      if (!opts.skipUserMessage) {
        _history.push({ role: 'user', content: userText });
        _appendMsg('user', userText);

        _inputHistory.push(userText);
        if (_inputHistory.length > 10) _inputHistory.shift();

        _historyIdx = -1;
        _draftInput = '';

        if (_sessions[_sessionIdx]) {
          _sessions[_sessionIdx].title = userText.slice(0, 40) || 'Новый чат';
          _updateNavButtons();
        }
      }

      const LLMCore  = _LLMCore;
      const stateRef = _State;

      const system  = (LLMCore?.getPrompt?.('chat_system') ?? '') + (_LANG_INSTR ?? '');

      _currentAbort = new AbortController();
      _streaming    = true;

      const stopBtn = document.getElementById('llm-chat-stop');
      if (stopBtn) stopBtn.style.display = '';

      const el = _msgsEl();
      if (el) {
        const typing = document.createElement('div');
        typing.className = 'llm-chat-typing';
        typing.innerHTML = '<span></span><span></span><span></span>';
        el.appendChild(typing);
        el.scrollTop = el.scrollHeight;
      }

      try {
        if (!LLMCore?.request) throw new Error('LLMCore is unavailable');
        const result = await LLMCore.request({
          messages:   [{ role: 'system', content: system }, ..._history],
          stream:     true,
          onChunk:    chunk => appendChunk(chunk),
          signal:     _currentAbort.signal,
          featureTag: 'chat',
        });
        finalizeLastMessage(result);
        _history.push({ role: 'assistant', content: result });
        if (String(result ?? '').trim()) {
          window.PromptLoom?.record?.(result, 'llm', { via: 'mini-chat', prompt: userText.slice(0, 240) });
        }

        _saveCurrentSession();

        const depth = stateRef?.getLayout?.()?.llm?.bro?.chatDepth ?? 6;
        if (_history.length > depth * 2) _history.splice(0, _history.length - depth * 2);
      } catch (e) {
        finalizeLastMessage('');
      if (e.name !== 'AbortError') {
        MiniChat.addSystemMessage('Ошибка: ' + e.message);
        window.Intelligence?.track?.('llm.action.error', {
          featureKey,
          message: e?.message || ''
        });
        window.Toast?.show(e.message, 'error');
      }
      } finally {
        _currentAbort = null;
        _saveCurrentSession();
        _inputEl()?.focus();
      }
    }

    function _updateCtxLabel() {
      const el  = document.getElementById('llm-chat-ctx');
      if (el) el.textContent = '';
    }

    function _getClientPos(e) {
      if (e.touches) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      return { x: e.clientX, y: e.clientY };
    }

    function _initDragResize() {
      const bar    = document.getElementById('llm-chat-bar');
      const handle = document.getElementById('llm-chat-resize');
      if (!bar && !handle) return;

      let _resizeStartPos = { x: 0, y: 0 };
      let _resizeStartRect = { w: 0, h: 0 };

      const onStart = (e, mode) => {
        if (mode === 'drag' && e.target.closest('button')) return;
        const panel = _panel();
        if (!panel) return;
        if (mode === 'drag') {
          _dragging  = true;
          const rect = panel.getBoundingClientRect();
          _dragOffset = { x: _getClientPos(e).x - rect.left, y: _getClientPos(e).y - rect.top };
        }
        if (mode === 'resize') {
          _resizing = true;
          const rect = panel.getBoundingClientRect();
          const pos = _getClientPos(e);
          _resizeStartPos = { x: pos.x, y: pos.y };
          _resizeStartRect = { w: rect.width, h: rect.height };
        }
        e.preventDefault();
      };

      bar?.addEventListener('mousedown', e => onStart(e, 'drag'));
      bar?.addEventListener('touchstart', e => onStart(e, 'drag'), { passive: false });
      handle?.addEventListener('mousedown', e => onStart(e, 'resize'));
      handle?.addEventListener('touchstart', e => onStart(e, 'resize'), { passive: false });

      if (_dragBound) return;
      _dragBound = true;

      const onMove = e => {
        const panel = _panel();
        if (!panel) return;
        const pos = _getClientPos(e);
        if (_dragging) {
          panel.style.left   = (pos.x - _dragOffset.x) + 'px';
          panel.style.top    = (pos.y - _dragOffset.y) + 'px';
          panel.style.right  = 'auto';
          panel.style.bottom = 'auto';
        }
        if (_resizing) {
          const dx = pos.x - _resizeStartPos.x;
          const dy = pos.y - _resizeStartPos.y;
          panel.style.width  = Math.max(280, _resizeStartRect.w + dx) + 'px';
          panel.style.height = Math.max(220, _resizeStartRect.h + dy) + 'px';
        }
      };

      const onEnd = () => { _dragging = _resizing = false; };

      document.addEventListener('mousemove', onMove, { passive: true });
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onEnd);
    }

    function _bindSendButton() {
      const sendBtn  = document.getElementById('llm-chat-send');
      const inputEl  = document.getElementById('llm-chat-input');

      sendBtn?.addEventListener('click', () => send());

      if (inputEl) {
        inputEl.addEventListener('input', () => {
          _resizeInput();
          if (_historyIdx >= 0) {
            _draftInput = inputEl.value;
            _historyIdx = -1;
          }
        });

        inputEl.addEventListener('keydown', e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            send();
            return;
          }

          if (e.key === 'Escape') {
            if (inputEl.value.trim()) {
              inputEl.value = '';
              _resizeInput();
              _historyIdx = -1;
              _draftInput = '';
            } else {
              close();
            }
            return;
          }

          if (e.key === 'ArrowUp') {
            if (_historyIdx < 0 && inputEl.value.trim()) return;
            if (_inputHistory.length === 0) return;

            e.preventDefault();

            if (_historyIdx < 0) _draftInput = inputEl.value;

            _historyIdx++;
            if (_historyIdx >= _inputHistory.length) _historyIdx = -1;

            _applyHistoryToInput(inputEl);
            return;
          }

          if (e.key === 'ArrowDown') {
            if (_historyIdx < 0) return;

            e.preventDefault();
            _historyIdx--;
            if (_historyIdx < 0) _historyIdx = -1;

            _applyHistoryToInput(inputEl);
            return;
          }

          if ((e.ctrlKey || e.metaKey) && e.key === '=') {
            e.preventDefault();
            _changeFontSize(0.5);
            return;
          }
          if ((e.ctrlKey || e.metaKey) && e.key === '-') {
            e.preventDefault();
            _changeFontSize(-0.5);
            return;
          }
        });
      }

      document.getElementById('llm-chat-close')?.addEventListener('click', () => close());
      document.getElementById('llm-chat-stop')?.addEventListener('click',  () => stop());
      document.getElementById('llm-chat-toggle')?.addEventListener('click', () => toggleCollapse());

      const clearBtn = document.getElementById('llm-chat-clear');
      if (clearBtn) {
        let _clearTimer = null;
        let _clearLongFired = false;
        const startLong = () => {
          _clearLongFired = false;
          _clearTimer = setTimeout(() => {
            _clearTimer = null;
            _clearLongFired = true;
            clearAllSessions();
          }, 800);
        };
        const cancelLong = () => { if (_clearTimer) { clearTimeout(_clearTimer); _clearTimer = null; } };
        clearBtn.addEventListener('mousedown', startLong);
        clearBtn.addEventListener('mouseup',   cancelLong);
        clearBtn.addEventListener('mouseleave', cancelLong);
        clearBtn.addEventListener('touchstart', startLong, { passive: true });
        clearBtn.addEventListener('touchend',   cancelLong);
        clearBtn.addEventListener('click', () => {
          cancelLong();
          if (_clearLongFired) { _clearLongFired = false; return; }
          clearHistory();
        });
      }

      document.getElementById('llm-chat-resend')?.addEventListener('click', () => {
        if (_streaming) return;
        const lastUser = [..._history].reverse().find(m => m.role === 'user');
        if (!lastUser) return;

        if (_history.length >= 2 && _history[_history.length - 1].role === 'assistant') {
          _history.pop();
        }

        const msgsEl = _msgsEl();
        if (msgsEl) {
          const children = msgsEl.children;
          for (let i = children.length - 1; i >= 0; i--) {
            if (children[i].classList.contains('assistant') ||
                children[i].classList.contains('llm-chat-typing')) {
              children[i].remove();
              break;
            }
          }
        }

        send(lastUser.content, { skipUserMessage: true });
      });
    }

    function _init() {
      if (_initialised) return;
      _initialised = true;
      _loadSessions();
      _applyFontSize();
      _initDragResize();
      _bindSendButton();
      _initScrollDown();

      document.getElementById('llm-chat-font-down')?.addEventListener('click', () => _changeFontSize(-0.5));
      document.getElementById('llm-chat-font-up')?.addEventListener('click', () => _changeFontSize(0.5));
      document.getElementById('llm-chat-prev')?.addEventListener('click', () => _switchSession(_sessionIdx - 1));
      document.getElementById('llm-chat-next')?.addEventListener('click', () => _switchSession(_sessionIdx + 1));
      document.getElementById('llm-chat-new')?.addEventListener('click', () => _newSession());

      window.addEventListener('beforeunload', () => _saveCurrentSession());

      _updateNavButtons();
    }

    function getSessionIndex() { return _sessionIdx; }

    function ensureSession(idx) {
      if (idx < 0 || idx >= _sessions.length) return;
      if (idx === _sessionIdx) return;
      _saveCurrentSession();
      _sessionIdx = idx;
      _history = [...(_sessions[_sessionIdx]?.history ?? [])];
      _inputHistory = [];
      _historyIdx = -1;
      _draftInput = '';
      const el = _msgsEl();
      if (el) { el.innerHTML = ''; }
      _noAutoScroll = true;
      _history.forEach(m => _appendMsg(m.role, m.content));
      _noAutoScroll = false;
      _updateNavButtons();
    }

    return { open: _open, close, stop, clearHistory, send, addSystemMessage, appendChunk, finalizeLastMessage, _init, newSession: _newSession, pushScorecard, pushToHistory, clearAllSessions, getSessionIndex, ensureSession };
  })();

  const LLMHistoryPanel = (() => {
    let searchQuery   = '';
    let modelFilter   = '';
    let debounceTimer = null;
    let lastFocusedEl = null;
    let clearAllPending = false;
    let clearAllTimer = null;
    const DEBOUNCE_MS = 300;

    function _escLocal(s) {
      if (s == null) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _safeDate(ts) {
      const d = new Date(ts);
      return isNaN(d.getTime())
        ? '—'
        : d.toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' });
    }

    function _onKeyDown(e) {
      if (e.key === 'Escape') close();
    }

    function _onBackdropClick(e) {
      if (e.target === e.currentTarget) close();
    }

    function _ensureFilterPanel(list) {
      if (document.getElementById('llm-hist-filters')) return;

      const container = document.createElement('div');
      container.id = 'llm-hist-filters';
      container.className = 'llm-hist-filters';
      container.innerHTML =
        `<input type="search" id="llm-hist-search" class="llm-hist-search"
                placeholder="Поиск по тексту запроса или ответа…" autocomplete="off">` +
        `<select id="llm-hist-model-select" class="llm-hist-model-select">
           <option value="">Все модели</option>
         </select>`;

      if (!list.parentNode) return;
      list.parentNode.insertBefore(container, list);

      document.getElementById('llm-hist-search')?.addEventListener('input', _onSearchInput);
      document.getElementById('llm-hist-model-select')?.addEventListener('change', _onModelFilterChange);
    }

    function _updateFilters(uniqueModels) {
      if (modelFilter && !uniqueModels.includes(modelFilter)) modelFilter = '';

      const searchInput = document.getElementById('llm-hist-search');
      const modelSelect = document.getElementById('llm-hist-model-select');

      if (searchInput && searchInput.value !== searchQuery) searchInput.value = searchQuery;

      if (modelSelect) {
        modelSelect.innerHTML =
          '<option value="">Все модели</option>' +
          uniqueModels.map(m =>
            `<option value="${_escLocal(m)}"${m === modelFilter ? ' selected' : ''}>${_escLocal(m)}</option>`
          ).join('');
      }
    }

    function open() {
      const modal = document.getElementById('llm-history-modal');
      if (!modal) return;

      lastFocusedEl = document.activeElement;

      modal.style.display = 'flex';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'История LLM-запросов');

      document.removeEventListener('keydown', _onKeyDown);
      document.addEventListener('keydown', _onKeyDown);
      modal.removeEventListener('click', _onBackdropClick);
      modal.addEventListener('click', _onBackdropClick);

      searchQuery = '';
      modelFilter = '';
      render();

      requestAnimationFrame(() => {
        document.getElementById('llm-hist-search')?.focus();
      });
    }

    function close() {
      const modal = document.getElementById('llm-history-modal');
      if (modal) {
        modal.style.display = 'none';
        modal.removeAttribute('role');
        modal.removeAttribute('aria-modal');
        modal.removeAttribute('aria-label');
        modal.removeEventListener('click', _onBackdropClick);
      }
      document.removeEventListener('keydown', _onKeyDown);

      if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
        lastFocusedEl.focus();
        lastFocusedEl = null;
      }

      searchQuery = '';
      modelFilter = '';
      clearTimeout(debounceTimer);
      clearTimeout(clearAllTimer);
      clearAllPending = false;
    }

    function clearAll() {
      const btn = document.getElementById('llm-hist-clear-all');
      if (!clearAllPending) {
        clearAllPending = true;
        if (btn) {
          btn.classList.add('confirm-pending');
          btn.textContent = '✕ Очистить?';
          btn.title = 'Нажмите ещё раз для подтверждения';
        }
        clearTimeout(clearAllTimer);
        clearAllTimer = setTimeout(() => {
          clearAllPending = false;
          if (btn) {
            btn.classList.remove('confirm-pending');
            btn.textContent = '🗑 Очистить всё';
            btn.title = '';
          }
        }, 2500);
        return;
      }
      clearTimeout(clearAllTimer);
      clearAllPending = false;
      if (btn) {
        btn.classList.remove('confirm-pending');
        btn.textContent = '🗑 Очистить всё';
        btn.title = '';
      }
      _LLMCore?.LLMRequestLog?.clear();
      searchQuery = '';
      modelFilter = '';
      render();
    }

    function _getUniqueModels(entries) {
      const models = new Set();
      for (const e of entries) if (e.model) models.add(e.model);
      return [...models].sort((a, b) => a.localeCompare(b));
    }

    function _applyFilters(entries) {
      const q = searchQuery.trim().toLowerCase();
      const m = modelFilter;
      if (!q && !m) return entries;

      return entries.filter(e => {
        if (m && e.model !== m) return false;
        if (q) {
          const haystack = [e.feature ?? '', e.prompt ?? '', e.response ?? ''].join(' ').toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });
    }

    function _onSearchInput(e) {
      searchQuery = e.target.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => render(), DEBOUNCE_MS);
    }

    function _onModelFilterChange(e) {
      modelFilter = e.target.value;
      render();
    }

    function render() {
      const list  = document.getElementById('llm-history-list');
      const stats = document.getElementById('llm-hist-stats');
      if (!list) return;

      const allEntries   = _LLMCore?.LLMRequestLog?.getAll() ?? [];
      const uniqueModels = _getUniqueModels(allEntries);
      const filtered     = _applyFilters(allEntries);

      if (stats) {
        const total = allEntries.length;
        const shown = filtered.length;
        stats.textContent = shown === total ? `${total} записей` : `${shown} из ${total} записей`;
      }

      _ensureFilterPanel(list);
      _updateFilters(uniqueModels);

      list.setAttribute('role', 'list');
      list.innerHTML = '';

      if (!filtered.length) {
        const isEmpty = allEntries.length === 0;
        list.innerHTML = `<div class="snap-empty">${isEmpty ? 'История запросов пуста' : 'Ничего не найдено по фильтрам'}</div>`;
        return;
      }

      for (const entry of filtered) {
        const row = document.createElement('div');
        row.className = 'llm-hist-row';
        row.setAttribute('role', 'listitem');

        const date         = _safeDate(entry.ts);
        const totalTokens  = (entry.promptTokens ?? 0) + (entry.completionTokens ?? 0);
        const tokenStr     = totalTokens > 0 ? '~' + totalTokens + ' tok' : '';
        const fullResponse = entry.response ?? '';
        const truncated    = fullResponse.length > 120;

        row.innerHTML =
          `<div class="llm-hist-meta">` +
            `<span class="llm-hist-feature">${_escLocal(entry.feature)}</span>` +
            `<span class="llm-hist-model">${_escLocal(entry.model)}</span>` +
            (entry.cached ? '<span class="llm-hist-cached">кэш</span>' : '') +
            (tokenStr ? `<span class="llm-hist-tokens">${tokenStr}</span>` : '') +
            `<span class="llm-hist-time">${date}</span>` +
          `</div>` +
          `<div class="llm-hist-preview${truncated ? ' llm-hist-preview--truncated' : ''}"
                data-hist-expand="${entry.id}" role="button" tabindex="0" aria-expanded="false">${
                _escLocal(truncated ? fullResponse.slice(0, 120) : fullResponse)
              }</div>` +
          `<div class="llm-hist-actions">` +
            `<button type="button" class="btn-sm" data-hist-copy="${entry.id}">📋 Копировать</button>` +
            `<button type="button" class="btn-sm btn-icon-danger" data-hist-del="${entry.id}" aria-label="Удалить запись">🗑</button>` +
          `</div>`;

        const previewEl = row.querySelector('[data-hist-expand]');
        previewEl?.addEventListener('click', () => {
          const isExpanded = previewEl.classList.toggle('llm-hist-preview--expanded');
          previewEl.setAttribute('aria-expanded', String(isExpanded));
          previewEl.textContent = isExpanded ? fullResponse : fullResponse.slice(0, 120);
        });
        previewEl?.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            previewEl.click();
          }
        });

        row.querySelector('[data-hist-copy]')?.addEventListener('click', e => {
          e.stopPropagation();
          navigator.clipboard?.writeText(fullResponse)
            .then(() => window.Toast?.show('Скопировано ✓', 'success'))
            .catch(() => window.Toast?.show('Не удалось скопировать', 'error'));
        });

        row.querySelector('[data-hist-del]')?.addEventListener('click', () => {
          _LLMCore?.LLMRequestLog?.remove(entry.id);
          render();
        });

        list.appendChild(row);
      }
    }

    return { open, close, clearAll, render };
  })();

  function init(stateRef, storageRef, llmCoreRef) {
    _State   = stateRef;
    _Storage = storageRef;
    _LLMCore = llmCoreRef;

    // Для обратной совместимости
    window._State   = _State;
    window._LLMCore = _LLMCore;

    MiniChat._init();
    window.MiniChat = MiniChat;
    AutoPoet.init();
    renderProfileBar();

    document.getElementById('llm-history-close')?.addEventListener('click',  () => LLMHistoryPanel.close());
    document.getElementById('llm-hist-clear-all')?.addEventListener('click', () => LLMHistoryPanel.clearAll());
  }

  return {
    init,
    handleAction,
    renderProfileBar,
    setActiveProfile,
    groomBlock,
    _thesaurusAtBlock,
    _executeThesaurusMode,
    AutoTitle,
    SubtabAutoTitle,
    AutoPoet,
    BroTags,
    DiffEngine,
    MiniChat,
    LLMHistoryPanel,
    PromptAudit,
    TokenOptimizer,
    SmartPlaceholders,
    PromptRephrase,
    PromptExpander,
  };
})();
