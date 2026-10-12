// 전역 상수. 로직·렌더 양쪽에서 쓰므로 PixiJS/DOM을 import 하지 않는다.

/** 세이브 포맷 버전. RunState 모양이 바뀌면 올린다 */
export const SAVE_VERSION = 1;
export const SAVE_KEY = 'ballshooter.run';
export const SETTINGS_KEY = 'ballshooter.settings';

// ── 화면 (논리 좌표) ──────────────────────────────────────────
export const DESIGN_W = 720;
export const DESIGN_MIN_H = 1280;
/** 9:19.5 */
export const DESIGN_MAX_H = 1560;

// ── 전투 필드 (시뮬레이션 좌표, 화면 크기와 무관) ─────────────
export const FIELD_COLS = 8;
export const CELL = 84;
export const FIELD_W = FIELD_COLS * CELL; // 672
export const FIELD_H = 960;
/** 적 충돌 박스는 칸보다 이만큼 안쪽 (사방) */
export const ENEMY_INSET = 4;

export const PLAYER_HIT_RADIUS = 20;
/** 보이는 크기 반경 (렌더/이동 clamp용) */
export const PLAYER_VISUAL_RADIUS = 34;
/**
 * 플레이어 이동 범위 (필드 좌표): 필드 벽 안 어디든 — 보이는 크기 반경만큼 안쪽. 위로 올라가 적 사이로 들어가도 되지만
 * 적 몸에 닿으면 즉시 패배(sim의 접촉 판정)다.
 */
export const PLAYER_MIN_X = PLAYER_VISUAL_RADIUS;
export const PLAYER_MAX_X = FIELD_W - PLAYER_VISUAL_RADIUS;
export const PLAYER_MIN_Y = PLAYER_VISUAL_RADIUS;
export const PLAYER_MAX_Y = FIELD_H - PLAYER_VISUAL_RADIUS;
/** 시작 위치 y (x는 가운데) */
export const PLAYER_START_Y = FIELD_H - 96;
/**
 * 이동 가속: 정지 → 최고 속도(moveSpeed)까지 이 시간(초). 가속도 = moveSpeed / PLAYER_ACCEL_TIME (방향을 바꾸거나 멈출 때도 같은 가속도).
 * 목표 위치로는 '걸어간다' — 최고 속도로 가다가 목표 앞에서 감속해 지나치지 않고 멈춘다 (logic/combat/movement.ts).
 */
export const PLAYER_ACCEL_TIME = 0.1;
/**
 * 도착 감속의 세기(가속도 대비). 목표까지 거리 d에서 낼 수 있는 속도 = √(2 × 가속도 × 이 값 × d) — 1보다 작게 두어
 * 브레이크에 여유를 남긴다(목표를 지나치거나 떨지 않게). 0.8이면 최고 속도에서 약 26 px 앞부터 감속한다.
 */
export const PLAYER_ARRIVE_BRAKE = 0.8;
export const PLAYER_INVULN_TIME = 1.0;

/** 고정 시뮬레이션 스텝 */
export const SIM_DT = 1 / 60;
/** 한 스텝 내 투사체 서브스텝 상한 (터널링 방지: 이동거리 / (반경) 기준으로 계산) */
export const MAX_SUBSTEPS = 6;
/**
 * 투사체 수명 상한(초). 필드가 투사체로 뒤덮이지 않게 하는 주 장치 — 틈으로 들어가 대형 뒤에서 덜그럭거리는 공은
 * 보통 이 안에 다 때리고 나온다 (밸런스 프로브의 rattle·age-expired 열로 확인).
 */
export const PROJECTILE_MAX_AGE = 6;
/** 분열 자식(새끼오리 등)의 수명 상한(초). 부모보다 짧게 — 한 발이 여러 개로 늘어나는 만큼 빨리 사라진다 */
export const SPLIT_CHILD_MAX_AGE = 2.5;
/** 반사 후 |vy| >= speed × 이 값 보장 */
export const MIN_VERTICAL_RATIO = 0.22;
/** 같은 적을 관통 투사체가 다시 때리기까지 최소 간격(초) */
export const PIERCE_REHIT_TIME = 0.25;
/** 보이는 적이 없을 때 하강 빨리감기 배수 */
export const DESCENT_FAST_FORWARD = 6;
/** 대형 첫 줄이 화면 상단에서 시작하는 높이 오프셋 (rows[0]의 top = -CELL - SPAWN_GAP) */
export const SPAWN_GAP = 0;

// ── 조준 / 입력 ──────────────────────────────────────────────
/** 수동 조준의 수평 여유(도): 조준각은 [-(180° - 이 값), -이 값] (위쪽 반원, 완전 수평 금지) */
export const AIM_MIN_DEG = 8;
/** 포인터가 이만큼(화면 논리 px) 움직이기 전에 떼면 탭(조준), 넘으면 드래그(이동). 390폭 폰에서 ≈ 10 CSS px */
export const TAP_SLOP = 18;
/** 키보드 조준 회전 속도(도/초) — Q/E, ,/. */
export const AIM_KEY_RATE_DEG = 120;

// ── 상태이상 ─────────────────────────────────────────────────
export const BURN_DURATION = 3;
export const BURN_RATIO = 0.25;
export const CHILL_DURATION = 2.5;
export const CHILL_DAMAGE_TAKEN_MUL = 1.25;
/**
 * 냉기 중 공격 타이머가 흐르는 속도(1 = 평소). 냉기는 공격을 멈추지 않고 늦춘다 — 예전처럼 완전히 멈추면
 * 얼음을 여러 무기에 붙인 빌드가 적(특히 보스)을 계속 얼려 st5가 얼음 유무로 갈렸다(docs/DESIGN.md '난이도 목표').
 */
export const CHILL_ATTACK_RATE = 0.4;
/** 엘리트(보스가 아닌 2칸 이상 적 — 곰인형)·보스는 냉기에 강하다: 공격 타이머가 이 속도로 흐른다 */
export const CHILL_ATTACK_RATE_RESIST = 0.8;
/**
 * 보스 연타 감쇠: 같은 투사체가 보스를 이 시간(초) 안에 다시 때리면 그 직접 피해 × BOSS_REHIT_DAMAGE_MUL.
 * 보스 위(천장과 보스 윗면 사이)에 갇혀 덜그럭거리는 공 — 특히 보스를 뚫고 올라가는 양말 개틀링 — 이 보스 피해의
 * 대부분을 내서, 개틀링·거울을 쌓은 빌드가 보스를 순식간에 녹였다. 보스에만 적용(일반 적 대형 뒤 덜그럭거림은 그대로).
 */
export const BOSS_REHIT_WINDOW = 1.0;
export const BOSS_REHIT_DAMAGE_MUL = 0.3;
/**
 * 보스가 소환한 졸개가 입에서 자기 칸까지 날아가 내려앉는 시간(초). 이 동안은 칸에 몸(충돌 박스)이 있어 공은 맞지만
 * 플레이어 몸에 닿아도 즉사가 아니다 — 화면에서는 아직 입에서 날아오는 중이라, 보이지 않는 몸에 부딪혀 지는 일이 없게.
 * 내려앉는 순간 그 자리에 있으면 일반 규칙대로 접촉 패배. 렌더의 소환 튀어나오기(visual.ts SUMMON_HOP_TIME)와 같은 값.
 */
export const SUMMON_LAND_TIME = 0.32;
/**
 * 보스 통로 캠핑 대응 (docs/DESIGN.md '통로 캠핑 — 구슬 기둥'): 플레이어가 '캠핑 자리' — 양옆 통로(보스 왼끝·오른끝 바깥)의 보스 아래 끝 +
 * BOSS_CAMP_DEPTH보다 위, 또는 보스 위 틈 — 에 모두 BOSS_CAMP_TIME초 넘게 있으면 보스가 쉬는 중(idle — 행동 사이 쉬는 시간도 건너뜀)에 곧바로
 * '구슬 기둥'을 쓴다: 그 통로(보스 위 틈이면 플레이어 자리)를 천장부터 보스 아래 끝 + BOSS_CAMP_DEPTH(보스 위면 보스 위끝)까지 덮는 구슬 —
 * 구슬 비 행동(BossMarblesSpec)의 반경·발동·그림, 피해 × BOSS_CAMP_DAMAGE_MUL. 통로를 따라 보스 바로 아래로만 비켜 계속 쏘지 못하게 깊이를 둔다.
 * 예고 = max(구슬 예고, BOSS_CAMP_REACT + 기둥 밖까지 걸어갈 거리 / 이동 속도 + PLAYER_ACCEL_TIME) — 통로 어디에 서 있든 보고 걸어서 빠져나갈 수 있다.
 * 다음 기둥까지 BOSS_CAMP_COOLDOWN초(쓰는 순간부터). 보스 아래 끝보다 아래에 있으면 쌓인 시간이 BOSS_CAMP_DECAY배 속도로 줄어든다.
 * RNG를 쓰지 않는다 — 통로에 들어가지 않는 판(프로브 회피 AI·이상적인 회피)은 예전과 비트 단위로 같다.
 */
export const BOSS_CAMP_TIME = 0.8;
export const BOSS_CAMP_DEPTH = 168;
export const BOSS_CAMP_COOLDOWN = 2.5;
export const BOSS_CAMP_DECAY = 2;
export const BOSS_CAMP_REACT = 0.45;
export const BOSS_CAMP_DAMAGE_MUL = 2;
/** 구슬 기둥의 구슬은 떨어진 뒤 이 시간(초) 동안 그 자리에 남아 닿으면 아프다(구슬마다 한 번) — 통로를 그동안 막는다 */
export const BOSS_CAMP_ACTIVE = 2;
/**
 * 백어택: 투사체 직접 적중이 적의 윗면(공이 적보다 위 — 접촉 법선이 위로 45° 안)에 맞으면 피해 × 이 값.
 * 틈으로 들어가 대형 뒤·위에서 덜그럭거리는 공, 보스 옆 통로로 넘어가 보스 윗면을 치는 공의 보상 (docs/DESIGN.md '백어택')
 */
export const BACK_ATTACK_MUL = 1.5;
/**
 * 죽은 젤리에서 나온 꼬마 젤리 칸은 플레이어 피격 원에서 이만큼(px) 넘게 떨어진 칸만 — 플레이어 몸 위에 생겨 즉사하지 않게.
 * 젤리 바로 옆 칸에 서 있어도 젤리 자기 칸(42 + 4 - 20 = 26 px 떨어짐)에는 생길 수 있다
 */
export const SPLIT_PLAYER_MARGIN = 24;
/**
 * RC카(옆으로 미끄러지는 적)는 플레이어 피격 원 + 이만큼(px) 안으로는 움직이지 않는다: 그 안이 걸리면 출발하지 않고,
 * 미끄러지는 도중이면 플레이어가 비킬 때까지 그 자리에 멈춰 기다린다 (몸에 닿는 즉사를 적이 만들지 않게)
 */
export const SHIFT_PLAYER_MARGIN = 24;
export const CHAIN_RANGE = 160;
export const CHAIN_TARGETS = 2;
export const CHAIN_DAMAGE_MUL = 0.5;
export const EXPLODE_DAMAGE_MUL = 0.5;

// ── 시너지 아이템 (docs/DESIGN.md '시너지 아이템') — 아이템 수치는 data/items.ts, 여기는 규칙의 상한·고정값 ──
/** 탄성 고무: 반사마다 쌓이는 데미지 보너스 합의 상한 (+100%) */
export const RUBBER_BONUS_CAP = 1;
/** 분열 씨앗: 자식 수 (★와 무관), 자식 1개 데미지 배수 합의 상한, 자식 반경 = 부모 반경 × 이 값 (최소 SEED_CHILD_MIN_RADIUS) */
export const SEED_SPLIT_COUNT = 2;
export const SEED_SPLIT_DAMAGE_MAX = 1;
export const SEED_CHILD_RADIUS_MUL = 0.6;
export const SEED_CHILD_MIN_RADIUS = 8;
/** 분열 씨앗 자식의 수명(초) — 무기 분열 자식(SPLIT_CHILD_MAX_AGE)보다 짧게: 작은 공이 금방 사그라든다 */
export const SEED_CHILD_MAX_AGE = 1.5;
/**
 * 시너지 밀도 상한: 살아있는(그 스텝 기준) 플레이어 투사체가 이 수 이상이면 분열 씨앗의 분열·트램펄린의 바닥 튕김이 쉰다
 * (공은 평소처럼 — 씨앗 공은 그냥 반사, 바닥에 닿은 공은 빠진다). 무기 자체의 발사·분열은 막지 않는다.
 * 빌드를 아무리 쌓아도 시너지가 늘리는 공은 여기까지 — 밀도 목표(스트레스 최대 60, tests/density.test.ts '시너지').
 * 측정(스트레스 빌드 + 씨앗 4 + 트램펄린, 같은 조준): 상한 없이 최대 99, 45 → 64, 40 → 61, 36 → 58(스트레스 빌드만 57).
 * 보통 빌드(st5 평균 12~20개)는 거의 닿지 않는다. 36 → 32 (네 번째 조정): 적 체력이 늘어 전투가 길어지자 프로브 빌드 + 트램펄린·씨앗·거울 조합의
 * st5 평균이 30개 안팎까지 올라 — 조합이 늘리는 공을 조금 더 일찍 쉬게 한다
 */
export const SYNERGY_PROJECTILE_CAP = 32;
/** 번개 코일: 연쇄 대상 수(기본 CHAIN_TARGETS + 코일) 상한 */
export const CHAIN_TARGETS_MAX = 8;
/**
 * 거대화 버섯·가속 바퀴: 공 반경 배수 합의 상한(+100%), 속도 배수 합의 범위(-50% ~ +100%).
 * 속도 상한은 서브스텝 안전 범위(틈새로 새지 않음 — tests/audit-combat '서브스텝')를 지킨다
 */
export const PROJ_RADIUS_BONUS_MAX = 1;
export const PROJ_SPEED_BONUS_MIN = -0.5;
export const PROJ_SPEED_BONUS_MAX = 1;
/** 유도 리본: 회전 속도 합의 상한(도/초) */
export const HOMING_MAX_DEG = 270;
/** 증기 주전자: 증기 폭발 반경(px, 적중점 ↔ 충돌 박스), 같은 적에게 다시 터지기까지(초) */
export const STEAM_RADIUS = 90;
export const STEAM_ENEMY_COOLDOWN = 1;
/**
 * 트램펄린: 바닥에서 튕긴 공은 그 순간부터 이 시간(초)까지만 더 산다(원래 수명이 더 짧으면 그대로) — 두 번째 기회이지 두 번째 수명이 아니다.
 * 이게 없으면 모든 공이 필드를 두 번 지나 살아있는 투사체가 거의 두 배가 됐다(스트레스 빌드 + 트램펄린 평균 44 → 74, 최대 57 → 99).
 * 1.5초 → 평균 63, 1초 + SYNERGY_PROJECTILE_CAP → 44 (스트레스 빌드만 44)
 */
export const TRAMPOLINE_AFTER_LIFE = 1;
/** 폭죽 심지: 처치한 적 중심 ↔ 충돌 박스 반경(px — 맞닿은 8칸), 최대 HP 비율 합의 상한 */
export const KILL_BURST_RADIUS = 96;
export const KILL_BURST_MAX = 0.7;

// ── 레벨업 (docs/DESIGN.md '레벨업') — 적 경험치는 data/enemies.ts(EnemyDef.xp), 런 보너스 수치는 data/boons.ts ──
/**
 * 레벨 L → L+1에 필요한 경험치 = LEVEL_XP_BASE + LEVEL_XP_STEP × (L - 1) — 24, 26, 28, 30 …
 * 1칸 적 = 1 경험치로 st1(60마리) 끝 레벨 3, st2 끝 6, st3 끝 8, st4 끝 11, st5 끝 13쯤 (모두 잡으면) — 판마다 2 · 3 · 2 · 3 · 2번.
 * 첫 값 12 + 4는 3 · 3 · 2 · 3 · 1번이었는데 첫 레벨업이 처치 12번에 와서 st1부터 시작 무기가 ★3·무기 하나 더가 되어 눈덩이처럼 커졌다
 * (프로브 빌드 초당 피해 st2 2배·st3 2.7배) — 처음을 무겁게(24), 뒤를 완만하게(+2)
 */
export const LEVEL_XP_BASE = 24;
export const LEVEL_XP_STEP = 2;
/** 레벨업 한 번의 선택지 수 */
export const LEVEL_UP_CHOICES = 3;
/**
 * 선택지 종류 뽑기 가중치 [새 아이템, ★ + 1, 런 보너스] — 후보가 없는 종류는 빠진다.
 * [4, 3, 3] → [4, 2, 4]: ★ + 1(공짜 ★합성 — 주 무기 ★3이면 초당 피해 3.1배)이 나오면 거의 늘 골라 레벨업이 '주 무기 ★ 올리기'로 굳었다.
 * 그리디 평가(tests/balance.probe.test.ts PROBE_GREEDY)로 고른 비율: 새 아이템 ~40% · ★ + 1 ~28% · 런 보너스 ~33%
 */
export const LEVEL_UP_KIND_WEIGHTS: readonly [number, number, number] = [4, 2, 4];
/** 한 번의 선택지에서 같은 종류는 이 수까지 */
export const LEVEL_UP_KIND_MAX = 2;
/** ★ + 1 후보 가중치: 무기 / 그 밖(돌·장비) */
export const LEVEL_UP_UPGRADE_WEAPON_WEIGHT = 2;
export const LEVEL_UP_UPGRADE_OTHER_WEIGHT = 1;

// ── 액티브 스킬 (docs/DESIGN.md '액티브 스킬') — 스킬 수치는 data/skills.ts ──
/** 백어택 직접 적중이 게이지를 채우는 배수 (그 밖의 피해는 1) */
export const SKILL_BACK_CHARGE_MUL = 2;
/** 털뭉치 폭풍이 쏜 공의 weaponUid ('fire' 이벤트·ProjectileEntity) — 가방 무기 uid는 1부터라 겹치지 않는다 */
export const SKILL_WEAPON_UID = -1;

// ── 가방 / 등급 ──────────────────────────────────────────────
export const BAG_START_COLS = 5;
export const BAG_START_ROWS = 4;
export const BAG_MAX_COLS = 7;
export const BAG_MAX_ROWS = 6;
export const STASH_CAPACITY = 8;
export const MAX_TIER = 3;
/** index = tier */
export const TIER_DAMAGE_MUL = [0, 1, 1.6, 2.5] as const;
export const TIER_COOLDOWN_MUL = [0, 1, 0.9, 0.8] as const;
export const TIER_EFFECT_MUL = [0, 1, 1.6, 2.2] as const;
/** 가격(구매/판매) ★ 배수: ★n 아이템 = ★1 두 개 합성의 누적 */
export const TIER_PRICE_MUL = [0, 1, 2, 4] as const;
/** 쿨타임 감소 합산 하한 (기본 쿨의 35%까지만) */
export const COOLDOWN_FLOOR_MUL = 0.35;

// ── 상점 / 경제 ──────────────────────────────────────────────
export const SHOP_SLOTS = 4;
export const SHOP_REROLL_BASE = 2;
export const SELL_RATIO = 0.5;
export const BAG_EXPAND_COSTS = [15, 25, 35, 45] as const;
export const HEAL_COST = 10;
export const HEAL_RATIO = 0.5;
export const STAGE_CLEAR_HEAL_RATIO = 0.3;
/** 스테이지 인덱스별 상점 희귀도 가중치 [common, rare, epic, legendary] */
export const SHOP_RARITY_WEIGHTS: readonly (readonly [number, number, number, number])[] = [
  [80, 20, 0, 0],
  [65, 30, 5, 0],
  [50, 35, 14, 1],
  [40, 38, 19, 3],
  [30, 40, 25, 5],
];

// ── 레이아웃 (화면 논리 좌표) ─────────────────────────────────
export const HUD_H = 100;
export const BOTTOM_BAR_MIN_H = 220;
export const FIELD_X = (DESIGN_W - FIELD_W) / 2; // 24

// ── 색 ───────────────────────────────────────────────────────
export const RARITY_COLORS: Record<'common' | 'rare' | 'epic' | 'legendary', number> = {
  common: 0x9aa4b1,
  rare: 0x3fa3ff,
  epic: 0xb46cff,
  legendary: 0xffb02e,
};
export const ELEMENT_COLORS: Record<'fire' | 'ice' | 'lightning', number> = {
  fire: 0xff6a2b,
  ice: 0x6fd8ff,
  lightning: 0xffe14a,
};
export const UI_COLORS = {
  bg: 0x1a1226,
  panel: 0x2b1d3a,
  panelLight: 0x3d2a52,
  panelBorder: 0x6b4f8f,
  text: 0xffffff,
  textDim: 0xb9a9cf,
  gold: 0xffc93c,
  hp: 0xff4d6d,
  good: 0x5ee07a,
  bad: 0xff5a5a,
  accent: 0x7c5cff,
} as const;
