# Rendimiento del catálogo

- En pruebas con navegador, establecer `window.__SMARTFIT_AUTOMATED_TEST__ = true` mediante `page.addInitScript` antes de navegar y bloquear el envío a Sentry. Algunos navegadores de prueba no exponen `navigator.webdriver`. Los fallos de las pruebas se registran en su resultado, sin generar avisos de producción. El uso normal de archivos locales se monitoriza en `development`; web publicada y ejecutable, en `production`.

- Prioriza la respuesta inmediata al abrir Equipos, Inventario o un plano. Muestra primero la vista y los datos disponibles. Carga los recursos adicionales en segundo plano o al solicitarlos.
- Mantén el índice inicial liviano. Guarda el despiece, las referencias y los marcadores en el archivo de datos de cada equipo. Actualiza su revisión en el índice si cambian. Carga solo la imagen del plano activo.
- En Inventario, muestra primero los registros guardados y prepara las referencias únicamente de los equipos vinculados o seleccionados. Reutiliza los índices mientras sus datos sigan vigentes.
- Antes de dar por terminado un cambio, comprueba los recursos que descarga la vista inicial, la apertura de un plano y la búsqueda de repuestos en Inventario.
- Al modificar referencias o agregar modelos, regenera `catalogo-assets/busqueda` con `node scripts/generar-indice-busqueda-inventario.cjs` y actualiza su revisión de caché en `inventario-busqueda.js`. El selector busca piezas solo en las marcas marcadas, con índices ligeros; no descarga planos ni fotos para buscar.
- Los índices de búsqueda se distribuyen como scripts de datos cargados bajo demanda, compatibles con `file://`, HTTP y el ejecutable. No reemplazarlos por `fetch` de archivos JSON sin verificar la apertura directa de `catalogo.html`.
- El inventario abre por marcas. Crear repuesto parte desde esa vista general; el buscador general cruza marcas y el filtro de marca limita la consulta. Los modelos y códigos de ítem se muestran en el detalle de vínculos.
- La identidad de metadatos usa marca + Reference No. y, si falta, marca + SAP Parts No., conservando ceros iniciales. Cada marca es independiente, incluidas Hammer Strength y Life Fitness. Nombre y foto se reutilizan solo entre equipos de la misma marca con el mismo código. Compartir nombre/foto nunca fusiona stocks ni crea vínculos de inventario automáticamente.

## Pedidos y perfiles

- Los filtros usan únicamente `catalogo_pedidos_contexto`, que verifica la identidad y las asignaciones en el servidor. No enviar roles ni listas de sedes del navegador como autorización.
- Supervisor: sedes con asignación de Supervisor y técnicos activos asignados a esas sedes. Administrador: todas las sedes y técnicos activos. Bodega: perfil propio con consulta global de Pedidos y lectura de sedes/equipos; se conserva la concesión específica de `repuestos.accesos_pedidos` para cuentas antiguas.
- Bodega no hereda edición, exportación ni acceso a datos de mantenimiento u otros módulos. No asignarle sedes ni incluirlo en roles de asignación. No crear concesiones antiguas automáticamente.
- Mantener Pedidos vacío hasta conectar su fuente. Al implementar lectura, detalle y exportación de pedidos, exigir el mismo alcance en cada operación del servidor; el contexto de filtros no sustituye esa autorización.
- Limpiar filtros y caché al cerrar/cambiar sesión. Sin validación del servidor, bloquear los filtros y no reutilizar opciones de otra sesión. Cargar el módulo bajo demanda y compartir la lectura del contexto por un minuto.

## Imágenes del catálogo

- Conserva las dimensiones, los píxeles, la transparencia y los perfiles de color de las imágenes originales.
- En las tarjetas de equipos usa miniaturas derivadas de 240 y 384 píxeles según la densidad de pantalla. Carga la foto original al pulsar **Ampliar imagen**. Si la única fuente ya es una miniatura, usa esa imagen.
- Para optimizar un original, usa compresión sin pérdida y conserva el archivo existente cuando el resultado pese igual o más.
- Para planos PNG indexados, `scripts/optimizar-planos-catalogo.py` crea derivados WebP sin pérdida únicamente si son menores y verifica dimensiones, píxeles y perfiles antes de enlazarlos. Conserva los originales.
- Para imágenes generadas o copiadas al catálogo, usa `python scripts/optimizar-imagenes.py catalogo` desde la raíz. En JPEG, pasa también `--turbojpeg ruta-a-la-biblioteca`.
