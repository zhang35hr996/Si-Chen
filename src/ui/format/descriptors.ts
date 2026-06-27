export type DescriptorKind = "consort" | "heir";

export type ScaleId =
  | "appearance" | "health" | "favor" | "affection" | "fear" | "ambition"
  | "loyalty" | "power" | "clanPowerNation" | "diligence" | "effort" | "prestige"
  | "martial" | "statecraft" | "cruelty" | "regimeSecurity" | "military"
  | "publicSupport" | "productivity" | "governance" | "corruption"
  | "clanDiscontent" | "rumor" | "talent" | "virtue" | "closeness" | "support";

export interface DescriptorConfig {
  direction: "higher_is_better" | "lower_is_better";
  labels?: readonly string[];
  labelsByKind?: Partial<Record<DescriptorKind, readonly string[]>>;
}

export const DESCRIPTORS: Record<ScaleId, DescriptorConfig> = {
  appearance: {
    direction: "higher_is_better",
    labels: ["容貌丑陋", "其貌不扬", "姿色平庸", "容貌寻常", "小家碧玉", "眉目清秀", "姿容秀丽", "姿容出众", "惊为天人", "绝世之姿"],
  },
  health: {
    direction: "higher_is_better",
    labels: ["病入膏肓", "缠绵病榻", "体弱多病", "时常抱恙", "略显孱弱", "康健寻常", "身体康健", "精力充沛", "气血充盈", "康强无恙"],
  },
  favor: {
    direction: "higher_is_better",
    labelsByKind: {
      consort: ["失宠见弃", "久未承幸", "圣眷渐疏", "恩宠寥寥", "恩宠平平", "颇得青眼", "恩宠日盛", "盛宠加身", "专房之宠", "冠宠六宫"],
      heir: ["厌弃不顾", "冷眼相待", "少有顾念", "关怀渐疏", "宠爱平平", "略得疼爱", "颇受疼爱", "偏爱有加", "视若珍宝", "掌上明珠"],
    },
  },
  affection: {
    direction: "higher_is_better",
    labels: ["漠不关心", "情分淡薄", "略有好感", "渐感亲近", "心生暖意", "情意暗生", "倾心相待", "情意绵绵", "情深意重", "生死相许"],
  },
  fear: {
    direction: "higher_is_better",
    labels: ["毫无惧色", "略感不安", "心存忌惮", "谨小慎微", "惴惴不安", "战战兢兢", "心生怖惧", "惶惶难安", "畏之如虎", "魂飞魄散"],
  },
  ambition: {
    direction: "higher_is_better",
    labelsByKind: {
      consort: ["无欲无求", "安分守己", "略有念想", "小有所求", "暗藏心思", "颇有图谋", "所图不小", "志在高位", "野心勃勃", "欲掌六宫"],
      heir: ["闲云野鹤", "安分守己", "略有念想", "小有所求", "暗藏心思", "颇有图谋", "所图不小", "志在储位", "野心勃勃", "问鼎大位"],
    },
  },
  loyalty: {
    direction: "higher_is_better",
    labels: ["离心离德", "貌合神离", "心怀异志", "忠诚存疑", "中立观望", "尚知恭顺", "忠谨可信", "赤诚可托", "忠贞不贰", "一心奉国"],
  },
  power: {
    direction: "higher_is_better",
    labels: ["衰微无势", "势单力薄", "微末之家", "略有根基", "小有声势", "颇具势力", "根基深厚", "权重一方", "权势熏天", "权势滔天"],
  },
  clanPowerNation: {
    direction: "lower_is_better",
    labels: ["外戚不显", "外戚式微", "外戚势弱", "略有依仗", "渐有声势", "颇具权柄", "外戚得势", "把持要津", "权倾朝野", "外戚专权"],
  },
  diligence: {
    direction: "higher_is_better",
    labels: ["荒怠政务", "疏于朝政", "偶理政事", "勤怠无常", "尚知理政", "兢兢业业", "勤于政务", "夙兴夜寐", "宵衣旰食", "励精图治"],
  },
  effort: {
    direction: "higher_is_better",
    labels: ["懒散怠惰", "疏于课业", "偶尔用功", "时勤时惰", "尚知上进", "勤勉有加", "刻苦用功", "笃志好学", "悬梁刺股", "发奋忘食"],
  },
  prestige: {
    direction: "higher_is_better",
    labels: ["声名狼藉", "威信扫地", "威望寥寥", "声望平平", "略有声望", "颇有威信", "威望渐隆", "威震朝野", "德高望重", "威加海内"],
  },
  martial: {
    direction: "higher_is_better",
    labels: ["手无缚鸡之力", "文弱不堪", "略通拳脚", "身手平平", "略有武艺", "武艺娴熟", "身手矫健", "骁勇善战", "武艺超群", "万夫不当"],
  },
  statecraft: {
    direction: "higher_is_better",
    labels: ["毫无谋略", "不谙政事", "略通政务", "见识平平", "略有见地", "颇通谋略", "深谙政道", "老成谋国", "经天纬地", "雌才大略"],
  },
  cruelty: {
    direction: "lower_is_better",
    labels: ["仁德宽厚", "宽和少罚", "待下平和", "偶有苛责", "御下严厉", "用刑偏重", "刻薄寡恩", "酷烈无情", "暴戾恣睢", "嗜杀成性"],
  },
  regimeSecurity: {
    direction: "higher_is_better",
    labels: ["危如累卵", "风雨飘摇", "根基不稳", "暗流涌动", "略有隐忧", "大致安稳", "皇权稳固", "江山稳固", "固若金汤", "万世之基"],
  },
  military: {
    direction: "higher_is_better",
    labels: ["兵微将寡", "武备废弛", "军力薄弱", "兵力平平", "略可自保", "军备尚整", "兵强马壮", "军威赫赫", "所向披靡", "威震四海"],
  },
  publicSupport: {
    direction: "higher_is_better",
    labels: ["民怨沸腾", "民心离散", "民心浮动", "民心平平", "渐得民心", "民心安定", "民心归附", "深得民心", "万民拥戴", "四海归心"],
  },
  productivity: {
    direction: "higher_is_better",
    labels: ["百业凋敝", "耕织废弛", "生产低迷", "勉力维持", "渐有起色", "耕织渐兴", "百业复苏", "物产丰饶", "百业兴盛", "国富民殷"],
  },
  governance: {
    direction: "higher_is_better",
    labels: ["朝纲败坏", "政事荒废", "吏治松弛", "朝政平平", "渐有条理", "政务井然", "百官称职", "朝纲整肃", "政通人和", "朝政清明"],
  },
  corruption: {
    direction: "lower_is_better",
    labels: ["吏治清明", "廉风盛行", "贪墨鲜见", "偶有蝇营", "渐有贪风", "贪腐渐生", "贪墨成风", "贪赃枉法", "贪腐横行", "蠹政害民"],
  },
  clanDiscontent: {
    direction: "lower_is_better",
    labels: ["宗室和睦", "宗亲拥戴", "宗室安分", "偶有微词", "渐生嫌隙", "宗室不平", "宗室离心", "宗室怨怼", "暗有异动", "宗室离叛"],
  },
  rumor: {
    direction: "lower_is_better",
    labels: ["清平无谤", "流言鲜起", "偶有风言", "略有传闻", "渐起非议", "流言渐盛", "蜚短流长", "谣诼纷纭", "谣言四起", "众口铄金"],
  },
  talent: {
    direction: "higher_is_better",
    labels: ["资质愚钝", "略显迟钝", "天资平庸", "资质寻常", "尚有悟性", "颖悟可教", "天资聪颖", "聪慧过人", "七窍玲珑", "旷世奇才"],
  },
  virtue: {
    direction: "higher_is_better",
    labels: ["品行败坏", "顽劣不堪", "德行有亏", "品性寻常", "尚知礼义", "品行端正", "德行可嘉", "温良恭俭", "德行高洁", "仁德昭彰"],
  },
  closeness: {
    direction: "higher_is_better",
    labels: ["形同陌路", "离心疏远", "略显生分", "情分寻常", "渐生亲近", "颇为亲昵", "孺慕之情", "亲密无间", "依恋至深", "至爱至亲"],
  },
  support: {
    direction: "higher_is_better",
    labels: ["众皆反对", "孤立无援", "支持寥寥", "少有声援", "略有拥趸", "渐得人心", "颇受拥戴", "朝野属望", "众望所归", "天命所归"],
  },
};

const band = (v: number): number => Math.max(0, Math.min(9, Math.floor(v / 10)));

export function describe(scale: ScaleId, value: number, kind?: DescriptorKind): string {
  const cfg = DESCRIPTORS[scale];
  if (!cfg) return String(value);
  const labels = (kind && cfg.labelsByKind?.[kind]) ?? cfg.labels;
  return labels?.[band(value)] ?? String(value);
}

export function directionOf(scale: ScaleId): DescriptorConfig["direction"] {
  return DESCRIPTORS[scale]?.direction ?? "higher_is_better";
}

export function tone(scale: ScaleId, value: number): "good" | "bad" | "neutral" {
  const b = band(value);
  const high = b >= 7;
  const low = b <= 2;
  const positive = directionOf(scale) === "higher_is_better";
  if (positive) return high ? "good" : low ? "bad" : "neutral";
  return high ? "bad" : low ? "good" : "neutral";
}
