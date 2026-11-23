# Catálogo SmartFit Beta para Windows

La beta usa Electron y se distribuye mediante un instalador NSIS para Windows x64.

Ejecuta `npm ci` y después `npm run build` en esta carpeta. El instalador queda en `dist/Catalogo-SmartFit-Beta-0.1.1-Setup.exe`.

El paquete incluye el catálogo local, sus planos, marcadores y miniaturas. El acceso a Supabase y las fotografías externas requiere conexión.

La aplicación guarda la sesión y las fotos locales en su propio perfil de Windows. El inventario se guarda en Supabase y se consulta desde la web y la aplicación. Los registros de inventario de la primera beta se publican automáticamente al iniciar sesión como administrador. Las modificaciones de versiones antiguas del mismo registro se detectan antes de sobrescribirlo.

Esta beta carece de certificado de firma de código. La autenticación con una cuenta real debe verificarse al probarla.
