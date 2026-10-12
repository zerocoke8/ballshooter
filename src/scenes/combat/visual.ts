// 전투 화면 렌더 전용 상수 (연출/레이아웃). 게임 규칙 수치는 config.ts / data / logic에 있다.
import { SUMMON_LAND_TIME } from '../../config';

// ── 레이아웃 ─────────────────────────────────────────────────
/** 긴 화면에서 남는 높이 중 위쪽 여백으로 주는 비율과 상한 (나머지는 하단 바) */
export const TOP_PAD_RATIO = 0.3;
export const TOP_PAD_MAX = 80;
/** 필드 위쪽 벽 두께 (HUD 아래 끝에 겹쳐 그린다) */
export const WALL_TOP_H = 14;

// ── 색 ───────────────────────────────────────────────────────
export const WOOD = 0xc4834a;
export const WOOD_LIGHT = 0xe0a468;
export const WOOD_DARK = 0x6e4224;
export const DEFENSE_RED = 0xff4a4a;
export const HUD_BG = 0x2b1d3a;
export const BAR_BG = 0x24182f;
/** 프레임 애니메이션이 있는 적(덮개 실루엣을 못 쓰는 경우)의 상태이상 tint */
export const BURN_TINT = 0xffa264;
export const CHILL_TINT = 0x9fdcff;
export const ENEMY_SHOT_GLOW = 0xff3b3b;
/**
 * 일반 피해 숫자 색. 적 HP 숫자(흰색, 같은 숫자 폰트)와 구별되게 노랑 — 흰색이면 맞은 적 머리 위에서
 * "10"(피해)과 "15"(남은 HP)가 같은 모양으로 겹쳐 어느 쪽이 HP인지 읽을 수 없었다
 */
export const DAMAGE_COLOR = 0xffe45c;
export const PLAYER_DAMAGE_COLOR = 0xff6b6b;
export const LIGHTNING_COLOR = 0xfff27a;

// ── 필드 연출 ────────────────────────────────────────────────
/** 배경을 살짝 어둡게 (스프라이트가 도드라지게) */
export const BG_DIM_ALPHA = 0.16;
/** 가장 아래 적이 방어선에서 이 거리 안이면 방어선이 빨갛게 맥동 */
export const DANGER_RANGE = 180;
/** 적이 화면에 들어오기 이만큼 전에 스프라이트를 만든다 (필드 좌표 px) */
export const ENEMY_PRESPAWN = 24;
/** 적 스프라이트를 충돌 박스보다 살짝 크게 */
export const ENEMY_SPRITE_SCALE = 1.12;
/**
 * HP 숫자 중심이 충돌 박스 아래 끝에서 얼마나 위인가. 큰 적(곰인형·보스)은 글자도 커서 더 올려야
 * 빽빽한 대형에서 바로 아래 줄 적의 머리를 덮지 않는다
 */
export const ENEMY_HP_LIFT = 8;
export const ENEMY_HP_LIFT_BIG = 26;
export const ENEMY_HIT_THROTTLE = 0.12;
/** 보스/대형 적은 흔들림이 크므로 더 드물게 */
export const BIG_ENEMY_HIT_THROTTLE = 0.45;
/** 동시에 재생하는 피격 플래시 상한 (필터 비용) */
export const MAX_HIT_FLASHES = 16;
export const ENEMY_DIE_TIME = 0.55;

export const PLAYER_DISPLAY = 100;
export const PLAYER_ATTACK_THROTTLE = 0.3;
export const PLAYER_MOVE_EPS = 0.6;
/** 무적 중 깜빡임 주기 (Hz) */
export const PLAYER_BLINK_HZ = 9;

/** 투사체 보이는 크기 = 반경 × 2 × 이 값 (충돌 반경은 그대로 — 보이는 것만 살짝 크게) */
export const PROJ_VISUAL_SCALE = 1.4;
export const SHOT_VISUAL_SCALE = 1.35;
export const SHOT_GLOW_SCALE = 2.6;
/** 회전 투사체 각속도 (rad/s) */
export const SPIN_SPEED = 10;
/** 방향이 없는 투사체(방귀 구름 등)의 좌우 흔들림 */
export const WOBBLE_ANGLE = 0.18;
export const WOBBLE_HZ = 2.2;

/**
 * PNG의 앞쪽 방향(라디안, 0 = 오른쪽, π/2 = 아래). 비행 방향으로 회전시킬 때 뺀다.
 * null = 회전하지 않고 똑바로 세운 채 살짝 흔든다. 목록에 없으면 0(오른쪽을 봄).
 */
export const SPRITE_FACING: Readonly<Record<string, number | null>> = {
  proj_fish: 0,
  proj_tuna: 0,
  proj_fart: null,
  proj_methane: null,
  shot_dart: Math.PI / 2,
  shot_bolt: Math.PI / 2,
  shot_spring: null,
  // 보스 행동 탄: 얼굴이 있는 장난감 블록·팽이 — 비행 방향으로 돌리면 얼굴이 옆으로 눕는다
  shot_block: null,
  shot_top: null,
  shot_marble: null,
};
/** 적 탄 중 회전하는 것 */
export const SPINNING_SHOTS: ReadonlySet<string> = new Set(['shot_gear']);

// ── 조준 가이드 (필드 좌표 px) ───────────────────────────────
/** 점선 궤적 최대 길이 / 선분 수(2 = 벽 반사 1번까지) */
export const AIM_GUIDE_LEN = 900;
export const AIM_GUIDE_SEGMENTS = 2;
/** 점 간격, 발사점에서 첫 점까지(캐릭터 몸에 가리지 않게), 점이 바깥으로 흐르는 속도(px/s) */
export const AIM_DOT_SPACING = 20;
export const AIM_DOT_START = 78;
export const AIM_DOT_FLOW = 46;
/** 점 지름(px)과 끝으로 갈수록 줄어드는 비율, 처음/끝 알파 */
export const AIM_DOT_SIZE = 13;
export const AIM_DOT_END_SCALE = 0.62;
export const AIM_DOT_ALPHA_NEAR = 0.95;
export const AIM_DOT_ALPHA_FAR = 0.3;
/** 캐릭터 옆 조준 화살표: 발사점에서의 거리, 길이 */
export const AIM_ARROW_DIST = 58;
export const AIM_ARROW_LEN = 36;
/** 탭한 자리 고리 펄스 */
export const AIM_PULSE_TIME = 0.42;
export const AIM_PULSE_SIZE = 74;
/** 조준이 바뀔 때 화살표 '톡' 강조 시간 */
export const AIM_SNAP_TIME = 0.22;
/** 가이드가 쓰는 공 반경을 정할 수 없을 때 (무기 없음) */
export const AIM_GUIDE_DEFAULT_RADIUS = 12;
export const AIM_OUTLINE = 0x3a2516;
/** 탭 위치가 발사점에서 이보다 가까우면 방향이 불안정 → 조준하지 않음 (필드 px) */
export const AIM_TAP_MIN_DIST = 26;
/**
 * 캐릭터 몸(중심에서 이 반경 안)을 탭하면 조준하지 않음 (필드 px). 몸 아래쪽은 발사점보다 아래라
 * '아래 방향' → 수평 끝(±8°)으로 clamp되어 조준이 엉뚱하게 꺾인다. 보이는 크기(PLAYER_DISPLAY)의 반
 */
export const AIM_TAP_BODY_RADIUS = PLAYER_DISPLAY / 2;
/** 이 이상 cos(조준각)이 한쪽으로 기울면 캐릭터가 그쪽을 본다 (그림은 오른쪽을 봄) */
export const FACE_DEADZONE = 0.12;
/** 캐릭터 좌우 뒤집기 속도 (scale.x 변화/초) */
export const FACE_TURN_RATE = 12;

// ── 첫 스테이지 조작 안내 ────────────────────────────────────
export const TUTORIAL_FONT = 26;
/** 말풍선이 캐릭터 옆에 붙는 가로 거리, 캐릭터 중심 기준 높이 */
export const TUTORIAL_SIDE = 150;
export const TUTORIAL_RISE = 96;

// ── 이펙트 ───────────────────────────────────────────────────
export const MAX_DAMAGE_NUMBERS = 40;
/** 이펙트 파티클 풀 크기 (ParticleContainer 하나, 아틀라스 한 장 → 드로우콜 1) */
export const MAX_PARTICLES = 720;
/** 풀이 이 비율 넘게 차 있으면 장식용(파편·연기 꼬리) 파티클은 건너뛴다 */
export const PARTICLE_SOFT_CAP = 0.75;
export const MAX_BOLTS = 18;
export const MAX_COIN_FLYERS = 24;
export const DAMAGE_NUMBER_LIFE = 0.68;
/** 같은 적의 연속 피해를 숫자 하나로 합치는 창(초) */
export const DAMAGE_MERGE_WINDOW = 0.25;
/** 화상 틱(0.5초마다)은 더 긴 창으로 합치고 작게 — 불타는 적마다 작은 숫자가 HP 숫자 위에 계속 뜨지 않게 */
export const DOT_MERGE_WINDOW = 0.6;
export const DOT_NUMBER_SCALE = 0.7;
/** 숫자가 이보다 위(필드 y)로 가지 않는다 — 맨 윗줄 적의 숫자가 위쪽 벽·HUD 밑으로 잘리지 않게 */
export const NUMBER_MIN_Y = 34;
/** 한 프레임에 새로 띄우는 타격 별(fx_impact) 상한 — 폭발·연쇄가 한꺼번에 터져도 화면을 덮지 않게 */
export const MAX_IMPACTS_PER_FRAME = 10;
/**
 * 폭발 겹침: 최근 EXPLODE_STACK_TIME 안에 터진 폭발 구름과 (반경 × EXPLODE_STACK_DIST) 안에서 또 터지면
 * 구름을 작게(EXPLODE_STACK_SCALE) + 연기 없이 — 화염병·메탄·빙수가 같은 적(보스)에 겹쳐 터지면 주황 구름이 대상을 계속 덮었다
 */
export const EXPLODE_STACK_TIME = 0.3;
export const EXPLODE_STACK_DIST = 0.75;
export const EXPLODE_STACK_SCALE = 0.6;
export const VIGNETTE_TIME = 0.45;

// ── 투사체 꼬리 ──────────────────────────────────────────────
/** 꼬리 마디 수 (마디마다 파티클 1개, 굵기·알파가 TRAIL_TAPER 배씩 줄어 끊김 없이 가늘어진다) */
export const TRAIL_SEGMENTS = 4;
export const TRAIL_TAPER = 0.72;
/**
 * 꼬리 길이 = 투사체 반경 × 이 값 (최소/최대 px). 무기 5종 이상이면 투사체 15~25개가 동시에 나는데,
 * 길이 7×반경(최대 140)이면 꼬리가 몸통보다 넓게 화면을 덮어 '판이 투사체로 가득'한 느낌이 돌아왔다 → 속도선 정도로
 */
export const TRAIL_LEN_PER_RADIUS = 4.8;
export const TRAIL_LEN_MIN = 40;
export const TRAIL_LEN_MAX = 96;
/** 꼬리 머리 굵기 = 반경 × 2 × 이 값, 머리 알파 (원소 투사체는 ProjectileLayer의 ELEMENT_TRAIL_ALPHA) */
export const TRAIL_WIDTH = 0.92;
export const TRAIL_ALPHA = 0.8;
/**
 * 아래로 내려가는(벽·천장에 맞고 돌아오는) 투사체의 꼬리 알파 배수 — 공격하러 올라가는 공이 눈에 띄고,
 * 다 쓰고 바닥으로 빠지는 공은 배경으로 물러난다. 초당 TRAIL_FALL_RATE 속도로 바뀐다(반사 순간 툭 끊기지 않게)
 */
export const TRAIL_FALL_ALPHA = 0.5;
export const TRAIL_FALL_RATE = 5;
/** 위치 기록 개수 (프레임마다 1개 — 느린 프레임에서도 길이는 위 길이로 자른다) */
export const TRAIL_HISTORY = 12;
export const TRAIL_COLOR = 0xffffff;
/** 적 탄 꼬리 (빨간 글로우와 같은 계열 — 방향이 한눈에 보이게) */
export const SHOT_TRAIL_LEN = 54;
export const SHOT_TRAIL_ALPHA = 0.5;

// ── 타격감 ───────────────────────────────────────────────────
/** 적 피격: 맞은 면 반대로 밀렸다가 스프링으로 복귀 (px), 스쿼시 양 */
/** (4.5 → 6.5: 폰에서 2px 남짓이라 거의 안 보였다 — 투사체가 적고 묵직해진 만큼 한 방이 더 밀리게) */
export const ENEMY_KNOCKBACK = 6.5;
export const ENEMY_SQUASH = 0.22;
/** 스프링 각진동수(rad/s)와 감쇠비 */
export const ENEMY_SPRING_W = 32;
export const ENEMY_SPRING_ZETA = 0.32;
/** 흰 번쩍임 길이 (덮개 실루엣 알파 1 → 0) */
export const ENEMY_FLASH_TIME = 0.11;
/** 처치 '펑': 부풀었다가 터지는 시간과 최대 배율 */
export const ENEMY_POP_TIME = 0.085;
export const ENEMY_POP_SCALE = 1.3;
/** 냉기 덮개(얼음 실루엣) 알파, 화상 덮개(주황) 알파 */
export const FROST_OVERLAY_ALPHA = 0.82;
/**
 * 보스의 냉기 덮개 알파. 보스는 화면의 큰 부분이라 0.82면 얼음 실루엣이 그림(얼굴·입 속 장난감)을 거의 다 덮었다 —
 * 얼음 무기 빌드에선 보스전 내내 창백한 덩어리로 보여서 낮춘다 (냉기 저항 보스라는 느낌과도 맞음)
 */
export const BOSS_FROST_OVERLAY_ALPHA = 0.5;
export const BURN_OVERLAY_ALPHA = 0.24;
export const BURN_OVERLAY_COLOR = 0xff9b3d;
/** 상태이상 파티클 간격(초): 불꽃이 피어오름 / 얼음 조각이 반짝 */
export const BURN_EMIT_INTERVAL = 0.17;
export const FROST_EMIT_INTERVAL = 0.32;

/** 화면 흔들림: 트라우마(0..1)를 더하고 초당 감소, 흔들림 = 트라우마² × 최대 px */
export const SHAKE_MAX_PX = 15;
export const SHAKE_DECAY = 1.7;
export const TRAUMA_PLAYER_HIT = 0.55;
export const TRAUMA_ELITE_KILL = 0.62;
export const TRAUMA_BOSS_KILL = 1;
export const TRAUMA_BOSS_ARRIVE = 0.5;
export const TRAUMA_DEFEAT = 0.8;
/** 폭발 트라우마 = 반경 × 이 값 (상한) — 자주 터지므로 작게(제곱이라 작은 값은 거의 안 흔들림) */
export const TRAUMA_PER_EXPLODE_PX = 0.0019;
export const TRAUMA_EXPLODE_MAX = 0.3;
/** 히트스톱(시뮬레이션 + 화면 정지, 초) */
export const HITSTOP_ELITE = 0.055;
export const HITSTOP_BOSS = 0.08;
export const HITSTOP_PLAYER = 0.035;

/** 발사 연출: 캐릭터 반동 스쿼시 최소 간격, 총구 연기 최소 간격 */
export const PLAYER_RECOIL_THROTTLE = 0.11;
export const MUZZLE_PUFF_THROTTLE = 0.09;
/** 벽 반사 먼지: 같은 자리(반경 px)에서 이 시간 안에는 다시 안 띄움, 전체 초당 상한 */
export const WALL_DUST_RADIUS = 40;
export const WALL_DUST_COOLDOWN = 0.1;
export const WALL_DUST_PER_SEC = 24;

// ── '백어택!' 콤보 ───────────────────────────────────────────
/** 이 시간(초) 동안 백어택가 없으면 콤보 끝 */
export const COMBO_TIMEOUT = 1.2;
/** 콤보 글자 갱신 최소 간격(초) — 연타에도 깜빡이지 않게 */
export const COMBO_REFRESH = 0.09;
/**
 * 콤보 색: 분홍 → 진분홍. 노랑(0xffd23f)이었을 때 "x3!"이 같은 숫자 폰트·거의 같은 색의 피해 숫자(DAMAGE_COLOR)와
 * 같은 자리에서 겹쳐 "x3!"과 "25"가 섞여 읽혔다. 불 피해 숫자(주황)·골드(금색)와도 다른 색
 */
export const COMBO_COLOR = 0xff9ad5;
export const COMBO_HOT_COLOR = 0xff5cb8;
/**
 * 보스전: 콤보 글자가 피하는 보스 입 둘레 (입 = 보스 아래 가운데, 행동 예고 빛 BOSS_GLOW_MAX 지름 210 + 탄이 나오는 자리) —
 * 가로 반폭, 입 위로, 입 아래로 (px). 보스 바로 아래 졸개를 백어택하면 글자가 입 위를 덮어 예고 색을 가렸다
 */
export const COMBO_AVOID_HALF_W = 150;
export const COMBO_AVOID_UP = 150;
export const COMBO_AVOID_DOWN = 80;

// ── 보스전 연출 (BossFx — 장난감 상자 대마왕) ─────────────────
/** 행동 예비 동작 때 입에서 피어나는 빛 색 (행동 종류별 — 무엇이 올지 미리 읽히게) */
export const BOSS_TELL_COLOR = {
  volley: 0xffa040,
  ring: 0x8fd8ff,
  slam: 0xff4040,
  marbles: 0xb7a6ff,
  summon: 0x9cff8a,
} as const;
export const BOSS_ROAR_COLOR = 0xff5a3a;
/** 입 빛 크기(px): 예비 동작 시작 → 끝, 실행 순간 번쩍임 */
export const BOSS_GLOW_MIN = 70;
export const BOSS_GLOW_MAX = 210;
export const BOSS_GLOW_FLASH_TIME = 0.28;
/** 자세가 목표로 따라가는 속도(1/초), 실행 순간 '팝' 감쇠(1/초), 내려앉기 출렁 시간 */
export const BOSS_POSE_RATE = 14;
export const BOSS_PUNCH_DECAY = 7;
export const BOSS_LAND_TIME = 0.4;
/** 위험 지역 예고: 빨간 열(내려찍기) */
export const HAZARD_RED = 0xff2a2a;
export const HAZARD_FILL_ALPHA = 0.12;
export const HAZARD_FILL_ALPHA_END = 0.26;
export const HAZARD_STRIPE_ALPHA = 0.22;
export const HAZARD_STRIPE_SPEED = 90;
/** 내려찍는 깜짝 상자 그림 폭(px, 열 폭의 비율 상한)과 떨어지는 시간(초) */
export const SLAM_JACK_W = 100;
export const SLAM_DROP_TIME = 0.06;
/**
 * 구슬: 예고 진행 이 비율부터 보인다 / 처음 높이(자리 위 px)·처음 크기 배수(+이만큼, 가까이 있는 느낌) / 그림 크기(반경 대비).
 * 위에서 내려다본 낙하 — 자리 근처에서 커다랗게 나타나 작아지며 내려앉는다(필드를 가로질러 날아오면 적 탄처럼 읽혔다)
 */
export const MARBLE_SHOW_AT = 0.5;
export const MARBLE_DROP_H = 110;
export const MARBLE_DROP_SCALE = 0.75;
export const MARBLE_SIZE = 0.9;
/** 위험 지역이 끝난 뒤(또는 보스가 죽어 취소된 뒤) 사라지는 시간 */
export const HAZARD_FADE_TIME = 0.28;
/** 소환 졸개가 입에서 칸으로 날아가는 시간 — sim이 그동안 졸개 몸을 '아직 없음'(접촉 즉사 없음)으로 다루는 시간과 같아야 한다 */
export const SUMMON_HOP_TIME = SUMMON_LAND_TIME;
/** 흔들림: 내려찍기 충격, 구슬 하나, 포효(페이즈 전환), 등장 착지 */
export const TRAUMA_SLAM = 0.42;
export const TRAUMA_MARBLE = 0.16;
export const TRAUMA_ROAR = 0.6;
export const TRAUMA_BOSS_LAND = 0.5;
/** 페이즈 전환 화면 번쩍임 시간·최대 알파 */
export const PHASE_FLASH_TIME = 0.4;
export const PHASE_FLASH_ALPHA = 0.55;
/** 페이즈 배너 표시 시간, 필드 위 y(보스 몸 위 — 아래쪽 탄을 가리지 않게) */
export const PHASE_BANNER_TIME = 1.5;
export const PHASE_BANNER_Y = 230;

// ── 재미 기능 연출 (백어택·행동하는 적·시너지 아이템·액티브 스킬) ──────
/**
 * 백어택 피해 숫자: 진분홍 + 크게 + 노란 별 딱지. 불 숫자(주황 ELEMENT_COLORS.fire)·골드·콤보 글자(연분홍 COMBO_COLOR)와 다른 색 —
 * 속성 공의 백어택도 이 색 (속성은 타격 연출이 보여 준다)
 */
export const BACK_DAMAGE_COLOR = 0xff5fae;
export const BACK_NUMBER_SCALE = 1.28;
/** 장갑에 막혀 줄어든 피해 숫자: 쇳빛 회색, 조금 작게 ('깡' 소리와 함께) */
export const ARMOR_DAMAGE_COLOR = 0xb9c3cf;
export const ARMOR_NUMBER_SCALE = 0.86;
/** 회복 숫자 '+N'·치유 연출 색 */
export const HEAL_COLOR = 0x5ee07a;
/** 회복받은 적의 번쩍임 (흰 실루엣에 곱하는 연두) / 길이 */
export const HEAL_FLASH_TINT = 0x9cff9c;
export const HEAL_FLASH_TIME = 0.3;
/** 방패 '막음!' 글자: 같은 방패에서 다시 띄우는 최소 간격(초), 동시에 떠 있는 글자 수 */
export const BLOCK_TAG_COOLDOWN = 0.7;
export const MAX_FLOAT_TAGS = 6;
/** 폭탄병 심지 불꽃 간격(초) */
export const FUSE_EMIT_INTERVAL = 0.11;
/** 폭탄병 연쇄: 같은 묶음에서 터지는 폭발을 이 간격(초)씩 늦게 그린다 (한꺼번에 덮이지 않고 '펑-펑-펑') — 판정은 이미 끝났다 */
export const BOMB_CHAIN_STAGGER = 0.08;
/** 폭탄병 폭발 흔들림: 첫 폭발 / 연쇄로 더 터질 때마다 */
export const TRAUMA_BOMB = 0.3;
export const TRAUMA_BOMB_CHAIN = 0.1;
/** 증기 주전자 폭발 흔들림 */
export const TRAUMA_STEAM = 0.12;
/** RC카 미끄러짐: 뒤로 젖히는 기울기(라디안), 바퀴 먼지 간격(초), 멈춘 뒤 기울기가 돌아오는 시간 */
export const SLIDE_LEAN = 0.16;
export const SLIDE_DUST_INTERVAL = 0.06;
export const SLIDE_SETTLE_TIME = 0.14;
/** 유도 리본 공의 꼬리: 분홍 리본 (속성 색과 섞음), 길이 배수 */
export const RIBBON_COLOR = 0xff7fd0;
export const RIBBON_TRAIL_LEN_MUL = 1.45;
/** 털뭉치 폭풍(스킬) 공의 꼬리 색 (속성이 없을 때) */
export const STORM_TRAIL_COLOR = 0xc8a8ff;
/** 트램펄린 튕김 색 */
export const TRAMPOLINE_COLOR = 0x5fb8ff;
/** 스킬 발동 화면 번쩍임: 색 / 최대 알파 / 시간 */
export const FREEZE_FLASH_COLOR = 0xbfeaff;
export const FREEZE_FLASH_ALPHA = 0.55;
export const FREEZE_FLASH_TIME = 0.5;
export const SPRING_FLASH_COLOR = 0xffd9a0;
export const SPRING_FLASH_ALPHA = 0.32;
export const SPRING_FLASH_TIME = 0.4;
export const STORM_FLASH_COLOR = 0xd9c4ff;
export const STORM_FLASH_ALPHA = 0.26;
export const STORM_FLASH_TIME = 0.3;
export const TRAUMA_SKILL = 0.32;
/** 빙하기 서리 파도가 퍼지는 속도(px/s) — 얼어붙는 적의 연출은 플레이어와의 거리만큼 늦게 (파도가 닿는 순간) */
export const FROST_WAVE_SPEED = 1900;
/** 얼림(빙하기) 덮개 알파 — 냉기(FROST_OVERLAY_ALPHA)보다 진하게 / 그 위 얼음 상자 알파 */
export const FROZEN_OVERLAY_ALPHA = 0.95;
export const ICE_BLOCK_ALPHA = 0.9;
/** 온천 기운 원 색 / 김 피어오르는 간격(초) */
export const SPRING_AURA_COLOR = 0xffc98a;
export const AURA_WISP_INTERVAL = 0.06;

// ── 흐름 ─────────────────────────────────────────────────────
export const INTRO_TIME = 1.2;
export const CELEBRATE_TIME = 0.8;
export const DEFEAT_TIME = 1.2;
/** 프레임당 최대 시뮬레이션 스텝 (디버그 배속이면 배속만큼 늘어남) */
export const MAX_STEPS_PER_FRAME = 5;
export const KEY_MOVE_LEAD = 80;
