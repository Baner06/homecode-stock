/**
 * db.js – Capa de datos de HomeCode Stock (BASE DE DATOS EN LÍNEA)
 *
 * Antes: IndexedDB local (cada celular su propia base aislada).
 * Ahora: Supabase (PostgreSQL en la nube) → base de datos ÚNICA y compartida.
 *        Cuando un usuario escanea/registra un producto, queda disponible
 *        para TODOS los demás usuarios al instante (requisito 1).
 *
 * IndexedDB se conserva SOLO como caché de lectura: si el celular se queda
 * sin internet, las búsquedas siguen mostrando lo último sincronizado.
 *
 * Formato del registro (cara JS):
 *   { barcode, name, zone, column, row, position, createdAt, updatedAt, updatedBy }
 */
const DB = (() => {
  // ---------- Cliente Supabase ----------
  let _client = null;
  let _online = false;   // ¿hay conexión real con Supabase?

  function _initClient() {
    if (_client) return _client;
    if (!window.supabase || !CONFIG.isConfigured()) {
      _online = false;
      return null;
    }
    _client = window.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_ANON_KEY
    );
    _online = true;
    // Entrega el cliente al módulo de autenticación
    if (typeof Auth !== 'undefined') Auth._setClient(_client);
    return _client;
  }

  // Permite verificar conexión real
  function isOnline()     { return _online && navigator.onLine; }
  function isConfigured() { return CONFIG.isConfigured(); }

  // ---------- Mapeo JS <-> columnas de la tabla ----------
  function _toRow(r) {
    return {
      barcode:  r.barcode,
      sku:      (r.sku && r.sku.trim()) ? r.sku.trim() : null,
      name:     r.name || null,
      zone:     r.zone,
      col:      r.column,
      row_num:  r.row,
      position: r.position,
    };
  }
  function _fromRow(row) {
    if (!row) return null;
    return {
      barcode:   row.barcode,
      sku:       row.sku || '',
      name:      row.name || '',
      zone:      row.zone,
      column:    row.col,
      row:       row.row_num,
      position:  row.position,
      createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
      updatedAt: row.updated_at ? Date.parse(row.updated_at) : Date.now(),
      updatedBy: row.updated_by || null,
    };
  }

  // =====================================================================
  //  CACHÉ LOCAL (IndexedDB) – solo para lecturas sin conexión
  // =====================================================================
  const Cache = (() => {
    const DB_NAME = 'homecode_cache';
    const DB_VERSION = 1;
    const STORE = 'products';
    let _idb = null;

    function open() {
      return new Promise((resolve, reject) => {
        if (_idb) return resolve(_idb);
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'barcode' });
          }
        };
        req.onsuccess = (e) => { _idb = e.target.result; resolve(_idb); };
        req.onerror   = (e) => reject(e.target.error);
      });
    }
    function _store(mode) { return _idb.transaction(STORE, mode).objectStore(STORE); }

    function get(barcode) {
      return open().then(() => new Promise((res, rej) => {
        const r = _store('readonly').get(barcode);
        r.onsuccess = (e) => res(e.target.result || null);
        r.onerror   = (e) => rej(e.target.error);
      }));
    }
    function put(rec) {
      return open().then(() => new Promise((res, rej) => {
        const r = _store('readwrite').put(rec);
        r.onsuccess = () => res();
        r.onerror   = (e) => rej(e.target.error);
      }));
    }
    function del(barcode) {
      return open().then(() => new Promise((res, rej) => {
        const r = _store('readwrite').delete(barcode);
        r.onsuccess = () => res();
        r.onerror   = (e) => rej(e.target.error);
      }));
    }
    function getAll() {
      return open().then(() => new Promise((res, rej) => {
        const r = _store('readonly').getAll();
        r.onsuccess = (e) => res(e.target.result || []);
        r.onerror   = (e) => rej(e.target.error);
      }));
    }
    function replaceAll(records) {
      return open().then(() => new Promise((res, rej) => {
        const tx = _idb.transaction(STORE, 'readwrite');
        const st = tx.objectStore(STORE);
        st.clear().onsuccess = () => {
          records.forEach((r) => st.put(r));
        };
        tx.oncomplete = () => res(records.length);
        tx.onerror    = (e) => rej(e.target.error);
      }));
    }
    function count() {
      return open().then(() => new Promise((res, rej) => {
        const r = _store('readonly').count();
        r.onsuccess = (e) => res(e.target.result);
        r.onerror   = (e) => rej(e.target.error);
      }));
    }
    return { open, get, put, del, getAll, replaceAll, count };
  })();

  // =====================================================================
  //  API PÚBLICA – misma forma que antes + update/remove
  // =====================================================================

  /** Inicializa el cliente y precarga la caché. */
  async function open() {
    _initClient();
    await Cache.open().catch(() => {});
    // Sincroniza la caché en segundo plano si hay conexión
    if (isOnline()) syncCache().catch(() => {});
    return true;
  }

  /** Descarga todos los productos y refresca la caché local. */
  async function syncCache() {
    if (!isOnline()) return;
    try {
      const { data, error } = await _client.from('products').select('*');
      if (error) throw error;
      const recs = (data || []).map(_fromRow);
      await Cache.replaceAll(recs);
    } catch (e) {
      console.warn('No se pudo sincronizar la caché:', e.message);
    }
  }

  /** Obtiene un producto por código. Online primero, caché como respaldo. */
  async function get(barcode) {
    if (isOnline()) {
      try {
        const { data, error } = await _client
          .from('products').select('*').eq('barcode', barcode).maybeSingle();
        if (error) throw error;
        const rec = _fromRow(data);
        if (rec) await Cache.put(rec); else await Cache.del(barcode).catch(() => {});
        return rec;
      } catch (e) {
        console.warn('Lectura online falló, usando caché:', e.message);
      }
    }
    return Cache.get(barcode); // respaldo offline
  }

  /** Obtiene un producto por SKU (ID interno). Online primero, caché como respaldo. */
  async function getBySku(sku) {
    const key = (sku || '').trim();
    if (!key) return null;
    if (isOnline()) {
      try {
        const { data, error } = await _client
          .from('products').select('*').eq('sku', key).maybeSingle();
        if (error) throw error;
        const rec = _fromRow(data);
        if (rec) await Cache.put(rec);
        return rec;
      } catch (e) {
        console.warn('Lectura por SKU online falló, usando caché:', e.message);
      }
    }
    // Respaldo offline: busca en la caché local
    const all = await Cache.getAll().catch(() => []);
    return all.find((r) => (r.sku || '').trim() === key) || null;
  }

  /** Registra un producto nuevo. Requiere conexión. */
  async function add(record) {
    if (!isConfigured()) throw new Error('Configura Supabase en config.js');
    if (!isOnline())     throw new Error('Sin conexión: no se puede registrar');
    const { data, error } = await _client
      .from('products').insert(_toRow(record)).select().single();
    if (error) {
      if (error.code === '23505') throw new Error('Ese código ya está registrado');
      throw new Error(error.message);
    }
    const rec = _fromRow(data);
    await Cache.put(rec);
    return rec;
  }

  /** Actualiza la información de un producto (requisito 3). Requiere conexión. */
  async function update(record) {
    if (!isOnline()) throw new Error('Sin conexión: no se puede actualizar');
    const row = _toRow(record);
    row.updated_at = new Date().toISOString();
    row.updated_by = (typeof Auth !== 'undefined' && Auth.userEmail && Auth.userEmail()) || 'usuario';
    const { data, error } = await _client
      .from('products').update(row).eq('barcode', record.barcode).select().single();
    if (error) throw new Error(error.message);
    const rec = _fromRow(data);
    await Cache.put(rec);
    return rec;
  }

  /** Elimina un producto. SOLO funciona para el administrador (RLS lo impone). */
  async function remove(barcode) {
    if (!isOnline()) throw new Error('Sin conexión: no se puede eliminar');
    const { error, count } = await _client
      .from('products').delete({ count: 'exact' }).eq('barcode', barcode);
    if (error) {
      throw new Error('No autorizado para eliminar (solo el administrador puede)');
    }
    if (count === 0) {
      // RLS bloqueó el borrado silenciosamente (usuario común)
      throw new Error('No autorizado: solo el administrador puede eliminar');
    }
    await Cache.del(barcode).catch(() => {});
    return true;
  }

  /** Cuenta total de productos. */
  async function count() {
    if (isOnline()) {
      try {
        const { count, error } = await _client
          .from('products').select('*', { count: 'exact', head: true });
        if (error) throw error;
        return count || 0;
      } catch (e) { /* respaldo */ }
    }
    return Cache.count();
  }

  /** Todos los productos (para exportar). */
  async function getAll() {
    if (isOnline()) {
      try {
        const { data, error } = await _client.from('products').select('*');
        if (error) throw error;
        const recs = (data || []).map(_fromRow);
        await Cache.replaceAll(recs).catch(() => {});
        return recs;
      } catch (e) { /* respaldo */ }
    }
    return Cache.getAll();
  }

  /** Importa un lote de productos (upsert). Requiere conexión. */
  async function replaceAll(records) {
    if (!isOnline()) throw new Error('Sin conexión: no se puede importar');
    const rows = records.map(_toRow);
    const { error } = await _client
      .from('products').upsert(rows, { onConflict: 'barcode' });
    if (error) throw new Error(error.message);
    await syncCache();
    return records.length;
  }

  /** Borra TODA la base (solo admin; RLS bloquea a usuarios comunes). */
  async function clearAll() {
    if (!isOnline()) throw new Error('Sin conexión');
    const { error } = await _client.from('products').delete().neq('barcode', '');
    if (error) throw new Error('No autorizado: solo el administrador puede borrar todo');
    await Cache.replaceAll([]).catch(() => {});
    return true;
  }

  return {
    open, get, getBySku, add, update, remove, count, getAll, replaceAll, clearAll,
    syncCache, isOnline, isConfigured,
  };
})();
