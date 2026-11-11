'use strict';

// Local, self-contained worker. There are no source photos, URLs or imports.
// Encoding outside the Flutter main thread keeps typing and scrolling usable.
self.onmessage = async ({data}) => {
  try {
    const {width, height, rgba, lowBandwidth, quality, targetBytes,
      maxOutputBytes} = data;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width <= 0 || height <= 0 || !(rgba instanceof Uint8Array) ||
        rgba.length !== width * height * 4) {
      throw new Error('Invalid pixels');
    }
    const source = new OffscreenCanvas(width, height);
    const context = source.getContext('2d');
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    let alpha = false;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] !== 255) { alpha = true; break; }
    }
    let blob;
    let extension;
    if (alpha && !lowBandwidth) {
      blob = await source.convertToBlob({type: 'image/png'});
      extension = 'png';
    } else {
      const opaque = new OffscreenCanvas(width, height);
      const destination = opaque.getContext('2d');
      destination.fillStyle = '#ffffff';
      destination.fillRect(0, 0, width, height);
      destination.drawImage(source, 0, 0);
      let current = quality;
      blob = await opaque.convertToBlob({type: 'image/jpeg', quality: current / 100});
      while (lowBandwidth && blob.size > targetBytes && current > 30) {
        current -= 10;
        blob = await opaque.convertToBlob({type: 'image/jpeg', quality: current / 100});
      }
      if (blob.type !== 'image/jpeg') throw new Error('JPEG unavailable');
      extension = 'jpg';
    }
    if (blob.size > maxOutputBytes) throw new Error('Encoded image too large');
    const bytes = await blob.arrayBuffer();
    self.postMessage({bytes, extension}, [bytes]);
  } catch (_) {
    self.postMessage({error: 'encodingFailed'});
  }
};
