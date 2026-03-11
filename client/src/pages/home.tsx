import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Flame, Mic2, Sparkles, Zap, AlertTriangle, Loader2, Star,
  Copy, Trash2, CheckSquare, Square, Database, Target, X, Ban, ScrollText, Heart, Plus, Wrench, Play, Search,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface WordEntry { word: string; reading: string; romaji: string; }
interface FavWord { id: number; word: string; reading: string; romaji: string; vowels: string; charCount: number; }
interface HardRhymeGroup { suffix: string; words: FavWord[]; tier: "hard" | "super" | "legendary"; }
interface FavGroup { vowels: string; words: FavWord[]; hardRhymes?: HardRhymeGroup[]; }
interface NgWord { id: number; word: string; reading: string; romaji: string; }
interface ProgressLog { time: string; detail: string; elapsed: string; }
interface GenerationResult {
  groups: Record<string, WordEntry[]>;
  ungrouped: WordEntry[];
  total: number;
}

function extractVowels(romaji: string): string {
  const r = romaji.toLowerCase();
  let result = "";
  for (let i = 0; i < r.length; i++) {
    if ("aeiou".includes(r[i])) result += r[i];
    else if (r[i] === "n" && (!r[i + 1] || !"aeiou".includes(r[i + 1]))) result += "n";
  }
  return result;
}

const VOWEL_PATTERNS = ["ae", "oe", "ua", "an", "ao", "iu"];

const PATTERN_COLORS: Record<string, string> = {
  ae: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  oe: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  ua: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  an: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  ao: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  iu: "bg-pink-500/20 text-pink-300 border-pink-500/30",
};

const LEVEL_INFO: Record<number, { label: string; color: string }> = {
  1: { label: "リスペクト", color: "text-blue-400" },
  2: { label: "称賛", color: "text-cyan-400" },
  3: { label: "親しみ", color: "text-green-400" },
  4: { label: "軽口", color: "text-lime-400" },
  5: { label: "毒舌", color: "text-yellow-400" },
  6: { label: "辛辣", color: "text-amber-400" },
  7: { label: "攻撃", color: "text-orange-400" },
  8: { label: "過激", color: "text-red-400" },
  9: { label: "暴言", color: "text-red-500" },
  10: { label: "放禁", color: "text-red-600" },
};

const LEVEL_BAR_COLORS: Record<number, string> = {
  1: "bg-blue-500", 2: "bg-cyan-500", 3: "bg-green-500", 4: "bg-lime-500",
  5: "bg-yellow-500", 6: "bg-amber-500", 7: "bg-orange-500", 8: "bg-red-400",
  9: "bg-red-500", 10: "bg-red-600",
};

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}秒`;
}

function getWordsFromResult(result: GenerationResult): WordEntry[] {
  const all: WordEntry[] = [];
  for (const p of VOWEL_PATTERNS) { if (result.groups[p]) all.push(...result.groups[p]); }
  all.push(...result.ungrouped);
  return all;
}

export default function Home() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [target, setTarget] = useState("");
  const [level, setLevel] = useState(5);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [genResult, setGenResult] = useState<GenerationResult | null>(null);
  const [activeTab, setActiveTab] = useState<"gen" | "fav" | "ng">("gen");
  const [checkedWords, setCheckedWords] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([]);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [genStatus, setGenStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [pasteTextFav, setPasteTextFav] = useState("");
  const [pasteTextNg, setPasteTextNg] = useState("");
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [cleanupLogs, setCleanupLogs] = useState<ProgressLog[]>([]);
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [autoModeCount, setAutoModeCount] = useState(0);
  const [selectedFavIds, setSelectedFavIds] = useState<Set<number>>(new Set());
  const [selectedNgIds, setSelectedNgIds] = useState<Set<number>>(new Set());
  const [isScrutinizing, setIsScrutinizing] = useState(false);
  const [scrutinyLogs, setScrutinyLogs] = useState<ProgressLog[]>([]);
  const autoModeRef = useRef(false);
  const isCleaningUpRef = useRef(false);
  const cleanupPromiseRef = useRef<Promise<void> | null>(null);
  const generateDissSSERef = useRef<typeof generateDissSSE | null>(null);
  const addWordsDirectRef = useRef<typeof addWordsDirect | null>(null);
  const runCleanupRef = useRef<typeof runCleanup | null>(null);

  useEffect(() => { if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: "smooth" }); }, [progressLogs]);
  useEffect(() => { return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  const favQuery = useQuery<{ groups: FavGroup[]; total: number }>({ queryKey: ["/api/favorites"] });
  const favCountQuery = useQuery<{ total: number }>({ queryKey: ["/api/favorites/count"] });
  const ngWordsQuery = useQuery<{ words: NgWord[]; total: number }>({ queryKey: ["/api/ng-words"] });
  const ngCountQuery = useQuery<{ total: number }>({ queryKey: ["/api/ng-words/count"] });

  const totalCount = favCountQuery.data?.total ?? favQuery.data?.total ?? 0;
  const ngCount = ngCountQuery.data?.total ?? ngWordsQuery.data?.total ?? 0;

  const getAllEntries = useCallback((): WordEntry[] => {
    if (!genResult) return [];
    return getWordsFromResult(genResult);
  }, [genResult]);

  const hasResults = genResult !== null && genResult.total > 0;

  const toggleChecked = useCallback((word: string) => {
    setCheckedWords(prev => { const next = new Set(prev); next.has(word) ? next.delete(word) : next.add(word); return next; });
  }, []);
  const selectAll = useCallback(() => { setCheckedWords(new Set(getAllEntries().map(e => e.word))); }, [getAllEntries]);
  const deselectAll = useCallback(() => setCheckedWords(new Set()), []);
  const isAllSelected = hasResults ? checkedWords.size === getAllEntries().length && getAllEntries().length > 0 : false;

  const targetMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("GET", "/api/target"); return res.json(); },
    onSuccess: (data: { target: string }) => { setTarget(data.target); setGenResult(null); },
    onError: () => { toast({ title: "エラー", description: "ターゲット生成に失敗しました", variant: "destructive" }); },
  });

  const generateDissSSE = useCallback(async (overrideTarget?: string, overrideLevel?: number): Promise<GenerationResult | null> => {
    const effectiveTarget = overrideTarget ?? target;
    const effectiveLevel = overrideLevel ?? level;

    setIsGenerating(true);
    setProgressLogs([]);
    setGenResult(null);
    setGenStatus("running");
    setTimerSeconds(0);

    if (timerRef.current) clearInterval(timerRef.current);
    const genStartTime = Date.now();
    timerRef.current = setInterval(() => { setTimerSeconds(Math.floor((Date.now() - genStartTime) / 1000)); }, 1000);

    const addLog = (detail: string, elapsed: string) => {
      const now = new Date();
      const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
      setProgressLogs(prev => [...prev, { time, detail, elapsed }]);
    };

    addLog(`生成開始... (Lv.${effectiveLevel} ${LEVEL_INFO[effectiveLevel].label})`, "0秒");

    let finalResult: GenerationResult | null = null;

    try {
      const response = await fetch("/api/diss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: effectiveTarget, level: effectiveLevel }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || "ワード生成に失敗しました");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.type === "progress") {
              addLog(data.detail, data.elapsed || "");
            } else if (data.type === "result") {
              setGenStatus("success");
              finalResult = { groups: data.groups || {}, ungrouped: data.ungrouped || [], total: data.total || 0 };
              setGenResult(finalResult);
              const allWords = getWordsFromResult(finalResult);
              setCheckedWords(new Set(allWords.map(e => e.word)));
            } else if (data.type === "error") {
              setGenStatus("error");
              toast({ title: "エラー", description: data.error, variant: "destructive" });
            }
          } catch {}
        }
      }
    } catch (err) {
      setGenStatus("error");
      toast({ title: "エラー", description: err instanceof Error ? err.message : "ワード生成に失敗しました", variant: "destructive" });
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setTimerSeconds(Math.floor((Date.now() - genStartTime) / 1000));
      setIsGenerating(false);
    }

    return finalResult;
  }, [target, level, toast]);

  const addFavMutation = useMutation({
    mutationFn: async (words: WordEntry[]) => { const res = await apiRequest("POST", "/api/favorites", { words }); return res.json(); },
    onSuccess: (data: { added: number; total: number }) => {
      toast({ title: "追加完了", description: `${data.added}個追加（合計 ${data.total}個）` });
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/favorites/count"] });
    },
    onError: () => { toast({ title: "エラー", description: "お気に入りの追加に失敗しました", variant: "destructive" }); },
  });

  const deleteFavMutation = useMutation({
    mutationFn: async (id: number) => { const res = await apiRequest("DELETE", `/api/favorites/${id}`); return res.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/favorites/count"] });
    },
  });

  const batchDeleteFavMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch("/api/favorites/batch-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      if (!res.ok) throw new Error("一括削除に失敗しました");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "削除完了", description: `${data.deleted}個を削除しました` });
      setSelectedFavIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/favorites/count"] });
    },
    onError: () => { toast({ title: "エラー", description: "一括削除に失敗しました", variant: "destructive" }); },
  });

  const batchDeleteNgMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch("/api/ng-words/batch-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      if (!res.ok) throw new Error("一括削除に失敗しました");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "削除完了", description: `${data.deleted}個のNG単語を削除しました` });
      setSelectedNgIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/ng-words"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ng-words/count"] });
    },
    onError: () => { toast({ title: "エラー", description: "一括削除に失敗しました", variant: "destructive" }); },
  });

  const clearFavMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("DELETE", "/api/favorites"); return res.json(); },
    onSuccess: () => {
      toast({ title: "削除完了", description: "お気に入りをすべて削除しました" });
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/favorites/count"] });
    },
  });

  const clearNgMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("DELETE", "/api/ng-words"); return res.json(); },
    onSuccess: () => {
      toast({ title: "削除完了", description: "NG単語をすべて削除しました" });
      queryClient.invalidateQueries({ queryKey: ["/api/ng-words"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ng-words/count"] });
    },
  });

  const addToFavorites = useCallback(async () => {
    if (checkedWords.size === 0) { toast({ title: "未選択", description: "ワードを選択してください" }); return; }
    const allEntries = getAllEntries();
    const selected = allEntries.filter(e => checkedWords.has(e.word));
    addFavMutation.mutate(selected);
    setCheckedWords(new Set());
  }, [checkedWords, getAllEntries, toast, addFavMutation]);

  const copyFavorites = useCallback(async () => {
    try {
      const res = await fetch("/api/favorites/export");
      await navigator.clipboard.writeText(await res.text());
      toast({ title: "コピー完了", description: "全データをクリップボードにコピーしました" });
    } catch { toast({ title: "エラー", description: "コピーに失敗しました", variant: "destructive" }); }
  }, [toast]);

  const copyNgWords = useCallback(async () => {
    if (!ngWordsQuery.data?.words.length) return;
    const text = ngWordsQuery.data.words.map(w => w.word).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "コピー完了", description: `${ngWordsQuery.data.words.length}個のNG単語をコピーしました` });
    } catch { toast({ title: "エラー", description: "コピーに失敗しました", variant: "destructive" }); }
  }, [ngWordsQuery.data, toast]);

  const toggleNgSelection = useCallback((id: number) => {
    setSelectedNgIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const deleteSelectedNg = useCallback(() => {
    if (selectedNgIds.size === 0) return;
    batchDeleteNgMutation.mutate(Array.from(selectedNgIds));
  }, [selectedNgIds, batchDeleteNgMutation]);

  const toggleFavSelection = useCallback((id: number) => {
    setSelectedFavIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const copySelectedFavs = useCallback(async () => {
    if (selectedFavIds.size === 0 || !favQuery.data) return;
    const allWords: FavWord[] = [];
    for (const g of favQuery.data.groups) {
      allWords.push(...g.words);
      if (g.hardRhymes) for (const hr of g.hardRhymes) allWords.push(...hr.words);
    }
    const selected = allWords.filter(w => selectedFavIds.has(w.id));
    const text = selected.map(w => `${w.word}/${w.reading}(${w.romaji})`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "コピー完了", description: `${selected.length}個のワードをコピーしました` });
    } catch { toast({ title: "エラー", description: "コピーに失敗しました", variant: "destructive" }); }
  }, [selectedFavIds, favQuery.data, toast]);

  const deleteSelectedFavs = useCallback(() => {
    if (selectedFavIds.size === 0) return;
    batchDeleteFavMutation.mutate(Array.from(selectedFavIds));
  }, [selectedFavIds, batchDeleteFavMutation]);

  const runScrutiny = useCallback(async () => {
    if (isScrutinizing) return;
    setIsScrutinizing(true);
    setScrutinyLogs([]);
    setSelectedFavIds(new Set());
    try {
      const response = await fetch("/api/favorites/scrutinize", { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!response.ok) throw new Error("精査に失敗しました");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "progress") {
              setScrutinyLogs(prev => [...prev, { time: "", detail: data.detail, elapsed: data.elapsed || "" }]);
            } else if (data.type === "result") {
              const ids = new Set<number>(data.flagged.map((f: { id: number }) => f.id));
              setSelectedFavIds(ids);
              const s = data.summary;
              toast({ title: "精査完了", description: `${ids.size}件を検出（母音${s.vowelMismatch}・重複${s.duplicateEndings}・AI${s.aiDetected}）` });
            } else if (data.type === "error") {
              toast({ title: "エラー", description: data.error, variant: "destructive" });
            }
          } catch {}
        }
      }
    } catch {
      toast({ title: "エラー", description: "精査に失敗しました", variant: "destructive" });
    }
    setIsScrutinizing(false);
  }, [isScrutinizing, toast]);

  const pasteFavMutation = useMutation({
    mutationFn: async (text: string) => { const res = await apiRequest("POST", "/api/favorites/paste", { text }); return res.json(); },
    onSuccess: (data: { added: number; total: number }) => {
      toast({ title: "追加完了", description: `${data.added}個追加（合計 ${data.total}個）` });
      setPasteTextFav("");
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/favorites/count"] });
    },
    onError: (err: Error) => { toast({ title: "エラー", description: err.message || "追加に失敗しました", variant: "destructive" }); },
  });

  const pasteNgMutation = useMutation({
    mutationFn: async (text: string) => { const res = await apiRequest("POST", "/api/ng-words/paste", { text }); return res.json(); },
    onSuccess: (data: { added: number; total: number }) => {
      toast({ title: "追加完了", description: `${data.added}個追加（合計 ${data.total}個）` });
      setPasteTextNg("");
      queryClient.invalidateQueries({ queryKey: ["/api/ng-words"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ng-words/count"] });
    },
    onError: (err: Error) => { toast({ title: "エラー", description: err.message || "追加に失敗しました", variant: "destructive" }); },
  });

  const runCleanup = useCallback(async () => {
    if (isCleaningUpRef.current) {
      if (cleanupPromiseRef.current) await cleanupPromiseRef.current;
      return;
    }
    isCleaningUpRef.current = true;
    setIsCleaningUp(true);
    setCleanupLogs([]);

    const doCleanup = async () => {
      try {
        const response = await fetch("/api/favorites/cleanup", { method: "POST", headers: { "Content-Type": "application/json" } });
        if (!response.ok) throw new Error("整理に失敗しました");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader");
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "progress") {
                setCleanupLogs(prev => [...prev, { time: data.step, detail: data.detail, elapsed: data.elapsed || "" }]);
              } else if (data.type === "result") {
                toast({ title: "整理完了", description: `重複削除${data.deleted}個 (残り${data.total}語)` });
                queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
                queryClient.invalidateQueries({ queryKey: ["/api/favorites/count"] });
              } else if (data.type === "error") {
                toast({ title: "エラー", description: data.error, variant: "destructive" });
              }
            } catch {}
          }
        }
      } catch {
        toast({ title: "エラー", description: "整理に失敗しました", variant: "destructive" });
      }
      isCleaningUpRef.current = false;
      setIsCleaningUp(false);
      cleanupPromiseRef.current = null;
    };

    cleanupPromiseRef.current = doCleanup();
    await cleanupPromiseRef.current;
  }, [toast, queryClient]);

  const addWordsDirect = useCallback(async (words: WordEntry[]): Promise<{ added: number; total: number }> => {
    if (words.length === 0) return { added: 0, total: 0 };
    const response = await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words }),
    });
    if (!response.ok) throw new Error("DB追加に失敗しました");
    const data = await response.json();
    queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
    queryClient.invalidateQueries({ queryKey: ["/api/favorites/count"] });
    return data;
  }, [queryClient]);

  useEffect(() => { generateDissSSERef.current = generateDissSSE; }, [generateDissSSE]);
  useEffect(() => { addWordsDirectRef.current = addWordsDirect; }, [addWordsDirect]);
  useEffect(() => { runCleanupRef.current = runCleanup; }, [runCleanup]);

  const startAutoMode = useCallback(async () => {
    if (autoModeRef.current) return;
    autoModeRef.current = true;
    setIsAutoMode(true);
    setAutoModeCount(0);
    setActiveTab("gen");

    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    let emptyStreak = 0;

    try {
      while (autoModeRef.current) {
        // === Step 1: 前回データ完全クリア + ターゲット生成 ===
        setActiveTab("gen");
        setGenResult(null);
        setCheckedWords(new Set());
        setProgressLogs([]);
        setCleanupLogs([]);
        setGenStatus("idle");
        setTimerSeconds(0);
        setIsGenerating(false);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        await delay(500);

        const targetRes = await (await fetch("/api/target")).json();
        setTarget(targetRes.target);
        toast({ title: "Step 1: ターゲット生成", description: `${targetRes.target.name}` });
        await delay(1500);
        if (!autoModeRef.current) break;

        // === Step 2: レベル設定（8〜10ランダム）===
        const randomLvl = 8 + Math.floor(Math.random() * 3);
        setLevel(randomLvl);
        setAgeConfirmed(true);
        toast({ title: "Step 2: レベル設定", description: `Lv.${randomLvl} に設定` });
        await delay(1000);
        if (!autoModeRef.current) break;

        // === Step 3: 生成（完了まで待機）===
        setActiveTab("gen");
        toast({ title: "Step 3: 生成開始", description: `Lv.${randomLvl} で生成中...` });
        if (!generateDissSSERef.current) break;
        const result = await generateDissSSERef.current(targetRes.target, randomLvl);
        if (!autoModeRef.current) break;

        if (!result || result.total === 0) {
          emptyStreak++;
          if (emptyStreak >= 3) {
            toast({ title: "オートモード停止", description: "3回連続で生成結果が空のため停止しました。APIレート制限の可能性があります。", variant: "destructive" });
            break;
          }
          toast({ title: "生成結果なし", description: `ワードが0個でした（${emptyStreak}/3）。10秒後にリトライ...`, variant: "destructive" });
          await delay(10000);
          continue;
        }
        emptyStreak = 0;
        toast({ title: "Step 3: 生成完了", description: `${result.total}個のワードを生成` });
        await delay(2000);
        if (!autoModeRef.current) break;

        // === Step 4: データベースに送信（完了まで待機）===
        setActiveTab("fav");
        await delay(500);
        const allWords = getWordsFromResult(result);
        try {
          if (!addWordsDirectRef.current) break;
          const addResult = await addWordsDirectRef.current(allWords);
          toast({ title: "Step 4: DB追加完了", description: `${addResult.added}個追加（合計 ${addResult.total}個）` });
          setAutoModeCount(prev => prev + 1);
        } catch (err) {
          toast({ title: "Step 4: DB追加エラー", description: err instanceof Error ? err.message : "追加に失敗", variant: "destructive" });
        }
        await delay(2000);
        if (!autoModeRef.current) break;

        // === Step 5: 整理（完了まで待機）===
        toast({ title: "Step 5: 整理開始", description: "データベースの整理を実行中..." });
        if (!runCleanupRef.current) break;
        await runCleanupRef.current();
        toast({ title: "Step 5: 整理完了", description: "整理が完了しました" });
        await delay(2000);
        if (!autoModeRef.current) break;

        // === Step 6: 次のサイクルへ ===
        toast({ title: "Step 6: 次のサイクルへ", description: "5秒後に次のサイクルを開始します..." });
        await delay(5000);
      }
    } catch (err) {
      toast({ title: "オートモードエラー", description: err instanceof Error ? err.message : "エラーが発生しました", variant: "destructive" });
    }

    setIsAutoMode(false);
    autoModeRef.current = false;
  }, [toast]);

  const stopAutoMode = useCallback(() => {
    autoModeRef.current = false;
    toast({ title: "停止中", description: "現在の処理が完了後に停止します" });
  }, [toast]);

  const handleGenerateDiss = useCallback(() => {
    if (!target) { toast({ title: "ターゲット未設定", description: "先にターゲットを選んでください" }); return; }
    if (level >= 8 && !ageConfirmed) { toast({ title: "年齢確認", description: "レベル8以上は年齢確認が必要です", variant: "destructive" }); return; }
    generateDissSSE();
  }, [target, level, ageConfirmed, generateDissSSE, toast]);

  const progressPercent = Math.min((totalCount / 10000) * 100, 100);
  const levelInfo = LEVEL_INFO[level];

  const renderGroupedResults = () => {
    if (!genResult) return null;

    const toggleGroupWords = (words: WordEntry[]) => {
      setCheckedWords(prev => {
        const next = new Set(prev);
        const wordNames = words.map(w => w.word);
        const allChecked = wordNames.every(w => next.has(w));
        wordNames.forEach(w => allChecked ? next.delete(w) : next.add(w));
        return next;
      });
    };

    return (
      <div className="space-y-3" data-testid="gen-results-grouped">
        {VOWEL_PATTERNS.map(pattern => {
          const words = genResult.groups[pattern] || [];
          if (words.length === 0) return null;
          const allChecked = words.every(w => checkedWords.has(w.word));
          return (
            <div key={pattern} className="rounded-lg border border-border/50 bg-muted/10 overflow-hidden" data-testid={`result-group-${pattern}`}>
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border/30">
                <Badge className={`font-mono text-xs px-2 py-0.5 border ${PATTERN_COLORS[pattern]}`}>*{pattern}</Badge>
                <span className="text-xs text-muted-foreground font-medium">{words.length}個</span>
                <button onClick={() => toggleGroupWords(words)} className="text-xs text-primary hover:underline ml-auto" data-testid={`button-toggle-group-${pattern}`}>
                  {allChecked ? "選択解除" : "全選択"}
                </button>
              </div>
              <div className="p-2 flex flex-wrap gap-1.5">
                {words.map((entry, i) => (
                  <motion.div
                    key={`${pattern}-${entry.word}-${i}`}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    onClick={() => toggleChecked(entry.word)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border cursor-pointer select-none transition-all ${
                      checkedWords.has(entry.word) ? "bg-primary/15 border-primary/40 text-foreground" : "bg-card border-border/40 text-muted-foreground hover:border-border"
                    }`}
                    data-testid={`word-chip-${pattern}-${i}`}
                  >
                    <Checkbox checked={checkedWords.has(entry.word)} onCheckedChange={() => toggleChecked(entry.word)} onClick={(e: React.MouseEvent) => e.stopPropagation()} className="w-3.5 h-3.5" data-testid={`checkbox-word-${pattern}-${i}`} />
                    <span className="text-sm font-medium">{entry.word}</span>
                    <span className="text-xs text-muted-foreground">({entry.reading})</span>
                  </motion.div>
                ))}
              </div>
            </div>
          );
        })}

        {genResult.ungrouped.length > 0 && (
          <div className="rounded-lg border border-border/50 bg-muted/10 overflow-hidden" data-testid="result-group-ungrouped">
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border/30">
              <Badge variant="outline" className="font-mono text-xs px-2 py-0.5">未分類</Badge>
              <span className="text-xs text-muted-foreground font-medium">{genResult.ungrouped.length}個</span>
              <button onClick={() => toggleGroupWords(genResult.ungrouped)} className="text-xs text-primary hover:underline ml-auto" data-testid="button-toggle-group-ungrouped">
                {genResult.ungrouped.every(w => checkedWords.has(w.word)) ? "選択解除" : "全選択"}
              </button>
            </div>
            <div className="p-2 flex flex-wrap gap-1.5">
              {genResult.ungrouped.map((entry, i) => (
                <motion.div
                  key={`ungrouped-${entry.word}-${i}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: Math.min(i * 0.02, 0.3) }}
                  onClick={() => toggleChecked(entry.word)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border cursor-pointer select-none transition-all ${
                    checkedWords.has(entry.word) ? "bg-primary/15 border-primary/40 text-foreground" : "bg-card border-border/40 text-muted-foreground hover:border-border"
                  }`}
                  data-testid={`word-chip-ungrouped-${i}`}
                >
                  <Checkbox checked={checkedWords.has(entry.word)} onCheckedChange={() => toggleChecked(entry.word)} onClick={(e: React.MouseEvent) => e.stopPropagation()} className="w-3.5 h-3.5" />
                  <span className="text-sm font-medium">{entry.word}</span>
                  <span className="text-xs text-muted-foreground">({entry.reading})</span>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="relative overflow-hidden border-b border-border/50">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5 dark:from-primary/5 dark:via-transparent dark:to-primary/3" />
        <div className="relative max-w-2xl mx-auto px-4 py-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Mic2 className="w-7 h-7 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-title">悪口データベース</h1>
            <Database className="w-6 h-6 text-primary" />
          </div>
          <p className="text-muted-foreground text-xs mb-3">目標1万ワード！AIでワードを量産してデータベースに蓄積</p>
          <div className="max-w-xs mx-auto mb-3">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">{totalCount.toLocaleString()} / 10,000</span>
              <span className="font-mono text-primary">{progressPercent.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden" data-testid="progress-bar">
              <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          {isAutoMode ? (
            <div className="flex items-center justify-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/20 border border-red-500/40">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs font-medium text-red-400">完全オートモード稼働中</span>
                <Badge variant="secondary" className="text-xs px-1.5 py-0">{autoModeCount}回完了</Badge>
              </div>
              <Button variant="destructive" size="sm" onClick={stopAutoMode} data-testid="button-stop-auto">
                <Square className="w-3.5 h-3.5 mr-1" />停止
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={startAutoMode}
              disabled={isGenerating || isCleaningUp}
              className="border-primary/40 text-primary hover:bg-primary/10"
              data-testid="button-start-auto"
            >
              <Play className="w-3.5 h-3.5 mr-1" />完全オートモード
            </Button>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        <div className="flex rounded-lg overflow-hidden border border-border/60">
          <button onClick={() => setActiveTab("gen")} className={`flex-1 py-2.5 text-sm font-medium transition-colors ${activeTab === "gen" ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted/60"}`} data-testid="tab-gen">
            <Zap className="w-4 h-4 inline mr-1" />生成
          </button>
          <button onClick={() => { setActiveTab("fav"); queryClient.invalidateQueries({ queryKey: ["/api/favorites"] }); }} className={`flex-1 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${activeTab === "fav" ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted/60"}`} data-testid="tab-fav">
            <Star className="w-4 h-4" />DB
            {totalCount > 0 && <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">{totalCount.toLocaleString()}</Badge>}
          </button>
          <button onClick={() => { setActiveTab("ng"); setSelectedNgIds(new Set()); queryClient.invalidateQueries({ queryKey: ["/api/ng-words"] }); }} className={`flex-1 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${activeTab === "ng" ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted/60"}`} data-testid="tab-ng">
            <Ban className="w-4 h-4" />NG単語リスト
            {ngCount > 0 && <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">{ngCount.toLocaleString()}</Badge>}
          </button>
        </div>

        {activeTab === "ng" ? (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Ban className="w-5 h-5 text-destructive" />
                  <h2 className="text-base font-semibold">NG単語リスト</h2>
                  <Badge variant="secondary">{ngCount.toLocaleString()}件</Badge>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={copyNgWords} disabled={ngCount === 0} data-testid="button-copy-ng"><Copy className="w-3.5 h-3.5 mr-1" />コピー</Button>
                  <Button variant="outline" size="sm" onClick={() => clearNgMutation.mutate()} disabled={clearNgMutation.isPending || ngCount === 0} data-testid="button-clear-ng"><Trash2 className="w-3.5 h-3.5 mr-1" />全削除</Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">ワードの末尾がNG単語と一致する場合、生成・追加されません。整理や精査で検出された末尾単語が自動追加されます。</p>

              {selectedNgIds.size > 0 && (
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                  <span className="text-sm font-medium">{selectedNgIds.size}個選択中</span>
                  <div className="flex gap-1.5 ml-auto">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedNgIds(new Set())} data-testid="button-deselect-ng"><X className="w-3.5 h-3.5 mr-1" />解除</Button>
                    <Button variant="destructive" size="sm" onClick={deleteSelectedNg} disabled={batchDeleteNgMutation.isPending} data-testid="button-delete-selected-ng">
                      {batchDeleteNgMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
                      削除
                    </Button>
                  </div>
                </motion.div>
              )}

              <div className="space-y-2">
                <Textarea placeholder="NG単語を入力（改行・カンマ区切り）&#10;例: 野郎、顔、存在" value={pasteTextNg} onChange={e => setPasteTextNg(e.target.value)} className="text-xs min-h-[60px]" data-testid="textarea-paste-ng" />
                <Button variant="outline" size="sm" onClick={() => pasteNgMutation.mutate(pasteTextNg)} disabled={!pasteTextNg.trim() || pasteNgMutation.isPending} data-testid="button-paste-ng">
                  {pasteNgMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
                  追加
                </Button>
              </div>

              {ngWordsQuery.isLoading ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-md" />)}</div>
              ) : !ngWordsQuery.data || ngWordsQuery.data.words.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-empty-ng">NG単語はまだありません。</div>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-96 overflow-y-auto" data-testid="ng-words-container">
                  {ngWordsQuery.data.words.map(w => (
                    <button key={w.id} onClick={() => toggleNgSelection(w.id)}
                      className={`inline-flex items-center gap-1 text-xs rounded px-2 py-1 cursor-pointer transition-all ${selectedNgIds.has(w.id) ? "bg-primary text-primary-foreground border border-primary ring-2 ring-primary/30" : "bg-destructive/10 border border-destructive/20 hover:bg-destructive/20"}`}
                      data-testid={`ng-word-${w.id}`}>
                      <span className="font-medium">{w.word}</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : activeTab === "fav" ? (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-primary" />
                  <h2 className="text-base font-semibold">悪口データベース</h2>
                  <Badge variant="secondary">{totalCount.toLocaleString()}件</Badge>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={runScrutiny} disabled={isScrutinizing || isCleaningUp || totalCount === 0} data-testid="button-scrutinize-favorites">
                    {isScrutinizing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Search className="w-3.5 h-3.5 mr-1" />}
                    精査
                  </Button>
                  <Button variant="outline" size="sm" onClick={runCleanup} disabled={isCleaningUp || isScrutinizing || totalCount === 0} data-testid="button-cleanup-favorites">
                    {isCleaningUp ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Wrench className="w-3.5 h-3.5 mr-1" />}
                    整理
                  </Button>
                  <Button variant="outline" size="sm" onClick={copyFavorites} data-testid="button-copy-favorites"><Copy className="w-3.5 h-3.5 mr-1" />エクスポート</Button>
                  <Button variant="outline" size="sm" onClick={() => clearFavMutation.mutate()} disabled={clearFavMutation.isPending} data-testid="button-clear-favorites"><Trash2 className="w-3.5 h-3.5 mr-1" />全削除</Button>
                </div>
              </div>

              {selectedFavIds.size > 0 && (
                <div className="flex items-center gap-2 p-2 rounded-md bg-primary/10 border border-primary/30" data-testid="fav-selection-bar">
                  <Badge variant="default" className="text-xs">{selectedFavIds.size}件選択中</Badge>
                  <Button variant="outline" size="sm" onClick={copySelectedFavs} data-testid="button-copy-selected"><Copy className="w-3.5 h-3.5 mr-1" />コピー</Button>
                  <Button variant="destructive" size="sm" onClick={deleteSelectedFavs} disabled={batchDeleteFavMutation.isPending} data-testid="button-delete-selected">
                    {batchDeleteFavMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
                    削除
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedFavIds(new Set())} data-testid="button-clear-selection"><X className="w-3.5 h-3.5 mr-1" />選択解除</Button>
                </div>
              )}

              <div className="space-y-2">
                <Textarea placeholder="ワードを貼り付けて追加（形式: ワード/ひらがな(romaji) 改行区切り）" value={pasteTextFav} onChange={e => setPasteTextFav(e.target.value)} className="text-xs min-h-[60px]" data-testid="textarea-paste-fav" />
                <Button variant="outline" size="sm" onClick={() => pasteFavMutation.mutate(pasteTextFav)} disabled={!pasteTextFav.trim() || pasteFavMutation.isPending} data-testid="button-paste-fav">
                  {pasteFavMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
                  貼り付けて追加
                </Button>
              </div>

              {scrutinyLogs.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1" data-testid="scrutiny-logs">
                  <div className="flex items-center gap-2 mb-1">
                    <Search className="w-4 h-4 text-amber-500" />
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">精査ログ</span>
                    {!isScrutinizing && <Button variant="ghost" size="sm" className="h-5 px-1 text-xs" onClick={() => setScrutinyLogs([])}><X className="w-3 h-3" /></Button>}
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-0.5">
                    {scrutinyLogs.map((log, i) => (
                      <div key={i} className="text-xs flex gap-2">
                        <span className="text-muted-foreground font-mono shrink-0">[{log.elapsed}]</span>
                        <span>{log.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {cleanupLogs.length > 0 && (
                <div className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-1" data-testid="cleanup-logs">
                  <div className="flex items-center gap-2 mb-1">
                    <Wrench className="w-4 h-4 text-primary" />
                    <span className="text-xs font-semibold">整理ログ</span>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-0.5">
                    {cleanupLogs.map((log, i) => (
                      <div key={i} className="text-xs flex gap-2">
                        <span className="text-muted-foreground font-mono shrink-0">[{log.elapsed}]</span>
                        <span className="text-muted-foreground shrink-0">{log.time}</span>
                        <span>{log.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {favQuery.isLoading ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-md" />)}</div>
              ) : !favQuery.data || favQuery.data.groups.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-empty-favorites">データベースは空です。生成タブでワードを生成して追加してください。</div>
              ) : (
                <div className="space-y-3" data-testid="favorites-container">
                  {favQuery.data.groups.map(group => {
                    const totalInGroup = group.words.length + (group.hardRhymes?.reduce((s, h) => s + h.words.length, 0) || 0);
                    const tierConfig = {
                      legendary: { label: "伝説級硬い韻", border: "border-yellow-500/50", bg: "bg-yellow-500/10", badge: "border-yellow-500/60 text-yellow-600 dark:text-yellow-400", wordBg: "bg-yellow-500/15 border-yellow-500/30" },
                      super: { label: "超硬い韻", border: "border-orange-500/40", bg: "bg-orange-500/8", badge: "border-orange-500/50 text-orange-600 dark:text-orange-400", wordBg: "bg-orange-500/12 border-orange-500/25" },
                      hard: { label: "固い韻", border: "border-primary/30", bg: "bg-primary/5", badge: "border-primary/40 text-primary", wordBg: "bg-primary/10 border-primary/20" },
                    };
                    return (
                    <div key={group.vowels} className="rounded-md border border-border/50 bg-muted/10 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="default" className="text-xs font-mono">[{group.vowels}]</Badge>
                        <span className="text-xs text-muted-foreground">{totalInGroup}個</span>
                      </div>
                      {group.hardRhymes && group.hardRhymes.length > 0 && (
                        <div className="space-y-2 mb-2">
                          {group.hardRhymes.map(hr => {
                            const tc = tierConfig[hr.tier];
                            return (
                            <div key={hr.suffix} className={`rounded border ${tc.border} ${tc.bg} p-2`} data-testid={`rhyme-${hr.tier}-${hr.suffix}`}>
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <Badge variant="outline" className={`text-[10px] font-mono ${tc.badge}`}>{tc.label} *{hr.suffix}</Badge>
                                <span className="text-[10px] text-muted-foreground">{hr.words.length}個</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {hr.words.map(w => (
                                  <button key={w.id} onClick={() => toggleFavSelection(w.id)}
                                    className={`inline-flex items-center gap-1 text-xs rounded px-2 py-1 cursor-pointer transition-all ${selectedFavIds.has(w.id) ? "bg-primary text-primary-foreground border border-primary ring-2 ring-primary/30" : `${tc.wordBg} hover:opacity-80`}`}
                                    data-testid={`fav-word-${w.id}`}>
                                    <span className="font-medium">{w.word}</span>
                                    <span className={selectedFavIds.has(w.id) ? "opacity-70" : "text-muted-foreground"}>({w.reading})</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      )}
                      {group.words.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {group.words.map(w => (
                            <button key={w.id} onClick={() => toggleFavSelection(w.id)}
                              className={`inline-flex items-center gap-1 text-xs rounded px-2 py-1 cursor-pointer transition-all ${selectedFavIds.has(w.id) ? "bg-primary text-primary-foreground border border-primary ring-2 ring-primary/30" : "bg-card border border-border/50 hover:bg-muted/50"}`}
                              data-testid={`fav-word-${w.id}`}>
                              <span className="font-medium">{w.word}</span>
                              <span className={selectedFavIds.has(w.id) ? "opacity-70" : "text-muted-foreground"}>({w.reading})</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
        <>
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-5 h-5 text-primary" />
              <h2 className="text-base font-semibold">ターゲット設定</h2>
            </div>
            <Button onClick={() => targetMutation.mutate()} disabled={targetMutation.isPending || isAutoMode} size="sm" data-testid="button-generate-target">
              {targetMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
              {target ? "やり直し" : "ターゲットを選ぶ"}
            </Button>
            <AnimatePresence mode="wait">
              {target ? (
                <motion.div key="target" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-md bg-muted/50 dark:bg-muted/30 px-3 py-2 border border-border/50">
                  <div className="text-sm whitespace-pre-line leading-relaxed" data-testid="text-target">{target}</div>
                </motion.div>
              ) : (
                <p className="text-xs text-muted-foreground italic">ボタンを押してターゲットを選ぶ</p>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {level <= 3 ? <Heart className="w-5 h-5 text-blue-400" /> : <Flame className="w-5 h-5 text-primary" />}
                <h2 className="text-base font-semibold">レベル</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xl font-bold font-mono ${levelInfo.color}`} data-testid="text-level-number">{level}</span>
                <span className="text-xs text-muted-foreground">/10</span>
                <Badge variant="secondary" className={`text-xs ${levelInfo.color}`} data-testid="text-level-label">{levelInfo.label}</Badge>
              </div>
            </div>
            <Slider value={[level]} min={1} max={10} step={1} onValueChange={val => setLevel(val[0])} disabled={isAutoMode} data-testid="slider-level" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Heart className="w-3 h-3 text-blue-400" />
                <span>リスペクト</span>
              </div>
              <div className="flex gap-0.5">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className={`w-2 h-3 rounded-sm transition-colors ${i < level ? (LEVEL_BAR_COLORS[i + 1] || "bg-muted") : "bg-muted"}`} />
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>ディスり</span>
                <Flame className="w-3 h-3 text-red-500" />
              </div>
            </div>
            <AnimatePresence>
              {level >= 8 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-2.5">
                    <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={ageConfirmed} onCheckedChange={v => setAgeConfirmed(!!v)} disabled={isAutoMode} data-testid="checkbox-age-confirm" />
                      <span className="text-xs">18歳以上・過激な表現を許可</span>
                    </label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="rounded-md bg-muted/30 border border-border/50 p-2.5 text-xs text-muted-foreground">
              <div className="font-medium mb-1">3ステップ生成:</div>
              <div>STEP1: ディスワード300個を一括生成（6並列×50個）</div>
              <div>STEP2: 品質フィルタ（子供でもわかるか？リリックとして成立するか？）</div>
              <div>STEP3: 母音パターン別にグルーピング（ae/oe/ua/an/ao/iu）</div>
            </div>

            <Button onClick={handleGenerateDiss} disabled={isGenerating || !target || isAutoMode} className="w-full" data-testid="button-generate-diss">
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
              生成 (Lv.{level} {levelInfo.label})
            </Button>
          </CardContent>
        </Card>

        <AnimatePresence>
          {(isGenerating || progressLogs.length > 0) && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <ScrollText className="w-5 h-5 text-primary" />
                    <h2 className="text-base font-semibold">進捗ログ</h2>
                    {isGenerating && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                    {isAutoMode && <Badge variant="secondary" className="text-xs">オート {autoModeCount}回完了</Badge>}
                    <div className="ml-auto flex items-center gap-2">
                      <span className={`text-lg font-bold font-mono tabular-nums ${genStatus === "success" ? "text-green-400" : genStatus === "error" ? "text-red-400" : "text-yellow-400"}`} data-testid="text-timer">
                        {formatTimer(timerSeconds)}
                      </span>
                      {genStatus === "success" && <span className="text-xs text-green-400">完了</span>}
                      {genStatus === "error" && <span className="text-xs text-red-400">失敗</span>}
                    </div>
                  </div>
                  <div className="bg-black/80 rounded-md border border-border/50 p-3 font-mono text-xs max-h-48 overflow-y-auto" data-testid="progress-log-area">
                    {progressLogs.map((log, i) => (
                      <div key={i} className="flex gap-2 py-0.5">
                        <span className="text-muted-foreground shrink-0">[{log.time}]</span>
                        <span className="text-green-400 shrink-0">{log.elapsed && `(${log.elapsed})`}</span>
                        <span className="text-foreground flex-1">{log.detail}</span>
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {hasResults && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <div className="flex items-center gap-2">
                      <Zap className="w-5 h-5 text-primary" />
                      <h2 className="text-base font-semibold">生成結果</h2>
                      <Badge variant="secondary" className="text-xs">{genResult?.total || 0}個</Badge>
                    </div>
                    {getAllEntries().length > 0 && !isAutoMode && (
                      <Button variant="ghost" size="sm" onClick={isAllSelected ? deselectAll : selectAll} data-testid="button-select-all">
                        {isAllSelected ? <><Square className="w-4 h-4 mr-1" />全解除</> : <><CheckSquare className="w-4 h-4 mr-1" />全て選択</>}
                      </Button>
                    )}
                  </div>

                  {genResult && (
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {VOWEL_PATTERNS.map(p => {
                        const count = (genResult.groups[p] || []).length;
                        return (
                          <div key={p} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border ${PATTERN_COLORS[p]}`}>
                            <span className="font-mono font-bold">*{p}</span>
                            <span>{count}</span>
                          </div>
                        );
                      })}
                      {genResult.ungrouped.length > 0 && (
                        <div className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border/50 text-muted-foreground">
                          <span className="font-mono">未分類</span>
                          <span>{genResult.ungrouped.length}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {renderGroupedResults()}

                  {!isAutoMode && (
                    <div className="mt-4">
                      <Button onClick={addToFavorites} disabled={checkedWords.size === 0 || addFavMutation.isPending} variant="destructive" className="w-full" data-testid="button-add-favorites">
                        {addFavMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Star className="w-4 h-4 mr-2" />}
                        選択ワードをデータベースに追加 {checkedWords.size > 0 && `(${checkedWords.size}個)`}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
        </>
        )}
      </div>

      <footer className="text-center py-4 text-xs text-muted-foreground">Powered by Gemini AI</footer>
    </div>
  );
}
