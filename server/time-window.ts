export interface TimeWindowInput { days: number; startTime?: string; endTime?: string }
export function timeWindow(input: TimeWindowInput, now = Date.now()) {
  if (!!input.startTime !== !!input.endTime) throw new Error("시작·종료 시각을 모두 입력하세요.");
  const end = input.endTime ? Date.parse(input.endTime) : now;
  const start = input.startTime ? Date.parse(input.startTime) : end - input.days * 86400_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error("시작 시각은 종료 시각보다 빨라야 합니다.");
  if (end - start > 365 * 86400_000) throw new Error("조회 기간은 최대 365일입니다.");
  if (end > now + 60_000) throw new Error("종료 시각은 현재보다 미래일 수 없습니다.");
  return { start, end, startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString() };
}
export const inWindow = (timestamp: string | undefined, start: number, end: number) => {
  const time = Date.parse(timestamp || "");
  return Number.isFinite(time) && time >= start && time <= end;
};
