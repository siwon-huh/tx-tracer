import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { useI18n } from "./i18n";

type Theme = "light" | "dark";
const storageKey = "tx-tracer-theme";
const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Theme | null>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === "light" || saved === "dark" ? saved : null;
    } catch { return null; }
  });
  const [systemTheme, setSystemTheme] = useState<Theme>(() => matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const theme = preference || systemTheme;

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(media.matches ? "dark" : "light");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#111214" : "#fcfcfd");
  }, [theme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        setPreference(event.newValue === "light" || event.newValue === "dark" ? event.newValue : null);
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const value = useMemo(() => ({ theme, setTheme: (next: Theme) => {
    setPreference(next);
    try { localStorage.setItem(storageKey, next); } catch { /* The theme still works when storage is unavailable. */ }
  } }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle() {
  const context = useContext(ThemeContext);
  const { t } = useI18n();
  if (!context) throw new Error("ThemeProvider is required");
  return <div className="theme-toggle" role="group" aria-label={t("화면 테마")}>
    {([ ["light", Sun, "라이트 모드"], ["dark", Moon, "다크 모드"] ] as const).map(([theme, Icon, label]) =>
      <button key={theme} type="button" title={t(label)} aria-label={t(label)} aria-pressed={context.theme === theme} onClick={() => context.setTheme(theme)}>
        <Icon size={16} strokeWidth={1.7} />
      </button>)}
  </div>;
}
