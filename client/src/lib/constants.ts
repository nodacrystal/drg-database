export const VOWEL_PATTERNS = ["ae", "oe", "ua", "an", "ao", "iu"];

export const PATTERN_COLORS: Record<string, string> = {
  ae: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  oe: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  ua: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  an: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  ao: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  iu: "bg-pink-500/20 text-pink-300 border-pink-500/30",
};

export const LEVEL_INFO: Record<number, { label: string; color: string }> = {
  1: { label: "毒舌", color: "text-yellow-400" },
  2: { label: "辛辣", color: "text-orange-400" },
  3: { label: "過激", color: "text-red-400" },
  4: { label: "暴言", color: "text-red-500" },
  5: { label: "禁忌🔞", color: "text-purple-400" },
};

export const LEVEL_BAR_COLORS: Record<number, string> = {
  1: "bg-yellow-500", 2: "bg-orange-500", 3: "bg-red-400", 4: "bg-red-500", 5: "bg-purple-500",
};
