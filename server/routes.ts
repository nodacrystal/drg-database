import type { Express } from "express";
import { createServer, type Server } from "http";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { z } from "zod";
import {
  getAllWords,
  getWordCount,
  getWordStrings,
  addWords,
  deleteWord,
  clearAllWords,
  exportWords,
} from "./storage";

const dissRequestSchema = z.object({
  target: z.string().min(1),
  level: z.number().int().min(1).max(10),
});

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
];

interface WordEntry {
  word: string;
  reading: string;
  romaji: string;
}

function extractVowels(romaji: string): string {
  return romaji.replace(/[^aeiou]/gi, "").toLowerCase();
}

function parseWordEntries(section: string): WordEntry[] {
  const normalized = section
    .replace(/、/g, ",")
    .replace(/\r\n/g, "\n");
  const lines = normalized.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const entries: WordEntry[] = [];
  for (const line of lines) {
    const items = line.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const item of items) {
      const match = item.match(/^(.+?)\s*[\/／]\s*([ぁ-ゟ]+)\s*[\(（]([a-zA-Z\s\-']+)[\)）]$/);
      if (match) {
        entries.push({
          word: match[1].trim(),
          reading: match[2].trim(),
          romaji: match[3].trim().toLowerCase(),
        });
      }
    }
  }
  return entries;
}

const GROUP_TARGETS: Record<number, number> = {
  2: 5,
  3: 30,
  4: 30,
  5: 20,
  6: 10,
  7: 5,
};

const GROUP_BUFFER: Record<number, number> = {
  2: 10,
  3: 45,
  4: 45,
  5: 30,
  6: 15,
  7: 10,
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  const TARGETS = [
    "松本人志,金髪・マッチョ・鋭い眼光,ダウンタウン・お笑い界の象徴,天才肌・カリスマ・孤独",
    "浜田雅功,スカジャン・派手な服装・老化,ダウンタウン・ツッコミの頂点,ドS・情に厚い・せっかち",
    "明石家さんま,出っ歯・細身・枯れない笑顔,お笑い怪獣・司会の神,サービス精神・自己愛・不眠",
    "ビートたけし,チック症・独特の体型,世界のキタノ・漫才ブーム火付け役,照れ屋・博識・バイオレンス",
    "タモリ,サングラス・落ち着いた佇まい,森田一義・密室芸出身,達観・多趣味・知的",
    "内村光平,優しそうな顔・小柄,ウッチャンナンチャン・コント職人,ストイック・謙虚・人見知り",
    "南原清隆,角張った顔・スポーティー,ウッチャンナンチャン・ヒルナンデス,真面目・社交的・古典芸能",
    "上田晋也,ちりちり髪・細身・司会者顔,くりぃむしちゅー・うんちく王,博識・例えツッコミ・自信家",
    "有田哲平,濃い顔・恰幅が良い,くりぃむしちゅー・プロレス好き,策士・エンタメ愛・お調子者",
    "太田光,落ち着きがない・若々しい,爆笑問題・時事漫才,暴走・知識欲・繊細",
    "田中裕二,小柄・片玉・猫好き,爆笑問題・ツッコミ担当,常識人・ギャンブル好き・頑固",
    "有吉弘行,毒のある笑顔・スーツ,猿岩石・再ブレイクの王,現実主義・毒舌・疑り深い",
    "マツコ・デラックス,大柄・女装・派手,コラムニスト出身,俯瞰的・情熱的・毒舌",
    "バカリズム,童顔・マッシュヘア,ピン芸人・脚本家,理屈っぽい・計算高い・毒舌",
    "設楽統,端正な顔立ち・清潔感,バナナマン・司会の王,冷静・Sっ気・鋭い観察眼",
    "日村勇紀,マッシュヘア・特徴的な顔・肥満,バナナマン・リアクション王,天真爛漫・愛されキャラ・卑屈",
    "若林正恭,童顔・猫背・斜に構えた目,オードリー・エッセイスト,内向的・ひねくれ・自意識過剰",
    "春日俊彰,テクノカット・ピンクベスト,オードリー・肉体派,図太い・ケチ・自信満々",
    "山里亮太,赤い眼鏡・くせ毛,南海キャンディーズ・天才司会者,嫉妬深い・努力家・逆襲",
    "しずちゃん,長身・ボクサー体型,南海キャンディーズ・俳優,マイペース・天然・純粋",
    "千鳥大悟,坊主・いかつい顔・酒焼け,千鳥・ロケの神,破天荒・漢気・昭和的",
    "千鳥ノブ,癖のある顔・ツッコミ顔,千鳥・パワーワードの達人,親しみやすい・ミーハー・強欲",
    "山内健司,サイコパス的な目・小太り,かまいたち・ロジカル漫才,傲慢・計算高い・自信家",
    "濱家隆一,高身長・清潔感・色気,かまいたち・多才司会者,神経質・泣き虫・上昇志向",
    "粗品,長い指・独特の髪型・細身,霜降り明星・M-1/R-1王者,傲慢・ギャンブル狂・天才自負",
    "せいや,小太り・多動・愛嬌,霜降り明星・モノマネ天才,天然・昭和愛・情緒不安定",
    "小峠英二,スキンヘッド・鋭い眼光,バイきんぐ・なんて日だ,真っ直ぐ・キレ芸・ロック好き",
    "西村瑞樹,無表情・サイコパス感,バイきんぐ・キャンプ芸人,マイペース・変人・無頓着",
    "富澤たけし,渋い声・がっしり体型,サンドウィッチマン・ネタ作成,寡黙・マイペース・情に厚い",
    "伊達みきお,金髪・眼鏡・ラグビー体型,サンドウィッチマン・好感度王,礼儀正しい・食いしん坊・漢気",
    "秋山竜次,黒髪ロング・恰幅・体モノマネ,ロバート・クリエイターズ,変態的・没頭型・天才",
    "博多大吉,長身・清潔感・紳士的,博多華丸・大吉,理知的・ドライ・自虐的",
    "博多華丸,目が大きい・笑顔・親父顔,博多華丸・大吉,陽気・飲み好き・地元愛",
    "礼二,車掌風・おじさん顔,中川家・モノマネ名人,職人気質・保守的・観察眼",
    "剛,細身・優しそうな顔,中川家・ボケ担当,繊細・マイペース・芸術家肌",
    "今田耕司,若々しい・独身の顔,ダウンタウンの系譜・司会,潔癖・仕事人間・寂しがり",
    "東野幸治,爬虫類顔・無機質な目,白い悪魔・司会,サイコパス・冷徹・好奇心",
    "劇団ひとり,端正な顔・演技派,ピン芸人・映画監督,憑依型・卑屈・自己愛",
    "陣内智則,シュッとした顔・スーツ,ピン芸人・映像ネタ,天然・不器用・モテ志向",
    "千原ジュニア,鋭い顔立ち・ジャックナイフ,千原兄弟・喋り手,神経質・ストイック・寂しがり",
    "千原せいじ,ガサツな顔・大柄,千原兄弟・ガサツの王,社交的・無神経・ポジティブ",
    "加藤浩次,狂犬・スーツ,極楽とんぼ・朝の顔,熱い・頑固・反骨心",
    "山本圭壱,肥満・おじさん顔,極楽とんぼ・不祥事からの復帰,天真爛漫・しぶとい・自由",
    "渡部建,清潔感・グルメ顔,アンジャッシュ・不祥事,計算高い・理論派・自惚れ",
    "児嶋一哉,普通の人・キレ顔,アンジャッシュ・大島さん,いじられ・真面目・天然",
    "藤森慎吾,チャラ男・眼鏡・筋肉,オリエンタルラジオ,社交的・マメ・ミーハー",
    "中田敦彦,理知的・独裁者風,オリエンタルラジオ・教育系,野心家・極端・自己愛",
    "ケンドーコバヤシ,髭・ガテン系・エロ顔,ピン芸人・ミスター深夜,エロ・多趣味・嘘つき",
    "川島明,ええ声・シュッとしている,麒麟・朝の顔,知的・安定感・大喜利中毒",
    "徳井義実,二枚目・猫好き,チュートリアル・脱税不祥事,変態的・マイペース・孤独",
    "福田充徳,細身・普通のおじさん,チュートリアル・バイク好き,謙虚・地味・お酒好き",
    "後藤輝基,鋭い目・スマート,フットボールアワー・例えツッコミ,せっかち・ミーハー・自信家",
    "岩尾望,ブサイクキャラ・お洒落,フットボールアワー・ボケ担当,繊細・マイペース・自分好き",
    "堀内健,自由人・若々しい,ネプチューン・ギャグマシン,破天荒・無垢・寂しがり",
    "名倉潤,タイ人風・彫りが深い,ネプチューン・ツッコミ,真面目・家族思い・神経質",
    "原田泰造,爽やか・筋肉質,ネプチューン・俳優,純粋・熱い・天然",
    "田中直樹,長身・面長,ココリコ・俳優,真面目・生き物オタク・卑屈",
    "遠藤章造,二枚目・野球好き,ココリコ・クセ歌,ポジティブ・チャラい・単純",
    "宮迫博之,ナルシスト・時計マニア,雨上がり決死隊・YouTuber,目立ちたがり・臆病・自信過剰",
    "蛍原徹,マッシュルームカット・競馬好き,雨上がり決死隊・ゴルフ好き,穏やか・頑固・常識人",
    "土田晃之,不機嫌そうな顔・家電芸人,元U-turn,ドライ・リアリスト・保守的",
    "カズレーザー,全身赤・金髪,メイプル超合金・クイズ王,合理的・冷淡・自由",
    "安藤なつ,巨漢・紫の服,メイプル超合金,穏やか・面倒見が良い・冷静",
    "サンシャイン池崎,タンクトップ・叫び,ピン芸人,真面目・貯金好き・孝行息子",
    "あばれる君,坊主・一生懸命な目,ピン芸人・サバイバル,熱血・不器用・空回り",
    "ひょっこりはん,マッシュヘア・眼鏡,ピン芸人,計算高い・一発屋の悲哀",
    "とにかく明るい安村,パンツ一丁・肥満,ピン芸人・世界進出,楽天家・しぶとい・小心者",
    "長田庄平,肩幅・器用な顔,チョコレートプラネット・小道具,職人・自信家・現実的",
    "松尾駿,IKKOモノマネ・小太り,チョコレートプラネット,愛嬌・社交的・戦略的",
    "森田哲矢,出っ歯・ストリート風,さらば青春の光・社長,野心家・下衆・仕事中毒",
    "東ブクロ,クズ顔・清潔感,さらば青春の光・不倫,無責任・マイペース・強メンタル",
    "津田篤宏,ゴイゴイスー・うるさい顔,ダイアン・いじられ,甘えん坊・小心者・天然",
    "ユースケ,独特の空気感・低音,ダイアン・ボケ,ひねくれ・シャイ・こだわり",
    "田中卓志,長身・キモキャラ,アンガールズ・紅茶好き,理知的・高学歴・マザコン",
    "山根良顕,ガリガリ・パパ芸人,アンガールズ,マイペース・頑固・脱力",
    "あんり,恰幅が良い・毒舌顔,ぼる塾・ツッコミ,冷静・強気・面倒見",
    "きりやはるか,不思議な笑顔,ぼる塾,天然・マイペース・図太い",
    "田辺智加,亀梨好き・スイーツ,ぼる塾,ポジティブ・マイペース・こだわり",
    "ナダル,白タートル・イっちゃってる目,コロコロチキチキペッパーズ,クズ・プライド高い・小心",
    "西野創人,普通の人・プロデューサー的,コロチキ,冷静・計算高い・努力家",
    "斎藤司,ハゲ・ナルシスト,トレンディエンジェル,自信満々・ミーハー・臆病",
    "たかし,ハゲ・アイドルオタク,トレンディエンジェル,無頓着・サイコパス・自由",
    "井上裕介,ナルシスト・小柄,NON STYLE,超ポジティブ・嫌われ・メンタル強",
    "石田明,真っ白・細身,NON STYLE・ネタ職人,ストイック・繊細・ネガティブ",
    "村上信五,八重歯・うるさい,関ジャニ∞・芸人枠,強欲・社交的・仕事人",
    "菊地亜美,うるさい顔・バラエティ,元アイドル,上昇志向・計算・お喋り",
    "野田クリスタル,筋肉・ゲーマー,マヂカルラブリー・三冠,天才自負・ストイック・シャイ",
    "村上,小太り・眼鏡・ピンク,マヂカルラブリー,常識人・酒好き・ツッコミ職人",
    "伊藤俊介,髭・眼鏡・サスペンダー,オズワルド・妹が有名,知的・プライド高い・妹想い",
    "畠中悠,不思議な顔・長身,オズワルド,天然・サイコパス・独特",
    "じろう,女装・コント顔,シソンヌ,憑依型・内向的・変態",
    "長谷川忍,高身長・眼鏡・お洒落,シソンヌ・ツッコミ,社交的・ミーハー・強気",
    "おいでやす小田,絶叫顔・眼鏡,ユニット,大声・真面目・小心者",
    "こがけん,オーマイガー・歌,ユニット,繊細・こだわり強・映画好き",
    "ハリウッドザコシショウ,裸・誇張,ピン芸人,ストイック・狂気・計算された笑い",
    "くっきー!,白塗り・タトゥー,野性爆弾,芸術家・狂気・後輩思い",
    "ロッシー,天然な笑顔,野性爆弾,宇宙人・超天然・善人",
    "西田幸治,髭・笑い飯,M-1王者,大喜利中毒・ひねくれ・職人",
    "哲夫,笑い飯・仏教好き,M-1王者,理屈っぽい・郷土愛・教育",
    "盛山晋太郎,長髪・いかつい,見取り図,熱い・いじられ・ミーハー",
    "リリー,塩顔・タトゥー,見取り図,サイコパス・マイペース・モテ",
    "井口浩之,小柄・前歯,ウエストランド・M-1王者,毒舌・僻み・お喋り",
    "河本太,普通・キャンプ,ウエストランド,無気力・天然・自分勝手",
    "渡辺隆,おじさん・AV好き,錦鯉,冷静・下衆・包容力",
    "長谷川雅紀,スキンヘッド・奥歯なし,錦鯉,純粋・天然・おバカ",
    "屋敷裕政,普通の若者・皮肉屋,ニューヨーク,毒舌・冷笑・上昇志向",
    "嶋佐和也,独特の顔・感性,ニューヨーク,変人・マイペース・こだわり",
    "芝大輔,リーゼント・男前,モグライダー,天才・社交的・器用",
    "ともしげ,滑舌悪い・巨漢,モグライダー,超天然・パニック・ポンコツ",
    "ヒコロヒー,煙草・やさぐれ,ピン芸人,サバサバ・読書家・冷静",
    "吉住,一重・コント顔,ピン芸人,内向的・闇・ストイック",
    "やす子,はい～・迷彩服,ピン芸人・自衛隊,純粋・働き者・実は頑固",
    "フワちゃん,派手・自撮り,YouTuber芸人,自由奔放・非常識・頭脳派",
    "あの,黒髪ボブ・独特な喋り,アーティスト芸人,偏食・内向的・鋭い",
    "向井慧,ラジオ・パンサー,MC,闇・真面目・分析",
    "菅良太郎,髭・パラパラ,パンサー,無口・猫・マイペース",
    "尾形貴弘,サンキュー・筋肉,パンサー,熱血・バカ・一生懸命",
    "斉藤慎二,濃い顔・不倫,ジャングルポケット,自惚れ・情熱・ギャンブル",
    "太田博久,筋肉・柔道,ジャングルポケット,真面目・愛妻家・地味",
    "おたけ,おたけサイコ・散髪,ジャングルポケット,おバカ・天然・ビジネス",
    "福田麻貴,ツッコミ・元アイドル,3時のヒロイン,しっかり者・野心・繊細",
    "かなで,巨漢・ダンス,3時のヒロイン,情熱・恋愛体質・自由",
    "ゆめっち,派手・休養,3時のヒロイン,天然・奔放・不安定",
    "小宮浩信,眼鏡・滑舌,三四郎,生意気・卑屈・実は熱い",
    "相田周二,良い声・普通,三四郎,マイペース・美食・金持ち",
    "友近,なりきり・演歌,ピン芸人,職人・こだわり・説教臭い",
    "渡辺直美,ビヨンセ・巨漢,ピン芸人,国際的・ポジティブ・努力",
    "ゆりやんレトリィバァ,変幻自在・英語,ピン芸人,天才・ストイック・変態",
    "キンタロー。,前田敦子・顔デカ,ピン芸人,憑依・必死・情緒",
    "永野,シェー・ラッセン,ピン芸人,孤高・ひねくれ・実は真面目",
    "小島よしお,そんなの関係ねえ・筋肉,ピン芸人,教育的・ポジティブ・努力",
    "狩野英孝,スタッフー・神主,ピン芸人,超天然・愛され・ポンコツ",
    "出川哲朗,ヤバイよ・リアクション,ピン芸人,一生懸命・誠実・バカ",
    "上島竜兵,帽子くるりん・キス,ダチョウ倶楽部,繊細・寂しがり・芸人愛",
    "肥後克広,リーダー・モノマネ,ダチョウ倶楽部,天然・包容力・お酒",
    "寺門ジモン,肉・ネイチャー,ダチョウ倶楽部,変執狂・多弁・こだわり",
    "江頭2:50,黒タイツ・YouTube,ピン芸人,伝説・シャイ・真面目",
    "久本雅美,よろぴく・細身,WAHAHA本舗,パワフル・寂しがり・信心深い",
    "柴田理恵,号泣・おばさん,WAHAHA本舗,情に厚い・お酒・庶民",
    "いとうあさこ,レオタード・老化,ピン芸人,明るい・お酒・寂しがり",
    "大久保佳代子,OL風・性欲,オアシズ,現実的・卑屈・実は乙女",
    "光浦靖子,眼鏡・手芸,オアシズ,知的・繊細・留学",
    "黒沢かずこ,千手観音・独身,森三中,極度の人見知り・変態・純粋",
    "村上知子,主婦・小太り,森三中,現実的・毒舌・しっかり者",
    "大島美幸,坊主・体当たり,森三中,漢気・純粋・家族愛",
    "近藤春菜,角野卓造・眼鏡,ハリセンボン,社交的・仕事人間・マメ",
    "箕輪はるか,死神・歯が黒い,ハリセンボン,内向的・知的・マイペース",
    "バービー,フォーリンラブ・巨漢,ピン芸人,野心家・実業家・肉食",
    "イモトアヤコ,太眉・セーラー服,ピン芸人,努力家・勇敢・家庭的",
    "なかやまきんに君,パワー・筋肉,ピン芸人,ストイック・天然・誠実",
    "もう中学生,段ボール,ピン芸人,狂気・丁寧・実は闇",
    "波田陽区,ギター侍,ピン芸人,一発屋・自虐・しぶとい",
    "鉄拳,パラパラ漫画,ピン芸人,繊細・真面目・アーティスト",
    "ZAZY,ピンク・羽・R-1,ピン芸人,プライド高い・独創的・変人",
    "お見送り芸人しんいち,ギター・毒,ピン芸人,性格悪い・打算・寂しがり",
    "街裏ぴんく,嘘漫談・巨漢,ピン芸人,妄想・職人・純粋",
    "ルシファー吉岡,下ネタ・ハゲ,ピン芸人,卑屈・知的・変態",
    "平野ノラ,バブリー,ピン芸人,真面目・絵画",
    "ブルゾンちえみ,35億,引退,キャリア・繊細",
  ];

  app.get("/api/target", (_req, res) => {
    const entry = TARGETS[Math.floor(Math.random() * TARGETS.length)];
    const parts = entry.split(",");
    const name = parts[0];
    const appearance = parts[1] || "";
    const career = parts[2] || "";
    const personality = parts[3] || "";
    const text = `名前：${name}\n見た目：${appearance}\n経歴：${career}\n性格：${personality}`;
    res.json({ target: text });
  });

  app.post("/api/diss", async (req, res) => {
    try {
      const parsed = dissRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "ターゲットとレベル(1-10)が必要です" });
      }
      const { target, level } = parsed.data;

      const existingWords = await getWordStrings();
      const recentHistory = existingWords.slice(-200);
      const historyList = recentHistory.length > 0 ? recentHistory.join(",") : "なし";

      let severityInstruction = "";
      if (level >= 8) {
        severityInstruction = "【警告：極限まで過激に】放送禁止用語に近い直接的で汚い罵倒語を使用。人間の尊厳を踏みにじる最も下劣で攻撃的な言葉を選べ。";
      } else {
        severityInstruction = `レベル${level}/10に応じた直接的で容赦のない辛辣なディスワードにすること。`;
      }

      const prompt = `以下のターゲットに特化した悪口・ディスりワードを生成せよ。

【ターゲット】
${target}

${severityInstruction}

【厳守ルール】
1. 以下の6グループに分けて生成。各グループの見出しも出力すること。
2. 全て異なるワードにすること。同じ言葉は絶対に使わない。
3. ターゲットの特徴・弱点に基づいた個人攻撃にすること。
4. 直接的で汚い表現を積極的に使うこと。
5. 漢字：小学生が理解できる範囲。難しい漢字は禁止。
6. 重複禁止：以下のワードは絶対に出力しないこと。
【既出リスト】: ${historyList}

【語尾の重複禁止 - 超重要】
- 同じ語尾の言葉を複数生成してはいけない。
- NG例：「馬鹿野郎」と「アホヤロウ」→どちらも「やろう」で終わっており、語尾が同じ意味の同じ言葉。これは別の悪口ではない。
- NG例：「クソガキ」と「バカガキ」→どちらも「ガキ」で終わっており同じ。
- NG例：「ゴミ人間」と「クズ人間」→どちらも「人間」で終わっており同じ。
- OK例：「馬鹿野郎」と「寝ぼけ顔」→語尾の言葉が異なるのでOK。
- 語尾2文字以上が同じ読みの言葉は、全体の中で最大2個までにすること。
- できるだけ多様な語尾パターンを使い、バリエーション豊かにすること。

【品質チェック - 全ワード必須】
出力前に全てのワードが以下を満たすか確認せよ：
1. その言葉だけで意味が通じるか？意味不明な造語は不可。
2. その言葉は悪口、または相手への痛烈な批判・指摘になっているか？
3. 既出リストに存在しないか？
4. 他のワードと語尾が被っていないか？
→ 1つでも不合格なら、そのワードを別のワードに差し替えること。

【文字数ルール - 超重要・厳守】
- 文字数は「全てひらがなに変換したときの文字数」でカウントする。
- 拗音（しゃ、きょ等の小さい文字）も1文字。促音（っ）も1文字。撥音（ん）も1文字。
- 具体例：
  2文字：クズ→くず、カス→かす、ゴミ→ごみ
  3文字：ダサい→ださい、無能→むのう、ヘタレ→へたれ
  4文字：うそつき→うそつき、ゴミクズ→ごみくず
  5文字：できそこない→できそこない、はらぐろい→はらぐろい
  6文字：おちぶれやろう→おちぶれやろう
  7文字：のうたりんやろう→のうたりんやろう
- 必ず出力前にひらがなに変換して文字数を指折り確認すること！

【出力フォーマット - 厳守】
各ワードは「ワード/ひらがな読み(romaji)」形式。スラッシュの後にひらがな読み、括弧内にローマ字（全ての文字に母音を含めた読み）。
===2文字===
ワード/ひらがな(romaji),...(${GROUP_BUFFER[2]}個 ※目標${GROUP_TARGETS[2]}個)
===3文字===
ワード/ひらがな(romaji),...(${GROUP_BUFFER[3]}個 ※目標${GROUP_TARGETS[3]}個)
===4文字===
ワード/ひらがな(romaji),...(${GROUP_BUFFER[4]}個 ※目標${GROUP_TARGETS[4]}個)
===5文字===
ワード/ひらがな(romaji),...(${GROUP_BUFFER[5]}個 ※目標${GROUP_TARGETS[5]}個)
===6文字===
ワード/ひらがな(romaji),...(${GROUP_BUFFER[6]}個 ※目標${GROUP_TARGETS[6]}個)
===7文字===
ワード/ひらがな(romaji),...(${GROUP_BUFFER[7]}個 ※目標${GROUP_TARGETS[7]}個)

【例】
===2文字===
クズ/くず(kuzu),カス/かす(kasu),ブタ/ぶた(buta)...
===3文字===
ダサい/ださい(dasai),無能/むのう(munou),ヘタレ/へたれ(hetare)...
===4文字===
嘘つき/うそつき(usotsuki),ゴミクズ/ごみくず(gomikuzu)...`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          maxOutputTokens: 16384,
          safetySettings,
        },
      });

      const text = response.text || "";

      const groups: Record<string, WordEntry[]> = {
        seven: [],
        six: [],
        five: [],
        four: [],
        three: [],
        two: [],
      };

      const charCountToKey: Record<number, string> = {
        7: "seven",
        6: "six",
        5: "five",
        4: "four",
        3: "three",
        2: "two",
      };

      const seen = new Set<string>(existingWords);
      const allEntries = parseWordEntries(text);

      const suffixCounts: Record<string, number> = {};

      for (const entry of allEntries) {
        if (seen.has(entry.word)) continue;
        seen.add(entry.word);

        const reading = entry.reading;
        let skipDueSuffix = false;
        for (let sLen = 2; sLen <= Math.min(reading.length - 1, 4); sLen++) {
          const readingSuffix = reading.slice(-sLen);
          const key2 = `${sLen}:${readingSuffix}`;
          const count = suffixCounts[key2] || 0;
          if (count >= 2) {
            skipDueSuffix = true;
            break;
          }
        }
        if (skipDueSuffix) continue;

        const charCount = entry.reading.length;
        const key = charCountToKey[charCount];
        const target = GROUP_TARGETS[charCount];

        if (key && target && groups[key].length < target) {
          groups[key].push(entry);
          for (let sLen = 2; sLen <= Math.min(reading.length - 1, 4); sLen++) {
            const readingSuffix = reading.slice(-sLen);
            const key2 = `${sLen}:${readingSuffix}`;
            suffixCounts[key2] = (suffixCounts[key2] || 0) + 1;
          }
        }
      }

      res.json({ groups });
    } catch (error) {
      console.error("Diss generation error:", error);
      res.status(500).json({ error: "ワード生成に失敗しました" });
    }
  });

  app.get("/api/favorites", async (_req, res) => {
    try {
      const allWords = await getAllWords();

      type WordItem = {
        id: number;
        word: string;
        reading: string;
        romaji: string;
        vowels: string;
        charCount: number;
      };

      const items: WordItem[] = allWords.map((w) => ({
        id: w.id,
        word: w.word,
        reading: w.reading,
        romaji: w.romaji,
        vowels: w.vowels,
        charCount: w.charCount,
      }));

      function getSuffixVowels(vowels: string, len: number): string {
        return vowels.slice(-len);
      }

      const grouped: Record<string, WordItem[]> = {};
      const assigned = new Set<number>();

      function getReadingSuffix(reading: string, len: number): string {
        return reading.slice(-len);
      }

      function filterSameReadingSuffix(words: WordItem[]): WordItem[] {
        if (words.length < 2) return words;
        const readingSuffixCounts: Record<string, number> = {};
        const result: WordItem[] = [];
        for (const w of words) {
          const minSuffix = Math.min(2, w.reading.length);
          const rSuffix = w.reading.slice(-minSuffix);
          const count = readingSuffixCounts[rSuffix] || 0;
          if (count < 2) {
            readingSuffixCounts[rSuffix] = count + 1;
            result.push(w);
          }
        }
        return result;
      }

      for (let suffixLen = 5; suffixLen >= 2; suffixLen--) {
        const buckets: Record<string, WordItem[]> = {};
        for (const item of items) {
          if (assigned.has(item.id)) continue;
          if (item.vowels.length < suffixLen) continue;
          const suffix = getSuffixVowels(item.vowels, suffixLen);
          if (!buckets[suffix]) buckets[suffix] = [];
          buckets[suffix].push(item);
        }
        for (const [suffix, words] of Object.entries(buckets)) {
          const filtered = filterSameReadingSuffix(words);
          if (filtered.length >= 2) {
            const key = `*${suffix}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(...filtered);
            for (const w of filtered) assigned.add(w.id);
          }
        }
      }

      for (const item of items) {
        if (assigned.has(item.id)) continue;
        const suffix = item.vowels.length >= 1 ? `*${item.vowels.slice(-1)}` : "*";
        if (!grouped[suffix]) grouped[suffix] = [];
        grouped[suffix].push(item);
        assigned.add(item.id);
      }

      const sortedGroups = Object.entries(grouped)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([vowels, words]) => ({ vowels, words }));

      res.json({ groups: sortedGroups, total: allWords.length });
    } catch (error) {
      console.error("Favorites fetch error:", error);
      res.status(500).json({ error: "お気に入りの取得に失敗しました" });
    }
  });

  app.post("/api/favorites", async (req, res) => {
    try {
      const schema = z.object({
        words: z.array(z.object({
          word: z.string().min(1),
          reading: z.string().min(1),
          romaji: z.string().min(1),
        })),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "不正なデータです" });
      }

      const entries = parsed.data.words.map((w) => ({
        word: w.word,
        reading: w.reading,
        romaji: w.romaji,
        vowels: extractVowels(w.romaji),
        charCount: w.reading.length,
      }));

      const added = await addWords(entries);
      const total = await getWordCount();
      res.json({ added, total });
    } catch (error) {
      console.error("Favorites add error:", error);
      res.status(500).json({ error: "お気に入りの追加に失敗しました" });
    }
  });

  app.delete("/api/favorites/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "不正なIDです" });
      await deleteWord(id);
      const total = await getWordCount();
      res.json({ success: true, total });
    } catch (error) {
      console.error("Favorites delete error:", error);
      res.status(500).json({ error: "削除に失敗しました" });
    }
  });

  app.delete("/api/favorites", async (_req, res) => {
    try {
      await clearAllWords();
      res.json({ success: true, total: 0 });
    } catch (error) {
      console.error("Favorites clear error:", error);
      res.status(500).json({ error: "全削除に失敗しました" });
    }
  });

  app.get("/api/favorites/count", async (_req, res) => {
    try {
      const total = await getWordCount();
      res.json({ total });
    } catch (error) {
      res.status(500).json({ error: "カウント取得に失敗しました" });
    }
  });

  app.get("/api/favorites/export", async (_req, res) => {
    try {
      const data = await exportWords();
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(data);
    } catch (error) {
      res.status(500).json({ error: "エクスポートに失敗しました" });
    }
  });

  return httpServer;
}
