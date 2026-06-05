/**
 * auth.js – Sesión y roles de HomeCode Stock (Supabase Auth)
 *
 * Roles:
 *   - cliente   → no inicia sesión (usuario anónimo). Solo puede BUSCAR.
 *   - empleado  → inicia sesión. Puede buscar, escanear/registrar y editar.
 *   - lider     → como empleado (no puede eliminar productos).
 *   - admin     → todo: buscar, registrar, editar, ELIMINAR, importar/exportar.
 *
 * Quien se registra debe presentar un "documento interno único" que esté
 * en la lista blanca (empleados_autorizados). Ese documento define su rol.
 * La seguridad real la imponen las políticas RLS del servidor.
 */
const Auth = (() => {
  let _client    = null;   // cliente supabase compartido (lo crea db.js)
  let _session   = null;   // sesión actual (null = cliente)
  let _profile   = null;   // perfil { rol, nombre, email, documento }
  let _role      = 'cliente';
  let _listeners = [];

  function _setClient(client) {
    _client = client;
    if (!_client) return;

    // Recupera sesión guardada (sigue logueado tras recargar)
    _client.auth.getSession().then(async ({ data }) => {
      _session = data.session || null;
      await _loadRole();
      _notify();
    });

    // Escucha cambios de sesión (login/logout/expiración)
    _client.auth.onAuthStateChange(async (_event, session) => {
      _session = session || null;
      await _loadRole();
      _notify();
    });
  }

  /** Carga el rol del perfil del usuario logueado. */
  async function _loadRole() {
    if (!_session || !_session.user) { _role = 'cliente'; _profile = null; return; }
    try {
      const { data, error } = await _client
        .from('profiles')
        .select('rol, nombre, email, documento')
        .eq('id', _session.user.id)
        .maybeSingle();
      if (!error && data) {
        _profile = data;
        _role = data.rol || 'empleado';
      } else {
        // Logueado pero aún sin perfil → trátalo como empleado básico
        _profile = null;
        _role = 'empleado';
      }
    } catch (e) {
      _role = 'empleado';
    }
  }

  function _notify() {
    _listeners.forEach((fn) => { try { fn(_role); } catch (e) { /* ignore */ } });
  }

  /** Registra un callback que corre cuando cambia el rol/sesión. */
  function onChange(fn) {
    _listeners.push(fn);
    fn(_role); // estado inicial
  }

  // ---------- Estado / permisos ----------
  function role()       { return _role; }
  function isLoggedIn() { return !!_session && !!_session.user; }
  function isAdmin()    { return _role === 'admin'; }
  function isLeader()   { return _role === 'lider'; }
  function canScan()    { return _role === 'empleado' || _role === 'lider' || _role === 'admin'; }
  function canEdit()    { return canScan(); }
  function canDelete()  { return _role === 'admin'; }
  function canBackup()  { return _role === 'admin'; }
  function userEmail()  { return _session && _session.user ? _session.user.email : null; }
  function userName()   { return (_profile && _profile.nombre) ? _profile.nombre : userEmail(); }

  /** Nombre legible del rol (para la UI). */
  function roleLabel(r) {
    switch (r || _role) {
      case 'admin':    return 'Administrador';
      case 'lider':    return 'Líder de zona';
      case 'empleado': return 'Empleado';
      default:         return 'Cliente';
    }
  }

  // ---------- Login / Logout ----------
  async function login(email, password) {
    if (!_client) return { ok: false, error: 'Base de datos no configurada' };
    const { data, error } = await _client.auth.signInWithPassword({
      email: (email || '').trim(),
      password,
    });
    if (error) return { ok: false, error: _traducir(error.message) };
    _session = data.session;
    await _loadRole();
    _notify();
    return { ok: true, role: _role };
  }

  async function logout() {
    if (!_client) return;
    await _client.auth.signOut();
    _session = null;
    _profile = null;
    _role = 'cliente';
    _notify();
  }

  // ---------- Registro de empleados ----------
  /** Comprueba si un documento interno está autorizado. Devuelve {ok, role}. */
  async function verifyDocument(doc) {
    if (!_client) return { ok: false, error: 'Base de datos no configurada' };
    const { data, error } = await _client.rpc('verificar_documento', { p_doc: (doc || '').trim() });
    if (error) return { ok: false, error: _traducir(error.message) };
    if (!data)  return { ok: false, error: 'Documento no autorizado o ya registrado' };
    return { ok: true, role: data };
  }

  /**
   * Crea una cuenta de empleado.
   * Requiere un documento autorizado (define el rol en el servidor).
   * Devuelve {ok, role, needsConfirm} o {ok:false, error}.
   */
  async function register({ documento, nombre, email, password }) {
    if (!_client) return { ok: false, error: 'Base de datos no configurada' };

    const v = await verifyDocument(documento);
    if (!v.ok) return v;

    const { data, error } = await _client.auth.signUp({
      email: (email || '').trim(),
      password,
      options: { data: { documento: (documento || '').trim(), nombre: (nombre || '').trim() } },
    });
    if (error) return { ok: false, error: _traducir(error.message) };

    // Si la confirmación de correo está desactivada, ya hay sesión.
    if (data.session) {
      _session = data.session;
      await _loadRole();
      _notify();
      return { ok: true, role: _role, needsConfirm: false };
    }
    // Si está activada, hay que confirmar el correo antes de entrar.
    return { ok: true, role: v.role, needsConfirm: true };
  }

  function _traducir(msg) {
    if (/invalid login credentials/i.test(msg))       return 'Correo o contraseña incorrectos';
    if (/email not confirmed/i.test(msg))             return 'Debes confirmar tu correo antes de entrar';
    if (/user already registered/i.test(msg))         return 'Ese correo ya tiene una cuenta';
    if (/password should be at least/i.test(msg))     return 'La contraseña es muy corta (mínimo 6 caracteres)';
    if (/unable to validate email|invalid email/i.test(msg)) return 'Correo inválido';
    if (/network/i.test(msg))                          return 'Sin conexión a internet';
    return msg;
  }

  return {
    _setClient, onChange,
    role, roleLabel, isLoggedIn, isAdmin, isLeader,
    canScan, canEdit, canDelete, canBackup, userEmail, userName,
    login, logout, register, verifyDocument,
  };
})();
