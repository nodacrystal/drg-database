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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Flame, Mic2, Sparkles, Zap, AlertTriangle, Loader2, Star,
  Copy, Trash2, CheckSquare, Square, Database, Target, X, Ban, ScrollText, Plus, Play, Filter, Download, Upload, FileText, FileJson, Layers, BarChart3, Search,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { WordEntry, FavWord, FavGroup, NgWord, ProgressLog, GenerationResult, RhymeFilter } from "@/types";
import { VOWEL_PATTERNS, PATTERN_COLORS, LEVEL_INFO, LEVEL_BAR_COLORS } from "@/lib/constants";
import { extractVowels, getRomajiHighlightIndex, formatTimer, getWordsFromResult } from "@/lib/utils";

export default function Home() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [target, setTarget] = useState("");
  const [level, setLevel] = useState(3);
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
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [autoModeCount, setAutoModeCount] = useState(0);
  const [selectedFavIds, setSelectedFavIds] = useState<Set<number>>(new Set());
  const [selectedNgIds, setSelectedNgIds] = useState<Set<number>>(new Set());
  const [lastGenTime, setLastGenTime] = useState<number | null>(null);
  const [prevGenTime, setPrevGenTime] = useState<number | null>(null);
  const [rhymeFilter, setRhymeFilter] = useState<RhymeFilter>("all");
  const [tail2Filter, setTail2Filter] = useState<string>("all");
  const autoModeRef = useRef(false);
  const generateDissSSERef = useRef<typeof generateDissSSE | null>(null);
  const addWordsDirectRef = useRef<typeof addWordsDirect | null>(null);
  const runCleanupSSERef = useRef<typeof runCleanupSSE | null>(null);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const ngJsonInputRef = useRef<HTMLInputElement>(null);
  const [isCleanupRunning, setIsCleanupRunning] = useState(false);
  const [cleanupLogs, setCleanupLogs] = useState<ProgressLog[]>([]);
  const [cleanupDone, setCleanupDone] = useState(false);
  const cleanupLogEndRef = useRef<HTMLDivElement>(null);
  const [isAnalyzingEndings, setIsAnalyzingEndings] = useState(false);
  const [endingAnalysisLog, setEndingAnalysisLog] = useState("");
  const [endingRankings, setEndingRankings] = useState<{ word: string; count: number }[] | null>(null);

  useEffect(() => { if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: "smooth" }); }, [progressLogs]);
  useEffect(() => { if (cleanupLogEndRef.current) cleanupLogEndRef.current.scrollIntoView({ behavior: "smooth" }); }, [cleanupLogs]);
  useEffect(() => { return () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }; }, []);

  // 処理中のページ離脱・リロードを防止
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isCleanupRunning || isGenerating || isAutoMode) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isCleanupRunning, isGenerating, isAutoMode]);

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
              if (data.elapsedMs) {
                setLastGenTime(prev => { setPrevGenTime(prev); return data.elapsedMs; });
              }
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
    // フィルタなし → 全データをAPI経由でエクスポート
    if (tail2Filter === "all" && rhymeFilter === "all") {
      try {
        const res = await fetch("/api/favorites/export");
        await navigator.clipboard.writeText(await res.text());
        toast({ title: "コピー完了", description: "全データをクリップボードにコピーしました" });
      } catch { toast({ title: "エラー", description: "コピーに失敗しました", variant: "destructive" }); }
      return;
    }
    // フィルタあり → 表示中の語のみコピー
    const groups = favQuery.data?.groups || [];
    const words: string[] = [];
    for (const group of groups) {
      const grpTail2 = group.vowels.replace(/^\*/, "").slice(-2);
      if (tail2Filter !== "all" && grpTail2 !== tail2Filter) continue;
      if (rhymeFilter === "all") {
        for (const hr of (group.hardRhymes || [])) words.push(...hr.words.map(w => w.word));
        words.push(...group.words.map(w => w.word));
      } else {
        for (const hr of (group.hardRhymes || [])) {
          if (hr.tier === rhymeFilter) words.push(...hr.words.map(w => w.word));
        }
      }
    }
    try {
      await navigator.clipboard.writeText(words.join("\n"));
      toast({ title: "コピー完了", description: `${words.length}語をコピーしました` });
    } catch { toast({ title: "エラー", description: "コピーに失敗しました", variant: "destructive" }); }
  }, [tail2Filter, rhymeFilter, favQuery.data, toast]);

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


  const readSSEStream = useCallback(async (
    url: string,
    onProgress: (data: Record<string, unknown>) => void,
    onResult: (data: Record<string, unknown>) => void,
    onError: (data: Record<string, unknown>) => void,
  ) => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" } });
    if (!response.ok) throw new Error(`${url} failed`);
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
          const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
          if (data.type === "progress") onProgress(data);
          else if (data.type === "result") onResult(data);
          else if (data.type === "error") onError(data);
        } catch {}
      }
    }
  }, []);



  const handlePdfExport = useCallback(async () => {
    setIsPdfExporting(true);
    try {
      const res = await fetch("/api/favorites/export-pdf");
      if (!res.ok) throw new Error("PDF export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `drg-database-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "PDF保存完了", description: "データベースをPDFに保存しました" });
    } catch {
      toast({ title: "エラー", description: "PDF保存に失敗しました", variant: "destructive" });
    }
    setIsPdfExporting(false);
  }, [toast]);

  const handlePdfImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await fetch("/api/favorites/import-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "PDF読込に失敗しました");
      }
      const data = await res.json();
      toast({ title: "PDF読込完了", description: `${data.added}個のワードを追加しました（合計 ${data.total}個）` });
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/favorites/count"] });
    } catch (err) {
      toast({ title: "エラー", description: err instanceof Error ? err.message : "PDF読込に失敗しました", variant: "destructive" });
    }
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  }, [toast, queryClient]);

  const runCleanupSSE = useCallback(async (endpoint: string, label: string) => {
    if (isCleanupRunning) return;
    setIsCleanupRunning(true);
    setCleanupDone(false);
    setCleanupLogs([]);
    const addLog = (detail: string, elapsed = "") => {
      const now = new Date();
      const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
      setCleanupLogs(prev => [...prev, { time, detail, elapsed }]);
    };
    addLog(`${label}開始...`);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      if (!response.ok) throw new Error("リクエストに失敗しました");
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
            if (data.type === "progress" || data.type === "done") {
              addLog(data.detail || "", data.elapsed || "");
            } else if (data.type === "result") {
              const del = data.deleted ?? 0;
              const tot = data.total ?? data.remaining ?? 0;
              addLog(`✅ 完了: ${del}件削除 → 残り${tot}語`, "");
              queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
              queryClient.invalidateQueries({ queryKey: ["/api/favorites/count"] });
            } else if (data.type === "error") {
              addLog(`❌ エラー: ${data.error || data.detail || "失敗"}`, "");
            }
          } catch {}
        }
      }
    } catch (err) {
      addLog(`❌ エラー: ${err instanceof Error ? err.message : "失敗"}`, "");
    } finally {
      setIsCleanupRunning(false);
      setCleanupDone(true);
    }
  }, [isCleanupRunning, queryClient]);

  const runEndingAnalysis = useCallback(async () => {
    if (isAnalyzingEndings) return;
    setIsAnalyzingEndings(true);
    setEndingRankings(null);
    setEndingAnalysisLog("分析開始...");
    try {
      const response = await fetch("/api/favorites/analyze-endings", { method: "POST" });
      if (!response.ok) throw new Error("リクエストに失敗しました");
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
            if (data.type === "progress") setEndingAnalysisLog(data.detail || "");
            else if (data.type === "result") {
              setEndingRankings(data.rankings as { word: string; count: number }[]);
              setEndingAnalysisLog(`✅ ${data.total}語を分析完了`);
            } else if (data.type === "error") {
              setEndingAnalysisLog(`❌ エラー: ${data.error || "失敗"}`);
            }
          } catch {}
        }
      }
    } catch (err) {
      setEndingAnalysisLog(`❌ エラー: ${err instanceof Error ? err.message : "失敗"}`);
    } finally {
      setIsAnalyzingEndings(false);
    }
  }, [isAnalyzingEndings]);

  const handleNgJsonExport = useCallback(async () => {
    try {
      const res = await fetch("/api/ng-words/export-json");
      if (!res.ok) throw new Error("JSON export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ng-words-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "JSON保存完了", description: "NG単語をJSONに保存しました" });
    } catch {
      toast({ title: "エラー", description: "JSON保存に失敗しました", variant: "destructive" });
    }
  }, [toast]);

  const handleNgJsonImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const jsonData = JSON.parse(text);
      const words = jsonData.words || jsonData;
      if (!Array.isArray(words)) throw new Error("Invalid JSON format");
      const res = await fetch("/api/ng-words/import-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "JSON読込に失敗しました");
      }
      const data = await res.json();
      toast({ title: "JSON読込完了", description: `${data.added}個のNG単語を追加しました（合計 ${data.total}個）` });
      queryClient.invalidateQueries({ queryKey: ["/api/ng-words"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ng-words/count"] });
    } catch (err) {
      toast({ title: "エラー", description: err instanceof Error ? err.message : "JSON読込に失敗しました", variant: "destructive" });
    }
    if (ngJsonInputRef.current) ngJsonInputRef.current.value = "";
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
  useEffect(() => { runCleanupSSERef.current = runCleanupSSE; }, [runCleanupSSE]);

  const startAutoMode = useCallback(async () => {
    if (autoModeRef.current) return;
    autoModeRef.current = true;
    setIsAutoMode(true);
    setAutoModeCount(0);
    setActiveTab("gen");

    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    let emptyStreak = 0;
    let cycleCounter = 0;

    try {
      while (autoModeRef.current) {
        // === (1) ターゲット生成 ===
        setActiveTab("gen");
        setGenResult(null);
        setCheckedWords(new Set());
        setProgressLogs([]);
        setGenStatus("idle");
        setTimerSeconds(0);
        setIsGenerating(false);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        await delay(500);

        const targetRes = await (await fetch("/api/target")).json();
        setTarget(targetRes.target);
        toast({ title: "(1) ターゲット生成", description: `${targetRes.target.name || targetRes.target}` });
        await delay(1000);
        if (!autoModeRef.current) break;

        // === (2) レベル1〜5ランダム ===
        const randomLvl = 1 + Math.floor(Math.random() * 5);
        setLevel(randomLvl);
        setAgeConfirmed(true);
        toast({ title: "(2) レベル設定", description: `Lv.${randomLvl} ${LEVEL_INFO[randomLvl].label}` });
        await delay(500);
        if (!autoModeRef.current) break;

        // === (3) 生成（完了まで待機）===
        toast({ title: "(3) 生成開始", description: `Lv.${randomLvl} で生成中...` });
        if (!generateDissSSERef.current) break;
        const result = await generateDissSSERef.current(targetRes.target, randomLvl);
        if (!autoModeRef.current) break;

        if (!result || result.total === 0) {
          emptyStreak++;
          if (emptyStreak >= 3) {
            toast({ title: "オートモード停止", description: "3回連続で生成結果が空のため停止しました", variant: "destructive" });
            break;
          }
          toast({ title: "生成結果なし", description: `ワードが0個（${emptyStreak}/3）。10秒後にリトライ...`, variant: "destructive" });
          await delay(10000);
          continue;
        }
        emptyStreak = 0;

        // === (4) データベースへ送信 ===
        const allWords = getWordsFromResult(result);
        let addTotal = 0;
        try {
          if (!addWordsDirectRef.current) break;
          const addResult = await addWordsDirectRef.current(allWords);
          addTotal = addResult.total;
          toast({ title: "(4) DB送信完了", description: `${addResult.added}個追加（合計 ${addResult.total}個）` });
        } catch (err) {
          toast({ title: "(4) DB送信エラー", description: err instanceof Error ? err.message : "追加に失敗", variant: "destructive" });
        }
        await delay(1000);
        if (!autoModeRef.current) break;

        // === (4b) 1万語超えたら全て整理して中断 ===
        if (addTotal >= 10000) {
          toast({ title: "🎯 1万語達成！", description: "全て整理を開始します。オートモードを停止します。" });
          autoModeRef.current = false;
          setActiveTab("fav");
          await delay(1500);
          if (runCleanupSSERef.current) {
            await runCleanupSSERef.current("/api/favorites/cleanup", "全て整理");
          }
          break;
        }

        // === (5) カウンター+1 → そのまま次のサイクルへ ===
        cycleCounter++;
        setAutoModeCount(prev => prev + 1);
        toast({ title: `サイクル${cycleCounter}完了`, description: `残り${10000 - addTotal}語で1万語達成` });
        await delay(1000);
        if (!autoModeRef.current) break;
      }
    } catch (err) {
      console.error("Auto mode error:", err);
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
    if (level >= 3 && !ageConfirmed) { toast({ title: "年齢確認", description: "レベル3以上は年齢確認が必要です", variant: "destructive" }); return; }
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
          <div className="flex items-center justify-center gap-2 mb-3">
            <Mic2 className="w-7 h-7 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-title">DRGデータベース</h1>
            <Database className="w-6 h-6 text-primary" />
          </div>

          {isAutoMode && (
            <div className="max-w-xs mx-auto mb-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">{totalCount.toLocaleString()} / 10,000</span>
                <span className="font-mono text-primary">{progressPercent.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden" data-testid="progress-bar">
                <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          )}

          {isAutoMode ? (
            <div className="flex items-center justify-center gap-3">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/20 border border-red-500/40">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-semibold text-red-400">オートモード稼働中</span>
                <Badge variant="secondary" className="text-sm px-2 py-0.5">{autoModeCount}回完了</Badge>
              </div>
              <Button variant="destructive" size="default" onClick={stopAutoMode} className="text-base px-5 py-2" data-testid="button-stop-auto">
                <Square className="w-4 h-4 mr-1.5" />停止
              </Button>
            </div>
          ) : (
            <Button
              variant="default"
              size="lg"
              onClick={startAutoMode}
              disabled={isGenerating}
              className="text-base px-8 py-3 font-semibold shadow-lg hover:shadow-xl transition-shadow"
              data-testid="button-start-auto"
            >
              <Play className="w-5 h-5 mr-2" />オートモード
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
            <ScrollText className="w-4 h-4" />ルール
            {ngCount > 0 && <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">{ngCount.toLocaleString()}</Badge>}
          </button>
        </div>

        {activeTab === "ng" ? (
          <div className="space-y-4">
            {/* NG単語リスト */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Ban className="w-5 h-5 text-destructive" />
                    <h2 className="text-base font-semibold">NG単語リスト</h2>
                    <Badge variant="secondary">{ngCount.toLocaleString()}件</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="outline" size="sm" onClick={copyNgWords} disabled={ngCount === 0} data-testid="button-copy-ng"><Copy className="w-3.5 h-3.5 mr-1" />コピー</Button>
                    <Button variant="outline" size="sm" onClick={handleNgJsonExport} disabled={ngCount === 0} data-testid="button-ng-export-json"><FileJson className="w-3.5 h-3.5 mr-1" />JSON保存</Button>
                    <Button variant="outline" size="sm" onClick={() => ngJsonInputRef.current?.click()} data-testid="button-ng-import-json"><Upload className="w-3.5 h-3.5 mr-1" />JSON読込</Button>
                    <input ref={ngJsonInputRef} type="file" accept=".json" className="hidden" onChange={handleNgJsonImport} />
                    <Button variant="outline" size="sm" onClick={() => clearNgMutation.mutate()} disabled={clearNgMutation.isPending || ngCount === 0} data-testid="button-clear-ng"><Trash2 className="w-3.5 h-3.5 mr-1" />全削除</Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">ワードの末尾がNG単語と一致する場合、生成・追加されません。手動で管理してください。</p>

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
                  <Textarea placeholder="NG単語を入力（改行・「、」・カンマ区切りで複数入力可）&#10;例: 野郎、顔、存在" value={pasteTextNg} onChange={e => setPasteTextNg(e.target.value)} className="text-xs min-h-[60px]" data-testid="textarea-paste-ng" />
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
                    {[...ngWordsQuery.data.words]
                      .sort((a, b) => {
                        const lenA = [...a.word].length;
                        const lenB = [...b.word].length;
                        if (lenA !== lenB) return lenA - lenB;
                        return a.word.localeCompare(b.word, "ja");
                      })
                      .map(w => (
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

            {/* 生成のルール */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-primary" />
                  <h2 className="text-base font-semibold">生成のルール</h2>
                </div>
                <p className="text-xs text-muted-foreground">AIへの生成プロンプトに含まれる絶対ルール（原文そのまま）</p>
                <pre className="text-xs bg-muted/50 border border-border rounded-lg p-3 whitespace-pre-wrap leading-relaxed font-sans overflow-x-auto">{`3：生成

【絶対ルール】
- 1ワード10文字以内、4文字以上（ひらがな換算）
- 【難しい言葉禁止】小学生でも即座に理解できる言葉のみ使用。漢語・専門用語・難読語は絶対禁止
- 【辛辣必須】どのワードも相手の急所を突く辛辣さを持つこと。当たり障りのない表現は削除せよ
- 【挑発性必須】相手が読んで苛立つ・カチンとくるような挑発的な言葉を選べ
- 【リズム重視】声に出したとき音のリズムが良いこと（語呂が悪いものは削除せよ）
- 同じ助詞・助動詞で終わるワードを重複させるな（例：〜だろ、〜だろ は禁止）
- 関西弁・方言語尾は絶対禁止（やな/やわ/やろ/やで/やん/ねん/やんか/やんな/わな/じゃな/じゃろ/っちゃ等）→ 標準語のみ使用
- 【体言止め必須】各ワードは必ず名詞・名詞句で終わらせること。助詞（〜な/〜だ/〜わ/〜よ/〜ね）、助動詞（〜てる/〜てた/〜です/〜ます）、形容詞語尾（〜い）、動詞活用形（〜する/〜いる）で終わるワードは絶対禁止
- ターゲット「{ターゲット名}」に特化した内容
- 造語OK（ただし意味が通じること）
- 各バッチに固有の攻撃角度を割り当て（外見・知能・性格・社会性・仕事・衛生・精神・存在価値・発言・行動・お金・ファッション等）
- バッチ間で同じ名詞・単語を使用するな（累積除外リストで管理）
- 放送禁止用語・差別用語・商標名（IP）は削除せよ
- 生成後、全ルールを自己チェックし違反ワードを削除せよ

【レベルシステム（5段階）】
- Lv.1 毒舌: 有吉弘行レベルの毒舌。的確で鋭いが笑える毒。
- Lv.2 辛辣: 痛い所を突く辛辣な言葉。笑いより痛さが勝る。
- Lv.3 過激: 人格否定レベルの攻撃。下品な表現も可。【年齢確認必要】
- Lv.4 暴言: 限界を超えた暴言。社会的に許されないレベルの罵倒。【年齢確認必要】
- Lv.5 禁忌🔞: 性的・差別的・思想的攻撃を含む全制限撤廃。【18禁・年齢確認必要】

【末尾禁止単語】以下の単語で終わるワードは生成禁止: {NG単語リスト}（実行時に動的挿入）`}</pre>
              </CardContent>
            </Card>

            {/* 重複ルール */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Filter className="w-5 h-5 text-primary" />
                  <h2 className="text-base font-semibold">重複ルール</h2>
                </div>
                <pre className="text-xs bg-muted/50 border border-border rounded-lg p-3 whitespace-pre-wrap leading-relaxed font-sans overflow-x-auto">{`【重複ルール】
・「母音」の一致箇所に含まれている「単語」は異なる意味や役割を持つこと。
・例え「漢字」「ひらがな」「カタカナ」など文字が違くても母音・子音が一致しており「役割・意味」が全く同じ場合、それは「同じ言葉」であり「韻」を踏んだことにはならない。
・同じ言葉がグループ内に存在した場合は「より強烈なパンチライン」である方を残し、それ以外はグループから外すこと。`}</pre>
              </CardContent>
            </Card>

            {/* データベース送信ルール */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-primary" />
                  <h2 className="text-base font-semibold">データベース送信ルール</h2>
                </div>
                <pre className="text-xs bg-muted/50 border border-border rounded-lg p-3 whitespace-pre-wrap leading-relaxed font-sans overflow-x-auto">{`300個の生成されたワードを送信する際に以下の項目を確認せよ。
・「ん」以外の全ての文字に母音が含まれているか？
・アルファベット表記が正しいか？
・「ん」の「n」は母音扱いである。`}</pre>
              </CardContent>
            </Card>

            {/* グループ分けルール */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-primary" />
                  <h2 className="text-base font-semibold">グループ分けルール</h2>
                </div>
                <pre className="text-xs bg-muted/50 border border-border rounded-lg p-3 whitespace-pre-wrap leading-relaxed font-sans overflow-x-auto">{`300個のワードをデータベース内のグループに分けていく際に以下のルールを守ること。
「母音」の一致箇所に含まれている「単語」がグループ内に存在する「一致箇所に含まれている単語」と異なる意味や役割を持つこと。すでにグループに「同じ役割や同じ意味を持つ単語」が存在した場合はそのグループには入れない。`}</pre>
              </CardContent>
            </Card>
          </div>
        ) : activeTab === "fav" ? (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-primary" />
                  <h2 className="text-base font-semibold">DRGデータベース</h2>
                  <Badge variant="secondary">{totalCount.toLocaleString()}件</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="outline" size="sm" onClick={copyFavorites} data-testid="button-copy-favorites"><Copy className="w-3.5 h-3.5 mr-1" />エクスポート</Button>
                  <Button variant="outline" size="sm" onClick={handlePdfExport} disabled={isPdfExporting || totalCount === 0} data-testid="button-pdf-export">
                    {isPdfExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <FileText className="w-3.5 h-3.5 mr-1" />}
                    PDF保存
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => pdfInputRef.current?.click()} data-testid="button-pdf-import">
                    <Upload className="w-3.5 h-3.5 mr-1" />PDF読込
                  </Button>
                  <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfImport} />
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm" disabled={clearFavMutation.isPending || totalCount === 0} data-testid="button-clear-favorites">
                        {clearFavMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
                        全削除
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>データベースを全削除しますか？</AlertDialogTitle>
                        <AlertDialogDescription>
                          現在の{totalCount.toLocaleString()}件のワードが全て削除されます。この操作は取り消せません。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>キャンセル</AlertDialogCancel>
                        <AlertDialogAction onClick={() => clearFavMutation.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          削除する
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" onClick={() => runCleanupSSE("/api/favorites/char-check", "文字整理")} disabled={isCleanupRunning || totalCount === 0} data-testid="button-char-check">
                  {isCleanupRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                  文字整理
                </Button>
                <Button variant="outline" size="sm" onClick={() => runCleanupSSE("/api/favorites/dedup-cleanup", "重複整理")} disabled={isCleanupRunning || totalCount === 0} data-testid="button-dedup-cleanup">
                  {isCleanupRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Layers className="w-3.5 h-3.5 mr-1" />}
                  重複整理
                </Button>
                <Button variant="outline" size="sm" onClick={() => runCleanupSSE("/api/favorites/cleanup", "全て整理")} disabled={isCleanupRunning || totalCount === 0} data-testid="button-full-cleanup">
                  {isCleanupRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Zap className="w-3.5 h-3.5 mr-1" />}
                  全て整理
                </Button>
              </div>

              {(isCleanupRunning || cleanupLogs.length > 0) && (
                <div className="rounded-md border border-border/50 bg-black/80 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    {isCleanupRunning ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : cleanupDone ? <Star className="w-4 h-4 text-green-400" /> : null}
                    <span className="text-xs font-medium text-muted-foreground">整理ログ</span>
                    {!isCleanupRunning && cleanupDone && (
                      <Button variant="ghost" size="sm" className="ml-auto h-5 px-2 text-xs" onClick={() => { setCleanupLogs([]); setCleanupDone(false); }}>
                        <X className="w-3 h-3 mr-1" />閉じる
                      </Button>
                    )}
                  </div>
                  <div className="font-mono text-xs max-h-40 overflow-y-auto space-y-0.5">
                    {cleanupLogs.map((log, i) => (
                      <div key={i} className="flex gap-2 py-0.5">
                        <span className="text-muted-foreground shrink-0">[{log.time}]</span>
                        {log.elapsed && <span className="text-green-400 shrink-0">({log.elapsed})</span>}
                        <span className="text-foreground flex-1">{log.detail}</span>
                      </div>
                    ))}
                    <div ref={cleanupLogEndRef} />
                  </div>
                </div>
              )}

              {/* 末尾名詞ランキング */}
              <div className="rounded-md border border-border/40 bg-muted/10 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold">末尾名詞ランキング（NG単語候補）</span>
                  <Button variant="outline" size="sm" className="ml-auto text-xs h-7 px-2.5" onClick={runEndingAnalysis}
                    disabled={isAnalyzingEndings || totalCount === 0} data-testid="button-analyze-endings">
                    {isAnalyzingEndings ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Search className="w-3.5 h-3.5 mr-1" />}
                    {isAnalyzingEndings ? "分析中..." : "分析"}
                  </Button>
                </div>
                {endingAnalysisLog && (
                  <p className="text-xs text-muted-foreground">{endingAnalysisLog}</p>
                )}
                {endingRankings && endingRankings.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {endingRankings.map((r, i) => (
                        <div key={(r as any).reading || r.word} className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-card px-2 py-0.5 text-xs" data-testid={`ending-rank-${i}`}>
                          <span className="text-muted-foreground font-mono">{i + 1}.</span>
                          <span className="font-medium">{r.word}</span>
                          {(r as any).reading && (r as any).reading !== r.word && (
                            <span className="text-muted-foreground text-[10px]">（{(r as any).reading}）</span>
                          )}
                          <Badge variant="secondary" className="text-[10px] h-4 px-1">{r.count}</Badge>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">コピー（NG単語に貼り付け可）:</span>
                      <button
                        onClick={() => { navigator.clipboard.writeText(endingRankings.map(r => r.word).join("、")); toast({ title: "コピー完了", description: `${endingRankings.length}個の末尾名詞をコピーしました` }); }}
                        className="font-mono text-xs bg-black/60 border border-border/50 rounded px-2 py-1 hover:bg-black/80 transition-colors text-left flex-1 truncate cursor-pointer"
                        data-testid="button-copy-endings">
                        {endingRankings.map(r => r.word).join("、")}
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5" data-testid="rhyme-filter-bar">
                {([
                  ["all", "すべて"],
                  ["perfect", "Perfect Rhyme"],
                  ["legendary", "伝説級"],
                  ["super", "超硬い"],
                  ["hard", "硬い"],
                ] as [RhymeFilter, string][]).map(([key, label]) => (
                  <Button key={key} variant={rhymeFilter === key ? "default" : "outline"} size="sm" className="text-xs h-7 px-2.5"
                    onClick={() => setRhymeFilter(key)} data-testid={`filter-${key}`}>{label}</Button>
                ))}
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

              {favQuery.isLoading ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-md" />)}</div>
              ) : !favQuery.data || favQuery.data.groups.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-empty-favorites">データベースは空です。生成タブでワードを生成して追加してください。</div>
              ) : (() => {
                const tierConfig: Record<string, { label: string; border: string; bg: string; badge: string; wordBg: string; highlight: string }> = {
                  perfect: { label: "Perfect Rhyme (6母音/90%)", border: "border-fuchsia-500/60", bg: "bg-fuchsia-500/10", badge: "border-fuchsia-500/70 text-fuchsia-500 dark:text-fuchsia-400", wordBg: "bg-fuchsia-500/15 border-fuchsia-500/30", highlight: "text-fuchsia-400" },
                  legendary: { label: "伝説級硬い韻 (6)", border: "border-yellow-500/50", bg: "bg-yellow-500/10", badge: "border-yellow-500/60 text-yellow-600 dark:text-yellow-400", wordBg: "bg-yellow-500/15 border-yellow-500/30", highlight: "text-yellow-400" },
                  super: { label: "超硬い韻 (5)", border: "border-orange-500/40", bg: "bg-orange-500/8", badge: "border-orange-500/50 text-orange-600 dark:text-orange-400", wordBg: "bg-orange-500/12 border-orange-500/25", highlight: "text-orange-400" },
                  hard: { label: "硬い韻 (4)", border: "border-primary/30", bg: "bg-primary/5", badge: "border-primary/40 text-primary", wordBg: "bg-primary/10 border-primary/20", highlight: "text-primary" },
                };

                const renderRomajiChars = (romaji: string, hlIdx: number, hlColor: string, isSelected: boolean) => (
                  <span className="font-mono text-[9px] leading-tight mt-0.5 inline-flex flex-wrap justify-center">
                    {romaji.split("").map((ch, i) => {
                      const lc = ch.toLowerCase();
                      const isVowel = "aeiou".includes(lc);
                      // 「ん」由来のnのみ母音扱い：次の文字が母音でない（または末尾）場合
                      // 「なにぬねの」等の子音nは通常の子音扱い
                      const isNN = lc === "n" && !"aeiou".includes((romaji[i + 1] ?? "").toLowerCase());
                      const isVowelOrNN = isVowel || isNN;
                      const inHL = hlIdx >= 0 && i >= hlIdx;
                      if (inHL && isVowelOrNN) {
                        return <span key={i} style={{ fontSize: "11px" }} className={`font-bold ${isSelected ? "opacity-90" : hlColor}`}>{ch}</span>;
                      }
                      return <span key={i} className={isSelected ? "opacity-60" : "text-muted-foreground"}>{ch}</span>;
                    })}
                  </span>
                );

                const renderWord = (w: FavWord, tc: typeof tierConfig[string] | null, suffixLen?: number) => {
                  const hlIdx = suffixLen ? getRomajiHighlightIndex(w.romaji, suffixLen) : -1;
                  return (
                    <button key={w.id} onClick={() => toggleFavSelection(w.id)}
                      className={`inline-flex flex-col items-center text-xs rounded px-2 py-1 cursor-pointer transition-all ${selectedFavIds.has(w.id) ? "bg-primary text-primary-foreground border border-primary ring-2 ring-primary/30" : tc ? `${tc.wordBg} hover:opacity-80` : "bg-card border border-border/50 hover:bg-muted/50"}`}
                      data-testid={`fav-word-${w.id}`}>
                      <span className="font-medium">{w.word}</span>
                      {renderRomajiChars(w.romaji, hlIdx, tc?.highlight || "text-primary", selectedFavIds.has(w.id))}
                    </button>
                  );
                };

                // 末尾2母音パターンの一覧を取得
                const allTail2Patterns = [...new Set(favQuery.data.groups.map(g => g.vowels.replace(/^\*/, "").slice(-2)))].sort();

                const filteredGroups = favQuery.data.groups.map(group => {
                  const grpTail2 = group.vowels.replace(/^\*/, "").slice(-2);
                  if (tail2Filter !== "all" && grpTail2 !== tail2Filter) return null;
                  if (rhymeFilter === "all") return group;
                  const filteredRhymes = (group.hardRhymes || []).filter(hr => hr.tier === rhymeFilter);
                  return { ...group, hardRhymes: filteredRhymes, words: rhymeFilter === "all" ? group.words : [] };
                }).filter((group): group is NonNullable<typeof group> => {
                  if (!group) return false;
                  const totalInGroup = group.words.length + (group.hardRhymes?.reduce((s, h) => s + h.words.length, 0) || 0);
                  return totalInGroup > 0;
                });

                return (
                <>
                  {/* 末尾2母音フィルタ */}
                  <div className="flex flex-wrap gap-1.5" data-testid="tail2-filter-bar">
                    <Button key="all-t2" variant={tail2Filter === "all" ? "default" : "outline"} size="sm" className="text-xs h-7 px-2.5"
                      onClick={() => setTail2Filter("all")} data-testid="filter-tail2-all">全パターン</Button>
                    {allTail2Patterns.map(p => (
                      <Button key={p} variant={tail2Filter === p ? "secondary" : "outline"} size="sm"
                        className={`text-xs h-7 px-2.5 font-mono font-bold ${tail2Filter === p ? "ring-2 ring-primary/30" : ""}`}
                        onClick={() => setTail2Filter(tail2Filter === p ? "all" : p)} data-testid={`filter-tail2-${p}`}>
                        *{p}
                      </Button>
                    ))}
                  </div>

                <div className="space-y-4" data-testid="favorites-container">
                  {filteredGroups.map(group => {
                    const totalInGroup = group.words.length + (group.hardRhymes?.reduce((s, h) => s + h.words.length, 0) || 0);
                    const tail2 = group.vowels.replace(/^\*/, "").slice(-2);
                    return (
                    <div key={group.vowels} className="rounded-lg border-2 border-primary/25 bg-muted/20 overflow-hidden">
                      {/* 末尾2母音ヘッダー（最大グループ単位） */}
                      <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border-b border-primary/20">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-extrabold font-mono tracking-wider text-primary">*{tail2}</span>
                          <span className="text-xs font-mono text-muted-foreground">{group.vowels}</span>
                        </div>
                        <Badge variant="secondary" className="text-xs ml-1">{totalInGroup}語</Badge>
                      </div>
                      <div className="p-3 space-y-2">
                      {group.hardRhymes && group.hardRhymes.length > 0 && (
                        <div className="space-y-2">
                          {group.hardRhymes.map(hr => {
                            const tc = tierConfig[hr.tier];
                            return (
                            <div key={hr.suffix} className={`rounded border ${tc.border} ${tc.bg} p-2`} data-testid={`rhyme-${hr.tier}-${hr.suffix}`}>
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <Badge variant="outline" className={`text-[10px] font-mono ${tc.badge}`}>{tc.label} *{hr.suffix}</Badge>
                                <span className="text-[10px] text-muted-foreground">{hr.words.length}個</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {hr.words.map(w => renderWord(w, tc, hr.suffix.length))}
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      )}
                      {group.words.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {group.words.map(w => renderWord(w, null))}
                        </div>
                      )}
                      </div>
                    </div>
                    );
                  })}
                </div>
                </>
                );
              })()}
            </CardContent>
          </Card>
        ) : (
        <>
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-5 h-5 text-primary" />
              <h2 className="text-base font-semibold">ターゲット生成</h2>
            </div>
            <Button onClick={() => targetMutation.mutate()} disabled={targetMutation.isPending || isAutoMode} size="sm" data-testid="button-generate-target">
              {targetMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
              {target ? "ターゲット変更" : "ターゲットを選ぶ"}
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
                <Flame className="w-5 h-5 text-primary" />
                <h2 className="text-base font-semibold">レベル</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xl font-bold font-mono ${levelInfo.color}`} data-testid="text-level-number">{level}</span>
                <span className="text-xs text-muted-foreground">/5</span>
                <Badge variant="secondary" className={`text-xs ${levelInfo.color}`} data-testid="text-level-label">{levelInfo.label}</Badge>
              </div>
            </div>
            <Slider value={[level]} min={1} max={5} step={1} onValueChange={val => { setLevel(val[0]); if (val[0] < 3) setAgeConfirmed(false); }} disabled={isAutoMode} data-testid="slider-level" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Flame className="w-3 h-3 text-yellow-400" />
                <span>毒舌</span>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className={`w-6 h-3 rounded-sm transition-colors ${i < level ? (LEVEL_BAR_COLORS[i + 1] || "bg-muted") : "bg-muted"}`} />
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>禁忌</span>
                <Flame className="w-3 h-3 text-purple-500" />
              </div>
            </div>
            <AnimatePresence>
              {level >= 3 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-2.5">
                    <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={ageConfirmed} onCheckedChange={v => setAgeConfirmed(!!v)} disabled={isAutoMode} data-testid="checkbox-age-confirm" />
                      <span className="text-xs">{level >= 5 ? "18歳以上・過激・性的・差別的な表現を許可" : "18歳以上・過激な表現を許可"}</span>
                    </label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="rounded-md bg-muted/30 border border-border/50 p-2.5 text-xs text-muted-foreground">
              <div className="font-medium mb-1">3ステップ生成:</div>
              <div>STEP1: ディスワード300個を一括生成（6並列×50個）</div>
              <div>STEP2: 品質フィルタ（子供でもわかるか？4文字以上か？）</div>
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
                      {genStatus === "success" && lastGenTime && (
                        <span className="text-xs text-green-400" data-testid="text-gen-time">
                          {formatTimer(Math.round(lastGenTime / 1000))}
                          {prevGenTime && (() => {
                            const diff = lastGenTime - prevGenTime;
                            const sign = diff > 0 ? "+" : "";
                            return <span className={diff <= 0 ? "text-green-300 ml-1" : "text-red-300 ml-1"}>({sign}{formatTimer(Math.abs(Math.round(diff / 1000)))})</span>;
                          })()}
                        </span>
                      )}
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
                        {addFavMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Database className="w-4 h-4 mr-2" />}
                        データベースへ送信 {checkedWords.size > 0 && `(${checkedWords.size}個)`}
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
