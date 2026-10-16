import messages from "./messages.en.json";
import publicKorean from "./messages.ko.json";

export type Language = "ko" | "en";

// Keep source data unchanged. Only display copy is normalized and translated.
export const cleanDisplayText = (text: string) => text.replace(/[·・]/g, " / ").replace(/[—–]/g, "-");
const normalize = (text: string) => cleanDisplayText(text).replace(/\s+/g, " ").trim();
const english: Record<string, string> = messages;
const korean: Record<string, string> = {
  ...publicKorean,
  "CROSS-CHAIN INTELLIGENCE": "크로스체인 거래 분석", EXPLORER: "탐색기",
  "FOLLOW THE TRANSACTION": "거래의 흐름을 따라", "CROSS-CHAIN": "크로스체인",
  "ROUTE INSPECTOR": "경로 분석", "MESSAGE / ORDER ID": "메시지 / 주문 ID",
  receipt: "거래 확인", routes: "경로", chains: "체인", s: "초", "s /": "초 /",
  "TRACING ACROSS CHAINS": "체인 간 경로 조회 중", "TRACE RESULT": "조회 결과",
  "FLOW EXPLORER": "자금 흐름 탐색", checks: "조회", "CROSS-CHAIN ROUTE MAP": "크로스체인 경로맵",
  SOURCE: "출발", PROTOCOL: "프로토콜", DESTINATION: "도착",
  "PROTOCOL COVERAGE": "프로토콜 지원 범위", "RECENT INVESTIGATIONS": "최근 조회",
  INDEXED: "기록 확인", FLOW: "흐름", "ON-CHAIN RECEIPT": "온체인 거래 확인",
  "CONTRACT EVENT": "컨트랙트 이벤트", "PROTOCOL INDEXER": "프로토콜 기록",
  "awaiting query": "검색 대기", "token": "토큰", TX: "거래",
  "via {0}": "{0} 경유", "/ {0} queried": "/ {0}개 조회",
};

type Rule = { pattern: RegExp; replacement: string; slots: number[]; specificity: number };
function rulesFor(dictionary: Record<string, string>): Rule[] {
  return Object.entries(dictionary).filter(([key]) => /\{\d+\}/.test(key)).map(([key, replacement]) => {
    const slots: number[] = [];
    let pattern = "", cursor = 0;
    for (const match of key.matchAll(/\{(\d+)\}/g)) {
      pattern += escape(key.slice(cursor, match.index)) + "(.*?)";
      slots.push(Number(match[1]));
      cursor = match.index! + match[0].length;
    }
    pattern += escape(key.slice(cursor));
    return { pattern: new RegExp(`^${pattern}$`, "s"), replacement, slots,
      specificity: key.replace(/\{\d+\}/g, "").length };
  }).sort((a, b) => b.specificity - a.specificity);
}
function escape(text: string) { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
const englishRules = rulesFor(english);
const koreanRules = rulesFor(korean);

function translateCore(text: string, language: Language, depth: number): string {
  const dictionary = language === "en" ? english : korean;
  if (Object.hasOwn(dictionary, text)) return dictionary[text];
  if (depth > 8) return text;
  for (const rule of language === "en" ? englishRules : koreanRules) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const values = new Map(rule.slots.map((slot, index) => [slot, translateCore(match[index + 1], language, depth + 1)]));
    return rule.replacement.replace(/\{(\d+)\}/g, (_, slot) => values.get(Number(slot)) || "");
  }
  // Composite provider labels may join several independently translated fields.
  if (text.includes(" / ")) return text.split(" / ").map(part => translateCore(part, language, depth + 1)).join(" / ");
  return text;
}

export function translateText(text: string, language: Language): string {
  // A node hostname is operational detail; the block number remains useful evidence.
  const publicText = text.replace(/^(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\s*[·/]\s*(?=block \d+)/i, "");
  const cleaned = cleanDisplayText(publicText);
  const normalized = normalize(publicText);
  if (!normalized) return cleaned;
  const translated = translateCore(normalized, language, 0);
  // Preserve JSX spacing and multi-line user input when no translation applies.
  if (translated === normalized) return cleaned;
  return `${cleaned.match(/^\s*/)?.[0] || ""}${translated}${cleaned.match(/\s*$/)?.[0] || ""}`;
}
