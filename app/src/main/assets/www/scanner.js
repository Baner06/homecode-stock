/**
 * scanner.js – Barcode scanning wrapper using ZXing-js
 * Supports: EAN-13, UPC-A, UPC-E, Code 128, Code 39, ITF
 * Continuous scanning without closing camera
 */

const Scanner = (() => {
  // We load ZXing from CDN via a dynamic import approach
  // falling back to a simpler interval-based decode
  let _codeReader = null;
  let _activeVideoId = null;
  let _onScan = null;
  let _active = false;

  /**
   * Ensure ZXing is loaded (loaded via script tag in index, see below).
   * We access it via window.ZXing (UMD build).
   */
  function ensureZXing() {
    return new Promise((resolve, reject) => {
      if (window.ZXing) return resolve(window.ZXing);
      // If not yet loaded, poll briefly
      let tries = 0;
      const interval = setInterval(() => {
        tries++;
        if (window.ZXing) {
          clearInterval(interval);
          resolve(window.ZXing);
        } else if (tries > 50) {
          clearInterval(interval);
          reject(new Error('ZXing no disponible'));
        }
      }, 100);
    });
  }

  /**
   * Start continuous scanning on a given <video> element.
   * @param {string} videoElementId  - ID of the video element
   * @param {function} onScanCallback - Called with (barcode: string) on each scan
   */
  async function start(videoElementId, onScanCallback) {
    if (_active) await stop();

    _onScan = onScanCallback;
    _activeVideoId = videoElementId;
    _active = true;

    try {
      const ZXing = await ensureZXing();
      const hints = new Map();
      const formats = [
        ZXing.BarcodeFormat.EAN_13,
        ZXing.BarcodeFormat.EAN_8,
        ZXing.BarcodeFormat.UPC_A,
        ZXing.BarcodeFormat.UPC_E,
        ZXing.BarcodeFormat.CODE_128,
        ZXing.BarcodeFormat.CODE_39,
        ZXing.BarcodeFormat.ITF,
      ];
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);

      _codeReader = new ZXing.BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 150,
        delayBetweenScanSuccess:  800, // ms between accepted scans
      });

      const onResult = (result, err) => {
        if (!_active) return;
        if (result) {
          const barcode = result.getText().trim();
          if (barcode && _onScan) _onScan(barcode);
        }
      };

      // Forzar la cámara TRASERA (environment); más fiable para escanear.
      const constraints = {
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      };

      if (typeof _codeReader.decodeFromConstraints === 'function') {
        try {
          await _codeReader.decodeFromConstraints(constraints, videoElementId, onResult);
        } catch (e) {
          // Si falla (p.ej. permisos/constraints), intenta con el dispositivo por defecto.
          await _codeReader.decodeFromVideoDevice(null, videoElementId, onResult);
        }
      } else {
        await _codeReader.decodeFromVideoDevice(null, videoElementId, onResult);
      }
    } catch (err) {
      console.error('Scanner error:', err);
    }
  }

  /**
   * Stop scanning and release camera.
   */
  function stop() {
    _active = false;
    if (_codeReader) {
      try {
        _codeReader.reset();
      } catch (e) { /* ignore */ }
      _codeReader = null;
    }
    // Also stop any lingering video tracks
    const videoEl = _activeVideoId ? document.getElementById(_activeVideoId) : null;
    if (videoEl && videoEl.srcObject) {
      videoEl.srcObject.getTracks().forEach(t => t.stop());
      videoEl.srcObject = null;
    }
    _activeVideoId = null;
    _onScan = null;
    return Promise.resolve();
  }

  return { start, stop };
})();
