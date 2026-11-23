# Rendimiento del catálogo

- Prioriza la respuesta inmediata al abrir Equipos, Inventario o un plano. Muestra primero la vista y los datos disponibles. Carga los recursos adicionales en segundo plano o al solicitarlos.
- Mantén el índice inicial liviano. Guarda el despiece, las referencias y los marcadores en el archivo de datos de cada equipo. Actualiza su revisión en el índice si cambian. Carga solo la imagen del plano activo.
- En Inventario, muestra primero los registros guardados y prepara las referencias únicamente de los equipos vinculados o seleccionados. Reutiliza los índices mientras sus datos sigan vigentes.
- Antes de dar por terminado un cambio, comprueba los recursos que descarga la vista inicial, la apertura de un plano y la búsqueda de repuestos en Inventario.

## Imágenes del catálogo

- Conserva las dimensiones, los píxeles, la transparencia y los perfiles de color de las imágenes originales.
- En las tarjetas de equipos usa miniaturas derivadas de 240 y 384 píxeles según la densidad de pantalla. Carga la foto original al pulsar **Ampliar imagen**. Si la única fuente ya es una miniatura, usa esa imagen.
- Para optimizar un original, usa compresión sin pérdida y conserva el archivo existente cuando el resultado pese igual o más.
- Para imágenes generadas o copiadas al catálogo, usa `python scripts/optimizar-imagenes.py catalogo` desde la raíz. En JPEG, pasa también `--turbojpeg ruta-a-la-biblioteca`.
