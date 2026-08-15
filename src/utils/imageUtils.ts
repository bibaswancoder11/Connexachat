// Utility for client-side image compression, resizing, and validation

export interface CompressImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  mimeType?: string;
}

/**
 * Compresses and resizes an image File or Data URL to fit safely within
 * Firestore's 1MB document size limit while preserving crisp visual quality.
 */
export const compressImage = (
  source: File | string,
  options: CompressImageOptions = {}
): Promise<string> => {
  const {
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 0.82,
    mimeType = 'image/jpeg'
  } = options;

  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      try {
        let { width, height } = img;

        // Calculate aspect ratio fit
        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get 2D context from canvas'));
          return;
        }

        // Draw image onto canvas
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to optimized Data URL
        const compressedDataUrl = canvas.toDataURL(mimeType, quality);
        resolve(compressedDataUrl);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = (err) => {
      reject(new Error('Failed to load image for compression'));
    };

    if (source instanceof File) {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(source);
    } else {
      img.src = source;
    }
  });
};

/**
 * Downloads a data URL image as a file with a specified filename
 */
export const downloadImageDataUrl = (dataUrl: string, filename = 'shared-image.jpg') => {
  try {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    console.error('Error downloading image:', e);
    // Fallback: open in new window
    window.open(dataUrl, '_blank');
  }
};
