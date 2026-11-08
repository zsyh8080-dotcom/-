export interface DelfinaGameProgress {
  bestPearls: number;
  totalPearlsEarned: number;
  starfishEarned: number; // 0 to 4
  hasSharpEyeBadge: boolean;
  gamesPlayed: number;
  treasuresFoundTotal: number;
  lastPlayedIso: string | null;
}

const STORAGE_KEY = 'delfina_treasure_hunter_progress_v1';

const DEFAULT_PROGRESS: DelfinaGameProgress = {
  bestPearls: 0,
  totalPearlsEarned: 0,
  starfishEarned: 0,
  hasSharpEyeBadge: false,
  gamesPlayed: 0,
  treasuresFoundTotal: 0,
  lastPlayedIso: null,
};

export function loadDelfinaProgress(): DelfinaGameProgress {
  if (typeof window === 'undefined') {
    return DEFAULT_PROGRESS;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROGRESS;
    const parsed = JSON.parse(raw) as Partial<DelfinaGameProgress>;
    return {
      bestPearls: typeof parsed.bestPearls === 'number' ? parsed.bestPearls : 0,
      totalPearlsEarned:
        typeof parsed.totalPearlsEarned === 'number' ? parsed.totalPearlsEarned : 0,
      starfishEarned: typeof parsed.starfishEarned === 'number' ? parsed.starfishEarned : 0,
      hasSharpEyeBadge: Boolean(parsed.hasSharpEyeBadge),
      gamesPlayed: typeof parsed.gamesPlayed === 'number' ? parsed.gamesPlayed : 0,
      treasuresFoundTotal:
        typeof parsed.treasuresFoundTotal === 'number' ? parsed.treasuresFoundTotal : 0,
      lastPlayedIso: typeof parsed.lastPlayedIso === 'string' ? parsed.lastPlayedIso : null,
    };
  } catch {
    return DEFAULT_PROGRESS;
  }
}

export function saveDelfinaRunResult(run: {
  pearlsEarned: number;
  wavesCompleted: number;
  treasuresFound: number;
  completedAllWaves: boolean;
}): DelfinaGameProgress {
  const current = loadDelfinaProgress();
  const updated: DelfinaGameProgress = {
    bestPearls: Math.max(current.bestPearls, run.pearlsEarned),
    totalPearlsEarned: current.totalPearlsEarned + run.pearlsEarned,
    starfishEarned: Math.max(current.starfishEarned, Math.min(4, run.wavesCompleted)),
    hasSharpEyeBadge: current.hasSharpEyeBadge || run.completedAllWaves,
    gamesPlayed: current.gamesPlayed + 1,
    treasuresFoundTotal: current.treasuresFoundTotal + run.treasuresFound,
    lastPlayedIso: new Date().toISOString(),
  };

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage quota errors
    }
  }
  return updated;
}
