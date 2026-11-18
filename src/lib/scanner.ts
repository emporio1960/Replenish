/**
 * Camera barcode scanning. Uses the browser's built-in BarcodeDetector where
 * it exists (Chrome on Android) and falls back to the ZXing library, loaded
 * on demand, everywhere else (including Safari on iPhone).
 */

interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type NativeDetectorCtor = new (options: { formats: string[] }) => NativeDetector;

export const isBarcode = (code: string) => /^\d{6,14}$/.test(code);

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Starts the camera and reports each product barcode seen. Resolves to a stop function. */
export async function startScanner(video: HTMLVideoElement, onCode: (code: string) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
  });
  let stopped = false;
  let stopReader = () => {};
  const stop = () => {
    stopped = true;
    stopReader();
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  const report = (text: string) => {
    const code = text.trim();
    if (!stopped && isBarcode(code)) onCode(code);
  };

  try {
    const Native = (window as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
    if (Native) {
      video.srcObject = stream;
      await video.play();
      const detector = new Native({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      const loop = async () => {
        if (stopped) return;
        try {
          const found = await detector.detect(video);
          if (found[0]) report(found[0].rawValue);
        } catch {
          /* a frame that cannot be read is not an error */
        }
        window.setTimeout(loop, 200);
      };
      void loop();
    } else {
      const { BrowserMultiFormatOneDReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatOneDReader();
      const controls = await reader.decodeFromStream(stream, video, (result) => {
        if (result) report(result.getText());
      });
      stopReader = () => controls.stop();
      if (stopped) controls.stop();
    }
  } catch (e) {
    stop();
    throw e;
  }
  return stop;
}

/**
 * Looks a barcode up in Open Food Facts, a free public product database.
 * Only called when the user has switched this on in Settings.
 */
export async function lookupBarcode(code: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands`,
      { signal: controller.signal },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { product?: { product_name?: string; brands?: string } };
    const name = body.product?.product_name?.trim();
    if (!name) return null;
    const brand = body.product?.brands?.split(',')[0]?.trim();
    return (brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name).slice(0, 80);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
