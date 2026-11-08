import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  addCameraDiscoveryTime,
  buildSessionQueue,
  buildThirtySecondCoachingTip,
  calculateStageScore,
  COCO_PERSIAN_LABELS,
  DELPHI_STORY_BUBBLES,
  DetectionFrameSample,
  evaluateDetectionStability,
  GameState,
  getInitialWaveTime,
  getProgressiveHint,
  selectBestPredictionForTarget,
  shouldTriggerEducationalMistake,
  shouldTriggerThirtySecondCoach,
  STAGE_2_HIGH_CONFIDENCE_THRESHOLD,
  ThirtySecondCoachingTip,
  toPersianDigits,
  TreasureItem,
  VisualFrameIndicatorState,
} from '../game/rules';
import { soundEngine } from '../game/soundEngine';
import { visionEngine } from '../game/visionEngine';
import { cameraManager } from '../game/cameraManager';
import goldenClamImg from '../assets/images/golden_clam_badge_1793958110974.jpg';
import delphiCameraImg from '../assets/images/delphi_magic_camera_1793958109081.jpg';

interface DelphiTreasureHunterGameProps {
  autoStart?: boolean;
}

export const DelphiTreasureHunterGame: React.FC<DelphiTreasureHunterGameProps> = ({
  autoStart = false,
}) => {
  // Core Game State Machine
  const [gameState, setGameState] = useState<GameState>('intro');
  const [introBubbleIdx, setIntroBubbleIdx] = useState<number>(0);

  // Session Queue & Current Household Item
  const [sessionQueue, setSessionQueue] = useState<TreasureItem[]>(() => buildSessionQueue());
  const [stageIndex, setStageIndex] = useState<number>(0);
  const currentTarget = sessionQueue[stageIndex] ?? sessionQueue[0];

  // Timer & Countdown
  const [countdownNum, setCountdownNum] = useState<number>(3);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(50);
  const [maxStageSeconds, setMaxStageSeconds] = useState<number>(50);
  const stageElapsedSecondsRef = useRef<number>(0);
  const [, setUnsuccessfulSeconds] = useState<number>(0);

  // 30-Second Automatic Text & Audio Coaching Helper
  const [thirtySecCoaching, setThirtySecCoaching] = useState<ThirtySecondCoachingTip | null>(null);
  const thirtySecCoachShownRef = useRef<boolean>(false);

  // Scoring & Current Session Rewards
  const [pearls, setPearls] = useState<number>(0);
  const [pearlSparkle, setPearlSparkle] = useState<boolean>(false);
  const [treasuresFoundCount, setTreasuresFoundCount] = useState<number>(0);
  const [successfulGuessesCount, setSuccessfulGuessesCount] = useState<number>(0);
  const [lastStageGain, setLastStageGain] = useState<number>(0);

  // Smart Hints
  const [hintsUsedInStage, setHintsUsedInStage] = useState<number>(0);
  const [activeHintModal, setActiveHintModal] = useState<{
    step: 1 | 2 | 3;
    headline: string;
    detail: string;
  } | null>(null);

  // Two-Stage Validation & Dynamic Visual Frame Indicator State
  const [validationStage, setValidationStage] = useState<0 | 1 | 2>(0);
  const [visualFrameState, setVisualFrameState] = useState<VisualFrameIndicatorState>('analyzing');
  const [detectionText, setDetectionText] = useState<string>('در حال اسکن تصویر...');
  const [liveSeenLabel, setLiveSeenLabel] = useState<string | null>(null);
  const [liveSeenConfidence, setLiveSeenConfidence] = useState<number | null>(null);
  const [isScanningNow, setIsScanningNow] = useState<boolean>(false);
  const recentSamplesRef = useRef<DetectionFrameSample[]>([]);
  const lastGeminiCheckTimeRef = useRef<number>(0);

  // Educational AI Mistake Event
  const [mistakeTriggeredInSession, setMistakeTriggeredInSession] = useState<boolean>(false);
  const [mistakeStep, setMistakeStep] = useState<'oops' | 'lesson'>('oops');

  // Camera & Native Photo Capture State
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const capturedImgRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [cameraLiveActive, setCameraLiveActive] = useState<boolean>(false);
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string | null>(null);

  // Audio Settings
  const [isMuted] = useState<boolean>(false);

  // Refs to prevent timer/detection loop teardown on React re-renders
  const gameStateRef = useRef<GameState>(gameState);
  gameStateRef.current = gameState;
  const activeHintModalRef = useRef(activeHintModal);
  activeHintModalRef.current = activeHintModal;
  const currentTargetRef = useRef<TreasureItem>(currentTarget);
  currentTargetRef.current = currentTarget;
  const stageIndexRef = useRef<number>(stageIndex);
  stageIndexRef.current = stageIndex;
  const hintsUsedRef = useRef<number>(hintsUsedInStage);
  hintsUsedRef.current = hintsUsedInStage;
  const mistakeTriggeredRef = useRef<boolean>(mistakeTriggeredInSession);
  mistakeTriggeredRef.current = mistakeTriggeredInSession;
  const successTimeoutRef = useRef<number | null>(null);

  // Preload COCO-SSD immediately on mount
  useEffect(() => {
    visionEngine.ensureModelLoaded().catch(() => {});
  }, []);

  // Sync body dataset state
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (gameState === 'intro') {
      document.body.dataset.state = 'title';
    } else if (gameState === 'paused') {
      document.body.dataset.state = 'paused';
    } else if (gameState === 'result') {
      document.body.dataset.state = 'gameover';
    } else {
      document.body.dataset.state = 'playing';
    }
  }, [gameState]);

  // Clean up camera, timers, and speech on unmount
  useEffect(() => {
    return () => {
      cameraManager.stopCamera(videoRef.current);
      soundEngine.stopSpeaking();
      if (successTimeoutRef.current) {
        window.clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const triggerPearlSparkle = useCallback(() => {
    setPearlSparkle(true);
    window.setTimeout(() => setPearlSparkle(false), 700);
  }, []);

  // Advance to the next household item or end result screen
  const advanceToNextStage = useCallback(
    (wasFound: boolean) => {
      if (successTimeoutRef.current) {
        window.clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = null;
      }
      soundEngine.stopSpeaking();

      const idx = stageIndexRef.current;
      const nextIdx = idx + 1;

      if (nextIdx >= sessionQueue.length) {
        cameraManager.stopCamera(videoRef.current);
        soundEngine.playBadgeEarned();
        setGameState('result');
        return;
      }

      const nextTarget = sessionQueue[nextIdx];
      setStageIndex(nextIdx);
      recentSamplesRef.current = [];
      setValidationStage(0);
      setVisualFrameState('analyzing');
      setLiveSeenLabel(null);
      setLiveSeenConfidence(null);
      setCapturedPhotoUrl(null);
      capturedImgRef.current = null;
      setHintsUsedInStage(0);
      setActiveHintModal(null);
      setThirtySecCoaching(null);
      thirtySecCoachShownRef.current = false;
      stageElapsedSecondsRef.current = 0;
      setUnsuccessfulSeconds(0);

      setRemainingSeconds((prev) => {
        const updated = wasFound
          ? addCameraDiscoveryTime(prev)
          : getInitialWaveTime(nextTarget.wave, false);
        setMaxStageSeconds(Math.max(updated, 50));
        return updated;
      });

      setDetectionText(`«${nextTarget.persianName}» رو جلوی دوربین بگیر`);
      soundEngine.playStageStart();
      setGameState('playing');
    },
    [sessionQueue]
  );

  // Trigger celebration when target household item passes BOTH Stage 1 & Stage 2 validation
  const handleTargetVerified = useCallback(
    (matchedItem: TreasureItem, finalConfidence: number) => {
      if (gameStateRef.current !== 'playing') return;

      if (shouldTriggerEducationalMistake(stageIndexRef.current, mistakeTriggeredRef.current)) {
        setMistakeTriggeredInSession(true);
        mistakeTriggeredRef.current = true;
        setMistakeStep('oops');
        soundEngine.playMistakeOops();
        setGameState('aiMistake');
        return;
      }

      const breakdown = calculateStageScore({
        elapsedSeconds: stageElapsedSecondsRef.current,
        hintsUsedInStage: hintsUsedRef.current,
      });

      soundEngine.stopSpeaking();
      soundEngine.playTreasureFound();
      soundEngine.playPearlsAdded();

      setValidationStage(2);
      setVisualFrameState('matched');
      setLiveSeenConfidence(finalConfidence);

      setPearls((prev) => prev + breakdown.totalStagePearls);
      setLastStageGain(breakdown.totalStagePearls);
      setTreasuresFoundCount((prev) => prev + 1);
      setSuccessfulGuessesCount((prev) => prev + 1);
      triggerPearlSparkle();

      const confPercent = toPersianDigits(Math.round(finalConfidence * 100));
      setDetectionText(`تأیید شد (${confPercent}٪): ${matchedItem.persianName}`);
      setGameState('success');

      successTimeoutRef.current = window.setTimeout(() => {
        advanceToNextStage(true);
      }, 1250);
    },
    [advanceToNextStage, triggerPearlSparkle]
  );

  // Two-Stage Validation Referee (Stage 1: Candidate Check -> Stage 2: High-Confidence Threshold Check >= 0.78)
  const performTwoStageVerification = useCallback(
    async (
      source: HTMLVideoElement | HTMLImageElement,
      target: TreasureItem,
      isManualTrigger: boolean
    ) => {
      if (gameStateRef.current !== 'playing') return;
      setIsScanningNow(true);

      const stage2HighThreshold =
        target.highConfidenceThreshold ?? STAGE_2_HIGH_CONFIDENCE_THRESHOLD;

      try {
        const geminiVerdict = await visionEngine.verifyWithGeminiVision(source, target);
        if (gameStateRef.current !== 'playing') return;
        if (currentTargetRef.current.id !== target.id) return;

        if (geminiVerdict) {
          if (geminiVerdict.hasObject && geminiVerdict.detectedObjectPersian) {
            setLiveSeenLabel(geminiVerdict.detectedObjectPersian);
            setLiveSeenConfidence(geminiVerdict.confidence);
          } else {
            setLiveSeenLabel(null);
            setLiveSeenConfidence(null);
          }

          // Stage 1 + Stage 2 Passed
          if (geminiVerdict.isTargetMatch && geminiVerdict.confidence >= stage2HighThreshold) {
            handleTargetVerified(target, geminiVerdict.confidence);
            return;
          }

          // Stage 1 Passed, waiting for Stage 2 higher confidence
          if (
            (geminiVerdict.isTargetMatch || geminiVerdict.isNearTarget) &&
            geminiVerdict.confidence >= (target.minConfidence ?? 0.56)
          ) {
            setValidationStage(1);
            setVisualFrameState('near_target');
            const curPct = toPersianDigits(Math.round(geminiVerdict.confidence * 100));
            setDetectionText(`نزدیک به هدف (${curPct}٪) · کمی واضح‌تر و ثابت نگه دار`);
            soundEngine.playStage1Lock();
            return;
          }

          // Wrong object shown -> Red Dynamic Frame
          recentSamplesRef.current = [];
          setValidationStage(0);

          if (geminiVerdict.hasObject && geminiVerdict.detectedObjectPersian) {
            setVisualFrameState('wrong_object');
            setDetectionText(
              `این «${geminiVerdict.detectedObjectPersian}» هست · دنبال «${target.persianName}» می‌گردیم`
            );
            if (isManualTrigger) {
              soundEngine.playWrongObjectAlert();
            }
          } else {
            setVisualFrameState('analyzing');
            setDetectionText(`«${target.persianName}» رو وسط کادر بگیر`);
          }
          return;
        }

        // Offline Fallback: Strict Two-Stage COCO-SSD Check
        const cocoPreds = await visionEngine.detectFrame(source);
        const best = selectBestPredictionForTarget(cocoPreds, target);
        const validSet = new Set(target.cocoClasses.map((c) => c.toLowerCase()));
        const stage1Conf = target.minConfidence ?? 0.56;

        if (best) {
          const persianName = COCO_PERSIAN_LABELS[best.class.toLowerCase()] || best.class;
          setLiveSeenLabel(persianName);
          setLiveSeenConfidence(best.score);

          if (validSet.has(best.class.toLowerCase())) {
            if (best.score >= stage2HighThreshold) {
              handleTargetVerified(target, best.score);
            } else if (best.score >= stage1Conf) {
              setValidationStage(1);
              setVisualFrameState('near_target');
              const curPct = toPersianDigits(Math.round(best.score * 100));
              setDetectionText(`نزدیک به هدف (${curPct}٪) · ثابت نگه دار`);
              soundEngine.playStage1Lock();
            } else {
              setValidationStage(1);
              setVisualFrameState('near_target');
              setDetectionText('نزدیک به هدف · نور یا زاویه رو بهتر کن');
            }
          } else {
            setValidationStage(0);
            setVisualFrameState('wrong_object');
            setDetectionText(`این «${persianName}» هست · دنبال «${target.persianName}» می‌گردیم`);
            if (isManualTrigger) {
              soundEngine.playWrongObjectAlert();
            }
          }
        } else {
          setValidationStage(0);
          setVisualFrameState('analyzing');
          setLiveSeenLabel(null);
          setLiveSeenConfidence(null);
          setDetectionText(`«${target.persianName}» رو وسط کادر دوربین بگیر`);
        }
      } finally {
        setIsScanningNow(false);
      }
    },
    [handleTargetVerified]
  );

  // Countdown 3 -> 2 -> 1 -> playing
  useEffect(() => {
    if (gameState !== 'countdown') return;
    setCountdownNum(3);
    soundEngine.playStageStart();

    const interval = window.setInterval(() => {
      setCountdownNum((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          setGameState('playing');
          return 0;
        }
        return prev - 1;
      });
    }, 700);

    return () => window.clearInterval(interval);
  }, [gameState]);

  // Main 1-second gameplay countdown timer + 30-Second Auto Coaching Trigger
  useEffect(() => {
    const timerInterval = window.setInterval(() => {
      if (gameStateRef.current !== 'playing') return;
      if (activeHintModalRef.current !== null) return;

      stageElapsedSecondsRef.current += 1;

      setUnsuccessfulSeconds((prev) => {
        const nextVal = prev + 1;
        if (shouldTriggerThirtySecondCoach(nextVal, thirtySecCoachShownRef.current)) {
          thirtySecCoachShownRef.current = true;
          const coaching = buildThirtySecondCoachingTip(currentTargetRef.current);
          setThirtySecCoaching(coaching);
          soundEngine.speakPersianHint(coaching.voiceScript);
        }
        return nextVal;
      });

      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          soundEngine.playTimeOut();
          setDetectionText('زمان تموم شد · بریم وسیله بعدی!');
          window.setTimeout(() => {
            advanceToNextStage(false);
          }, 800);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timerInterval);
  }, [advanceToNextStage]);

  // Real-Time Two-Stage Camera Detection Loop
  useEffect(() => {
    if (gameState !== 'playing') return;

    let cancelled = false;
    const loopInterval = window.setInterval(async () => {
      if (
        cancelled ||
        gameStateRef.current !== 'playing' ||
        activeHintModalRef.current !== null ||
        !videoRef.current ||
        videoRef.current.readyState < 2 ||
        videoRef.current.videoWidth === 0
      ) {
        return;
      }

      const target = currentTargetRef.current;
      const now = Date.now();

      if (now - lastGeminiCheckTimeRef.current >= 2200) {
        lastGeminiCheckTimeRef.current = now;
        performTwoStageVerification(videoRef.current, target, false);
        return;
      }

      const predictions = await visionEngine.detectFrame(videoRef.current);
      if (cancelled || gameStateRef.current !== 'playing') return;

      const bestPred = selectBestPredictionForTarget(predictions, target);
      if (!bestPred) {
        return;
      }

      recentSamplesRef.current = [
        ...recentSamplesRef.current.slice(-3),
        {
          detectedClass: bestPred.class,
          confidence: bestPred.score,
          timestamp: now,
        },
      ];

      const evaluation = evaluateDetectionStability(recentSamplesRef.current, target);
      setValidationStage(evaluation.validationStage);
      setVisualFrameState(evaluation.visualState);

      if (evaluation.status === 'matched') {
        lastGeminiCheckTimeRef.current = now;
        await performTwoStageVerification(videoRef.current, target, false);
      } else if (evaluation.status === 'stage1_passed' || evaluation.status === 'uncertain') {
        const pct = toPersianDigits(Math.round(evaluation.peakConfidence * 100));
        setLiveSeenLabel(target.persianName);
        setLiveSeenConfidence(evaluation.peakConfidence);
        setDetectionText(`نزدیک به هدف (${pct}٪) · ثابت نگه دار`);
      } else if (evaluation.status === 'other_object' && evaluation.matchedPersianName) {
        setLiveSeenLabel(evaluation.matchedPersianName);
        setLiveSeenConfidence(evaluation.averageConfidence);
        setDetectionText(
          `این «${evaluation.matchedPersianName}» هست · دنبال «${target.persianName}» می‌گردیم`
        );
      }
    }, 420);

    return () => {
      cancelled = true;
      window.clearInterval(loopInterval);
    };
  }, [gameState, performTwoStageVerification]);

  // Attach active MediaStream to <video> element as soon as it mounts
  const handleVideoElementRef = useCallback((el: HTMLVideoElement | null) => {
    if (el) {
      videoRef.current = el;
      cameraManager.attachToVideoElement(el);
    }
  }, []);

  useEffect(() => {
    if (videoRef.current && cameraManager.getActiveStream()) {
      cameraManager.attachToVideoElement(videoRef.current);
      setCameraLiveActive(true);
    }
  }, [gameState]);

  // Start Camera Game Directly
  const handleStartCameraGame = useCallback(async () => {
    soundEngine.markUserInteraction();
    setGameState('permission');
    setCameraErrorMsg(null);
    setCapturedPhotoUrl(null);
    capturedImgRef.current = null;
    setThirtySecCoaching(null);
    thirtySecCoachShownRef.current = false;

    visionEngine.ensureModelLoaded().catch(() => {});

    const camResult = await cameraManager.startCamera();

    const activeTarget = sessionQueue[stageIndex] ?? sessionQueue[0];

    if (camResult.stream && camResult.errorType === 'none') {
      setCameraLiveActive(true);
      cameraManager.attachToVideoElement(videoRef.current);
      setDetectionText(`«${activeTarget.persianName}» رو وسط کادر دوربین بگیر`);
    } else {
      setCameraLiveActive(false);
      setCameraErrorMsg(camResult.persianErrorMessage);
      setDetectionText(`از «${activeTarget.persianName}» عکس بگیر تا بررسی بشه`);
    }

    const initSec = getInitialWaveTime(activeTarget.wave, stageIndex === 0);
    setRemainingSeconds(initSec);
    setMaxStageSeconds(initSec);
    stageElapsedSecondsRef.current = 0;
    setUnsuccessfulSeconds(0);
    setValidationStage(0);
    setVisualFrameState('analyzing');
    setGameState('countdown');
  }, [sessionQueue, stageIndex]);

  // Auto-start support for ?autostart=1
  const autoStartedRef = useRef<boolean>(false);
  useEffect(() => {
    if (autoStart && !autoStartedRef.current) {
      autoStartedRef.current = true;
      handleStartCameraGame();
    }
  }, [autoStart, handleStartCameraGame]);

  // Switch between Front and Rear Camera
  const handleSwitchCameraFacing = async () => {
    soundEngine.markUserInteraction();
    setCapturedPhotoUrl(null);
    capturedImgRef.current = null;
    const res = await cameraManager.toggleCameraFacing();
    if (res.stream) {
      setCameraLiveActive(true);
      if (videoRef.current) {
        cameraManager.attachToVideoElement(videoRef.current);
      }
    }
  };

  // Native Mobile Camera Photo Capture (<input type="file" accept="image/*" capture="environment">)
  const handlePhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    soundEngine.markUserInteraction();
    const file = e.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    setCapturedPhotoUrl(objectUrl);
    setVisualFrameState('analyzing');
    setDetectionText('در حال بررسی دقیق تصویر...');

    const img = new Image();
    img.onload = async () => {
      capturedImgRef.current = img;
      await performTwoStageVerification(img, currentTargetRef.current, true);
    };
    img.src = objectUrl;
    e.target.value = '';
  };

  // Manual Camera Shutter Scan ("📸 اسکن")
  const handleManualCameraScan = async () => {
    soundEngine.markUserInteraction();
    if (gameStateRef.current !== 'playing') return;

    const target = currentTargetRef.current;
    const activeSource = capturedImgRef.current || videoRef.current;

    if (
      !activeSource ||
      (activeSource instanceof HTMLVideoElement &&
        (activeSource.readyState < 2 || activeSource.videoWidth === 0))
    ) {
      fileInputRef.current?.click();
      return;
    }

    setVisualFrameState('analyzing');
    setDetectionText('در حال بررسی دقیق تصویر...');
    await performTwoStageVerification(activeSource, target, true);
  };

  // Smart Progressive Hint Handler (with audio narration support)
  const handleOpenSmartHint = () => {
    soundEngine.markUserInteraction();
    const nextStep = Math.min(3, hintsUsedInStage + 1) as 1 | 2 | 3;
    setHintsUsedInStage(nextStep);
    const hintObj = getProgressiveHint(currentTarget, nextStep);
    setActiveHintModal({
      step: hintObj.step,
      headline: hintObj.headline,
      detail: hintObj.detail,
    });
    soundEngine.speakPersianHint(`${hintObj.headline} ${hintObj.detail}`);
  };

  // Restart full game session cleanly
  const handleRestartGame = () => {
    soundEngine.markUserInteraction();
    soundEngine.stopSpeaking();
    cameraManager.stopCamera(videoRef.current);
    const freshQueue = buildSessionQueue();
    setSessionQueue(freshQueue);
    setStageIndex(0);
    setPearls(0);
    setTreasuresFoundCount(0);
    setSuccessfulGuessesCount(0);
    setHintsUsedInStage(0);
    setActiveHintModal(null);
    setThirtySecCoaching(null);
    thirtySecCoachShownRef.current = false;
    setMistakeTriggeredInSession(false);
    mistakeTriggeredRef.current = false;
    recentSamplesRef.current = [];
    setValidationStage(0);
    setVisualFrameState('analyzing');
    setLiveSeenLabel(null);
    setLiveSeenConfidence(null);
    setCapturedPhotoUrl(null);
    capturedImgRef.current = null;
    setGameState('intro');
  };

  // Suppress unused variable lint for internal state tracking
  void validationStage;
  void successfulGuessesCount;
  void cameraErrorMsg;
  void isMuted;
  void introBubbleIdx;
  void setIntroBubbleIdx;

  const timerRatio = Math.max(0, Math.min(1, remainingSeconds / maxStageSeconds));
  const isTimerLow = remainingSeconds <= 10;
  const livePercentFormatted =
    liveSeenConfidence !== null ? toPersianDigits(Math.round(liveSeenConfidence * 100)) : null;

  // Sleek Dynamic Visual Frame Styles (Cyan Analyzing / Emerald Near-Target / Green Matched / Red Wrong Object)
  const frameVisualConfig = {
    analyzing: {
      outerBorder: 'border-sky-400/40 shadow-[0_0_24px_rgba(56,189,248,0.14)]',
      cornerColor: 'border-sky-300/80',
      statusBg: 'bg-[#071830] border-sky-400/30 text-sky-100',
      dotColor: 'bg-sky-400 animate-pulse',
    },
    near_target: {
      outerBorder: 'border-emerald-400 shadow-[0_0_30px_rgba(52,211,153,0.45)]',
      cornerColor: 'border-emerald-300',
      statusBg: 'bg-emerald-950/80 border-emerald-400/60 text-emerald-100',
      dotColor: 'bg-emerald-400 animate-ping',
    },
    matched: {
      outerBorder: 'border-emerald-300 shadow-[0_0_38px_rgba(16,185,129,0.75)]',
      cornerColor: 'border-emerald-200',
      statusBg: 'bg-emerald-600 border-emerald-300 text-white',
      dotColor: 'bg-white',
    },
    wrong_object: {
      outerBorder: 'border-rose-500 shadow-[0_0_32px_rgba(244,63,94,0.55)]',
      cornerColor: 'border-rose-400',
      statusBg: 'bg-rose-950/80 border-rose-400/70 text-rose-100',
      dotColor: 'bg-rose-500 animate-pulse',
    },
  }[visualFrameState];

  return (
    <div className="min-h-screen w-full bg-[#040f21] text-white flex flex-col items-center justify-center p-4 select-none">
      <div className="w-full max-w-md flex flex-col items-center justify-center">
        {/* ============================================================
            STATE 1: ULTRA-CLEAN INTRO SCREEN (No item spoilers)
            ============================================================ */}
        {gameState === 'intro' && (
          <section
            aria-label="شروع شکار با دوربین جادویی دلفی"
            className="w-full flex flex-col items-center text-center bg-[#081c38] border border-sky-300/20 rounded-3xl p-7 shadow-2xl gap-5"
          >
            <div className="w-28 h-28 rounded-3xl overflow-hidden border-2 border-teal-300/80 shadow-xl">
              <img
                src={delphiCameraImg}
                alt="دلفی و دوربین جادویی"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-teal-300">دوربین هوشمند دلفی</span>
              <h1 className="text-2xl font-black text-white">شکارچی گنج‌های دلفی</h1>
            </div>

            <p className="text-sm font-medium text-sky-100/90 leading-relaxed px-2">
              {DELPHI_STORY_BUBBLES[0]}
            </p>

            <button
              type="button"
              data-start="true"
              onClick={handleStartCameraGame}
              className="min-h-[52px] w-full rounded-2xl bg-gradient-to-l from-teal-300 to-cyan-300 hover:from-teal-200 hover:to-cyan-200 text-[#05182e] font-black text-base shadow-xl cursor-pointer active:scale-95 transition-transform flex items-center justify-center gap-2"
            >
              <span aria-hidden="true">📸</span>
              <span>شروع بازی با دوربین</span>
            </button>
          </section>
        )}

        {/* ============================================================
            STATE 2: PERMISSION / INITIALIZING CAMERA
            ============================================================ */}
        {gameState === 'permission' && (
          <section
            aria-label="آماده‌سازی دوربین"
            className="w-full flex flex-col items-center justify-center bg-[#081c38] border border-sky-300/20 rounded-3xl p-8 text-center gap-4"
          >
            <div className="w-12 h-12 rounded-full border-4 border-teal-300 border-t-transparent animate-spin" />
            <h2 className="text-base font-black text-white">در حال روشن کردن دوربین...</h2>
          </section>
        )}

        {/* ============================================================
            STATE 3: COUNTDOWN (3, 2, 1 + Target Reveal)
            ============================================================ */}
        {gameState === 'countdown' && (
          <section
            aria-label="شمارش معکوس"
            className="w-full flex flex-col items-center justify-center bg-[#081c38] border border-sky-300/20 rounded-3xl p-8 text-center gap-4"
          >
            <span className="text-xs font-bold text-teal-300">وسیله بعدی رو پیدا کن:</span>
            <div className="w-24 h-24 rounded-3xl bg-[#0e2a50] border-2 border-teal-300/70 flex items-center justify-center text-5xl shadow-lg">
              {currentTarget.emoji}
            </div>
            <h2 className="text-xl font-black text-white">{currentTarget.persianName}</h2>
            <div className="text-4xl font-black text-amber-300 tabular-nums">
              {toPersianDigits(countdownNum)}
            </div>
          </section>
        )}

        {/* ============================================================
            STATE 4: SLEEK, BALANCED SMART CAMERA CARD
            ============================================================ */}
        {(gameState === 'playing' ||
          gameState === 'success' ||
          gameState === 'aiMistake' ||
          gameState === 'paused') && (
          <div className="w-full rounded-3xl bg-[#081c38] border border-sky-300/20 p-4 shadow-2xl flex flex-col gap-3.5">
            {/* 1. CLEAN TARGET & SCORE HEADER */}
            <header className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-[#051224] border border-amber-300/60 flex items-center justify-center text-2xl shrink-0 shadow-inner">
                  {currentTarget.emoji}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-bold text-teal-300">پیدا کن:</span>
                  <h2 className="text-base font-black text-white truncate">
                    {currentTarget.persianName}
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleOpenSmartHint}
                  aria-label="راهنمایی"
                  className="h-9 px-2.5 rounded-xl bg-[#0f2e57] hover:bg-[#153c70] border border-amber-300/35 text-amber-200 font-bold text-xs flex items-center gap-1 cursor-pointer"
                >
                  <span aria-hidden="true">💡</span>
                  <span>راهنما</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    soundEngine.markUserInteraction();
                    advanceToNextStage(false);
                  }}
                  aria-label="رد کردن این وسیله"
                  className="h-9 px-2.5 rounded-xl bg-[#0f2e57] hover:bg-[#153c70] border border-sky-300/25 text-sky-100 font-bold text-xs flex items-center gap-1 cursor-pointer"
                >
                  <span>بعدی</span>
                </button>

                <div
                  aria-label={`امتیاز: ${toPersianDigits(pearls)}`}
                  className={`h-9 px-2.5 rounded-xl border flex items-center gap-1 font-black text-xs tabular-nums transition-transform ${
                    pearlSparkle
                      ? 'bg-amber-400/30 border-amber-300 text-amber-200 scale-105'
                      : 'bg-[#051224] border-sky-300/20 text-amber-300'
                  }`}
                >
                  <span aria-hidden="true">🦪</span>
                  <span>{toPersianDigits(pearls)}</span>
                </div>
              </div>
            </header>

            {/* 2. THIN TIMER PROGRESS BAR */}
            <div className="flex items-center gap-2.5">
              <div className="flex-1 h-2 rounded-full bg-[#041020] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-transform duration-300 origin-right ${
                    isTimerLow ? 'bg-rose-400' : 'bg-teal-300'
                  }`}
                  style={{ transform: `scaleX(${timerRatio})` }}
                />
              </div>
              <span
                className={`text-xs font-extrabold tabular-nums shrink-0 ${
                  isTimerLow ? 'text-rose-300 animate-pulse' : 'text-sky-200/80'
                }`}
              >
                {toPersianDigits(remainingSeconds)} ثانیه
              </span>
            </div>

            {/* 3. PROPORTIONED 4:3 CAMERA VIEWFINDER */}
            <main className="w-full">
              <div
                data-testid="camera-visual-indicator"
                data-frame-state={visualFrameState}
                className={`relative w-full aspect-[4/3] rounded-2xl overflow-hidden border-[3px] bg-[#040e1d] transition-all duration-300 flex items-center justify-center ${frameVisualConfig.outerBorder}`}
              >
                {/* Hidden Native Camera Input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoFileChange}
                  className="hidden"
                  aria-label="عکس گرفتن با دوربین گوشی"
                />

                {/* Live Camera Video Element */}
                <video
                  ref={handleVideoElementRef}
                  playsInline
                  muted
                  autoPlay
                  aria-label="پیش‌نمایش زنده دوربین"
                  className={`absolute inset-0 w-full h-full object-cover ${
                    capturedPhotoUrl ? 'opacity-15' : 'opacity-100'
                  }`}
                />

                {/* Captured Photo Preview */}
                {capturedPhotoUrl && (
                  <img
                    src={capturedPhotoUrl}
                    alt="عکس گرفته شده"
                    className="absolute inset-0 w-full h-full object-contain bg-[#040e1d]/95 z-[2]"
                  />
                )}

                {/* Flip Camera Button (Only shown when live stream is active) */}
                {cameraLiveActive && (
                  <button
                    type="button"
                    onClick={handleSwitchCameraFacing}
                    aria-label="چرخش دوربین"
                    className="absolute top-3 left-3 z-10 h-9 w-9 rounded-xl bg-slate-950/75 hover:bg-slate-900 border border-sky-300/30 text-sky-100 flex items-center justify-center text-sm backdrop-blur-md cursor-pointer"
                  >
                    🔄
                  </button>
                )}

                {/* Centered Target Reticle (Never overlaps headers or buttons) */}
                <div
                  className="relative z-[3] w-48 h-48 sm:w-52 sm:h-52 pointer-events-none flex flex-col items-center justify-center p-4 text-center"
                  aria-hidden="true"
                >
                  <div
                    className={`absolute top-0 right-0 w-7 h-7 border-t-[3px] border-r-[3px] rounded-tr-2xl transition-colors duration-300 ${frameVisualConfig.cornerColor}`}
                  />
                  <div
                    className={`absolute top-0 left-0 w-7 h-7 border-t-[3px] border-l-[3px] rounded-tl-2xl transition-colors duration-300 ${frameVisualConfig.cornerColor}`}
                  />
                  <div
                    className={`absolute bottom-0 right-0 w-7 h-7 border-b-[3px] border-r-[3px] rounded-br-2xl transition-colors duration-300 ${frameVisualConfig.cornerColor}`}
                  />
                  <div
                    className={`absolute bottom-0 left-0 w-7 h-7 border-b-[3px] border-l-[3px] rounded-bl-2xl transition-colors duration-300 ${frameVisualConfig.cornerColor}`}
                  />

                  {!cameraLiveActive && !capturedPhotoUrl && (
                    <div className="flex flex-col items-center gap-2 opacity-80">
                      <span className="text-4xl">{currentTarget.emoji}</span>
                      <span className="text-xs font-bold text-sky-200/90">
                        کادر اسکن «{currentTarget.persianName}»
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </main>

            {/* 4. SINGLE CLEAN AI STATUS BAR */}
            <div
              role="status"
              aria-live="polite"
              className={`w-full rounded-xl px-3.5 py-2.5 border text-xs font-bold flex items-center justify-between gap-2 transition-colors ${frameVisualConfig.statusBg}`}
            >
              <div className="flex items-center gap-2 truncate">
                <span className={`w-2 h-2 rounded-full shrink-0 ${frameVisualConfig.dotColor}`} />
                <span className="truncate">{detectionText}</span>
              </div>

              {liveSeenLabel && livePercentFormatted && (
                <span className="text-[11px] font-black px-2 py-0.5 rounded-lg bg-black/30 whitespace-nowrap shrink-0 tabular-nums">
                  {liveSeenLabel} · {livePercentFormatted}٪
                </span>
              )}
            </div>

            {/* 30-Second Auto Coaching Banner (Only appears after 30s of trying) */}
            {thirtySecCoaching && (
              <div
                role="region"
                aria-label="راهنمای ۳۰ ثانیه‌ای"
                className="w-full rounded-xl bg-amber-500/15 border border-amber-300/60 px-3 py-2 flex items-center justify-between gap-2"
              >
                <p className="text-xs text-amber-100 font-bold leading-snug">
                  💡 {thirtySecCoaching.textTip}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.markUserInteraction();
                    soundEngine.speakPersianHint(thirtySecCoaching.voiceScript);
                  }}
                  aria-label="پخش صوتی راهنمایی"
                  className="h-8 px-2.5 rounded-lg bg-amber-300 text-[#05182e] font-black text-xs shrink-0 cursor-pointer"
                >
                  🔊
                </button>
              </div>
            )}

            {/* 5. UNIFIED BOTTOM ACTION BAR */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isScanningNow}
                onClick={handleManualCameraScan}
                className="flex-1 min-h-[48px] rounded-2xl bg-gradient-to-l from-teal-300 to-cyan-300 hover:from-teal-200 hover:to-cyan-200 disabled:opacity-60 text-[#05182e] font-black text-sm shadow-lg flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-transform"
              >
                <span aria-hidden="true">{isScanningNow ? '⏳' : '📸'}</span>
                <span>
                  {isScanningNow
                    ? 'در حال بررسی...'
                    : cameraLiveActive || capturedPhotoUrl
                      ? `اسکن ${currentTarget.persianName}`
                      : `گرفتن عکس از ${currentTarget.persianName}`}
                </span>
              </button>

              {(cameraLiveActive || capturedPhotoUrl) && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="انتخاب یا گرفتن عکس جدید"
                  className="min-h-[48px] px-3.5 rounded-2xl bg-[#0f2e57] hover:bg-[#153c70] border border-sky-300/30 text-sky-100 font-bold text-xs flex items-center justify-center gap-1.5 shrink-0 cursor-pointer active:scale-95 transition-transform"
                >
                  <span aria-hidden="true">📷</span>
                  <span>عکس</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* ============================================================
            CELEBRATION OVERLAY ('success')
            ============================================================ */}
        {gameState === 'success' && (
          <div
            role="dialog"
            aria-label="پیدا شدن وسیله"
            onClick={() => advanceToNextStage(true)}
            className="fixed inset-0 z-40 bg-[#04142b]/80 flex items-center justify-center p-4 cursor-pointer"
          >
            <div className="w-full max-w-xs rounded-3xl bg-[#0b2548] border-2 border-emerald-300 p-6 text-center shadow-2xl flex flex-col items-center gap-3">
              <div className="w-20 h-20 rounded-full border-4 border-emerald-300 flex items-center justify-center text-4xl bg-[#06162d]">
                {currentTarget.emoji}
              </div>
              <h3 className="text-lg font-black text-emerald-300">آفرین! درست بود!</h3>
              <div className="px-4 py-1.5 rounded-2xl bg-amber-400/20 border border-amber-300/60 text-amber-200 font-black text-sm tabular-nums">
                +{toPersianDigits(lastStageGain)} مروارید 🦪
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            EDUCATIONAL AI MISTAKE MODAL ('aiMistake')
            ============================================================ */}
        {gameState === 'aiMistake' && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-mistake-title"
            className="fixed inset-0 z-50 bg-[#030e21]/85 flex items-center justify-center p-4"
          >
            <div className="w-full max-w-sm rounded-3xl bg-[#0b264b] border-2 border-amber-300 p-5 shadow-2xl flex flex-col gap-3.5 text-right">
              {mistakeStep === 'oops' ? (
                <>
                  <div className="rounded-2xl bg-[#071933] border border-amber-300/40 p-3.5 flex items-center gap-3">
                    <span className="text-4xl">
                      {currentTarget.mistakeConfuser?.wrongEmoji || '📦'}
                    </span>
                    <div>
                      <h3 id="ai-mistake-title" className="text-base font-black text-white">
                        «اوه! در مرحله اول اشتباه حدس زدم!»
                      </h3>
                      <p className="text-xs text-sky-100 mt-1 leading-relaxed">
                        دلفی اول فکر کرد این یه «
                        {currentTarget.mistakeConfuser?.wrongPersianName || 'وسیله مشابه'}» هست!
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.markUserInteraction();
                      soundEngine.playHintCurious();
                      setMistakeStep('lesson');
                    }}
                    className="min-h-[46px] w-full rounded-2xl bg-amber-300 text-[#05182e] font-black text-sm cursor-pointer"
                  >
                    بررسی مرحله دوم 🔍
                  </button>
                </>
              ) : (
                <>
                  <div className="rounded-2xl bg-emerald-500/20 border border-emerald-300/50 p-3.5 flex items-center gap-3">
                    <span className="text-4xl">{currentTarget.emoji}</span>
                    <div>
                      <h3 id="ai-mistake-title" className="text-base font-black text-emerald-200">
                        تأیید شد: «{currentTarget.persianName}»!
                      </h3>
                      <p className="text-xs text-sky-100 mt-1 leading-relaxed">
                        {currentTarget.mistakeConfuser?.reason}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setGameState('playing');
                      gameStateRef.current = 'playing';
                      handleTargetVerified(currentTarget, 0.92);
                    }}
                    className="min-h-[46px] w-full rounded-2xl bg-teal-300 text-[#05182e] font-black text-sm cursor-pointer"
                  >
                    ادامه و دریافت جایزه 🦪
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ============================================================
            SMART HINT MODAL (Text + Audio Voice Playback)
            ============================================================ */}
        {activeHintModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="smart-hint-title"
            className="fixed inset-0 z-50 bg-[#030e21]/80 flex items-center justify-center p-4"
          >
            <div className="w-full max-w-xs rounded-3xl bg-[#0c284e] border-2 border-amber-300 p-5 shadow-2xl flex flex-col gap-3 text-right">
              <h3 id="smart-hint-title" className="text-base font-black text-amber-300">
                💡 {activeHintModal.headline}
              </h3>
              <p className="text-xs sm:text-sm text-sky-100 leading-relaxed">
                {activeHintModal.detail}
              </p>
              <button
                type="button"
                onClick={() => {
                  soundEngine.markUserInteraction();
                  soundEngine.speakPersianHint(
                    `${activeHintModal.headline} ${activeHintModal.detail}`
                  );
                }}
                className="min-h-[40px] w-full rounded-xl bg-[#123769] border border-amber-300/40 text-amber-200 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>🔊</span>
                <span>پخش صوتی راهنما</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.stopSpeaking();
                  setActiveHintModal(null);
                }}
                className="min-h-[42px] w-full rounded-xl bg-teal-300 text-[#05182e] font-black text-sm cursor-pointer"
              >
                متوجه شدم
              </button>
            </div>
          </div>
        )}

        {/* ============================================================
            STATE 5: END RESULT SCREEN ('result')
            ============================================================ */}
        {gameState === 'result' && (
          <section
            aria-label="صفحه پایان"
            className="my-auto flex flex-col items-center text-center bg-[#091e3a]/95 border border-amber-300/50 rounded-3xl p-6 shadow-2xl gap-4"
          >
            <div className="w-28 h-28 rounded-3xl overflow-hidden border-2 border-amber-300 shadow-lg">
              <img
                src={goldenClamImg}
                alt="نشان چشم تیزبین دلفی"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>

            <h2 className="text-xl font-black text-amber-300">🏅 نشان چشم تیزبین دلفی</h2>

            <div className="w-full grid grid-cols-2 gap-2.5 text-center tabular-nums">
              <div className="rounded-2xl bg-[#06152a] border border-sky-300/20 p-3">
                <span className="text-xs text-sky-200 block">وسایل پیدا شده</span>
                <span className="text-lg font-black text-white mt-0.5 block">
                  {toPersianDigits(treasuresFoundCount)}
                </span>
              </div>
              <div className="rounded-2xl bg-[#06152a] border border-amber-300/30 p-3">
                <span className="text-xs text-amber-200 block">امتیاز مروارید</span>
                <span className="text-lg font-black text-amber-300 mt-0.5 block">
                  {toPersianDigits(pearls)} 🦪
                </span>
              </div>
            </div>

            <button
              type="button"
              data-start="true"
              onClick={handleRestartGame}
              className="min-h-[48px] w-full rounded-2xl bg-gradient-to-l from-teal-300 to-cyan-300 text-[#05182e] font-black text-sm shadow-lg cursor-pointer"
            >
              شروع دوباره ↻
            </button>
          </section>
        )}
      </div>
    </div>
  );
};
