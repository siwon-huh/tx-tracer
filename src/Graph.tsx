import { useI18n } from "./i18n";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
  Background, BackgroundVariant, BaseEdge, EdgeLabelRenderer, Handle, MarkerType,
  MiniMap, Panel, Position, ReactFlow, getSmoothStepPath, getViewportForBounds,
  useReactFlow, useViewport, type Edge, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronLeft, ChevronRight, CircleHelp,
  Clock3, Copy, Focus, GitFork, Maximize2, Minimize2, Minus, Plus, ShieldCheck, Wallet,
} from "lucide-react";
import type { AddressPath, BridgeRoute, Leg, RouteConnection } from "../shared/types";

import { short, amountLabel } from "./format";
import { BridgeLogo, ChainLogo } from "./BrandLogo";

const colors: Record<string, string> = {
  "1": "#6876c5", "10": "#df545d", "8453": "#3579f6", "42161": "#298bb8",
  solana: "#8961d2", tron: "#db4a56", "43114": "#d96060", "56": "#b98d22",
  "137": "#9271e2", bitcoin: "#d9952c",
};
const statusLabels: Record<string, string> = {
  delivered: "도착 보고", pending: "처리 중", failed: "실패 보고", refunded: "환불 보고",
  observed: "한쪽 확인", unknown: "확인 필요",
};
const timeLabel = (value?: string) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "시각 미확인";
const elapsedLabel = (a?: string, b?: string) => {
  const seconds = (Date.parse(b || "") - Date.parse(a || "")) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds < 60 ? `${Math.round(seconds)}초` : seconds < 3600 ? `${Math.floor(seconds / 60)}분 ${Math.round(seconds % 60)}초` : `${(seconds / 3600).toFixed(1)}시간`;
};
type FlowData = {
  kind: "source" | "bridge" | "destination" | "transfer" | "lane";
  route?: BridgeRoute; leg?: Leg; step?: number; target?: boolean; ghost?: boolean;
  incoming?: Position; outgoing?: Position; active?: boolean; title?: string;
};
type FlowNodeType = Node<FlowData>;
type RouteEntry = { id: string; selectionId: string; route?: BridgeRoute; path?: AddressPath; source: Leg; destination: Leg; label: string };
const stepsOf = (path?: AddressPath) => path?.steps || path?.transfers.map(transfer => ({ type: "transfer" as const, transfer })) || [];

function ChainMark({ leg }: { leg: Leg }) {

  return <ChainLogo chainId={leg.chainId} name={leg.chain} className="atlas-chain-mark" />;
}
function FlowNode({ data: d }: NodeProps<FlowNodeType>) {
  const { t: tr } = useI18n();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => { if (copied || copyError) { const id = setTimeout(() => { setCopied(false); setCopyError(false); }, 1800); return () => clearTimeout(id); } }, [copied, copyError]);
  if (d.kind === "lane") return <div className={`atlas-lane ${d.active ? "is-active" : ""}`}><span>{tr(d.title)}</span><b>{tr(d.leg?.chain)}</b></div>;
  const ports = <>{d.incoming && <Handle type="target" position={d.incoming} />}{d.outgoing && <Handle type="source" position={d.outgoing} />}</>;
  if (d.kind === "bridge" && d.route) return <div className={`atlas-node atlas-protocol ${d.active ? "is-active" : ""}`}>
    {tr(ports)}
    <div className="atlas-node-role"><span><b>{tr(String(d.step).padStart(2, "0"))}</b>{tr(" 크로스체인 브릿지")}</span><GitFork size={15} /></div>
    <div className="atlas-protocol-name"><BridgeLogo name={d.route.bridge} protocol={d.route.protocol} sourceChainId={d.route.source.chainId} destinationChainId={d.route.destination.chainId} size={43} /><strong>{tr(d.route.bridge)}</strong></div>
    <div className="atlas-protocol-via">{tr(d.route.aggregator ? `via ${d.route.aggregator}` : "프로토콜 직접 조회")}</div>
    <div className={`atlas-status ${d.route.status}`}><i />{tr(statusLabels[d.route.status])}</div>
    <div className="atlas-protocol-footer"><ShieldCheck size={13} /><span>{tr(d.route.evidence.length)}{tr("개 근거")}</span><span>{tr(elapsedLabel(d.route.source.timestamp, d.route.destination.timestamp) || "-")}</span></div>
  </div>;
  const leg = d.leg!;
  const role = d.kind === "source" ? "출발 주소  /  A" : d.target ? "최종 도착  /  B" : d.kind === "transfer" ? "중간 주소" : "브릿지 수취 주소";
  return <div className={`atlas-node atlas-wallet ${d.target ? "is-target" : ""} ${d.ghost ? "is-unresolved" : ""} ${d.active ? "is-active" : ""}`} style={{ "--chain-color": colors[leg.chainId || ""] || "#678578" } as CSSProperties}>
    {tr(ports)}
    <div className="atlas-node-role"><span><b>{tr(String(d.step).padStart(2, "0"))}</b>{tr(role)}</span>
      <span title={tr(d.ghost ? "목표 주소까지 연결된 거래를 확인하지 못했습니다." : leg.receiptVerified ? "블록체인에서 거래 또는 전송 확인" : "데이터 소스에서 확인 / 개별 거래 검증 미확인")}>
        {d.ghost ? <CircleHelp size={14} /> : leg.receiptVerified ? <ShieldCheck size={14} /> : <span className="atlas-indexed">{tr("INDEXED")}</span>}
      </span>
    </div>
    <div className="atlas-chain-title"><ChainMark leg={leg} /><strong title={tr(leg.chain)}>{tr(leg.chain)}</strong>{d.target && <span className="atlas-target-badge">{tr("B")}</span>}</div>
    <div className="atlas-amount" title={tr(amountLabel(leg, false))}><b>{tr(leg.amount || (leg.rawAmount ? "소수점 미확인" : "-"))}</b><span>{tr(leg.symbol || (leg.amount ? "token" : ""))}</span></div>
    <div className="atlas-address"><Wallet size={13} /><code title={tr(leg.address)}>{tr(short(leg.address, 6))}</code>
      {leg.address && <button className="nodrag nopan" aria-label={tr(`${role} 복사`)} title={tr(copyError ? "복사 실패  /  주소를 직접 선택해 주세요" : copied ? "복사됨" : "전체 주소 복사")} onClick={async e => {
        e.stopPropagation(); try { await navigator.clipboard.writeText(leg.address!); setCopied(true); } catch { setCopyError(true); }
      }}>{copied ? <Check size={13} /> : copyError ? <CircleHelp size={13} /> : <Copy size={12} />}</button>}
    </div>
    <div className="atlas-node-footer"><span title={tr(leg.timestamp)}><Clock3 size={11} />{tr(timeLabel(leg.timestamp))}</span>
      {leg.explorerUrl ? <a className="nodrag nopan" href={leg.explorerUrl} target="_blank" rel="noreferrer" title={tr(leg.txHash)} aria-label={tr(`${role} 거래 탐색기`)} onClick={e => e.stopPropagation()}>{tr("TX ")}<ArrowUpRight size={12} /></a> : <span>{tr(d.ghost ? "연결 미확인" : "TX 미확인")}</span>}
    </div>
  </div>;
}
function FlowEdge(props: EdgeProps) {
  const { t: tr } = useI18n();
  const [path, x, y] = getSmoothStepPath({ ...props, borderRadius: 28 });
  const tone = String(props.data?.tone || "bridge");
  return <>
    <path d={path} className={`atlas-edge-track ${tone}`} fill="none" />
    <BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd} interactionWidth={16} />
    <EdgeLabelRenderer><div className={`atlas-edge-label ${tone} nodrag nopan`} style={{ transform: `translate(-50%, -50%) translate(${x}px,${y}px)` }}>
      {tone === "unresolved" ? <CircleHelp size={10} /> : props.targetX < props.sourceX ? <ArrowLeft size={10} /> : props.targetY > props.sourceY ? <ArrowDown size={10} /> : <ArrowRight size={10} />}<span>{tr(props.label)}</span>
    </div></EdgeLabelRenderer>
  </>;
}
const nodeTypes = { atlas: FlowNode };
const edgeTypes = { atlas: FlowEdge };
function MapTools({ fitKey, overview, motion, container, nodes }: { fitKey: string; overview: boolean; motion: number; container: RefObject<HTMLDivElement | null>; nodes: FlowNodeType[] }) {
  const { t: tr } = useI18n();
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const fit = (duration = motion) => {
    const rect = container.current?.getBoundingClientRect();
    if (!rect || !nodes.length) return;
    // This map uses flat, fixed-size cards. Bounds come from the current layout,
    // so resizing cannot fit stale positions held by React Flow's internal store.
    const x = Math.min(...nodes.map(n => n.position.x)), y = Math.min(...nodes.map(n => n.position.y));
    const bounds = { x, y, width: Math.max(...nodes.map(n => n.position.x + Number(n.style?.width || n.width || 246))) - x,
      height: Math.max(...nodes.map(n => n.position.y + (n.height || 36))) - y };
    return flow.setViewport(getViewportForBounds(bounds, rect.width, rect.height, .05, 1, .14), { duration });
  };
  useLayoutEffect(() => {
    void fit(0);
  }, [fitKey, nodes, container, flow]);
  return <>
    <Panel position="bottom-left" className="atlas-map-tools">
      <button aria-label={tr("맵 축소")} title={tr("축소")} disabled={zoom <= .051} onClick={() => void flow.zoomOut({ duration: motion })}><Minus size={16} /></button>
      <button className="atlas-zoom-value" aria-label={tr("실제 크기 100%")} title={tr("실제 크기로 보기")} onClick={() => void flow.zoomTo(1, { duration: motion })}>{tr(Math.round(zoom * 100))}<small>{tr("%")}</small></button>
      <button aria-label={tr("맵 확대")} title={tr("확대")} disabled={zoom >= 1.99} onClick={() => void flow.zoomIn({ duration: motion })}><Plus size={16} /></button>
      <i /><button className="atlas-fit" aria-label={tr("경로를 화면에 맞추기")} title={tr("모든 표시 경로를 화면에 맞추기")} onClick={() => void fit()}><Focus size={16} /><span>{tr("맞춤")}</span></button>
    </Panel>
    {overview && <MiniMap className="atlas-minimap" position="bottom-right" pannable zoomable nodeStrokeWidth={0} nodeBorderRadius={5}
      nodeColor={node => node.data.kind === "bridge" ? "var(--map-bridge)" : node.data.ghost ? "var(--line-strong)" : "var(--text-muted)"} maskColor="var(--surface-soft)" />}
  </>;
}

export default function Graph({ routes, selectedId, onSelect, onFocus, all, connections = [], addressPaths, targetAddress, targetChain }: {
  routes: BridgeRoute[]; selectedId?: string; onSelect: (id: string) => void; onFocus: () => void;
  all: boolean; connections?: RouteConnection[]; addressPaths?: AddressPath[]; targetAddress?: string; targetChain?: { id: string; name: string };
}) {
  const { t: tr } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 600, height: 530 });
  const [pathId, setPathId] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches); update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    const bounds = surface.current?.getBoundingClientRect();
    if (bounds) setDimensions({ width: Math.round(bounds.width), height: Math.round(bounds.height) });
  }, [expanded]);
  useEffect(() => {
    if (!surface.current) return;
    const observer = new ResizeObserver(([entry]) => setDimensions({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) }));
    observer.observe(surface.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    expandButton.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setExpanded(false); }
      if (event.key !== "Tab") return;
      const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], select, [tabindex="0"]') || [])].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !root.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", keyboard); previous?.focus(); };
  }, [expanded]);
  const entries = useMemo<RouteEntry[]>(() => {
    const fromRoute = (route: BridgeRoute, path?: AddressPath): RouteEntry => {
      const last = stepsOf(path).at(-1);
      const destination = last?.type === "bridge" ? last.route.destination : last?.type === "transfer" ? { ...last.transfer, address: last.transfer.to } : route.destination;
      return { id: path?.id || route.id, selectionId: path?.id || route.id, route, path, source: route.source, destination, label: route.bridge };
    };
    const bridged = routes.flatMap(route => {
      const paths = addressPaths?.filter(p => p.status === "connected" && p.bridgeRouteId === route.id);
      return paths ? paths.map(path => fromRoute(route, path)) : [fromRoute(route)];
    });
    const ordinary = (addressPaths || []).filter(p => p.status === "connected" && !p.bridgeRouteId && p.source).map(path => {
      const last = stepsOf(path).at(-1);
      const destination = last?.type === "bridge" ? last.route.destination : last?.type === "transfer" ? { ...last.transfer, address: last.transfer.to } : path.source!;
      const bridges = stepsOf(path).filter(s => s.type === "bridge").length;
      return { id: path.id, selectionId: path.id, path, source: path.source!, destination, label: bridges ? `송금  /  브릿지 ${bridges}개` : "일반 송금" };
    });
    return [...bridged, ...ordinary];
  }, [routes, addressPaths]);
  const active = entries.find(e => e.id === pathId && e.selectionId === selectedId) || entries.find(e => e.selectionId === selectedId) || entries.find(e => e.route?.id === selectedId) || entries[0];
  const activeIndex = entries.findIndex(e => e.id === active?.id);
  const choose = (entry?: RouteEntry) => { if (entry) { setPathId(entry.id); onSelect(entry.selectionId); onFocus(); } };
  // Keep the selected path visible even when it falls beyond the overview's display cap.
  const visible = all ? [...entries.slice(0, 12)] : active ? [active] : [];
  if (all && active && !visible.some(e => e.id === active.id)) visible[visible.length - 1] = active;
  const columns = dimensions.width < 760 ? 2 : dimensions.width < 1200 ? 3 : 6;
  const { nodes, edges } = useMemo(() => {
    const nodes: FlowNodeType[] = [], edges: Edge[] = [];
    let laneY = 0;
    const endpoints = new Map<string, { source: string; destination: string }>();
    const makeEdge = (id: string, source: string, target: string, label: string, tone = "bridge", pending = false) => {
      const color = tone === "transfer" ? "var(--map-transfer)" : tone === "unresolved" ? "var(--map-unresolved)" : "var(--map-bridge)";
      edges.push({ id, source, target, type: "atlas", label, data: { tone }, animated: pending && !reducedMotion,
        style: { stroke: color, strokeWidth: 1.8, strokeDasharray: tone === "unresolved" || tone === "connection" ? "5 5" : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 15, height: 15 } });
    };
    visible.forEach(entry => {
      const { route, path, id: prefix } = entry;
      const steps = stepsOf(path);
      const stages: FlowData[] = [{ kind: "source", leg: entry.source, route }];
      if (route) stages.push({ kind: "bridge", route }, { kind: "destination", leg: route.destination, route });
      for (const step of steps) {
        if (step.type === "bridge") stages.push({ kind: "bridge", route: step.route }, { kind: "destination", leg: step.route.destination, route: step.route });
        else stages.push({ kind: "transfer", route, leg: { ...step.transfer, address: step.transfer.to, receiptVerified: step.transfer.evidence.kind === "event" } });
      }
      if (path?.status === "connected") stages[stages.length - 1].target = true;
      if (path?.status === "unresolved" && targetAddress) stages.push({ kind: "transfer", route, target: true, ghost: true, leg: { chain: targetChain?.name || entry.destination.chain, chainId: targetChain?.id || entry.destination.chainId, address: targetAddress } });
      const cols = Math.ceil(stages.length / Math.ceil(stages.length / columns));
      const points = stages.map((_, i) => ({ x: (Math.floor(i / cols) % 2 ? cols - 1 - i % cols : i % cols) * 346, y: Math.floor(i / cols) * 276 + laneY + (all ? 52 : 0) }));
      if (all) nodes.push({ id: `${prefix}:lane`, type: "atlas", position: { x: 0, y: laneY }, data: { kind: "lane", route, leg: { chain: `${entry.source.chain} → ${entry.destination.chain}` }, title: `경로 ${String(entries.indexOf(entry) + 1).padStart(2, "0")}`, active: active?.id === entry.id }, selectable: false, focusable: false, style: { width: cols * 346 - 100 } });
      const direction = (a: typeof points[number], b: typeof points[number]) => a.y < b.y ? Position.Bottom : a.y > b.y ? Position.Top : a.x < b.x ? Position.Right : Position.Left;
      stages.forEach((stage, i) => {
        nodes.push({ id: `${prefix}:${i}`, type: "atlas", position: points[i], width: 246, height: 190,
          data: { ...stage, step: i + 1, active: all && entry.id === active?.id,
            incoming: i > 0 ? direction(points[i], points[i - 1]) : undefined,
            outgoing: i < stages.length - 1 ? direction(points[i], points[i + 1]) : undefined },
          style: { width: 246, height: 190 }, ariaLabel: tr(`${i + 1}단계 ${stage.kind === "bridge" ? stage.route?.bridge : stage.leg?.chain}`) });
        if (i > 0) {
          const bridgeEdge = stage.kind === "bridge" || stage.kind === "destination";
          const unknown = stage.ghost || (stage.kind === "destination" && !stage.leg?.txHash);
          makeEdge(`${prefix}:edge:${i}`, `${prefix}:${i - 1}`, `${prefix}:${i}`, unknown ? "미연결" : stage.kind === "bridge" ? "브릿지 출발" : stage.kind === "destination" ? "브릿지 수취" : "일반 송금",
            unknown ? "unresolved" : bridgeEdge ? "bridge" : "transfer", stage.route?.status === "pending" && bridgeEdge);
        }
      });
      if (route) endpoints.set(route.id, { source: `${prefix}:0`, destination: `${prefix}:2` });
      laneY += Math.ceil(stages.length / cols) * 276 + (all ? 90 : 0);
    });
    if (!addressPaths) for (const connection of connections) {
      const from = endpoints.get(connection.fromRouteId), to = endpoints.get(connection.toRouteId);
      if (from && to) makeEdge(`junction:${connection.fromRouteId}:${connection.toRouteId}`, from.destination, to.source, "동일 거래", "connection");
    }
    return { nodes, edges };
  }, [entries, active?.id, all, columns, connections, addressPaths, targetAddress, targetChain, reducedMotion, tr]);
  const fitKey = `${nodes.map(n => n.id).join("|")}:${columns}:${dimensions.width}:${dimensions.height}:${expanded}`;
  return <div ref={root} className={`atlas-explorer ${expanded ? "is-expanded" : ""}`} role={expanded ? "dialog" : undefined} aria-modal={expanded ? true : undefined} aria-label={tr(expanded ? "자금 이동 경로 확대 보기" : "자금 이동 경로 탐색")}>
    <div className="atlas-map-heading">
      <div className="atlas-map-subheading"><span>{tr(active?.source.chain)}</span><ArrowRight size={12} /><span>{tr(active?.destination.chain)}</span>{active?.path && <><ArrowRight size={12} /><b>{tr(active.path.status === "connected" ? "최종 주소 B" : "B까지 미연결")}</b></>}</div>
      {entries.length > 1 && <div className="atlas-route-navigation">
        <button aria-label={tr("이전 경로")} disabled={activeIndex <= 0} onClick={() => choose(entries[activeIndex - 1])}><ChevronLeft size={16} /></button>
        <select aria-label={tr("맵 경로 선택")} value={active?.id || ""} onChange={e => choose(entries.find(entry => entry.id === e.target.value))}>
          {entries.map((entry, index) => <option key={entry.id} value={entry.id}>{tr(String(index + 1).padStart(2, "0"))}{tr(" / ")}{tr(entry.label)}{tr(entry.path ? `  /  ${entry.path.status === "unresolved" ? "B 미연결" : entry.path.transfers.length ? `송금 ${entry.path.transfers.length}단계` : "B 직접 도착"}` : "")}</option>)}
        </select>
        <button aria-label={tr("다음 경로")} disabled={activeIndex >= entries.length - 1} onClick={() => choose(entries[activeIndex + 1])}><ChevronRight size={16} /></button>
      </div>}
      <button ref={expandButton} className="atlas-expand" aria-label={tr(expanded ? "넓게 보기 닫기" : "경로맵 넓게 보기")} title={tr(expanded ? "닫기  /  Esc" : "넓게 보기")} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}<span>{tr(expanded ? "닫기" : "넓게 보기")}</span></button>
    </div>
    <div ref={surface} className="atlas-map-surface">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodeClick={(_, node) => { if (all) choose(entries.find(e => node.id.startsWith(`${e.id}:`))); }}
        minZoom={.05} maxZoom={2}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
        zoomOnDoubleClick={false} zoomOnScroll={false} panOnScroll preventScrolling={false}>
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--dot)" />
        <MapTools fitKey={fitKey} container={surface} nodes={nodes} overview={all && visible.length > 1} motion={reducedMotion ? 0 : 280} />
      </ReactFlow>
    </div>
    <div className="atlas-map-caption"><span><i />{tr(all ? `최대 12개 경로 표시  /  전체 ${entries.length}개` : `${nodes.length}개 단계  /  ${(active?.route?.evidence.length || 0) + stepsOf(active?.path).reduce((n, s) => n + (s.type === "bridge" ? s.route.evidence.length : 1), 0)}개 연결 근거`)}</span></div>
    {active?.path?.reason && !all && <p className="atlas-path-note"><CircleHelp size={13} />{tr(active.path.reason)}</p>}
  </div>;
}
