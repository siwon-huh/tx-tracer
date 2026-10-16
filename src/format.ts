import type { Leg } from "../shared/types";

export const short = (v?: string, n = 6) => v ? `${v.slice(0, n + 2)}…${v.slice(-n)}` : "미확인";
export const amountLabel = (leg: Leg, compact = true) => leg.amount
  ? `${compact && leg.amount.length > 18 ? `≈ ${Number(leg.amount).toLocaleString("en-US", { maximumSignificantDigits: 9 })}` : leg.amount} ${leg.symbol || "token"}`
  : leg.rawAmount ? "소수점 확인 전" : "금액 미확인";
