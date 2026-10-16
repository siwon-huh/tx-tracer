# Tx Tracer

트랜잭션 해시 또는 주소를 입력하면 브릿지의 출발·도착 거래와 그 연결 근거를 보여주는 웹앱입니다. React + TypeScript + React Flow 프런트엔드와 Node/Express 조회 서버로 구성했습니다. 지갑 연결, 서명, 송금 기능은 없습니다.

## 실행

Node.js 22.x가 필요합니다.

```sh
npm ci --cache .cache/npm
npm run dev
```

브라우저에서 [http://127.0.0.1:4317](http://127.0.0.1:4317)을 엽니다. `npm run dev`는 서버 파일 변경 시 재시작하며 화면은 Vite HMR로 갱신합니다.

사용하는 동안 서버 프로세스를 유지해야 합니다. 화면이 열려 있어도 서버가 종료되면 조회할 수 없습니다. 연결 오류가 나오면 프로젝트 폴더에서 `npm run dev`를 다시 실행한 후 경로를 재조회하세요.

```sh
npm run build
npm start
```

빌드 후 실행 역시 기본적으로 로컬 인터페이스 `127.0.0.1`에서만 수신합니다. `HOST`, `PORT`는 `.env`에서 변경할 수 있습니다. 현재 앱에는 사용자 인증이 없으며 공개 호스팅 배포는 하지 않았습니다.

## Vercel 배포

GitHub의 `siwon-huh/tx-tracer`를 Import하고 Root Directory는 저장소 루트로 둡니다. `vercel.json`에 Framework `Vite`, 설치 `npm ci`, 빌드 `npm run build`, Output Directory `dist`, Fluid Compute와 API 최대 실행 시간 300초가 설정되어 있습니다. Node.js는 `package.json`의 `22.x`를 사용합니다.

화면과 로고는 정적 파일로 제공하고 `/api/*`는 `api/index.ts`의 단일 Node.js Function으로 연결합니다. `server/app.ts`는 포트나 Vite를 시작하지 않는 공용 API이고, `server/index.ts`만 로컬 서버를 시작합니다. Vercel에서는 `npm start`, `HOST`, `PORT`를 설정하지 않습니다.

API 키가 있으면 프로젝트 Settings의 Environment Variables에 `LIFI_API_KEY`, `ETHERSCAN_API_KEY`, `RHINO_API_KEY`를 필요한 환경(Production / Preview)에 추가하고 다시 배포합니다. 키가 없으면 기존 공개 API 범위에서 동작하며 rhino.fi 인증 조회는 제외됩니다. 키를 `VITE_*` 변수에 넣지 않습니다.

조회는 240초의 공통 시간 예산을 사용합니다. 실행 중인 HTTP 요청과 대기열에도 취소를 전달하고, 완료한 경로는 유지하면서 미완료 조회를 표시합니다. 브라우저에서 취소하거나 연결을 끊으면 해당 검색의 요청도 중단합니다. 제한 시간에 도달한 결과는 일반 결과 캐시에 저장하지 않습니다. 검색 범위의 기존 단계, 페이지, 90초 경로 탐색 한도도 유지됩니다.

체인 메타데이터는 저장소의 JSON 스냅샷으로 즉시 시작하며 `/api/config`의 갱신 작업은 Vercel `waitUntil()`에 등록합니다. 메모리 캐시, 공개 RPC 상태 및 동시 조회 3개 제한은 인스턴스별입니다. 실제 방문자 IP는 Vercel의 IP 헬퍼로 읽으며 로컬 실행에서는 클라이언트가 보낸 프록시 헤더를 신뢰하지 않습니다.

별도 데이터베이스 없이도 배포할 수 있습니다. 모든 인스턴스에 IP당 60초간 15회 제한을 공유하려면 Upstash Redis의 `UPSTASH_REDIS_REST_URL`과 `UPSTASH_REDIS_REST_TOKEN`을 함께 등록합니다. 둘 다 없으면 인스턴스별 제한을 사용합니다. 공유 저장소를 설정했는데 접속에 실패하면 일시적인 503 응답을 반환합니다. Redis 카운터에는 IP의 SHA-256 해시를 사용하고 60초 후 만료합니다. 검색 결과와 지갑 주소를 저장하지 않습니다. 동시 조회 3개 제한은 Redis 사용 여부와 관계없이 인스턴스별로 적용됩니다.

배포 후 `/api/health`가 JSON으로 `status: ok`를 반환하는지 확인하고, 예시 해시와 다중 해시, 주소 간 검색을 각각 실행합니다. 외부 RPC와 인덱서의 접근 제한은 배포 지역 및 제공자에 따라 달라질 수 있습니다. Vercel Functions의 응답 크기 상한은 4.5MB이므로 매우 큰 검색 결과는 조회 기간을 좁혀야 할 수 있습니다.

Vercel CLI로 프로젝트를 연결한 환경에서는 `vercel build --standalone` 후 Node.js 22에서 `npm run check:vercel`로 실제 함수 산출물의 import, API 응답, 체인 스냅샷, 로고와 연락처 주석을 확인할 수 있습니다. 다른 출력 경로는 `npm run check:vercel -- /절대/경로/.vercel/output`으로 지정합니다. 이 검사는 배포를 생성하지 않습니다.

공식 문서: [Vite](https://vercel.com/docs/frameworks/frontend/vite), [Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js), [실행 제한](https://vercel.com/docs/functions/limitations), [waitUntil](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil), [Upstash REST](https://upstash.com/docs/redis/features/restapi).

## 구현된 기능

- EVM·Solana·Bitcoin 계열 해시와 EVM·Solana·BTC/LTC·THOR 주소 입력, 유형 자동 감지
- 여러 해시(최대 10개) 통합 조회, 출발 → 도착 주소 간 일반 송금·중간 브릿지 경로 조회
- 중복 주문 정리, 연결된 출발·도착 거래 목록, 동일 체인·동일 거래 접점 표시
- 출발 거래 → 브릿지 → 도착 거래 그래프, 확대·이동, 경로 선택, 타임라인
- 프로토콜·상태 필터, 송수신 주소, 정확한 문자열 금액, 탐색기 링크
- 프로토콜 메시지/주문 ID, 인덱서 응답 필드, RPC 영수증, 이벤트 근거
- JSON 결과 내보내기, 최근 20개 검색어의 브라우저 로컬 기록
- 주소의 일반 거래·토큰 입출금 후보에서 개별 해시 재추적
- 제공자별 실패/미발견/제외 상태, 조회 시간과 검색 범위 표시
- 브릿지 지원 범위, 동적 LI.FI 브릿지 디렉터리, 실제 사용한 RPC 상태

## 실제 지원 범위

| 소스                 | 해시 검색                                         | 주소 검색 / 제한                                                                                                             |
| -------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| LI.FI                | 출발·도착 해시로 인덱싱된 경로 조회               | 송수신 주소, 기간, 최대 1,000개. **해당 브릿지의 모든 직접 실행 거래를 포함하는 것은 아님**                                  |
| deBridge DLN         | 양쪽 해시 → 주문 ID → 전체 주문 상세              | 송수신 주소를 상세 정보에서 재검증. 페이지당 최대 25개. legacy deBridge 전체 메시지는 제외                                   |
| Stargate / LayerZero | 메시지 GUID로 출발·도착 연결                      | 출발 initiator의 첫 페이지. 최종 수취 주소·bus 승객·금액·compose 성공까지 보장하지 않음                                      |
| Wormhole / Portal    | 양쪽 해시, VAA 식별자, 실행 상태                  | 인덱싱 주소와 페이지. Portal은 같은 어댑터로 통합. payload 수취 컨트랙트와 최종 지갑을 구분                                  |
| THORChain            | Midgard 입금·출금 해시, swap/refund               | 송수신 주소와 페이지. affiliate 제외, 복수 action 입출력 보존. trade/synthetic 자산은 내부 계정으로 표시                     |
| CCIP                 | 출발·도착 해시 또는 message ID                    | sender/receiver/tokenReceiver, 첫 페이지. 데이터 메시지와 토큰 브릿지는 구분                                                 |
| OP Stack 공식 브릿지 | 공식 등록부의 ETH 기반 표준 브릿지 + Base         | 표준 이벤트 확인. L1 입금은 Portal로 L2 해시 계산 후 수취인·수량이 일치하는 Finalized 이벤트 대조. 출금 역방향 연결은 미구현 |
| Arbitrum 공식 브릿지 | 표준 ERC20 L1/L2 gateway의 입출금 이벤트          | 반대편 해시 연결, ETH retryable, 커스텀·WETH gateway 전용 처리 미구현                                                        |
| rhino.fi             | 인증 권한이 있는 입금·출금 해시                   | `RHINO_API_KEY` 필요. 임의 지갑 전체 이력 검색을 제공하지 않음. 인증 실거래 검증은 미실시                                    |
| 기타                 | 위 인덱서/LI.FI를 통해 연결된 경로 + 일반 receipt | zkSync·Linea·Scroll 등의 전용 공식 브릿지 연결은 미구현                                                                      |

2026-10-15 확인 시 LI.FI `/tools`는 37개 브릿지를 반환했습니다. 공식 OP 등록부에서 ETH 기반 체인 27개(Base 포함)를 등록했습니다. 이 숫자는 **등록된 공통 어댑터 범위**이며 각 체인의 실거래 테스트를 모두 완료했다는 의미가 아닙니다. 커스텀 가스 토큰 체인은 잘못된 자산 해석을 피하기 위해 제외합니다. UI의 디렉터리는 실행 시 갱신합니다.

### 결과를 읽는 방법

- `indexed`: 브릿지 인덱서가 거래들을 연결했습니다.
- `onchain`: 연결된 양쪽 거래의 성공 receipt를 RPC에서 확인했습니다. 인덱서 기반 연결의 암호학적 증명이나 최종성 보장은 아닙니다.
- `source-only`: 한쪽 체인의 신뢰한 컨트랙트 이벤트만 확인했습니다. 이 경우 완료로 표시하지 않습니다.
- `delivered`: 해당 데이터 소스가 메시지/주문 도착을 보고했거나, 공식 OP 입금의 대응 Finalized 이벤트를 확인했습니다. 후속 애플리케이션 동작이나 최종 토큰 소유자까지 항상 증명하지는 않습니다.
- `unknown`, `observed`, `pending`, `failed`, `refunded`를 별도로 보존합니다.

한 트랜잭션에 여러 메시지가 들어 있으면 별도 경로로 유지합니다. 출발·도착 해시 쌍이 같은 단일 관측끼리만 인덱서 근거를 합칩니다. 주소 간 조회에서는 실제 송금 이벤트의 송수신 주소·자산·시각·수량을 대조해 후속 주소 경로를 연결하되, 동일 자금의 귀속으로 단정하지 않습니다. Solana 식별자의 대소문자를 보존합니다.

### 주소 조회 범위

일반 EVM JSON-RPC에는 주소 전체 거래 이력 메서드가 없습니다. 브릿지별 인덱서와 공개 Blockscout를 함께 사용합니다. 주소 자동 탐색의 일반 거래 후보는 Ethereum·Base·Arbitrum·Optimism에 한정하며, 체인을 선택하면 그 체인만 조회합니다. Gnosis·Scroll·Celo도 공개 Blockscout 연결을 제공합니다.

Blockscout는 일반 거래와 토큰 입출금을 각각 최대 50개씩 가져옵니다. 내부 ETH 수취 전체 이력은 포함하지 않습니다. Etherscan 키를 설정하면 지원 체인에서 일반 거래 목록을 가져옵니다. 일반 거래 후보는 브릿지 확정 결과가 아닙니다.

페이지 버튼은 deBridge·Wormholescan·Midgard·탐색기의 다음 페이지를 조회합니다. LI.FI는 기간 기반, LayerZero·CCIP는 첫 페이지이므로 페이지를 바꿔도 이 소스들은 같은 결과를 반환할 수 있습니다. 조회 로그에 각각의 범위를 명시합니다. 주소 결과의 RPC 검증은 개별 거래를 다시 추적할 때 수행합니다.

### 여러 해시와 주소 간 조회

검색 상단에서 `단일 해시 / 주소`, `여러 해시`, `출발 → 도착 주소`를 선택합니다.

- **여러 해시:** 줄바꿈·공백·쉼표로 최대 10개를 입력합니다. 2개씩 동시에 조회하며 출발·도착 양쪽 해시를 넣어도 같은 주문은 한 번만 표시합니다. 하나의 거래에 포함된 여러 메시지는 유지합니다. 잘못된 입력이나 실패가 있어도 다른 입력의 결과는 보존합니다.
- **주소 간 조회:** 출발 A와 최종 도착 B, 각 체인, 시작·종료 시각을 지정합니다. 기본 조회 기간은 24시간이며 1/6/24시간·7일 바로가기가 있습니다. 새 검색은 지원하는 최대 범위인 일반 송금 3단계·브릿지 3개·주소별 5페이지를 사용합니다. 접힌 고급 설정에서 범위를 줄이거나 최대 검색으로 초기화할 수 있으며, 기록에서 복원한 사용자 지정 값은 유지합니다. **A → C → D → B**처럼 일반 송금만 있는 경로, **A → 송금 → 브릿지 → 송금 → B**, **A → 브릿지 → C → 송금 → D → 다른 브릿지 → E → B**를 같은 맵에 표시합니다. ‘일반 송금만’에서는 브릿지 API를 호출하지 않습니다. EVM 주소만으로 출발 체인을 알 수 없으면 체인 선택을 안내하며 전체 RPC로 무차별 조회하지 않습니다.
- **기간과 부하:** 모든 경로 구간의 거래가 지정 기간 안에 있어야 합니다. LI.FI는 초 단위 `fromTimestamp/toTimestamp`, Wormholescan은 ISO `from/to`, Midgard는 초 단위 `fromTimestamp/timestamp`, TronGrid는 밀리초 `min_timestamp/max_timestamp`를 전달합니다. deBridge는 목록의 생성 시각을 확인해 기간 밖 주문 상세 호출을 생략합니다. 종료된 소스는 다음 페이지에서 제외합니다. Blockscout와 Solana 서명 이력은 최근 페이지를 순회하며 시작 시각을 지나면 멈춥니다. Solana 거래 상세는 기간 안 서명만 조회합니다. 과거 기간으로 바로 이동하는 기능이 없는 API는 페이지 한도 때문에 해당 기간까지 도달하지 못할 수 있으며 이 경우 부분 조회로 표시합니다. [Midgard 필터 구현](https://gitlab.com/thorchain/midgard/-/blob/develop/internal/timeseries/actions.go), [Wormholescan OpenAPI](https://api.wormholescan.io/swagger.json).
- **연결 조건:** 브릿지 도착이 보고되고 도착 거래·수취 주소·자산·수량·시각이 있어야 후속 송금을 연결합니다. 같은 체인의 실제 송수신 주소, 같은 토큰 주소/mint, 시간 순서, 이전 수취액 이하인 송금액을 대조합니다. 일반 송금끼리 동일 거래라면 명령/로그 순서를 확인합니다. 브릿지 도착 거래 내부의 후속 송금은 지급 명령 순서를 알 수 없어 제외합니다. 출발 시간이 없어 기간을 검증할 수 없는 브릿지는 제외합니다. 중간 브릿지 진입도 이전 수취액·자산·출발 주소·시각을 대조하고, 브릿지 주문의 도착 정보를 통해 체인과 자산을 바꿉니다. 브릿지 거래 내부의 명령 순서를 모르는 경우 동일 해시만으로 연결하지 않습니다.
- **시각화·근거:** 브릿지 구간 뒤에 일반 송금 노드와 주황색 선을 추가합니다. 경로별 송금 해시·원본 전송 근거·수량·시각·전체 주소·탐색기 링크를 확인할 수 있습니다. 주소 간 조회의 지도, 거래 목록, JSON에는 최종 도착 B와 지정한 도착 체인까지 연결된 경로만 포함합니다. B까지 연결하지 못한 출발 거래와 곁가지 거래는 제외하며, 조회 실패와 탐색 한도는 조회 로그와 부분 조회 표시로 남깁니다. 한 후속 송금이 여러 브릿지 입금과 연결될 때 해당 경로마다 귀속 미확정을 표시합니다.
- **연결 거래:** 브릿지 출발·도착 및 경로의 일반 송금 해시를 체인별로 중복 제거합니다. 여러 해시 조회에서 앞 구간 도착 해시와 다음 구간 출발 해시가 같은 체인에서 일치하면 보라색 점선으로 표시합니다. 이는 같은 거래 접점이며 동일 자금의 연속 이동을 증명하지 않습니다.

일반 송금(브릿지 전후 및 브릿지 없는 경로)의 현재 지원 범위:

| 체인 | 조회 방식 | 포함 범위 |
| --- | --- | --- |
| Solana | 공개 RPC, 메인넷 genesis 검증 및 백업 | 성공한 SOL 및 SPL/기본 Token-2022 transfer 명령, 내부 명령, 토큰 계정 소유자 복원 |
| Ethereum·Arbitrum·Optimism·Base·Gnosis·Scroll·Celo | 공개 Blockscout | ERC-20 Transfer, 성공한 일반 native value 송금 |
| Tron | 공개 TronGrid | confirmed TRC-20 Transfer |

Solana RPC는 PublicNode와 Solana 공식 엔드포인트를 사용하며 순차 요청, 250ms 간격, 실패 시 백업과 cooldown, 요청 공유 및 캐시를 적용합니다. [서명 이력](https://solana.com/docs/rpc/http/getsignaturesforaddress), [파싱 거래](https://solana.com/docs/rpc/http/gettransaction), [토큰 계정](https://solana.com/docs/rpc/http/gettokenaccountsbyowner)을 조회합니다. EVM과 Tron은 각각 [Blockscout REST](https://docs.blockscout.com/devs/apis/rest), [TronGrid TRC-20 이력](https://developers.tron.network/reference/get-trc20-transaction-info-by-account-address)을 사용합니다.

탐색은 최초 브릿지 20개, 주소 12개, 중간 브릿지 조회 주소 8개, 80개 거래·이벤트, 큐 60개·확장 상태 100개, 연결 경로 50개로 제한됩니다. 경로 탐색 예산은 90초이며 이미 요청 중인 조회 시간만큼 초과할 수 있습니다. 브릿지 주소별 페이지 조회에도 30초 예산을 적용합니다. 화면에는 최대 12개 경로를 동시에 그리며 목록에서 특정 브릿지 경로를 선택할 수 있습니다. Solana는 계정별 페이지당 20개 서명을 조회하고 토큰 mint 최대 8개, mint당 현재 토큰 계정 최대 4개를 조회합니다. 일반 송금으로 시작할 때는 두 토큰 프로그램별 현재 계정을 최대 8개씩 탐색합니다. 한도·실패는 부분 조회로 표시합니다.

닫힌 Solana 토큰 계정, 미파싱 명령, Token-2022 전송 수수료, EVM 내부 native 송금, TRX/TRC-10, 스왑·분할 합산 경로는 현재 탐색에서 제외됩니다. 중간 브릿지도 연결된 인덱서가 수취 주소와 자산·수량·시각을 제공하는 경우에만 이어갈 수 있습니다. 동일 자산을 가진 지갑에서 잔액이 섞이면 어느 입금으로 어떤 출금을 했는지 단정할 수 없습니다. **결과는 조회 범위에서 관측된 주소 연결이며, 모든 체인·전체 이력·동일 자금 귀속을 보장하지 않습니다.**

입력별 성공·미발견·부분 실패·실패와 소스별 조회 로그를 보존합니다. JSON 내보내기에는 검색 조건, 입력별 상태, 연결 거래, 일반 송금 근거, 경로 및 조회 범위가 포함됩니다. 최근 기록에는 절대 시작·종료 시각을 저장해 같은 기간으로 재조회할 수 있습니다. 일반 송금으로 시작하는 경로는 `AddressPath.source`와 순서 있는 `steps`에 담고, 중간 브릿지는 해당 단계에 출발·도착·원본 근거를 함께 보존합니다. LI.FI는 기간 조회, LayerZero·CCIP는 첫 페이지, 다른 인덱서는 각 페이지 상한을 따릅니다. 최종 수취인을 제공하지 않는 브릿지는 후속 경로를 확인할 수 없습니다.

실거래 검증 fixture: `tests/fixtures/arbitrum-solana-forward.json`. Arbitrum의 deBridge 출발 → Solana 수취 → 약 79초 뒤 다른 Solana 주소로 보낸 SOL 송금을 공개 API/RPC로 확인했습니다. 별도로 2단계 송금, 잘못된 자산·시간·수량, 복수 입금 귀속의 모호성, 부분 실패, 위조 SPL 프로그램, 잘못된 Solana 클러스터의 백업 전환을 테스트합니다.

deBridge 요청은 서버 전체에서 순차 처리하고 응답 후 250ms 간격을 둡니다. 같은 검색 안에서 같은 주문의 상세 조회는 진행 중 요청을 공유하며, 완료 주문은 5분, 나머지는 15초 캐시합니다. 캐시된 근거에는 원래 조회 시간을 유지합니다. 429 응답 시 5초 동안 새 요청을 제한하며, 상세 일부만 실패해도 `partial` 상태로 표시합니다.

## 공개 RPC 장애 처리

1. [Chainlist 공식 API](https://chainlist.org/rpcs.json)에서 메인넷별 HTTPS RPC를 읽고 6시간 캐시합니다.
2. 체인당 최대 12개 후보를 유지하고 요청당 최대 4개 엔드포인트를 시도합니다.
3. `eth_chainId`를 확인한 후 데이터를 읽습니다. 같은 URL이 다른 체인에 등록된 경우 다시 검증합니다.
4. 요청별 4.5초 timeout, 전역 RPC 동시 요청 6개 제한, 오류 시 최대 5분 cooldown을 적용합니다.
5. 트랜잭션 미발견은 두 RPC에서 확인합니다. 한 노드만 응답했다면 미발견을 확정하지 않습니다.
6. Chainlist를 읽지 못하면 저장된 1,792개 체인 메타데이터 스냅샷을 사용합니다. 이 중 EVM 공개 RPC가 등록된 체인은 1,741개입니다. RPC 이력은 메모리에 유지합니다.

해시의 체인 자동 탐색은 주요 EVM 12개 체인입니다. 다른 체인은 UI에서 선택하세요. 실제 인덱서가 해시의 체인을 알려주면 그 체인을 우선 사용합니다. 영수증 검증은 검색 결과의 첫 8개 경로에 제한됩니다. 결과는 30초, 영수증은 45초 캐시합니다. 검증 시점 이후 재조직 가능성은 남습니다.

### 체인 이름과 프로토콜 ID

체인 디렉터리는 현재 1,841개 네트워크의 이름을 표시합니다. Chainlist 메타데이터와 비 EVM 체인, 프로토콜 고유 ID를 결합한 숫자이며 전체 브릿지 추적 지원 수가 아닙니다. 공개 RPC가 없는 체인도 이름은 유지합니다.

- LI.FI 66개 ID, deBridge 18개 ID, LayerZero 368개 메인넷 엔드포인트 ID, Wormhole 73개 체인 ID를 각각 별도 매핑으로 관리합니다. 동일 체인의 여러 버전 ID가 포함됩니다.
- deBridge의 `100000026`, LI.FI의 `728126428`, LayerZero의 `30420`은 모두 `Tron`으로 표시하고 Tronscan 거래 링크를 제공합니다.
- Solana·Bitcoin·Tron·Sui·Aptos·Stellar·TON·Starknet·XRP Ledger·Fogo·HyperCore·Cosmos 계열을 선택할 수 있습니다. 비 EVM 체인에 `eth_*` RPC를 보내지 않습니다.
- LI.FI·deBridge·LayerZero 목록은 6시간 간격으로 갱신하며 실패하면 저장된 매핑을 유지합니다. 미등록 Wormhole/LayerZero ID는 출처를 붙여 표시하고 EVM ID로 해석하지 않습니다.
- `npm run update:chains`는 공식 메타데이터와 Wormhole 최신/레거시 SDK의 상수 데이터를 읽어 저장된 목록을 갱신합니다. 다운로드한 소스 코드는 실행하지 않습니다.

체인 ID 출처: [LI.FI](https://docs.li.fi/api-reference/get-information-about-all-currently-supported-chains), [deBridge](https://dln.debridge.finance/v1.0/supported-chains-info), [LayerZero](https://metadata.layerzero-api.com/v1/metadata/deployments), [Wormhole SDK](https://github.com/wormhole-foundation/wormhole-sdk-ts/tree/main/core/base/src/constants). 숫자는 2026-10-16 KST 확인 기준입니다.

### 로고 에셋

체인·브릿지는 `public/logos`에 저장한 실제 로고를 경로맵, 거래 목록, 상세 패널, 지원 목록에서 함께 사용합니다. 검색 중에는 외부 이미지 서버에 요청하지 않습니다. 등록되지 않았거나 파일을 읽지 못한 항목은 이름의 약자로 표시합니다. L2 공식 브릿지는 입출금 방향과 관계없이 해당 L2 로고를 사용합니다.

`npm run update:logos`로 로고와 매핑을 갱신합니다. `shared/logo-catalog.json`에 원본 URL과 출처를 보관하고, 화면에는 가벼운 `src/logo-data.json`을 사용합니다. 색상·비율은 원본을 유지하며 라이트 모드용 검정 로고나 공식 배경 포함 버전을 선택합니다. deBridge는 공식 노란 배경·검정 심볼 버전입니다.

출처: [LI.FI 체인·브릿지 에셋](https://github.com/lifinance/types/tree/main/src/assets/icons), [deBridge 브랜드 키트](https://debridge.com/brand/), [Wormhole·Portal](https://wormhole.com/brand-and-press), [Chainlink](https://chain.link/brand-assets), [THORChain](https://thorchain.org/brand-assets), [rhino.fi](https://rhino.fi), [LayerZero](https://layerzero.network). 로고의 권리는 각 브랜드에 있습니다.

## 선택적 API 키

`.env.example`을 참고해 `.env`에 설정합니다. `.env`는 Git에서 제외됩니다. 키를 브라우저에 보내거나 `VITE_*` 변수로 두지 않습니다.

| 환경 변수           | 용도                                                            |
| ------------------- | --------------------------------------------------------------- |
| `LIFI_API_KEY`      | LI.FI 요청 한도 확대. 무키 한도는 조사 당시 2시간당 200회       |
| `ETHERSCAN_API_KEY` | Etherscan V2 일반 거래 이력. 체인별 무료 플랜 지원 범위가 다름  |
| `RHINO_API_KEY`     | rhino.fi history API bearer token. 통합 계정의 권한 범위만 조회 |
| `PORT` / `HOST`     | 기본 `4317` / `127.0.0.1`                                       |

조회한 주소·해시는 관련 공개 RPC/인덱서에 전달됩니다. 로컬 기록 지우기는 이 브라우저의 검색어 기록만 삭제합니다.

## 검증

```sh
npm test
npm run check:live
npm run build
```

- 단위/회귀 테스트 91개: 금액 정밀도, 소수점 미확인, 입력 분류, RPC 체인 불일치·장애 전환·미발견 교차 확인, 위조 이벤트, 환불, protocol ID 매핑 및 네임스페이스 충돌, 트론 탐색기 링크, 메시지 중복, OP 실제 receipt의 해시 계산, 내부 실행 실패 구분, 주소 이력 일부 실패 시 결과 보존, 서버 연결 오류 안내·취소·잘못된 응답 구분, 다중 해시 중복·부분 실패, 주소 방향·체인·기간 필터, 페이지 누적, 동일 거래 접점의 오연결 방지, deBridge 상세 요청 공유·캐시 시각·부분 실패
- 2026-10-16 확장 후: 일반 송금 3단계, 송금 전후 및 3회 연속 브릿지, 자산·시각·수량 오연결 방지, 기간 필터·상세 조회 생략·페이지 조기 종료 테스트 통과. 실제 Solana 일반 송금만 있는 경로와 Arbitrum → deBridge → Solana → 일반 송금을 21:30–21:35 KST 구간으로 브라우저에서 조회하고 JSON 내보내기를 확인했습니다. 각각 거래 1개/3개, 기간 필터 적용, 해당 요청에서 오류·조회 중단 없음. 다중 브릿지는 합성 fixture로 검증했습니다.
- Vercel 대응: Node.js 22에서 91개 테스트 통과. Vercel CLI의 독립 빌드 산출물을 직접 import하여 API, JSON 스냅샷, 로고, 연락처 주석 확인. 시간 초과 시 부분 결과 보존, 요청 간 취소 격리, 선택적 공유 요청 제한, 연결 종료, 잘못된 입력과 API 경로 응답 검증. 빌드된 API에서 실제 Ethereum → deBridge → Arbitrum 경로 및 양쪽 RPC 영수증 확인. 실제 Vercel 호스팅 환경의 검증은 배포 후 수행해야 합니다.
- 선택적 라이브 테스트: LI.FI, deBridge, Stargate, Wormhole, THORChain, CCIP의 실제 출발 해시 → 예상 도착 해시 대조. 공개 API 가용성·한도에 영향을 받음
- 2026-10-16 체인 ID 수정 후 LI.FI·deBridge·Stargate·Wormhole·CCIP 실거래 대조 및 Solana → Tron 2개 경로 재조회 통과. THORChain은 이 재검증에서 공개 API 접속 실패/DNS 오류로 확인하지 못함
- 2026-10-16 다중 해시·주소 간 조회를 브라우저에서 확인. Solana 출발·Tron 도착 해시 통합 및 동일 주소 쌍의 최근 30일/3페이지 조회에서 21개 경로·42개 거래 확인. 요청 제한 보완 후 부분 실패 없이 결과 유지, JSON 검색 조건·주소 역할·거래 수 대조, 기록 복원·모바일 가로 넘침 확인
- 실제 Base 공식 입금의 2,000 UNI와 대응 L2 Finalized 이벤트를 RPC로 검증
- 주소 조회에서 Base → Solana Wormhole 경로를 확인. 이 환경에서 Base Blockscout 조회가 timeout된 경우는 실패 진단으로 표시됨
- 데스크톱/모바일 브라우저에서 조회·그래프·타임라인·필터·근거·커버리지·설정 화면 점검. JSON 다운로드의 출발/도착 해시와 근거 필드 확인

라이브 테스트는 조회만 수행합니다. 합성 데이터를 실제 조회 결과로 대체하지 않습니다. 테스트 fixture는 공개된 실제 Ethereum receipt입니다.

## 코드 구조

- `server/adapters/`: 프로토콜 API 응답을 공통 경로 모델로 변환
- `server/trace.ts`: 입력 검증, 동시 조회, 관측 병합, 범위·실패 진단
- `server/investigate.ts`: 여러 해시·주소 쌍 조회, 기간·페이지 조기 종료, 중복 관측 병합, 연결 거래와 동일 거래 접점
- `server/fund-paths.ts`: 일반 송금·중간 브릿지의 제한된 순방향 탐색
- `server/transfers.ts`, `server/time-window.ts`: 송수신 이력·시간 범위·요청 예산
- `server/rpc.ts`, `server/chains.ts`: Chainlist, 체인 검증, 백업·cooldown
- `server/chain-catalog.ts`, `scripts/update-chain-catalog.ts`: 프로토콜별 체인 ID 정규화, 비 EVM 메타데이터와 공식 목록 갱신
- `server/official-registry.ts`, `server/onchain.ts`: 공식 배포 주소, ABI 이벤트, OP 입금 해시·Finalized 대조
- `server/history.ts`: 공개 탐색기의 주소 거래 후보
- `shared/types.ts`: 경로·근거·진단 데이터 모델
- `src/`: React UI와 React Flow 그래프
- `tests/`, `scripts/check-live.ts`: 회귀/라이브 검증

새 브릿지는 `AdapterInput → AdapterResult` 어댑터를 추가하고 `trace.ts`와 `capabilities.ts`에 등록합니다. 반드시 프로토콜 고유 ID, 출발·도착 역할, 실패/환불 상태, 수량 단위, 인덱싱 범위를 확인해야 합니다.

## 공식 참고 자료

- [Chainlist 데이터](https://github.com/DefiLlama/chainlist)
- [LI.FI status](https://docs.li.fi/api-reference/check-the-status-of-a-cross-chain-transfer), [주소 transfers](https://docs.li.fi/api-reference/get-a-list-of-filtered-transfers)
- [deBridge DLN tracking](https://docs.debridge.com/dln-details/integration-guidelines/order-creation/order-tracking-api/tracking-orders)
- [LayerZero Scan API](https://docs.layerzero.network/v2/tools/layerzeroscan/mainnet/messages/get-messagestx)
- [Wormholescan API](https://wormhole.com/docs/products/messaging/guides/wormholescan-api/)
- [THORChain 공개 endpoints](https://dev.thorchain.org/concepts/connecting-to-thorchain.html)
- [CCIP messages](https://docs.chain.link/ccip/tools/api/get-messages)
- [rhino.fi status/history](https://docs.rhino.fi/api-integration/status-history)
- [OP StandardBridge 명세](https://specs.optimism.io/protocol/bridges.html), [Superchain 등록부](https://github.com/ethereum-optimism/superchain-registry), [Base 공식 배포 주소](https://docs.base.org/base-chain/network-information/base-contracts)
- [Arbitrum SDK 공식 네트워크 설정](https://github.com/OffchainLabs/arbitrum-sdk/blob/master/packages/sdk/src/lib/dataEntities/networks.ts)

### 화면 언어와 공개 화면

상단의 한국어 / English 버튼으로 검색, 경로맵, 상세 근거, 조회 기록과 오류 안내를 전환합니다. 언어 변경 시 입력과 현재 조회 결과를 유지하며, 선택한 언어는 이 브라우저에 저장됩니다. 날짜도 선택한 언어로 표시합니다.

공개 화면에서 로컬 환경 표시, RPC 관리 메뉴, API 키 설정창과 원시 JSON 패널을 제거했습니다. 거래 근거, 출처 링크와 조회 한계는 유지하고, 원본 데이터는 JSON 내보내기로 확인할 수 있습니다. 화면 문구에는 가운뎃점과 em dash를 사용하지 않습니다. 번역은 표시 단계에 적용하므로 주소, 해시, 수량과 내보내는 원본 데이터는 변경하지 않습니다.

프로젝트 로고는 [제공된 원본 이미지](https://pbs.twimg.com/profile_images/2009076400863772672/rcoQOHsV_400x400.jpg)를 `public/tx-tracer-logo.jpg`에 저장해 사이드바와 브라우저 아이콘에서 사용합니다. 공개 화면은 트랜잭션 추적과 조회 기록으로 구성합니다.
