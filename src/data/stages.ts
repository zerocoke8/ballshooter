import type { StageDef } from '../types';

// 문자 → 적 id. 모든 스테이지가 공유한다.
const LEGEND: Record<string, string> = {
  s: 'soldier',
  b: 'block',
  d: 'dartgun',
  r: 'robot',
  j: 'jack',
  o: 'balloon',
  T: 'teddy', // 2×2
  B: 'boss_robot', // 4×3
  // 행동하는 적 (st2부터 조금씩, RC카는 st4부터 — 병정 자리를 대신해 대형 모양·공격형 비율은 그대로)
  k: 'shield', // 방패병: 정면(아래)에서 맞으면 튕겨 냄
  h: 'healer', // 치유병: 둘레 회복
  x: 'bomber', // 폭탄병: 죽으면 둘레 적에게 큰 피해
  a: 'armored', // 장갑병: 관통 아닌 공은 30%
  g: 'splitter', // 젤리: 죽으면 꼬마 젤리 둘
  l: 'splitling', // 꼬마 젤리 (보통은 젤리에서 나온다)
  c: 'shifter', // RC카: 옆 빈 칸으로 미끄러짐
};

/**
 * 화면에 보이는 모양 그대로(위 → 아래) 적고 rows 순서(rows[0] = 가장 아래, 먼저 등장)로 뒤집는다.
 * 여러 칸짜리 적은 좌하단 칸에 문자를 쓰고 덮이는 칸은 '.'.
 */
function fromTop(lines: string[]): string[] {
  return [...lines].reverse();
}

/** 웨이브 사이 빈 줄 (대형이 다 내려온 뒤 뒤쪽에 공이 튈 공간) */
const GAP = '........';

// ── 레벨 디자인 규칙 (tests/data.test.ts가 검사) ──────────────
// - 스테이지 = 웨이브 3~5개. 웨이브 = 3~7줄의 빽빽한 블록, 대부분의 줄은 8칸 중 6~7칸.
// - 모든 줄에 빈칸이 1칸 이상. 빈칸은 줄마다 옆으로 밀려 통로·주머니를 만든다
//   → 틈으로 들어간 공이 웨이브 뒤쪽(다음 웨이브와의 빈 공간·천장)에서 튕기며 뒤에서부터 부순다.
// - 웨이브마다 조준 가이드(직선 + 벽 반사 1번)로 '노릴 수 있는' 길이 1개 이상: 곧은 통로(1칸 기둥),
//   폭 2칸이 끝까지 유지되는 45° 균열, 벽을 타는 통로. 1칸짜리 지그재그·좁아지는 균열은 직선이 못 지나가
//   운으로만 들어간다 → 지그재그 모양은 '곧은 통로 + 좌우로 번갈아 붙은 주머니'로 만든다.
// - 웨이브 사이에는 빈 줄 3~4개.
// - 공격형(다트총·로봇·깜짝 상자)은 초반 ~8%, 후반 ~15% 이하. 곰인형(2×2)은 st3부터 엘리트.
// - 행동하는 적은 병정 자리를 대신한다(모양·통로·공격형 비율 그대로): st2 방패·폭탄·젤리 → st3 + 장갑·치유 → st4 + RC카.
//   방패병은 주로 앞줄 가장자리·벽 통로 옆(정면을 막아 비스듬히·뒤로 치게), 치유병은 뒷줄(틈·백어택으로 먼저 잡을 적),
//   폭탄병은 빽빽한 가운데(연쇄), RC카는 옆에 빈칸이 있는 자리(통로를 막았다 열었다 한다 — 린트는 처음 모양만 본다).
// 아래 배열은 화면 그대로: 위쪽 웨이브가 나중에 내려온다. 각 웨이브의 맨 아래 줄이 그 웨이브의 앞줄.
//
// 네 번째 난이도 조정 — 재미 기능(백어택·행동하는 적·시너지·레벨업·액티브 스킬) 뒤 (docs/DESIGN.md '네 번째 난이도 조정'):
// 레벨업(전투 중 무료 아이템·★ + 1·런 보너스)으로 프로브 빌드의 초당 피해가 st2~st5에서 2~2.7배가 되어 모든 스테이지가 100%였다 →
// HP 배수 st2 2 → 3.6 · st3 3.1 → 9.1 · st4 4 → 12.2 · st5 6.2 → 14.9 (대왕 로봇은 따로 — data/enemies.ts),
// 공격 배수 st3 1.9 → 2.6 · st4 1.8 → 2.4 (가만히 서 있으면 진다), st5 하강 25 → 23 (보스전이 하강 시계보다 톱니 소모로 갈리게). st1은 그대로.

export const STAGES: StageDef[] = [
  {
    id: 'st1',
    name: '러그 위의 행진',
    // 24에서는 펭구(느린 참치 미사일·생선)가 시드 40개 중 3~5판 방어선을 뚫렸다 — 튜토리얼은 거의 항상 이겨야 한다
    descentSpeed: 23,
    hpMul: 1,
    dmgMul: 1,
    clearGold: 10,
    background: 'bg_toyroom',
    legend: LEGEND,
    rows: fromTop([
      // W3: 가운데 곧은 통로(옆 주머니로 지그재그 모양) + 오른쪽 앞·뒤 주머니
      'sso.sb.s',
      'ss..sjss',
      'sbs.ss.s',
      GAP,
      GAP,
      GAP,
      // W2: 왼쪽 아래 → 오른쪽 위 대각선 균열 (폭 2칸이 끝까지 — 왼쪽 벽에 한 번 튕겨 45°로 노린다)
      'ssoo..ss',
      'sss..sss',
      'ss..sdss',
      's..sssss',
      GAP,
      GAP,
      GAP,
      // W1 (튜토리얼): 곧게 뚫린 통로 두 개. 쏘는 적 없음 — 조준·틈 쏘기만 배운다
      // (다트총은 W2, 깜짝 상자는 W3에서 처음. 여기 다트총이 있으면 안 피하는 첫 판이 HP를 절반 넘게 잃었다)
      'so.ss.os',
      'ss.ss.ss',
      'ss.ss.ss',
    ]),
  },
  {
    id: 'st2',
    name: '블록 탑 공사장',
    descentSpeed: 27,
    hpMul: 3.6,
    dmgMul: 1.2,
    clearGold: 16,
    background: 'bg_toyroom',
    legend: LEGEND,
    rows: fromTop([
      // W3: 오른쪽 벽 통로 + 가운데 주머니. 앞줄 양끝 방패, 젤리·폭탄 하나씩
      'ssbs.sb.',
      'sbos.sg.',
      'sdss.sb.',
      'ssr.sxs.',
      'kbs.sbk.',
      GAP,
      GAP,
      GAP,
      // W2: 오른쪽 아래 → 왼쪽 위 대각선 균열 (폭 2칸이 끝까지 — 오른쪽 벽 반사로 노린다). 젤리·폭탄 하나씩
      's..sosss',
      'sb..sgbs',
      'sjs..sbs',
      'sxbs..ss',
      'sdbss..s',
      GAP,
      GAP,
      GAP,
      // W1: 블록 기둥 두 개 사이 곧은 통로 + 옆 주머니·뒤 주머니. 첫 방패병(왼쪽 앞)·첫 폭탄병(가운데)
      'sb.ss.bs',
      'sb..sobs',
      'sb.sxsbs',
      'kb.srsbs',
    ]),
  },
  {
    id: 'st3',
    name: '깜짝 상자 소동',
    descentSpeed: 32,
    hpMul: 9.1,
    dmgMul: 2.6,
    clearGold: 20,
    background: 'bg_toyroom',
    legend: LEGEND,
    rows: fromTop([
      // W3: 곰인형(엘리트) 옆 통로 + 곰인형 밑 주머니. 뒷줄 치유병, 곰인형 옆 폭탄병
      'ss.shsos',
      'ss...sbs',
      'sj.T.sxs',
      'sa..sjss',
      'bs.kdbg.',
      GAP,
      GAP,
      GAP,
      // W2: 양쪽 벽을 타고 올라가는 통로. 왼쪽 통로 옆 방패, 뒷줄 치유병
      '.sbsjhs.',
      '.sxosba.',
      '.sbgsss.',
      '.ksdsjs.',
      GAP,
      GAP,
      GAP,
      // W1: 곧은 통로(좌우 주머니로 지그재그 모양) + 왼쪽 앞 주머니. 첫 장갑병·첫 치유병(뒷줄)
      'shss.sbs',
      'sbs..sos',
      'ssjs.sxs',
      'sbsa..bs',
      'kr.s.ssb',
    ]),
  },
  {
    id: 'st4',
    name: '곰인형 반란',
    descentSpeed: 34,
    hpMul: 12.2,
    dmgMul: 2.4,
    clearGold: 26,
    background: 'bg_toyroom',
    legend: LEGEND,
    rows: fromTop([
      // W4: 곰인형 둘 사이로 곧은 통로. 곰인형 사이 폭탄병
      'ssd..dhs',
      's...x..s',
      'oT..sT.o',
      'baj.sgjb',
      'kbs.kbs.',
      GAP,
      GAP,
      GAP,
      // W3: 왼쪽 아래 → 오른쪽 위 대각선 균열 (폭 2칸이 끝까지). 균열 옆 RC카
      'shss..sb',
      'sbs..sxs',
      'sj..crss',
      's..adsbs',
      '..kbsjsk',
      GAP,
      GAP,
      GAP,
      // W2: 가운데 곰인형 + 그 왼쪽 곧은 통로 + 오른쪽 앞 주머니. 통로 옆 RC카
      'ss.shoss',
      'sb...sbs',
      'sd.T.xds',
      'sa..cjss',
      'bk.sgbs.',
      GAP,
      GAP,
      GAP,
      // W1: 가운데 곧은 통로(옆 주머니로 지그재그 모양) + 왼쪽 앞 주머니. 첫 RC카(주머니 옆)
      'shr..rss',
      'sbxs.sbs',
      'sjc..sbs',
      's.sa.sjs',
      'k.bs.kbs',
    ]),
  },
  {
    id: 'st5',
    name: '대왕 로봇 출동',
    descentSpeed: 23,
    hpMul: 14.9,
    // 3.4 → 4.0: 보스 톱니를 약하게 한 대신 앞 웨이브(다트총·깜짝 상자·곰인형) 탄을 세게 — 피하지 않으면(가만히) 진다
    dmgMul: 4.0,
    clearGold: 0,
    background: 'bg_toyroom',
    legend: LEGEND,
    rows: fromTop([
      // W3 (보스): 대왕 로봇 양옆은 비워 두고, 앞의 호위 줄 통로가 그 옆으로 이어진다.
      // 호위 줄 가운데 폭탄병 둘(터지면 바로 위 대왕 로봇도 휘말림), 앞줄 방패
      'o......o',
      '........',
      '..B.....',
      'r.sxxs.r',
      'b.kbbk.b',
      GAP,
      GAP,
      GAP,
      // W2: 곰인형 왼쪽 곧은 통로(뒤까지 뚫림) + 오른쪽 주머니. 주머니를 오가는 RC카
      'sj.hsbjs',
      'sb..xsbs',
      'sc....rs',
      'sd.T..ds',
      'bk.sb.kb',
      GAP,
      GAP,
      GAP,
      // W1: 오른쪽 아래 → 왼쪽 위 대각선 균열 (폭 2칸이 끝까지)
      's..shjsb',
      'sd..xbss',
      'bsa..sbs',
      'sjbc..ss',
      'kgbsb..k',
    ]),
  },
];
