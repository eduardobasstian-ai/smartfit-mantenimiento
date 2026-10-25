import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const roles = ["Administrador", "Supervisor", "Técnico", "Líder"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const fail = (message: string, status = 400) => json({ error: message }, status);

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return fail("Método no permitido.", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!url || !anon || !serviceRole || !token) return fail("Sesión o configuración inválida.", 401);

  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const authClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  const actorId = authData?.user?.id;
  if (authError || !actorId) return fail("La sesión expiró. Inicia sesión nuevamente.", 401);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return fail("Solicitud inválida."); }
  const operation = String(body.operation || "");

  if (operation === "change_own_password") {
    const password = String(body.password || "");
    if (password.length < 8) return fail("La contraseña debe tener al menos 8 caracteres.");
    const { error } = await admin.auth.admin.updateUserById(actorId, { password });
    if (error) return fail(error.message, 400);
    const { error: profileError } = await admin.from("profiles").update({ password_change_required: false, updated_at: new Date().toISOString() }).eq("id", actorId);
    if (profileError) return fail("La clave cambió, pero no se pudo actualizar el estado del perfil. Contacta al administrador.", 500);
    return json({ ok: true });
  }

  const { data: actorProfile, error: actorProfileError } = await admin.from("profiles").select("id,role,active").eq("id", actorId).maybeSingle();
  if (actorProfileError || !actorProfile?.active || actorProfile.role !== "Administrador") return fail("Solo un administrador activo puede gestionar usuarios.", 403);
  if (operation !== "save_user") return fail("Operación no reconocida.");

  const legacyId = String(body.legacyId || "").trim();
  const fullName = String(body.fullName || "").trim();
  const username = String(body.username || "").trim();
  const role = String(body.role || "");
  const email = String(body.email || "").trim().toLowerCase();
  const active = body.active !== false;
  const tempPassword = String(body.tempPassword || "");
  const siteLegacyIds = role === "Administrador" ? [] : [...new Set(Array.isArray(body.siteIds) ? body.siteIds.map(String) : [])];
  if (!legacyId || !fullName || !username || !roles.includes(role)) return fail("Completa nombre, usuario y rol válido.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Ingresa un correo electrónico válido.");
  if (tempPassword && tempPassword.length < 8) return fail("La clave temporal debe tener al menos 8 caracteres.");

  const { data: existing, error: existingError } = await admin.from("profiles")
    .select("id,legacy_id,role,active,password_change_required")
    .eq("legacy_id", legacyId).maybeSingle();
  if (existingError) return fail(existingError.message, 500);
  let existingEmail = "";
  if (existing?.id) {
    const { data: accessRow, error: accessError } = await admin.from("admin_user_access")
      .select("email").eq("profile_id", existing.id).maybeSingle();
    if (accessError) return fail(accessError.message, 500);
    existingEmail = String(accessRow?.email || "");
  }
  if (legacyId === "admin-edu" && (role !== "Administrador" || !active)) return fail("La cuenta inicial de administrador está protegida.", 403);
  if (existing?.role === "Administrador" && existing.active && (!active || role !== "Administrador")) {
    const { count, error } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "Administrador").eq("active", true);
    if (error) return fail(error.message, 500);
    if ((count || 0) <= 1) return fail("No puedes desactivar ni cambiar el rol del último administrador activo.", 403);
  }

  const { data: sites, error: sitesError } = siteLegacyIds.length
    ? await admin.from("sites").select("id,legacy_id").in("legacy_id", siteLegacyIds)
    : { data: [], error: null };
  if (sitesError) return fail(sitesError.message, 500);
  if ((sites || []).length !== siteLegacyIds.length) return fail("Una o más sedes seleccionadas no existen en Supabase.");

  let authId = existing?.id || "";
  let createdAuthUser = false;
  const chosenEmail = email || existingEmail;
  if (!chosenEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chosenEmail)) return fail("Cada cuenta debe tener un correo de acceso válido.");
  if (!authId) {
    if (!chosenEmail || !tempPassword) return fail("Para crear el acceso se requiere correo y clave temporal.");
    const { data, error } = await admin.auth.admin.createUser({ email: chosenEmail, password: tempPassword, email_confirm: true });
    if (error || !data.user) return fail(error?.message || "No se pudo crear el acceso en Auth.", 400);
    authId = data.user.id;
    createdAuthUser = true;
  } else {
    const authUpdates: { email?: string; email_confirm?: boolean; password?: string } = {};
    if (email && email !== existingEmail) { authUpdates.email = email; authUpdates.email_confirm = true; }
    if (tempPassword) authUpdates.password = tempPassword;
    if (Object.keys(authUpdates).length) {
      const { error } = await admin.auth.admin.updateUserById(authId, authUpdates);
      if (error) return fail(error.message, 400);
    }
  }

  const profileRow = {
    id: authId, legacy_id: legacyId, full_name: fullName, username, role, active,
    password_change_required: Boolean(tempPassword) || existing?.password_change_required === true, updated_at: new Date().toISOString()
  };
  const { error: profileError } = await admin.from("profiles").upsert(profileRow, { onConflict: "id" });
  if (profileError) {
    if (createdAuthUser) await admin.auth.admin.deleteUser(authId);
    return fail(profileError.message, 400);
  }

  const { error: accessWriteError } = await admin.from("admin_user_access").upsert({
    profile_id: authId, email: chosenEmail, updated_at: new Date().toISOString()
  }, { onConflict: "profile_id" });
  if (accessWriteError) return fail(`El perfil se guardó, pero no se pudo guardar el correo de acceso: ${accessWriteError.message}`, 500);

  const { error: deleteAssignmentsError } = await admin.from("site_assignments").delete().eq("user_id", authId);
  if (deleteAssignmentsError) return fail(deleteAssignmentsError.message, 500);
  const assignments = role === "Administrador" ? [] : (sites || []).map(site => ({ site_id: site.id, user_id: authId, assignment_role: role }));
  if (assignments.length) {
    const { error } = await admin.from("site_assignments").insert(assignments);
    if (error) return fail(error.message, 500);
  }
  await admin.from("audit_log").insert({
    actor_id: actorId, action: tempPassword ? "user_access_saved_with_temporary_password" : "user_access_saved",
    entity_type: "profile", entity_id: legacyId,
    details: { role, active, site_count: assignments.length, password_reset: Boolean(tempPassword) }
  });
  return json({ ok: true, legacyId, authId, passwordChangeRequired: Boolean(tempPassword) });
});
