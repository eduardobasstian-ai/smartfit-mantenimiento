# Conectar el acceso por RUT/usuario

El navegador envía usuario y contraseña a `login-by-username`. La función busca el perfil en la base y valida la contraseña con Supabase Auth. La clave `service_role` se usa solo en el servidor administrado por Supabase; nunca se agrega al HTML.

## Pasos en Supabase

1. Ejecuta `migrations/202610240002_allow_lider_role.sql` si todavía no lo hiciste.
2. Ejecuta `migrations/202610240003_username_login_support.sql`.
3. Ejecuta `migrations/202610240004_local_catalog_migration.sql` antes de importar sedes, marcas y equipos.
4. Ejecuta `migrations/202610240005_activity_migration.sql` para habilitar la importación de tickets, eventos y kilometrajes.
5. Ejecuta `migrations/202610240006_scoped_activity_writes.sql` para permitir al supervisor editar y eliminar registros, y mantener los vínculos entre eventos y tickets dentro de sus sedes asignadas.
6. Ejecuta `migrations/202610240007_admin_user_access.sql` para habilitar la gestión de correo y contraseñas temporales desde el panel administrador.
7. Conserva la cuenta de administrador inicial que ya utilizas. Si necesitas enlazar una cuenta existente creada desde **Authentication → Users**, copia su UUID y crea su perfil desde SQL Editor, por ejemplo:

```sql
insert into public.profiles (id, full_name, username, legacy_id, role, active)
values ('UUID-DE-AUTH', 'Nombre de la persona', 'RUT-O-USUARIO', 'ID-LOCAL-EXISTENTE', 'Administrador', true);
```

Usa `Administrador`, `Supervisor`, `Técnico` o `Líder` como rol. `legacy_id` debe coincidir con el id que ya usa el proyecto para relacionar los registros locales. Para un perfil nuevo sin datos locales, puede quedar `null`.

9. Despliega las funciones de acceso y administración en este proyecto Supabase. Desde una terminal con Supabase CLI y sesión iniciada:

```sh
supabase link --project-ref acmcksmiqrfrxopceies
supabase functions deploy login-by-username
supabase functions deploy admin-manage-user --no-verify-jwt
```

La función de administración valida el token con `auth.getUser()` y exige un administrador activo; `--no-verify-jwt` permite que la solicitud llegue a esa validación en el código. La función lee `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` del entorno seguro de Edge Functions. No copies ninguna clave secreta al repositorio.

10. Inicia sesión en el panel administrador desde el mismo navegador y origen donde están los datos locales. Abre **Configuración → Abrir migración de datos**. Primero ejecuta **Migrar catálogos y equipos** y después **Migrar tickets, eventos y KM**. La herramienta no borra el almacenamiento local y puede ejecutarse de nuevo sin duplicar las filas importadas.
11. Desde **Administrador → Usuarios y accesos**, crea las cuentas nuevas con un correo válido, usuario/RUT, rol, sedes asignadas y clave temporal de al menos 8 caracteres. Para restablecer una clave, edita la cuenta y escribe una nueva clave temporal. El panel la muestra una sola vez al guardar; entrégala al usuario por un canal seguro. En el próximo acceso se le pedirá definir su propia contraseña.

## Límite de esta etapa

Los paneles de administrador, supervisor y líder leen los catálogos y la actividad desde Supabase al abrirse. Los formularios de tickets, mantenimientos y kilometrajes guardan en Supabase y mantienen una copia local. El panel administrador también crea y actualiza cuentas de Auth mediante `admin-manage-user`; nunca expone la clave `service_role`. Las claves temporales se fuerzan a cambiar en el primer ingreso. Si falla la conexión, la pantalla avisa y deja operaciones de actividad pendientes en una cola local. Las imágenes se conservan en el campo JSON de fotos; su traslado a Supabase Storage queda pendiente. Conserva los datos locales hasta completar la verificación manual de cada perfil.
