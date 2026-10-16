import type { Capability } from "../shared/types.js";
export const capabilities: Capability[] = [
  {
    id: "lifi",
    name: "LI.FI 생태계",
    mode: "indexed",
    tx: "출발·도착 해시",
    address: "송신·수취 / 기간 필터",
    description:
      "LI.FI가 제공하는 브릿지 경로를 조회합니다. LI.FI를 거치지 않은 거래는 포함되지 않을 수 있습니다.",
    docs: "https://docs.li.fi/api-reference/check-the-status-of-a-cross-chain-transfer",
  },
  {
    id: "debridge",
    name: "deBridge DLN",
    mode: "indexed",
    tx: "출발·도착 해시",
    address: "송신·수취 / 페이지",
    description:
      "DLN 주문 ID로 양 체인 거래를 연결합니다. legacy deBridge 메시지 전체 이력은 포함하지 않습니다.",
    docs: "https://docs.debridge.com/dln-details/integration-guidelines/order-creation/order-tracking-api/tracking-orders",
  },
  {
    id: "layerzero",
    name: "Stargate · LayerZero",
    mode: "indexed",
    tx: "출발·도착 해시",
    address: "출발 initiator / 첫 페이지",
    description:
      "메시지 전달을 확인합니다. Stargate bus의 최종 지갑·토큰 수량 및 후속 compose는 별도 확인이 필요합니다.",
    docs: "https://docs.layerzero.network/v2/tools/layerzeroscan/mainnet/messages/get-messagestx",
  },
  {
    id: "wormhole",
    name: "Wormhole · Portal",
    mode: "indexed",
    tx: "출발·도착 해시",
    address: "인덱싱 주소 / 페이지",
    description:
      "Portal은 동일 Wormhole 어댑터에 통합합니다. payload의 중간 수취 컨트랙트를 최종 지갑으로 표시하지 않습니다.",
    docs: "https://wormhole.com/docs/products/messaging/guides/wormholescan-api/",
  },
  {
    id: "thorchain",
    name: "THORChain",
    mode: "indexed",
    tx: "입금·출금 해시",
    address: "입금·출금 / 페이지",
    description:
      "Midgard swap/refund를 추적합니다. BTC·LTC 등 비EVM 체인과 복수 입출력을 보존합니다.",
    docs: "https://dev.thorchain.org/concepts/connecting-to-thorchain.html",
  },
  {
    id: "ccip",
    name: "Chainlink CCIP",
    mode: "indexed",
    tx: "출발·도착·메시지 ID",
    address: "메시지 송수신 / 첫 페이지",
    description:
      "메시지 실행과 토큰 전달은 구분합니다. 소수점이 없는 원시 수량은 증거에서 확인할 수 있습니다.",
    docs: "https://docs.chain.link/ccip/tools/api/get-messages",
  },
  {
    id: "official",
    name: "L2 Official · OP Stack",
    mode: "events",
    tx: "등록된 표준 브릿지 이벤트",
    address: "탐색기 후보 → 해시 조회",
    description:
      "OP Stack 표준 브릿지의 입금과 도착 기록을 대조합니다. 출금 반대편 거래 연결과 일부 체인은 지원하지 않습니다.",
    docs: "https://specs.optimism.io/protocol/bridges.html",
  },
  {
    id: "arbitrum",
    name: "Arbitrum Official",
    mode: "events",
    tx: "표준 ERC20 Gateway 이벤트",
    address: "탐색기 후보 → 해시 조회",
    description:
      "등록된 표준 ERC20 gateway의 입출금 이벤트를 확인합니다. 반대편 트랜잭션 자동 연결과 커스텀 gateway는 미지원입니다.",
    docs: "https://docs.arbitrum.io/build-decentralized-apps/token-bridging/token-bridge-erc20",
  },
  {
    id: "rhino",
    name: "rhino.fi",
    mode: "credential",
    tx: "권한이 있는 입금·출금 해시",
    address: "범용 주소 이력 미지원",
    description:
      "조회 가능한 거래에 제한이 있습니다. 모든 주소의 전체 거래 이력을 제공하지는 않습니다.",
    docs: "https://docs.rhino.fi/api-integration/status-history",
  },
  {
    id: "other-l2",
    name: "기타 L2 · 추가 브릿지",
    mode: "planned",
    tx: "RPC receipt / LI.FI 경유",
    address: "인덱서 지원 범위",
    description:
      "zkSync·Linea·Scroll 등의 전용 공식 브릿지 연결은 아직 미구현입니다. 일반 receipt와 LI.FI 인덱싱 결과는 조회할 수 있습니다.",
    docs: "https://github.com/DefiLlama/chainlist",
  },
];
