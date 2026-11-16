(() => {
  const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
  const IDAT = 0x49444154;

  function buildImageChunk(data) {
    const chunk = new Uint8Array(data.length + 12);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    view.setUint32(4, IDAT);
    chunk.set(data, 8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    view.setUint32(chunk.length - 4, crc ^ 0xffffffff);
    return chunk;
  }

  async function optimizePng(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return file;
    const view = new DataView(bytes.buffer);
    const chunks = [];
    const compressed = [];
    for (let offset = 8; offset < bytes.length;) {
      const kind = view.getUint32(offset + 4);
      const end = offset + 12 + view.getUint32(offset);
      if (end > bytes.length) return file;
      if (kind === IDAT) compressed.push(bytes.subarray(offset + 8, end - 4));
      if (kind !== IDAT || compressed.length === 1) chunks.push({ kind, bytes: bytes.subarray(offset, end) });
      offset = end;
    }
    if (!compressed.length) return file;
    const deflated = new Blob(compressed).stream()
      .pipeThrough(new DecompressionStream("deflate"))
      .pipeThrough(new CompressionStream("deflate"));
    const idat = buildImageChunk(new Uint8Array(await new Response(deflated).arrayBuffer()));
    const result = new Blob([bytes.subarray(0, 8), ...chunks.map(chunk => chunk.kind === IDAT ? idat : chunk.bytes)],
      { type: "image/png" });
    return result.size < file.size ? result : file;
  }

  window.CatalogPhotos = {
    async optimize(file) {
      const url = URL.createObjectURL(file);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
      } finally {
        URL.revokeObjectURL(url);
      }
      if (file.type !== "image/png" || typeof CompressionStream === "undefined" ||
          typeof DecompressionStream === "undefined") return file;
      try {
        return await optimizePng(file);
      } catch {
        return file;
      }
    },
  };
})();
