/**
 * chat.js – Soporte integrado vía API FastAPI (NeMo Guardrails + Groq).
 */
const SupportChat = (() => {
  let _history = [];
  let _open = false;
  let _sending = false;

  function isEnabled() {
    return typeof CONFIG !== 'undefined'
      && CONFIG.CHAT_API_URL
      && CONFIG.CHAT_API_URL.startsWith('http');
  }

  function open() {
    if (!isEnabled()) {
      _bubble('bot', 'El chat no está configurado. Define CHAT_API_URL en config.js con la URL de tu API de soporte.');
      _setOpen(true);
      return;
    }
    _setOpen(true);
    if (!_history.length) {
      _bubble('bot', '¡Hola! Soy el asistente de HomeCode Stock. Pregúntame sobre búsqueda de productos, registro de ubicaciones, roles o uso de la app.');
    }
    setTimeout(() => document.getElementById('chat-input')?.focus(), 200);
  }

  function close() {
    _setOpen(false);
  }

  function toggle() {
    if (_open) close();
    else open();
  }

  function _setOpen(on) {
    _open = on;
    const panel = document.getElementById('chat-panel');
    const fab = document.getElementById('chat-fab');
    if (panel) panel.classList.toggle('open', on);
    if (fab) fab.classList.toggle('active', on);
  }

  function _bubble(role, text) {
    const log = document.getElementById('chat-log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function _setPending(on) {
    const el = document.getElementById('chat-pending');
    if (el) el.style.display = on ? 'block' : 'none';
    if (on) {
      const log = document.getElementById('chat-log');
      if (log) log.scrollTop = log.scrollHeight;
    }
  }

  async function send() {
    if (_sending) return;
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    const message = (input?.value || '').trim();
    if (!message) return;

    if (!isEnabled()) {
      _bubble('bot', 'Configura CHAT_API_URL en config.js para conectar con el servidor de soporte.');
      return;
    }

    input.value = '';
    _bubble('user', message);
    _sending = true;
    if (sendBtn) sendBtn.disabled = true;
    _setPending(true);

    try {
      const res = await fetch(CONFIG.CHAT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: _history }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || ('HTTP ' + res.status));
      }
      const data = await res.json();
      const reply = data.reply || '';
      _bubble('bot', reply);
      _history.push({ role: 'user', content: message });
      _history.push({ role: 'assistant', content: reply });
      // Limitar historial enviado al backend
      if (_history.length > 20) _history = _history.slice(-20);
    } catch (err) {
      _bubble('bot', 'No pude conectar con el asistente. ¿Está corriendo la API en ' + CONFIG.CHAT_API_URL + '?');
      console.error('SupportChat:', err);
    } finally {
      _sending = false;
      if (sendBtn) sendBtn.disabled = false;
      _setPending(false);
      input?.focus();
    }
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function init() {
    const fab = document.getElementById('chat-fab');
    if (fab) fab.style.display = 'flex';
  }

  return { init, open, close, toggle, send, onKey, isEnabled };
})();
