# Criterios de rendimiento

Aplicar estos criterios en cada cambio que afecte la aplicación web o su futura versión móvil.

## Carga y consultas

- Mantener una sola hidratación inicial por sesión y agrupar las consultas independientes con `Promise.all`.
- En refrescos de Realtime, agrupar tablas modificadas y usar hidratación parcial; no descargar el conjunto completo por cada evento.
- Consultar solo columnas necesarias. No debilitar RLS para reducir latencia.
- No pedir datos de módulos que el usuario no puede abrir. Antes de introducir carga diferida, asegurar que la vista se hidrate al abrirse y que Realtime la actualice.
- Evitar consultas dentro de bucles. Preferir consultas por lotes, mapas en memoria y una transacción IndexedDB por conjunto de trabajo.

## Interfaz e imágenes

- Renderizar desde la caché local mientras llegan los datos remotos y actualizar solo la vista afectada.
- Evitar repintar vistas ocultas y evitar reconstruir el DOM cuando los datos visibles no cambiaron.
- Usar `loading="lazy"` y `decoding="async"` para imágenes fuera de la primera pantalla; conservar interacción ampliable y carrusel.
- Al comprimir fotos, quitar metadatos y reducir bytes sin cambiar las dimensiones ni la calidad visual solicitada.
- No bloquear la interfaz durante subidas, PDF, búsquedas o restauración de fotos; mostrar progreso solo donde ayude al usuario.

## Red y sincronización

- Mantener las operaciones de guardado durables en IndexedDB y confirmar la limpieza local solo después de confirmar Supabase.
- Agrupar cambios rápidos de Realtime con debounce y cancelar trabajos obsoletos cuando el usuario cambia de vista.
- Reutilizar clientes, promesas y resultados en memoria; evitar cargar librerías externas hasta que se necesiten.
- Mantener explícitos los estados de conexión y reintento, sin bucles de consultas frecuentes.

## Revisión de cada cambio

Antes de integrar una funcionalidad, revisar:

1. Cuántas solicitudes de red añade al inicio y al abrir su vista.
2. Si el trabajo en IndexedDB o la conversión de imágenes ocurre en lotes y fuera del hilo de interacción cuando sea posible.
3. Si funciona con datos cacheados, conexión lenta, desconexión temporal y reintento.
4. Si conserva permisos, relaciones y filtros por perfil.
5. Si evita desbordamiento en móvil y no duplica listeners, timers o canales Realtime.

No se debe sacrificar integridad, seguridad ni conservación de datos por una mejora de velocidad.
