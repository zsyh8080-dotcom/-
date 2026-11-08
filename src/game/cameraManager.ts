export type CameraFacing = 'environment' | 'user';

export interface CameraStartResult {
  stream: MediaStream | null;
  facingMode: CameraFacing;
  errorType: 'none' | 'permission_denied' | 'no_device' | 'insecure_context' | 'unknown';
  persianErrorMessage: string | null;
}

class CameraManager {
  private activeStream: MediaStream | null = null;
  private currentFacing: CameraFacing = 'environment';

  public getActiveStream(): MediaStream | null {
    return this.activeStream;
  }

  public getCurrentFacing(): CameraFacing {
    return this.currentFacing;
  }

  /**
   * Starts the camera only upon explicit user action.
   * Tries the preferred facingMode first, then falls back to any available video device
   * so laptop webcams and phones both work reliably.
   * Images are processed strictly on-device and never transmitted or stored.
   */
  public async startCamera(preferredFacing?: CameraFacing): Promise<CameraStartResult> {
    const facing = preferredFacing ?? this.currentFacing;
    this.currentFacing = facing;
    this.stopCamera();

    if (typeof window === 'undefined' || !window.isSecureContext) {
      return {
        stream: null,
        facingMode: facing,
        errorType: 'insecure_context',
        persianErrorMessage:
          'برای پخش زنده دوربین، اتصال امن (HTTPS) لازمه؛ می‌تونی با دکمه زیر عکس وسیله رو بگیری!',
      };
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      return {
        stream: null,
        facingMode: facing,
        errorType: 'no_device',
        persianErrorMessage:
          'پخش زنده در این مرورگر فعال نیست؛ از دکمه زیر مستقیم با دوربین گوشی عکس بگیر!',
      };
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });
      } catch {
        // Fallback to generic video constraint for desktop/laptop webcams
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      }

      this.activeStream = stream;
      return {
        stream,
        facingMode: facing,
        errorType: 'none',
        persianErrorMessage: null,
      };
    } catch (err: unknown) {
      const errorName = err instanceof Error ? err.name : '';
      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        return {
          stream: null,
          facingMode: facing,
          errorType: 'permission_denied',
          persianErrorMessage:
            'اجازه دسترسی به دوربین داده نشد. از بالای مرورگر اجازه دوربین رو بده یا با دکمه زیر از وسیله عکس بگیر!',
        };
      }
      if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        return {
          stream: null,
          facingMode: facing,
          errorType: 'no_device',
          persianErrorMessage:
            'وب‌کم زنده پیدا نشد؛ با دکمه زیر مستقیم با دوربین گوشی عکس بگیر یا تصویر وسیله رو انتخاب کن!',
        };
      }
      return {
        stream: null,
        facingMode: facing,
        errorType: 'unknown',
        persianErrorMessage:
          'پخش زنده دوربین آماده نشد؛ با دکمه زیر از وسیله عکس بگیر یا دکمه اسکن رو بزن!',
      };
    }
  }

  /**
   * Toggles between rear ('environment') and front ('user') camera.
   */
  public async toggleCameraFacing(): Promise<CameraStartResult> {
    const nextFacing: CameraFacing =
      this.currentFacing === 'environment' ? 'user' : 'environment';
    return this.startCamera(nextFacing);
  }

  /**
   * Attaches the active stream to a video element and ensures playback starts.
   */
  public attachToVideoElement(videoElement: HTMLVideoElement | null): void {
    if (!videoElement || !this.activeStream) return;
    if (videoElement.srcObject !== this.activeStream) {
      videoElement.srcObject = this.activeStream;
    }
    videoElement.play().catch(() => {
      // Ignore autoplay interruption
    });
  }

  /**
   * Immediately stops all active camera tracks and releases hardware resources.
   */
  public stopCamera(videoElement?: HTMLVideoElement | null): void {
    if (this.activeStream) {
      this.activeStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      });
      this.activeStream = null;
    }
    if (videoElement) {
      videoElement.srcObject = null;
    }
  }

  public isCameraActive(): boolean {
    return this.activeStream !== null && this.activeStream.active;
  }
}

export const cameraManager = new CameraManager();
