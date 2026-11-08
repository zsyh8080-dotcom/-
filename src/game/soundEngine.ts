/**
 * Web Audio API procedural sound engine + Web Speech API voice helper for "شکارچی گنج‌های دلفی"
 * Respects browser autoplay policies: never plays sound before first user interaction,
 * and allows muting/unmuting all sounds and voice hints at any time.
 */

class SoundEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private hasInteracted: boolean = false;

  public markUserInteraction(): void {
    this.hasInteracted = true;
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted) {
      this.stopSpeaking();
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  private getContext(): AudioContext | null {
    if (this.isMuted || !this.hasInteracted || typeof window === 'undefined') {
      return null;
    }
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(
    freq: number,
    startTimeOffset: number,
    duration: number,
    type: OscillatorType = 'sine',
    peakGain = 0.14
  ): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startTimeOffset);

      gain.gain.setValueAtTime(0.001, ctx.currentTime + startTimeOffset);
      gain.gain.exponentialRampToValueAtTime(peakGain, ctx.currentTime + startTimeOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + startTimeOffset + duration
      );

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + startTimeOffset);
      osc.stop(ctx.currentTime + startTimeOffset + duration + 0.02);
    } catch {
      // Ignore audio errors on restricted devices
    }
  }

  /** شروع مرحله: سه نت شاد و کوتاه */
  public playStageStart(): void {
    this.playTone(523.25, 0, 0.12, 'triangle', 0.14); // C5
    this.playTone(659.25, 0.11, 0.12, 'triangle', 0.14); // E5
    this.playTone(783.99, 0.22, 0.22, 'triangle', 0.16); // G5
  }

  /** مرحله اول اعتبارسنجی: پینگ کوتاه رادار هنگام نزدیک شدن به شیء هدف */
  public playStage1Lock(): void {
    this.playTone(698.46, 0, 0.1, 'sine', 0.12); // F5
    this.playTone(880, 0.09, 0.14, 'sine', 0.14); // A5
  }

  /** هشدار ملایم شیء اشتباه (کادر قرمز) */
  public playWrongObjectAlert(): void {
    this.playTone(330, 0, 0.12, 'triangle', 0.11);
    this.playTone(261.63, 0.12, 0.18, 'triangle', 0.11);
  }

  /** پیدا شدن گنج (تأیید مرحله دوم با اطمینان بالا): دینگ کریستالی */
  public playTreasureFound(): void {
    this.playTone(987.77, 0, 0.18, 'sine', 0.18); // B5
    this.playTone(1318.51, 0.08, 0.38, 'sine', 0.2); // E6
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(45);
      } catch {
        // Ignore vibration errors
      }
    }
  }

  /** افزایش امتیاز: صدای جمع‌شدن مروارید */
  public playPearlsAdded(): void {
    this.playTone(783.99, 0.12, 0.09, 'sine', 0.12);
    this.playTone(1046.5, 0.2, 0.09, 'sine', 0.13);
    this.playTone(1174.66, 0.28, 0.14, 'sine', 0.14);
  }

  /** تمام‌شدن زمان: پاپ آرام حباب */
  public playTimeOut(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(340, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(160, ctx.currentTime + 0.18);

      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.22);
    } catch {
      // Ignore
    }
  }

  /** گرفتن نشان: ملودی کوتاه پیروزی */
  public playBadgeEarned(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    notes.forEach((freq, idx) => {
      this.playTone(freq, idx * 0.11, 0.26, 'triangle', 0.16);
    });
  }

  /** کمک‌خواستن: صدای کنجکاوانه دلفی */
  public playHintCurious(): void {
    this.playTone(620, 0, 0.11, 'sine', 0.13);
    this.playTone(880, 0.1, 0.16, 'sine', 0.14);
  }

  /** زنگ راهنمای صوتی ۳۰ ثانیه‌ای */
  public playCoachingChime(): void {
    this.playTone(587.33, 0, 0.14, 'sine', 0.15); // D5
    this.playTone(783.99, 0.12, 0.16, 'sine', 0.15); // G5
    this.playTone(987.77, 0.25, 0.24, 'sine', 0.16); // B5
  }

  /** پخش صوتی متن راهنما (با Web Speech API + ملودی پشتیبان) */
  public speakPersianHint(text: string): boolean {
    if (this.isMuted || typeof window === 'undefined') return false;
    this.playCoachingChime();

    try {
      if ('speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function') {
        window.speechSynthesis.cancel();
        const utterance = new window.SpeechSynthesisUtterance(text);
        utterance.lang = 'fa-IR';
        utterance.rate = 0.95;
        utterance.pitch = 1.08;

        const voices = window.speechSynthesis.getVoices();
        const persianVoice = voices.find(
          (v) => v.lang.toLowerCase().includes('fa') || v.lang.toLowerCase().includes('per')
        );
        if (persianVoice) {
          utterance.voice = persianVoice;
        }
        window.speechSynthesis.speak(utterance);
        return true;
      }
    } catch {
      // Fallback to musical chime if SpeechSynthesis is blocked
    }
    return false;
  }

  public stopSpeaking(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
  }

  /** اشتباه آموزشی هوش مصنوعی: صدای ملایم تعجب دلفی */
  public playMistakeOops(): void {
    this.playTone(440, 0, 0.14, 'triangle', 0.12);
    this.playTone(370, 0.14, 0.22, 'triangle', 0.12);
  }
}

export const soundEngine = new SoundEngine();
