import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  addCameraDiscoveryTime,
  AUTO_HINT_TRIGGER_SECONDS,
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
import { DelphiMascot, DelphiMood } from './DelphiMascot';
import goldenClamImg from '../assets/images/golden_clam_badge_1793958110974.jpg';
import delphiCameraImg from '../assets/images/delphi_magic_camera_1793958109081.jpg';

interface DelphiTreasureHunterGameProps {
  autoStart?: boolean;
}

export const DelphiTreasureHunterGame: React.FC<DelphiTreasureHunterGameProps> = ({
  autoStart = false,
}) => {
  // Core Game State Machine (100% Camera Mode)
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
  const [unsuccessfulSeconds, setUnsuccessfulSeconds] = useState<number>(0);

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
  const [detectionText, setDetectionText] = useState<string>(
    'دوربین جادویی در حال تحلیل تصویر است...'
  );
  const [detectionStateType, setDetectionStateType] = useState<
    'idle' | 'scanning' | 'matched' | 'uncertain' | 'other'
  >('idle');
  const [delphiMood, setDelphiMood] = useState<DelphiMood>('curious');
  const [delphiSpeech, setDelphiSpeech] = useState<string>(
    `یه «${currentTarget.persianName}» جلوی دوربین بگیر تا بشناسمش!`
  );
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

  // Accessibility & Audio Settings
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [reduceMotion, setReduceMotion] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  });

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

  // Sync body dataset state for testing & Ultra Mode hygiene
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
        setDelphiMood('proud');
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

      setDelphiMood('curious');
      setDelphiSpeech(`حالا یه «${nextTarget.persianName}» جلوی دوربین بگیر!`);
      setDetectionText(`«${nextTarget.persianName}» رو جلوی دوربین بگیر...`);
      setDetectionStateType('scanning');
      soundEngine.playStageStart();
      setGameState('playing');
    },
    [sessionQueue]
  );

  // Trigger celebration when target household item passes BOTH Stage 1 & Stage 2 validation
  const handleTargetVerified = useCallback(
    (matchedItem: TreasureItem, finalConfidence: number) => {
      if (gameStateRef.current !== 'playing') return;

      // Educational AI mistake moment once per session on stageIndex === 2
      if (shouldTriggerEducationalMistake(stageIndexRef.current, mistakeTriggeredRef.current)) {
        setMistakeTriggeredInSession(true);
        mistakeTriggeredRef.current = true;
        setMistakeStep('oops');
        setDelphiMood('oops');
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
      setDelphiMood('excited');
      setDelphiSpeech(
        `آفرین! اعتبارسنجی دو مرحله‌ای با اطمینان ${confPercent}٪ تأیید کرد که «${matchedItem.persianName}» هست!`
      );
      setDetectionText(
        `تأیید مرحله ۲ (${confPercent}٪): ${matchedItem.persianName} (+۱۰ ثانیه زمان اضافه!)`
      );
      setDetectionStateType('matched');
      setGameState('success');

      successTimeoutRef.current = window.setTimeout(() => {
        advanceToNextStage(true);
      }, 1350);
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
      const highThresholdPercent = toPersianDigits(Math.round(stage2HighThreshold * 100));

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

          // Stage 1 + Stage 2 Passed: Target matched AND confidence >= stage2HighThreshold (0.78)
          if (
            geminiVerdict.isTargetMatch &&
            geminiVerdict.confidence >= stage2HighThreshold
          ) {
            handleTargetVerified(target, geminiVerdict.confidence);
            return;
          }

          // Stage 1 Passed, but confidence < Stage 2 High Threshold (e.g. blurry/far, 0.56 <= conf < 0.78)
          if (
            (geminiVerdict.isTargetMatch || geminiVerdict.isNearTarget) &&
            geminiVerdict.confidence >= (target.minConfidence ?? 0.56)
          ) {
            setValidationStage(1);
            setVisualFrameState('near_target');
            setDetectionStateType('uncertain');
            const curPct = toPersianDigits(Math.round(geminiVerdict.confidence * 100));
            const nearMsg = `مرحله ۱ تأیید شد (${curPct}٪)! کمی نزدیک‌تر و ثابت نگه دار تا اطمینان از مرز ${highThresholdPercent}٪ رد بشه (مرحله ۲)...`;
            setDetectionText(nearMsg);
            setDelphiMood('curious');
            setDelphiSpeech(nearMsg);
            soundEngine.playStage1Lock();
            return;
          }

          // Wrong object shown (e.g. spoon instead of toothbrush) -> Red Dynamic Frame!
          recentSamplesRef.current = [];
          setValidationStage(0);

          if (geminiVerdict.hasObject && geminiVerdict.detectedObjectPersian) {
            setVisualFrameState('wrong_object');
            setDetectionStateType('other');
            const msg =
              geminiVerdict.feedbackPersian ||
              `این که «${geminiVerdict.detectedObjectPersian}» هست! من دنبال «${target.persianName}» می‌گردم!`;
            setDetectionText(msg);
            setDelphiMood('curious');
            setDelphiSpeech(msg);
            if (isManualTrigger) {
              soundEngine.playWrongObjectAlert();
            }
          } else {
            setVisualFrameState('analyzing');
            setDetectionStateType('scanning');
            const msg =
              geminiVerdict.feedbackPersian ||
              `در حال تحلیل تصویر... «${target.persianName}» رو وسط کادر دوربین بگیر!`;
            setDetectionText(msg);
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
              setDetectionStateType('uncertain');
              const curPct = toPersianDigits(Math.round(best.score * 100));
              setDetectionText(
                `مرحله ۱ تأیید شد (${curPct}٪)! ثابت نگه دار تا اطمینان به ${highThresholdPercent}٪ برسه...`
              );
              soundEngine.playStage1Lock();
            } else {
              setValidationStage(1);
              setVisualFrameState('near_target');
              setDetectionStateType('uncertain');
              setDetectionText(`به هدف نزدیک شدی! نور یا زاویه رو بهتر کن.`);
            }
          } else {
            setValidationStage(0);
            setVisualFrameState('wrong_object');
            setDetectionStateType('other');
            const wrongMsg = `این که «${persianName}» هست! من دنبال «${target.persianName}» می‌گردم!`;
            setDetectionText(wrongMsg);
            setDelphiSpeech(wrongMsg);
            if (isManualTrigger) {
              soundEngine.playWrongObjectAlert();
            }
          }
        } else {
          setValidationStage(0);
          setVisualFrameState('analyzing');
          setLiveSeenLabel(null);
          setLiveSeenConfidence(null);
          setDetectionStateType('scanning');
          setDetectionText(`هیچ «${target.persianName}»ای توی کادر دیده نشد! جلوی دوربین بگیرش.`);
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
          setDelphiMood('happy');
          setDelphiSpeech(coaching.textTip);
          soundEngine.speakPersianHint(coaching.voiceScript);
        }
        return nextVal;
      });

      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          soundEngine.playTimeOut();
          setDelphiMood('happy');
          setDelphiSpeech(
            'حباب زمان این وسیله تموم شد؛ اشکالی نداره، بریم سراغ وسیله بعدی خونه!'
          );
          setDetectionText('زمان تموم شد · بریم وسیله بعدی!');
          window.setTimeout(() => {
            advanceToNextStage(false);
          }, 900);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timerInterval);
  }, [advanceToNextStage]);

  // Real-Time Two-Stage Camera Detection Loop:
  // - Stage 1 (Continuous COCO-SSD scan every 400ms): Updates dynamic visual frame ('analyzing' | 'near_target' | 'wrong_object').
  // - Stage 2 (High-Confidence Threshold Check >= 0.78 + Gemini Vision referee): Confirms the object with high confidence before awarding!
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

      // Periodic two-stage Gemini Vision check every 2.2 seconds on live video
      if (now - lastGeminiCheckTimeRef.current >= 2200) {
        lastGeminiCheckTimeRef.current = now;
        performTwoStageVerification(videoRef.current, target, false);
        return;
      }

      // Fast local Stage-1 COCO-SSD check in between Gemini Vision checks
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
        // Stage 1 & local Stage 2 passed — run final authoritative verification
        lastGeminiCheckTimeRef.current = now;
        await performTwoStageVerification(videoRef.current, target, false);
      } else if (evaluation.status === 'stage1_passed' || evaluation.status === 'uncertain') {
        const pct = toPersianDigits(Math.round(evaluation.peakConfidence * 100));
        const reqPct = toPersianDigits(Math.round(evaluation.requiredStage2Confidence * 100));
        setLiveSeenLabel(target.persianName);
        setLiveSeenConfidence(evaluation.peakConfidence);
        setDetectionStateType('uncertain');
        setDetectionText(
          `مرحله ۱ تأیید شد (${pct}٪) — ثابت نگه دار تا امتیاز اطمینان به ${reqPct}٪ برسه (مرحله ۲)...`
        );
      } else if (evaluation.status === 'other_object' && evaluation.matchedPersianName) {
        setLiveSeenLabel(evaluation.matchedPersianName);
        setLiveSeenConfidence(evaluation.averageConfidence);
        setDetectionStateType('other');
        setDetectionText(
          `این که «${evaluation.matchedPersianName}» هست! ما دنبال «${target.persianName}» می‌گردیم.`
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

    if (camResult.stream && camResult.errorType === 'none') {
      setCameraLiveActive(true);
      cameraManager.attachToVideoElement(videoRef.current);
      setDetectionText('دوربین جادویی روشن شد! وسیله هدف رو جلوی دوربین بگیر...');
      setDetectionStateType('scanning');
    } else {
      setCameraLiveActive(false);
      setCameraErrorMsg(
        camResult.persianErrorMessage ||
          'پخش زنده دوربین در این قاب محدود شده؛ می‌تونی با دکمه «📷 عکس بگیر» عکس وسیله رو بگیری!'
      );
      setDetectionText('کادر دوربین آماده است! وسیله رو جلوی دوربین بگیر یا عکسش رو بفرست.');
      setDetectionStateType('scanning');
    }

    const activeTarget = sessionQueue[stageIndex] ?? sessionQueue[0];
    const initSec = getInitialWaveTime(activeTarget.wave, stageIndex === 0);
    setRemainingSeconds(initSec);
    setMaxStageSeconds(initSec);
    stageElapsedSecondsRef.current = 0;
    setUnsuccessfulSeconds(0);
    setValidationStage(0);
    setVisualFrameState('analyzing');
    setDelphiMood('curious');
    setDelphiSpeech(`یه «${activeTarget.persianName}» پیدا کن و جلوی دوربین بگیر!`);
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
      setDetectionText('دوربین جابه‌جا شد! دلفی داره نگاه می‌کنه...');
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
    setDetectionStateType('scanning');
    setDetectionText('عکس دریافت شد! در حال اعتبارسنجی دو مرحله‌ای با آستانه اطمینان بالا...');

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
      setDetectionStateType('uncertain');
      setDetectionText(
        `هنوز تصویر دوربین آماده نیست؛ دکمه «📷 عکس بگیر» رو بزن و از «${target.persianName}» عکس بگیر!`
      );
      return;
    }

    setVisualFrameState('analyzing');
    setDetectionStateType('scanning');
    setDetectionText('در حال اعتبارسنجی دو مرحله‌ای با آستانه اطمینان بالا...');
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

  // Handle Sound Mute Toggle
  const handleToggleMute = () => {
    soundEngine.markUserInteraction();
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    soundEngine.setMuted(nextMuted);
  };

  const timerRatio = Math.max(0, Math.min(1, remainingSeconds / maxStageSeconds));
  const isTimerLow = remainingSeconds <= 10;
  const shouldGlowHint = unsuccessfulSeconds >= 7 && hintsUsedInStage < 3;

  const requiredHighConf =
    currentTarget.highConfidenceThreshold ?? STAGE_2_HIGH_CONFIDENCE_THRESHOLD;
  const requiredHighConfPercent = toPersianDigits(Math.round(requiredHighConf * 100));
  const livePercentFormatted =
    liveSeenConfidence !== null ? toPersianDigits(Math.round(liveSeenConfidence * 100)) : null;

  // Dynamic Visual Frame Styles (Green / Amber-Green / Red / Cyan-Analyzing)
  const frameVisualConfig = {
    analyzing: {
      outerBorder: 'border-cyan-400/75 shadow-[0_0_20px_rgba(34,211,238,0.25)]',
      innerReticle: 'border-cyan-300/60',
      scanLine: 'via-cyan-300 shadow-[0_0_14px_#67e8f9]',
      badgeBg: 'bg-cyan-950/90 border-cyan-400/60 text-cyan-200',
      badgeText: isScanningNow
        ? '🔄 هوش مصنوعی در حال تحلیل دقیق تصویر...'
        : '🔎 هوش مصنوعی در حال تحلیل تصویر...',
    },
    near_target: {
      outerBorder: 'border-emerald-400 shadow-[0_0_28px_rgba(52,211,153,0.45)]',
      innerReticle: 'border-emerald-300/90',
      scanLine: 'via-emerald-300 shadow-[0_0_16px_#6ee7b7]',
      badgeBg: 'bg-emerald-950/90 border-emerald-400 text-emerald-200',
      badgeText: `🟢 نزدیک به هدف! مرحله ۱ رد شد (نیاز به اطمینان ≥ ${requiredHighConfPercent}٪)`,
    },
    matched: {
      outerBorder: 'border-emerald-300 shadow-[0_0_36px_rgba(16,185,129,0.75)]',
      innerReticle: 'border-emerald-200',
      scanLine: 'via-emerald-200 shadow-[0_0_20px_#34d399]',
      badgeBg: 'bg-emerald-600/95 border-emerald-200 text-white',
      badgeText: '✅ تأیید دو مرحله‌ای با اطمینان بالا!',
    },
    wrong_object: {
      outerBorder: 'border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.55)]',
      innerReticle: 'border-rose-400/90',
      scanLine: 'via-rose-400 shadow-[0_0_16px_#fb7185]',
      badgeBg: 'bg-rose-950/95 border-rose-400 text-rose-200',
      badgeText: '🔴 شیء دیده شده با هدف فعلی فرق داره!',
    },
  }[visualFrameState];

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-[#061833] via-[#082449] to-[#041124] text-white flex flex-col items-center justify-between relative overflow-hidden select-none">
      {/* Gentle Floating Background Bubbles */}
      {!reduceMotion && (
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
          <div className="absolute bottom-8 right-[12%] w-6 h-6 rounded-full border border-sky-300/25 bg-sky-300/5 animate-bounce" />
          <div className="absolute top-1/3 left-[10%] w-10 h-10 rounded-full border border-teal-300/20 bg-teal-300/5 animate-pulse" />
          <div className="absolute bottom-1/4 left-[22%] w-4 h-4 rounded-full border border-sky-200/30 bg-sky-200/10" />
        </div>
      )}

      {/* Mobile-First Vertical Game Frame */}
      <div className="relative z-10 w-full max-w-md min-h-screen flex flex-col justify-start px-3 py-2.5 sm:py-4 gap-2">
        {/* 1. TOP BAR: Restart button, Short game name, Pearl counter, Sound button */}
        <header className="w-full flex items-center justify-between gap-2 bg-[#092244]/95 border border-sky-300/25 rounded-2xl px-2.5 py-2 shadow-md shrink-0">
          <button
            type="button"
            onClick={handleRestartGame}
            aria-label="شروع مجدد بازی"
            className="min-h-[42px] px-2.5 rounded-xl bg-[#0e3261] hover:bg-[#15427d] border border-sky-300/30 flex items-center justify-center gap-1 text-xs font-bold text-sky-100 cursor-pointer active:scale-95 transition-transform shrink-0"
          >
            <span aria-hidden="true">↻</span>
            <span>از اول</span>
          </button>

          <h1 className="text-xs sm:text-sm font-black text-white whitespace-nowrap">
            شکارچی گنج‌های دلفی 📸
          </h1>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Pearl Score Counter */}
            <div
              aria-label={`امتیاز مروارید: ${toPersianDigits(pearls)}`}
              className={`min-h-[40px] px-2.5 py-1 rounded-xl border flex items-center gap-1.5 font-black text-xs sm:text-sm tabular-nums transition-transform ${
                pearlSparkle
                  ? 'bg-amber-400/30 border-amber-300 text-amber-200 scale-110 shadow-lg shadow-amber-400/30'
                  : 'bg-[#06162d] border-sky-300/30 text-amber-300'
              }`}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
                <circle cx="12" cy="12" r="9" fill="#fde68a" stroke="#f59e0b" strokeWidth="2" />
                <circle cx="9" cy="9" r="2.5" fill="#ffffff" />
              </svg>
              <span>{toPersianDigits(pearls)}</span>
            </div>

            {/* Sound Mute/Unmute Button */}
            <button
              type="button"
              onClick={handleToggleMute}
              aria-label={isMuted ? 'وصل کردن صدا' : 'قطع کردن صدا'}
              className="min-h-[42px] min-w-[42px] rounded-xl bg-[#0e3261] hover:bg-[#15427d] border border-sky-300/30 flex items-center justify-center text-base cursor-pointer active:scale-95 transition-transform"
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
          </div>
        </header>

        {/* ============================================================
            STATE 1: INTRO & CAMERA START
            ============================================================ */}
        {gameState === 'intro' && (
          <section
            aria-label="شروع شکار با دوربین جادویی دلفی"
            className="flex-1 flex flex-col justify-between bg-[#0a2346]/90 border border-sky-300/30 rounded-3xl p-4 sm:p-5 shadow-2xl gap-3.5"
          >
            <div className="flex flex-col items-center text-center gap-2">
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl overflow-hidden border-2 border-teal-300 shadow-xl">
                <img
                  src={delphiCameraImg}
                  alt="دلفی و دوربین جادویی"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="text-xs font-bold text-teal-300">
                اعتبارسنجی دو مرحله‌ای با آستانه اطمینان بالا
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-white">
                شکارچی گنج‌های دلفی!
              </h2>
            </div>

            {/* 3 Story Bubbles */}
            <div className="flex flex-col gap-2">
              {DELPHI_STORY_BUBBLES.map((bubbleText, idx) => {
                const isCurrent = idx === introBubbleIdx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      soundEngine.markUserInteraction();
                      setIntroBubbleIdx(idx);
                    }}
                    className={`w-full text-right rounded-2xl p-3 transition-all border cursor-pointer ${
                      isCurrent
                        ? 'bg-[#f8fafc] text-[#081d38] border-teal-300 shadow-lg'
                        : 'bg-[#10315e] text-sky-100 border-sky-300/30'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-teal-500/20 text-teal-600 font-black text-xs flex items-center justify-center shrink-0 mt-0.5">
                        {toPersianDigits(idx + 1)}
                      </span>
                      <p className="text-xs sm:text-sm font-bold leading-relaxed">{bubbleText}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Everyday Household Items Preview */}
            <div className="rounded-2xl bg-[#071a36] border border-sky-300/25 p-3 flex flex-col gap-1.5 text-right">
              <p className="text-xs font-extrabold text-teal-300">
                🏠 وسایل دم‌دستی که توی هر خونه‌ای پیدا می‌شه:
              </p>
              <p className="text-xs text-sky-100 leading-relaxed">
                🥤 لیوان · 📚 کتاب · 📱 گوشی · 🥄 قاشق · 🍴 چنگال · 🎛️ کنترل تلویزیون · 🧴 بطری · 🪑 صندلی · 🎒 کیف
              </p>
            </div>

            <button
              type="button"
              data-start="true"
              onClick={handleStartCameraGame}
              className="min-h-[52px] w-full rounded-2xl bg-gradient-to-l from-teal-300 to-cyan-300 hover:from-teal-200 hover:to-cyan-200 text-[#05182e] font-black text-sm sm:text-base shadow-xl cursor-pointer active:scale-95 transition-transform flex items-center justify-center gap-2"
            >
              <span aria-hidden="true">📸</span>
              <span>روشن کردن دوربین و شروع بازی!</span>
            </button>
          </section>
        )}

        {/* ============================================================
            STATE 2: PERMISSION / INITIALIZING CAMERA
            ============================================================ */}
        {gameState === 'permission' && (
          <section
            aria-label="آماده‌سازی دوربین جادویی"
            className="flex-1 flex flex-col items-center justify-center bg-[#0a2346]/90 border border-sky-300/30 rounded-3xl p-6 text-center gap-4"
          >
            <div className="w-20 h-20 rounded-full border-4 border-teal-300 border-t-transparent animate-spin" />
            <h2 className="text-lg font-black text-white">
              لطفاً اجازه دسترسی به دوربین رو در مرورگر تأیید کن...
            </h2>
            <p className="text-xs text-sky-200 leading-relaxed max-w-xs">
              تایمر مرحله متوقفه تا دوربین روشن بشه!
            </p>
          </section>
        )}

        {/* ============================================================
            STATE 3: COUNTDOWN (3, 2, 1 + Target Household Item Reveal)
            ============================================================ */}
        {gameState === 'countdown' && (
          <section
            aria-label="شمارش معکوس شروع مرحله"
            className="relative flex-1 flex flex-col items-center justify-center bg-[#0a2346]/90 border border-sky-300/30 rounded-3xl p-6 text-center gap-4 overflow-hidden"
          >
            <span className="relative z-10 text-xs font-extrabold text-teal-300">
              وسیله هدف رو آماده کن!
            </span>
            <p className="relative z-10 text-base font-black text-white">
              یه «{currentTarget.persianName}» جلوی دوربین بگیر!
            </p>
            <div
              className={`relative z-10 w-28 h-28 rounded-3xl bg-[#11386b]/90 border-2 border-teal-300 flex items-center justify-center text-6xl shadow-xl ${
                !reduceMotion ? 'animate-bounce' : ''
              }`}
            >
              {currentTarget.emoji}
            </div>
            <div className="relative z-10 text-5xl font-black text-amber-300 tabular-nums">
              {toPersianDigits(countdownNum)}
            </div>
            <p className="relative z-10 text-xs text-sky-200">
              کادر دوربین آماده است! شمارش معکوس شروع شد...
            </p>
          </section>
        )}

        {/* ============================================================
            STATE 4: ACTIVE CAMERA GAMEPLAY ('playing' | 'success' | 'aiMistake' | 'paused')
            ============================================================ */}
        {(gameState === 'playing' ||
          gameState === 'success' ||
          gameState === 'aiMistake' ||
          gameState === 'paused') && (
          <div className="flex-1 flex flex-col justify-between gap-2 min-h-0">
            {/* 2. MISSION AREA CARD: Target Household Object + Skip Item Button */}
            <section
              aria-label="ناحیه مأموریت وسیله هدف"
              className="w-full rounded-3xl bg-gradient-to-b from-[#10386b] to-[#0a2448] border-2 border-sky-300/35 px-3.5 py-2 shadow-lg flex flex-col gap-1.5 shrink-0"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-center justify-center bg-[#071a36] border-2 border-amber-300/70 rounded-2xl px-3 py-1.5 shadow-md shrink-0 min-w-[76px]">
                    <span
                      className={`text-3xl sm:text-4xl leading-none ${
                        !reduceMotion ? 'animate-bounce' : ''
                      }`}
                      role="img"
                      aria-label={currentTarget.persianName}
                    >
                      {currentTarget.emoji}
                    </span>
                    <span className="text-[11px] sm:text-xs font-black text-amber-200 mt-1 whitespace-nowrap">
                      {currentTarget.persianName}
                    </span>
                  </div>

                  <div className="flex flex-col">
                    <span className="text-xs font-extrabold text-teal-300">
                      این وسیله رو جلوی دوربین بگیر:
                    </span>
                    <h2 className="text-base sm:text-lg font-black text-white mt-0.5">
                      {currentTarget.persianName}
                    </h2>
                  </div>
                </div>

                {/* Skip Current Item Button */}
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.markUserInteraction();
                    advanceToNextStage(false);
                  }}
                  aria-label="رد کردن این وسیله و رفتن به وسیله بعدی"
                  className="min-h-[42px] px-3 py-1.5 rounded-2xl bg-[#0e3261] hover:bg-[#164785] border border-sky-300/35 text-sky-100 font-extrabold text-[11px] flex flex-col items-center justify-center gap-0.5 shrink-0 cursor-pointer active:scale-95 transition-transform"
                >
                  <span aria-hidden="true">⏭️</span>
                  <span>وسیله بعدی</span>
                </button>
              </div>

              {/* Compact Delphi Speech Line */}
              <DelphiMascot
                mood={delphiMood}
                message={delphiSpeech}
                size="sm"
                reduceMotion={reduceMotion}
              />
            </section>

            {/* 30-SECOND AUTOMATIC TEXT & VOICE COACHING BANNER */}
            {thirtySecCoaching && (
              <div
                role="region"
                aria-label="راهنمای هوشمند ۳۰ ثانیه‌ای"
                className="w-full rounded-2xl bg-gradient-to-l from-amber-500/25 via-[#103463] to-[#0b2548] border-2 border-amber-300/80 px-3 py-2 shadow-lg flex items-center justify-between gap-2 shrink-0"
              >
                <div className="flex flex-col text-right min-w-0">
                  <span className="text-[11px] font-black text-amber-300">
                    {thirtySecCoaching.headline} (بیش از {toPersianDigits(AUTO_HINT_TRIGGER_SECONDS)} ثانیه تلاش)
                  </span>
                  <p className="text-xs text-sky-100 font-bold leading-snug mt-0.5">
                    {thirtySecCoaching.textTip}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.markUserInteraction();
                    soundEngine.speakPersianHint(thirtySecCoaching.voiceScript);
                  }}
                  aria-label="پخش صوتی راهنمایی"
                  className="min-h-[40px] px-2.5 rounded-xl bg-amber-300 hover:bg-amber-200 text-[#05182e] font-black text-[11px] flex items-center gap-1 shrink-0 cursor-pointer active:scale-95 transition-transform"
                >
                  <span aria-hidden="true">🔊</span>
                  <span>پخش صوتی</span>
                </button>
              </div>
            )}

            {/* 3. MAIN PLAY AREA: Live Camera Viewfinder with Dynamic Green/Red/Cyan Indicator & Two-Stage Validation */}
            <main className="w-full flex-1 flex flex-col justify-center min-h-0">
              <div
                data-testid="camera-visual-indicator"
                data-frame-state={visualFrameState}
                className={`relative w-full flex-1 min-h-[250px] sm:min-h-[285px] rounded-3xl overflow-hidden border-4 bg-[#041022] transition-all duration-300 flex flex-col justify-between ${frameVisualConfig.outerBorder}`}
              >
                {/* Hidden Native Camera Input (<input capture="environment">) */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoFileChange}
                  className="hidden"
                  aria-label="عکس گرفتن با دوربین گوشی یا انتخاب عکس وسیله"
                />

                {/* Live Camera Video Element */}
                <video
                  ref={handleVideoElementRef}
                  playsInline
                  muted
                  autoPlay
                  aria-label="پیش‌نمایش زنده دوربین جادویی دلفی"
                  className={`absolute inset-0 w-full h-full object-cover ${
                    capturedPhotoUrl ? 'opacity-20' : 'opacity-100'
                  }`}
                />

                {/* Captured Photo Preview */}
                {capturedPhotoUrl && (
                  <img
                    src={capturedPhotoUrl}
                    alt="عکس گرفته شده با دوربین"
                    className="absolute inset-0 w-full h-full object-contain bg-[#041022]/90 z-[2]"
                  />
                )}

                {/* Top Camera Bar: Two-Stage High-Confidence Validation Status + Flip Camera */}
                <div className="relative z-10 m-2.5 flex flex-col gap-1.5 bg-[#061831]/90 rounded-2xl px-3 py-2 text-[11px] font-bold text-sky-100 border border-sky-300/30">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>اعتبارسنجی ۲ مرحله‌ای:</span>
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-black border ${
                          validationStage >= 1
                            ? 'bg-emerald-500/30 border-emerald-300 text-emerald-200'
                            : 'bg-slate-800/80 border-slate-600 text-slate-300'
                        }`}
                      >
                        ۱. شناسایی اولیه {validationStage >= 1 ? '✓' : ''}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-black border ${
                          validationStage >= 2
                            ? 'bg-emerald-400 text-[#05182e] border-emerald-200'
                            : 'bg-slate-800/80 border-slate-600 text-slate-300'
                        }`}
                      >
                        ۲. اطمینان ≥ {requiredHighConfPercent}٪ {validationStage >= 2 ? '✓' : ''}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleSwitchCameraFacing}
                      aria-label="چرخش دوربین جلو و عقب"
                      className="px-2 py-1 rounded-xl bg-[#103463] hover:bg-[#174682] border border-sky-300/35 text-sky-100 font-bold text-[10px] flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <span aria-hidden="true">🔄</span>
                      <span>چرخش</span>
                    </button>
                  </div>

                  {/* Live Visual Indicator Pill showing AI analysis & proximity to target */}
                  <div
                    className={`w-full rounded-xl px-2.5 py-1 border text-[11px] font-extrabold flex items-center justify-between gap-2 transition-colors ${frameVisualConfig.badgeBg}`}
                  >
                    <span className="truncate">{frameVisualConfig.badgeText}</span>
                    {livePercentFormatted && (
                      <span className="tabular-nums shrink-0">
                        اطمینان: {livePercentFormatted}٪
                      </span>
                    )}
                  </div>
                </div>

                {/* Helpful Center Guide when WebRTC live stream is blocked by browser/iframe and no photo taken yet */}
                {!cameraLiveActive && !capturedPhotoUrl && (
                  <div className="relative z-[5] my-auto mx-4 rounded-2xl bg-[#071d3b]/90 border border-sky-300/40 p-3 text-center flex flex-col items-center gap-2">
                    <span className="text-2xl" aria-hidden="true">
                      📸
                    </span>
                    <p className="text-xs font-extrabold text-sky-100 leading-relaxed">
                      {cameraErrorMsg ||
                        `«${currentTarget.persianName}» رو جلوی دوربین بگیر! اگر تصویر زنده در این مرورگر مسدود است، از دکمه زیر عکس بگیر:`}
                    </p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-[38px] px-4 rounded-xl bg-amber-300 hover:bg-amber-200 text-[#05182e] font-black text-xs shadow cursor-pointer"
                    >
                      📷 باز کردن دوربین گوشی / انتخاب عکس وسیله
                    </button>
                  </div>
                )}

                {/* Dynamic Changing Visual Target Reticle (Green / Red / Cyan) & Radar Scan Line */}
                <div
                  className={`absolute inset-3.5 border-2 border-dashed rounded-2xl pointer-events-none z-[4] transition-colors duration-300 ${frameVisualConfig.innerReticle}`}
                  aria-hidden="true"
                />
                {!reduceMotion && (
                  <div
                    className={`absolute inset-x-5 top-1/2 h-0.5 bg-gradient-to-r from-transparent to-transparent animate-pulse pointer-events-none z-[4] ${frameVisualConfig.scanLine}`}
                    aria-hidden="true"
                  />
                )}

                {/* Bottom Camera Controls: Live Object Seen Badge + Manual Scan Shutter + Photo Capture */}
                <div className="relative z-10 m-2.5 flex flex-col gap-1.5">
                  {liveSeenLabel && (
                    <div
                      className={`self-center px-3 py-1 rounded-xl border text-xs font-black shadow-md ${
                        visualFrameState === 'wrong_object'
                          ? 'bg-rose-950/95 border-rose-400 text-rose-200'
                          : visualFrameState === 'near_target' || visualFrameState === 'matched'
                            ? 'bg-emerald-950/95 border-emerald-300 text-emerald-200'
                            : 'bg-[#061831]/95 border-teal-300/60 text-teal-200'
                      }`}
                    >
                      🎯 شیء دیده‌شده: {liveSeenLabel}
                      {livePercentFormatted ? ` (اطمینان ${livePercentFormatted}٪)` : ''}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={isScanningNow}
                      onClick={handleManualCameraScan}
                      className="flex-1 min-h-[46px] rounded-2xl bg-gradient-to-l from-teal-300 to-cyan-300 hover:from-teal-200 hover:to-cyan-200 disabled:opacity-60 text-[#05182e] font-black text-xs sm:text-sm shadow-lg flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-transform"
                    >
                      <span aria-hidden="true">{isScanningNow ? '⏳' : '📸'}</span>
                      <span>
                        {isScanningNow
                          ? 'در حال اعتبارسنجی دو مرحله‌ای...'
                          : `اسکن «${currentTarget.persianName}» با دوربین`}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="عکس گرفتن یا انتخاب تصویر"
                      className="min-h-[46px] px-3 rounded-2xl bg-[#0f3463]/95 hover:bg-[#164785] border border-amber-300/50 text-amber-200 font-extrabold text-xs flex items-center justify-center gap-1 shrink-0 cursor-pointer active:scale-95 transition-transform"
                    >
                      <span aria-hidden="true">📷</span>
                      <span>عکس بگیر</span>
                    </button>
                  </div>
                </div>
              </div>
            </main>

            {/* 4. DETECTION STATUS BAR (نوار تشخیص زنده) */}
            <div
              role="status"
              aria-live="polite"
              className={`w-full rounded-2xl px-3.5 py-2 border flex items-center justify-between gap-2 text-xs sm:text-sm font-extrabold shrink-0 transition-colors ${
                detectionStateType === 'matched'
                  ? 'bg-emerald-500/25 border-emerald-300 text-emerald-100'
                  : detectionStateType === 'other'
                    ? 'bg-rose-500/25 border-rose-300 text-rose-100'
                    : detectionStateType === 'uncertain'
                      ? 'bg-amber-500/25 border-amber-300 text-amber-100'
                      : 'bg-[#092244]/90 border-sky-300/30 text-sky-100'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <span aria-hidden="true">
                  {detectionStateType === 'matched'
                    ? '✅'
                    : detectionStateType === 'other'
                      ? '❌'
                      : detectionStateType === 'uncertain'
                        ? '🧐'
                        : '🔎'}
                </span>
                <span className="truncate">{detectionText}</span>
              </div>
            </div>

            {/* 5. BOTTOM CONTROLS BAR: Bubble Timer, Smart Hint (Text + Voice), Pause */}
            <footer className="w-full rounded-3xl bg-[#081f3f]/95 border border-sky-300/25 px-3 py-2.5 shadow-xl flex flex-col gap-2 shrink-0">
              {/* Shrinking Bubble Timer Bar */}
              <div className="flex items-center gap-2.5">
                <div
                  className={`min-w-[68px] px-2.5 py-1 rounded-2xl border flex items-center justify-center gap-1 font-black text-xs sm:text-sm tabular-nums ${
                    isTimerLow
                      ? 'bg-rose-500/30 border-rose-300 text-rose-200 animate-pulse'
                      : 'bg-sky-500/20 border-sky-300/40 text-sky-100'
                  }`}
                  aria-label={`زمان باقی‌مانده: ${toPersianDigits(remainingSeconds)} ثانیه`}
                >
                  <span aria-hidden="true">🫧</span>
                  <span>{toPersianDigits(remainingSeconds)} ث</span>
                </div>

                <div className="flex-1 h-4 rounded-full bg-[#041226] border border-sky-300/25 p-0.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-transform duration-300 origin-right ${
                      isTimerLow
                        ? 'bg-gradient-to-l from-rose-400 to-amber-400'
                        : 'bg-gradient-to-l from-teal-300 via-cyan-300 to-sky-400'
                    }`}
                    style={{ transform: `scaleX(${timerRatio})` }}
                  />
                </div>
              </div>

              {/* Action Buttons Row: Hint (Text + Audio), Found Counter, Pause */}
              <div className="flex items-center justify-between gap-2">
                {/* Smart Progressive Hint Button */}
                <button
                  type="button"
                  onClick={handleOpenSmartHint}
                  className={`min-h-[44px] px-3.5 rounded-2xl border font-extrabold text-xs flex items-center gap-1.5 cursor-pointer active:scale-95 transition-transform ${
                    shouldGlowHint
                      ? 'bg-amber-400 text-[#05182e] border-amber-200 shadow-lg shadow-amber-400/30 animate-pulse'
                      : 'bg-[#103463] hover:bg-[#16437d] text-amber-200 border-amber-300/40'
                  }`}
                >
                  <span aria-hidden="true">💡</span>
                  <span>راهنمایی متنی و صوتی ({toPersianDigits(hintsUsedInStage)}/۳)</span>
                </button>

                {/* Current Session Found Counter */}
                <div className="flex items-center gap-1.5 text-xs font-bold text-sky-100 tabular-nums">
                  <span>پیدا شده: {toPersianDigits(treasuresFoundCount)}</span>
                </div>

                {/* Pause Button */}
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.markUserInteraction();
                    setGameState('paused');
                  }}
                  aria-label="توقف بازی"
                  className="min-h-[44px] px-3.5 rounded-2xl bg-[#103463] hover:bg-[#16437d] border border-sky-300/30 text-sky-100 font-extrabold text-xs flex items-center gap-1.5 cursor-pointer active:scale-95 transition-transform"
                >
                  <span aria-hidden="true">⏸️</span>
                  <span>توقف</span>
                </button>
              </div>
            </footer>
          </div>
        )}

        {/* ============================================================
            CELEBRATION OVERLAY ('success' — skippable burst)
            ============================================================ */}
        {gameState === 'success' && (
          <div
            role="dialog"
            aria-label="پیدا شدن وسیله"
            onClick={() => advanceToNextStage(true)}
            className="fixed inset-0 z-40 bg-[#04142b]/80 flex items-center justify-center p-4 cursor-pointer"
          >
            <div className="w-full max-w-xs rounded-3xl bg-gradient-to-b from-[#103e73] to-[#082244] border-2 border-amber-300 p-5 text-center shadow-2xl flex flex-col items-center gap-3 relative overflow-hidden">
              <div className="relative flex items-center justify-center">
                <div className="w-24 h-24 rounded-full border-4 border-amber-300 shadow-[0_0_30px_#fde047] flex items-center justify-center text-5xl bg-[#071c38]">
                  {currentTarget.emoji}
                </div>
                <span className="absolute -top-2 -right-4 text-2xl animate-bounce">⭐</span>
                <span className="absolute -top-2 -left-4 text-2xl animate-bounce">⭐</span>
                <span className="absolute -bottom-3 text-2xl animate-bounce">⭐</span>
              </div>

              <h3 className="text-xl font-black text-amber-300">آفرین! پیداش کردیم!</h3>
              <p className="text-xs font-bold text-sky-100">
                تأیید دو مرحله‌ای با اطمینان بالا: «{currentTarget.persianName}» (+۱۰ ثانیه زمان)
              </p>

              <div className="px-4 py-1.5 rounded-2xl bg-amber-400/20 border border-amber-300/60 text-amber-200 font-black text-sm tabular-nums">
                +{toPersianDigits(lastStageGain)} مروارید 🦪
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  advanceToNextStage(true);
                }}
                className="mt-1 text-xs font-bold text-teal-300 underline cursor-pointer"
              >
                رفتن به وسیله بعدی ←
              </button>
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
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-amber-300">
                  🌟 نکته آموزشی: وقتی هوش مصنوعی اشتباه می‌کنه
                </span>
                <span className="text-xl" aria-hidden="true">
                  🤖
                </span>
              </div>

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
                        دلفی در نگاه اول فکر کرد این یه «
                        {currentTarget.mistakeConfuser?.wrongPersianName || 'وسیله مشابه'}» هست!
                      </p>
                    </div>
                  </div>

                  <p className="text-xs sm:text-sm font-bold text-amber-100 leading-relaxed">
                    «ولی با اعتبارسنجی دو مرحله‌ای دوباره بررسیش می‌کنیم!»
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.markUserInteraction();
                      soundEngine.playHintCurious();
                      setMistakeStep('lesson');
                    }}
                    className="min-h-[48px] w-full rounded-2xl bg-amber-300 hover:bg-amber-200 text-[#05182e] font-black text-sm cursor-pointer"
                  >
                    بررسی مرحله دوم با دقت بالا 🔍
                  </button>
                </>
              ) : (
                <>
                  <div className="rounded-2xl bg-emerald-500/20 border border-emerald-300/50 p-3.5 flex items-center gap-3">
                    <span className="text-4xl">{currentTarget.emoji}</span>
                    <div>
                      <h3 id="ai-mistake-title" className="text-base font-black text-emerald-200">
                        آها! این واقعاً یه «{currentTarget.persianName}» هست!
                      </h3>
                      <p className="text-xs text-sky-100 mt-1 leading-relaxed">
                        {currentTarget.mistakeConfuser?.reason ||
                          'وقتی زاویه و نور بهتر شد، دوربین جادویی دلفی درست تشخیصش داد!'}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-[#f8fafc] text-[#081d38] p-3.5 border border-teal-300 font-bold text-xs sm:text-sm leading-relaxed">
                    💡 «اعتبارسنجی دو مرحله‌ای کمک می‌کنه هوش مصنوعی با مقایسه امتیاز اطمینان، اشتباهات مرحله اول رو اصلاح کنه!»
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setGameState('playing');
                      gameStateRef.current = 'playing';
                      handleTargetVerified(currentTarget, 0.92);
                    }}
                    className="min-h-[48px] w-full rounded-2xl bg-gradient-to-l from-teal-300 to-emerald-300 text-[#05182e] font-black text-sm cursor-pointer"
                  >
                    گرفتن جایزه این وسیله! (+مروارید) 🦪
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
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-amber-300">
                  راهنمای متنی و صوتی دلفی · قدم {toPersianDigits(activeHintModal.step)} از ۳
                </span>
                <span className="text-xl" aria-hidden="true">
                  💡
                </span>
              </div>
              <h3 id="smart-hint-title" className="text-base font-black text-white">
                {activeHintModal.headline}
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
                className="min-h-[42px] w-full rounded-2xl bg-[#123769] hover:bg-[#194a8a] border border-amber-300/50 text-amber-200 font-extrabold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span aria-hidden="true">🔊</span>
                <span>شنیدن صدای راهنمای دلفی</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.stopSpeaking();
                  setActiveHintModal(null);
                }}
                className="min-h-[44px] w-full rounded-2xl bg-teal-300 text-[#05182e] font-black text-sm cursor-pointer"
              >
                فهمیدم، ادامه شکار!
              </button>
            </div>
          </div>
        )}

        {/* ============================================================
            PAUSE MODAL ('paused')
            ============================================================ */}
        {gameState === 'paused' && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pause-modal-title"
            className="fixed inset-0 z-50 bg-[#030e21]/85 flex items-center justify-center p-4"
          >
            <div className="w-full max-w-xs rounded-3xl bg-[#0b2548] border-2 border-sky-300/50 p-5 shadow-2xl flex flex-col gap-3 text-center">
              <h3 id="pause-modal-title" className="text-lg font-black text-white">
                بازی متوقف شد ⏸️
              </h3>
              <p className="text-xs text-sky-200">
                تایمر حبابی نگه داشته شده تا هر وقت آماده بودی ادامه بدی.
              </p>
              <button
                type="button"
                onClick={() => setGameState('playing')}
                className="min-h-[48px] w-full rounded-2xl bg-teal-300 text-[#05182e] font-black text-sm cursor-pointer"
              >
                ادامه بازی ▶
              </button>
              <button
                type="button"
                onClick={() => setReduceMotion((prev) => !prev)}
                className="min-h-[44px] w-full rounded-2xl bg-[#10325e] border border-sky-300/25 text-sky-100 font-bold text-xs cursor-pointer"
              >
                {reduceMotion ? 'انیمیشن‌ها: حالت آرام (فعال) 🐢' : 'کاهش حرکت و انیمیشن‌ها 🌊'}
              </button>
              <button
                type="button"
                onClick={handleRestartGame}
                className="min-h-[44px] w-full rounded-2xl bg-[#123769] text-sky-100 font-bold text-xs cursor-pointer"
              >
                شروع دوباره از اول ↻
              </button>
            </div>
          </div>
        )}

        {/* ============================================================
            STATE 5: END RESULT SCREEN ('result')
            ============================================================ */}
        {gameState === 'result' && (
          <section
            aria-label="صفحه پایان و دریافت نشان چشم تیزبین دلفی"
            className="flex-1 flex flex-col justify-between bg-[#0a2346]/95 border-2 border-amber-300/70 rounded-3xl p-4 sm:p-5 shadow-2xl my-auto gap-3.5 relative overflow-hidden"
          >
            <div className="flex flex-col items-center text-center gap-2">
              <div className="relative w-32 h-32 sm:w-36 sm:h-36 rounded-3xl overflow-hidden border-2 border-amber-300 shadow-[0_0_30px_rgba(251,191,36,0.35)]">
                <img
                  src={goldenClamImg}
                  alt="صدف بزرگ و مروارید طلایی با نشان چشم تیزبین دلفی"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="text-xs font-black text-amber-300">
                🏅 نشان ویژه: «چشم تیزبین دلفی»
              </span>
            </div>

            <DelphiMascot
              mood="proud"
              message="وااای! چه شکارچی تیزبینی شدی! دیدی دوربینم با اعتبارسنجی دو مرحله‌ای چقدر دقیق وسایل رو تشخیص داد؟"
              reduceMotion={reduceMotion}
            />

            <div className="grid grid-cols-2 gap-2.5 text-center tabular-nums">
              <div className="rounded-2xl bg-[#071a36] border border-sky-300/25 p-3">
                <span className="text-[11px] text-sky-200 block">وسایل پیدا شده</span>
                <span className="text-lg font-black text-white mt-0.5 block">
                  {toPersianDigits(treasuresFoundCount)}
                </span>
              </div>
              <div className="rounded-2xl bg-[#071a36] border border-sky-300/25 p-3">
                <span className="text-[11px] text-sky-200 block">تشخیص‌های موفق</span>
                <span className="text-lg font-black text-teal-300 mt-0.5 block">
                  {toPersianDigits(successfulGuessesCount)}
                </span>
              </div>
              <div className="rounded-2xl bg-[#071a36] border border-amber-300/40 p-3">
                <span className="text-[11px] text-amber-200 block">امتیاز نهایی مروارید</span>
                <span className="text-lg font-black text-amber-300 mt-0.5 block">
                  {toPersianDigits(pearls)} 🦪
                </span>
              </div>
              <div className="rounded-2xl bg-[#071a36] border border-sky-300/25 p-3">
                <span className="text-[11px] text-sky-200 block">نشان به‌دست‌آمده</span>
                <span className="text-xs sm:text-sm font-black text-amber-300 mt-1 block">
                  چشم تیزبین دلفی ⭐
                </span>
              </div>
            </div>

            <button
              type="button"
              data-start="true"
              onClick={handleRestartGame}
              className="min-h-[50px] w-full rounded-2xl bg-gradient-to-l from-teal-300 to-emerald-300 hover:from-teal-200 hover:to-emerald-200 text-[#05182e] font-black text-sm shadow-lg cursor-pointer"
            >
              دوباره بازی کنیم ↻
            </button>
          </section>
        )}
      </div>
    </div>
  );
};
