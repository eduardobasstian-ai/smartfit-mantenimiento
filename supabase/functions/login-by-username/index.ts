import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Solicitud no válida." }, 405);

  let username = "";
  let password = "";
  try {
    const body = await request.json();
    username = String(body?.username ?? "").trim().toLocaleLowerCase("es");
    password = String(body?.password ?? "");
  } catch {
    return jsonResponse({ error: "Usuario o contraseña incorrectos." }, 400);
  }
  if (!username || !password || username.length > 120 || password.length > 256) {
    return jsonResponse({ error: "Usuario o contraseña incorrectos." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "El acceso no está configurado en el servidor." }, 503);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, legacy_id, full_name, username, role, active, password_change_required")
    .eq("username_normalized", username)
    .maybeSingle();

  if (profileError) {
    console.error("login_profile_lookup_failed", { code: profileError.code, message: profileError.message });
  }

  let authEmail = "invalid-login@invalid.invalid";
  if (!profileError && profile?.active) {
    const { data: authUser } = await adminClient.auth.admin.getUserById(profile.id);
    if (authUser?.user?.email) authEmail = authUser.user.email;
  }

  // Siempre se consulta Auth, incluso si el usuario no existe, para aprovechar
  // sus límites de intentos y responder con el mismo mensaje en ambos casos.
  const { data: authResult, error: authError } = await authClient.auth.signInWithPassword({
    email: authEmail,
    password,
  });
  if (profileError || !profile?.active || authError || !authResult.session) {
    console.warn("login_rejected", {
      profileFound: Boolean(profile),
      profileActive: Boolean(profile?.active),
      authErrorCode: authError?.code || null,
      authErrorStatus: authError?.status || null,
      authErrorMessage: authError?.message || null,
    });
    return jsonResponse({ error: "Usuario o contraseña incorrectos, o cuenta inactiva." }, 401);
  }

  const { data: assignments } = await adminClient
    .from("site_assignments")
    .select("site_id, assignment_role")
    .eq("user_id", profile.id);

  return jsonResponse({
    user: {
      id: profile.legacy_id || profile.id,
      authId: profile.id,
      name: profile.full_name,
      username: profile.username,
      role: profile.role,
      active: profile.active,
      mustChangePassword: profile.password_change_required === true,
      siteIds: (assignments || []).map((assignment) => assignment.site_id),
    },
    auth: {
      access_token: authResult.session.access_token,
      refresh_token: authResult.session.refresh_token,
      expires_at: authResult.session.expires_at,
      token_type: authResult.session.token_type,
    },
  });
});
