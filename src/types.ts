// 모듈 간 데이터 계약. 여기 있는 모양을 바꾸면 사용하는 모든 모듈을 함께 고친다.
// 이 파일은 PixiJS/DOM을 import 하지 않는다.

// ─────────────────────────────────────────────────────────────
// 공통
// ─────────────────────────────────────────────────────────────

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type Element = 'fire' | 'ice' | 'lightning';
export type ItemKind = 'weapon' | 'stone' | 'gear';
export type Tier = 1 | 2 | 3;
/** 시계 방향 90° 회전 횟수 */
export type Rot = 0 | 1 | 2 | 3;

export interface Cell {
  x: number;
  y: number;
}

// ─────────────────────────────────────────────────────────────
// 아이템 데이터 (src/data/items.ts)
// ─────────────────────────────────────────────────────────────

export interface SplitSpec {
  /** 첫 적중 시 생성되는 자식 투사체 수 (부채꼴로 퍼짐) */
  count: number;
  /** 자식 1개당 데미지 = 부모 유효 데미지 × damageMul */
  damageMul: number;
  /** 자식 투사체 스프라이트 에셋 키 */
  sprite: string;
  radius: number;
}

export interface ProjectileSpec {
  /** 에셋 키 (무기라면 보통 아이템 아이콘과 같은 키) */
  sprite: string;
  /** 충돌 반경 (논리 px) */
  radius: number;
  /** px/s */
  speed: number;
  /** ★1 기준 1발 데미지 */
  damage: number;
  /** 한 번 발사할 때 나가는 개수 */
  count: number;
  /** count > 1일 때 전체 부채꼴 각도(도) */
  spreadDeg: number;
  /** 관통 가능한 적 수. 0 = 관통 없음(바로 반사). 999 = 사실상 무한 */
  pierce: number;
  /** 벽+적 반사 허용 횟수. 0 = 무제한(바닥으로 빠지거나 수명 종료까지) */
  maxBounces: number;
  /** >0이면 적중 시 반경 내 다른 적에게 50% 피해 */
  explodeRadius?: number;
  split?: SplitSpec;
  /** 비행 중 스프라이트 회전 여부 (렌더 전용) */
  spin?: boolean;
}

export interface WeaponDef {
  /** ★1 기준 쿨타임(초) */
  cooldown: number;
  projectile: ProjectileSpec;
  /** 무기 고유 속성 */
  element?: Element;
}

/** 강화석/속성석: 변으로 맞닿은 무기에 적용되는 버프 (★1 기준, ★에 따라 TIER_EFFECT_MUL 배) */
export interface StoneEffect {
  /** 0.25 → 데미지 +25% */
  damageMul?: number;
  /** -0.15 → 쿨타임 -15% (합산 후 하한 COOLDOWN_FLOOR_MUL) */
  cooldownMul?: number;
  /** 속성 부여 (★와 무관) */
  element?: Element;
  /** 발사 개수 + (★배수 적용 후 내림) */
  projectileCountAdd?: number;
  /** 관통 + (★배수 적용 후 내림) */
  pierceAdd?: number;
}

/** 장비: 가방 안에 있으면 전역 패시브 (★1 기준, ★에 따라 TIER_EFFECT_MUL 배) */
export interface GearEffect {
  maxHpAdd?: number;
  /** 0.2 → 이동속도 +20% */
  moveSpeedMul?: number;
  regenPerSec?: number;
  /** 0.25 → 골드 +25% */
  goldMul?: number;
  /** 0.1 → 모든 무기 데미지 +10% */
  damageMul?: number;
}

export interface ItemDef {
  id: string;
  kind: ItemKind;
  /** 한국어 표시 이름 */
  name: string;
  /** 한국어 한두 줄 설명(재미 + 효과) */
  desc: string;
  rarity: Rarity;
  /** 회전 전 크기(칸) */
  w: number;
  h: number;
  /** 아이콘 에셋 키 (assets.json에 등록) */
  icon: string;
  /** ★1 상점 기본 가격 */
  price: number;
  weapon?: WeaponDef;
  stone?: StoneEffect;
  gear?: GearEffect;
  /**
   * 레시피 소켓(◇): 회전 전 기준 좌상단(0,0) 로컬 좌표. 반드시 아이템 **바깥**이면서 변으로 인접한 칸.
   * 예) 2×1 무기의 오른쪽 끝 옆 = {x:2,y:0}, 아래 = {x:0,y:1}
   */
  sockets?: Cell[];
  /** 상점/드롭 가중치. 0이면 상점·드롭에 안 나옴(진화 무기 등) */
  shopWeight: number;
  /** 이 스테이지 인덱스(0부터)부터 상점·드롭에 등장 */
  minStage: number;
}

/** 레시피 합성: base 무기의 소켓 칸을 ingredient가 차지하면 result로 진화 */
export interface RecipeDef {
  id: string;
  base: string;
  ingredient: string;
  /** base와 같은 w,h 여야 함 (데이터 검증 테스트가 확인) */
  result: string;
}

// ─────────────────────────────────────────────────────────────
// 적 / 스테이지 / 캐릭터 데이터
// ─────────────────────────────────────────────────────────────

export interface EnemyAttack {
  /** aimed: 플레이어 조준 / straight: 정면 아래 / spread: 플레이어 방향 부채꼴 */
  kind: 'aimed' | 'straight' | 'spread';
  /** 발사 간격(초) */
  interval: number;
  /** 첫 발사까지 추가 지연 랜덤 범위(초), 동시 발사 방지 */
  jitter: number;
  projSpeed: number;
  damage: number;
  count: number;
  spreadDeg: number;
  sprite: string;
  radius: number;
}

export interface EnemyDef {
  id: string;
  name: string;
  sprite: string;
  /** 칸 단위 크기 */
  w: number;
  h: number;
  /** 스테이지 0 기준 HP (스테이지 hpMul 곱해짐) */
  hp: number;
  /** 처치 골드 */
  gold: number;
  /** 아이템 드롭 확률 0..1 */
  dropChance: number;
  // 몸에 닿으면 피해가 아니라 즉시 패배(CombatSim lostReason 'contact') — 적마다 정하는 접촉 피해 수치는 없다
  attack?: EnemyAttack;
  boss?: boolean;
}

export interface StageDef {
  id: string;
  name: string;
  /** 대형 하강 속도 px/s */
  descentSpeed: number;
  /** 적 HP 배수 */
  hpMul: number;
  /** 적 공격 데미지 배수 */
  dmgMul: number;
  /** 클리어 보너스 골드 */
  clearGold: number;
  /**
   * 적 배치. rows[0]이 가장 먼저(가장 아래에서) 등장하는 줄, 그 위로 rows[1]...
   * 각 문자열은 정확히 FIELD_COLS(8)글자. '.' = 빈칸, 그 외 문자는 legend로 적 id 매핑.
   * rows[i+1]은 화면상 rows[i]의 바로 **위** 줄이다.
   * w/h > 1인 적은 **좌하단** 칸(rows[i], 열 c)에만 문자를 쓴다. 적은 오른쪽으로 w열(c..c+w-1),
   * 위쪽으로 h줄(rows[i..i+h-1])을 차지하며, 덮이는 나머지 칸은 반드시 '.'이어야 한다.
   */
  rows: string[];
  legend: Record<string, string>;
  /** 배경 에셋 키 */
  background: string;
  /**
   * 보스전 스테이지(보스 테스트): BossDef id (src/data/bosses.ts). 있으면 sim이 그 보스를 고정 위치에 세우고
   * (대형 하강을 따르지 않는다 — 마지막 페이즈에서만 천천히 기어 내려옴), 행동 스케줄러·졸개 소환·위험 지역을 돌린다.
   * rows는 비워 둔다(위에서 내려오는 대형은 보스와 겹친다). 승리 = 보스 처치(남은 졸개는 함께 터짐).
   * 없으면 일반 스테이지 — 동작이 예전과 비트 단위로 같다.
   */
  boss?: string;
}

// ─────────────────────────────────────────────────────────────
// 보스 (src/data/bosses.ts) — 보스 행동은 데이터로 정하고 sim의 스케줄러가 시드 RNG로 고른다
// ─────────────────────────────────────────────────────────────

export type BossActionKind = 'volley' | 'ring' | 'slam' | 'marbles' | 'summon';

/** 보스 탄 1발 (피해는 stage.dmgMul이 곱해진다 — EnemyAttack과 같은 규칙) */
export interface BossShotSpec {
  /** 적 탄 그림 키 (assets.json enemyShot) */
  sprite: string;
  radius: number;
  /** px/s */
  speed: number;
  damage: number;
}

/**
 * 블록 일제 사격: 입(보스 아래 가운데)에서 발사 순간의 플레이어를 노린 부채꼴.
 * bursts번 burstInterval 간격으로. 두 번째부터는 reaim이면 다시 노리고, 아니면 첫 발의 방향 + k × burstShiftDeg
 * (발 사이의 절반이면 앞 부채꼴의 틈을 메운다 — 부채꼴 밖으로 나가야 피한다. 따라오지 않아 구석에 몰리지 않는다)
 */
export interface BossVolleySpec extends BossShotSpec {
  count: number;
  spreadDeg: number;
  bursts: number;
  burstInterval: number;
  reaim: boolean;
  burstShiftDeg: number;
}

/**
 * 팽이 고리: 입에서 아래쪽 arcDeg 부채꼴로 count발을 고르게 뿌리되, 이어진 gap발을 비워 '빈틈'을 만든다.
 * 빈틈은 플레이어 쪽(발사 순간 플레이어 방향에서 gapShiftPx 안으로 어긋남)에 생긴다 — 늘 걸어서 닿을 수 있다.
 * waves번 waveInterval 간격으로, 웨이브마다 rotateDeg씩 같은 방향으로 돌아간다(나선). 빈틈도 같이 돈다.
 */
export interface BossRingSpec extends BossShotSpec {
  count: number;
  arcDeg: number;
  gap: number;
  /** 빈틈 가운데가 플레이어 방향에서 어긋날 수 있는 최대 거리(플레이어 높이에서 px) */
  gapShiftPx: number;
  waves: number;
  waveInterval: number;
  rotateDeg: number;
}

/**
 * 깜짝 상자 내려찍기: 플레이어가 있는 열(cols칸 폭)에 보스 아래 끝부터 바닥까지 위험 지역.
 * 예고(warn초) → 발동(active초, 이때만 피해) → 끝. repeats번(매번 그때의 플레이어 열), 사이 repeatInterval초.
 */
export interface BossSlamSpec {
  cols: 1 | 2;
  warn: number;
  active: number;
  damage: number;
  repeats: number;
  repeatInterval: number;
  /** 렌더용 그림 키 (내려찍는 깜짝 상자) */
  sprite: string;
}

/**
 * 구슬 비: 필드 아래쪽에 떨어질 자리(그림자, 반경 radius)를 예고(warn초) → 떨어지는 순간(active초)만 피해.
 * count개를 stagger초 간격으로, 처음 aimed개는 그 순간 플레이어 자리, 나머지는 아래쪽(yMinFrac × FIELD_H 아래) 무작위 —
 * 다른 구슬과 중심 사이 spacing px 이상(빠져나갈 틈 보장).
 */
export interface BossMarblesSpec {
  count: number;
  aimed: number;
  radius: number;
  warn: number;
  active: number;
  damage: number;
  stagger: number;
  spacing: number;
  yMinFrac: number;
  /** 렌더용 그림 키 (떨어지는 구슬) */
  sprite: string;
}

/** 졸개 소환: 입을 벌려 지금 페이즈의 졸개 풀에서 count마리를 보스 바로 아래 칸에 뱉는다 (살아있는 졸개 상한 안에서) */
export interface BossSummonSpec {
  count: number;
}

interface BossActionBase {
  /** 행동 id (데이터 안에서 고유 — 이벤트·연출용) */
  id: string;
  /** 예비 동작(초): 'bossAction' 이벤트 후 이만큼 뒤에 실행 — 화면이 미리 보여 줄 시간 */
  windup: number;
  /** 같은 행동을 다시 고를 수 있기까지(초, 행동 시작 기준). 페이즈 cooldownMul이 곱해진다 */
  cooldown: number;
  /** 마지막 발사·위험 지역이 끝난 뒤 다음 행동까지 더 쉬는 시간(초, 페이즈 gap에 더해짐). 없으면 0 */
  recover?: number;
  /** 페이즈별 고를 가중치 (길이 = 페이즈 수, 0 = 그 페이즈에서 안 씀) */
  weights: number[];
}

export type BossActionDef = BossActionBase &
  (
    | { kind: 'volley'; volley: BossVolleySpec }
    | { kind: 'ring'; ring: BossRingSpec }
    | { kind: 'slam'; slam: BossSlamSpec }
    | { kind: 'marbles'; marbles: BossMarblesSpec }
    | { kind: 'summon'; summon: BossSummonSpec }
  );

export interface BossMinionWeight {
  /** EnemyDef id (1×1, 보스 아님) */
  enemy: string;
  weight: number;
}

export interface BossPhaseDef {
  /** 이 페이즈가 시작되는 보스 HP 비율 (첫 페이즈 1, 내림차순). 넘는 피해는 문턱에서 멈춘다 — 페이즈를 건너뛰지 않음 */
  hpFrac: number;
  /** 페이즈 시작 포효(초): 무적 + 행동 정지 (첫 페이즈는 등장 포효) */
  roar: number;
  /** 행동 사이 쉬는 시간(초) */
  gap: number;
  /** 행동 쿨타임 배수 */
  cooldownMul: number;
  /** 페이즈 시작(포효) 때 바로 소환하는 졸개 수 (상한 안에서) */
  enterSummon: number;
  /** 소환 졸개 풀 (가중치) */
  minions: BossMinionWeight[];
  /** 살아있는 졸개 상한 */
  minionCap: number;
  /** 보스가 아래로 기어 내려오는 속도 px/s (0 = 제자리). 스테이지 하강 속도보다 느려야 한다(졸개와 겹치지 않게) */
  creep: number;
}

export interface BossDef {
  id: string;
  /** EnemyDef id (boss: true) — 크기·체력·그림 */
  enemy: string;
  /** 고정 위치: 보스 왼쪽 열 / 칸 위끝 y(px). 충돌 박스는 칸에서 ENEMY_INSET 안쪽 — 위끝과 천장 사이 틈으로 공이 넘어가 윗면을 친다 */
  anchorCol: number;
  anchorY: number;
  /** 등장: 화면 위에서 고정 위치까지 내려오는 속도 px/s */
  enterSpeed: number;
  phases: BossPhaseDef[];
  actions: BossActionDef[];
}

/** 보스 테스트 캐릭터별 시작 가방 (이미 어느 정도 키운 빌드) */
export interface BossTestPreset {
  cols: number;
  rows: number;
  /** 가방 좌표 (회전 적용 후 좌상단) */
  items: StartItem[];
}

export interface BossTestDef {
  /** 보스 테스트 스테이지 (StageDef.boss가 있는 보스전) — data.stages에는 없다 */
  stage: StageDef;
  /** 캐릭터 id → 프리셋 */
  presets: Record<string, BossTestPreset>;
}

export interface StartItem {
  defId: string;
  x: number;
  y: number;
  rot: Rot;
  tier?: Tier;
}

export interface CharacterDef {
  id: string;
  name: string;
  /** 한 줄 소개 */
  desc: string;
  sprite: string;
  /** 정면 초상화 (캐릭터 선택·결과 화면) */
  portrait: string;
  baseMaxHp: number;
  /** 최대 이동 속도 px/s */
  baseMoveSpeed: number;
  startItems: StartItem[];
  passive: {
    cooldownMul?: number;
    maxHpMul?: number;
    moveSpeedMul?: number;
    damageMul?: number;
    goldMul?: number;
  };
  passiveDesc: string;
}

export interface AssetDef {
  key: string;
  category: 'character' | 'enemy' | 'projectile' | 'item' | 'enemyShot' | 'background' | 'ui' | 'fx';
  /** Codex 이미지 생성용 영어 프롬프트(대상 묘사만. 공통 스타일은 gen-assets.mjs가 붙임) */
  prompt: string;
  /** 최종 PNG 최대 변 길이(px) — 투명 여백 트림 후 이 크기에 맞춰 축소. opaque면 무시 */
  size: number;
  /** opaque 에셋의 최종 크기 (cover 방식으로 잘라 맞춤) */
  w?: number;
  h?: number;
  /** 아트가 없을 때 쓰는 플레이스홀더 */
  placeholder: {
    emoji: string;
    /** 0xRRGGBB 를 문자열 '#RRGGBB'로 */
    color: string;
    shape: 'circle' | 'roundrect';
  };
  /** 배경처럼 불투명 이미지 */
  opaque?: boolean;
  /**
   * 프레임 애니메이션이 붙을 수 있는 상태들 (캐릭터/적). 실제 프레임은 나중에
   * (Seedance 영상 → 프레임 분리 → 스프라이트시트) 파이프라인으로 만들어 manifest.json의 anims에 등록된다.
   * 프레임이 없으면 정적 스프라이트 + 코드 애니메이션(출렁임/스쿼시/플래시)으로 대체.
   */
  anims?: AnimState[];
}

export type AnimState = 'idle' | 'move' | 'attack' | 'hit' | 'die';

/**
 * public/assets/manifest.json 형식. gen-assets(정적 PNG)와 이후 애니메이션 파이프라인이 함께 갱신한다.
 * - images: 에셋 키 → assets/ 기준 상대 경로 (PNG)
 * - anims:  에셋 키 → 상태 → 스프라이트시트(PixiJS spritesheet JSON, assets/ 기준 상대 경로)
 */
export interface AssetManifest {
  images: Record<string, string>;
  anims: Record<string, Partial<Record<AnimState, { sheet: string; fps: number; loop: boolean }>>>;
}

export interface GameData {
  items: Record<string, ItemDef>;
  recipes: RecipeDef[];
  enemies: Record<string, EnemyDef>;
  stages: StageDef[];
  characters: Record<string, CharacterDef>;
  /** 보스 행동 데이터 (StageDef.boss가 가리킨다) */
  bosses: Record<string, BossDef>;
  /** 보스 테스트 모드: 스테이지 + 캐릭터별 프리셋 가방 */
  bossTest: BossTestDef;
}

// ─────────────────────────────────────────────────────────────
// 가방 상태 (src/logic/bag.ts)
// ─────────────────────────────────────────────────────────────

export interface BagItem {
  uid: number;
  defId: string;
  tier: Tier;
  /** 회전 적용 후 footprint의 좌상단 칸 */
  x: number;
  y: number;
  rot: Rot;
}

export interface StashItem {
  uid: number;
  defId: string;
  tier: Tier;
}

export interface BagState {
  cols: number;
  rows: number;
  items: BagItem[];
  stash: StashItem[];
  stashCapacity: number;
  /** 다음 uid (단조 증가) */
  nextUid: number;
}

export interface MergeOption {
  kind: 'tier' | 'recipe';
  /** 결과가 남는 쪽(★합성: 기준 아이템 / 레시피: base 무기)의 uid */
  anchorUid: number;
  /** 소모되는 쪽의 uid */
  consumedUid: number;
  resultDefId: string;
  resultTier: Tier;
  recipeId?: string;
}

// ─────────────────────────────────────────────────────────────
// 유효 스탯 (src/logic/stats.ts)
// ─────────────────────────────────────────────────────────────

export interface PlayerStats {
  maxHp: number;
  /** px/s */
  moveSpeed: number;
  regenPerSec: number;
  /** 1.0 = 기본 */
  goldMul: number;
  /** 모든 무기에 곱해지는 전역 데미지 배수 (1.0 = 기본) */
  damageMul: number;
  /** 모든 무기에 곱해지는 전역 쿨타임 배수 (1.0 = 기본) */
  cooldownMul: number;
}

/** 전투가 쓰는 무기 1개의 최종 스탯 */
export interface WeaponLoadout {
  uid: number;
  defId: string;
  tier: Tier;
  cooldown: number;
  damage: number;
  count: number;
  spreadDeg: number;
  speed: number;
  radius: number;
  pierce: number;
  maxBounces: number;
  elements: Element[];
  explodeRadius: number;
  split: SplitSpec | null;
  sprite: string;
  spin: boolean;
}

// ─────────────────────────────────────────────────────────────
// 전투 (src/logic/combat/)
// ─────────────────────────────────────────────────────────────

export interface CombatInput {
  /**
   * 플레이어가 걸어갈 목표 위치(필드 좌표). sim이 이동 범위(PLAYER_MIN/MAX_X·Y — 필드 벽 안 어디든)로 clamp하고
   * 가속·최고 속도·도착 감속으로 움직인다(logic/combat/movement.ts). 둘 다 null이면 감속해서 선다.
   * 한 축만 주면 다른 축은 지금 위치를 목표로 본다.
   */
  targetX: number | null;
  targetY: number | null;
  /**
   * 수동 조준 각도(라디안, 필드 좌표 atan2: 0 = 오른쪽, -π/2 = 바로 위). 모든 무기가 이 방향으로 쏜다.
   * sim이 위쪽 반원 [-(π - AIM_MIN), -AIM_MIN]으로 clamp (아래를 가리키면 가까운 쪽 끝).
   * null/생략(또는 유한하지 않은 값)이면 자동조준.
   */
  aimAngle?: number | null;
}

export interface PlayerEntity {
  x: number;
  y: number;
  /** 속도(px/s) — 가속·감속이 있어 목표를 바로 따라가지 않는다 */
  vx: number;
  vy: number;
  /** 피격 판정 반경 (보이는 크기보다 작게) */
  hitRadius: number;
  hp: number;
  maxHp: number;
  /** 남은 무적 시간(초) */
  invuln: number;
}

export interface EnemyEntity {
  id: number;
  defId: string;
  /** 사각형 좌상단 (필드 좌표, 칸 여백 포함 안 한 실제 충돌 박스) */
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  boss: boolean;
  burnDps: number;
  burnTime: number;
  chillTime: number;
  /** 다음 공격까지 남은 시간 */
  attackTimer: number;
  /** 렌더용: 최근 피격 후 남은 플래시 시간 */
  flash: number;
}

export interface ProjectileEntity {
  id: number;
  /** 발사한 무기 uid (자식이면 부모의 무기 uid) */
  weaponUid: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  pierceLeft: number;
  /** Infinity = 무제한 */
  bouncesLeft: number;
  elements: Element[];
  explodeRadius: number;
  /** 아직 분열하지 않았으면 spec, 분열했거나 자식이면 null */
  split: SplitSpec | null;
  sprite: string;
  spin: boolean;
  age: number;
  alive: boolean;
}

export interface EnemyShotEntity {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  sprite: string;
  alive: boolean;
}

export interface WeaponRuntime {
  uid: number;
  /** 다음 발사까지 남은 시간(초). 0이면 준비됨(대상 없으면 0에서 대기) */
  timer: number;
  /** 현재 유효 쿨타임 (UI 게이지용) */
  cooldown: number;
}

export type CombatEvent =
  | { type: 'fire'; weaponUid: number; x: number; y: number; count: number }
  | { type: 'hit'; enemyId: number; x: number; y: number; damage: number; element: Element | null }
  | { type: 'kill'; enemyId: number; defId: string; x: number; y: number; boss: boolean }
  /** element = 폭발이 옮기는 상태이상 속성(불/얼음, 휘말린 적 hit의 element와 같음) 또는 null — 연출 전용 */
  | { type: 'explode'; x: number; y: number; radius: number; element: Element | null }
  | { type: 'chain'; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'split'; x: number; y: number; count: number }
  | { type: 'bounce'; x: number; y: number; wall: boolean }
  /** sprite = 보스 행동 탄의 그림 키 (보스는 EnemyDef.attack이 없다 — 효과음 고르기용). 일반 적 탄에는 없다 */
  | { type: 'enemyShoot'; enemyId: number; x: number; y: number; sprite?: string }
  /**
   * 적 탄('shot') 또는 보스 위험 지역('hazard' — 내려찍기·구슬)에 맞음.
   * (적 몸에 닿는 것은 피해가 아니라 즉시 패배 — 'lost' reason 'contact')
   */
  | { type: 'playerHit'; damage: number; x: number; y: number; source: 'shot' | 'hazard' }
  /**
   * 보스 페이즈 시작: phase 0 = 등장 끝(고정 위치 도착), 1.. = HP 문턱을 넘음. roar초 동안 무적·행동 정지(포효 — 화면 번쩍임),
   * 그 순간 졸개 소환('summon' 이벤트들이 바로 뒤따름).
   */
  | { type: 'bossPhase'; enemyId: number; phase: number; roar: number }
  /** 보스 행동 시작(예비 동작): windup초 뒤 실행. x, y = 입(보스 아래 가운데) */
  | { type: 'bossAction'; enemyId: number; action: BossActionKind; id: string; windup: number; x: number; y: number }
  /**
   * 졸개 소환: 입(fromX, fromY)에서 뱉어 칸(x, y = 새 적 충돌 박스 중심)에 내려앉는다. 새 적은 이미 sim.enemies에 있다(공은 맞는다).
   * 내려앉기까지(SUMMON_LAND_TIME) 플레이어 몸에 닿아도 접촉 패배가 아니다 — 렌더는 그동안 입에서 칸으로 날아가는 연출
   */
  | { type: 'summon'; enemyId: number; defId: string; fromX: number; fromY: number; x: number; y: number }
  /** 위험 지역 예고 시작 (sim.hazards에 새로 생김). x, y = 중심, warn = 발동까지(초) */
  | { type: 'hazardWarn'; hazardId: number; kind: HazardKind; x: number; y: number; warn: number }
  /** 위험 지역 발동 — 이제부터 activeTime초 동안 피해. x, y = 중심, hitPlayer = 이 순간 플레이어가 맞았나 */
  | { type: 'hazardImpact'; hazardId: number; kind: HazardKind; x: number; y: number; hitPlayer: boolean }
  | { type: 'won' }
  | { type: 'lost'; reason: LostReason };

/** 보스 위험 지역 종류: 깜짝 상자 내려찍기(열 사각형) / 구슬 비(원) */
export type HazardKind = 'slam' | 'marble';

/**
 * 위험 지역 (보스 행동이 만든다, sim.hazards). 예고(warn) → 발동(active, 이때만 피해) → 끝(done — 스텝 끝에 목록에서 빠짐).
 * 위치는 언제나 바운딩 박스 (x, y) 좌상단 + w × h. shape 'circle'은 그 안에 내접한 원(w = h = 지름).
 * 피해: 발동 중 플레이어 피격 원과 겹치고 무적이 아니면 한 번 (무적 시간 적용, 'playerHit' source 'hazard').
 */
export interface HazardEntity {
  id: number;
  kind: HazardKind;
  shape: 'rect' | 'circle';
  x: number;
  y: number;
  w: number;
  h: number;
  state: 'warn' | 'active' | 'done';
  /** 지금 상태에 남은 시간(초) */
  timer: number;
  /** 예고·발동 전체 길이(초) — 렌더 진행도용 */
  warnTime: number;
  activeTime: number;
  /** stage.dmgMul 곱한 뒤 */
  damage: number;
  /** 렌더용 그림 키 (구슬 shot_marble, 내려찍는 깜짝 상자 enemy_jack 등) */
  sprite: string;
  /** 이번 발동에서 이미 플레이어를 때렸다 (한 번만) */
  hit: boolean;
}

export type BossMode = 'enter' | 'roar' | 'idle' | 'windup' | 'act' | 'dead';

/**
 * 보스전 상태 (sim.boss — 보스전이 아니면 null). 렌더·HUD용, sim이 매 스텝 제자리에서 갱신한다(새로 만들지 않음).
 * mode: enter 등장(위에서 내려오는 중) / roar 포효(무적·행동 정지) / idle 쉬는 중 / windup 예비 동작 / act 행동 중 / dead 처치됨
 */
export interface BossState {
  /** 보스 적 id (sim.enemies 안 — 죽으면 빠진다) */
  enemyId: number;
  /** BossDef id */
  defId: string;
  /** 지금 페이즈(0부터) / 페이즈 수 */
  phase: number;
  phases: number;
  mode: BossMode;
  /** windup·act일 때 지금 행동, 아니면 null */
  action: BossActionKind | null;
  actionId: string | null;
  /** roar·windup에 남은 시간(초), 다른 모드는 0 */
  modeTime: number;
  /** 포효 중 무적 (피해·상태이상 무시) */
  invulnerable: boolean;
  /** 살아있는 졸개 수 / 지금 페이즈 상한 */
  minions: number;
  minionCap: number;
  /** 보스 HP 비율 0..1 */
  hpFrac: number;
}

/** 패배 사유: HP 0 / 적이 방어선(필드 바닥)에 닿음 / 플레이어가 살아있는 적 몸에 닿음(무적 시간과 무관하게 즉시) */
export type LostReason = 'hp' | 'breach' | 'contact';

export type CombatStatus = 'running' | 'won' | 'lost';

// ─────────────────────────────────────────────────────────────
// 런 / 상점 (src/logic/run.ts, src/logic/shop.ts)
// ─────────────────────────────────────────────────────────────

export interface ShopSlot {
  defId: string;
  tier: Tier;
  price: number;
  locked: boolean;
}

export interface ShopState {
  /** 길이 SHOP_SLOTS. 산 칸은 null */
  slots: (ShopSlot | null)[];
  rerollCost: number;
  healBought: boolean;
}

export interface RunStats {
  kills: number;
  goldEarned: number;
  stagesCleared: number;
}

export interface RunState {
  version: number;
  characterId: string;
  /** 다음에 도전할(또는 진행 중인) 스테이지 인덱스 */
  stageIndex: number;
  /** 이어하기 시 돌아갈 화면. 상점 진입 시 'shop', 전투 시작 시 'combat'으로 저장 */
  resumeAt: 'combat' | 'shop';
  gold: number;
  hp: number;
  bag: BagState;
  shop: ShopState;
  /** 직렬화 가능한 RNG 상태 */
  rngState: number;
  /** 전투 시드 생성용 */
  seed: number;
  stats: RunStats;
  /**
   * 런 종류. 없으면 'normal'(일반 런 — newRun은 이 필드를 쓰지 않아 세이브 모양이 예전과 같다).
   * 'bossTest' = 보스 테스트(newBossTestRun): 보스전 한 판, 저장·삭제하지 않는다(saveRun/clearRun 무시, loadRun이 거름) —
   * 일반 런 세이브를 절대 건드리지 않는다.
   */
  mode?: RunMode;
}

export type RunMode = 'normal' | 'bossTest';

/** 적 처치 보상 처리 결과 */
export interface KillReward {
  gold: number;
  /** 드롭이 보관함에 들어갔으면 그 아이템, 보관함이 가득 차 환전됐으면 converted=true */
  drop: { defId: string; tier: Tier; uid: number | null; converted: boolean; convertedGold: number } | null;
}
