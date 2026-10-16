import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translateText, type Language } from "./translations";

type I18n = { language: Language; locale: string; setLanguage: (language: Language) => void; t: <T>(value: T) => T };
const Context = createContext<I18n | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try { return localStorage.getItem("atlas-language") === "en" ? "en" : "ko"; } catch { return "ko"; }
  });
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === "ko" ? "Tx Tracer | 자금 이동 경로 추적" : "Tx Tracer | Cross-chain transaction explorer";
    document.querySelector('meta[name="description"]')?.setAttribute("content", language === "ko"
      ? "트랜잭션과 주소를 검색하고 송금과 브릿지의 연결 경로를 확인하세요."
      : "Search transactions and addresses to explore connected transfers and bridge routes.");
    try { localStorage.setItem("atlas-language", language); } catch { /* Language still works without storage. */ }
  }, [language]);
  const value = useMemo<I18n>(() => ({ language, locale: language === "ko" ? "ko-KR" : "en-US", setLanguage,
    t: <T,>(value: T): T => typeof value === "string" ? translateText(value, language) as T : value,
  }), [language]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n() {
  const value = useContext(Context);
  if (!value) throw new Error("I18nProvider is required");
  return value;
}
export function LanguageToggle() {
  const { language, setLanguage, t } = useI18n();
  return <div className="language-toggle" role="group" aria-label={t("언어 선택")}>
    <button type="button" lang="ko" aria-pressed={language === "ko"} onClick={() => setLanguage("ko")}>한국어</button>
    <button type="button" lang="en" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button>
  </div>;
}
