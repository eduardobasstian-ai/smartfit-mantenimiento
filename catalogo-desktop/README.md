# Catálogo SmartFit Beta para Windows

La beta usa Electron y se distribuye mediante un instalador NSIS para Windows x64.

Ejecuta `npm ci` y después `npm run build` en esta carpeta. El instalador queda en `dist/Catalogo-SmartFit-Beta-0.1.11-Setup.exe`.

El paquete incluye el catálogo local, sus planos, marcadores y miniaturas. El acceso a Supabase y las fotografías externas requiere conexión.

La aplicación guarda la sesión y las fotos locales en su propio perfil de Windows. El inventario se guarda en Supabase y se consulta desde la web y la aplicación. Los registros de inventario de la primera beta se publican automáticamente al iniciar sesión como administrador o supervisor. Las modificaciones de versiones antiguas del mismo registro se detectan antes de sobrescribirlo.

Esta beta carece de certificado de firma de código. La autenticación con una cuenta real debe verificarse al probarla.

Administradores y supervisores pueden editar las referencias y los marcadores del catálogo. Usa clic derecho en un marcador o una referencia para abrir el menú. El botón **Editar referencias** abre la edición en lote de la vista. Para mover varios marcadores, selecciónalos con Mayús + clic, abre el menú y elige **Mover marcadores**. Arrastra y presiona **Guardar posiciones**; Cancelar restaura las posiciones anteriores. En pantallas táctiles, mantén pulsado un marcador para abrir el menú.

Las ediciones se guardan en Supabase por equipo, sin cambiar los códigos de otras marcas. Los conflictos con cambios de otro dispositivo se notifican antes de sobrescribirlos. La aplicación consulta los cambios de la vista activa al recuperar el foco y cada 5 segundos. Estos permisos se aplican al catálogo; no modifican los perfiles de mantenimiento.

La beta 0.1.3 actualiza los nombres y referencias de todas las marcas del inventario al recibir los registros compartidos, al volver a la ventana y mientras está visible. Recupera en segundo plano los nombres, marcadores y fotos locales de versiones anteriores, sin reemplazar datos compartidos existentes ni restaurar fotos eliminadas. Las imágenes locales se transfieren con sus bytes originales. Actualizar el instalador conserva el perfil del usuario.

La beta 0.1.4 comparte el nombre técnico por marca y referencia (SAP si no hay referencia). Conserva el ítem y la vista de cada equipo. Los nombres antiguos de manuales se reconocen por referencia cuando no son contradictorios. Una asignación explícita o su eliminación prevalece sobre esos nombres antiguos. Si no existe referencia ni SAP, el nombre permanece asociado a su ítem original.

La beta 0.1.5 mantiene el aviso de recuperación dentro del contenido principal, sin agregar columnas ni desplazar el menú durante la sincronización.

La beta 0.1.6 muestra los avisos de sincronización como mensajes flotantes en una esquina, con botón para cerrar. El éxito se oculta después de cinco segundos. El aviso no participa en la distribución del menú ni del contenido.

Carga el código de planos, edición e inventario al abrir cada vista. Las tarjetas de marcas usan imágenes derivadas de 144 píxeles, conservando los originales. Las lecturas sin cambios mantienen sus índices y evitan reconstruir el plano; los nombres compartidos se consultan una vez por marca en cada actualización del inventario. La telemetría del catálogo añade tiempos de apertura de vistas y peticiones al cliente Sentry existente, sin registrar códigos, nombres de usuarios ni contenido de las piezas.

La beta 0.1.7 muestra el nombre técnico asignado junto al ítem en cada coincidencia de búsqueda: «Vista general · 1 - Pantalla». Mantiene la descripción original debajo.

La beta 0.1.8 agrega el boton Copiar SAP dentro de la fila SAP, alineado a la derecha, con aviso al pasar el cursor y confirmacion al copiar.

La beta 0.1.9 permite copiar Item No., Reference No., SAP y Description desde la ficha. El inventario usa filas compactas con miniaturas ampliables de las fotos vinculadas. Las miniaturas se cargan cuando son visibles y se reutilizan dentro de la sesion; la ampliacion conserva la foto original.

La beta 0.1.11 organiza el inventario por marcas, con búsqueda general y creación de repuestos desde la pantalla principal. Permite seleccionar marcas y buscar equipos por nombre técnico, referencia o SAP mediante índices ligeros compatibles con la apertura directa de archivos locales. Nombre y foto se reutilizan por marca y código; no se comparten automáticamente entre marcas ni se fusionan existencias. Los planos derivados WebP conservan dimensiones y píxeles. La caché de fotografías se aísla por sesión y revisión.

El bloqueo de edición, las reservas y la recuperación duradera de borradores del prototipo `catalogo/preview` no forman parte de esta distribución.
