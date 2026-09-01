import { IProfileFingerprint } from '~/common/profile-network';
import {rendererCapabilities} from './sandbox-bridge';

const isWebPage =
  window.location.protocol === 'http:' || window.location.protocol === 'https:';

let fingerprint: IProfileFingerprint | null = null;
if (isWebPage) {
  try {
    const value = rendererCapabilities.fingerprint.get();
    if (value?.enabled) fingerprint = value as IProfileFingerprint;
  } catch (error) {
    console.warn('[profile-fingerprint] 配置读取失败:', error);
  }
}

const defineValue = (target: object, property: string, value: unknown) => {
  try {
    Object.defineProperty(target, property, {
      configurable: true,
      enumerable: true,
      get: () => value,
    });
  } catch {}
};

const nextRandom = (state: number): number => {
  let value = state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
};

const perturbPixels = (
  imageData: ImageData,
  salt: number,
  width: number,
  height: number,
) => {
  const pixels = Math.floor(imageData.data.length / 4);
  if (pixels < 16) return imageData;
  let state = (salt ^ width ^ (height << 16)) >>> 0;
  for (let index = 0; index < 8; index += 1) {
    state = nextRandom(state || index + 1);
    const pixel = state % pixels;
    const channel = (state >>> 9) % 3;
    const offset = pixel * 4 + channel;
    const current = imageData.data[offset];
    imageData.data[offset] =
      current === 0 ? 1 : current === 255 ? 254 : current + (state & 1 ? 1 : -1);
  }
  return imageData;
};

const installCanvasFingerprint = (salt: number) => {
  if (typeof HTMLCanvasElement === 'undefined') return;
  const canvasPrototype = HTMLCanvasElement.prototype;
  const contextPrototype =
    typeof CanvasRenderingContext2D === 'undefined'
      ? null
      : CanvasRenderingContext2D.prototype;
  const nativeToDataURL = canvasPrototype.toDataURL;
  const nativeToBlob = canvasPrototype.toBlob;
  const nativeGetImageData = contextPrototype?.getImageData;

  const noisyCopy = (canvas: HTMLCanvasElement): HTMLCanvasElement | null => {
    if (!canvas.width || !canvas.height || canvas.width * canvas.height > 16777216) {
      return null;
    }
    try {
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d', {
        willReadFrequently: true,
      }) as CanvasRenderingContext2D | null;
      if (!context || !nativeGetImageData) return null;
      context.drawImage(canvas, 0, 0);
      const data = nativeGetImageData.call(
        context,
        0,
        0,
        copy.width,
        copy.height,
      );
      perturbPixels(data, salt, copy.width, copy.height);
      context.putImageData(data, 0, 0);
      return copy;
    } catch {
      return null;
    }
  };

  canvasPrototype.toDataURL = function (...args: any[]) {
    const copy = noisyCopy(this);
    return nativeToDataURL.apply(copy || this, args as any);
  };

  canvasPrototype.toBlob = function (...args: any[]) {
    const copy = noisyCopy(this);
    return nativeToBlob.apply(copy || this, args as any);
  };

  if (contextPrototype && nativeGetImageData) {
    contextPrototype.getImageData = function (...args: any[]) {
      const data = nativeGetImageData.apply(this, args as any);
      return perturbPixels(data, salt, data.width, data.height);
    };
  }
};

const installWebglFingerprint = (vendor: string, renderer: string) => {
  const patch = (contextClass: any) => {
    if (!contextClass?.prototype?.getParameter) return;
    const nativeGetParameter = contextClass.prototype.getParameter;
    contextClass.prototype.getParameter = function (parameter: number) {
      if (parameter === 37445) return vendor;
      if (parameter === 37446) return renderer;
      return nativeGetParameter.call(this, parameter);
    };
  };
  patch((globalThis as any).WebGLRenderingContext);
  patch((globalThis as any).WebGL2RenderingContext);
};

if (fingerprint) {
  const navigatorPrototype = Object.getPrototypeOf(navigator);
  defineValue(
    navigatorPrototype,
    'hardwareConcurrency',
    fingerprint.hardwareConcurrency,
  );
  defineValue(navigatorPrototype, 'deviceMemory', fingerprint.deviceMemory);
  installCanvasFingerprint(fingerprint.canvasSalt);
  installWebglFingerprint(
    fingerprint.webglVendor,
    fingerprint.webglRenderer,
  );

  if ((process as any).contextIsolated) {
    // The isolated preload world has separate JS prototypes. Install the same
    // deterministic overrides in the page world without exposing IPC or the
    // fingerprint bridge itself.
    const installInPage = (value: IProfileFingerprint) => {
      const define = (target: object, property: string, next: unknown) => {
        try {
          Object.defineProperty(target, property, {
            configurable: true,
            enumerable: true,
            get: () => next,
          });
        } catch {}
      };
      const random = (input: number) => {
        let state = input >>> 0;
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return state >>> 0;
      };
      const perturb = (
        imageData: ImageData,
        salt: number,
        width: number,
        height: number,
      ) => {
        const pixels = Math.floor(imageData.data.length / 4);
        if (pixels < 16) return imageData;
        let state = (salt ^ width ^ (height << 16)) >>> 0;
        for (let index = 0; index < 8; index += 1) {
          state = random(state || index + 1);
          const offset = (state % pixels) * 4 + ((state >>> 9) % 3);
          const current = imageData.data[offset];
          imageData.data[offset] =
            current === 0
              ? 1
              : current === 255
                ? 254
                : current + (state & 1 ? 1 : -1);
        }
        return imageData;
      };
      const canvasPrototype = globalThis.HTMLCanvasElement?.prototype;
      const contextPrototype = globalThis.CanvasRenderingContext2D?.prototype;
      if (canvasPrototype) {
        const nativeToDataURL = canvasPrototype.toDataURL;
        const nativeToBlob = canvasPrototype.toBlob;
        const nativeGetImageData = contextPrototype?.getImageData;
        const noisyCopy = (canvas: HTMLCanvasElement) => {
          if (
            !canvas.width ||
            !canvas.height ||
            canvas.width * canvas.height > 16777216 ||
            !nativeGetImageData
          ) return null;
          try {
            const copy = document.createElement('canvas');
            copy.width = canvas.width;
            copy.height = canvas.height;
            const context = copy.getContext('2d', {
              willReadFrequently: true,
            }) as CanvasRenderingContext2D | null;
            if (!context) return null;
            context.drawImage(canvas, 0, 0);
            const data = nativeGetImageData.call(
              context,
              0,
              0,
              copy.width,
              copy.height,
            );
            perturb(data, value.canvasSalt, copy.width, copy.height);
            context.putImageData(data, 0, 0);
            return copy;
          } catch {
            return null;
          }
        };
        canvasPrototype.toDataURL = function (...args: any[]) {
          return nativeToDataURL.apply(noisyCopy(this) || this, args as any);
        };
        canvasPrototype.toBlob = function (...args: any[]) {
          return nativeToBlob.apply(noisyCopy(this) || this, args as any);
        };
        if (contextPrototype && nativeGetImageData) {
          contextPrototype.getImageData = function (...args: any[]) {
            const data = nativeGetImageData.apply(this, args as any);
            return perturb(data, value.canvasSalt, data.width, data.height);
          };
        }
      }
      const patchWebGL = (contextClass: any) => {
        if (!contextClass?.prototype?.getParameter) return;
        const nativeGetParameter = contextClass.prototype.getParameter;
        contextClass.prototype.getParameter = function (parameter: number) {
          if (parameter === 37445) return value.webglVendor;
          if (parameter === 37446) return value.webglRenderer;
          return nativeGetParameter.call(this, parameter);
        };
      };
      const navigatorPrototype = Object.getPrototypeOf(navigator);
      define(navigatorPrototype, 'hardwareConcurrency', value.hardwareConcurrency);
      define(navigatorPrototype, 'deviceMemory', value.deviceMemory);
      patchWebGL((globalThis as any).WebGLRenderingContext);
      patchWebGL((globalThis as any).WebGL2RenderingContext);
    };
    void rendererCapabilities.fingerprint.executeInMainWorld(
      `(${installInPage.toString()})(${JSON.stringify(fingerprint)})`,
    );
  }
}
