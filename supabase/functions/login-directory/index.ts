import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET") return jsonResponse({ error: "Solicitud no válida." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "El directorio de acceso no está configurado." }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, username, role")
    .eq("active", true)
    .in("role", ["Técnico", "Supervisor"])
    .order("full_name", { ascending: true });

  if (error) {
    console.error("login_directory_read_failed", { code: error.code, message: error.message });
    return jsonResponse({ error: "No se pudo cargar la nómina de acceso." }, 503);
  }

  const users = (data || []).map((profile) => ({
    name: String(profile.full_name || ""),
    username: String(profile.username || ""),
    role: String(profile.role || ""),
  })).filter((profile) => profile.name && profile.username);

  return jsonResponse({ users });
});
