# Catálogo SmartFit Beta para Windows

La beta usa Electron y se distribuye mediante un instalador NSIS para Windows x64.

Ejecuta `npm ci` y después `npm run build` en esta carpeta. El instalador queda en `dist/Catalogo-SmartFit-Beta-0.1.2-Setup.exe`.

El paquete incluye el catálogo local, sus planos, marcadores y miniaturas. El acceso a Supabase y las fotografías externas requiere conexión.

La aplicación guarda la sesión y las fotos locales en su propio perfil de Windows. El inventario se guarda en Supabase y se consulta desde la web y la aplicación. Los registros de inventario de la primera beta se publican automáticamente al iniciar sesión como administrador o supervisor. Las modificaciones de versiones antiguas del mismo registro se detectan antes de sobrescribirlo.

Esta beta carece de certificado de firma de código. La autenticación con una cuenta real debe verificarse al probarla.

Administradores y supervisores pueden editar las referencias y los marcadores del catálogo. Usa clic derecho en un marcador o una referencia para abrir el menú. El botón **Editar referencias** abre la edición en lote de la vista. Para mover varios marcadores, selecciónalos con Mayús + clic, abre el menú y elige **Mover marcadores**. Arrastra y presiona **Guardar posiciones**; Cancelar restaura las posiciones anteriores. En pantallas táctiles, mantén pulsado un marcador para abrir el menú.

Las ediciones se guardan en Supabase por equipo, sin cambiar los códigos de otras marcas. Los conflictos con cambios de otro dispositivo se notifican antes de sobrescribirlos. La aplicación consulta los cambios de la vista activa al recuperar el foco y cada 15 segundos. Estos permisos se aplican al catálogo; no modifican los perfiles de mantenimiento.
