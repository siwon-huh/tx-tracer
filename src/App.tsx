import { useI18n, LanguageToggle } from "./i18n";
import { ThemeToggle } from "./theme";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDown,
  Plus,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Copy,
  Database,
  GitFork,
  Globe2,
  HelpCircle,
  History,
  Layers3,
  LoaderCircle,
  Menu,
  Network,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import type {
  BridgeRoute,
  Diagnostic,
  Leg,
  TraceResult,
  InvestigationRequest,
} from "../shared/types";
import Graph from "./Graph";
import { short, amountLabel } from "./format";
import { requestJson } from "./api";
import { InvestigationForm, InvestigationSummary } from "./Investigation";
import { BridgeLogo, ChainLogo } from "./BrandLogo";
type Config = {
  chains: { id: string; name: string; family: string; rpcCount: number }[];
};
type Saved = { query: string; chainId?: string; at: string; count: number; request?: InvestigationRequest };
const statusLabels: Record<string, string> = {
  delivered: "도착 확인",
  pending: "처리 중",
  failed: "실패",
  refunded: "환불",
  observed: "한쪽 확인",
  unknown: "확인 필요",
};
const demo =
  "0x3fe11542154f53dcf3134eacb30ea5ca586c9e134c223e56bbe1893862469bc5";
const fmtDate = (v?: string, locale = "ko-KR") =>
  v
    ? new Date(v).toLocaleString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "시간 미제공";
function Brand() {
  return <div className="brand">
    <img className="project-logo" src="/tx-tracer-logo.jpg" alt="" width={40} height={40} />
    <span>Tx Tracer</span>
  </div>;
}
function Status({ value }: { value: string }) {
  const { t: tr } = useI18n();
  return (
    <span className={`status ${value}`}>
      <span />
      {tr(statusLabels[value] || value)}
    </span>
  );
}
function CopyButton({ text }: { text: string }) {
  const { t: tr } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-button"
      aria-label={tr("복사")}
      title={tr("복사")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}
function LegDetails({ leg, label }: { leg: Leg; label: string }) {
  const { t: tr, locale } = useI18n();
  return (
    <div className="leg-details">
      <div className="detail-label">
        <span>{tr(label)}</span>
        <strong className="chain-label"><ChainLogo chainId={leg.chainId} name={leg.chain} size={20} />{tr(leg.chain)}</strong>
        {leg.receiptVerified && (
          <span className="mini-verified">
            <Check size={11} />{tr(" receipt ")}</span>
        )}
      </div>
      <div className="detail-amount">{tr(amountLabel(leg, false))}</div>
      {!leg.amount && leg.rawAmount && (
        <div className="kv">
          <span>{tr("원시 수량")}</span>
          <code>{tr(leg.rawAmount)}</code>
          <CopyButton text={leg.rawAmount} />
        </div>
      )}
      <div className="kv">
        <span>{tr("주소")}</span>
        <code>{tr(leg.address || "확인되지 않음")}</code>
        {leg.address && <CopyButton text={leg.address} />}
      </div>
      <div className="kv">
        <span>{tr("TX 해시")}</span>
        <code>{tr(leg.txHash || "연결된 거래 없음")}</code>
        {leg.txHash && <CopyButton text={leg.txHash} />}
      </div>
      {leg.tokenAddress && (
        <div className="kv">
          <span>{tr("토큰")}</span>
          <code>{tr(leg.tokenAddress)}</code>
        </div>
      )}
      <div className="leg-foot">
        <span>{tr(fmtDate(leg.timestamp, locale))}</span>
        {leg.explorerUrl && (
          <a href={leg.explorerUrl} target="_blank" rel="noreferrer">{tr(" 탐색기 ")}<ArrowUpRight size={13} />
          </a>
        )}
      </div>
    </div>
  );
}
function EvidencePanel({ route }: { route: BridgeRoute }) {
  const { t: tr, locale } = useI18n();
  const [tab, setTab] = useState("details");
  return (
    <aside className="evidence-panel">
      <div className="panel-title">
        <div>
          <h3>{tr("경로 상세")}</h3>
        </div>
        <ShieldCheck size={21} />
      </div>
      <div className="inspector-summary">
        <BridgeLogo name={route.bridge} protocol={route.protocol} sourceChainId={route.source.chainId} destinationChainId={route.destination.chainId} size={32} />
        <div>
          <strong>{tr(route.bridge)}</strong>
          <small>
            {tr(route.aggregator
              ? `${route.aggregator} 경유`
              : "프로토콜 직접 조회")}
          </small>
        </div>
        <Status value={route.status} />
      </div>
      <div className="panel-tabs">
        <button
          className={tab === "details" ? "active" : ""}
          onClick={() => setTab("details")}
        >{tr(" 트랜잭션 ")}</button>
        <button
          className={tab === "evidence" ? "active" : ""}
          onClick={() => setTab("evidence")}
        >{tr(" 근거 ")}<span>{tr(route.evidence.length)}</span>
        </button>
      </div>
      {tab === "details" ? (
        <>
          <LegDetails leg={route.source} label={tr("출발")} />
          <div className="leg-divider">
            <ArrowDown size={14} />
            <span>{tr(route.bridge)}</span>
          </div>
          <LegDetails leg={route.destination} label={tr("도착")} />
          {route.messageId && (
            <div className="message-id">
              <span>{tr("MESSAGE / ORDER ID")}</span>
              <code>{tr(route.messageId)}</code>
              <CopyButton text={route.messageId} />
            </div>
          )}
        </>
      ) : (
        <div className="evidence-list">
          {route.evidence.map((e, i) => (
            <div className="evidence-item" key={i}>
              <span className="evidence-dot" />
              <div>
                <span className="eyebrow">
                  {tr(e.kind === "receipt"
                    ? "ON-CHAIN RECEIPT"
                    : e.kind === "event"
                      ? "CONTRACT EVENT"
                      : "PROTOCOL INDEXER")}
                </span>
                <strong>{tr(e.provider)}</strong>
                <p>{tr(e.description)}</p>
                <small>{tr(fmtDate(e.fetchedAt, locale))}</small>
                {e.url && (
                  <a href={e.url} target="_blank" rel="noreferrer">{tr(" 출처 열기 ")}<ArrowUpRight size={12} />
                  </a>
                )}

              </div>
            </div>
          ))}
        </div>
      )}
      <div className="confidence-note">
        <ShieldCheck size={16} />
        <div>
          <strong>
            {tr(route.confidence === "onchain"
              ? "양 체인의 성공 영수증 확인"
              : route.confidence === "indexed"
                ? "프로토콜 인덱서에서 연결"
                : "현재 체인 이벤트 확인")}
          </strong>

        </div>
      </div>
      {route.notes.length > 0 && (
        <details className="route-notes"><summary>{tr("참고 사항")}</summary>
          {route.notes.map((n, i) => (
            <p key={i}>{tr(n)}</p>
          ))}
        </details>
      )}
    </aside>
  );
}
function Diagnostics({ items }: { items: Diagnostic[] }) {
  const { t: tr } = useI18n();
  return (
    <div className="diagnostics">
      {items.map((d, i) => (
        <div className="diagnostic" key={`${d.provider}${i}`}>
          <span className={`diagnostic-icon ${d.state}`}>
            {d.state === "ok" ? (
              <Check size={13} />
            ) : d.state === "error" || d.state === "partial" ? (
              <X size={13} />
            ) : (
              <Circle size={11} />
            )}
          </span>
          <div>
            <strong>{tr(d.provider)}</strong>
            <p>{tr(d.detail)}</p>
          </div>
          <span className="diagnostic-count">
            {tr(d.state === "ok"
              ? `${d.count}건`
              : d.state === "partial"
                ? `${d.count}건  /  일부 실패`
              : d.state === "error"
                ? "조회 실패"
                : d.state === "skipped"
                  ? "제외"
                  : "미발견")}
          </span>
          <small>{tr((d.durationMs / 1000).toFixed(1))}{tr("s")}</small>
        </div>
      ))}
    </div>
  );
}
function download(result: TraceResult) {
  const blob = new Blob([JSON.stringify(result, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tx-tracer-${result.query.slice(0, 12)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export default function App() {
  const { t: tr, locale } = useI18n();
  const [view, setView] = useState("trace");
  const [config, setConfig] = useState<Config>();
  const [configError, setConfigError] = useState("");
  const [query, setQuery] = useState("");
  const [chainId, setChainId] = useState("");
  const [kind, setKind] = useState("auto");
  const [searchMode, setSearchMode] = useState<"single" | "batch" | "address-pair">("single");
  const [investigationDraft, setInvestigationDraft] = useState<InvestigationRequest>();
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<TraceResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [allGraph, setAllGraph] = useState(false);
  const [graphTab, setGraphTab] = useState("graph");
  const [showOptions, setShowOptions] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [filter, setFilter] = useState("all");
  const [protocolFilter, setProtocolFilter] = useState("all");
  const [toast, setToast] = useState("");
  const [history, setHistory] = useState<Saved[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("atlas-history") || "[]");
    } catch {
      return [];
    }
  });
  const controller = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  async function loadConfig() {
    try {
      setConfig(await requestJson<Config>("/api/config"));
      setConfigError("");
    } catch (e) {
      setConfigError(
        e instanceof Error ? e.message : "서비스 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
  }
  useEffect(() => {
    void loadConfig();
    const t = setTimeout(() => void loadConfig(), 10000);
    return () => {
      clearTimeout(t);
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!loading) return;
    const start = Date.now();
    setElapsed(0);
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [loading]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        focusSearch.current = true;
        setView("trace");
        setSearchMode("single");
        setSearchExpanded(true);
        if (inputRef.current && !inputRef.current.closest("[hidden]")) {
          inputRef.current.focus();
          focusSearch.current = false;
        }
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  useEffect(() => {
    if (focusSearch.current && inputRef.current && !inputRef.current.closest("[hidden]")) {
      inputRef.current.focus();
      focusSearch.current = false;
    }
  }, [view, searchExpanded, searchMode, result]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);
  async function search(
    q = query,
    chain = chainId,
    nextPage = 1,
    queryKind = kind,
    investigation?: InvestigationRequest,
  ) {
    if (!q.trim()) {
      setError("트랜잭션 해시 또는 주소를 입력하세요.");
      inputRef.current?.focus();
      return;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setSearchMode(investigation?.mode || "single");
    if (investigation) setInvestigationDraft(investigation);
    setError("");
    if (!investigation) setQuery(q);
    setChainId(chain);
    setPage(nextPage);
    setView("trace");
    setSearchExpanded(false);
    setResult(undefined);
    setSelected("");
    try {
      const data = await requestJson<TraceResult>(investigation ? "/api/investigate" : "/api/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(investigation || {
          query: q.trim(),
          chainId: chain || undefined,
          kind: queryKind,
          days,
          page: nextPage,
          limit: 20,
        }),
        signal: abort.signal,
      });
      if (controller.current !== abort || abort.signal.aborted) return;
      setResult(data);
      setSearchExpanded(false);
      setAllGraph(investigation?.mode === "batch");
      setSelected(data.investigation?.addressPaths?.find(p => p.status === "connected")?.id || data.investigation?.addressPaths?.[0]?.id || data.routes[0]?.id || "");
      setFilter("all");
      setProtocolFilter("all");
      const saved = [
        {
          query: q.trim(),
          chainId: chain || undefined,
          at: new Date().toISOString(),
          count: data.routes.length,
          request: data.investigation?.request || investigation,
        },
        ...history.filter((h) => h.query !== q.trim()),
      ].slice(0, 20);
      setHistory(saved);
      try {
        localStorage.setItem("atlas-history", JSON.stringify(saved));
      } catch {
        /* Storage is optional. */
      }
    } catch (e) {
      if (controller.current === abort && e instanceof Error && e.name !== "AbortError") setError(e.message);
    } finally {
      if (controller.current === abort) setLoading(false);
    }
  }
  function searchInvestigation(request: InvestigationRequest) {
    const label = request.mode === "batch" ? request.queries.join("\n")
      : `${request.sourceAddress} → ${request.destinationAddress}`;
    void search(label, request.mode === "batch" ? request.chainId || "" : "", 1, "auto", request);
  }
  const navigate = (v: string) => {
    setView(v);
    setSearchExpanded(false);
  };
  const routes = result?.routes || [];
  const filtered = routes.filter(
    (r) =>
      (filter === "all" || r.status === filter) &&
      (protocolFilter === "all" || r.protocol === protocolFilter),
  );
  const selectedPath = result?.investigation?.addressPaths?.find(p => p.id === selected);
  const current = selectedPath && !selectedPath.bridgeRouteId ? undefined : filtered.find(r => r.id === (selectedPath?.bridgeRouteId || selected)) || filtered[0];
  const matchedChains = new Set(
    [...routes.flatMap(r => [r.source.chainId, r.destination.chainId]), ...(result?.investigation?.addressPaths || []).flatMap(p => [p.source?.chainId, ...p.transfers.map(t => t.chainId), ...(p.steps || []).flatMap(s => s.type === "bridge" ? [s.route.source.chainId, s.route.destination.chainId] : [])])].filter(Boolean),
  );
  const navItems = [
    { id: "trace", label: "트랜잭션 추적", icon: Network },
    { id: "history", label: "조회 기록", icon: History },
  ];
  return (
    <div className="app-shell">
      <header className="workspace-header">
        <button className="brand-home" type="button" onClick={() => navigate("trace")} aria-label="Tx Tracer"><Brand /></button>
        <nav aria-label={tr("주 메뉴")}>
          {navItems.map(n => <button key={n.id} type="button" title={tr(n.label)} aria-label={tr(n.label)} aria-current={view === n.id ? "page" : undefined}
            className={view === n.id ? "active" : ""} onClick={() => navigate(n.id)}><n.icon size={16} /><span>{tr(n.label)}</span></button>)}
        </nav>
        <div className="topbar-right"><ThemeToggle /><LanguageToggle /></div>
      </header>
      <main>
        <div className={`main-content ${view === "history" ? "history-view" : result ? "results-view" : "start-view"}`}>
          {view === "trace" && (
            <>
              <div className="search-workspace">
                {!result && <div className="search-heading"><h1>{tr("트랜잭션 추적")}</h1></div>}
                {result && <div className="search-recall">
                  <h1 className="sr-only">{tr("조회 결과")}</h1>
                  <Search size={17} /><code title={result.query}>{result.query}</code><CopyButton text={result.query} />
                  <div className="recall-actions">
                    <button className="quiet-button" type="button" aria-expanded={searchExpanded} onClick={() => setSearchExpanded(!searchExpanded)}><Settings2 size={14} />{tr("검색 수정")}</button>
                    <button className="quiet-button new-search" type="button" onClick={() => { focusSearch.current = true; setResult(undefined); setError(""); setQuery(""); setChainId(""); setKind("auto"); setSearchMode("single"); setInvestigationDraft(undefined); setShowOptions(false); setSearchExpanded(false); }}><Plus size={15} />{tr("새 검색")}</button>
                  </div>
                </div>}
              <section className="search-panel" hidden={!!result && !searchExpanded}>
                <div className="search-modes segmented" aria-label={tr("검색 방식")}>
                  {([["single", "단일 해시 / 주소"], ["batch", "여러 해시"], ["address-pair", "출발 → 도착 주소"]] as const).map(([mode, label]) =>
                    <button key={mode} disabled={loading} aria-pressed={searchMode === mode} className={searchMode === mode ? "active" : ""}
                      onClick={() => { setSearchMode(mode); setError(""); }}>{tr(label)}</button>)}
                </div>
                {searchMode === "single" ? <>
                <form className="single-search-form"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    void search();
                  }}
                >
                  <div className="command-input">
                  <div className="search-box">
                    <Search size={21} />
                    <input
                      ref={inputRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={tr("트랜잭션 해시 또는 주소")}
                      aria-label={tr("트랜잭션 해시 또는 주소")}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {query && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={tr("입력 지우기")}
                        onClick={() => setQuery("")}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                  <button
                    className="primary-button"
                    disabled={loading}
                    type="submit"
                  >
                    {loading ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Search size={17} />
                    )}{tr(" ")}
                    {tr(loading ? "추적 중" : "경로 추적")}
                    <ArrowRight size={16} />
                  </button>
                  </div>
                  <div className="search-preferences">
                  <select
                    aria-label={tr("체인 선택")}
                    value={chainId}
                    onChange={(e) => setChainId(e.target.value)}
                  >
                    <option value="">{tr("체인 자동 탐색")}</option>
                    {config?.chains
                      .slice()
                      .sort(
                        (a, b) =>
                          [
                            "1",
                            "8453",
                            "42161",
                            "10",
                            "tron",
                            "solana",
                            "bitcoin",
                          ].indexOf(b.id) -
                            [
                              "1",
                              "8453",
                              "42161",
                              "10",
                              "tron",
                              "solana",
                              "bitcoin",
                            ].indexOf(a.id) || a.name.localeCompare(b.name),
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {tr(c.name)}{tr(" (")}{tr(c.id)}{tr(") ")}</option>
                      ))}
                  </select>
                    <button type="button" className="quiet-button" aria-expanded={showOptions} onClick={() => setShowOptions(!showOptions)}><Settings2 size={14} />{tr("검색 옵션")}</button>
                  </div>
                </form>
                {showOptions && (
                  <div className="advanced-options">
                    <label>{tr(" 입력 유형 ")}<select
                        value={kind}
                        onChange={(e) => setKind(e.target.value)}
                      >
                        <option value="auto">{tr("자동 감지")}</option>
                        <option value="transaction">{tr("트랜잭션 / 메시지")}</option>
                        <option value="address">{tr("주소")}</option>
                      </select>
                    </label>
                    <label>{tr(" 주소 검색 기간 ")}<select
                        value={days}
                        onChange={(e) => setDays(Number(e.target.value))}
                      >
                        <option value="7">{tr("최근 7일")}</option>
                        <option value="30">{tr("최근 30일")}</option>
                        <option value="90">{tr("최근 90일")}</option>
                        <option value="365">{tr("최근 1년")}</option>
                      </select>
                    </label>
                    <p>{tr("자동 탐색: 주요 EVM 12개 체인")}</p>
                  </div>
                )}
                </> : <InvestigationForm mode={searchMode} chains={config?.chains || []} loading={loading}
                  draft={investigationDraft} onSearch={searchInvestigation} />}
              </section>
              </div>
              {configError && (
                <div className="error-banner">
                  {tr(configError)}
                  <button onClick={() => void loadConfig()}>{tr("다시 시도")}</button>
                </div>
              )}
              {error && (
                <div role="alert" className="error-banner">
                  <XCircle size={17} />
                  {tr(error)}
                </div>
              )}
              {result && <div className="result-overview">
                <div className="overview-stats">
                  <span><strong>{result.investigation?.addressPaths?.filter(p => p.status === "connected").length ?? routes.length}</strong>{tr("연결된 경로")}</span>
                  <span><strong>{matchedChains.size}</strong>{tr("관련 체인")}</span>
                  <span className="arrival-stat"><CheckCircle2 size={13} /><strong>{result.investigation?.addressPaths?.filter(p => p.status === "connected").length ?? routes.filter(r => r.status === "delivered").length}</strong>{tr("도착 확인")}</span>
                </div>
                <button className="quiet-button" onClick={() => download(result)}><ArrowDownToLine size={14} />{tr("JSON 내보내기")}</button>
              </div>}
              {loading ? (
                <div className="loading-panel">
                  <div className="loading-orbit">
                    <Network size={34} />
                  </div>
                  <h2>{tr("조회 중")}</h2>
                  <div className="loading-progress">
                    <span />
                  </div>
                  <small>
                    {tr(`${elapsed}초`)}</small>
                  <button
                    onClick={() => {
                      controller.current?.abort();
                      setLoading(false);
                    }}
                  >{tr(" 조회 취소 ")}</button>
                </div>
              ) : result ? (
                <>
                  <InvestigationSummary result={result} onTrace={(hash, chain) => void search(hash, chain, 1, "auto")}
                    onSelect={id => { setSelected(id); setFilter("all"); setProtocolFilter("all"); setAllGraph(!result.investigation?.addressPaths); }} />
                  <div className={`result-layout ${!current ? "without-evidence" : ""}`}>
                    <div className="result-main">
                      <section className="graph-panel route-map-panel">
                        <div className="section-toolbar">
                          <div className="route-map-title"><Network size={18} /><div><h3>{tr("자금 이동 경로")}</h3></div></div>
                          <div className="route-map-actions"><div className="segmented">
                            <button
                              className={graphTab === "graph" ? "active" : ""}
                              onClick={() => setGraphTab("graph")}
                            >
                              <Network size={14} />{tr(" 경로 맵 ")}</button>
                            <button
                              className={
                                graphTab === "timeline" ? "active" : ""
                              }
                              onClick={() => setGraphTab("timeline")}
                            >
                              <Clock3 size={14} />{tr(" 타임라인 ")}</button>
                          </div>
                          <button
                            className="small-link"
                            onClick={() => setAllGraph(!allGraph)}
                          >
                            {tr(allGraph ? "선택 경로만" : "전체 경로 보기")}{tr(" ")}
                            <Layers3 size={13} />
                          </button></div>
                        </div>
                        <div className="graph-canvas">
                          {filtered.length || result.investigation?.addressPaths?.some(p => !p.bridgeRouteId) ? (
                            graphTab === "graph" ? (
                              <Graph
                                routes={filtered}
                                selectedId={selected || current?.id}
                                all={allGraph}
                                onSelect={setSelected}
                                onFocus={() => setAllGraph(false)}
                                connections={result.investigation?.connections}
                                addressPaths={result.investigation?.addressPaths}
                                targetAddress={result.investigation?.request.mode === "address-pair" ? result.investigation.request.destinationAddress : undefined}
                                targetChain={result.investigation?.request.mode === "address-pair" ? config?.chains.find(c => c.id === (result.investigation!.request as Extract<InvestigationRequest, { mode: "address-pair" }>).destinationChainId) : undefined}
                              />
                            ) : (
                              <div className="timeline-view">
                                {result.investigation?.addressPaths ? result.investigation.addressPaths.filter(p => allGraph || (p.id === selected || p.bridgeRouteId === selected)).map(path => {
                                  const first = routes.find(r => r.id === path.bridgeRouteId);
                                  const steps = [...(first ? [{ type: "bridge" as const, route: first }] : []), ...(path.steps || path.transfers.map(transfer => ({ type: "transfer" as const, transfer })))];
                                  return <div className="timeline-route" key={path.id}><strong>{tr(path.status === "connected" ? "B 연결 경로" : "B 미연결 경로")}</strong>{steps.map((step, index) => <div key={index}><span className="timeline-circle" /><div><b>{tr(step.type === "bridge" ? `${step.route.bridge}  /  ${step.route.source.chain} → ${step.route.destination.chain}` : `${step.transfer.chain}  /  일반 송금`)}</b><code>{tr(step.type === "bridge" ? `${step.route.source.txHash} → ${step.route.destination.txHash || "미확인"}` : step.transfer.txHash)}</code><small>{tr(fmtDate(step.type === "bridge" ? step.route.source.timestamp : step.transfer.timestamp, locale))}</small></div></div>)}</div>;
                                }) : (allGraph
                                  ? filtered
                                  : current
                                    ? [current]
                                    : []
                                ).map((r) => (
                                  <div className="timeline-route" key={r.id}>
                                    <strong>{tr(r.bridge)}</strong>
                                    <div>
                                      <span className="timeline-circle" />
                                      <div>
                                        <b>{tr(r.source.chain)}{tr(" / 출발")}</b>
                                        <code>
                                          {tr(r.source.txHash || "미확인")}
                                        </code>
                                        <small>
                                          {tr(fmtDate(r.source.timestamp, locale))}
                                        </small>
                                      </div>
                                    </div>
                                    <div>
                                      <span className="timeline-circle end" />
                                      <div>
                                        <b>{tr(r.destination.chain)}{tr(" / 도착")}</b>
                                        <code>
                                          {tr(r.destination.txHash || "미확인")}
                                        </code>
                                        <small>
                                          {tr(fmtDate(r.destination.timestamp, locale))}
                                        </small>
                                      </div>
                                      <Status value={r.status} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )
                          ) : (
                            <div className="no-results">
                              <Search size={28} />
                              <h3>
                                {tr(routes.length
                                  ? "필터에 맞는 경로가 없습니다."
                                  : "조회 범위에서 연결된 경로를 찾지 못했습니다.")}
                              </h3>
                              <p>{tr("체인과 조회 기간을 확인하세요.")}</p>
                            </div>
                          )}
                        </div>
                        <div className="graph-legend">
                          <span>
                            <i className="legend-line" />{tr(" 확인된 거래 연결 ")}</span>
                          <span>
                            <i className="legend-line dashed" />{tr(" 반대편 거래 미확인 ")}</span>
                          {!!result.investigation?.connections.length && <span><i className="legend-line connection" />{tr(" 동일 거래 접점")}</span>}
                          {result.investigation?.addressPaths && <span><i className="legend-line transfer" />{tr(" 일반 송금 / 주소 연결")}</span>}
                        </div>
                      </section>
                      {!!routes.length && <section className="route-table-panel">
                        <div className="section-toolbar">
                          <h3>{tr(" 브릿지 경로 ")}<span>{tr(filtered.length)}</span>
                          </h3>
                          <div className="table-filters">
                            <select
                              aria-label={tr("브릿지 필터")}
                              value={protocolFilter}
                              onChange={(e) =>
                                setProtocolFilter(e.target.value)
                              }
                            >
                              <option value="all">{tr("모든 브릿지")}</option>
                              {[...new Set(routes.map((r) => r.protocol))].map(
                                (p) => (
                                  <option key={p} value={p}>
                                    {tr(p)}
                                  </option>
                                ),
                              )}
                            </select>
                            <select
                              aria-label={tr("상태 필터")}
                              value={filter}
                              onChange={(e) => setFilter(e.target.value)}
                            >
                              <option value="all">{tr("모든 상태")}</option>
                              {Object.entries(statusLabels).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {tr(v)}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>{tr("브릿지")}</th>
                                <th>{tr("출발 → 도착")}</th>
                                <th>{tr("출발 수량")}</th>
                                <th>{tr("상태")}</th>
                                <th>{tr("근거")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filtered.map((r) => (
                                <tr
                                  tabIndex={0}
                                  key={r.id}
                                  className={
                                    current?.id === r.id ? "selected" : ""
                                  }
                                  onClick={() => setSelected(r.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") setSelected(r.id);
                                  }}
                                >
                                  <td>
                                    <div className="table-protocol">
                                      <BridgeLogo name={r.bridge} protocol={r.protocol} sourceChainId={r.source.chainId} destinationChainId={r.destination.chainId} size={26} />
                                      <div>
                                        <strong>{tr(r.bridge)}</strong>
                                        <small>
                                          {tr(r.aggregator
                                            ? `via ${r.aggregator}`
                                            : short(r.source.txHash, 4))}
                                        </small>
                                      </div>
                                    </div>
                                  </td>
                                  <td>
                                    <div className="table-chain">
                                      <span className="chain-label"><ChainLogo chainId={r.source.chainId} name={r.source.chain} size={18} />{tr(r.source.chain)}</span>
                                      <ArrowRight size={12} />
                                      <span className="chain-label"><ChainLogo chainId={r.destination.chainId} name={r.destination.chain} size={18} />{tr(r.destination.chain)}</span>
                                    </div>
                                  </td>
                                  <td className="mono">
                                    {tr(amountLabel(r.source))}
                                  </td>
                                  <td>
                                    <Status value={r.status} />
                                  </td>
                                  <td>
                                    <span className="evidence-count">
                                      <ShieldCheck size={13} />
                                      {tr(r.evidence.length)}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {!filtered.length && (
                            <p className="table-empty">{tr(" 확인된 경로가 여기에 표시됩니다. ")}</p>
                          )}
                        </div>
                      </section>}
                    </div>
                    {current && (
                      <EvidencePanel key={current.id} route={current} />
                    )}
                  </div>
                  {!!result.candidates.length && (
                    <section className="candidates-panel">
                      <div className="section-toolbar">
                        <h3>
                          {tr(result.kind === "address"
                            ? "주소에서 발견한 일반 거래 후보"
                            : "조회한 온체인 거래")}{tr(" ")}
                          <span>{tr(result.candidates.length)}</span>
                        </h3>
                        {result.kind === "address" && !result.investigation && (
                          <button
                            className="small-link"
                            disabled={page >= 5}
                            onClick={() =>
                              void search(
                                result.query,
                                result.chainId || "",
                                page + 1,
                              )
                            }
                          >
                            {tr(page)}{tr("페이지 / 다음 페이지")}{tr(" ")}
                            <ChevronRight size={13} />
                          </button>
                        )}
                      </div>
                      {result.kind === "address" && <p className="section-caption">{tr("브릿지로 확인된 목록은 아닙니다.")}</p>}
                      <div className="candidate-list">
                        {result.candidates.slice(0, 100).map((c) => (
                          <button
                            key={`${c.chainId}${c.hash}`}
                            onClick={() => {
                              setKind("auto");
                              void search(c.hash, c.chainId, 1, "auto");
                            }}
                          >
                            <span className="candidate-chain">{tr(c.chain)}</span>
                            <code>{tr(short(c.hash, 10))}</code>
                            <span>{tr(c.method || "transaction")}</span>
                            <small>{tr(fmtDate(c.timestamp, locale))}</small>
                            <span className="candidate-action">{tr(" 이 거래 추적 ")}<ArrowRight size={13} />
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  {result.kind === "address" && !result.investigation && !result.candidates.length && (
                    <button
                      disabled={page >= 5}
                      className="outline-button"
                      onClick={() =>
                        void search(
                          result.query,
                          result.chainId || "",
                          page + 1,
                        )
                      }
                    >
                      {tr(page)}{tr("페이지 / 다음 페이지 조회 ")}<ChevronRight size={14} />
                    </button>
                  )}
                  <section className="audit-panel">
                    <details>
                      <summary>
                        <div>
                          <Radio size={16} />
                          <strong>{tr("데이터 소스별 조회 상태")}</strong>
                          <span>{tr(result.diagnostics.length)}{tr(" checks")}</span>
                        </div>
                        <ChevronDown size={15} />
                      </summary>
                      <Diagnostics items={result.diagnostics} />
                    </details>
                    {!!result.warnings.length && <details className="scope-disclosure">
                      <summary><div><HelpCircle size={16} /><strong>{tr("조회 한계")}</strong><span>{result.warnings.length}</span></div><ChevronDown size={15} /></summary>
                      <div className="scope-copy">{result.warnings.map((w, i) => <p key={i}>{tr(w)}</p>)}</div>
                    </details>}
                  </section>
                </>
              ) : (
                <>
                  <div className="start-secondary">
                    <button type="button" className="example-route" onClick={() => void search(demo, "1", 1, "auto")}>
                      <span className="example-label">{tr("예시 보기")}</span>
                      <span className="example-chains"><ChainLogo chainId="1" name="Ethereum" size={21} /><span>Ethereum</span><ArrowRight size={13} /><ChainLogo chainId="42161" name="Arbitrum" size={21} /><span>Arbitrum</span></span>
                      <ArrowUpRight size={16} />
                    </button>
                    {!!history.length && <section className="recent-searches">
                      <div className="recent-heading"><h2>{tr("최근 검색")}</h2><button type="button" onClick={() => navigate("history")}>{tr("전체 보기")}<ArrowRight size={13} /></button></div>
                      {history.slice(0, 3).map(h => <button type="button" className="recent-search" key={h.query} onClick={() => { setKind("auto"); if (h.request) searchInvestigation(h.request); else void search(h.query, h.chainId || "", 1, "auto"); }}>
                        <History size={15} /><code title={h.query}>{h.query}</code><time dateTime={h.at}>{new Date(h.at).toLocaleDateString(locale, { month: "short", day: "numeric" })}</time><ChevronRight size={14} />
                      </button>)}
                    </section>}
                  </div>
                </>
              )}
            </>
          )}
          {view === "history" && (
            <>
              <div className="history-heading"><h1>{tr("조회 기록")}</h1></div>
              <section className="history-toolbar">
                <p>{tr("최근 20개 검색을 이 브라우저에 저장합니다.")}</p>
                <button
                  className="outline-button"
                  onClick={() => {
                    setHistory([]);
                    localStorage.removeItem("atlas-history");
                  }}
                >{tr(" 기록 지우기 ")}</button>
              </section>
              <section className="history-panel">
                {history.length ? (
                  history.map((h) => (
                    <button
                      key={h.query}
                      onClick={() => {
                        setKind("auto");
                        if (h.request) searchInvestigation(h.request);
                        else void search(h.query, h.chainId || "", 1, "auto");
                      }}
                    >
                      <span className="history-icon">
                        <History size={20} />
                      </span>
                      <div>
                        <code>{tr(h.query)}</code>
                        <small>
                          {tr(fmtDate(h.at, locale))}{tr(" / ")}{tr(" ")}
                          {tr(h.chainId ? `Chain ${h.chainId}` : "자동 탐색")}{tr(" / 당시 ")}{tr(h.count)}{tr(" 경로 ")}</small>
                      </div>
                      <ArrowRight size={18} />
                    </button>
                  ))
                ) : (
                  <div className="no-results">
                    <History size={27} />
                    <h3>{tr("아직 조회 기록이 없습니다.")}</h3>
                    <button
                      className="primary-button"
                      onClick={() => navigate("trace")}
                    >{tr(" 거래 추적 시작 ")}<ArrowRight size={15} />
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          {tr(toast)}
        </div>
      )}
    </div>
  );
}
