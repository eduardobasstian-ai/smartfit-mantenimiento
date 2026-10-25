/* Cliente público para el inicio de sesión por usuario/RUT. La clave publishable
   puede estar en el frontend; la service_role se usa solo dentro de la Edge Function. */
(function (global) {
  "use strict";

  const SUPABASE_URL = "https://acmcksmiqrfrxopceies.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uWaLgff_Xc03iC68QpUUuQ_QkmCLLGy";
  const LOGIN_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/login-by-username`;
  const LOGIN_DIRECTORY_URL = `${SUPABASE_URL}/functions/v1/login-directory`;

  async function listLoginDirectory() {
    const response = await fetch(LOGIN_DIRECTORY_URL, {
      method: "GET",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
    });
    let result = {};
    try { result = await response.json(); } catch (error) { /* respuesta vacía */ }
    if (!response.ok) throw new Error(result.error || "No se pudo cargar la nómina de acceso.");
    return Array.isArray(result.users) ? result.users : [];
  }

  async function login(username, password) {
    const normalizedUsername = String(username || "").trim();
    if (!normalizedUsername) throw new Error("El perfil seleccionado no tiene un usuario asignado.");
    const response = await fetch(LOGIN_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ username: normalizedUsername, password: String(password || "") }),
    });

    let result = {};
    try { result = await response.json(); } catch (error) { /* respuesta vacía */ }
    if (!response.ok) throw new Error(result.error || "No se pudo iniciar sesión.");
    if (!result.user || !result.auth?.access_token || !result.auth?.refresh_token) {
      throw new Error("La respuesta de autenticación está incompleta.");
    }

    sessionStorage.setItem("smartfit.supabase.auth", JSON.stringify(result.auth));
    return result.user;
  }

  function clearSession() {
    sessionStorage.removeItem("smartfit.supabase.auth");
  }

  global.SmartFitSupabaseAuth = { login, listLoginDirectory, clearSession };
})(window);
