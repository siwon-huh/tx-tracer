export async function requestJson<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(
      "서비스에 연결할 수 없습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.",
    );
  }
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `조회 서버가 올바른 응답을 반환하지 않았습니다 (HTTP ${response.status}). 잠시 후 다시 조회하세요.`,
    );
  }
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : `조회 요청에 실패했습니다 (HTTP ${response.status}).`,
    );
  }
  return data as T;
}
