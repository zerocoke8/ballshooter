import type { EnemyDef } from '../types';

// hp는 스테이지 0 기준(스테이지 hpMul 곱해짐), 공격 damage는 stage.dmgMul 곱해짐.
// 몸에 닿으면 피해가 아니라 즉시 패배라(CombatSim lostReason 'contact') 접촉 피해 수치는 없다.
// 처치 경험치 xp(레벨업 — docs/DESIGN.md '레벨업')는 기본값(보스 0, 그 밖은 칸 수 w × h — 곰인형 4)과 다를 때만 적는다:
// 치유병 2(먼저 잡을 적), 꼬마 젤리 0(젤리 한 마리 몫은 젤리가 준다 — 갈라진 조각으로 경험치를 불리지 않게).
const ENEMY_LIST: EnemyDef[] = [
  {
    id: 'soldier',
    name: '태엽 병정',
    sprite: 'enemy_soldier',
    w: 1,
    h: 1,
    hp: 25,
    gold: 0.15,
    dropChance: 0.01,
  },
  {
    id: 'block',
    name: '블록 골렘',
    sprite: 'enemy_block',
    w: 1,
    h: 1,
    hp: 60,
    gold: 0.4,
    dropChance: 0.01,
  },
  {
    id: 'dartgun',
    name: '다트총 병정',
    sprite: 'enemy_dartgun',
    w: 1,
    h: 1,
    hp: 30,
    gold: 0.5,
    dropChance: 0.02,
    attack: {
      kind: 'aimed',
      interval: 3.2,
      jitter: 1.5,
      projSpeed: 260,
      damage: 8,
      count: 1,
      spreadDeg: 0,
      sprite: 'shot_dart',
      radius: 12,
    },
  },
  {
    id: 'robot',
    name: '깡통 로봇',
    sprite: 'enemy_robot',
    w: 1,
    h: 1,
    hp: 40,
    gold: 0.5,
    dropChance: 0.02,
    attack: {
      kind: 'straight',
      interval: 2.6,
      jitter: 1.2,
      projSpeed: 300,
      damage: 8,
      count: 1,
      spreadDeg: 0,
      sprite: 'shot_bolt',
      radius: 12,
    },
  },
  {
    id: 'jack',
    name: '깜짝 상자',
    sprite: 'enemy_jack',
    w: 1,
    h: 1,
    hp: 34,
    gold: 0.5,
    dropChance: 0.02,
    // 간격 3.5 → 4.2초, 스프링 240 → 220 px/s (네 번째 조정 — docs/DESIGN.md): 적 체력이 레벨업에 맞춰 ~3배가 되며 깜짝 상자가 더 오래 살아
    // 두 상자의 조준 부채꼴이 겹치는 순간 이상적인 회피도 '안 맞는 자리가 없던' 순간이 st4에서 생겼다(시드 16개 × 캐릭터 3에 1~2번) → 0
    attack: {
      kind: 'spread',
      interval: 4.2,
      jitter: 1.5,
      projSpeed: 220,
      damage: 6,
      count: 3,
      spreadDeg: 24,
      sprite: 'shot_spring',
      radius: 13,
    },
  },
  {
    id: 'balloon',
    name: '풍선 강아지',
    sprite: 'enemy_balloon',
    w: 1,
    h: 1,
    hp: 12,
    gold: 0.8,
    dropChance: 0.08,
  },
  {
    id: 'teddy',
    name: '화난 곰인형',
    sprite: 'enemy_teddy',
    w: 2,
    h: 2,
    // 260 → 200 (네 번째 조정): × 스테이지 HP 배수가 ~3배가 되며 곰인형이 방어선 바로 위까지 버텨 코앞에서 조준탄을 쐈다 (이상적인 회피도 못 피함)
    hp: 200,
    gold: 3,
    dropChance: 0.5,
    attack: {
      kind: 'aimed',
      interval: 2.4,
      jitter: 1.0,
      projSpeed: 280,
      damage: 10,
      count: 1,
      spreadDeg: 0,
      sprite: 'shot_dart',
      radius: 14,
    },
  },
  {
    id: 'boss_robot',
    name: '장난감 대왕 로봇',
    sprite: 'enemy_boss_robot',
    w: 4,
    h: 3,
    // 체력 2050 → 1100 (× st5 6.2 = 6,820): 냉기가 공격을 멈추지 않게 바뀌어 보스가 보스전 내내 쏘고,
    // 보스 위에서 덜그럭거리는 공의 연타 피해가 줄어(BOSS_REHIT_*) 같은 체력이면 얼음 없는 빌드가 방어선 전에 못 잡는다.
    // 네 번째 조정(레벨업·스킬·백어택 뒤): 1100 → 2700 (× st5 14.9 = 40,230) — 보스전 12초 → 약 35초(프로브 빌드), 한 발 3 → 5.25 (× 4.0 = 21):
    // 보스전이 다시 '하강 시계 + 톱니 소모'의 경주가 되게 (프로브 빌드 st5 약 55~65%, 잃은 HP 중앙값 약 70%)
    hp: 2700,
    gold: 20,
    dropChance: 1,
    boss: true,
    // 부채꼴 5발 50°(발 사이 12.5°): 플레이어 높이에서 발 사이 ≈ 0.22 × 세로 거리 d. 틈으로 지나가려면 76 px
    // (톱니 지름 36 + 플레이어 지름 40) 넘게 벌어져야 하므로 d > 약 340 px(보스가 아직 높을 때)만 틈 사이로,
    // 그보다 가까우면 옆으로(조준선에서 0.47d + 38 px) 빠져나간다. 7발 70°는 폭이 필드보다 넓어 틈 사이로만 피할 수 있었다.
    // 냉기 중에도 쏜다(엘리트·보스는 냉기 저항 — 타이머가 CHILL_ATTACK_RATE_RESIST 속도로 흐름). 예전엔 냉기 중 멈춰서
    // 얼음이 있으면 보스가 거의 못 쏘고 없으면 한 발 34로 HP가 녹았다 → 간격 1.7 → 2.4초(대신 냉기에도 멈추지 않음),
    // 한 발 10 → 3 (st5 × 4.0 = 12). 프로브 회피 AI는 이 부채꼴을 볼리마다 0.7~0.8발 맞는다(가만히 0.8~0.9) — 사실상 피할 수 없는
    // 소모로 계산되므로 한 발을 작게 둔다. (네 번째 조정에서 다시 5.25 — 위 체력 주석)
    // 속도 230 → 200: 이동이 걷기(420 px/s, 가속 0.1초)로 바뀐 뒤, 깊이 내려온 보스(아래 끝이 플레이어 약 1.5칸 위)가 쏜 부채꼴은
    // 반응 0.25초인 이상적인 회피도 옆으로 다 빠져나가지 못했다(st5 판당 최대 1.3발, 3초 최대 19%). 200이면 이동 바꾸기 전 수준
    // (판당 최대 0.7발, 3초 최대 10%) — docs/DESIGN.md '이동 — 걷기·자유 이동·접촉 즉사'.
    attack: {
      kind: 'spread',
      interval: 2.4,
      jitter: 0.6,
      projSpeed: 200,
      damage: 5.25,
      count: 5,
      spreadDeg: 50,
      sprite: 'shot_gear',
      radius: 18,
    },
  },
  // ── 행동하는 적 (st2부터 조금씩 — docs/DESIGN.md '행동하는 적'). 체력은 첫 값 그대로(스테이지 HP 배수가 곱해짐), 치유병만 조정 ──
  // 모두 1×1, 쏘지 않는다(공격형 비율 린트와 무관). 체력은 병정(25) 근처 — 대형에서 병정 자리를 대신해 스테이지 길이가 크게 늘지 않게.
  {
    // 정면(아랫면)에서 맞은 공은 피해 없이 튕겨 낸다(관통 공도) — 옆·위(백어택)·폭발·연쇄·화상으로 잡는다
    id: 'shield',
    name: '방패병',
    sprite: 'enemy_shield',
    w: 1,
    h: 1,
    hp: 30,
    gold: 0.25,
    dropChance: 0.02,
    shield: true,
  },
  {
    // 3.5초마다 둘레(중심 거리 134 px ≈ 1.6칸 — 맞닿은 8칸) 다친 적을 최대 HP 25%씩 회복(보스는 아님). 다친 적이 없으면 찬 채로 기다렸다가
    // 다치는 순간 바로. 먼저 잡을 적이라 골드·드롭이 조금 많다. 첫 값(4초·15%)은 스테이지 체력의 3%만 회복해 있으나 없으나 같았다 → 약 두 배
    id: 'healer',
    name: '치유병',
    sprite: 'enemy_healer',
    w: 1,
    h: 1,
    hp: 25,
    gold: 0.6,
    dropChance: 0.04,
    xp: 2,
    heal: { interval: 3.5, jitter: 1, radius: 134, frac: 0.25 },
  },
  {
    // 죽으면 터져 둘레 적에게 큰 피해(× 스테이지 HP 배수) — 폭탄병끼리 연쇄. 플레이어는 안 맞는다
    id: 'bomber',
    name: '폭탄병',
    sprite: 'enemy_bomber',
    w: 1,
    h: 1,
    hp: 18,
    gold: 0.2,
    dropChance: 0.02,
    // 반경 134 px(≈ 1.6칸, 중심 ↔ 충돌 박스): 맞닿은 8칸 + 두 칸 옆(위·아래·좌·우). 40 × HP 배수 — 병정은 한 번에, 블록은 두 번
    deathBlast: { radius: 134, damage: 40 },
  },
  {
    // 관통하지 않는 공은 30%만 — 관통 무기(양말·참치·방귀)나 폭발·연쇄·화상으로
    id: 'armored',
    name: '장갑병',
    sprite: 'enemy_armored',
    w: 1,
    h: 1,
    hp: 30,
    gold: 0.4,
    dropChance: 0.03,
    armor: 0.3,
  },
  {
    // 죽으면 자기 칸·옆 빈 칸에 꼬마 젤리 둘 (틈을 메울 수도 있다)
    id: 'splitter',
    name: '젤리',
    sprite: 'enemy_splitter',
    w: 1,
    h: 1,
    hp: 24,
    gold: 0.2,
    dropChance: 0.02,
    splitOnDeath: { into: 'splitling', count: 2 },
  },
  {
    id: 'splitling',
    name: '꼬마 젤리',
    sprite: 'enemy_splitling',
    w: 1,
    h: 1,
    hp: 8,
    gold: 0.05,
    dropChance: 0,
    xp: 0,
  },
  {
    // 도착하고 3~4초마다 옆 빈 칸으로 한 칸 (0.4초에 미끄러짐) — 틈을 막았다 열었다 한다. 플레이어 쪽으로는 움직이지 않는다
    id: 'shifter',
    name: 'RC카',
    sprite: 'enemy_shifter',
    w: 1,
    h: 1,
    hp: 28,
    gold: 0.3,
    dropChance: 0.02,
    shift: { interval: 3, jitter: 1, speed: 210 },
  },
  {
    // 보스 테스트 전용 보스 (src/data/bosses.ts 'toybox_king'). 공격은 EnemyDef.attack이 아니라 BossDef의 행동 스케줄러가 한다.
    // 6×4칸 — 고정 위치(1~6열, 위끝 y 84)에서 양옆 1열과 천장 사이 틈으로 공이 돌아 올라가 윗면을 친다(백어택).
    // 체력은 스테이지 hpMul이 곱해진다(보스 테스트 ×17 — hpMul은 졸개 체력에 맞춘 값이라 보스는 이 hp로 맞춘다).
    // 3200 × 6 = 19,200이던 첫 값은 40~70초에 쓰러졌다 → 1700 × 17 = 28,900(약 1분 40초~2분). 백어택(보스 윗면 × 1.5)·레벨업·스킬이 들어온 뒤
    // 같은 체력으로 56~85초 · 승률 100%가 되어 2600 × 17 = 44,200 (프로브 수동 조준 회피 중앙값 95~117초, 승률 약 60~77%). 보상 없음(테스트 모드).
    id: 'toybox_king',
    name: '장난감 상자 대마왕',
    sprite: 'enemy_toybox_king',
    w: 6,
    h: 4,
    hp: 2600,
    gold: 0,
    dropChance: 0,
    boss: true,
  },
];

export const ENEMIES: Record<string, EnemyDef> = Object.fromEntries(ENEMY_LIST.map((d) => [d.id, d]));
