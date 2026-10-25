# SmartFit Mantenimiento

Aplicación web estática conectada a Supabase para autenticación y almacenamiento de la operación.

## Publicación

El flujo de GitHub Actions prepara una versión acotada del sitio y la publica en GitHub Pages. Solo incorpora las páginas de la aplicación, sus scripts de cliente y los recursos de `IMG/` y `EQU/`. No copia directorios de personal, exportaciones CSV, herramientas de migración ni archivos de prueba.

Para activar la publicación, configura GitHub Pages del repositorio con **GitHub Actions** como origen. El flujo se ejecuta al hacer push a `main`.

## Datos y privacidad

- Mantén el repositorio privado.
- Las nóminas y asignaciones de `docs/` se conservan localmente y están excluidas de Git.
- La aplicación usa una clave publishable de Supabase en el navegador; las autorizaciones de datos deben permanecer en políticas RLS y funciones Edge.
- La URL de GitHub Pages es pública en los planes habituales, aunque el repositorio sea privado. No publiques datos personales en los archivos estáticos. Para Pages desde repositorio privado se necesita un plan compatible; GitHub Free requiere repositorio público.

## Desarrollo local

Abre `index.html` en un servidor web local. El acceso requiere usuarios habilitados en Supabase.
