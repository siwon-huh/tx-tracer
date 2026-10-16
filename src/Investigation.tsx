import { useI18n } from "./i18n";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, ChevronDown, LoaderCircle, Search, Settings2 } from "lucide-react";
import type { InvestigationRequest, TraceResult } from "../shared/types";
import { addressSearchLimits } from "../shared/investigation";
import { short } from "./format";

const localTime = (value: string | number) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
type ChainChoice = { id: string; name: string };
export function InvestigationForm({ mode, chains, loading, draft, onSearch }: {
  mode: "batch" | "address-pair";
  chains: ChainChoice[];
  loading: boolean;
  draft?: InvestigationRequest;
  onSearch: (request: InvestigationRequest) => void;
}) {
  const { t: tr } = useI18n();
  const [hashes, setHashes] = useState("");
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [sourceChain, setSourceChain] = useState("");
  const [destinationChain, setDestinationChain] = useState("");
  const [batchChain, setBatchChain] = useState("");
  const [startTime, setStartTime] = useState(() => localTime(Date.now() - 86400_000));
  const [endTime, setEndTime] = useState(() => localTime(Date.now()));
  const [maxBridges, setMaxBridges] = useState(addressSearchLimits.maxBridges);
  const [pages, setPages] = useState(addressSearchLimits.pages);
  const [maxHops, setMaxHops] = useState(addressSearchLimits.maxHops);
  const maximumSearch = maxHops === addressSearchLimits.maxHops && maxBridges === addressSearchLimits.maxBridges && pages === addressSearchLimits.pages;
  const [error, setError] = useState("");
  useEffect(() => {
    if (draft?.mode === "batch") {
      setHashes(draft.queries.join("\n")); setBatchChain(draft.chainId || "");
    } else if (draft?.mode === "address-pair") {
      setSource(draft.sourceAddress); setDestination(draft.destinationAddress);
      setSourceChain(draft.sourceChainId || ""); setDestinationChain(draft.destinationChainId || "");
      setStartTime(localTime(draft.startTime || Date.now() - draft.days * 86400_000));
      setEndTime(localTime(draft.endTime || Date.now()));
      setPages(draft.pages ?? addressSearchLimits.pages);
      setMaxHops(draft.maxHops ?? addressSearchLimits.maxHops);
      setMaxBridges(draft.maxBridges ?? addressSearchLimits.maxBridges);
    }
  }, [draft]);
  const options = chains.map(c => <option key={c.id} value={c.id}>{tr(c.name)}{tr(" (")}{tr(c.id)}{tr(")")}</option>);
  return <form className="investigation-form" onSubmit={event => {
    event.preventDefault(); setError("");
    if (mode === "batch") {
      const queries = hashes.trim().split(/[\s,;]+/).filter(Boolean);
      if (!queries.length || queries.length > 10) {
        setError("해시를 1~10개 입력하세요. 줄바꿈, 공백 또는 쉼표로 구분할 수 있습니다."); return;
      }
      onSearch({ mode, queries, chainId: batchChain || undefined });
    } else {
      const start = new Date(startTime).getTime(), end = new Date(endTime).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) { setError("시작 시각은 종료 시각보다 빨라야 합니다."); return; }
      if (end > Date.now() + 60_000 || end - start > 365 * 86400_000) { setError("미래 시각은 조회할 수 없으며, 기간은 최대 365일입니다."); return; }
      if (!sourceChain && /^0x/i.test(source) && maxBridges === 0) { setError("일반 송금만 조회하려면 출발 체인을 선택하세요."); return; }
      onSearch({ mode, sourceAddress: source.trim(), destinationAddress: destination.trim(),
        sourceChainId: sourceChain || undefined, destinationChainId: destinationChain || undefined, days: Math.max(1, Math.ceil((end - start) / 86400_000)), pages, maxHops, maxBridges, startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString() });
    }
  }}>
    {mode === "batch" ? <>
      <label className="batch-input">{tr("트랜잭션 해시 / 최대 10개 ")}<textarea aria-label={tr("여러 트랜잭션 해시")} value={hashes} onChange={e => setHashes(e.target.value)}
          rows={4} spellCheck={false} placeholder={tr("해시 1\n해시 2")} required />
      </label>
      <label>{tr("해시 조회 체인 ")}<select aria-label={tr("여러 해시 체인 선택")} value={batchChain} onChange={e => setBatchChain(e.target.value)}>
          <option value="">{tr("체인 자동 탐색")}</option>{tr(options)}
        </select>
      </label>
    </> : <>
      <div className="address-pair-fields">
        <label>{tr("출발 주소 ")}<input aria-label={tr("출발 주소")} value={source} onChange={e => setSource(e.target.value)} spellCheck={false} required />
          <select aria-label={tr("출발 체인 선택")} value={sourceChain} onChange={e => setSourceChain(e.target.value)}>
            <option value="">{tr("출발 체인 전체")}</option>{tr(options)}
          </select>
        </label>
        <ArrowRight size={20} />
        <label>{tr("최종 도착 주소 / B ")}<input aria-label={tr("도착 주소")} value={destination} onChange={e => setDestination(e.target.value)} spellCheck={false} required />
          <select aria-label={tr("도착 체인 선택")} value={destinationChain} onChange={e => setDestinationChain(e.target.value)}>
            <option value="">{tr("도착 체인 전체")}</option>{tr(options)}
          </select>
        </label>
      </div>
      <div className="time-window-fields">
        <div className="time-window-caption"><span>{tr("거래 조회 기간 / ")}{tr(Intl.DateTimeFormat().resolvedOptions().timeZone)}</span><div>{[1, 6, 24, 168].map(hours => <button type="button" key={hours} onClick={() => { setStartTime(localTime(Date.now() - hours * 3600_000)); setEndTime(localTime(Date.now())); }}>{tr(hours === 168 ? "7일" : `${hours}시간`)}</button>)}</div></div>
        <div><label>{tr("시작 시각")}<input type="datetime-local" aria-label={tr("조회 시작 시각")} value={startTime} onInput={e => setStartTime(e.currentTarget.value)} onChange={e => setStartTime(e.target.value)} required /></label><ArrowRight size={17} /><label>{tr("종료 시각")}<input type="datetime-local" aria-label={tr("조회 종료 시각")} value={endTime} onInput={e => setEndTime(e.currentTarget.value)} onChange={e => setEndTime(e.target.value)} required /></label></div>
      </div>
      <details className="investigation-advanced">
        <summary><Settings2 size={15} /><span>{tr("고급 설정")}</span><small>{tr(maximumSearch ? "최대 검색" : maxBridges === 0 ? "일반 송금만" : "사용자 설정")}</small><ChevronDown size={15} /></summary>
        <div className="investigation-options">
        <label>{tr("일반 송금 단계 ")}<select aria-label={tr("일반 송금 최대 단계")} value={maxHops} onChange={e => setMaxHops(Number(e.target.value))}>
            <option value={1}>{tr("최대 1단계")}</option><option value={2}>{tr("최대 2단계")}</option><option value={3}>{tr("최대 3단계")}</option>
          </select>
        </label>
        <label>{tr("브릿지 탐색 ")}<select aria-label={tr("브릿지 최대 개수")} value={maxBridges} onChange={e => setMaxBridges(Number(e.target.value))}>
            <option value={0}>{tr("일반 송금만")}</option><option value={1}>{tr("최대 1개")}</option><option value={2}>{tr("최대 2개")}</option><option value={3}>{tr("최대 3개")}</option>
          </select>
        </label>
        <label>{tr("주소별 조회 범위 ")}<select aria-label={tr("주소 간 조회 페이지 수")} value={pages} onChange={e => setPages(Number(e.target.value))}>
            <option value={1}>{tr("1페이지")}</option><option value={3}>{tr("최대 3페이지")}</option><option value={5}>{tr("최대 5페이지")}</option>
          </select>
        </label>
        </div>
        {!maximumSearch && <div className="investigation-advanced-footer"><button type="button" className="small-link" onClick={() => {
            setMaxHops(addressSearchLimits.maxHops); setMaxBridges(addressSearchLimits.maxBridges); setPages(addressSearchLimits.pages);
          }}>{tr("최대 검색으로 초기화")}</button></div>}
      </details>
    </>}
    <div className="investigation-submit">
      {mode === "address-pair" && !sourceChain && /^0x/i.test(source) && <p>{tr("일반 송금은 출발 체인 선택이 필요합니다.")}</p>}
      <button className="primary-button" type="submit" disabled={loading}>
        {loading ? <LoaderCircle size={17} className="spin" /> : <Search size={17} />}
        {tr(loading ? "조회 중" : mode === "batch" ? "여러 해시 조회" : "전체 경로 찾기")}<ArrowRight size={16} />
      </button>
    </div>
    {error && <p role="alert" className="form-error">{tr(error)}</p>}
  </form>;
}

export function InvestigationSummary({ result, onTrace, onSelect }: {
  result: TraceResult;
  onTrace: (hash: string, chain: string) => void;
  onSelect: (routeId: string) => void;
}) {
  const { t: tr, locale } = useI18n();
  const data = result.investigation;
  if (!data) return null;
  const labels = { ok: "조회됨", empty: "미발견", partial: "일부 실패", error: "조회 실패" };
  const name = (id: string) => result.routes.find(r => r.id === id)?.bridge || id;
  return <section className="investigation-summary">
    <div className="section-toolbar"><h3>{tr(data.request.mode === "batch" ? "통합 조회" : "주소 간 조회")}</h3>
      <span>{tr(data.addressPaths ? `B까지 연결 ${data.addressPaths.length}개` : `관측 경로 ${result.routes.length}개`)}{tr(" / 거래 ")}{tr(data.transactions.length)}{tr("개")}</span></div>
    {data.request.mode === "address-pair" && <p className="section-caption">{tr("주소 연결은 동일 자금의 이동을 보장하지 않습니다.")}{data.pathSearch?.truncated && <strong> {tr("일부 이력 미조회")}</strong>}</p>}
    {data.pathSearch?.startTime && <p className="section-caption">{tr("조회 기간: ")}{tr(new Date(data.pathSearch.startTime).toLocaleString(locale))}{tr(" ~ ")}{tr(new Date(data.pathSearch.endTime!).toLocaleString(locale))}{tr(" / 주소 ")}{tr(data.pathSearch.walletsScanned)}{tr("개 조회")}</p>}
    {!!data.inputs.length && <details className="investigation-inputs" open={data.inputs.some(i => i.state === "error" || i.state === "partial")}>
      <summary>{tr("입력별 조회 상태 / ")}{tr(data.inputs.length)}{tr("개 조회")}</summary>
      {data.inputs.map((input, i) => <div key={i} className={`input-result ${input.state}`}>
        <code title={tr(input.query)}>{tr(short(input.query, 10))}</code>
        <span>{tr(input.page ? `${input.page}페이지  /  ` : "")}{tr(labels[input.state])}</span><small>{tr(input.detail)}</small>
      </div>)}
    </details>}
    {data.addressPaths && <details className="address-path-details">
      <summary>{tr("경로 상세")}</summary>
      <div className="address-path-list">
        {data.addressPaths.map(path => {
          const route = result.routes.find(r => r.id === path.bridgeRouteId);
          const source = route?.source || path.source;
          const steps = path.steps || path.transfers.map(transfer => ({ type: "transfer" as const, transfer }));
          const bridgeCount = (route ? 1 : 0) + steps.filter(s => s.type === "bridge").length;
          const end = steps.at(-1);
          const destination = end?.type === "bridge" ? end.route.destination : end?.type === "transfer" ? end.transfer : route?.destination;
          return <article key={path.id} className={path.status}>
            <button className="path-heading" onClick={() => onSelect(path.id)}>
              <strong>{tr(source?.chain)}{tr(" → ")}{tr(destination?.chain)}{tr(" / ")}{tr(bridgeCount ? `브릿지 ${bridgeCount}개` : "일반 송금")}</strong>
              <span>{tr(path.status === "connected" ? path.transfers.length ? `일반 송금 ${path.transfers.length}단계  /  B 연결` : "B에 직접 도착" : "B까지 미연결")}</span>
            </button>
            <p className="path-addresses">{tr(short(source?.address))} {route && <><ArrowRight size={12} /> {tr(route.bridge)} <ArrowRight size={12} /> {tr(short(route.destination.address))}</>}
              {steps.map(s => s.type === "transfer" ? <span key={s.transfer.id}><ArrowRight size={12} /> {tr(short(s.transfer.to))}</span> : <span key={s.route.id}><ArrowRight size={12} /> {tr(s.route.bridge)} <ArrowRight size={12} /> {tr(short(s.route.destination.address))}</span>)}</p>
            {path.reason && <p>{tr(path.reason)}</p>}
            {steps.map((step, index) => {
              if (step.type === "bridge") { const r = step.route; return <details key={`${r.id}:${index}`} className="transfer-proof">
                <summary>{tr("브릿지 / ")}{tr(r.bridge)}{tr(" / ")}{tr(r.source.chain)}{tr(" → ")}{tr(r.destination.chain)}</summary>
                <dl><dt>{tr("출발 주소")}</dt><dd>{tr(r.source.address)}</dd><dt>{tr("도착 주소")}</dt><dd>{tr(r.destination.address)}</dd><dt>{tr("출발 자산")}</dt><dd>{tr(r.source.amount)} {tr(r.source.symbol)}{tr(" / ")}{tr(r.source.tokenAddress)}</dd><dt>{tr("도착 자산")}</dt><dd>{tr(r.destination.amount)} {tr(r.destination.symbol)}{tr(" / ")}{tr(r.destination.tokenAddress)}</dd><dt>{tr("출발 시각")}</dt><dd>{tr(r.source.timestamp)}</dd><dt>{tr("도착 시각")}</dt><dd>{tr(r.destination.timestamp)}</dd></dl>
                <p>{r.source.explorerUrl && <a href={r.source.explorerUrl} target="_blank" rel="noreferrer">{tr("출발 거래 ↗")}</a>}{tr(" / ")}{r.destination.explorerUrl && <a href={r.destination.explorerUrl} target="_blank" rel="noreferrer">{tr("도착 거래 ↗")}</a>}</p>
                <details><summary>{tr("브릿지 연결 근거")}</summary>{r.evidence.map((e, i) => <p key={i}>{tr(e.provider)} / {tr(e.description)}</p>)}</details>
              </details>; }
              const t = step.transfer;
              return <details key={t.id} className="transfer-proof">
              <summary>{tr("일반 송금 ")}{tr(index + 1)}{tr(" / ")}{tr(t.amount)} {tr(t.symbol || "token")}{tr(" / ")}{tr(short(t.txHash))}</summary>
              <dl><dt>{tr("보낸 주소")}</dt><dd>{tr(t.from)}</dd><dt>{tr("받은 주소")}</dt><dd>{tr(t.to)}</dd><dt>{tr("자산")}</dt><dd>{tr(t.tokenAddress)}</dd>
                <dt>{tr("시각")}</dt><dd>{tr(t.timestamp)}</dd><dt>{tr("거래 해시")}</dt><dd>{tr(t.txHash)}</dd></dl>
              <p>{tr(t.evidence.provider)}{tr(" / ")}{tr(t.evidence.description)}</p>
              {t.explorerUrl && <a href={t.explorerUrl} target="_blank" rel="noreferrer">{tr("송금 거래 탐색기 ")}<ArrowUpRight size={12} /></a>}
            </details>; })}
          </article>;
        })}
        {!data.addressPaths.length && <p>{tr("조회 범위에서 A에서 B로 연결되는 경로를 찾지 못했습니다. 출발 체인과 조회 로그를 확인하세요.")}</p>}
      </div>
    </details>}
    {!!data.connections.length && <div className="connection-list">
      <strong>{tr("동일 거래 접점 / ")}{tr(data.connections.length)}{tr("개")}</strong>
      <p>{tr("앞 구간의 도착과 다음 구간의 출발이 같은 체인 / 같은 거래입니다. 토큰 단위의 자금 연속성은 별도 확인이 필요합니다.")}</p>
      {data.connections.map(c => <button key={`${c.fromRouteId}:${c.toRouteId}`} onClick={() => onSelect(c.toRouteId)}>
        {tr(name(c.fromRouteId))} <ArrowRight size={13} /> {tr(name(c.toRouteId))} <code>{tr(short(c.txHash))}</code>
      </button>)}
    </div>}
    <details className="connected-transactions">
      <summary>{tr("연결된 거래 / ")}{tr(data.transactions.length)}{tr("개")}</summary>
      <div className="connected-transaction-list">
        {data.transactions.map(tx => <div key={`${tx.chainId}:${tx.txHash}`}>
          <span>{tr(tx.chain)}</span><code title={tr(tx.txHash)}>{tr(tx.txHash)}</code>
          <small>{tr(tx.roles.map(r => r === "source" ? "출발" : r === "transfer" ? "일반 송금" : "도착").join("  /  "))}</small>
          {tx.explorerUrl && <a href={tx.explorerUrl} target="_blank" rel="noreferrer" aria-label={tr(`${tx.chain} 거래 탐색기`)}><ArrowUpRight size={14} /></a>}
          <button className="small-link" onClick={() => onTrace(tx.txHash, tx.chainId)}>{tr("개별 추적")}</button>
        </div>)}
        {!data.transactions.length && <p>{tr("현재 조회 범위에서 조건에 맞는 거래가 없습니다. 입력별 상태와 하단 조회 로그를 확인하세요.")}</p>}
      </div>
    </details>
  </section>;
}
