import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Flame,
  Mic2,
  Sparkles,
  Zap,
  AlertTriangle,
  Loader2,
  Star,
  Copy,
  Trash2,
  CheckSquare,
  Square,
  Database,
  Target,
  X,
  Ban,
  ScrollText,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface WordEntry {
  word: string;
  reading: string;
  romaji: string;
}

interface DissGroups {
  seven: WordEntry[];
  six: WordEntry[];
  five: WordEntry[];
  four: WordEntry[];
  three: WordEntry[];
  two: WordEntry[];
}

interface FavWord {
  id: number;
  word: string;
  reading: string;
  romaji: string;
  vowels: string;
  charCount: number;
}

interface FavGroup {
  vowels: string;
  words: FavWord[];
}

interface NgWord {
  id: number;
  word: string;
  reading: string;
  romaji: string;
}

interface ProgressLog {
  time: string;
  detail: string;
  elapsed: string;
  pct?: number;
  eta?: string;
}

function extractVowels(romaji: string): string {
  return romaji.replace(/[^aeiou]/gi, "").toLowerCase();
}

function getLevelLabel(level: number): string {
  if (level <= 2) return "マイルド";
  if (level <= 4) return "ピリ辛";
  if (level <= 6) return "スパイシー";
  if (level <= 8) return "デンジャラス";
  return "EXTREME";
}

function getLevelColor(level: number): string {
  if (level <= 2) return "text-green-400";
  if (level <= 4) return "text-yellow-400";
  if (level <= 6) return "text-orange-400";
  if (level <= 8) return "text-red-400";
  return "text-red-500";
}

const GROUP_KEYS: Array<{ key: keyof DissGroups; label: string; count: number }> = [
  { key: "seven", label: "7文字", count: 5 },
  { key: "six", label: "6文字", count: 10 },
  { key: "five", label: "5文字", count: 20 },
  { key: "four", label: "4文字", count: 30 },
  { key: "three", label: "3文字", count: 30 },
  { key: "two", label: "2文字", count: 5 },
];

export default function Home() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [target, setTarget] = useState<string>("");
  const [level, setLevel] = useState<number>(5);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [dissGroups, setDissGroups] = useState<DissGroups | null>(null);
  const [activeTab, setActiveTab] = useState<"gen" | "fav" | "ng">("gen");
  const [checkedWords, setCheckedWords] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [progressLogs]);

  const favQuery = useQuery<{ groups: FavGroup[]; total: number }>({
    queryKey: ["/api/favorites"],
  });

  const favCountQuery = useQuery<{ total: number }>({
    queryKey: ["/api/favorites/count"],
  });

  const ngWordsQuery = useQuery<{ words: NgWord[]; total: number }>({
    queryKey: ["/api/ng-words"],
  });

  const ngCountQuery = useQuery<{ total: number }>({
    queryKey: ["/api/ng-words/count"],
  });

  const totalCount = favCountQuery.data?.total ?? favQuery.data?.total ?? 0;
  const ngCount = ngCountQuery.data?.total ?? ngWordsQuery.data?.total ?? 0;

  const getAllEntries = (): WordEntry[] => {
    if (!dissGroups) return [];
    return [
      ...dissGroups.seven,
      ...dissGroups.six,
      ...dissGroups.five,
      ...dissGroups.four,
      ...dissGroups.three,
      ...dissGroups.two,
    ];
  };

  const toggleChecked = useCallback((word: string) => {
    setCheckedWords((prev) => {
      const next = new Set(prev);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const all = getAllEntries();
    setCheckedWords(new Set(all.map((e) => e.word)));
  }, [dissGroups]);

  const deselectAll = useCallback(() => {
    setCheckedWords(new Set());
  }, []);

  const isAllSelected = dissGroups ? checkedWords.size === getAllEntries().length && getAllEntries().length > 0 : false;

  const targetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/target");
      return res.json();
    },
    onSuccess: (data: { target: string }) => {
      setTarget(data.target);
      setDissGroups(null);
    },
    onError: () => {
      toast({ title: "エラー", description: "ターゲット生成に失敗しました", variant: "destructive" });
    },
  });

  const generateDissSSE = useCallback(async () => {
    setIsGenerating(true);
    setProgressLogs([]);
    setDissGroups(null);

    const addLog = (detail: string, elapsed: string, pct?: number, eta?: string) => {
      const now = new Date();
      const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
      setProgressLogs((prev) => [...prev, { time, detail, elapsed, pct, eta }]);
    };

    addLog("生成開始...", "0秒");

    try {
      const response = await fetch("/api/diss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, level }),
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
              addLog(data.detail, data.elapsed || "", data.pct, data.eta);
            } else if (data.type === "result") {
              setDissGroups(data.groups);
              const all = [
                ...data.groups.seven, ...data.groups.six, ...data.groups.five,
                ...data.groups.four, ...data.groups.three, ...data.groups.two,
              ];
              setCheckedWords(new Set(all.map((e: WordEntry) => e.word)));
              if (data.total < 100) {
                toast({ title: "注意", description: `${data.total}/100個のみ生成できました。再度お試しください。` });
              }
            } else if (data.type === "error") {
              toast({ title: "エラー", description: data.error, variant: "destructive" });
            }
          } catch {}
        }
      }
    } catch (err) {
      toast({ title: "エラー", description: err instanceof Error ? err.message : "ワード生成に失敗しました", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }, [target, level, toast]);

  const addFavMutation = useMutation({
    mutationFn: async (words: WordEntry[]) => {
      const res = await apiRequest("POST", "/api/favorites", { words });
      return res.json();
    },
    onSuccess: (data: { added: number; total: number }) => {
      toast({ title: "追加完了", description: `${data.added}個追加（合計 ${data.total}個）` });
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/favorites/count"] });
    },
    onError: () => {
      toast({ title: "エラー", description: "お気に入りの追加に失敗しました", variant: "destructive" });
    },
  });

  const deleteFavMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/favorites/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/favorites/count"] });
    },
  });

  const clearFavMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/favorites");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "削除完了", description: "お気に入りをすべて削除しました" });
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/favorites/count"] });
    },
  });

  const clearNgMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/ng-words");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "削除完了", description: "NGワードをすべて削除しました" });
      queryClient.invalidateQueries({ queryKey: ["/api/ng-words"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ng-words/count"] });
    },
  });

  const addToFavorites = useCallback(async () => {
    if (checkedWords.size === 0) {
      toast({ title: "未選択", description: "ワードを選択してください" });
      return;
    }
    const allEntries = getAllEntries();
    const selected = allEntries.filter((e) => checkedWords.has(e.word));
    const unchecked = allEntries.filter((e) => !checkedWords.has(e.word));

    addFavMutation.mutate(selected);

    if (unchecked.length > 0) {
      try {
        await fetch("/api/ng-words", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ words: unchecked.map(w => ({ word: w.word, reading: w.reading, romaji: w.romaji })) }),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/ng-words"] });
        queryClient.invalidateQueries({ queryKey: ["/api/ng-words/count"] });
      } catch {}
    }
    setCheckedWords(new Set());
  }, [checkedWords, dissGroups, toast]);

  const copyFavorites = useCallback(async () => {
    try {
      const res = await fetch("/api/favorites/export");
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      toast({ title: "コピー完了", description: "全データをクリップボードにコピーしました" });
    } catch {
      toast({ title: "エラー", description: "コピーに失敗しました", variant: "destructive" });
    }
  }, [toast]);

  const handleGenerateDiss = useCallback(() => {
    if (!target) {
      toast({ title: "ターゲット未設定", description: "先にターゲットを生成してください" });
      return;
    }
    if (level >= 8 && !ageConfirmed) {
      toast({ title: "年齢確認", description: "レベル8以上は年齢確認が必要です", variant: "destructive" });
      return;
    }
    generateDissSSE();
  }, [target, level, ageConfirmed, generateDissSSE, toast]);

  const progressPercent = Math.min((totalCount / 10000) * 100, 100);

  const renderWordGroup = (label: string, entries: WordEntry[], startIndex: number) => {
    if (entries.length === 0) return null;
    const groupWords = entries.map((e) => e.word);
    const allChecked = groupWords.every((w) => checkedWords.has(w));

    const toggleGroup = () => {
      setCheckedWords((prev) => {
        const next = new Set(prev);
        if (allChecked) {
          groupWords.forEach((w) => next.delete(w));
        } else {
          groupWords.forEach((w) => next.add(w));
        }
        return next;
      });
    };

    return (
      <div className="space-y-2" key={label}>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-mono">{label}</Badge>
          <span className="text-xs text-muted-foreground">{entries.length}個</span>
          <button
            onClick={toggleGroup}
            className="text-xs text-primary hover:underline ml-auto"
            data-testid={`button-toggle-group-${label}`}
          >
            {allChecked ? "選択解除" : "全選択"}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {entries.map((entry, i) => (
            <motion.div
              key={`${entry.word}-${startIndex + i}`}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: Math.min((startIndex + i) * 0.01, 0.5) }}
              className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-border/60 bg-card transition-colors"
              data-testid={`word-row-${startIndex + i}`}
            >
              <Checkbox
                checked={checkedWords.has(entry.word)}
                onCheckedChange={() => toggleChecked(entry.word)}
                data-testid={`checkbox-word-${startIndex + i}`}
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{entry.word}</span>
                {entry.reading && <span className="text-xs text-muted-foreground ml-1.5">({entry.reading})</span>}
                <span className="text-xs text-primary/70 ml-1">[{extractVowels(entry.romaji)}]</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    );
  };

  const getRunningIndex = () => {
    if (!dissGroups) return {};
    let idx = 0;
    const indices: Record<string, number> = {};
    for (const g of GROUP_KEYS) {
      indices[g.key] = idx;
      idx += dissGroups[g.key].length;
    }
    return indices;
  };
  const runningIndices = getRunningIndex();

  return (
    <div className="min-h-screen bg-background">
      <div className="relative overflow-hidden border-b border-border/50">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5 dark:from-primary/5 dark:via-transparent dark:to-primary/3" />
        <div className="relative max-w-2xl mx-auto px-4 py-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Mic2 className="w-7 h-7 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-title">
              悪口データベース
            </h1>
            <Database className="w-6 h-6 text-primary" />
          </div>
          <p className="text-muted-foreground text-xs mb-3">
            目標1万ワード！AIでディスワードを量産してデータベースに蓄積
          </p>
          <div className="max-w-xs mx-auto">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">{totalCount.toLocaleString()} / 10,000</span>
              <span className="font-mono text-primary">{progressPercent.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden" data-testid="progress-bar">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        <div className="flex rounded-lg overflow-hidden border border-border/60">
          <button
            onClick={() => setActiveTab("gen")}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "gen"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
            }`}
            data-testid="tab-gen"
          >
            <Zap className="w-4 h-4 inline mr-1" />
            生成
          </button>
          <button
            onClick={() => {
              setActiveTab("fav");
              queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
            }}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === "fav"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
            }`}
            data-testid="tab-fav"
          >
            <Star className="w-4 h-4" />
            DB
            {totalCount > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                {totalCount.toLocaleString()}
              </Badge>
            )}
          </button>
          <button
            onClick={() => {
              setActiveTab("ng");
              queryClient.invalidateQueries({ queryKey: ["/api/ng-words"] });
            }}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === "ng"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
            }`}
            data-testid="tab-ng"
          >
            <Ban className="w-4 h-4" />
            NG
            {ngCount > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                {ngCount.toLocaleString()}
              </Badge>
            )}
          </button>
        </div>

        {activeTab === "ng" ? (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Ban className="w-5 h-5 text-destructive" />
                    <h2 className="text-base font-semibold">NGワード</h2>
                    <Badge variant="secondary">{ngCount.toLocaleString()}件</Badge>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => clearNgMutation.mutate()}
                    disabled={clearNgMutation.isPending || ngCount === 0}
                    data-testid="button-clear-ng"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    全削除
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  お気に入りに選ばれなかったワードが蓄積されます。次回の生成時にこれらのワードは除外されます。
                </p>

                {ngWordsQuery.isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-8 w-full rounded-md" />
                    ))}
                  </div>
                ) : !ngWordsQuery.data || ngWordsQuery.data.words.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-empty-ng">
                    NGワードはまだありません。生成後にチェックを外したワードがここに蓄積されます。
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-96 overflow-y-auto" data-testid="ng-words-container">
                    {ngWordsQuery.data.words.map((w) => (
                      <div
                        key={w.id}
                        className="inline-flex items-center gap-1 text-xs bg-destructive/10 border border-destructive/20 rounded px-2 py-1"
                        data-testid={`ng-word-${w.id}`}
                      >
                        <span className="font-medium">{w.word}</span>
                        <span className="text-muted-foreground">({w.reading})</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : activeTab === "fav" ? (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-primary" />
                    <h2 className="text-base font-semibold">悪口データベース</h2>
                    <Badge variant="secondary">{totalCount.toLocaleString()}件</Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={copyFavorites} data-testid="button-copy-favorites">
                      <Copy className="w-3.5 h-3.5 mr-1" />
                      エクスポート
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => clearFavMutation.mutate()}
                      disabled={clearFavMutation.isPending}
                      data-testid="button-clear-favorites"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      全削除
                    </Button>
                  </div>
                </div>

                {favQuery.isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full rounded-md" />
                    ))}
                  </div>
                ) : !favQuery.data || favQuery.data.groups.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-empty-favorites">
                    データベースは空です。生成タブでワードを生成して追加してください。
                  </div>
                ) : (
                  <div className="space-y-3" data-testid="favorites-container">
                    {favQuery.data.groups.map((group) => (
                      <div key={group.vowels} className="rounded-md border border-border/50 bg-muted/10 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="default" className="text-xs font-mono">
                            [{group.vowels}]
                          </Badge>
                          <span className="text-xs text-muted-foreground">{group.words.length}個</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {group.words.map((w) => (
                            <div
                              key={w.id}
                              className="inline-flex items-center gap-1 text-xs bg-card border border-border/50 rounded px-2 py-1"
                              data-testid={`fav-word-${w.id}`}
                            >
                              <span className="font-medium">{w.word}</span>
                              <span className="text-muted-foreground">({w.reading})</span>
                              <button
                                onClick={() => deleteFavMutation.mutate(w.id)}
                                className="text-muted-foreground hover:text-destructive ml-0.5"
                                data-testid={`button-delete-fav-${w.id}`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
        <>
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-5 h-5 text-primary" />
              <h2 className="text-base font-semibold">ターゲット設定</h2>
            </div>

            <Button
              onClick={() => targetMutation.mutate()}
              disabled={targetMutation.isPending}
              size="sm"
              data-testid="button-generate-target"
            >
              {targetMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Sparkles className="w-4 h-4 mr-1" />
              )}
              {target ? "やり直し" : "ターゲットを選ぶ"}
            </Button>

            <AnimatePresence mode="wait">
              {target ? (
                <motion.div
                  key="target"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-md bg-muted/50 dark:bg-muted/30 px-3 py-2 border border-border/50"
                >
                  <div className="text-sm whitespace-pre-line leading-relaxed" data-testid="text-target">{target}</div>
                </motion.div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  ボタンを押してターゲットを選ぶ
                </p>
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
              <div className="flex items-center gap-1">
                <span className={`text-xl font-bold font-mono ${getLevelColor(level)}`} data-testid="text-level-number">
                  {level}
                </span>
                <span className="text-xs text-muted-foreground">/10</span>
              </div>
            </div>

            <Slider
              value={[level]}
              min={1}
              max={10}
              step={1}
              onValueChange={(val) => setLevel(val[0])}
              data-testid="slider-level"
            />
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="text-xs">{getLevelLabel(level)}</Badge>
              <div className="flex gap-0.5">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-3 rounded-sm transition-colors ${
                      i < level
                        ? i < 3 ? "bg-green-500" : i < 6 ? "bg-yellow-500" : i < 8 ? "bg-orange-500" : "bg-red-500"
                        : "bg-muted"
                    }`}
                  />
                ))}
              </div>
            </div>

            <AnimatePresence>
              {level >= 8 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-2.5">
                    <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={ageConfirmed}
                        onCheckedChange={(v) => setAgeConfirmed(!!v)}
                        data-testid="checkbox-age-confirm"
                      />
                      <span className="text-xs">18歳以上・過激な表現を許可</span>
                    </label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <Button
              onClick={handleGenerateDiss}
              disabled={isGenerating || !target}
              className="w-full"
              data-testid="button-generate-diss"
            >
              {isGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              100個生成（7文字×5 / 6文字×10 / 5文字×20 / 4文字×30 / 3文字×30 / 2文字×5）
            </Button>
          </CardContent>
        </Card>

        <AnimatePresence>
          {(isGenerating || progressLogs.length > 0) && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <ScrollText className="w-5 h-5 text-primary" />
                    <h2 className="text-base font-semibold">進捗ログ</h2>
                    {isGenerating && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                    {(() => {
                      const lastWithEta = [...progressLogs].reverse().find(l => l.eta);
                      const lastPct = [...progressLogs].reverse().find(l => l.pct !== undefined);
                      return (
                        <>
                          {lastWithEta?.eta && isGenerating && (
                            <span className="text-xs text-yellow-400 ml-auto font-mono" data-testid="text-eta">
                              残り {lastWithEta.eta}
                            </span>
                          )}
                          {lastPct?.pct !== undefined && (
                            <span className="text-xs text-primary font-mono">
                              {lastPct.pct}%
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  {(() => {
                    const lastPct = [...progressLogs].reverse().find(l => l.pct !== undefined);
                    if (lastPct?.pct !== undefined) {
                      return (
                        <div className="h-2 bg-muted rounded-full overflow-hidden mb-3" data-testid="generation-progress-bar">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
                            style={{ width: `${lastPct.pct}%` }}
                          />
                        </div>
                      );
                    }
                    return null;
                  })()}
                  <div
                    className="bg-black/80 rounded-md border border-border/50 p-3 font-mono text-xs max-h-48 overflow-y-auto"
                    data-testid="progress-log-area"
                  >
                    {progressLogs.map((log, i) => (
                      <div key={i} className="flex gap-2 py-0.5">
                        <span className="text-muted-foreground shrink-0">[{log.time}]</span>
                        <span className="text-green-400 shrink-0">{log.elapsed && `(${log.elapsed})`}</span>
                        <span className="text-foreground flex-1">{log.detail}</span>
                        {log.eta && (
                          <span className="text-yellow-400 shrink-0">ETA:{log.eta}</span>
                        )}
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
          {dissGroups && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <div className="flex items-center gap-2">
                      <Zap className="w-5 h-5 text-primary" />
                      <h2 className="text-base font-semibold">生成結果</h2>
                      <Badge variant="secondary" className="text-xs">
                        {getAllEntries().length}個
                      </Badge>
                    </div>
                    {getAllEntries().length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={isAllSelected ? deselectAll : selectAll}
                        data-testid="button-select-all"
                      >
                        {isAllSelected ? (
                          <><Square className="w-4 h-4 mr-1" />全解除</>
                        ) : (
                          <><CheckSquare className="w-4 h-4 mr-1" />全て選択</>
                        )}
                      </Button>
                    )}
                  </div>

                  <div className="space-y-4">
                    {GROUP_KEYS.map((g) => {
                      const entries = dissGroups[g.key];
                      return renderWordGroup(g.label, entries, runningIndices[g.key] || 0);
                    })}
                  </div>
                  <div className="mt-4">
                    <Button
                      onClick={addToFavorites}
                      disabled={checkedWords.size === 0 || addFavMutation.isPending}
                      variant="destructive"
                      className="w-full"
                      data-testid="button-add-favorites"
                    >
                      {addFavMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <Star className="w-4 h-4 mr-2" />
                      )}
                      選択ワードをデータベースに追加 {checkedWords.size > 0 && `(${checkedWords.size}個)`}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
        </>
        )}
      </div>

      <footer className="text-center py-4 text-xs text-muted-foreground">
        Powered by Gemini AI
      </footer>
    </div>
  );
}
