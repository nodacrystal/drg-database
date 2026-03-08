import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Crosshair,
  Flame,
  Mic2,
  RotateCcw,
  Sparkles,
  Zap,
  AlertTriangle,
  Music,
  Loader2,
  Star,
  Copy,
  Trash2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface DissGroups {
  four: string[];
  three: string[];
  two: string[];
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

export default function Home() {
  const { toast } = useToast();
  const [nameInput, setNameInput] = useState<string>("");
  const [target, setTarget] = useState<string>("");
  const [level, setLevel] = useState<number>(5);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [dissGroups, setDissGroups] = useState<DissGroups | null>(null);
  const [activeTab, setActiveTab] = useState<"gen" | "fav">("gen");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [checkedWords, setCheckedWords] = useState<Set<string>>(new Set());
  const [generatedHistory, setGeneratedHistory] = useState<string[]>([]);
  const [selectedFavWord, setSelectedFavWord] = useState<string | null>(null);
  const [rhymeWords, setRhymeWords] = useState<string[]>([]);
  const [checkedRhymes, setCheckedRhymes] = useState<Set<string>>(new Set());

  const allDissWords = dissGroups
    ? [...dissGroups.four, ...dissGroups.three, ...dissGroups.two]
    : [];

  const toggleChecked = useCallback((word: string) => {
    setCheckedWords((prev) => {
      const next = new Set(prev);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });
  }, []);

  const toggleRhymeChecked = useCallback((word: string) => {
    setCheckedRhymes((prev) => {
      const next = new Set(prev);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });
  }, []);

  const addToFavorites = useCallback(() => {
    if (checkedWords.size === 0) {
      toast({ title: "未選択", description: "ワードを選択してください" });
      return;
    }
    setFavorites((prev) => {
      const merged = new Set(prev);
      checkedWords.forEach((w) => merged.add(w));
      return Array.from(merged).sort((a, b) => a.localeCompare(b, "ja"));
    });
    toast({ title: "追加完了", description: `${checkedWords.size}個のワードをお気に入りに追加しました` });
    setCheckedWords(new Set());
  }, [checkedWords, toast]);

  const addRhymesToFavorites = useCallback(() => {
    if (checkedRhymes.size === 0) {
      toast({ title: "未選択", description: "ワードを選択してください" });
      return;
    }
    setFavorites((prev) => {
      const merged = new Set(prev);
      checkedRhymes.forEach((w) => merged.add(w));
      return Array.from(merged).sort((a, b) => a.localeCompare(b, "ja"));
    });
    toast({ title: "追加完了", description: `${checkedRhymes.size}個のワードをお気に入りに追加しました` });
    setCheckedRhymes(new Set());
  }, [checkedRhymes, toast]);

  const copyFavorites = useCallback(() => {
    if (favorites.length === 0) {
      toast({ title: "コピー失敗", description: "お気に入りが空です" });
      return;
    }
    navigator.clipboard.writeText(favorites.map((w) => `[${w}]`).join("")).then(() => {
      toast({ title: "コピー完了", description: "クリップボードにコピーしました" });
    });
  }, [favorites, toast]);

  const clearFavorites = useCallback(() => {
    setFavorites([]);
    setSelectedFavWord(null);
    setRhymeWords([]);
    setCheckedRhymes(new Set());
    toast({ title: "削除完了", description: "お気に入りをすべて削除しました" });
  }, [toast]);

  const targetMutation = useMutation({
    mutationFn: async () => {
      const url = nameInput.trim()
        ? `/api/target?name=${encodeURIComponent(nameInput.trim())}`
        : "/api/target";
      const res = await apiRequest("GET", url);
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

  const resetHistory = useCallback(() => {
    setGeneratedHistory([...favorites]);
    toast({ title: "リセット完了", description: "出現済みワードの記録をリセットしました（お気に入りは残っています）" });
  }, [favorites, toast]);

  const dissMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/diss", { target, level, history: generatedHistory });
      return res.json();
    },
    onSuccess: (data: { groups: DissGroups }) => {
      setDissGroups(data.groups);
      setCheckedWords(new Set());
      const allWords = [...data.groups.four, ...data.groups.three, ...data.groups.two];
      setGeneratedHistory((prev) => {
        const next = [...prev];
        allWords.forEach((w) => { if (!next.includes(w)) next.push(w); });
        return next;
      });
    },
    onError: () => {
      toast({ title: "エラー", description: "ワード生成に失敗しました", variant: "destructive" });
    },
  });

  const rhymeMutation = useMutation({
    mutationFn: async (word: string) => {
      const res = await apiRequest("POST", "/api/rhyme", { word, target, level });
      return res.json();
    },
    onSuccess: (data: { words: string[] }) => {
      setRhymeWords(data.words);
      setCheckedRhymes(new Set());
    },
    onError: () => {
      toast({ title: "エラー", description: "韻の生成に失敗しました", variant: "destructive" });
    },
  });

  const handleGenerateDiss = useCallback(() => {
    if (!target) {
      toast({ title: "ターゲット未設定", description: "先にターゲットを生成してください" });
      return;
    }
    if (level >= 8 && !ageConfirmed) {
      toast({ title: "年齢確認", description: "レベル8以上は年齢確認が必要です", variant: "destructive" });
      return;
    }
    dissMutation.mutate();
  }, [target, level, ageConfirmed, dissMutation, toast]);

  const handleRhymeGenerate = useCallback((word: string) => {
    if (!target) {
      toast({ title: "ターゲット未設定", description: "先に生成タブでターゲットを生成してください" });
      return;
    }
    if (level >= 8 && !ageConfirmed) {
      toast({ title: "年齢確認", description: "レベル8以上は年齢確認が必要です", variant: "destructive" });
      return;
    }
    setSelectedFavWord(word);
    setRhymeWords([]);
    setCheckedRhymes(new Set());
    rhymeMutation.mutate(word);
  }, [target, level, ageConfirmed, rhymeMutation, toast]);

  const renderWordGroup = (title: string, words: string[], startIndex: number) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs font-mono">{title}</Badge>
        <span className="text-xs text-muted-foreground">{words.length}個</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {words.map((word, i) => (
          <motion.div
            key={`${word}-${startIndex + i}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: (startIndex + i) * 0.02 }}
            className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-border/60 bg-card transition-colors"
            data-testid={`word-row-${startIndex + i}`}
          >
            <Checkbox
              checked={checkedWords.has(word)}
              onCheckedChange={() => toggleChecked(word)}
              data-testid={`checkbox-word-${startIndex + i}`}
            />
            <span className="text-sm font-medium truncate">{word}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="relative overflow-hidden border-b border-border/50">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5 dark:from-primary/5 dark:via-transparent dark:to-primary/3" />
        <div className="relative max-w-2xl mx-auto px-4 py-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Mic2 className="w-8 h-8 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">
              Diss & Rhyme Generator
            </h1>
            <Music className="w-7 h-7 text-primary" />
          </div>
          <p className="text-muted-foreground text-sm">
            AIがターゲットを生成し、ディスワードと韻を提案します
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
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
            生成
          </button>
          <button
            onClick={() => setActiveTab("fav")}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === "fav"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
            }`}
            data-testid="tab-fav"
          >
            <Star className="w-4 h-4" />
            お気に入り一覧
            {favorites.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                {favorites.length}
              </Badge>
            )}
          </button>
        </div>

        {activeTab === "fav" ? (
          <div className="space-y-5">
            <Card>
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Star className="w-5 h-5 text-yellow-500" />
                    <h2 className="text-lg font-semibold">お気に入り一覧</h2>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={copyFavorites} data-testid="button-copy-favorites">
                      <Copy className="w-4 h-4 mr-1" />
                      一括コピー
                    </Button>
                    <Button variant="outline" size="sm" onClick={clearFavorites} data-testid="button-clear-favorites">
                      <Trash2 className="w-4 h-4 mr-1" />
                      全削除
                    </Button>
                  </div>
                </div>

                {favorites.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    お気に入りはまだありません。生成タブでワードを選択して追加してください。
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border border-border/50 bg-muted/20 p-3 font-mono text-sm whitespace-pre-wrap" data-testid="text-favorites-list">
                      {favorites.map((w) => `[${w}]`).join("")}
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        ワードをタップして韻を踏んだ悪口を生成：
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {favorites.map((word) => (
                          <Button
                            key={word}
                            variant={selectedFavWord === word ? "default" : "outline"}
                            size="sm"
                            onClick={() => handleRhymeGenerate(word)}
                            disabled={rhymeMutation.isPending}
                            className="text-sm"
                            data-testid={`button-rhyme-${word}`}
                          >
                            {word}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <AnimatePresence>
              {(selectedFavWord && (rhymeMutation.isPending || rhymeWords.length > 0)) && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                >
                  <Card>
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-center gap-2">
                        <Music className="w-5 h-5 text-primary" />
                        <h2 className="text-lg font-semibold">
                          「{selectedFavWord}」の韻ワード
                        </h2>
                      </div>

                      {rhymeMutation.isPending ? (
                        <div className="space-y-2">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Skeleton key={i} className="h-10 w-full rounded-md" />
                          ))}
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                            {rhymeWords.map((word, i) => (
                              <motion.div
                                key={`rhyme-${word}-${i}`}
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: i * 0.03 }}
                                className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-border/60 bg-card transition-colors"
                                data-testid={`rhyme-row-${i}`}
                              >
                                <Checkbox
                                  checked={checkedRhymes.has(word)}
                                  onCheckedChange={() => toggleRhymeChecked(word)}
                                  data-testid={`checkbox-rhyme-${i}`}
                                />
                                <span className="text-sm font-medium truncate">{word}</span>
                              </motion.div>
                            ))}
                          </div>
                          <Button
                            onClick={addRhymesToFavorites}
                            disabled={checkedRhymes.size === 0}
                            variant="destructive"
                            className="w-full"
                            data-testid="button-add-rhymes-favorites"
                          >
                            <Star className="w-4 h-4 mr-2" />
                            選択した韻ワードをお気に入りに追加 {checkedRhymes.size > 0 && `(${checkedRhymes.size})`}
                          </Button>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
        <>
        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <Crosshair className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">ターゲット設定</h2>
            </div>

            <div className="space-y-1">
              <label className="text-sm text-muted-foreground" htmlFor="name-input">
                名前を入力（任意）
              </label>
              <Input
                id="name-input"
                placeholder="例：ヒカキン、松本人志、岸田文雄..."
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                data-testid="input-name"
              />
              <p className="text-xs text-muted-foreground">
                入力すると指定した人物ベースで生成。空欄ならランダム生成。
              </p>
            </div>

            <div className="flex items-start gap-3">
              <Button
                onClick={() => targetMutation.mutate()}
                disabled={targetMutation.isPending}
                data-testid="button-generate-target"
              >
                {targetMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                人物を生成
              </Button>

              {target && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setTarget("");
                    setDissGroups(null);
                  }}
                  data-testid="button-reset-target"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              )}
            </div>

            <AnimatePresence mode="wait">
              {targetMutation.isPending ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <Skeleton className="h-12 w-full rounded-md" />
                </motion.div>
              ) : target ? (
                <motion.div
                  key="target"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="rounded-md bg-muted/50 dark:bg-muted/30 px-4 py-3 border border-border/50"
                >
                  <p className="text-sm text-muted-foreground mb-1">ターゲット:</p>
                  <div className="font-medium whitespace-pre-line text-sm leading-relaxed" data-testid="text-target">{target}</div>
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm text-muted-foreground italic"
                >
                  ボタンを押して架空のターゲットを生成しましょう
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Flame className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">レベル設定</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-2xl font-bold font-mono ${getLevelColor(level)}`} data-testid="text-level-number">
                  {level}
                </span>
                <span className="text-xs text-muted-foreground">/10</span>
              </div>
            </div>

            <div className="space-y-3">
              <Slider
                value={[level]}
                min={1}
                max={10}
                step={1}
                onValueChange={(val) => setLevel(val[0])}
                data-testid="slider-level"
              />
              <div className="flex items-center justify-between gap-1">
                <Badge variant="secondary" className="text-xs">
                  {getLevelLabel(level)}
                </Badge>
                <div className="flex gap-0.5">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-2 h-4 rounded-sm transition-colors ${
                        i < level
                          ? i < 3
                            ? "bg-green-500"
                            : i < 6
                              ? "bg-yellow-500"
                              : i < 8
                                ? "bg-orange-500"
                                : "bg-red-500"
                          : "bg-muted"
                      }`}
                    />
                  ))}
                </div>
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
                  <div className="flex items-start gap-3 rounded-md bg-destructive/10 border border-destructive/20 p-3">
                    <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <div className="space-y-2">
                      <p className="text-sm text-destructive font-medium">
                        過激な表現を含む可能性があります
                      </p>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={ageConfirmed}
                          onCheckedChange={(v) => setAgeConfirmed(!!v)}
                          data-testid="checkbox-age-confirm"
                        />
                        <span className="text-sm">18歳以上の過激な汚い表現を許可します</span>
                      </label>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <Button
              onClick={handleGenerateDiss}
              disabled={dissMutation.isPending || !target}
              className="w-full"
              data-testid="button-generate-diss"
            >
              {dissMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              ワード30個を生成（4文字×10 / 3文字×10 / 2文字×10）
            </Button>

            {generatedHistory.length > 0 && (
              <Button
                variant="outline"
                onClick={resetHistory}
                className="w-full"
                data-testid="button-reset-history"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                出現済みワードをリセット ({generatedHistory.length}個)
              </Button>
            )}
          </CardContent>
        </Card>

        <AnimatePresence>
          {(dissGroups || dissMutation.isPending) && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Zap className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-semibold">生成されたワード</h2>
                  </div>

                  {dissMutation.isPending ? (
                    <div className="space-y-2">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full rounded-md" />
                      ))}
                    </div>
                  ) : dissGroups ? (
                    <>
                    <div className="space-y-5">
                      {renderWordGroup("4文字", dissGroups.four, 0)}
                      {renderWordGroup("3文字", dissGroups.three, 10)}
                      {renderWordGroup("2文字", dissGroups.two, 20)}
                    </div>
                    <div className="mt-4">
                      <Button
                        onClick={addToFavorites}
                        disabled={checkedWords.size === 0}
                        variant="destructive"
                        className="w-full"
                        data-testid="button-add-favorites"
                      >
                        <Star className="w-4 h-4 mr-2" />
                        選択したワードをお気に入りに追加 {checkedWords.size > 0 && `(${checkedWords.size})`}
                      </Button>
                    </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
        </>
        )}
      </div>

      <footer className="text-center py-6 text-xs text-muted-foreground">
        Powered by Gemini AI
      </footer>
    </div>
  );
}
