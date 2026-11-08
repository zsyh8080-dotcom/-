import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCameraDiscoveryTime,
  buildSessionQueue,
  buildThirtySecondCoachingTip,
  calculateStageScore,
  evaluateDetectionStability,
  getInitialWaveTime,
  getProgressiveHint,
  selectBestPredictionForTarget,
  shouldTriggerEducationalMistake,
  shouldTriggerThirtySecondCoach,
  toPersianDigits,
  WAVES,
} from './rules';

test('buildSessionQueue selects 12 unique household treasures across 4 waves without repetition', () => {
  const queue = buildSessionQueue();
  assert.equal(queue.length, 12);
  const uniqueIds = new Set(queue.map((i) => i.id));
  assert.equal(uniqueIds.size, 12);
  assert.equal(queue[0].wave, 1);
  assert.equal(queue[3].wave, 2);
  assert.equal(queue[6].wave, 3);
  assert.equal(queue[9].wave, 4);
});

test('selectBestPredictionForTarget never lets a low-score target override a higher-score different object (e.g. spoon vs toothbrush)', () => {
  const toothbrushTarget = WAVES[3].items.find((i) => i.id === 'toothbrush')!;
  const predictions = [
    { class: 'person', score: 0.94 },
    { class: 'spoon', score: 0.74 },
    { class: 'toothbrush', score: 0.42 },
  ];
  const best = selectBestPredictionForTarget(predictions, toothbrushTarget);
  assert.ok(best);
  assert.equal(best.class, 'spoon');

  const evalResult = evaluateDetectionStability(
    [{ detectedClass: best.class, confidence: best.score, timestamp: 100 }],
    toothbrushTarget
  );
  assert.equal(evalResult.status, 'other_object');
  assert.equal(evalResult.visualState, 'wrong_object');
  assert.equal(evalResult.matchedPersianName, 'قاشق');
});

test('two-stage validation system requires Stage 1 candidate AND Stage 2 higher confidence threshold (>= 0.78)', () => {
  const cupTarget = WAVES[0].items.find((i) => i.id === 'cup')!;

  // Stage 1 only (confidence 0.62 < Stage 2 threshold 0.78): stays in stage1_passed ('near_target'), does NOT match yet
  const stage1OnlySamples = [
    { detectedClass: 'cup', confidence: 0.60, timestamp: 100 },
    { detectedClass: 'cup', confidence: 0.64, timestamp: 400 },
  ];
  const stage1Eval = evaluateDetectionStability(stage1OnlySamples, cupTarget);
  assert.equal(stage1Eval.status, 'stage1_passed');
  assert.equal(stage1Eval.validationStage, 1);
  assert.equal(stage1Eval.visualState, 'near_target');

  // Stage 1 + Stage 2 high confidence (>= 0.78): passes both stages and returns 'matched'
  const stage2Samples = [
    { detectedClass: 'cup', confidence: 0.64, timestamp: 100 },
    { detectedClass: 'cup', confidence: 0.84, timestamp: 400 },
  ];
  const stage2Eval = evaluateDetectionStability(stage2Samples, cupTarget);
  assert.equal(stage2Eval.status, 'matched');
  assert.equal(stage2Eval.validationStage, 2);
  assert.equal(stage2Eval.visualState, 'matched');
  assert.equal(stage2Eval.matchedPersianName, 'لیوان یا ماگ');
});

test('shouldTriggerThirtySecondCoach triggers at 30 seconds and builds text + voice coaching tips', () => {
  const spoonTarget = WAVES[1].items.find((i) => i.id === 'spoon')!;
  assert.equal(shouldTriggerThirtySecondCoach(29, false), false);
  assert.equal(shouldTriggerThirtySecondCoach(30, false), true);
  assert.equal(shouldTriggerThirtySecondCoach(35, true), false);

  const tip = buildThirtySecondCoachingTip(spoonTarget);
  assert.ok(tip.headline.includes('قاشق'));
  assert.ok(tip.textTip.length > 10);
  assert.ok(tip.voiceScript.includes('قاشق'));
});

test('timer rules match specification (50s wave 1, 45s waves 2-4, +10s capped at 60s)', () => {
  assert.equal(getInitialWaveTime(1, true), 50);
  assert.equal(getInitialWaveTime(2, false), 45);
  assert.equal(getInitialWaveTime(3, false), 45);
  assert.equal(getInitialWaveTime(4, false), 45);
  assert.equal(addCameraDiscoveryTime(32), 42);
  assert.equal(addCameraDiscoveryTime(55), 60);
});

test('calculateStageScore awards 100 base, +50 fast bonus, and +30 no-hint bonus', () => {
  const fastNoHint = calculateStageScore({ elapsedSeconds: 8, hintsUsedInStage: 0 });
  assert.equal(fastNoHint.totalStagePearls, 180);

  const slowWithHint = calculateStageScore({ elapsedSeconds: 20, hintsUsedInStage: 1 });
  assert.equal(slowWithHint.totalStagePearls, 100);
});

test('getProgressiveHint returns 3 distinct educational steps for camera mode', () => {
  const item = WAVES[0].items[0];
  const h1 = getProgressiveHint(item, 1);
  const h2 = getProgressiveHint(item, 2);
  const h3 = getProgressiveHint(item, 3);
  assert.equal(h1.step, 1);
  assert.equal(h2.step, 2);
  assert.equal(h3.step, 3);
  assert.notEqual(h1.detail, h2.detail);
});

test('shouldTriggerEducationalMistake triggers once on stage index 2', () => {
  assert.equal(shouldTriggerEducationalMistake(1, false), false);
  assert.equal(shouldTriggerEducationalMistake(2, false), true);
  assert.equal(shouldTriggerEducationalMistake(2, true), false);
});

test('toPersianDigits converts Latin digits to Persian numerals', () => {
  assert.equal(toPersianDigits(180), '۱۸۰');
});
