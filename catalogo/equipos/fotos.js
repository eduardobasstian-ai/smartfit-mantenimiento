window.CatalogPhotos = {
  async optimize(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.drawImage(image, 0, 0);

      const webp = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.95));
      return webp?.type === "image/webp" && webp.size < file.size ? webp : file;
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};
