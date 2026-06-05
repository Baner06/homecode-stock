/**
 * app.js – Lógica principal de HomeCode Stock
 * Pantallas, registro, búsqueda, edición, eliminación (admin) y configuración.
 */

// ===================================
// AUDIO – Beeps con Web Audio
// ===================================
const Audio = (() => {
  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function beep(freq = 880, duration = 0.08, type = 'square', volume = 0.3) {
    try {
      const ac = getCtx();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain); gain.connect(ac.destination);
      osc.frequency.value = freq; osc.type = type;
      gain.gain.setValueAtTime(volume, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
      osc.start(ac.currentTime); osc.stop(ac.currentTime + duration);
    } catch (e) { /* ignore */ }
  }
  function success() { beep(940, 0.09, 'square', 0.25); }
  function warning() { beep(300, 0.18, 'sawtooth', 0.2); }
  return { success, warning };
})();


// ===================================
// ROUTER
// ===================================
const App = (() => {
  let _current = 'home';
  function goTo(screenName) {
    const current = document.querySelector('.screen.active');
    if (current) current.classList.remove('active');
    const next = document.getElementById(`screen-${screenName}`);
    if (next) { next.classList.add('active'); _current = screenName; }

    if (screenName === 'settings') Settings.load();
    if (screenName === 'lookup')   Lookup.init();
    if (screenName === 'home') {
      Registration.stop();
      if (typeof updateHomeDashboard === 'function') {
        updateHomeDashboard().catch(() => {});
      }
    }
  }
  return { goTo, getCurrentScreen: () => _current };
})();


// ===================================
// REGISTRO DE UBICACIONES
// ===================================
const Registration = (() => {
  let state = { zone: 1, column: 1, row: 1, position: 1 };
  let _lastBarcode = null;
  let _toastTimer = null;
  let _duplicateTimer = null;

  // Abre la pantalla de configuración de registro (solo empleados+).
  function openSetup() {
    if (!DB.isConfigured()) { Settings.openNotConfigured(); return; }
    if (!Auth.canScan()) {
      AdminUI.openLogin('Inicia sesión como empleado para registrar productos.');
      return;
    }
    App.goTo('register-setup');
  }

  function start() {
    if (!DB.isConfigured()) { Settings.openNotConfigured(); return; }
    if (!Auth.canScan()) {
      AdminUI.openLogin('Inicia sesión como empleado para registrar productos.');
      return;
    }
    const z = parseInt(document.getElementById('setup-zone').value, 10) || 1;
    const c = parseInt(document.getElementById('setup-column').value, 10) || 1;
    state = { zone: z, column: c, row: 1, position: 1 };
    updateHUD();
    const skuField = document.getElementById('register-sku');
    if (skuField) skuField.value = '';
    App.goTo('register-scan');
    setTimeout(() => { Scanner.start('register-video', handleScan); }, 300);
  }

  function stop() { Scanner.stop(); App.goTo('home'); }

  function updateHUD() {
    document.getElementById('hud-zone').textContent     = state.zone;
    document.getElementById('hud-column').textContent   = state.column;
    document.getElementById('hud-row').textContent      = state.row;
    document.getElementById('hud-position').textContent = state.position;
  }

  async function handleScan(barcode) {
    if (barcode === _lastBarcode) return;
    _lastBarcode = barcode;
    setTimeout(() => { _lastBarcode = null; }, 1200);

    try {
      const existing = await DB.get(barcode);
      if (existing) { Audio.warning(); showDuplicateModal(barcode, existing); return; }

      const skuField = document.getElementById('register-sku');
      const sku = skuField ? skuField.value.trim() : '';

      const record = {
        barcode, sku, name: '',
        zone: state.zone, column: state.column,
        row: state.row, position: state.position,
        createdAt: Date.now(),
      };
      await DB.add(record);
      Audio.success();
      showToast(sku ? `Registrado (SKU: ${sku})` : 'Registrado');
      if (skuField) skuField.value = ''; // el SKU es por producto, se limpia tras registrar
      state.position++; updateHUD();
    } catch (err) {
      Audio.warning();
      showToast('⚠ ' + err.message, true);
    }
  }

  function showToast(text = 'Registrado', isError = false) {
    const toast = document.getElementById('scan-toast');
    toast.textContent = text;
    toast.style.background = isError ? 'var(--red)' : 'var(--green)';
    toast.classList.add('show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toast.classList.remove('show'), isError ? 2000 : 900);
  }

  function showDuplicateModal(barcode, record) {
    const content = document.getElementById('modal-duplicate-content');
    content.innerHTML = `
      ${record.name ? `<div class="loc-row"><span class="loc-key">Nombre</span><span class="loc-val" style="font-size:0.95rem">${esc(record.name)}</span></div>` : ''}
      <div class="loc-row"><span class="loc-key">Código</span><span class="loc-val" style="font-size:0.9rem">${esc(barcode)}</span></div>
      <div class="loc-row"><span class="loc-key">Zona</span><span class="loc-val">${record.zone}</span></div>
      <div class="loc-row"><span class="loc-key">Columna</span><span class="loc-val">${record.column}</span></div>
      <div class="loc-row"><span class="loc-key">Fila</span><span class="loc-val">${record.row}</span></div>
      <div class="loc-row"><span class="loc-key">Posición</span><span class="loc-val">${record.position}</span></div>`;
    document.getElementById('modal-duplicate').style.display = 'flex';
    if (_duplicateTimer) clearTimeout(_duplicateTimer);
    _duplicateTimer = setTimeout(() => Modals.closeDuplicate(), 4000);
  }

  function nextPosition() { state.position++; updateHUD(); }
  function nextRow()      { state.row++; state.position = 1; updateHUD(); flashHUD('hud-row'); }
  function nextColumn()   { state.column++; state.row = 1; state.position = 1; updateHUD(); flashHUD('hud-column'); }
  function nextZone()     { state.zone++; state.column = 1; state.row = 1; state.position = 1; updateHUD(); flashHUD('hud-zone'); }

  function flashHUD(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.color = 'var(--green)';
    setTimeout(() => { el.style.color = ''; }, 800);
  }

  // Ingreso manual del código a registrar en la posición actual.
  function openManual() {
    ManualEntry.open({
      title:    'Ingresar código',
      label:    'Código de barras',
      text:     'Escribe el código a registrar en la posición actual.',
      onSubmit: (val) => handleScan(val),
    });
  }

  return { openSetup, start, stop, openManual, nextPosition, nextRow, nextColumn, nextZone };
})();


// ===================================
// BÚSQUEDA DE PRODUCTOS
// ===================================
const Lookup = (() => {
  let _scanning = false;
  let _mode = 'barcode';      // 'barcode' | 'sku'
  let _lastRecord = null;     // último producto encontrado (para editar/eliminar)
  let _lastCode = null;       // último código escaneado/ingresado

  // Paso previo: elegir método de búsqueda.
  function chooseMethod() {
    if (!DB.isConfigured()) { Settings.openNotConfigured(); return; }
    App.goTo('search-method');
  }

  // Inicia la búsqueda con un método ('barcode' | 'sku').
  function startWith(mode) {
    if (!DB.isConfigured()) { Settings.openNotConfigured(); return; }
    _mode = (mode === 'sku') ? 'sku' : 'barcode';
    App.goTo('lookup'); // el router llama a init()
  }

  function init() {
    if (!DB.isConfigured()) { Settings.openNotConfigured(); App.goTo('home'); return; }
    const title  = document.getElementById('lookup-title');
    const status = document.getElementById('lookup-scan-status');
    if (_mode === 'sku') {
      if (title)  title.textContent  = 'Buscar por SKU';
      if (status) status.textContent = 'Escanea o ingresa el SKU';
    } else {
      if (title)  title.textContent  = 'Buscar por código';
      if (status) status.textContent = 'Escanea el código de barras';
    }
    _scanning = true;
    setTimeout(() => { Scanner.start('lookup-video', handleScan); }, 300);
  }

  function stop() { _scanning = false; Scanner.stop(); }

  function stopAndGoHome() { stop(); App.goTo('home'); }

  function _activate(id) {
    const current = document.querySelector('.screen.active');
    if (current) current.classList.remove('active');
    document.getElementById(id).classList.add('active');
  }

  async function handleScan(code) {
    if (!_scanning) return;
    _scanning = false; stop();
    await process(code);
  }

  // Procesa un código (escaneado o manual) según el modo actual.
  async function process(code) {
    const value = (code || '').trim();
    if (!value) return;
    _lastCode = value;

    let record = null;
    try {
      record = (_mode === 'sku') ? await DB.getBySku(value) : await DB.get(value);
    } catch (e) { record = null; }

    if (record) {
      showResult(value, record);
      _activate('screen-lookup-result');
      return;
    }

    // NO ENCONTRADO → registro on-the-fly (si el usuario puede registrar)
    if (Auth.canScan()) {
      Audio.warning();
      ProductForm.openNew(_mode === 'sku' ? { sku: value } : { barcode: value });
    } else {
      showNotFound(value);
      _activate('screen-lookup-result');
    }
  }

  function showResult(code, record) {
    _lastRecord = record;
    _lastCode = code;
    const content = document.getElementById('result-content');
    Audio.success();

    const deleteBtn = Auth.canDelete()
      ? `<button class="btn-delete" onclick="Lookup.askDelete()">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
           Eliminar producto
         </button>`
      : '';
    const editBtn = Auth.canEdit()
      ? `<button class="btn-edit" onclick="Editor.open()">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
           Editar información
         </button>`
      : '';
    const skuLine = record.sku
      ? `<div class="result-barcode">SKU: ${esc(record.sku)}</div>` : '';

    content.innerHTML = `
      <div class="result-found">
        <div class="result-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Ubicación correcta
        </div>
        ${record.name ? `<div class="result-name">${esc(record.name)}</div>` : ''}
        <div class="result-grid">
          <div class="result-cell"><span class="result-cell-label">Zona</span><span class="result-cell-value">${record.zone}</span></div>
          <div class="result-cell"><span class="result-cell-label">Columna</span><span class="result-cell-value">${record.column}</span></div>
          <div class="result-cell"><span class="result-cell-label">Fila</span><span class="result-cell-value">${record.row}</span></div>
          <div class="result-cell"><span class="result-cell-label">Posición</span><span class="result-cell-value">${record.position}</span></div>
        </div>
        <div class="result-barcode">Código: ${esc(record.barcode)}</div>
        ${skuLine}
      </div>
      ${editBtn}
      ${deleteBtn}
      <button class="btn-new-search" onclick="Lookup.newSearch()">Nueva búsqueda</button>`;
  }

  function showNotFound(code) {
    _lastRecord = null;
    _lastCode = code;
    Audio.warning();
    const label = (_mode === 'sku') ? 'SKU' : 'código';
    const content = document.getElementById('result-content');
    content.innerHTML = `
      <div class="result-not-found">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <h3>No encontrado</h3>
        <p>El producto con ${label} <strong>${esc(code)}</strong> no está registrado. Inicia sesión como empleado para agregarlo.</p>
      </div>
      <button class="btn-primary" onclick="AdminUI.openLogin('Inicia sesión como empleado para registrar productos.')">Iniciar sesión</button>
      <button class="btn-retry" onclick="Lookup.newSearch()">Volver al inicio</button>`;
  }

  // Muestra un producto recién registrado (lo usa ProductForm).
  function displayRecord(record) {
    showResult(record.barcode, record);
    _activate('screen-lookup-result');
  }

  // Entrada manual de código (respaldo si el lector falla).
  function openManual() {
    ManualEntry.open({
      title:       (_mode === 'sku') ? 'Ingresar SKU' : 'Ingresar código',
      label:       (_mode === 'sku') ? 'SKU' : 'Código de barras',
      text:        (_mode === 'sku')
                     ? 'Escribe el SKU (ID interno) del producto.'
                     : 'Escribe el código de barras del producto.',
      onSubmit:    (val) => { stop(); process(val); },
    });
  }

  function currentRecord() { return _lastRecord; }
  function currentCode()   { return _lastCode; }
  function newSearch()     { stopAndGoHome(); }

  // ----- Eliminar (solo admin) -----
  function askDelete() {
    if (!Auth.canDelete()) return;
    const r = _lastRecord;
    document.getElementById('delete-target').textContent =
      (r && r.name) ? r.name : ((r && r.barcode) || _lastCode || '');
    document.getElementById('modal-delete-product').style.display = 'flex';
  }

  async function confirmDelete() {
    try {
      await DB.remove(_lastRecord ? _lastRecord.barcode : _lastCode);
      Modals.closeDeleteProduct();
      Audio.success();
      stopAndGoHome();
    } catch (err) {
      Audio.warning();
      const el = document.getElementById('delete-error');
      el.textContent = err.message;
    }
  }

  // refresca la vista tras editar
  function refreshAfterEdit(record) { showResult(record.barcode, record); }

  return {
    chooseMethod, startWith, init, stop, stopAndGoHome, newSearch,
    handleScan, openManual, displayRecord,
    currentRecord, currentCode, askDelete, confirmDelete, refreshAfterEdit,
  };
})();


// ===================================
// EDITOR DE PRODUCTOS (todos los usuarios)
// ===================================
const Editor = (() => {
  function open() {
    const r = Lookup.currentRecord();
    if (!r) return;
    if (!Auth.canEdit()) { AdminUI.openLogin('Inicia sesión como empleado para editar productos.'); return; }
    document.getElementById('edit-barcode').textContent = r.barcode;
    document.getElementById('edit-sku').value      = r.sku || '';
    document.getElementById('edit-name').value     = r.name || '';
    document.getElementById('edit-zone').value      = r.zone;
    document.getElementById('edit-column').value    = r.column;
    document.getElementById('edit-row').value       = r.row;
    document.getElementById('edit-position').value  = r.position;
    document.getElementById('edit-msg').textContent = '';
    App.goTo('edit');
  }

  async function save() {
    const r = Lookup.currentRecord();
    if (!r) return;
    const updated = {
      barcode:  r.barcode,
      sku:      document.getElementById('edit-sku').value.trim(),
      name:     document.getElementById('edit-name').value.trim(),
      zone:     parseInt(document.getElementById('edit-zone').value, 10) || 1,
      column:   parseInt(document.getElementById('edit-column').value, 10) || 1,
      row:      parseInt(document.getElementById('edit-row').value, 10) || 1,
      position: parseInt(document.getElementById('edit-position').value, 10) || 1,
    };
    try {
      const saved = await DB.update(updated);
      Audio.success();
      Lookup.refreshAfterEdit(saved);
      // volver a la pantalla de resultado
      const current = document.querySelector('.screen.active');
      if (current) current.classList.remove('active');
      document.getElementById('screen-lookup-result').classList.add('active');
    } catch (err) {
      Audio.warning();
      const el = document.getElementById('edit-msg');
      el.textContent = err.message;
      el.style.color = 'var(--red)';
    }
  }

  function cancel() {
    const current = document.querySelector('.screen.active');
    if (current) current.classList.remove('active');
    document.getElementById('screen-lookup-result').classList.add('active');
  }

  return { open, save, cancel };
})();


// ===================================
// REGISTRO DE UN PRODUCTO (on-the-fly, cuando no se encuentra)
// ===================================
const ProductForm = (() => {
  function openNew(prefill) {
    if (!Auth.canScan()) {
      AdminUI.openLogin('Inicia sesión como empleado para registrar productos.');
      return;
    }
    const p = prefill || {};
    document.getElementById('pf-barcode').value  = p.barcode || '';
    document.getElementById('pf-sku').value      = p.sku || '';
    document.getElementById('pf-name').value     = '';
    document.getElementById('pf-zone').value     = 1;
    document.getElementById('pf-column').value   = 1;
    document.getElementById('pf-row').value      = 1;
    document.getElementById('pf-position').value = 1;
    const msg = document.getElementById('pf-msg');
    if (msg) msg.textContent = '';
    App.goTo('product-form');
    setTimeout(() => {
      const focusId = p.barcode ? 'pf-sku' : 'pf-barcode';
      const el = document.getElementById(focusId);
      if (el) el.focus();
    }, 200);
  }

  async function save() {
    const msg = document.getElementById('pf-msg');
    const barcode = document.getElementById('pf-barcode').value.trim();
    if (!barcode) { _err(msg, 'El código de barras es obligatorio'); return; }

    const record = {
      barcode,
      sku:      document.getElementById('pf-sku').value.trim(),
      name:     document.getElementById('pf-name').value.trim(),
      zone:     parseInt(document.getElementById('pf-zone').value, 10) || 1,
      column:   parseInt(document.getElementById('pf-column').value, 10) || 1,
      row:      parseInt(document.getElementById('pf-row').value, 10) || 1,
      position: parseInt(document.getElementById('pf-position').value, 10) || 1,
    };

    msg.style.color = 'var(--text-dim)';
    msg.textContent = 'Guardando...';
    try {
      const saved = await DB.add(record);
      Audio.success();
      Lookup.displayRecord(saved);
    } catch (err) {
      Audio.warning();
      _err(msg, err.message);
    }
  }

  function cancel() { App.goTo('home'); }
  function _err(el, text) { if (el) { el.style.color = 'var(--red)'; el.textContent = text; } }

  return { openNew, save, cancel };
})();


// ===================================
// INGRESO MANUAL DE CÓDIGO (respaldo del lector)
// ===================================
const ManualEntry = (() => {
  let _onSubmit = null;

  function open(opts) {
    const o = opts || {};
    _onSubmit = o.onSubmit || null;
    document.getElementById('manual-title').textContent = o.title || 'Ingresar código';
    document.getElementById('manual-label').textContent = o.label || 'Código';
    document.getElementById('manual-text').textContent  = o.text || '';
    const input = document.getElementById('manual-input');
    input.value = '';
    input.placeholder = o.placeholder || '';
    document.getElementById('manual-error').textContent = '';
    document.getElementById('modal-manual').style.display = 'flex';
    setTimeout(() => input.focus(), 100);
  }

  function close() {
    document.getElementById('modal-manual').style.display = 'none';
    _onSubmit = null;
  }

  function submit() {
    const val = document.getElementById('manual-input').value.trim();
    if (!val) { document.getElementById('manual-error').textContent = 'Escribe un código'; return; }
    const cb = _onSubmit;
    close();
    if (cb) cb(val);
  }

  return { open, close, submit };
})();


// ===================================
// ADMINISTRADOR (login / logout)
// ===================================
const AdminUI = (() => {
  const DEFAULT_LOGIN_MSG = 'Ingresa con tu cuenta de empleado.';

  function openLogin(message) {
    closeRegister();
    const msgEl = document.getElementById('login-msg');
    if (msgEl) msgEl.textContent = message || DEFAULT_LOGIN_MSG;
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').textContent = '';
    document.getElementById('modal-login').style.display = 'flex';
    setTimeout(() => document.getElementById('login-email').focus(), 100);
  }
  function closeLogin() { document.getElementById('modal-login').style.display = 'none'; }

  async function submitLogin() {
    const email = document.getElementById('login-email').value;
    const pass  = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    if (!email || !pass) { errEl.textContent = 'Completa correo y contraseña'; return; }
    errEl.textContent = 'Verificando...';
    const { ok, error } = await Auth.login(email, pass);
    if (ok) { Audio.success(); closeLogin(); _afterAuthChange(); }
    else    { Audio.warning(); errEl.textContent = error; }
  }

  // ---------- Registro ----------
  function openRegister() {
    closeLogin();
    ['reg-doc', 'reg-name', 'reg-email', 'reg-password'].forEach((id) => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('reg-msg').textContent = '';
    document.getElementById('modal-register').style.display = 'flex';
    setTimeout(() => document.getElementById('reg-doc').focus(), 100);
  }
  function closeRegister() {
    const m = document.getElementById('modal-register');
    if (m) m.style.display = 'none';
  }

  async function submitRegister() {
    const documento = document.getElementById('reg-doc').value;
    const nombre    = document.getElementById('reg-name').value;
    const email     = document.getElementById('reg-email').value;
    const password  = document.getElementById('reg-password').value;
    const msgEl     = document.getElementById('reg-msg');

    if (!documento || !nombre || !email || !password) {
      msgEl.style.color = 'var(--red)';
      msgEl.textContent = 'Completa todos los campos';
      return;
    }
    if (password.length < 6) {
      msgEl.style.color = 'var(--red)';
      msgEl.textContent = 'La contraseña debe tener al menos 6 caracteres';
      return;
    }

    msgEl.style.color = 'var(--text-dim)';
    msgEl.textContent = 'Creando cuenta...';
    const res = await Auth.register({ documento, nombre, email, password });
    if (!res.ok) {
      Audio.warning();
      msgEl.style.color = 'var(--red)';
      msgEl.textContent = res.error;
      return;
    }
    Audio.success();
    if (res.needsConfirm) {
      msgEl.style.color = 'var(--green)';
      msgEl.textContent = '✓ Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.';
      setTimeout(() => { closeRegister(); openLogin('Confirma tu correo y luego inicia sesión.'); }, 2600);
    } else {
      msgEl.style.color = 'var(--green)';
      msgEl.textContent = '✓ ¡Bienvenido, ' + Auth.roleLabel(res.role) + '!';
      setTimeout(() => { closeRegister(); _afterAuthChange(); }, 1200);
    }
  }

  async function logout() { await Auth.logout(); _afterAuthChange(); }

  function _afterAuthChange() {
    if (typeof Settings !== 'undefined' && App.getCurrentScreen() === 'settings') Settings.load();
    if (typeof updateHomeDashboard === 'function') updateHomeDashboard().catch(() => {});
  }

  // Refleja el rol en la insignia y en el botón de registro del Home.
  function reflectRole(role) {
    const badge = document.getElementById('role-badge');
    if (badge) {
      badge.textContent = Auth.roleLabel(role).toUpperCase();
      const cls = (role === 'admin' || role === 'lider' || role === 'empleado') ? role : 'common';
      badge.className = 'role-badge ' + cls;
    }
    const regBtn = document.getElementById('btn-home-register');
    if (regBtn) regBtn.classList.toggle('locked', !Auth.canScan());
  }

  return {
    openLogin, closeLogin, submitLogin,
    openRegister, closeRegister, submitRegister,
    logout, reflectRole,
  };
})();


// ===================================
// MINI TUTORIAL
// ===================================
const Tutorial = (() => {
  const STEPS = [
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
      title: 'HomeCode Stock',
      text: 'Convierte el código de barras de un producto en su ubicación física exacta dentro de la bodega: Zona, Columna, Fila y Posición.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
      title: 'Buscar producto',
      text: 'Cualquier persona puede escanear un código para ver dónde está el producto. No necesitas iniciar sesión para buscar.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
      title: 'Registrar y editar',
      text: 'Los empleados inician sesión para escanear y registrar la ubicación de los productos, y para editar su información. Avanza con los botones Posición / Fila / Columna / Zona.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      title: 'Tipos de usuario',
      text: 'Cliente: solo busca. Empleado: busca, registra y edita. Líder de zona: igual que el empleado pero no puede borrar. Administrador: puede todo, incluido eliminar productos e importar/exportar la base.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
      title: '¿Eres empleado?',
      text: 'Crea tu cuenta con el documento interno que te dio tu empresa, o inicia sesión desde Configuración. ¡Listo para empezar!',
    },
  ];
  let _i = 0;

  function _render() {
    const s = STEPS[_i];
    document.getElementById('tut-icon').innerHTML = s.icon;
    document.getElementById('tut-title').textContent = s.title;
    document.getElementById('tut-text').textContent = s.text;
    const dots = STEPS.map((_, idx) =>
      `<span class="tut-dot${idx === _i ? ' active' : ''}"></span>`).join('');
    document.getElementById('tut-dots').innerHTML = dots;
    document.getElementById('tut-prev').style.visibility = _i === 0 ? 'hidden' : 'visible';
    document.getElementById('tut-next').textContent = _i === STEPS.length - 1 ? 'Entendido' : 'Siguiente';
  }

  function open() { _i = 0; _render(); document.getElementById('modal-tutorial').style.display = 'flex'; }
  function close() {
    document.getElementById('modal-tutorial').style.display = 'none';
    localStorage.setItem('tutorial_seen', '1');
  }
  function next() { if (_i < STEPS.length - 1) { _i++; _render(); } else { close(); } }
  function prev() { if (_i > 0) { _i--; _render(); } }

  function maybeShowFirstTime() {
    if (!localStorage.getItem('tutorial_seen')) open();
  }

  return { open, close, next, prev, maybeShowFirstTime };
})();


// ===================================
// MODALES
// ===================================
const Modals = (() => {
  function closeDuplicate()     { document.getElementById('modal-duplicate').style.display = 'none'; }
  function closeConfirmClear()  { document.getElementById('modal-confirm-clear').style.display = 'none'; }
  function closeDeleteProduct() {
    document.getElementById('modal-delete-product').style.display = 'none';
    document.getElementById('delete-error').textContent = '';
  }
  return { closeDuplicate, closeConfirmClear, closeDeleteProduct };
})();


// ===================================
// CONFIGURACIÓN
// ===================================
const Settings = (() => {
  async function load() {
    const statusEl = document.getElementById('online-status');
    const dbStatsEl = document.getElementById('db-stats');
    const ctxInfoEl = document.getElementById('contextual-info');

    // Conexión activa dot / label logic
    if (statusEl) {
      if (!DB.isConfigured()) {
        statusEl.innerHTML = '<span class="dot off"></span> Base de datos: Sin configurar';
        statusEl.style.color = 'var(--red)';
      } else if (DB.isOnline()) {
        statusEl.innerHTML = '<span class="dot on"></span> Conexión activa';
        statusEl.style.color = 'var(--green)';
      } else {
        statusEl.innerHTML = '<span class="dot warn"></span> Sin conexión (modo local)';
        statusEl.style.color = 'var(--yellow)';
      }
    }

    // Product counts
    let count = 0;
    try {
      count = await DB.count();
      if (dbStatsEl) {
        dbStatsEl.innerHTML = `<strong>${count}</strong> producto${count !== 1 ? 's' : ''} en servidor`;
      }
    } catch (e) {
      if (dbStatsEl) dbStatsEl.innerHTML = 'Error al consultar productos';
    }

    // Enriqueciendo la información contextual (Sincronización, respaldos, admin)
    const backupDate = localStorage.getItem('last_backup_date') || 'Ninguno realizado';
    const syncTime = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const sesionActiva = Auth.isLoggedIn() ? Auth.roleLabel() : 'Cliente (sin sesión)';

    if (ctxInfoEl) {
      ctxInfoEl.innerHTML = `
        <div class="ctx-item">
          <span class="ctx-title">Última sincronización</span>
          <span class="ctx-desc">Hoy, ${syncTime}</span>
        </div>
        <div class="ctx-item">
          <span class="ctx-title">Último respaldo local</span>
          <span class="ctx-desc">${backupDate}</span>
        </div>
        <div class="ctx-item">
          <span class="ctx-title">Sesión activa</span>
          <span class="ctx-desc">${esc(sesionActiva)}</span>
        </div>
      `;
    }

    // Sección de cuenta / sesión
    const adminBox = document.getElementById('admin-box');
    if (adminBox) {
      if (Auth.isLoggedIn()) {
        adminBox.innerHTML = `
          <div class="admin-status">
            <span class="dot on"></span> Sesión: <strong>${esc(Auth.roleLabel())}</strong>
          </div>
          <div class="admin-email-sub">${esc(Auth.userName() || Auth.userEmail() || '')}</div>
          <button class="btn-setting btn-admin-action logout" onclick="AdminUI.logout()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Cerrar sesión
          </button>`;
      } else {
        adminBox.innerHTML = `
          <div class="admin-status">
            <span class="dot common"></span> Acceso actual: <strong>Cliente</strong>
          </div>
          <button class="btn-setting btn-admin-accent" onclick="AdminUI.openLogin()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            Iniciar sesión
          </button>
          <button class="btn-setting" onclick="AdminUI.openRegister()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
            Crear cuenta de empleado
          </button>`;
      }
    }

    // La sección de respaldo (importar/exportar) es SOLO para administrador
    const backupCard = document.getElementById('card-backup');
    if (backupCard) backupCard.style.display = Auth.canBackup() ? 'flex' : 'none';

    // El botón "Borrar todo" solo lo ve el admin
    const clearAllBtn = document.getElementById('btn-clear-all');
    if (clearAllBtn) {
      clearAllBtn.style.display = Auth.isAdmin() ? 'flex' : 'none';
    }

    const sMsg = document.getElementById('settings-msg');
    if (sMsg) sMsg.textContent = '';

    // Asegurar que el label del tema se actualice al abrir configuración
    updateThemeUI(document.body.classList.contains('dark-theme'));
  }

  function openNotConfigured() {
    document.getElementById('modal-not-configured').style.display = 'flex';
  }
  function closeNotConfigured() {
    document.getElementById('modal-not-configured').style.display = 'none';
  }

  // Toggle light/dark theme
  function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-theme');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeUI(isDark);
    Audio.success();
  }

  function updateThemeUI(isDark) {
    const textEl = document.getElementById('theme-text');
    const iconEl = document.getElementById('theme-icon');
    if (!textEl || !iconEl) return;

    if (isDark) {
      textEl.textContent = 'Modo: Oscuro';
      iconEl.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    } else {
      textEl.textContent = 'Modo: Claro';
      iconEl.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    }
  }

  function initTheme() {
    const saved = localStorage.getItem('theme');
    const isDark = saved === 'dark'; // forced light mode default (isDark=false) when saved is empty or 'light'
    if (isDark) {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
    updateThemeUI(isDark);
  }

  async function exportDB() {
    if (!Auth.canBackup()) { showMsg('Solo el administrador puede exportar', true); return; }
    try {
      const records = await DB.getAll();
      const json = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), records }, null, 2);
      const fileName = `homecode-stock-backup-${new Date().toISOString().slice(0,10)}.json`;
      const blob = new Blob([json], { type: 'application/json' });

      // 1) Intento de compartir como archivo (mejor experiencia en móvil/iOS PWA)
      try {
        const file = new File([blob], fileName, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Respaldo HomeCode Stock' });
          _markBackup();
          showMsg('✓ Respaldo generado');
          load();
          return;
        }
      } catch (shareErr) {
        if (shareErr && shareErr.name === 'AbortError') return; // el usuario canceló
      }

      // 2) Descarga clásica
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();

      // 3) Fallback para iOS en modo standalone (la descarga puede no iniciar)
      const isStandalone = window.navigator.standalone === true ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      if (isStandalone) {
        const w = window.open('', '_blank');
        if (w) {
          w.document.title = fileName;
          w.document.body.style.cssText = 'white-space:pre-wrap;font-family:monospace;font-size:12px;padding:12px;';
          w.document.body.textContent = json;
        }
      }
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      _markBackup();
      showMsg('✓ Exportación exitosa');
      load();
    } catch (err) { showMsg('Error al exportar: ' + err.message, true); }
  }

  function _markBackup() {
    const dateStr = new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    localStorage.setItem('last_backup_date', dateStr);
  }

  function importDB(event) {
    if (!Auth.canBackup()) { showMsg('Solo el administrador puede importar', true); event.target.value = ''; return; }
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.records || !Array.isArray(data.records)) throw new Error('Formato inválido');
        const validated = data.records.map((r, i) => {
          if (!r.barcode || typeof r.barcode !== 'string') throw new Error(`Registro ${i}: código inválido`);
          return {
            barcode: r.barcode, name: r.name || '',
            zone: Number(r.zone) || 1, column: Number(r.column) || 1,
            row: Number(r.row) || 1, position: Number(r.position) || 1,
          };
        });
        const n = await DB.replaceAll(validated);
        showMsg(`✓ ${n} registros importados`); load();
      } catch (err) { showMsg('Error al importar: ' + err.message, true); }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function confirmClear() { document.getElementById('modal-confirm-clear').style.display = 'flex'; }

  async function clearDB() {
    try {
      await DB.clearAll();
      Modals.closeConfirmClear(); load();
      showMsg('✓ Base de datos borrada');
    } catch (err) { Modals.closeConfirmClear(); showMsg('Error: ' + err.message, true); }
  }

  function showMsg(text, isError = false) {
    const el = document.getElementById('settings-msg');
    if (el) {
      el.textContent = text;
      el.style.color = isError ? 'var(--red)' : 'var(--green)';
      setTimeout(() => { el.textContent = ''; }, 4000);
    }
  }

  return { load, exportDB, importDB, confirmClear, clearDB, openNotConfigured, closeNotConfigured, toggleTheme, initTheme };
})();


// ===================================
// UTILIDAD: escapar HTML (evita inyección al pintar datos)
// ===================================
function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}


// ===================================
// ESTADÍSTICAS DEL INSTANTE (DASHBOARD HOME)
// ===================================
async function updateHomeDashboard() {
  const dotEl = document.getElementById('home-indicator-dot');
  const txtEl = document.getElementById('home-indicator-text');
  const prodEl = document.getElementById('home-stat-products');
  const zoneEl = document.getElementById('home-stat-zones');
  const syncEl = document.getElementById('home-stat-sync');

  if (dotEl && txtEl) {
    if (!DB.isConfigured()) {
      dotEl.className = 'dashboard-indicator-dot off';
      txtEl.textContent = 'Sin configurar';
      txtEl.style.color = 'var(--red)';
    } else if (DB.isOnline()) {
      dotEl.className = 'dashboard-indicator-dot on';
      txtEl.textContent = 'Conexión activa';
      txtEl.style.color = 'var(--green)';
    } else {
      dotEl.className = 'dashboard-indicator-dot warn';
      txtEl.textContent = 'Base local (Sin red)';
      txtEl.style.color = 'var(--yellow)';
    }
  }

  try {
    const list = await DB.getAll();
    if (prodEl) prodEl.textContent = list.length;
    
    const uniqueZones = new Set(list.map(item => item.zone).filter(z => z !== undefined && z !== null && z !== ''));
    if (zoneEl) zoneEl.textContent = uniqueZones.size;
  } catch (err) {
    if (prodEl) prodEl.textContent = '0';
    if (zoneEl) zoneEl.textContent = '0';
  }

  if (syncEl) {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    syncEl.textContent = `${hh}:${mm}`;
  }
}


// ===================================
// INIT
// ===================================
document.addEventListener('DOMContentLoaded', () => {
  // Inicialización de Tema Claro / Oscuro persistido
  if (typeof Settings !== 'undefined' && Settings.initTheme) {
    Settings.initTheme();
  }

  DB.open()
    .then(() => {
      updateHomeDashboard().catch(() => {});
    })
    .catch(err => console.error('DB init error:', err));

  // Mostrar el mini tutorial la primera vez que se abre la app
  if (typeof Tutorial !== 'undefined') {
    setTimeout(() => Tutorial.maybeShowFirstTime(), 600);
  }

  // Reacciona a cambios de rol (admin/común)
  if (typeof Auth !== 'undefined') Auth.onChange(AdminUI.reflectRole);

  // Re-sincroniza la caché cuando vuelve la conexión
  window.addEventListener('online',  () => {
    DB.syncCache()
      .then(() => updateHomeDashboard())
      .catch(() => {});
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// Interceptor del botón Back físico de Android
window.onAndroidBackKey = function() {
  if (typeof App === 'undefined') return;
  const current = App.getCurrentScreen();
  if (current === 'home') {
    // Si estamos en la página de inicio, muestra el modal de confirmación de salida
    const modal = document.getElementById('modal-confirm-exit');
    if (modal) modal.style.display = 'flex';
  } else if (current === 'register-setup') {
    App.goTo('home');
  } else if (current === 'register-scan') {
    if (typeof Registration !== 'undefined') Registration.stop();
  } else if (current === 'search-method') {
    App.goTo('home');
  } else if (current === 'lookup') {
    if (typeof Lookup !== 'undefined') Lookup.stopAndGoHome();
  } else if (current === 'lookup-result') {
    if (typeof Lookup !== 'undefined') Lookup.stopAndGoHome();
  } else if (current === 'product-form') {
    if (typeof ProductForm !== 'undefined') ProductForm.cancel();
  } else if (current === 'edit') {
    if (typeof Editor !== 'undefined') Editor.cancel();
  } else if (current === 'settings') {
    App.goTo('home');
  } else {
    App.goTo('home');
  }
};
