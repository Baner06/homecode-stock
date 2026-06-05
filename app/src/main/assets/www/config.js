/**
 * config.js – Configuración de HomeCode Stock
 *
 * 👉 Rellena estos dos valores con los de TU proyecto de Supabase:
 * Supabase → Project Settings → Data API (o API)
 * - Project URL   → SUPABASE_URL
 * - anon public   → SUPABASE_ANON_KEY   (la clave "anon", NO la "service_role")
 *
 * La clave "anon" es pública y segura para el navegador: lo que protege
 * tus datos son las políticas RLS definidas en supabase_setup.sql.
 */
const CONFIG = {
  SUPABASE_URL:      'https://nnflmwuctvizhubpqbjc.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_6uaYVO-j62M2HKIGZ-gx6g_PzUwXVWx',

  // Correo del administrador (solo se usa para mostrarlo en la UI;
  // la seguridad real la impone RLS en el servidor).
  ADMIN_EMAIL: 'admincode@hcs.com',
};

// ¿Ya está configurado? (evita llamadas a una URL de ejemplo)
CONFIG.isConfigured = () =>
  CONFIG.SUPABASE_URL.startsWith('https://') &&
  !CONFIG.SUPABASE_URL.includes('TU-PROYECTO') &&
  CONFIG.SUPABASE_ANON_KEY.length > 20 &&
  !CONFIG.SUPABASE_ANON_KEY.includes('TU_CLAVE');
