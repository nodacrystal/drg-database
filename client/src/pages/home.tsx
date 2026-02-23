import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import {
  Crosshair,
  Flame,
  Mic2,
  RotateCcw,
  Sparkles,
  Volume2,
  Zap,
  AlertTriangle,
  Music,
  Loader2,
  PenLine,
  Trophy,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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
  const [target, setTarget] = useState<string>("");
  const [level, setLevel] = useState<number>(5);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [dissWords, setDissWords] = useState<string[]>([]);
  const [selectedWord, setSelectedWord] = useState<string>("");
  const [rhymes, setRhymes] = useState<string[]>([]);
  const [rhymeDialogOpen, setRhymeDialogOpen] = useState(false);
  const [finalWord, setFinalWord] = useState<string>("");
  const [finalRhymes, setFinalRhymes] = useState<{ word: string; score: number; vowels: string }[]>([]);

  const targetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/target");
      return res.json();
    },
    onSuccess: (data: { target: string }) => {
      setTarget(data.target);
      setDissWords([]);
      setRhymes([]);
    },
    onError: () => {
      toast({ title: "エラー", description: "ターゲット生成に失敗しました", variant: "destructive" });
    },
  });

  const dissMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/diss", { target, level });
      return res.json();
    },
    onSuccess: (data: { words: string[] }) => {
      setDissWords(data.words);
    },
    onError: () => {
      toast({ title: "エラー", description: "ワード生成に失敗しました", variant: "destructive" });
    },
  });

  const rhymeMutation = useMutation({
    mutationFn: async (word: string) => {
      const res = await apiRequest("POST", "/api/rhyme", { word, level });
      return res.json();
    },
    onSuccess: (data: { rhymes: string[] }) => {
      setRhymes(data.rhymes);
      setRhymeDialogOpen(true);
    },
    onError: () => {
      toast({ title: "エラー", description: "韻の生成に失敗しました", variant: "destructive" });
    },
  });

  const finalRhymeMutation = useMutation({
    mutationFn: async (word: string) => {
      const res = await apiRequest("POST", "/api/final_rhyme", { word });
      return res.json();
    },
    onSuccess: (data: { rhymes: { word: string; score: number; vowels: string }[] }) => {
      setFinalRhymes(data.rhymes);
    },
    onError: () => {
      toast({ title: "エラー", description: "韻の生成に失敗しました", variant: "destructive" });
    },
  });

  const handleFinalRhyme = useCallback(() => {
    if (!finalWord.trim()) {
      toast({ title: "入力エラー", description: "ワードを入力してください" });
      return;
    }
    setFinalRhymes([]);
    finalRhymeMutation.mutate(finalWord.trim());
  }, [finalWord, finalRhymeMutation, toast]);

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

  const handleWordClick = useCallback(
    (word: string) => {
      setSelectedWord(word);
      rhymeMutation.mutate(word);
    },
    [rhymeMutation],
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
            AIがターゲットを生成し、ディスワードと韻を踏むフレーズを提案します
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <Crosshair className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">ターゲット設定</h2>
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
                    setDissWords([]);
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
                  <p className="font-medium" data-testid="text-target">{target}</p>
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
                        <span className="text-sm">私は18歳以上です</span>
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
              ディスりワード20個生成
            </Button>
          </CardContent>
        </Card>

        <AnimatePresence>
          {(dissWords.length > 0 || dissMutation.isPending) && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Volume2 className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-semibold">ワードを選択して韻を踏む</h2>
                  </div>

                  {dissMutation.isPending ? (
                    <div className="space-y-2">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full rounded-md" />
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {dissWords.map((word, i) => (
                        <motion.div
                          key={`${word}-${i}`}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: i * 0.03 }}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleWordClick(word)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleWordClick(word); }}
                          className={`group relative text-left px-4 py-2.5 rounded-md border border-border/60 bg-card transition-colors cursor-pointer hover:border-primary/40 hover:bg-primary/5`}
                          data-testid={`button-word-${i}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-mono w-5">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="text-sm font-medium truncate">{word}</span>
                          </div>
                          {rhymeMutation.isPending && selectedWord === word && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                              <Loader2 className="w-4 h-4 animate-spin text-primary" />
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {dissWords.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <Card>
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <PenLine className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-semibold" data-testid="text-final-heading">最終的なディスりワードを決定</h2>
                  </div>

                  <div className="flex gap-2">
                    <Input
                      value={finalWord}
                      onChange={(e) => setFinalWord(e.target.value)}
                      placeholder="悪口を入力..."
                      onKeyDown={(e) => { if (e.key === "Enter") handleFinalRhyme(); }}
                      data-testid="input-final-word"
                    />
                    <Button
                      onClick={handleFinalRhyme}
                      disabled={finalRhymeMutation.isPending}
                      data-testid="button-final-rhyme"
                    >
                      {finalRhymeMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <Mic2 className="w-4 h-4 mr-2" />
                      )}
                      韻を生成
                    </Button>
                  </div>

                  {finalRhymeMutation.isPending && (
                    <div className="space-y-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full rounded-md" />
                      ))}
                    </div>
                  )}

                  {finalRhymes.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 pt-2">
                        <Trophy className="w-4 h-4 text-yellow-500" />
                        <h3 className="text-sm font-semibold text-muted-foreground">韻のランク（母音一致数順）</h3>
                      </div>
                      {finalRhymes.map((item, i) => (
                        <motion.div
                          key={`${item.word}-${i}`}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-muted/40 dark:bg-muted/20 border border-border/40"
                          data-testid={`text-final-rhyme-${i}`}
                        >
                          <Badge variant="outline" className="text-xs font-mono shrink-0">
                            {item.score}文字一致
                          </Badge>
                          <span className="text-sm font-medium">{item.word}</span>
                          <span className="text-xs text-muted-foreground ml-auto font-mono">(母音: {item.vowels})</span>
                        </motion.div>
                      ))}
                    </div>
                  )}

                  {!finalRhymeMutation.isPending && finalRhymes.length === 0 && finalRhymeMutation.isSuccess && (
                    <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-final-empty">
                      韻を踏むワードが見つかりませんでした
                    </p>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Dialog open={rhymeDialogOpen} onOpenChange={setRhymeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mic2 className="w-5 h-5 text-primary" />
              <span>「{selectedWord}」の韻リスト</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {rhymes.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                韻を踏むワードが見つかりませんでした
              </div>
            ) : (
              rhymes.map((rhyme, i) => (
                <motion.div
                  key={`${rhyme}-${i}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted/40 dark:bg-muted/20 border border-border/40"
                  data-testid={`text-rhyme-${i}`}
                >
                  <span className="text-xs text-primary font-mono font-bold">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm font-medium">{rhyme}</span>
                </motion.div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <footer className="text-center py-6 text-xs text-muted-foreground">
        Powered by Gemini AI
      </footer>
    </div>
  );
}
