import test from 'node:test';
import assert from 'node:assert/strict';
import { translateText } from '../src/translations';
import messages from '../src/messages.en.json';
import { capabilities } from '../server/capabilities';

test('public UI and coverage copy has no prohibited separators in either language', () => {
  for (const source of [...Object.keys(messages), ...capabilities.flatMap(c => [c.name, c.tx, c.address, c.description])]) {
    for (const language of ['ko', 'en'] as const) assert.doesNotMatch(translateText(source, language), /[·・—]/, source);
    assert.doesNotMatch(translateText(source, 'en'), /[가-힣]/, source);
  }
});

test('dynamic route, receipt and multi-hop descriptions translate their nested values', () => {
  assert.equal(translateText('B까지 연결 2개 · 미연결 1개', 'en'), '2 connected to B / 1 unresolved');
  assert.equal(translateText('출발 receipt 성공 · block 18221489', 'en'), 'Source transaction successful / Block 18221489');
  assert.equal(translateText('후속 외부 호출 상태: NoExtCall. 자산 전달 상태와 별개입니다.', 'en'), 'Subsequent external call status: No subsequent call. This is separate from asset delivery status.');
  assert.equal(translateText('3분 29초', 'en'), '3m 29s');
  assert.equal(translateText('최대 12개 경로 표시 · 전체 18개', 'en'), 'Showing up to 12 of 18 routes');
  assert.equal(translateText('RPC · Arbitrum One', 'ko'), '온체인 기록 / Arbitrum One');
});

test('translations preserve identifiers, amounts, unknown brands and line breaks', () => {
  for (const value of ['0x3fe11542154f53dcf3134eacb30ea5ca586c9e134c223e56bbe1893862469bc5', '9sq2APNSuucW5kB3YGC1n1yn8cz3XqCvuMdrhXAgJMoM', '0.000000000000000001 ETH', 'deBridge DLN', 'tx1\ntx2']) {
    assert.equal(translateText(value, 'en'), value);
    assert.equal(translateText(value, 'ko'), value);
  }
  const input = '도착 확인';
  assert.equal(translateText(input, 'en'), 'Arrival confirmed');
  assert.equal(translateText(input, 'ko'), input);
});

test('operational endpoint details are excluded while evidence is retained', () => {
  assert.equal(translateText('eth.drpc.org · block 18221489', 'en'), 'Block 18221489');
  assert.equal(translateText('arb1.arbitrum.io · block 134846294', 'ko'), '블록 134846294');
  assert.equal(translateText('RPC transaction receipt', 'en'), 'Blockchain transaction record');
});
