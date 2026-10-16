export type QueryKind = "transaction" | "address";
export type RouteStatus =
  "delivered" | "pending" | "failed" | "refunded" | "observed" | "unknown";
export interface Leg {
  chainId?: string;
  chain: string;
  txHash?: string;
  address?: string;
  amount?: string;
  symbol?: string;
  tokenAddress?: string;
  timestamp?: string;
  rawAmount?: string;
  explorerUrl?: string;
  blockNumber?: number;
  receiptVerified?: boolean;
}
export interface Evidence {
  provider: string;
  kind: "indexer" | "receipt" | "event";
  description: string;
  url?: string;
  fetchedAt: string;
  details?: unknown;
}
export interface BridgeRoute {
  id: string;
  bridge: string;
  protocol: string;
  aggregator?: string;
  status: RouteStatus;
  source: Leg;
  destination: Leg;
  messageId?: string;
  evidence: Evidence[];
  notes: string[];
  // A successful source receipt never proves delivery to the other chain.
  confidence: "indexed" | "onchain" | "source-only";
}
export interface Diagnostic {
  provider: string;
  state: "ok" | "empty" | "partial" | "error" | "skipped";
  durationMs: number;
  count: number;
  detail: string;
}
export interface Candidate {
  hash: string;
  chainId: string;
  chain: string;
  from?: string;
  to?: string;
  method?: string;
  timestamp?: string;
  explorerUrl?: string;
}
export interface TraceResult {
  query: string;
  kind: QueryKind;
  chainId?: string;
  routes: BridgeRoute[];
  transfers?: TransferEvent[];
  candidates: Candidate[];
  diagnostics: Diagnostic[];
  warnings: string[];
  fetchedAt: string;
  elapsedMs: number;
  searchedChains: string[];
  pagination?: { completeProviders: string[] };
  investigation?: {
    request: InvestigationRequest;
    inputs: InvestigationInputResult[];
    observedRouteCount: number;
    excludedRouteCount: number;
    connections: RouteConnection[];
    transactions: ConnectedTransaction[];
    addressPaths?: AddressPath[];
    pathSearch?: { maxHops: number; walletsScanned: number; transactionLimit: number; truncated: boolean; maxBridges?: number; bridgeLookups?: number; startTime?: string; endTime?: string };
  };
}
export type InvestigationRequest =
  | { mode: "batch"; queries: string[]; chainId?: string }
  | {
      mode: "address-pair";
      sourceAddress: string;
      destinationAddress: string;
      sourceChainId?: string;
      destinationChainId?: string;
      days: number;
      pages: number;
      maxHops?: number;
      maxBridges?: number;
      startTime?: string;
      endTime?: string;
    };
export interface InvestigationInputResult {
  query: string;
  page?: number;
  state: "ok" | "empty" | "partial" | "error";
  count: number;
  detail: string;
}
export interface RouteConnection {
  fromRouteId: string;
  toRouteId: string;
  chainId: string;
  txHash: string;
  kind: "shared-transaction";
}
export interface ConnectedTransaction {
  chainId: string;
  chain: string;
  txHash: string;
  explorerUrl?: string;
  routeIds: string[];
  roles: ("source" | "destination" | "transfer")[];
}
export interface TransferEvent {
  id: string;
  chainId: string;
  chain: string;
  txHash: string;
  from: string;
  to: string;
  tokenAddress: string;
  symbol?: string;
  rawAmount: string;
  decimals: number;
  amount: string;
  timestamp: string;
  blockNumber?: number;
  sequence: number;
  explorerUrl?: string;
  evidence: Evidence;
}
export interface AddressPath {
  id: string;
  bridgeRouteId?: string;
  source?: Leg;
  status: "connected" | "unresolved";
  transfers: TransferEvent[];
  steps?: AddressPathStep[];
  reason?: string;
}
export type AddressPathStep = { type: "transfer"; transfer: TransferEvent } | { type: "bridge"; route: BridgeRoute };
export interface Chain {
  id: number;
  name: string;
  symbol: string;
  explorer?: string;
  rpcs: string[];
}
export interface Capability {
  id: string;
  name: string;
  mode: "indexed" | "events" | "credential" | "planned";
  tx: string;
  address: string;
  description: string;
  docs: string;
}
