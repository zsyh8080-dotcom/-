export type GameMode = 'camera';

export type GameState =
  | 'intro'
  | 'permission'
  | 'countdown'
  | 'playing'
  | 'aiMistake'
  | 'success'
  | 'paused'
  | 'result';

export type VisualFrameIndicatorState =
  | 'analyzing' // در حال تحلیل تصویر (آبی/فیروزه‌ای پالس‌دار)
  | 'near_target' // نزدیک به هدف / مرحله ۱ تأیید شده، در انتظار آستانه اطمینان بالای مرحله ۲ (زرد/سبز روشن)
  | 'matched' // تأیید نهایی دو مرحله‌ای با اطمینان بالا (سبز درخشان)
  | 'wrong_object'; // شیء دیده شده با هدف فعلی تفاوت دارد (قرمز در حال تغییر)

export interface TreasureItem {
  id: string;
  persianName: string;
  emoji: string;
  cocoClasses: string[]; // Strict COCO-SSD class names for this specific household item
  minConfidence?: number; // Stage 1 candidate threshold
  highConfidenceThreshold?: number; // Stage 2 strict high-confidence threshold
  wave: 1 | 2 | 3 | 4;
  waveTitle: string;
  difficulty: 'easy' | 'medium' | 'colorful' | 'challenge';
  shapeHint: string;
  locationHint: string;
  cameraTipHint: string;
  visualFeatures: string[];
  mistakeConfuser?: {
    wrongPersianName: string;
    wrongEmoji: string;
    reason: string;
  };
}

export interface WaveDefinition {
  waveNumber: 1 | 2 | 3 | 4;
  title: string;
  subtitle: string;
  initialTimeSeconds: number;
  items: TreasureItem[];
}

export interface DetectionFrameSample {
  detectedClass: string | null;
  confidence: number;
  timestamp: number;
}

export interface StabilityEvaluation {
  status: 'matched' | 'stage1_passed' | 'uncertain' | 'searching' | 'other_object';
  validationStage: 0 | 1 | 2;
  visualState: VisualFrameIndicatorState;
  matchedClass: string | null;
  matchedPersianName: string | null;
  matchCountInWindow: number;
  windowSize: number;
  averageConfidence: number;
  peakConfidence: number;
  requiredStage2Confidence: number;
}

export interface StageScoreBreakdown {
  basePearls: number;
  fastBonusPearls: number;
  noHintBonusPearls: number;
  totalStagePearls: number;
}

export interface ThirtySecondCoachingTip {
  headline: string;
  textTip: string;
  voiceScript: string;
}

export const STAGE_1_CANDIDATE_THRESHOLD = 0.56;
export const STAGE_2_HIGH_CONFIDENCE_THRESHOLD = 0.78;
export const MIN_CONFIDENCE_THRESHOLD = STAGE_1_CANDIDATE_THRESHOLD;
export const UNCERTAIN_CONFIDENCE_THRESHOLD = 0.40;
export const STABILITY_WINDOW_SIZE = 4;
export const REQUIRED_STABLE_MATCHES = 2;
export const CAMERA_BONUS_TIME_SECONDS = 10;
export const MAX_CAMERA_TIME_SECONDS = 60;
export const FAST_FIND_THRESHOLD_SECONDS = 12;
export const AUTO_HINT_TRIGGER_SECONDS = 30;

export const DELPHI_STORY_BUBBLES: string[] = [
  'یه دوربین جادویی پیدا کردم! می‌تونه وسایل دوروبر خونه رو بشناسه. بیا امتحانش کنیم!',
  'من اسم یه وسیله دم‌دستی خونه رو نشونت می‌دم؛ تو جلوی دوربین بگیرش تا بشناسمش!',
  'حاضری؟ قبل از اینکه حباب زمان بترکه، وسیله درست رو جلوی دوربین بگیر!',
];

export const COCO_PERSIAN_LABELS: Record<string, string> = {
  book: 'کتاب یا دفتر',
  cup: 'لیوان یا ماگ',
  'wine glass': 'لیوان شیشه‌ای',
  chair: 'صندلی',
  couch: 'مبل',
  bench: 'نیمکت',
  bottle: 'بطری',
  spoon: 'قاشق',
  fork: 'چنگال',
  knife: 'چاقو یا کارد',
  bowl: 'کاسه یا بشقاب گود',
  backpack: 'کوله‌پشتی',
  handbag: 'کیف دستی',
  suitcase: 'چمدان',
  remote: 'کنترل تلویزیون',
  clock: 'ساعت',
  'cell phone': 'گوشی موبایل',
  toothbrush: 'مسواک',
  scissors: 'قیچی',
  'potted plant': 'گلدان گیاه',
  vase: 'گلدان',
  laptop: 'لپ‌تاپ',
  keyboard: 'کیبورد',
  mouse: 'ماوس',
  tv: 'تلویزیون یا مانیتور',
  bed: 'تخت',
};

// Background classes that should not overshadow the held household item
const IGNORED_BACKGROUND_CLASSES = new Set(['person', 'dining table']);

export const WAVES: WaveDefinition[] = [
  {
    waveNumber: 1,
    title: 'وسایل دم‌دستی خونه',
    subtitle: 'موج اول · وسایلی که همین الان کنارت هستن',
    initialTimeSeconds: 50,
    items: [
      {
        id: 'cup',
        persianName: 'لیوان یا ماگ',
        emoji: '🥤',
        cocoClasses: ['cup', 'wine glass'],
        minConfidence: 0.56,
        highConfidenceThreshold: 0.78,
        wave: 1,
        waveTitle: 'وسایل دم‌دستی خونه',
        difficulty: 'easy',
        shapeHint: 'استوانه‌ایه و گاهی یه دسته کنارش داره که باهاش آب یا چای می‌خوریم!',
        locationHint: 'روی میز، کنار دستت یا توی آشپزخونه حتماً یکی هست.',
        cameraTipHint: 'لیوان رو کامل وسط کادر دوربین نگه دار تا لبه‌هاش دیده بشه.',
        visualFeatures: ['استوانه‌ای', 'مخصوص نوشیدن', 'دارای لبه گرد'],
        mistakeConfuser: {
          wrongPersianName: 'گلدان کوچک',
          wrongEmoji: '🏺',
          reason: 'شکل استوانه‌ای لیوان توی نور کم شبیه گلدون به نظر رسید!',
        },
      },
      {
        id: 'book',
        persianName: 'کتاب یا دفتر',
        emoji: '📚',
        cocoClasses: ['book'],
        minConfidence: 0.55,
        highConfidenceThreshold: 0.76,
        wave: 1,
        waveTitle: 'وسایل دم‌دستی خونه',
        difficulty: 'easy',
        shapeHint: 'چهارگوشه و ورق‌ورق می‌شه؛ می‌تونی بسته یا باز جلوی دوربین بگیریش!',
        locationHint: 'روی میز تحریر، قفسه یا توی کیف پیداش می‌کنی.',
        cameraTipHint: 'کتاب رو کمی باز کن یا جلدش رو صاف جلوی دوربین بگیر.',
        visualFeatures: ['مستطیلی', 'دارای برگه‌های کاغذی', 'جلد رنگی'],
        mistakeConfuser: {
          wrongPersianName: 'جعبه مقوایی',
          wrongEmoji: '📦',
          reason: 'چون هر دو چهارگوش و صاف هستن، وقتی از زاویه کج نگاه کردم اشتباه شد!',
        },
      },
      {
        id: 'cell_phone',
        persianName: 'گوشی موبایل',
        emoji: '📱',
        cocoClasses: ['cell phone'],
        minConfidence: 0.56,
        highConfidenceThreshold: 0.78,
        wave: 1,
        waveTitle: 'وسایل دم‌دستی خونه',
        difficulty: 'easy',
        shapeHint: 'مستطیلی و باریکه و یه صفحه لمسی براق داره!',
        locationHint: 'روی میز، توی جیب یا دست اعضای خونه همیشه پیدا می‌شه.',
        cameraTipHint: 'پشت گوشی یا صفحه‌ش رو طوری بگیر که نور شدید توش برق نزنه.',
        visualFeatures: ['صفحه مستطیلی', 'لبه‌های باریک', 'دوربین پشت'],
        mistakeConfuser: {
          wrongPersianName: 'کنترل تلویزیون',
          wrongEmoji: '🎛️',
          reason: 'از دور هر دو مستطیلی و تیره به نظر می‌رسن!',
        },
      },
      {
        id: 'chair',
        persianName: 'صندلی',
        emoji: '🪑',
        cocoClasses: ['chair'],
        minConfidence: 0.56,
        highConfidenceThreshold: 0.76,
        wave: 1,
        waveTitle: 'وسایل دم‌دستی خونه',
        difficulty: 'easy',
        shapeHint: 'پشتی و چهار تا پایه داره و روش می‌شینیم!',
        locationHint: 'کنار میز اتاق یا میز ناهارخوری رو نگاه کن.',
        cameraTipHint: 'دوربین رو کمی عقب ببر تا پشتی و نشیمن صندلی توی کادر بیفته.',
        visualFeatures: ['دارای پشتی و پایه', 'مخصوص نشستن', 'چوبی یا پلاستیکی'],
      },
    ],
  },
  {
    waveNumber: 2,
    title: 'وسایل آشپزخونه و پذیرایی',
    subtitle: 'موج دوم · وسایل آشنای هر خونه',
    initialTimeSeconds: 45,
    items: [
      {
        id: 'bottle',
        persianName: 'بطری',
        emoji: '🧴',
        cocoClasses: ['bottle'],
        minConfidence: 0.56,
        highConfidenceThreshold: 0.78,
        wave: 2,
        waveTitle: 'وسایل آشپزخونه و پذیرایی',
        difficulty: 'medium',
        shapeHint: 'بلند و استوانه‌ایه و بالاش یه درِ گرد کوچیک داره!',
        locationHint: 'توی یخچال، روی میز آشپزخونه یا کنار دستت پیداش می‌کنی.',
        cameraTipHint: 'بطری رو عمودی و ایستاده جلوی دوربین بگیر تا گلوگاه و درش معلوم بشه.',
        visualFeatures: ['بدنه کشیده', 'گلوگاه باریک', 'درپوش گرد'],
        mistakeConfuser: {
          wrongPersianName: 'لیوان بلند',
          wrongEmoji: '🥛',
          reason: 'وقتی سر بطری توی کادر نبود، شبیه یه لیوان ساده دیده شد!',
        },
      },
      {
        id: 'spoon',
        persianName: 'قاشق',
        emoji: '🥄',
        cocoClasses: ['spoon'],
        minConfidence: 0.58,
        highConfidenceThreshold: 0.80,
        wave: 2,
        waveTitle: 'وسایل آشپزخونه و پذیرایی',
        difficulty: 'medium',
        shapeHint: 'دسته باریک فلزی داره و سرش بیضی و گوده!',
        locationHint: 'توی کشوی آشپزخونه یا جاقاشقی خیلی سریع پیداش می‌کنی.',
        cameraTipHint: 'قاشق رو طوری بگیر که سر گرد و گودش کاملاً جلوی دوربین معلوم باشه.',
        visualFeatures: ['فلزی و براق', 'دسته باریک', 'سر بیضی و گود'],
      },
      {
        id: 'bowl',
        persianName: 'کاسه',
        emoji: '🥣',
        cocoClasses: ['bowl'],
        minConfidence: 0.56,
        highConfidenceThreshold: 0.78,
        wave: 2,
        waveTitle: 'وسایل آشپزخونه و پذیرایی',
        difficulty: 'medium',
        shapeHint: 'گرد و گوده و توش سوپ، ماست یا میوه می‌ریزیم!',
        locationHint: 'توی کابینت آشپزخونه یا روی میز ناهارخوری هست.',
        cameraTipHint: 'کاسه رو کمی کج بگیر تا هم لبه گرد و هم گودی داخلش دیده بشه.',
        visualFeatures: ['گرد و گود', 'ظرف آشپزخانه', 'لبه دایره‌ای'],
      },
      {
        id: 'remote',
        persianName: 'کنترل تلویزیون',
        emoji: '🎛️',
        cocoClasses: ['remote'],
        minConfidence: 0.58,
        highConfidenceThreshold: 0.78,
        wave: 2,
        waveTitle: 'وسایل آشپزخونه و پذیرایی',
        difficulty: 'medium',
        shapeHint: 'مستطیلی و کوچیکه و روش پر از دکمه‌های برجسته است!',
        locationHint: 'روی مبل یا میز جلوی تلویزیون رو بگرد.',
        cameraTipHint: 'سمت دکمه‌دار کنترل رو مستقیم به طرف مرکز دوربین بگیر.',
        visualFeatures: ['مستطیلی کوچک', 'پر از دکمه', 'سبک و دستی'],
      },
    ],
  },
  {
    waveNumber: 3,
    title: 'وسایل اتاق و میز',
    subtitle: 'موج سوم · چیزهایی که هر روز می‌بینیم',
    initialTimeSeconds: 45,
    items: [
      {
        id: 'backpack',
        persianName: 'کیف یا کوله‌پشتی',
        emoji: '🎒',
        cocoClasses: ['backpack', 'handbag'],
        minConfidence: 0.56,
        highConfidenceThreshold: 0.78,
        wave: 3,
        waveTitle: 'وسایل اتاق و میز',
        difficulty: 'colorful',
        shapeHint: 'زیپ و بند داره و وسایل رو توش می‌ذاریم!',
        locationHint: 'کنار در اتاق یا نزدیک میز تحریرت رو نگاه کن.',
        cameraTipHint: 'کمی عقب‌تر بگیرش تا کل بدنه کیف و بندهاش توی تصویر جا بشه.',
        visualFeatures: ['دارای بند و زیپ', 'جیب‌دار', 'پارچه‌ای یا چرمی'],
      },
      {
        id: 'tv',
        persianName: 'تلویزیون یا مانیتور',
        emoji: '📺',
        cocoClasses: ['tv'],
        minConfidence: 0.58,
        highConfidenceThreshold: 0.78,
        wave: 3,
        waveTitle: 'وسایل اتاق و میز',
        difficulty: 'colorful',
        shapeHint: 'یه صفحه بزرگ چهارگوش داره که تصویر نشون می‌ده!',
        locationHint: 'توی هال و پذیرایی یا روی میز کامپیوتر.',
        cameraTipHint: 'دوربین رو به سمت صفحه تلویزیون یا مانیتور بگیر تا قاب چهارگوشش معلوم بشه.',
        visualFeatures: ['صفحه نمایش چهارگوش', 'قاب باریک', 'نمایش تصویر'],
      },
      {
        id: 'clock',
        persianName: 'ساعت',
        emoji: '⏰',
        cocoClasses: ['clock'],
        minConfidence: 0.58,
        highConfidenceThreshold: 0.78,
        wave: 3,
        waveTitle: 'وسایل اتاق و میز',
        difficulty: 'colorful',
        shapeHint: 'صفحه شماره و عقربه داره و زمان رو نشون می‌ده!',
        locationHint: 'روی دیوار پذیرایی، اتاق یا ساعت مچی دستت!',
        cameraTipHint: 'دوربین رو مستقیم روبه‌روی صفحه ساعت نگه دار تا شماره‌هاش واضح دیده بشن.',
        visualFeatures: ['صفحه دایره‌ای یا چهارگوش', 'عقربه و اعداد', 'نمایش زمان'],
      },
      {
        id: 'fork',
        persianName: 'چنگال',
        emoji: '🍴',
        cocoClasses: ['fork'],
        minConfidence: 0.58,
        highConfidenceThreshold: 0.80,
        wave: 3,
        waveTitle: 'وسایل اتاق و میز',
        difficulty: 'colorful',
        shapeHint: 'دسته فلزی داره و سرش چندتا شاخک تیز داره!',
        locationHint: 'توی کشوی آشپزخونه یا جاقاشقی کنار قاشق‌هاست.',
        cameraTipHint: 'شاخک‌های سر چنگال رو واضح جلوی دوربین نگه دار تا با قاشق اشتباه نشه!',
        visualFeatures: ['فلزی', 'دارای شاخک در سر', 'دسته باریک'],
      },
    ],
  },
  {
    waveNumber: 4,
    title: 'وسایل کاربردی خونه',
    subtitle: 'موج چهارم · مرحله حرفه‌ای شکارچی‌ها',
    initialTimeSeconds: 45,
    items: [
      {
        id: 'scissors',
        persianName: 'قیچی',
        emoji: '✂️',
        cocoClasses: ['scissors'],
        minConfidence: 0.58,
        highConfidenceThreshold: 0.80,
        wave: 4,
        waveTitle: 'وسایل کاربردی خونه',
        difficulty: 'challenge',
        shapeHint: 'دو تا حلقه برای انگشت‌ها و دو تا تیغه داره که کاغذ رو می‌بره!',
        locationHint: 'توی جامدادی، کشوی میز یا آشپزخونه پیدا می‌شه.',
        cameraTipHint: 'قیچی رو کمی باز کن تا شکل ضربدری و دو تا حلقه دسته‌ش کاملاً مشخص بشه!',
        visualFeatures: ['دو حلقه دسته', 'تیغه‌های فلزی', 'مخصوص بریدن کاغذ'],
      },
      {
        id: 'toothbrush',
        persianName: 'مسواک',
        emoji: '🪥',
        cocoClasses: ['toothbrush'],
        minConfidence: 0.60,
        highConfidenceThreshold: 0.82,
        wave: 4,
        waveTitle: 'وسایل کاربردی خونه',
        difficulty: 'challenge',
        shapeHint: 'دسته پلاستیکی داره و سرش پر از برس‌های ریز برای شستن دندون‌هاست!',
        locationHint: 'کنار روشویی یا توی جامسواکی.',
        cameraTipHint: 'مسواک رو از نیم‌رخ نزدیک دوربین بگیر تا برس‌های سرش کاملاً دیده بشن.',
        visualFeatures: ['دسته بلند', 'برس دندان در انتها', 'بهداشت دندان'],
      },
      {
        id: 'laptop',
        persianName: 'لپ‌تاپ یا کیبورد',
        emoji: '💻',
        cocoClasses: ['laptop', 'keyboard'],
        minConfidence: 0.58,
        highConfidenceThreshold: 0.78,
        wave: 4,
        waveTitle: 'وسایل کاربردی خونه',
        difficulty: 'challenge',
        shapeHint: 'دکمه‌های حروف داره و برای تایپ یا کار با کامپیوتر استفاده می‌شه!',
        locationHint: 'روی میز کار یا میز مطالعه.',
        cameraTipHint: 'دوربین رو به سمت دکمه‌های کیبورد یا لپ‌تاپ باز بگیر.',
        visualFeatures: ['صفحه‌کلید پر از دکمه', 'صفحه نمایش', 'ابزار کامپیوتر'],
      },
      {
        id: 'couch',
        persianName: 'مبل یا کاناپه',
        emoji: '🛋️',
        cocoClasses: ['couch'],
        minConfidence: 0.58,
        highConfidenceThreshold: 0.78,
        wave: 4,
        waveTitle: 'وسایل کاربردی خونه',
        difficulty: 'challenge',
        shapeHint: 'نرم و پهن و کوسن‌داره و توی پذیرایی روش می‌شینیم!',
        locationHint: 'توی هال و پذیرایی خونه.',
        cameraTipHint: 'کمی عقب بایست تا کل مبل و دسته‌هاش توی تصویر دیده بشه.',
        visualFeatures: ['نرم و پهن', 'دارای کوسن و دسته', 'مخصوص پذیرایی'],
      },
    ],
  },
];

/**
 * Strictly selects the top non-background prediction from a camera frame:
 * 1. Ignores background classes ('person', 'dining table') so the user's body doesn't hide the held object.
 * 2. Sorts all remaining detected objects strictly by score descending.
 * 3. NEVER lets a lower-confidence target class override a higher-confidence different object
 *    (e.g., if 'spoon' is 0.72 and 'toothbrush' is 0.35, it returns 'spoon').
 */
export function selectBestPredictionForTarget<
  T extends { class: string; score: number }
>(predictions: T[], _targetItem: TreasureItem): T | null {
  if (!predictions || predictions.length === 0) return null;

  const nonBackground = predictions
    .filter((p) => !IGNORED_BACKGROUND_CLASSES.has(p.class.toLowerCase()) && p.score >= 0.35)
    .sort((a, b) => b.score - a.score);

  return nonBackground[0] ?? null;
}

/**
 * Builds a randomized session queue of 12 unique items (3 per wave across 4 waves)
 * with zero duplicates in a single run.
 */
export function buildSessionQueue(rng: () => number = Math.random): TreasureItem[] {
  const seenIds = new Set<string>();
  const queue: TreasureItem[] = [];

  for (const wave of WAVES) {
    const available = wave.items.filter((item) => !seenIds.has(item.id));
    const shuffled = [...available];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const temp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = temp;
    }
    const picked = shuffled.slice(0, 3);
    for (const item of picked) {
      seenIds.add(item.id);
      queue.push(item);
    }
  }

  return queue;
}

export function getInitialWaveTime(waveNumber: 1 | 2 | 3 | 4, isFirstStageOfGame = false): number {
  if (isFirstStageOfGame || waveNumber === 1) {
    return 50;
  }
  return 45;
}

export function addCameraDiscoveryTime(currentRemainingSeconds: number): number {
  const next = Math.max(0, currentRemainingSeconds) + CAMERA_BONUS_TIME_SECONDS;
  return Math.min(MAX_CAMERA_TIME_SECONDS, next);
}

/**
 * Two-Stage Image Validation System (سیستم اعتبارسنجی دو مرحله‌ای):
 * - Stage 1 (شناسایی اولیه / کاندیدای هدف): Object class matches targetItem with confidence >= stage1Threshold (e.g. 0.56).
 *   Sets validationStage = 1 and visualState = 'near_target'.
 * - Stage 2 (تأیید نهایی با آستانه اطمینان بالاتر): Requires at least 2 matching frames in window AND peak/latest
 *   confidence >= stage2HighThreshold (e.g. 0.78) to prevent false positives during scanning.
 *   Sets validationStage = 2 and visualState = 'matched'.
 * - Wrong Object: If a non-target object is detected in the latest frame, sets validationStage = 0
 *   and visualState = 'wrong_object' (Red dynamic border).
 */
export function evaluateDetectionStability(
  recentSamples: DetectionFrameSample[],
  targetItem: TreasureItem
): StabilityEvaluation {
  const windowSamples = recentSamples.slice(-STABILITY_WINDOW_SIZE);
  const validClasses = new Set(targetItem.cocoClasses.map((c) => c.toLowerCase()));
  const stage1Threshold = targetItem.minConfidence ?? STAGE_1_CANDIDATE_THRESHOLD;
  const stage2HighThreshold =
    targetItem.highConfidenceThreshold ?? STAGE_2_HIGH_CONFIDENCE_THRESHOLD;

  if (windowSamples.length === 0) {
    return {
      status: 'searching',
      validationStage: 0,
      visualState: 'analyzing',
      matchedClass: null,
      matchedPersianName: null,
      matchCountInWindow: 0,
      windowSize: 0,
      averageConfidence: 0,
      peakConfidence: 0,
      requiredStage2Confidence: stage2HighThreshold,
    };
  }

  // If the most recent frame clearly shows a DIFFERENT object (e.g. spoon instead of toothbrush),
  // immediately report 'other_object' + 'wrong_object' (Red indicator)!
  const latestSample = windowSamples[windowSamples.length - 1];
  if (
    latestSample &&
    latestSample.detectedClass &&
    !validClasses.has(latestSample.detectedClass.toLowerCase()) &&
    !IGNORED_BACKGROUND_CLASSES.has(latestSample.detectedClass.toLowerCase()) &&
    latestSample.confidence >= 0.4
  ) {
    const key = latestSample.detectedClass.toLowerCase();
    return {
      status: 'other_object',
      validationStage: 0,
      visualState: 'wrong_object',
      matchedClass: key,
      matchedPersianName: COCO_PERSIAN_LABELS[key] || latestSample.detectedClass,
      matchCountInWindow: 0,
      windowSize: windowSamples.length,
      averageConfidence: Number(latestSample.confidence.toFixed(2)),
      peakConfidence: Number(latestSample.confidence.toFixed(2)),
      requiredStage2Confidence: stage2HighThreshold,
    };
  }

  const stage1TargetSamples = windowSamples.filter(
    (s) =>
      s.detectedClass !== null &&
      validClasses.has(s.detectedClass.toLowerCase()) &&
      s.confidence >= stage1Threshold
  );

  const stage2HighConfSamples = stage1TargetSamples.filter(
    (s) => s.confidence >= stage2HighThreshold
  );

  const uncertainTargetSamples = windowSamples.filter(
    (s) =>
      s.detectedClass !== null &&
      validClasses.has(s.detectedClass.toLowerCase()) &&
      s.confidence >= UNCERTAIN_CONFIDENCE_THRESHOLD &&
      s.confidence < stage1Threshold
  );

  // Stage 2 Passed: Both stability (>= 2 frames in Stage 1) AND high-confidence threshold (>= stage2HighThreshold) met!
  if (
    stage1TargetSamples.length >= REQUIRED_STABLE_MATCHES &&
    stage2HighConfSamples.length >= 1
  ) {
    const avgConf =
      stage1TargetSamples.reduce((acc, item) => acc + item.confidence, 0) /
      stage1TargetSamples.length;
    const peakConf = Math.max(...stage1TargetSamples.map((s) => s.confidence));
    const latestMatch = stage1TargetSamples[stage1TargetSamples.length - 1];
    const matchedClass = latestMatch.detectedClass!;
    return {
      status: 'matched',
      validationStage: 2,
      visualState: 'matched',
      matchedClass,
      matchedPersianName: targetItem.persianName,
      matchCountInWindow: stage1TargetSamples.length,
      windowSize: windowSamples.length,
      averageConfidence: Number(avgConf.toFixed(2)),
      peakConfidence: Number(peakConf.toFixed(2)),
      requiredStage2Confidence: stage2HighThreshold,
    };
  }

  // Stage 1 Passed (waiting for Stage 2 high-confidence threshold >= 0.78)
  if (stage1TargetSamples.length > 0) {
    const avgConf =
      stage1TargetSamples.reduce((acc, item) => acc + item.confidence, 0) /
      stage1TargetSamples.length;
    const peakConf = Math.max(...stage1TargetSamples.map((s) => s.confidence));
    return {
      status: 'stage1_passed',
      validationStage: 1,
      visualState: 'near_target',
      matchedClass: targetItem.cocoClasses[0],
      matchedPersianName: targetItem.persianName,
      matchCountInWindow: 1,
      windowSize: windowSamples.length,
      averageConfidence: Number(avgConf.toFixed(2)),
      peakConfidence: Number(peakConf.toFixed(2)),
      requiredStage2Confidence: stage2HighThreshold,
    };
  }

  // Near target (uncertain confidence 0.40 - 0.56)
  if (uncertainTargetSamples.length > 0) {
    const avgConf =
      uncertainTargetSamples.reduce((acc, item) => acc + item.confidence, 0) /
      uncertainTargetSamples.length;
    const peakConf = Math.max(...uncertainTargetSamples.map((s) => s.confidence));
    return {
      status: 'uncertain',
      validationStage: 1,
      visualState: 'near_target',
      matchedClass: targetItem.cocoClasses[0],
      matchedPersianName: targetItem.persianName,
      matchCountInWindow: 1,
      windowSize: windowSamples.length,
      averageConfidence: Number(avgConf.toFixed(2)),
      peakConfidence: Number(peakConf.toFixed(2)),
      requiredStage2Confidence: stage2HighThreshold,
    };
  }

  return {
    status: 'searching',
    validationStage: 0,
    visualState: 'analyzing',
    matchedClass: null,
    matchedPersianName: null,
    matchCountInWindow: 0,
    windowSize: windowSamples.length,
    averageConfidence: 0,
    peakConfidence: 0,
    requiredStage2Confidence: stage2HighThreshold,
  };
}

export function calculateStageScore(params: {
  elapsedSeconds: number;
  hintsUsedInStage: number;
}): StageScoreBreakdown {
  const basePearls = 100;
  const fastBonusPearls = params.elapsedSeconds <= FAST_FIND_THRESHOLD_SECONDS ? 50 : 0;
  const noHintBonusPearls = params.hintsUsedInStage === 0 ? 30 : 0;
  return {
    basePearls,
    fastBonusPearls,
    noHintBonusPearls,
    totalStagePearls: basePearls + fastBonusPearls + noHintBonusPearls,
  };
}

export function getProgressiveHint(
  item: TreasureItem,
  step: 1 | 2 | 3
): {
  step: 1 | 2 | 3;
  headline: string;
  detail: string;
} {
  if (step === 1) {
    return {
      step: 1,
      headline: 'شکلش رو خوب نگاه کن!',
      detail: item.shapeHint,
    };
  }
  if (step === 2) {
    return {
      step: 2,
      headline: 'کجای خونه پیداش می‌کنی؟',
      detail: item.locationHint,
    };
  }
  return {
    step: 3,
    headline: 'راهنمای زاویه و نور دوربین:',
    detail: item.cameraTipHint,
  };
}

/**
 * Checks whether the child has been trying to find the current object for >= 30 seconds
 * so the game can automatically offer text + audio coaching.
 */
export function shouldTriggerThirtySecondCoach(
  unsuccessfulSeconds: number,
  alreadyTriggeredForCurrentStage: boolean
): boolean {
  return !alreadyTriggeredForCurrentStage && unsuccessfulSeconds >= AUTO_HINT_TRIGGER_SECONDS;
}

/**
 * Builds the helpful text & audio coaching tip displayed when a child spends >30 seconds on an item.
 */
export function buildThirtySecondCoachingTip(item: TreasureItem): ThirtySecondCoachingTip {
  const headline = `💡 راهنمای ویژه دلفی برای پیدا کردن «${item.persianName}»`;
  const textTip = `${item.locationHint} ${item.cameraTipHint}`;
  const voiceScript = `دوست خوبم، برای پیدا کردن ${item.persianName}، ${item.locationHint} بعد ${item.cameraTipHint}`;
  return {
    headline,
    textTip,
    voiceScript,
  };
}

export function shouldTriggerEducationalMistake(
  stageIndex: number,
  alreadyTriggeredInSession: boolean
): boolean {
  return !alreadyTriggeredInSession && stageIndex === 2;
}

export function toPersianDigits(value: number | string): string {
  const persian = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(value).replace(/\d/g, (d) => persian[Number(d)] ?? d);
}
