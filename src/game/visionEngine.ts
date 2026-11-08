import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { TreasureItem } from './rules';

export interface VisionPrediction {
  class: string;
  score: number;
  bbox: [number, number, number, number];
}

export interface GeminiVisionVerification {
  hasObject: boolean;
  isTargetMatch: boolean;
  isNearTarget?: boolean;
  detectedObjectPersian: string;
  confidence: number;
  feedbackPersian: string;
}

export type VisionModelStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

class VisionEngine {
  private model: cocoSsd.ObjectDetection | null = null;
  private status: VisionModelStatus = 'idle';
  private loadPromise: Promise<cocoSsd.ObjectDetection | null> | null = null;
  private isDetecting: boolean = false;
  private isVerifyingGemini: boolean = false;
  private backendName: string = 'cpu';
  private captureCanvas: HTMLCanvasElement | null = null;

  public getStatus(): VisionModelStatus {
    return this.status;
  }

  public getBackendName(): string {
    return this.backendName;
  }

  /**
   * Loads the COCO-SSD model for live frame tracking.
   */
  public async ensureModelLoaded(timeoutMs = 10000): Promise<cocoSsd.ObjectDetection | null> {
    if (this.model && this.status === 'ready') {
      return this.model;
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.status = 'loading';
    const loadTask = (async () => {
      try {
        await tf.ready();
        try {
          const currentBackend = tf.getBackend();
          if (!currentBackend) {
            await tf.setBackend('webgl');
          }
        } catch {
          await tf.setBackend('cpu');
        }
        this.backendName = tf.getBackend() || 'cpu';

        const loadBestModel = async () => {
          try {
            return await cocoSsd.load({ base: 'mobilenet_v2' });
          } catch {
            return await cocoSsd.load({ base: 'lite_mobilenet_v2' });
          }
        };

        const loadedModel = await Promise.race([
          loadBestModel(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
        ]);

        if (loadedModel) {
          this.model = loadedModel;
          this.status = 'ready';
          return loadedModel;
        } else {
          this.status = 'unavailable';
          return null;
        }
      } catch (err) {
        console.warn('COCO-SSD model could not be loaded in this environment:', err);
        this.status = 'unavailable';
        this.model = null;
        return null;
      } finally {
        this.loadPromise = null;
      }
    })();

    this.loadPromise = loadTask;
    return loadTask;
  }

  /**
   * Runs a strict COCO-SSD detection pass (minimum score 0.38 so low-confidence false guesses are filtered out).
   */
  public async detectFrame(
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
  ): Promise<VisionPrediction[]> {
    if (this.isDetecting) {
      return [];
    }

    const srcWidth =
      source instanceof HTMLVideoElement ? source.videoWidth : source.width || 0;
    const srcHeight =
      source instanceof HTMLVideoElement ? source.videoHeight : source.height || 0;

    if (
      (source instanceof HTMLVideoElement && source.readyState < 2) ||
      srcWidth === 0 ||
      srcHeight === 0
    ) {
      return [];
    }

    if (!this.model || this.status !== 'ready') {
      return [];
    }

    this.isDetecting = true;
    try {
      const results = await this.model.detect(source, 6, 0.38);
      return results.map((r) => ({
        class: r.class,
        score: r.score,
        bbox: r.bbox as [number, number, number, number],
      }));
    } catch {
      return [];
    } finally {
      this.isDetecting = false;
    }
  }

  /**
   * Captures a JPEG frame from the video/image source and verifies it with the server-side
   * Gemini Vision referee (/api/detect-object) so different objects (like spoon vs toothbrush)
   * are distinguished with human-level accuracy and never falsely accepted.
   */
  public async verifyWithGeminiVision(
    source: HTMLVideoElement | HTMLImageElement,
    targetItem: TreasureItem
  ): Promise<GeminiVisionVerification | null> {
    if (this.isVerifyingGemini) {
      return null;
    }

    const srcWidth =
      source instanceof HTMLVideoElement
        ? source.videoWidth
        : source.naturalWidth || source.width;
    const srcHeight =
      source instanceof HTMLVideoElement
        ? source.videoHeight
        : source.naturalHeight || source.height;

    if (
      (source instanceof HTMLVideoElement && source.readyState < 2) ||
      srcWidth === 0 ||
      srcHeight === 0
    ) {
      return null;
    }

    this.isVerifyingGemini = true;
    try {
      if (!this.captureCanvas && typeof document !== 'undefined') {
        this.captureCanvas = document.createElement('canvas');
      }
      const canvas = this.captureCanvas;
      if (!canvas) return null;

      const targetW = 480;
      const targetH = Math.max(270, Math.round((srcHeight / srcWidth) * targetW));
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      ctx.drawImage(source, 0, 0, targetW, targetH);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.78);

      const response = await fetch('/api/detect-object', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: dataUrl,
          mimeType: 'image/jpeg',
          targetPersianName: targetItem.persianName,
          targetEnglishAliases: targetItem.cocoClasses,
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as GeminiVisionVerification;
      return data;
    } catch {
      return null;
    } finally {
      this.isVerifyingGemini = false;
    }
  }
}

export const visionEngine = new VisionEngine();
