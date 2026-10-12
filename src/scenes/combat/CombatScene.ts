// 전투 씬: CombatSim(고정 스텝) 구동 + 렌더러들 + 입력 + 흐름(인트로 → 전투 → 클리어/패배) + 가방 오버레이.
// 게임 규칙은 전부 sim/run 로직에 있고, 여기서는 이벤트를 연출로 옮기기만 한다.
// 보스전(stage.boss): 보스 연출은 BossFx(자세·입 빛·위험 지역 예고), 페이즈 배너·번쩍임은 여기.
// 재미 기능 연출: 백어택(sim 'hit'.back — 분홍 숫자·별 딱지·콤보), 행동하는 적(막음·치유·폭탄 연쇄·장갑·젤리·RC카),
// 시너지(증기·폭죽·트램펄린·코일 두 번째 줄기·불 옮김·리본 꼬리), 액티브 스킬(SkillFx + 발동 연출), 레벨업 소리.
// 보스 테스트 런(isBossTestRun): 보상·스테이지 클리어·저장 없이 끝나면 보스 결과 화면(game.toBossResult)으로.
import {
  Container,
  Graphics,
  Point,
  Rectangle,
  Sprite,
  Texture,
  type DestroyOptions,
  type FederatedPointerEvent,
  type Text,
} from 'pixi.js';
import { sfx } from '../../audio';
import {
  AIM_KEY_RATE_DEG,
  BOTTOM_BAR_MIN_H,
  CELL,
  DESIGN_W,
  ENEMY_INSET,
  FIELD_H,
  FIELD_W,
  FIELD_X,
  HUD_H,
  SIM_DT,
  SKILL_WEAPON_UID,
  TAP_SLOP,
  UI_COLORS,
} from '../../config';
import type { Viewport } from '../../core/app';
import { Keyboard } from '../../core/keyboard';
import {
  COIN_STREAK_MAX,
  COIN_STREAK_STEP,
  COIN_STREAK_WINDOW,
  COMBAT_PAN,
  COMBO_PITCH_MAX,
  COMBO_PITCH_STEP,
  DANGER_REPEAT,
  ELEMENT_HIT_SFX,
  ENEMY_SHOT_SFX,
  HEAVY_HIT_DAMAGE,
  weaponFireSfx,
  type SfxId,
} from '../../data/sfxMap';
import { Scene } from '../../core/scene';
import { game } from '../../game';
import { T } from '../../i18n/ko';
import { findMerges } from '../../logic/bag';
import { clampPlayerX, clampPlayerY } from '../../logic/combat/movement';
import { clampAim, CombatSim, FIRE_OFFSET_Y } from '../../logic/combat/sim';
import {
  combatSeed,
  completeStage,
  currentStage,
  grantKillXp,
  grantXp,
  isBossTestRun,
  pendingLevelUps,
  rewardKill,
  runCharacter,
  runLevel,
  runLoadout,
  runPlayerStats,
  runSkill,
  runXp,
  saveRun,
  xpToNext,
} from '../../logic/run';
import type {
  BossDef,
  CombatEvent,
  CombatInput,
  CombatStatus,
  EnemyEntity,
  GameData,
  LevelUpResult,
  LostReason,
  RunState,
  SkillDef,
  StageDef,
  Tier,
  WeaponLoadout,
} from '../../types';
import { tex } from '../../render/assets';
import { Toast } from '../../ui';
import { AimGuide } from './AimGuide';
import { BagOverlay } from './BagOverlay';
import { Banner, type BannerKind } from './Banner';
import { BossBar } from './BossBar';
import { BossFx } from './BossFx';
import { ComboLabel } from './ComboLabel';
import { Effects, NUM_ARMOR, NUM_BACK, NUM_NORMAL, type NumStyle } from './Effects';
import { EnemyLayer, type HitInfo } from './EnemyLayer';
import { FieldView } from './FieldView';
import { FloatTags } from './FloatTags';
import { Flyers } from './Flyers';
import { FrameView } from './FrameView';
import { ensureNumberFont, fxAtlas, fxTextures } from './fxTextures';
import { Hud } from './Hud';
import { LevelUpOverlay } from './LevelUpOverlay';
import { PlayerView } from './PlayerView';
import { PROJ_STYLE_HOMING, PROJ_STYLE_SKILL, ProjectileLayer } from './ProjectileLayer';
import { SKILL_BUTTON_R, SkillButton } from './SkillButton';
import { SkillFx } from './SkillFx';
import { TutorialCallout } from './TutorialCallout';
import { WeaponBar } from './WeaponBar';
import { XpBar } from './XpBar';
import {
  AIM_GUIDE_DEFAULT_RADIUS,
  AIM_TAP_BODY_RADIUS,
  AIM_TAP_MIN_DIST,
  BLOCK_TAG_COOLDOWN,
  BOMB_CHAIN_STAGGER,
  CELEBRATE_TIME,
  COMBO_AVOID_DOWN,
  COMBO_AVOID_HALF_W,
  COMBO_AVOID_UP,
  DANGER_RANGE,
  DEFEAT_TIME,
  DEFENSE_RED,
  ENEMY_POP_TIME,
  FREEZE_FLASH_ALPHA,
  FREEZE_FLASH_COLOR,
  FREEZE_FLASH_TIME,
  FROST_WAVE_SPEED,
  HITSTOP_BOSS,
  HITSTOP_ELITE,
  HITSTOP_PLAYER,
  INTRO_TIME,
  KEY_MOVE_LEAD,
  MAX_FLOAT_TAGS,
  MAX_STEPS_PER_FRAME,
  PHASE_BANNER_TIME,
  PHASE_BANNER_Y,
  PHASE_FLASH_ALPHA,
  PHASE_FLASH_TIME,
  SUMMON_HOP_TIME,
  SHAKE_DECAY,
  SHAKE_MAX_PX,
  SPRING_FLASH_ALPHA,
  SPRING_FLASH_COLOR,
  SPRING_FLASH_TIME,
  STORM_FLASH_ALPHA,
  STORM_FLASH_COLOR,
  STORM_FLASH_TIME,
  TOP_PAD_MAX,
  TOP_PAD_RATIO,
  TRAIL_TAPER,
  TRAUMA_BOSS_ARRIVE,
  TRAUMA_BOSS_KILL,
  TRAUMA_DEFEAT,
  TRAUMA_BOMB,
  TRAUMA_BOMB_CHAIN,
  TRAUMA_BOSS_LAND,
  TRAUMA_ELITE_KILL,
  TRAUMA_EXPLODE_MAX,
  TRAUMA_MARBLE,
  TRAUMA_PER_EXPLODE_PX,
  TRAUMA_PLAYER_HIT,
  TRAUMA_ROAR,
  TRAUMA_SKILL,
  TRAUMA_SLAM,
  TRAUMA_STEAM,
  VIGNETTE_TIME,
  WALL_TOP_H,
} from './visual';

export type CombatPhase = 'intro' | 'fight' | 'won' | 'lost';

interface Timer {
  t: number;
  fn: () => void;
}

/**
 * 화면을 누른 포인터 하나. 누른 채 TAP_SLOP 이내면 'pending'(떼면 탭 = 조준),
 * 넘게 움직이면 아무도 드래그 중이 아닐 때 'drag'(이동), 다른 손가락이 드래그 중이면 'aim'(따라 조준, 떼면 확정).
 */
interface PointerTrack {
  id: number;
  mode: 'pending' | 'drag' | 'aim';
  /** 누른 위치 (씬 좌표) */
  downX: number;
  downY: number;
}

/** 드래그가 이만큼(필드 px) 움직이면 '이동을 해봤다'로 친다 (하단 힌트) */
const HINT_DISMISS_DIST = 24;
const MAX_SPEED_MUL = 50;
const DEG = Math.PI / 180;
/** 시작 조준: 바로 위 */
const AIM_START = -Math.PI / 2;
/** debugState.recentShots에 넣는 갓 쏜 투사체 나이 상한(초) */
const RECENT_SHOT_AGE = 0.12;
/** 보스전의 피해 숫자 상한 y (필드 좌표) — BossBar(이름 + 바, 위에서 약 56px) 아래 */
const BOSS_NUMBER_MIN_Y = 86;
/** 미리 그려 둔 글자를 계속 그릴 때의 크기 (텍스처 해상도는 크기와 무관 — 그리는 비용만 거의 0으로) */
const WARM_TEXT_SCALE = 0.01;
/** 인트로 동안 미리 만들어 두는 투사체 / 적 탄 뷰 수 (스트레스 빌드의 평소 동시 투사체 수 정도) */
const PREWARM_PROJ_VIEWS = 32;
const PREWARM_SHOT_VIEWS = 12;
/** 배너 기본 높이 (필드 높이 비율) */
const BANNER_FIELD_Y = 0.36;
/** 보스 테스트 승리: 보스 연쇄 폭발을 다 보고 결과로 (CELEBRATE_TIME에 더함) */
const BOSS_TEST_CELEBRATE_EXTRA = 1.1;
/** HUD 경험치 막대 자리 (HUD 좌표 — 골드 오른쪽, HP 막대 아래) */
const XP_BAR_X = 118;
const XP_BAR_Y = 55;
/** 스킬 버튼: 하단 바 오른쪽 여백 / 무기 슬롯과의 간격 / 하단 바 위끝에서 버튼 가운데까지 (무기 슬롯 줄 가운데와 같은 높이) */
const SKILL_SIDE = 26;
const SKILL_GAP = 14;
const SKILL_CENTER_Y = 22 + 52;
/** 스킬 발동음 (종류별 — 연출은 'skill' 이벤트) */
const SKILL_SFX: Readonly<Record<SkillDef['kind'], SfxId>> = { freeze: 'skill_ice', spring: 'skill_hotspring', storm: 'skill_hairstorm' };
/**
 * 레벨업 카드 넘기는 소리: 창이 열리고 이만큼 뒤 첫 장, 그다음 장마다 LevelUpOverlay의 카드 등장 간격(CARD_STAGGER 0.07초)으로.
 * 고른 뒤 대기 레벨업이 남았으면 고른 카드 연출(LevelUpOverlay PICK_TIME 0.42초)이 끝나는 순간 다음 카드들이 들어온다
 */
const CARD_FLIP_START = 0.1;
const CARD_FLIP_STAGGER = 0.07;
const LEVEL_UP_NEXT_DEAL = 0.42;
/** 이벤트 묶음 안에서 한 번만 연출할 것(치유병 고리·젤리 방울) / 코일 두 번째 줄기 판정용 연쇄 도착점 기록 칸 수 */
const BATCH_IDS = 16;
const BATCH_POINTS = 24;
/** 레벨업 결과 알림: 화면 아래쪽(카드 밑, 하단 바 위)에 — 고르는 순간 바로 (전투가 멈춘 동안 글자를 굽는다). 한 번에 둘이면 이 간격(초)으로 */
const LEVEL_UP_TOAST_BOTTOM = 120;
const LEVEL_UP_TOAST_GAP = 0.3;
/**
 * 스테이지 끝 레벨업을 다 고른 뒤 클리어 화면까지 기다리는 시간(초) — 결과 알림('{이름} → 가방 (x, y)' 등)을 읽을 수 있게.
 * 없으면 창이 사라지는 0.2초 뒤 바로 화면이 바뀌어 고르는 순간 뜬 알림이 0.6초 만에 잘렸다 (Toast는 약 1.6초)
 */
const LEVEL_UP_END_HOLD = 1.1;
const LEVEL_UP_KEYS = [
  ['Digit1', 'Numpad1'],
  ['Digit2', 'Numpad2'],
  ['Digit3', 'Numpad3'],
] as const;

export class CombatScene extends Scene {
  readonly sceneName = 'CombatScene';

  private readonly ready: boolean;
  private readonly data!: GameData;
  private readonly run!: RunState;
  private readonly stage!: StageDef;
  private readonly sim!: CombatSim;

  // ── 레이어 (아래 → 위) ──
  private readonly catcher = new Graphics();
  private readonly field!: FieldView;
  private readonly frame = new FrameView();
  private readonly fieldUi = new Container();
  private readonly playerLayer = new Container();
  private readonly weaponBar = new WeaponBar();
  private readonly overlayLayer = new Container();
  private readonly hud!: Hud;
  private readonly flyers!: Flyers;
  private readonly banner = new Banner();
  private readonly vignette = new Graphics();
  private readonly toastLayer = new Container();
  /**
   * 인트로 동안 미리 그리기 (프레임당 하나씩): 배너·콤보 글자, 적 덮개 실루엣. 바탕(catcher) 아래라 보이지 않는다.
   * pixi 8은 글자 텍스처를 (글자 + TextStyle 인스턴스 + 해상도)로 공유하므로 Banner·ComboLabel은 스타일 인스턴스를
   * 같이 쓰고, 미리 그린 글자는 지우지 않고 아주 작게(WARM_TEXT_SCALE) 계속 그려 둔다 — 지우면 텍스처가 바로 반납되고,
   * 안 그려 두면 렌더러 GC(60초 넘게 안 그려진 것을 치움)가 치운다. 예전엔 둘 다 안 돼서 배너가 뜰 때마다 다시
   * 래스터화했다(측정: 보스 등장 배너 프레임 17 ms → 2 ms @ CPU 4배 감속). 씬과 함께 파괴된다.
   */
  private readonly warmLayer = new Container();
  private readonly warmQueue: (() => Text[])[] = [];

  private readonly enemies!: EnemyLayer;
  private readonly projectiles!: ProjectileLayer;
  private readonly fx!: Effects;
  private readonly combo!: ComboLabel;
  /** 방패병 '막음!' 꼬리표 */
  private readonly blockTags!: FloatTags;
  /** 방패병 id → 마지막 '막음!' 시각(sim 초) — 같은 방패에 공이 몰려도 꼬리표는 BLOCK_TAG_COOLDOWN에 하나 */
  private readonly blockTagAt = new Map<number, number>();
  /** 액티브 스킬의 계속되는 연출 (온천 기운 원·폭풍 소용돌이). 스킬이 없으면 null */
  private readonly skillFx: SkillFx | null = null;
  /** 직전 프레임 sim.skill.ready (게이지가 가득 차는 순간 소리) */
  private skillWasReady = false;
  /** 이벤트 묶음 안 기록 (handleEvents 시작에 비움): 연출한 치유병·젤리 id, 연쇄 도착점(코일 두 번째 줄기), 폭탄 연쇄 순서 */
  private readonly healSrc = new Int32Array(BATCH_IDS);
  private healSrcN = 0;
  private readonly splatSrc = new Int32Array(BATCH_IDS);
  private splatSrcN = 0;
  private readonly chainPts = new Float64Array(BATCH_POINTS * 2);
  private chainPtN = 0;
  private bombIdx = 0;
  private readonly player!: PlayerView;
  private readonly aimGuide!: AimGuide;
  /** 첫 스테이지 조작 안내 (첫 탭 조준 후 사라지면 null) */
  private tutorial: TutorialCallout | null = null;
  private readonly bossBar: BossBar | null = null;
  private readonly boss: EnemyEntity | null = null;
  /** 보스전 데이터·연출 (stage.boss가 있을 때만) */
  private readonly bossDef: BossDef | null = null;
  private readonly bossFx: BossFx | null = null;
  /** 보스 테스트 런: 보상·저장 없음, 끝나면 보스 결과 화면 */
  private readonly bossTest: boolean = false;
  /** 화면 번쩍임 (배너 아래): 페이즈 전환·보스 처치(흰색), 스킬 발동(종류 색) — screenFlash */
  private readonly flash = new Sprite(Texture.WHITE);
  private flashT = 0;
  private flashDur = PHASE_FLASH_TIME;
  private flashMax = PHASE_FLASH_ALPHA;
  /** 같은 묶음의 소환 연기는 한 번만 (sfx 시계 기준 마지막 연기 시각) */
  private lastSummonPuff = -Infinity;

  // ── 상태 ──
  private phase: CombatPhase = 'intro';
  private introT = INTRO_TIME;
  private acc = 0;
  private speed = 1;
  /** onEnter에서 만든다 (진입하지 못하고 버려진 씬이 window 리스너를 남기지 않게) */
  private keyboard: Keyboard | null = null;
  /** 현재 조준각 (clamp 끝난 값, 필드 좌표 atan2). 매 스텝 input.aimAngle로 sim에 간다 */
  private aimAngle = AIM_START;
  private readonly input: CombatInput = { targetX: null, targetY: null, aimAngle: AIM_START };
  /** 조준 가이드가 쓰는 공 반경 (가장 자주 쏘는 무기) */
  private guideRadius = AIM_GUIDE_DEFAULT_RADIUS;
  /** 눌려 있는 포인터들 (pointerId → 상태) */
  private readonly pointers = new Map<number, PointerTrack>();
  /** 이동 드래그 중인 포인터 (한 번에 하나) */
  private dragId: number | null = null;
  private readonly dragStart = new Point();
  /** 드래그 기준 목표: 드래그가 시작될 때의 이동 목표(아직 걸어가는 중이면 그 목표, 섰으면 캐릭터 위치) */
  private dragPlayerX = 0;
  private dragPlayerY = 0;
  private readonly tmp = new Point();
  private kbActive = false;
  /** 하단 힌트: 탭 조준과 드래그 이동을 한 번씩 해보면 숨긴다 */
  private learnedAim = false;
  private learnedMove = false;
  private overlay: BagOverlay | null = null;
  private pendingClose = false;
  /** 레벨업 3지선다 창 (열려 있으면 전투 정지). 대기 레벨업이 생기면 다음 프레임에 연다 (maybeOpenLevelUp) */
  private levelUp: LevelUpOverlay | null = null;
  /** 레벨업 창이 닫히면 할 일 (스테이지 끝에 남은 레벨업 → 클리어 화면으로) */
  private levelUpDone: (() => void) | null = null;
  private readonly xpBar: XpBar | null = null;
  private xpDirty = true;
  /** 액티브 스킬 버튼 (캐릭터 스킬이 없으면 null) */
  private readonly skillBtn: SkillButton | null = null;
  private readonly timers: Timer[] = [];
  private ended = false;
  private leaving = false;
  private exited = false;
  /** 화면 흔들림 트라우마 (0..1, 흔들림 = 트라우마² × SHAKE_MAX_PX) */
  private trauma = 0;
  private shakeClock = 0;
  /** 히트스톱 남은 시간 (시뮬레이션 + 필드 연출 정지) */
  private hitStop = 0;
  private vignetteT = 0;
  /** 피격 분류용 재사용 객체 */
  private readonly hitTmp: HitInfo = { edge: false, nx: 0, ny: -1, cx: 0, cy: 0, size: 0 };
  /** 이벤트 묶음 안에서 직전 폭발 중심 / 직전 연쇄 (휘말린 적 hit의 밀림 방향·종류 판정) */
  private readonly blast = { active: false, x: 0, y: 0, chainX: NaN, chainY: NaN, chainFromX: 0, chainFromY: 0 };
  private bossAnnounced = false;
  /** 배너 기본 위치(화면 y) — 페이즈 배너만 보스 몸 위로 올린다 */
  private bannerY = 0;
  /** 인트로에서 이미 보스 배너·소리를 냈다 (보스 테스트) — 보스가 보일 때 바만 띄운다 */
  private bossAnnouncedIntro = false;
  private newItemAlert = false;

  // ── 효과음 (sfxMap.ts 수치) ──
  /** 무기 uid → 발사음 (가방을 닫을 때 다시 만든다) */
  private readonly fireSfx = new Map<number, SfxId>();
  /** 이 피해 이상이면 묵직한 타격음 (HEAVY_HIT_DAMAGE × 스테이지 HP 배수) */
  private heavyHit = HEAVY_HIT_DAMAGE;
  /** 효과음용 시계(초, 숨김·가방 중에도 흐름) */
  private sfxClock = 0;
  private dangerOn = false;
  private lastDangerAt = -Infinity;
  private coinStreak = 0;
  private lastCoinAt = -Infinity;
  private vp: Viewport | null = null;
  private hudY = 0;
  private fieldY = 0;

  // ── 이번 스테이지 기록 ──
  /** 적중(hit 이벤트) 통계 — debugState용 (틈 쏘기 플레이테스트가 읽는다) */
  private hitCount = 0;
  private behindHits = 0;
  private topHits = 0;
  private kills = 0;
  /** 보스 테스트 결과용: 보스에게 실제로 깎은 HP 합, 보스 윗면 직접 적중(백어택), 처치한 졸개 */
  private bossDamage = 0;
  private bossTopHits = 0;
  private minionKills = 0;
  private goldEarned = 0;
  private readonly drops: { defId: string; tier: Tier }[] = [];

  constructor() {
    super();
    const run = game?.run ?? null;
    this.ready = run !== null;
    this.warmLayer.eventMode = 'none';
    this.addChild(this.warmLayer, this.catcher);
    if (!run) return;

    const data = game.data;
    const stage = currentStage(data, run);
    const loadout = runLoadout(data, run);
    const renderer = game.gameApp.app.renderer;
    const fx = fxTextures(renderer);
    ensureNumberFont();

    this.data = data;
    this.run = run;
    this.stage = stage;
    this.bossTest = isBossTestRun(run);
    this.bossDef = stage.boss ? (data.bosses[stage.boss] ?? null) : null;
    const skill = runSkill(data, run);
    this.sim = new CombatSim({
      stage,
      stageIndex: run.stageIndex,
      enemies: data.enemies,
      bosses: data.bosses,
      loadout,
      player: runPlayerStats(data, run),
      hp: run.hp,
      seed: combatSeed(run),
      skill,
    });

    const atlas = fxAtlas(renderer, TRAIL_TAPER);
    this.field = new FieldView(renderer, stage.background);
    // 피해 → 이펙트 크기 환산: 스테이지 HP 배수만큼 커지는 숫자를 같은 느낌의 크기로
    this.fx = new Effects(atlas, combatSeed(run) ^ 0x9e37, this.field.fxLayer, this.field.topLayer, 1 / Math.max(1, stage.hpMul));
    this.combo = new ComboLabel();
    this.blockTags = new FloatTags(T.combat.blocked, BLOCK_TAG_KEY, BLOCK_TAG_FONT, BLOCK_TAG_COLOR, MAX_FLOAT_TAGS, BLOCK_TAG_DRIFT);
    this.field.topLayer.addChild(this.blockTags, this.combo);
    this.enemies = new EnemyLayer(data.enemies, renderer, this.fx, fx.iceBlock);
    this.field.enemyLayer.addChild(this.enemies);
    if (this.bossDef) {
      this.bossFx = new BossFx(renderer, fx, this.fx, this.enemies, this.field.hazardLayer, this.field.hazardTopLayer);
    }
    this.projectiles = new ProjectileLayer(
      this.field.projectileLayer,
      this.field.trailLayer,
      this.field.shotLayer,
      fx.soft,
      atlas.trail,
      // 수명 상한(6초, 분열 자식 2.5초)으로 공중에서 사라지는 공은 작은 연기로 '퐁'
      (x, y, r) => this.fx.fizzle(x, y, r * 2),
    );
    this.player = new PlayerView(runCharacter(data, run).sprite, fx.shadow);
    // 조준 가이드는 캐릭터 아래(발사점 근처 점이 몸에 가려지게), 안내 말풍선은 위
    this.aimGuide = new AimGuide(fx);
    this.guideRadius = guideRadius(loadout);
    this.playerLayer.addChild(this.aimGuide, this.player);
    // 스킬의 계속되는 연출(온천 기운 원·폭풍 소용돌이)은 캐릭터·조준 가이드 아래
    if (skill) {
      this.skillFx = new SkillFx(skill, fx, this.fx);
      this.playerLayer.addChildAt(this.skillFx, 0);
    }
    if (run.stageIndex === 0 && !this.bossTest) {
      this.tutorial = new TutorialCallout(T.combat.aimTutorial);
      this.playerLayer.addChild(this.tutorial);
    }
    this.playerLayer.eventMode = 'none';
    this.fieldUi.eventMode = 'none';

    const boss = this.sim.enemies.find((e) => e.boss) ?? null;
    if (boss) {
      this.boss = boss;
      this.bossBar = new BossBar(data.enemies[boss.defId]?.name ?? '', this.bossDef ? this.bossDef.phases.map((p) => p.hpFrac) : []);
      // 등장 전까지는 미리 그리기 층(바탕 아래, 안 보임)에서 계속 그려 둔다 — 처음 보일 때 이름 글자·게이지를 만드느라
      // 끊기지 않게 (측정: 첫 표시 프레임 렌더 12.5 ms @ CPU 4배 감속). 숨겨 두면 렌더러 GC(60초 미사용)가 도로 치운다
      this.bossBar.visible = true;
      this.warmLayer.addChild(this.bossBar);
    }

    this.hud = new Hud(fx.soft, () => this.toggleBag());
    if (this.bossTest) {
      // 보스 테스트: 스테이지 번호 대신 모드 이름, 골드는 쓰지 않으므로 숨김
      this.hud.setStageText(T.combat.bossTest, stage.name);
      this.hud.setGoldVisible(false);
    } else this.hud.setStage(run.stageIndex + 1, stage.name);
    this.hud.setStash(run.bag.stash.length);
    this.hud.setGold(run.gold);
    this.hud.setHp(this.sim.player.hp, this.sim.player.maxHp);
    this.hud.setProgress(0);
    // 레벨·경험치 막대 (HUD 안, 골드 오른쪽)
    this.xpBar = new XpBar(fx.soft);
    this.xpBar.position.set(XP_BAR_X, XP_BAR_Y);
    this.hud.addChild(this.xpBar);
    this.refreshXp();
    // 액티브 스킬 버튼 (하단 바 오른쪽 — 제자리 탭 또는 Space). 하단 바는 이동 드래그 패드라 버튼에서 시작한 드래그는 이동이다
    if (skill) {
      const btn = new SkillButton(skill, fx.soft);
      btn.on('pointerdown', this.onSkillDown);
      btn.on('pointerup', this.onSkillUp);
      btn.on('pointerupoutside', this.onSkillUp);
      btn.on('pointercancel', this.onPointerAbort);
      this.skillBtn = btn;
    }
    this.flyers = new Flyers({
      onCoinArrive: () => {
        // 표시 골드는 매 프레임 (run.gold - 날아가는 중) 으로 맞춘다. 소리만: 연달아 도착하면 음이 오른다
        this.coinSfx();
      },
      onItemArrive: () => {
        this.newItemAlert = true;
        this.hud.bumpBag();
        this.hud.setStash(this.run.bag.stash.length);
        this.updateBagAlert();
      },
    });
    this.weaponBar.rebuild(loadout, data.items);
    this.rebuildFireSfx(loadout);
    this.rebuildProjStyles(loadout);
    this.heavyHit = HEAVY_HIT_DAMAGE * Math.max(1, stage.hpMul);

    this.vignette.eventMode = 'none';
    this.vignette.alpha = 0;
    this.flash.eventMode = 'none';
    this.flash.alpha = 0;
    this.flash.visible = false;
    this.toastLayer.eventMode = 'none';

    this.addChild(
      this.field,
      this.frame,
      this.fieldUi,
      this.playerLayer,
      this.weaponBar,
      ...(this.skillBtn ? [this.skillBtn] : []),
      this.overlayLayer,
      this.hud,
      this.flyers,
      this.flash,
      this.banner,
      this.vignette,
      this.toastLayer,
    );

    // 입력: 화면 전체를 덮는 바탕이 탭(조준)·드래그(이동)를 받는다 (HUD 버튼·오버레이는 그 위라서 먼저 받음)
    this.catcher.eventMode = 'static';
    this.catcher.on('pointerdown', this.onPointerDown);
    this.catcher.on('globalpointermove', this.onPointerMove);
    this.catcher.on('pointerup', this.onPointerUp);
    this.catcher.on('pointerupoutside', this.onPointerAbort);
    this.catcher.on('pointercancel', this.onPointerAbort);

    this.updateBagAlert();

    // 전투 중·승패 순간에 처음 뜨는 배너 글자를 인트로 동안 미리 래스터화 (Banner.warmupTexts 참고)
    const warm = (kind: Parameters<typeof Banner.warmupTexts>[0], title: string, sub: string | null): void => {
      this.warmQueue.push(() => Banner.warmupTexts(kind, title, sub));
    };
    if (boss) warm('boss', T.combat.bossIncoming, data.enemies[boss.defId]?.name ?? null);
    if (this.bossDef) {
      for (let p = 1; p < this.bossDef.phases.length; p++) warm('phase', T.combat.phase(p + 1), phaseSub(p));
    }
    warm('clear', this.bossTest ? T.combat.bossDefeated : T.combat.cleared, null);
    warm('defeat', T.combat.defeat, T.combat.breach);
    warm('defeat', T.combat.defeat, T.combat.knockedOut);
    warm('defeat', T.combat.defeat, T.combat.crushed);
    this.warmQueue.push(() => ComboLabel.warmupTexts());
    this.warmQueue.push(() => [FloatTags.warmupText(T.combat.blocked, BLOCK_TAG_KEY, BLOCK_TAG_FONT, BLOCK_TAG_COLOR)]);
    // 적 덮개 실루엣(피격 번쩍임·냉기)도 인트로 동안 한 프레임에 하나씩 미리 굽는다 (처음 보이는 적 종류에서 끊기지 않게)
    const keys = new Set<string>();
    // 투사체·분열 자식·적 탄 그림 (아래에서 GPU에 미리 올린다)
    const shotKeys = new Set<string>();
    for (const l of loadout) {
      shotKeys.add(l.sprite);
      if (l.split) shotKeys.add(l.split.sprite);
    }
    for (const row of stage.rows) {
      for (const ch of row) {
        const id = stage.legend[ch];
        const def = id ? data.enemies[id] : undefined;
        if (def) {
          keys.add(def.sprite);
          if (def.attack) shotKeys.add(def.attack.sprite);
        }
      }
    }
    // 보스전: 보스·졸개 그림, 졸개 탄과 보스 행동 탄·위험 지역 그림 (stage.rows가 비어 있어 위에서 못 모은다)
    if (this.bossDef) {
      const bd = this.bossDef;
      const addEnemy = (id: string): void => {
        const def = data.enemies[id];
        if (!def) return;
        keys.add(def.sprite);
        if (def.attack) shotKeys.add(def.attack.sprite);
      };
      addEnemy(bd.enemy);
      for (const ph of bd.phases) for (const m of ph.minions) addEnemy(m.enemy);
      for (const a of bd.actions) {
        if (a.kind === 'volley') shotKeys.add(a.volley.sprite);
        else if (a.kind === 'ring') shotKeys.add(a.ring.sprite);
        else if (a.kind === 'slam') shotKeys.add(a.slam.sprite);
        else if (a.kind === 'marbles') shotKeys.add(a.marbles.sprite);
      }
    }
    for (const key of keys) {
      this.warmQueue.push(() => {
        this.enemies.prepare(key);
        return [];
      });
    }
    // 첫 발사·첫 타격 프레임 몰림 방지 (측정: 첫 발사 프레임 22 ms — 뷰 15개 생성 + 텍스처 첫 업로드, 첫 번개 13 ms,
    // 첫 폭발 7 ms @ CPU 4배 감속): 투사체·적 탄 그림과 이펙트 아틀라스를 한 번 그려 GPU에 올리고(작게 남겨 둠),
    // 투사체 뷰 풀을 채우고, 이펙트 연출을 화면 밖에서 한 번씩 돌린다
    this.warmQueue.push(() => {
      for (const key of shotKeys) this.warmLayer.addChild(warmSprite(tex(key)));
      this.warmLayer.addChild(warmSprite(atlas.impact), warmSprite(fx.soft));
      return [];
    });
    this.warmQueue.push(() => {
      this.projectiles.prewarm(PREWARM_PROJ_VIEWS, PREWARM_SHOT_VIEWS);
      return [];
    });
    this.warmQueue.push(() => {
      this.fx.prewarm();
      if (this.bossDef) this.fx.prewarmBoss();
      if (skill) this.fx.prewarmSkill(skill.kind);
      return [];
    });
  }

  // ── Scene 수명주기 ──────────────────────────────────────────

  override onEnter(): void {
    if (!this.ready) return;
    window.addEventListener('keydown', this.onRawKey);
    // PixiJS는 네이티브 pointercancel을 넘겨주지 않는다 — 시스템 제스처 등으로 끊긴 드래그가 남지 않게
    window.addEventListener('pointercancel', this.onNativeCancel);
    window.addEventListener('blur', this.onNativeCancel);
    window.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('visibilitychange', this.onVisibility);
    const kb = (this.keyboard = new Keyboard());
    for (const code of ['KeyB', 'Escape', 'Tab']) kb.onPress(code, () => this.toggleBag());
    // 액티브 스킬 (버튼과 같은 경로) / 레벨업 카드 1·2·3
    kb.onPress('Space', () => this.tryActivateSkill());
    LEVEL_UP_KEYS.forEach((codes, i) => {
      for (const code of codes) kb.onPress(code, () => void this.levelUp?.pick(i));
    });
    if (this.bossTest) {
      // 보스 테스트: 인트로부터 보스 배너 (보스는 인트로가 끝나면 위에서 내려온다)
      this.bossAnnouncedIntro = true;
      this.showBanner('boss', T.combat.bossIncoming, this.stage.name, INTRO_TIME + 0.9);
      sfx.play('boss_appear');
    } else {
      this.showBanner('intro', T.combat.stage(this.run.stageIndex + 1), this.stage.name, INTRO_TIME + 0.15);
      sfx.play('stage_start');
    }
  }

  override onExit(): void {
    this.exited = true;
    this.keyboard?.dispose();
    this.keyboard = null;
    window.removeEventListener('keydown', this.onRawKey);
    window.removeEventListener('pointercancel', this.onNativeCancel);
    window.removeEventListener('blur', this.onNativeCancel);
    window.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.catcher.removeAllListeners();
    this.pointers.clear();
    this.dragId = null;
    this.timers.length = 0;
    this.warmQueue.length = 0;
    this.overlay = null;
    this.levelUp = null;
    this.levelUpDone = null;
    this.bossFx?.destroy();
  }

  /**
   * pixi v8의 Graphics.destroy({ children: true })는 자기 GraphicsContext(와 렌더러 쪽 GPU 지오메트리·버퍼)를 남긴다 —
   * 렌더러 GC가 60초 넘게 안 쓰인 것을 30초마다 치울 때까지. 측정: 전투 6번 뒤 상점 화면에 그래픽 컨텍스트 403개 /
   * GL 버퍼 378개가 남아 있었다(전투 한 번에 약 80개씩). 이 씬의 Graphics는 모두 자기 컨텍스트를 쓰므로(공유 없음) 같이 지운다.
   * (텍스처는 공용 에셋이라 지우지 않는다)
   */
  override destroy(options?: DestroyOptions): void {
    super.destroy({ ...(typeof options === 'object' ? options : {}), children: true, context: true });
  }

  override layout(vp: Viewport): void {
    this.vp = vp;
    this.catcher.clear().rect(0, 0, vp.width, vp.height).fill(UI_COLORS.bg);
    this.catcher.hitArea = new Rectangle(-vp.width, -vp.height, vp.width * 3, vp.height * 3);
    if (!this.ready) return;

    // 남는 높이: 일부는 위 여백, 대부분은 하단 바
    const extra = Math.max(0, vp.height - vp.safeTop - vp.safeBottom - (HUD_H + FIELD_H + BOTTOM_BAR_MIN_H));
    const topPad = Math.min(TOP_PAD_MAX, Math.round(extra * TOP_PAD_RATIO));
    this.hudY = vp.safeTop + topPad;
    this.fieldY = this.hudY + HUD_H;
    const barY = this.fieldY + FIELD_H;
    const barH = Math.max(0, vp.height - vp.safeBottom - barY);

    this.field.position.set(FIELD_X, this.fieldY);
    this.playerLayer.position.set(FIELD_X, this.fieldY);
    this.fieldUi.position.set(FIELD_X, this.fieldY);
    this.frame.layout(this.fieldY, vp.height);
    this.weaponBar.position.set(0, barY);
    if (this.skillBtn) {
      // 스킬 버튼: 하단 바 오른쪽, 무기 슬롯 줄 가운데 높이 — 무기 슬롯은 남은 폭 가운데로
      this.weaponBar.setRightInset(SKILL_SIDE + SKILL_BUTTON_R * 2 + SKILL_GAP);
      this.skillBtn.position.set(DESIGN_W - SKILL_SIDE - SKILL_BUTTON_R, barY + SKILL_CENTER_Y);
      this.skillBtn.setLabelVisible(barH >= SKILL_CENTER_Y + SKILL_BUTTON_R + this.skillBtn.labelHeight + 6);
    }
    this.weaponBar.setHeight(barH);
    this.hud.position.set(0, this.hudY);
    this.hud.setTopExtend(this.hudY);
    this.bannerY = this.fieldY + FIELD_H * BANNER_FIELD_Y;
    this.banner.position.set(0, this.bannerY);
    this.drawVignette(vp);
    this.flash.width = vp.width;
    this.flash.height = vp.height;
    this.overlay?.layout(vp, this.fieldY);
    this.levelUp?.layout(vp, this.fieldY);
  }

  override update(dt: number): void {
    if (!this.ready) {
      if (!this.leaving) {
        this.leaving = true;
        game?.toTitle();
      }
      return;
    }
    if (this.exited) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    this.sfxClock += dt;

    if (this.pendingClose) this.closeBagNow();
    this.stepWarmup();
    this.runTimers(dt);
    this.maybeOpenLevelUp();

    if (this.levelUp) {
      // 레벨업 고르는 중: 전투·필드 연출 정지 (가방 오버레이와 같다)
      this.levelUp.update(dt);
    } else if (!this.overlay) {
      if (this.hitStop > 0) {
        // 히트스톱: 시뮬레이션과 필드 연출을 잠깐 멈춘다 (흔들림은 계속 — 멈춘 장면이 떨린다)
        this.hitStop = Math.max(0, this.hitStop - dt);
      } else {
        if (this.phase === 'intro') {
          this.introT -= dt;
          if (this.introT <= 0) this.phase = 'fight';
        }
        if (!this.ended) this.readAimKeys(dt);
        if (this.phase === 'fight') this.stepSim(dt);
        this.syncWorld(dt);
      }
      this.updateShake(dt);
    } else {
      this.overlay.update(dt);
    }

    this.hud.setGold(Math.max(0, this.run.gold - this.flyers.pendingGold()));
    this.hud.update(dt);
    if (this.xpDirty) this.refreshXp();
    this.xpBar?.update(dt);
    this.skillBtn?.sync(this.sim.skill, this.skillUsable(), dt);
    // 게이지가 가득 차는 순간 '반짝' (버튼은 SkillButton이 톡 튄다)
    const skillReady = this.sim.skill?.ready === true;
    if (skillReady && !this.skillWasReady && !this.ended) sfx.play('skill_ready');
    this.skillWasReady = skillReady;
    this.flyers.update(dt);
    this.banner.update(dt);
    this.updateVignette(dt);
    this.updateFlash(dt);
  }

  // ── 디버그 (window.__game.debug) ────────────────────────────

  debugWin(): void {
    if (!this.ready || this.ended) return;
    this.closeBagNow();
    // 고르던 레벨업은 고르지 않은 채로 (런에 남아 스테이지 끝에 다시 뜬다)
    this.closeLevelUp();
    this.phase = 'fight';
    this.sim.debugKillAll();
    this.handleEvents(this.sim.drainEvents());
  }

  debugLose(): void {
    if (!this.ready || this.ended) return;
    this.closeBagNow();
    this.closeLevelUp();
    this.phase = 'fight';
    this.sim.debugLose();
    this.handleEvents(this.sim.drainEvents());
  }

  /** 시뮬레이션 배속 (디버그). 프레임당 스텝 상한도 배속만큼 늘어난다 */
  setSpeed(mul: number): void {
    if (!Number.isFinite(mul) || mul <= 0) return;
    this.speed = Math.min(MAX_SPEED_MUL, mul);
  }

  /** 디버그(측정 도구): 스킬 게이지를 frac(0..1)만큼 채운다 — 스킬 버튼·Space 검사용 (sim.debugFillSkill). 스킬이 없으면 false */
  debugFillSkill(frac = 1): boolean {
    if (!this.ready) return false;
    return this.sim.debugFillSkill(frac);
  }

  /** 디버그(측정 도구): 경험치 n — 레벨이 오르면 실제 처치와 같은 경로로 레벨업 창이 뜬다. 오른 레벨 수 */
  debugGrantXp(n: number): number {
    if (!this.ready) return 0;
    const gained = grantXp(this.run, n);
    this.xpDirty = true;
    return gained;
  }

  /** 디버그(측정 도구): 열린 레벨업 창의 i번째 카드 고르기 (탭·키 1/2/3과 같은 경로). 못 고르면 false */
  debugPickLevelUp(index: number): boolean {
    return this.levelUp?.pick(index) ?? false;
  }

  /** 테스트 도구용 읽기 전용 스냅샷 (smoke.mjs · interaction-check.mjs). 런이 없으면 null */
  debugState(): {
    playerX: number;
    playerY: number;
    /** 플레이어 속도(px/s)·최고 속도와 지금 걸어가는 목표(없으면 null) — 이동 감각 검사용 */
    playerVx: number;
    playerVy: number;
    moveSpeed: number;
    targetX: number | null;
    targetY: number | null;
    hp: number;
    maxHp: number;
    status: CombatStatus;
    /** 졌으면 사유 (hp / breach / contact), 아니면 null */
    lostReason: LostReason | null;
    phase: CombatPhase;
    time: number;
    kills: number;
    totalEnemies: number;
    bagOpen: boolean;
    speed: number;
    /** 전투에 장착된 무기 uid (가방 읽기 순서) */
    weaponUids: number[];
    /** 현재 조준각 (라디안, 필드 좌표 atan2: -π/2 = 바로 위) */
    aimAngle: number;
    /** 이동 드래그 중인 포인터가 있는가 / 눌린 포인터 수 */
    dragging: boolean;
    pointers: number;
    /** 갓 쏜(나이 ≤ RECENT_SHOT_AGE) 투사체들 — 조준 방향 확인용 */
    recentShots: { id: number; weaponUid: number; x: number; y: number; vx: number; vy: number; age: number }[];
    /**
     * 이번 전투의 적중 수(hit 이벤트 — 화상·연쇄·폭발 포함). behindHits = 적중점이 맨 앞 웨이브(가장 아래 적부터
     * 빈 줄 없이 이어진 줄들)의 뒤쪽 끝 이상, topHits = 공이 적보다 위에서 그 적의 윗면을 때림(웨이브 뒤·위로 들어간 공)
     */
    hits: number;
    behindHits: number;
    topHits: number;
    /** 맨 앞 웨이브의 뒤쪽 끝(필드 y, 아직 다 안 들어왔으면 음수)과 그 웨이브의 적 수. 적이 없으면 null / 0 */
    frontTop: number | null;
    frontCount: number;
    /** '백어택!' 콤보: 지금(끝났으면 0) / 이번 전투 최고 */
    combo: number;
    bestCombo: number;
    /** 연출 상태 (측정용): 살아있는 이펙트 파티클 수, 화면 흔들림 트라우마, 남은 히트스톱(초) */
    fxParticles: number;
    trauma: number;
    hitStop: number;
    /** 보스 테스트 런인가 / 보스전 상태 (보스전이 아니면 null) */
    bossTest: boolean;
    boss: {
      hp: number;
      maxHp: number;
      phase: number;
      phases: number;
      mode: string;
      action: string | null;
      invulnerable: boolean;
      minions: number;
      y: number;
      h: number;
    } | null;
    /** 보스 위험 지역 (예고·발동 중) */
    hazards: { id: number; kind: string; state: string; x: number; y: number; w: number; h: number; timer: number }[];
    /** 보스 테스트 결과용 기록: 보스에게 깎은 HP(이벤트 합), 보스 윗면 적중(백어택), 처치한 졸개 */
    bossDamage: number;
    backAttacks: number;
    minionKills: number;
    /** 레벨업: 런 레벨·경험치·고르지 않은 수, 창이 열렸나·카드를 받나·카드 수 */
    levelUp: { level: number; xp: number; need: number; pending: number; open: boolean; armed: boolean; choices: number };
    /** 액티브 스킬 (sim.skill 복사 + 버튼을 지금 누를 수 있나). 스킬이 없으면 null */
    skill: { id: string; kind: string; charge: number; ready: boolean; active: number; uses: number; usable: boolean } | null;
  } | null {
    if (!this.ready) return null;
    const sim = this.sim;
    const front = frontWave(sim.enemies);
    const recentShots: { id: number; weaponUid: number; x: number; y: number; vx: number; vy: number; age: number }[] = [];
    for (const p of sim.projectiles) {
      if (p.age <= RECENT_SHOT_AGE) recentShots.push({ id: p.id, weaponUid: p.weaponUid, x: p.x, y: p.y, vx: p.vx, vy: p.vy, age: p.age });
    }
    return {
      playerX: sim.player.x,
      playerY: sim.player.y,
      playerVx: sim.player.vx,
      playerVy: sim.player.vy,
      moveSpeed: runPlayerStats(this.data, this.run).moveSpeed,
      targetX: this.input.targetX,
      targetY: this.input.targetY,
      hp: sim.player.hp,
      maxHp: sim.player.maxHp,
      status: sim.status,
      lostReason: sim.lostReason,
      phase: this.phase,
      time: sim.time,
      kills: sim.killedEnemies,
      totalEnemies: sim.totalEnemies,
      bagOpen: this.overlay !== null,
      speed: this.speed,
      weaponUids: sim.weapons.map((w) => w.uid),
      aimAngle: this.aimAngle,
      dragging: this.dragId !== null,
      pointers: this.pointers.size,
      recentShots,
      hits: this.hitCount,
      behindHits: this.behindHits,
      topHits: this.topHits,
      frontTop: front?.top ?? null,
      frontCount: front?.count ?? 0,
      combo: this.combo.current,
      bestCombo: this.combo.bestCombo,
      fxParticles: this.fx.particleCount,
      trauma: this.trauma,
      hitStop: this.hitStop,
      bossTest: this.bossTest,
      boss:
        sim.boss && this.boss
          ? {
              hp: this.boss.hp,
              maxHp: this.boss.maxHp,
              phase: sim.boss.phase,
              phases: sim.boss.phases,
              mode: sim.boss.mode,
              action: sim.boss.action,
              invulnerable: sim.boss.invulnerable,
              minions: sim.boss.minions,
              y: this.boss.y,
              h: this.boss.h,
            }
          : null,
      hazards: sim.hazards.map((h) => ({ id: h.id, kind: h.kind, state: h.state, x: h.x, y: h.y, w: h.w, h: h.h, timer: h.timer })),
      bossDamage: this.bossDamage,
      backAttacks: this.bossTopHits,
      minionKills: this.minionKills,
      levelUp: {
        level: runLevel(this.run),
        xp: runXp(this.run),
        need: xpToNext(runLevel(this.run)),
        pending: pendingLevelUps(this.run),
        open: this.levelUp !== null,
        armed: this.levelUp?.armed ?? false,
        choices: this.levelUp?.choiceCount ?? 0,
      },
      skill: sim.skill
        ? {
            id: sim.skill.id,
            kind: sim.skill.kind,
            charge: sim.skill.charge,
            ready: sim.skill.ready,
            active: sim.skill.active,
            uses: sim.skill.uses,
            usable: this.skillUsable(),
          }
        : null,
    };
  }

  /** 외부(디버그 훅)에서 런 골드/보관함이 바뀌었을 때 */
  refresh(): void {
    if (!this.ready) return;
    this.hud.setStash(this.run.bag.stash.length);
    this.updateBagAlert();
    this.overlay?.refresh();
  }

  // ── 시뮬레이션 ──────────────────────────────────────────────

  private stepSim(dt: number): void {
    const sim = this.sim;
    this.acc += dt * this.speed;
    const maxSteps = MAX_STEPS_PER_FRAME * Math.max(1, Math.ceil(this.speed));
    let n = 0;
    while (this.acc >= SIM_DT && n < maxSteps && sim.status === 'running') {
      this.readKeyboard();
      sim.step(SIM_DT, this.input);
      this.handleEvents(sim.drainEvents());
      this.acc -= SIM_DT;
      n++;
      // 레벨이 올랐다: 여기서 멈추고 다음 프레임에 레벨업 창 (그 사이 전투가 더 흐르지 않게)
      if (this.levelUpWanted()) {
        this.acc = 0;
        break;
      }
    }
    // 밀린 시간은 버린다 (느린 기기에서 따라잡으려다 더 느려지지 않게)
    if (n >= maxSteps || sim.status !== 'running') this.acc = 0;
  }

  private handleEvents(events: readonly CombatEvent[]): void {
    /** 이번 묶음의 맨 앞 웨이브 (hit가 있을 때만 한 번 계산, 디버그 통계·백어택 판정용) */
    let front: FrontWave | null | undefined;
    // sim은 'explode' 바로 뒤에 휘말린 적들의 hit를, 'chain' 바로 뒤에 그 대상의 hit를 낸다 → 연출 분류에 쓴다
    const blast = this.blast;
    blast.active = false;
    blast.chainX = NaN;
    this.healSrcN = 0;
    this.splatSrcN = 0;
    this.chainPtN = 0;
    this.bombIdx = 0;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.type) {
        case 'fire':
          sfx.playAt(this.fireSfx.get(ev.weaponUid) ?? 'fire_hairball', panAt(ev.x));
          this.weaponBar.onFire(ev.weaponUid);
          this.player.onFire(this.aimAngle);
          this.fx.muzzle(ev.x, ev.y, this.aimAngle);
          blast.active = false;
          break;
        case 'hit': {
          this.hitCount++;
          const boss = this.boss;
          if (boss && ev.enemyId === boss.id) {
            this.bossDamage += ev.damage;
            // 보스 윗면 직접 적중 (양옆 통로로 넘어간 공의 백어택) — sim이 'hit'에 back을 단다
            if (ev.back) this.bossTopHits++;
          }
          // 틈 쏘기 통계 (debugState — tools/gap-playtest.mjs): 맨 앞 웨이브 뒤쪽 적중 / 윗변 적중 (콤보와는 따로)
          if (front === undefined) front = frontWave(this.sim.enemies);
          if (front) {
            if (ev.y <= front.top + ENEMY_INSET + 0.5) this.behindHits++;
            // 적중점 = 공 중심을 적 사각형에 clamp → 공이 적보다 위였으면 정확히 그 적의 윗변(모든 적이 같은 칸 격자)
            const d = (((ev.y - front.grid) % CELL) + CELL) % CELL;
            if (d < 0.01 || d > CELL - 0.01) this.topHits++;
          }
          this.hitFx(ev);
          // 백어택 콤보: sim이 백어택이라고 한 적중만 (윗면 직접 적중 — 화상·폭발·연쇄는 back이 없다).
          // 보스는 제외 — 보스 옆으로 넘어간 공이 천장과 보스 윗면 사이를 수명 내내 오가며 백어택이 끊기지 않아
          // 보스전 내내 "백어택 x200!" 글자가 보스 머리를 덮고 있었다 (보스 백어택 수는 bossTopHits로 따로 센다)
          if (ev.back && !this.ended && ev.enemyId !== this.boss?.id) {
            this.combo.hit(ev.x, ev.y);
            // 콤보가 이어질수록 반음씩 올라간다 (상한)
            sfx.playAt('combo', panAt(ev.x), COMBO_PITCH_STEP ** Math.min(COMBO_PITCH_MAX, this.combo.current - 1));
          }
          break;
        }
        case 'kill':
          this.onKill(ev);
          break;
        case 'explode':
          this.onExplode(ev);
          blast.active = true;
          blast.x = ev.x;
          blast.y = ev.y;
          break;
        case 'chain': {
          // 번개 코일의 두 번째 줄기: 이번 묶음에서 앞선 연쇄가 닿은 자리(첫 줄기 대상)에서 다시 튄다
          const pts = this.chainPts;
          let hop = false;
          for (let k = 0; k < this.chainPtN; k += 2) {
            if (pts[k] === ev.fromX && pts[k + 1] === ev.fromY) {
              hop = true;
              break;
            }
          }
          if (hop) {
            sfx.playAt('elem_zap', panAt(ev.toX), 1.25, 0.6);
            this.fx.chainHop(ev.fromX, ev.fromY, ev.toX, ev.toY);
          } else {
            sfx.playAt('elem_zap', panAt(ev.toX));
            this.fx.chain(ev.fromX, ev.fromY, ev.toX, ev.toY);
            if (this.chainPtN < pts.length) {
              pts[this.chainPtN++] = ev.toX;
              pts[this.chainPtN++] = ev.toY;
            }
          }
          blast.chainX = ev.toX;
          blast.chainY = ev.toY;
          blast.chainFromX = ev.fromX;
          blast.chainFromY = ev.fromY;
          break;
        }
        case 'blocked':
          this.onBlocked(ev);
          blast.active = false;
          break;
        case 'heal':
          this.onHeal(ev);
          blast.active = false;
          break;
        case 'enemySpawn':
          // 젤리 → 꼬마 젤리: 부모 자리에서 칸으로 톡 튀어나온다 (sim의 착지 유예 SUMMON_LAND_TIME과 같은 시간). 처치 묶음 안이라 blast는 그대로
          this.enemies.hop(ev.enemyId, ev.fromX, ev.fromY, SUMMON_HOP_TIME);
          if (this.batchOnce(this.splatSrc, this.splatSrcN, ev.parentId)) {
            if (this.splatSrcN < BATCH_IDS) this.splatSrc[this.splatSrcN++] = ev.parentId;
            this.fx.jellySplat(ev.fromX, ev.fromY);
            // 젤리 '철퍽' (생선 철썩을 높게)
            sfx.playAt('fire_fish', panAt(ev.fromX), 1.4, 0.75);
          }
          break;
        case 'shift':
          // RC카 출발 '부웅' (양말 휙을 낮게) — 미끄러지는 동안의 기울기·먼지는 EnemyLayer
          sfx.playAt('fire_sock', panAt(ev.fromX), 0.72, 0.45);
          blast.active = false;
          break;
        case 'burnSpread':
          // 전염 성냥: 불이 옆 적으로 옮겨붙음 (처치 묶음 안 — blast 그대로)
          this.fx.burnSpread(ev.fromX, ev.fromY, ev.x, ev.y);
          sfx.playAt('elem_fire', panAt(ev.x), 1.2, 0.55);
          break;
        case 'skill':
          this.onSkillCast(ev);
          blast.active = false;
          break;
        case 'freeze': {
          // 서리 파도가 닿는 순간 얼어붙는다 (플레이어에서 멀수록 늦게) — 얼음 상자·덮개는 EnemyLayer가 EnemyEntity.frozen으로
          const pl = this.sim.player;
          const d = Math.hypot(ev.x - pl.x, ev.y - pl.y);
          const size = this.enemies.hitInfo(ev.enemyId, ev.x, ev.y, this.hitTmp)?.size ?? CELL;
          this.fx.freezeHit(ev.x, ev.y, size, d / FROST_WAVE_SPEED, ev.resisted);
          blast.active = false;
          break;
        }
        case 'shotBlocked':
          // 온천 기운이 적 탄을 녹임 '치익'
          this.fx.dissolve(ev.x, ev.y);
          sfx.playAt('elem_fire', panAt(ev.x), 1.6, 0.35);
          blast.active = false;
          break;
        case 'split':
          sfx.playAt('split', panAt(ev.x));
          this.fx.splitPuff(ev.x, ev.y, ev.count);
          blast.active = false;
          break;
        case 'enemyShoot':
          this.enemyShotSfx(ev.enemyId, ev.x, ev.sprite);
          // 보스전(BossDef) 보스의 행동 탄은 BossFx 자세(실행 팝)가 맡는다 — 발마다 몸 전체가 튀지 않게 (st5 보스 로봇은 예전처럼)
          if (!(this.bossFx && ev.enemyId === this.boss?.id)) this.enemies.onAttack(ev.enemyId);
          blast.active = false;
          break;
        case 'bossPhase':
          this.onBossPhase(ev.phase, ev.roar);
          blast.active = false;
          break;
        case 'bossAction':
          this.bossFx?.onAction(ev.action, ev.windup);
          blast.active = false;
          break;
        case 'summon':
          this.onSummon(ev);
          blast.active = false;
          break;
        case 'hazardWarn':
          if (ev.kind === 'slam') sfx.playAt('slam_warn', panAt(ev.x));
          blast.active = false;
          break;
        case 'hazardImpact': {
          const v = this.bossFx?.onHazardImpact(ev.hazardId);
          if (ev.kind === 'slam') {
            sfx.playAt('slam_impact', panAt(ev.x));
            this.addTrauma(TRAUMA_SLAM);
          } else {
            sfx.playAt('marble_impact', panAt(ev.x));
            if (v) this.addTrauma(TRAUMA_MARBLE);
          }
          blast.active = false;
          break;
        }
        case 'playerHit':
          sfx.playAt('player_hurt', panAt(ev.x));
          this.player.onHit();
          this.fx.playerDamage(this.sim.player.x, this.sim.player.y, ev.damage);
          this.addTrauma(TRAUMA_PLAYER_HIT);
          this.hitStop = Math.max(this.hitStop, HITSTOP_PLAYER);
          this.vignetteT = VIGNETTE_TIME;
          blast.active = false;
          break;
        case 'won':
          this.onWon();
          break;
        case 'lost':
          this.onLost(ev.reason);
          break;
        case 'bounce':
          if (ev.wall) {
            this.fx.wallBounce(ev.x, ev.y, FIELD_W);
            sfx.playAt('bounce_wall', panAt(ev.x));
          } else if (ev.floor) {
            // 트램펄린: 바닥에서 '통!' (스프링 소리를 높고 작게)
            this.fx.trampoline(ev.x, FIELD_H);
            sfx.playAt('enemy_shoot_spring', panAt(ev.x), 1.25, 0.5);
          }
          blast.active = false;
          break;
      }
    }
  }

  /**
   * 적중 연출 + 피해 숫자. 적중점과 직전 이벤트로 종류를 나눈다:
   * 연쇄(직전 chain의 도착점) / 직접 타격(적 가장자리) / 폭발(직전 explode 뒤의 중심 적중) / 화상 틱(중심 + 불).
   * 직접 타격이면 true.
   */
  private hitFx(ev: Extract<CombatEvent, { type: 'hit' }>): boolean {
    // 숫자 모양: 백어택(진분홍·크게·별) / 장갑에 줄어든 적중(회색·작게) / 보통
    const style: NumStyle = ev.back ? NUM_BACK : ev.armor ? NUM_ARMOR : NUM_NORMAL;
    const info = this.enemies.hitInfo(ev.enemyId, ev.x, ev.y, this.hitTmp);
    if (!info) {
      this.fx.damageNumber(ev.enemyId, ev.x, ev.y, ev.damage, ev.element, false, style);
      return false;
    }
    const blast = this.blast;
    if (ev.element === 'lightning' && ev.x === blast.chainX && ev.y === blast.chainY) {
      this.fx.damageNumber(ev.enemyId, ev.x, ev.y, ev.damage, ev.element);
      this.pushEnemy(ev.enemyId, info.cx - blast.chainFromX, info.cy - blast.chainFromY, 0.55);
      this.fx.chainHit(ev.x, ev.y);
      return false;
    }
    if (info.edge) {
      // 직접 타격: 플라스틱 '통' (피해가 크면 묵직하게) + 속성이면 속성 소리를 겹친다
      const pan = panAt(ev.x);
      sfx.playAt(ev.damage >= this.heavyHit ? 'hit_heavy' : 'hit_toy', pan);
      if (ev.element) sfx.playAt(ELEMENT_HIT_SFX[ev.element], pan);
      // 장갑병: 쇠 '깡' (톱니 대포 대신 볼트 철컥을 높게) + 회색 작은 숫자 + 쇳빛 불꽃
      if (ev.armor) sfx.playAt('enemy_shoot_bolt', pan, 1.25, 0.7);
      this.fx.damageNumber(ev.enemyId, ev.x, ev.y, ev.damage, ev.element, false, style);
      // 맞은 면의 바깥 법선 = 공이 온 쪽 → 적은 반대로 밀리고, 반짝이는 공 쪽으로 튄다
      this.enemies.onHit(ev.enemyId, -info.nx, -info.ny, ev.armor ? 0.45 : 1);
      this.fx.impact(ev.x, ev.y, ev.damage, ev.element, info.nx, info.ny);
      if (ev.back) this.fx.backSpark(ev.x, ev.y);
      if (ev.armor) this.fx.armorSpark(ev.x, ev.y, info.nx, info.ny);
      return true;
    }
    if (blast.active) {
      this.fx.damageNumber(ev.enemyId, ev.x, ev.y, ev.damage, ev.element);
      this.pushEnemy(ev.enemyId, info.cx - blast.x, info.cy - blast.y, 0.8);
      this.fx.splashHit(ev.x, ev.y, ev.damage);
      return false;
    }
    if (ev.element === 'fire') {
      // 화상 틱: 작은 숫자로 (불타는 적마다 0.5초마다 뜨는 숫자가 HP 숫자를 덮지 않게)
      this.fx.damageNumber(ev.enemyId, ev.x, ev.y, ev.damage, ev.element, true);
      this.fx.burnTick(ev.x, ev.y);
      return false;
    }
    // 가장자리가 아닌 적중 (관통 중 등): 작게 — 관통하며 윗면을 친 백어택도 있다
    sfx.playAt('hit_toy', panAt(ev.x), 1.1, 0.6);
    this.fx.damageNumber(ev.enemyId, ev.x, ev.y, ev.damage, ev.element, false, style);
    this.enemies.onHit(ev.enemyId, 0, -1, 0.5);
    this.fx.splashHit(ev.x, ev.y, ev.damage);
    if (ev.back) this.fx.backSpark(ev.x, ev.y);
    return false;
  }

  /**
   * 'explode' 종류별 연출: 증기 주전자(하얀 김) / 폭죽 심지(작은 알록달록 팡 — 처치마다라 흔들림 없이) /
   * 폭탄병(큰 폭발 — 같은 묶음의 연쇄는 BOMB_CHAIN_STAGGER씩 늦게 '펑-펑-펑') / 투사체 폭발(예전 그대로)
   */
  private onExplode(ev: Extract<CombatEvent, { type: 'explode' }>): void {
    const pan = panAt(ev.x);
    if (ev.cause === 'steam') {
      this.fx.steam(ev.x, ev.y, ev.radius);
      sfx.playAt('elem_fire', pan, 0.8);
      this.addTrauma(TRAUMA_STEAM);
      return;
    }
    if (ev.cause === 'firecracker') {
      this.fx.firecracker(ev.x, ev.y, ev.radius);
      sfx.playAt('explode', pan, 1.6, 0.45);
      return;
    }
    if (ev.fromEnemy !== undefined) {
      const k = this.bombIdx++;
      const delay = k * BOMB_CHAIN_STAGGER;
      this.fx.bombBlast(ev.x, ev.y, ev.radius, delay);
      this.addTrauma(k === 0 ? TRAUMA_BOMB : TRAUMA_BOMB_CHAIN);
      // 연쇄는 소리도 차례로 (조금씩 높게). 폭탄 연쇄는 드물어 타이머(클로저) 몇 개는 괜찮다
      const rate = 0.85 + 0.05 * Math.min(6, k);
      if (k === 0) sfx.playAt('explode', pan, rate);
      else this.after(delay, () => sfx.playAt('explode', pan, rate));
      return;
    }
    sfx.playAt('explode', pan);
    this.fx.explosion(ev.x, ev.y, ev.radius, ev.element);
    this.addTrauma(Math.min(TRAUMA_EXPLODE_MAX, ev.radius * TRAUMA_PER_EXPLODE_PX));
  }

  /** 방패병 정면이 공을 막음: 쇳빛 불꽃 + 방패가 살짝 밀림 + '깡' + '막음!' (같은 방패는 BLOCK_TAG_COOLDOWN에 한 번) */
  private onBlocked(ev: Extract<CombatEvent, { type: 'blocked' }>): void {
    this.fx.blockSpark(ev.x, ev.y);
    this.enemies.onHit(ev.enemyId, 0, -1, 0.35);
    sfx.playAt('shield_block', panAt(ev.x));
    const now = this.sim.time;
    const last = this.blockTagAt.get(ev.enemyId);
    if (last === undefined || now - last >= BLOCK_TAG_COOLDOWN) {
      this.blockTagAt.set(ev.enemyId, now);
      this.blockTags.show(ev.x, ev.y + BLOCK_TAG_DY);
    }
  }

  /** 치유병이 회복: 치유병 둘레 초록 고리(묶음에 한 번 — 소리도) + 대상마다 날아가는 빛방울·더하기·'+N'·연두 번쩍임 */
  private onHeal(ev: Extract<CombatEvent, { type: 'heal' }>): void {
    if (this.batchOnce(this.healSrc, this.healSrcN, ev.sourceId)) {
      if (this.healSrcN < BATCH_IDS) this.healSrc[this.healSrcN++] = ev.sourceId;
      this.fx.healPulse(ev.fromX, ev.fromY, this.healRadius(ev.sourceId));
      sfx.playAt('heal_pulse', panAt(ev.fromX));
    }
    this.fx.healTarget(ev.x, ev.y, ev.fromX, ev.fromY);
    this.fx.healNumber(ev.x, ev.y, ev.amount);
    this.enemies.onHeal(ev.enemyId);
  }

  /** 치유병의 회복 반경 (EnemyDef.heal.radius — 고리 크기). 모르면 한 칸 반 */
  private healRadius(enemyId: number): number {
    const list = this.sim.enemies;
    for (let i = 0; i < list.length; i++) {
      if (list[i].id !== enemyId) continue;
      return this.data.enemies[list[i].defId]?.heal?.radius ?? CELL * 1.5;
    }
    return CELL * 1.5;
  }

  /** 이번 묶음에서 처음 보는 id인가 (arr[0..n)) */
  private batchOnce(arr: Int32Array, n: number, id: number): boolean {
    for (let i = 0; i < n; i++) if (arr[i] === id) return false;
    return true;
  }

  /**
   * 'skill' 발동 연출 (소리는 tryActivateSkill의 SKILL_SFX): 화면 번쩍임(종류 색) + 흔들림 +
   * 빙하기 = 서리 파도(뒤따르는 'freeze'들이 파도가 닿는 순간 얼어붙음) / 온천 = 따뜻한 고리·김·'+N'(기운 원은 SkillFx) /
   * 폭풍 = 휘몰아치는 털 구름(소용돌이는 SkillFx, 털뭉치는 'fire' weaponUid -1)
   */
  private onSkillCast(ev: Extract<CombatEvent, { type: 'skill' }>): void {
    this.addTrauma(TRAUMA_SKILL);
    switch (ev.kind) {
      case 'freeze':
        this.screenFlash(FREEZE_FLASH_COLOR, FREEZE_FLASH_ALPHA, FREEZE_FLASH_TIME);
        this.fx.frostWave(ev.x, ev.y - 20);
        break;
      case 'spring': {
        this.screenFlash(SPRING_FLASH_COLOR, SPRING_FLASH_ALPHA, SPRING_FLASH_TIME);
        const def = this.skillBtn?.def;
        this.fx.springBurst(ev.x, ev.y, def && def.kind === 'spring' ? def.spring.radius : CELL * 1.6);
        if (ev.heal && ev.heal > 0) this.fx.healNumber(ev.x, ev.y - 30, ev.heal, 1.25);
        break;
      }
      case 'storm':
        this.screenFlash(STORM_FLASH_COLOR, STORM_FLASH_ALPHA, STORM_FLASH_TIME);
        this.fx.stormBurst(ev.x, ev.y - 12);
        break;
    }
  }

  /** 화면 번쩍임 (배너 아래, 전체): color로 time초 동안 alpha에서 0으로 */
  private screenFlash(color: number, alpha: number, time: number): void {
    this.flash.tint = color;
    this.flashT = time;
    this.flashDur = time;
    this.flashMax = alpha;
  }

  /** (dx, dy) 쪽으로 밀기 (정규화, 0이면 위로) */
  private pushEnemy(enemyId: number, dx: number, dy: number, strength: number): void {
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) this.enemies.onHit(enemyId, 0, -1, strength);
    else this.enemies.onHit(enemyId, dx / len, dy / len, strength);
  }

  private addTrauma(v: number): void {
    this.trauma = Math.min(1, this.trauma + v);
  }

  /** 트라우마 흔들림 (필드와 플레이어만). 부드러운 잡음(엇갈린 주파수의 사인 합) — 매 프레임 무작위보다 덜 어지럽다 */
  private updateShake(dt: number): void {
    this.trauma = Math.max(0, this.trauma - SHAKE_DECAY * dt);
    this.shakeClock += dt;
    const amp = SHAKE_MAX_PX * this.trauma * this.trauma;
    let ox = 0;
    let oy = 0;
    if (amp > 0.05) {
      const t = this.shakeClock;
      ox = amp * (Math.sin(t * 61.3) * 0.6 + Math.sin(t * 97.1 + 1.7) * 0.4);
      oy = amp * (Math.sin(t * 73.7 + 0.5) * 0.6 + Math.sin(t * 89.3 + 2.9) * 0.4);
    }
    this.field.position.set(FIELD_X + ox, this.fieldY + oy);
    this.playerLayer.position.set(FIELD_X + ox, this.fieldY + oy);
  }

  private onKill(ev: Extract<CombatEvent, { type: 'kill' }>): void {
    const size = this.enemies.onKill(ev.enemyId);
    const x = clamp(ev.x, 0, FIELD_W);
    const y = clamp(ev.y, 0, FIELD_H);
    if (size > 0) {
      const def = this.data.enemies[ev.defId];
      const tier: 0 | 1 | 2 = ev.boss ? 2 : def && def.w * def.h > 1 ? 1 : 0;
      // 적이 부풀었다 하얘지는 '펑'(ENEMY_POP_TIME)이 끝나는 순간에 터진다
      this.fx.killBurst(ev.x, ev.y, size, tier, ENEMY_POP_TIME);
      sfx.playAt(tier === 2 ? 'boss_kill' : tier === 1 ? 'kill_elite' : 'kill_pop', panAt(x));
      if (tier === 2) {
        this.addTrauma(TRAUMA_BOSS_KILL);
        this.hitStop = Math.max(this.hitStop, HITSTOP_BOSS);
      } else if (tier === 1) {
        this.addTrauma(TRAUMA_ELITE_KILL);
        this.hitStop = Math.max(this.hitStop, HITSTOP_ELITE);
      }
    }
    if (ev.boss) {
      this.bossBar?.hide();
      this.bossFx?.onBossDead();
      if (this.bossDef) this.screenFlash(0xffffff, PHASE_FLASH_ALPHA, PHASE_FLASH_TIME);
    } else if (this.bossDef) this.minionKills++;

    // 경험치 (보스 테스트도 — 졸개로 오른다). sim은 적마다 'kill'을 정확히 한 번 낸다 (연쇄 처치도 중복 없음)
    grantKillXp(this.data, this.run, ev.defId);
    this.xpDirty = true;

    // 보스 테스트: 골드·드롭 없음 (런은 저장도 안 하고 버린다)
    if (this.bossTest) {
      this.kills++;
      return;
    }
    // 뒤통수 동전: 백어택으로 처치하면 골드 + (rewardKill의 back)
    const reward = rewardKill(this.data, this.run, ev.defId, ev.back === true);
    this.kills++;
    this.goldEarned += reward.gold;
    const sx = FIELD_X + x;
    const sy = this.fieldY + y;
    // 처치 골드는 소수 확률이라 0골드 처치가 흔하다 — 그때는 동전·'+0'을 띄우지 않는다
    if (reward.gold > 0) {
      const gold = this.hud.goldTarget();
      this.flyers.coin(sx, sy, gold.x, this.hudY + gold.y, reward.gold);
      if (size > 0) this.fx.goldPopup(x, y, reward.gold);
    }

    const drop = reward.drop;
    if (!drop) return;
    if (drop.converted) {
      sfx.playAt('coin', panAt(x));
      this.goldEarned += drop.convertedGold;
      this.toast(T.combat.dropConverted(drop.convertedGold), 0x6b4a12);
      return;
    }
    this.drops.push({ defId: drop.defId, tier: drop.tier });
    sfx.playAt('item_drop', panAt(x));
    const def = this.data.items[drop.defId];
    const bag = this.hud.bagTarget();
    this.flyers.item(def?.icon ?? 'ui_bag', sx, sy, bag.x, this.hudY + bag.y);
    this.toast(def ? T.combat.newItemNamed(def.name) : T.combat.newItem, UI_COLORS.accent);
  }

  private onWon(): void {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'won';
    this.closeBagNow();
    this.cancelPointers();
    this.tutorial?.dismiss();
    this.combo.end();
    sfx.play('stage_clear');
    const celebrate = CELEBRATE_TIME + (this.bossTest ? BOSS_TEST_CELEBRATE_EXTRA : 0);
    this.showBanner('clear', this.bossTest ? T.combat.bossDefeated : T.combat.cleared, null, celebrate + 0.6);
    for (let i = 0; i < 5; i++) this.fx.confetti(FIELD_W * (0.15 + i * 0.175), FIELD_H * (0.3 + (i % 2) * 0.12));
    this.after(celebrate, () => (this.bossTest ? this.finishBossTest(true) : this.finishStageAfterLevelUps()));
  }

  /**
   * 스테이지 끝: 마지막 처치들로 오른 레벨업이 남아 있으면 클리어 화면 전에 여기서 고른다(레벨업 창 → 다 고르면 finishStage).
   * 보스 테스트는 끝나면 런을 버리므로 고르지 않는다. 측정 도구가 레벨업을 보류 중이면 런에 남긴 채로 넘어간다(다음 전투에서 뜬다)
   */
  private finishStageAfterLevelUps(): void {
    if (this.leaving || this.exited) return;
    if (!game.debugHoldLevelUps && pendingLevelUps(this.run) > 0 && !this.levelUp) {
      this.openLevelUp(() => this.after(LEVEL_UP_END_HOLD, () => this.finishStage()));
      return;
    }
    this.finishStage();
  }

  private finishStage(): void {
    if (this.leaving || this.exited) return;
    this.leaving = true;
    const run = this.run;
    const clearedIndex = run.stageIndex;
    const res = completeStage(this.data, run, this.sim.player.hp);
    saveRun(run);
    game.toStageClear({
      stageIndex: clearedIndex,
      kills: this.kills,
      goldEarned: this.goldEarned,
      drops: this.drops,
      clearGold: res.clearGold,
      healed: res.healed,
      finished: res.finished,
    });
  }

  /** 보스 테스트 끝: 보상·스테이지 진행·저장 없이 보스 결과 화면으로 (일반 런 세이브는 건드리지 않는다) */
  private finishBossTest(won: boolean): void {
    if (this.leaving || this.exited) return;
    this.leaving = true;
    const sim = this.sim;
    const boss = this.boss;
    const bs = sim.boss;
    const bossMaxHp = boss?.maxHp ?? 0;
    // 보스 HP는 회복되지 않으므로 '깎은 양' = 최대 - 남은 HP (이겼으면 전부)
    const bossDamage = won ? bossMaxHp : Math.max(0, Math.round(bossMaxHp - Math.max(0, boss?.hp ?? bossMaxHp)));
    game.toBossResult({
      won,
      characterId: this.run.characterId,
      lostReason: won ? null : sim.lostReason,
      time: sim.time,
      hp: Math.max(0, Math.ceil(sim.player.hp)),
      maxHp: sim.player.maxHp,
      bossDamage,
      bossMaxHp,
      backAttacks: this.bossTopHits,
      minionKills: this.minionKills,
      phase: (bs?.phase ?? 0) + 1,
      phases: bs?.phases ?? 1,
      level: runLevel(this.run),
    });
  }

  /** 보스 테스트를 중간에 그만둠 (가방 오버레이의 '그만두기') — 결과 없이 타이틀로. 일반 런 세이브는 그대로 */
  private quitBossTest(): void {
    if (!this.bossTest || this.leaving || this.exited) return;
    this.leaving = true;
    game.toTitle();
  }

  /** 'bossPhase': 등장 착지(phase 0) 또는 페이즈 전환 — 포효(무적) 연출 */
  private onBossPhase(phase: number, roar: number): void {
    const boss = this.boss;
    this.bossFx?.onPhase(phase, roar, boss && boss.alive ? boss : null);
    this.bossBar?.setPhase(phase);
    sfx.play('boss_roar');
    if (phase === 0) {
      // 고정 위치에 쿵 내려앉으며 포효
      this.addTrauma(TRAUMA_BOSS_LAND);
      return;
    }
    // 페이즈 전환: 화면 번쩍 + 크게 흔들림 + 배너(보스 몸 위 — 아래쪽 탄을 가리지 않게)
    this.addTrauma(TRAUMA_ROAR);
    this.screenFlash(0xffffff, PHASE_FLASH_ALPHA, PHASE_FLASH_TIME);
    this.bossBar?.flash();
    this.showBanner('phase', T.combat.phase(phase + 1), phaseSub(phase), PHASE_BANNER_TIME, PHASE_BANNER_Y);
  }

  /**
   * 'summon': 졸개가 입에서 튀어나와 칸으로 (묶음마다 연기·소리 한 번). 착지 표시·착지 먼지는 BossFx —
   * 필드 시계로 흘러서 히트스톱·가방 오버레이 동안 멈춘 졸개보다 먼저 먼지가 나지 않는다
   */
  private onSummon(ev: Extract<CombatEvent, { type: 'summon' }>): void {
    this.enemies.hop(ev.enemyId, ev.fromX, ev.fromY, SUMMON_HOP_TIME);
    this.bossFx?.onSummon(ev.x, ev.y);
    if (this.sfxClock - this.lastSummonPuff > 0.2) {
      this.lastSummonPuff = this.sfxClock;
      this.fx.summonPuff(ev.fromX, ev.fromY);
      sfx.playAt('boss_summon', panAt(ev.fromX));
    }
  }

  /** 배너 표시. fieldY를 주면 그 필드 높이에, 아니면 기본 위치 */
  private showBanner(kind: BannerKind, title: string, sub: string | null, duration: number, fieldY?: number): void {
    this.banner.position.y = fieldY === undefined ? this.bannerY : this.fieldY + fieldY;
    this.banner.show(kind, title, sub, duration);
  }

  private onLost(reason: LostReason): void {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'lost';
    this.closeBagNow();
    this.cancelPointers();
    this.tutorial?.dismiss();
    this.combo.end();
    sfx.play('defeat');
    if (reason === 'contact') {
      // 장난감에 부딪힘: 피격처럼 '아야' + 멈칫 + 붉은 테, 그리고 쓰러진다
      const pl = this.sim.player;
      sfx.playAt('player_hurt', panAt(pl.x));
      this.addTrauma(TRAUMA_PLAYER_HIT);
      this.hitStop = Math.max(this.hitStop, HITSTOP_PLAYER);
    }
    if (reason !== 'breach') this.player.die();
    this.addTrauma(TRAUMA_DEFEAT);
    this.vignetteT = VIGNETTE_TIME * 2;
    const sub = reason === 'breach' ? T.combat.breach : reason === 'contact' ? T.combat.crushed : T.combat.knockedOut;
    this.showBanner('defeat', T.combat.defeat, sub, DEFEAT_TIME + 0.6);
    this.after(DEFEAT_TIME, () => {
      if (this.bossTest) {
        this.finishBossTest(false);
        return;
      }
      if (this.leaving || this.exited) return;
      this.leaving = true;
      const run = this.run;
      game.toResult({ won: false, stageIndex: run.stageIndex, characterId: run.characterId, stats: run.stats });
    });
  }

  // ── 화면 동기화 ─────────────────────────────────────────────

  private syncWorld(dt: number): void {
    const sim = this.sim;
    const lowest = this.enemies.sync(sim.enemies, dt);
    const danger = clamp((lowest - (FIELD_H - DANGER_RANGE)) / DANGER_RANGE, 0, 1);
    this.frame.setDanger(danger);
    this.dangerSfx(danger);
    this.frame.update(dt);
    this.projectiles.sync(sim.projectiles, sim.enemyShots, dt);
    const pl = sim.player;
    this.player.faceAim(Math.cos(this.aimAngle));
    this.player.sync(pl, dt, sim.status === 'running');
    const aiming = sim.status === 'running' && !this.ended;
    this.aimGuide.visible = aiming;
    if (aiming) this.aimGuide.update(dt, pl.x, pl.y - FIRE_OFFSET_Y, this.aimAngle, this.guideRadius, sim.enemies);
    if (this.tutorial) {
      this.tutorial.update(dt, pl.x, pl.y);
      if (this.tutorial.done) {
        this.tutorial.destroy({ children: true, context: true });
        this.tutorial = null;
      }
    }
    this.fx.update(dt);
    this.weaponBar.sync(sim.weapons, dt);
    this.hud.setHp(sim.player.hp, sim.player.maxHp);
    this.hud.setProgress(sim.progress());

    const boss = this.boss;
    if (boss && this.bossBar) {
      if (!this.bossAnnounced && boss.alive && boss.y + boss.h > 0) {
        this.bossAnnounced = true;
        this.fieldUi.addChild(this.bossBar);
        this.bossBar.show();
        // 보스 체력 바(필드 위쪽)가 피해 숫자를 가리지 않게
        this.fx.setNumberTop(BOSS_NUMBER_MIN_Y);
        // 보스 테스트는 인트로에서 이미 보스 배너·소리를 냈다
        if (!this.bossAnnouncedIntro) {
          this.showBanner('boss', T.combat.bossIncoming, this.data.enemies[boss.defId]?.name ?? null, 1.8);
          sfx.play('boss_appear');
          this.addTrauma(TRAUMA_BOSS_ARRIVE);
        }
      }
      if (this.bossAnnounced && boss.alive) this.bossBar.setHp(boss.hp, boss.maxHp);
      const bs = this.sim.boss;
      if (bs) this.bossBar.setShield(bs.invulnerable && boss.alive);
      this.bossBar.update(dt);
    }
    this.bossFx?.update(dt, this.sim.boss, this.boss, this.sim.hazards);
    // 콤보 글자는 보스 입 둘레(행동 예고 빛·탄이 나오는 곳)를 피한다
    if (boss && boss.alive && boss.y + boss.h > 0) {
      const cx = boss.x + boss.w / 2;
      const by = boss.y + boss.h;
      this.combo.setAvoid(cx - COMBO_AVOID_HALF_W, by - COMBO_AVOID_UP, cx + COMBO_AVOID_HALF_W, by + COMBO_AVOID_DOWN);
    } else this.combo.clearAvoid();
    this.combo.update(dt);
    this.blockTags.update(dt);
    this.skillFx?.update(dt, pl.x, pl.y, sim.skill);
  }

  private drawVignette(vp: Viewport): void {
    const g = this.vignette;
    g.clear();
    // 가장자리에서 안쪽으로 옅어지는 붉은 테 (얇은 띠를 촘촘히 겹쳐 계단이 덜 보이게)
    const bands = 36;
    const w = 5;
    for (let i = 0; i < bands; i++) {
      const inset = i * w + w / 2;
      g.rect(inset, inset, vp.width - inset * 2, vp.height - inset * 2).stroke({
        width: w,
        color: DEFENSE_RED,
        alpha: 0.42 * (1 - i / bands) ** 2.2,
      });
    }
  }

  /** 페이즈 전환·보스 처치 화면 번쩍임 (배너 아래) */
  private updateFlash(dt: number): void {
    if (this.flashT <= 0) {
      if (this.flash.visible) this.flash.visible = false;
      return;
    }
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.visible = true;
    this.flash.alpha = this.flashMax * (this.flashT / Math.max(1e-3, this.flashDur));
  }

  private updateVignette(dt: number): void {
    if (this.vignetteT > 0) this.vignetteT = Math.max(0, this.vignetteT - dt);
    const a = Math.min(1, this.vignetteT / VIGNETTE_TIME);
    this.vignette.alpha = a;
    this.vignette.visible = a > 0;
  }

  // ── 입력 ────────────────────────────────────────────────────

  private setTarget(x: number, y: number): void {
    this.input.targetX = x;
    this.input.targetY = y;
  }

  private clearTarget(): void {
    this.input.targetX = null;
    this.input.targetY = null;
  }

  private readKeyboard(): void {
    const kb = this.keyboard;
    if (!kb) return;
    let dx = 0;
    let dy = 0;
    if (kb.isDown('ArrowLeft') || kb.isDown('KeyA')) dx -= 1;
    if (kb.isDown('ArrowRight') || kb.isDown('KeyD')) dx += 1;
    if (kb.isDown('ArrowUp') || kb.isDown('KeyW')) dy -= 1;
    if (kb.isDown('ArrowDown') || kb.isDown('KeyS')) dy += 1;
    const pl = this.sim.player;
    if (dx !== 0 || dy !== 0) {
      const inv = 1 / Math.hypot(dx, dy);
      this.setTarget(pl.x + dx * inv * KEY_MOVE_LEAD, pl.y + dy * inv * KEY_MOVE_LEAD);
      this.kbActive = true;
      this.learned('move');
    } else if (this.kbActive) {
      this.kbActive = false;
      // 키를 떼면 목표 없음 → 감속해서 선다 (드래그 중이면 드래그 목표 그대로)
      if (this.dragId === null) this.clearTarget();
    }
  }

  /** 키보드 조준 회전 (데스크톱): Q/, = 왼쪽으로, E/. = 오른쪽으로. 실제 시간 기준 */
  private readAimKeys(dt: number): void {
    const kb = this.keyboard;
    if (!kb) return;
    let rot = 0;
    if (kb.isDown('KeyQ') || kb.isDown('Comma')) rot -= 1;
    if (kb.isDown('KeyE') || kb.isDown('Period')) rot += 1;
    if (rot === 0) return;
    this.setAim(this.aimAngle + rot * AIM_KEY_RATE_DEG * DEG * dt);
    this.learned('aim');
  }

  private setAim(angle: number): void {
    const a = clampAim(angle);
    this.aimAngle = a;
    this.input.aimAngle = a;
  }

  /** 조작을 한 번씩 해보면 안내를 걷는다: 조준 → 말풍선, 조준 + 이동 → 하단 힌트 */
  private learned(what: 'aim' | 'move'): void {
    if (what === 'aim') {
      if (this.learnedAim) return;
      this.learnedAim = true;
      this.tutorial?.dismiss();
    } else {
      if (this.learnedMove) return;
      this.learnedMove = true;
    }
    if (this.learnedAim && this.learnedMove) this.weaponBar.dismissHint();
  }

  /**
   * 화면(씬 좌표)의 점을 향해 조준 — 필드(+ 테두리 벽) 안의 점만. HUD·하단 바를 누른 건 조준이 아니다.
   * 캐릭터 몸 위(AIM_TAP_BODY_RADIUS)나 발사점 바로 옆(AIM_TAP_MIN_DIST)도 조준하지 않는다.
   * 방향 = 발사점(플레이어 위 FIRE_OFFSET_Y) → 그 점, sim과 같은 clamp. tap이면 그 자리에 고리 펄스.
   */
  private aimAtScreen(sx: number, sy: number, tap: boolean): boolean {
    if (sx < 0 || sx > DESIGN_W || sy < this.fieldY - WALL_TOP_H || sy > this.fieldY + FIELD_H) return false;
    const fx = sx - FIELD_X;
    const fy = sy - this.fieldY;
    const pl = this.sim.player;
    const dx = fx - pl.x;
    const by = fy - pl.y;
    if (dx * dx + by * by < AIM_TAP_BODY_RADIUS * AIM_TAP_BODY_RADIUS) return false;
    const dy = by + FIRE_OFFSET_Y;
    if (dx * dx + dy * dy < AIM_TAP_MIN_DIST * AIM_TAP_MIN_DIST) return false;
    const before = this.aimAngle;
    this.setAim(Math.atan2(dy, dx));
    if (tap) {
      this.aimGuide.pulseAt(clamp(fx, 0, FIELD_W), clamp(fy, 0, FIELD_H));
      if (this.aimAngle !== before) this.aimGuide.snap();
      this.learned('aim');
    }
    return true;
  }

  private beginDrag(t: PointerTrack, x: number, y: number): void {
    t.mode = 'drag';
    this.dragId = t.id;
    // 탭 판정 거리만큼 움직인 지금 위치를 기준점으로 → 드래그로 바뀌는 순간 목표가 튀지 않는다.
    // 기준 목표 = 지금 걸어가는 목표(직전 드래그의 끝 — 아직 가는 중이어도 이어서 끌 수 있게), 없으면 캐릭터 위치
    this.dragStart.set(x, y);
    const pl = this.sim.player;
    this.dragPlayerX = this.input.targetX ?? pl.x;
    this.dragPlayerY = this.input.targetY ?? pl.y;
    this.setTarget(this.dragPlayerX, this.dragPlayerY);
  }

  /**
   * 드래그 = 손가락 이동량만큼 목표를 상대 이동. 캐릭터는 그 목표를 향해 이동 속도로 걸어간다(가속·도착 감속은 sim) —
   * 손가락을 빨리 끌면 캐릭터가 뒤따라오며 따라잡는다. 목표는 필드 벽 안 어디든.
   */
  private dragTo(x: number, y: number): void {
    const rx = this.dragPlayerX + (x - this.dragStart.x);
    const ry = this.dragPlayerY + (y - this.dragStart.y);
    const tx = clampPlayerX(rx);
    const ty = clampPlayerY(ry);
    // 벽 밖으로 끌면 기준점을 따라 옮겨서, 되돌릴 때 바로 반응하게
    this.dragStart.x += rx - tx;
    this.dragStart.y += ry - ty;
    this.setTarget(tx, ty);
    if (!this.learnedMove && Math.hypot(tx - this.dragPlayerX, ty - this.dragPlayerY) > HINT_DISMISS_DIST) {
      this.learned('move');
    }
  }

  /** 드래그 끝: 목표는 그대로 — 캐릭터는 손가락을 놓은 자리(목표)까지 마저 걸어가서 선다 */
  private endDrag(): void {
    this.dragId = null;
  }

  /** 포인터 하나를 조준 없이 정리 (드래그였으면 멈춤) */
  private dropPointer(id: number): void {
    const t = this.pointers.get(id);
    if (!t) return;
    this.pointers.delete(id);
    if (t.mode === 'drag' || this.dragId === id) this.endDrag();
  }

  /** 모든 포인터 정리 (가방 열기·승패·포커스 잃음) */
  private cancelPointers(): void {
    this.pointers.clear();
    if (this.dragId !== null) this.endDrag();
  }

  private readonly onPointerDown = (e: FederatedPointerEvent): void => {
    if (!this.ready || this.overlay || this.ended) return;
    // 마우스는 왼쪽 버튼만 (오른쪽 클릭으로 조준되지 않게)
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.dropPointer(e.pointerId); // 놓친 up이 있었다면 정리
    const p = e.getLocalPosition(this, this.tmp);
    this.pointers.set(e.pointerId, { id: e.pointerId, mode: 'pending', downX: p.x, downY: p.y });
  };

  private readonly onPointerMove = (e: FederatedPointerEvent): void => {
    const t = this.pointers.get(e.pointerId);
    if (!t) return;
    const p = e.getLocalPosition(this, this.tmp);
    if (t.mode === 'drag') {
      this.dragTo(p.x, p.y);
      return;
    }
    if (t.mode === 'pending') {
      const dx = p.x - t.downX;
      const dy = p.y - t.downY;
      if (dx * dx + dy * dy <= TAP_SLOP * TAP_SLOP) return;
      // 탭이 아니다: 아무도 이동 중이 아니면 이동 드래그, 다른 손가락이 이동 중이면 이 손가락은 조준
      if (this.dragId === null) {
        this.beginDrag(t, p.x, p.y);
        return;
      }
      t.mode = 'aim';
    }
    this.aimAtScreen(p.x, p.y, false);
  };

  /** 뗌: 드래그면 멈춤, 아니면(탭 / 두 번째 손가락 조준) 뗀 자리를 향해 조준 */
  private readonly onPointerUp = (e: FederatedPointerEvent): void => {
    const t = this.pointers.get(e.pointerId);
    if (!t) return;
    this.pointers.delete(t.id);
    if (t.mode === 'drag' || this.dragId === t.id) {
      this.endDrag();
      return;
    }
    if (!this.ready || this.overlay || this.ended) return;
    const p = e.getLocalPosition(this, this.tmp);
    // move 없이 멀리서 뗀 포인터(빠른 휙 — 합쳐진 move가 오기 전에 up)는 탭이 아니다
    if (t.mode === 'pending') {
      const mx = p.x - t.downX;
      const my = p.y - t.downY;
      if (mx * mx + my * my > TAP_SLOP * TAP_SLOP) return;
    }
    this.aimAtScreen(p.x, p.y, true);
  };

  /** pointerupoutside / pointercancel: 조준 없이 그 포인터만 정리 */
  private readonly onPointerAbort = (e: FederatedPointerEvent): void => {
    this.dropPointer(e.pointerId);
  };

  /** 스킬 버튼 누름: 바탕과 같은 포인터 추적 (움직이면 이동 드래그·두 번째 손가락 조준이 된다) */
  private readonly onSkillDown = (e: FederatedPointerEvent): void => {
    this.onPointerDown(e);
  };

  /** 스킬 버튼에서 뗌: 제자리 탭(드래그가 되지 않은 포인터)이고 버튼 위에서 뗐으면 스킬 발동. 포인터 정리는 바탕과 같다 */
  private readonly onSkillUp = (e: FederatedPointerEvent): void => {
    const t = this.pointers.get(e.pointerId);
    let tap = false;
    if (t && t.mode === 'pending' && e.type === 'pointerup') {
      const p = e.getLocalPosition(this, this.tmp);
      const dx = p.x - t.downX;
      const dy = p.y - t.downY;
      tap = dx * dx + dy * dy <= TAP_SLOP * TAP_SLOP;
    }
    if (e.type === 'pointerup') this.onPointerUp(e);
    else this.onPointerAbort(e);
    if (tap) this.tryActivateSkill();
  };

  /** PixiJS는 네이티브 pointercancel을 넘겨주지 않는다 — 시스템 제스처 등으로 끊긴 포인터, 창 포커스 잃음 */
  private readonly onNativeCancel = (e: Event): void => {
    if (typeof PointerEvent !== 'undefined' && e instanceof PointerEvent) this.dropPointer(e.pointerId);
    else this.cancelPointers();
  };

  /** 탭이 가려지면(앱 전환 등) 눌린 포인터를 정리 — 그동안의 up/cancel을 못 받아 끊긴 드래그가 남지 않게 */
  private readonly onVisibility = (): void => {
    if (document.hidden) this.cancelPointers();
  };

  /** 브라우저 메뉴(우클릭 · 안드로이드 길게 누르기)가 전투 화면을 덮고 다음 탭(조준)을 먹지 않게 */
  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  /** Tab이 브라우저 포커스 이동을 하지 않게 */
  private readonly onRawKey = (e: KeyboardEvent): void => {
    if (e.code === 'Tab') e.preventDefault();
  };

  // ── 가방 ────────────────────────────────────────────────────

  private toggleBag(): void {
    if (!this.ready || this.ended || this.leaving || this.levelUp) return;
    // 드래그 중의 Esc/B/Tab은 BagView가 드래그 취소로 처리한다 — 오버레이까지 닫지 않는다
    if (this.overlay?.busy) return;
    if (this.overlay) this.pendingClose = true;
    else this.openBag();
  }

  private openBag(): void {
    if (this.overlay) return;
    sfx.play('bag_open');
    this.cancelPointers();
    this.overlay = new BagOverlay({
      data: this.data,
      run: this.run,
      onChange: () => {
        this.hud.setStash(this.run.bag.stash.length);
        this.updateBagAlert();
      },
      onClose: () => {
        this.pendingClose = true;
      },
      onQuit: this.bossTest ? () => this.quitBossTest() : undefined,
    });
    this.overlayLayer.addChild(this.overlay);
    if (this.vp) this.overlay.layout(this.vp, this.fieldY);
    this.newItemAlert = false;
    this.updateBagAlert();
  }

  /** 오버레이를 닫고 바뀐 가방을 전투에 반영 (버튼 이벤트 도중이 아니라 update에서) */
  private closeBagNow(): void {
    this.pendingClose = false;
    const o = this.overlay;
    if (!o) return;
    this.overlay = null;
    sfx.play('bag_close');
    // context: true — 가방을 열고 닫을 때마다 Graphics 컨텍스트가 렌더러 GC 때까지 남지 않게 (destroy 참고)
    o.destroy({ children: true, context: true });
    this.applyRunToSim();
    this.acc = 0;
  }

  /** 런의 가방·보너스가 바뀐 것을 전투에 반영 (가방 닫기·레벨업 고르기): sim.setLoadout + 무기 바·발사음·조준 가이드·HUD */
  private applyRunToSim(): void {
    const loadout = runLoadout(this.data, this.run);
    this.sim.setLoadout(loadout, runPlayerStats(this.data, this.run));
    this.weaponBar.rebuild(loadout, this.data.items);
    this.rebuildFireSfx(loadout);
    this.rebuildProjStyles(loadout);
    this.guideRadius = guideRadius(loadout);
    this.hud.setStash(this.run.bag.stash.length);
    this.hud.setHp(this.sim.player.hp, this.sim.player.maxHp);
    this.updateBagAlert();
  }

  // ── 레벨업 (docs/DESIGN.md '레벨업') ────────────────────────

  /** 대기 레벨업이 있고 전투 중이면 창을 띄워야 한다 (측정 도구 보류 중이면 아니다) */
  private levelUpWanted(): boolean {
    return !game.debugHoldLevelUps && pendingLevelUps(this.run) > 0;
  }

  /** 전투 중(인트로·승패·가방 밖)에 대기 레벨업이 생기면 창을 연다 — 전투는 창이 닫힐 때까지 멈춘다 */
  private maybeOpenLevelUp(): void {
    if (this.levelUp || this.overlay || this.ended || this.leaving || this.phase !== 'fight') return;
    if (!this.levelUpWanted()) return;
    this.openLevelUp(null);
  }

  private openLevelUp(onDone: (() => void) | null): void {
    if (this.levelUp) return;
    this.cancelPointers();
    this.levelUpDone = onDone;
    // 클리어·페이즈 배너가 카드를 가리지 않게
    this.banner.hide();
    // '레벨 업!' 딩 + 카드 세 장이 차례로 들어오는 소리
    sfx.play('level_up');
    this.cardFlipSfx(CARD_FLIP_START);
    const o = new LevelUpOverlay({
      data: this.data,
      run: this.run,
      onPicked: (result, gx, gy) => this.onLevelUpPicked(result, gx, gy),
      onDone: () => this.closeLevelUp(),
    });
    this.levelUp = o;
    this.overlayLayer.addChild(o);
    if (this.vp) o.layout(this.vp, this.fieldY);
    this.xpDirty = true;
  }

  /** 레벨업 창 닫기 (다 골랐거나, 디버그 승패로 고르지 않고). 이어서 할 일(스테이지 끝)이 있으면 부른다 */
  private closeLevelUp(): void {
    const o = this.levelUp;
    if (!o) return;
    this.levelUp = null;
    o.destroy({ children: true, context: true });
    this.acc = 0;
    this.xpDirty = true;
    const done = this.levelUpDone;
    this.levelUpDone = null;
    done?.();
  }

  /** 레벨업 카드가 들어오는 소리 (장마다 조금씩 높게) — start초 뒤부터 CARD_FLIP_STAGGER 간격 */
  private cardFlipSfx(start: number): void {
    for (let i = 0; i < 3; i++) this.after(start + i * CARD_FLIP_STAGGER, () => sfx.play('card_flip', { rate: 1 + i * 0.05 }));
  }

  /** 카드 하나를 골라 런에 적용한 직후: 전투 반영 + 아이템은 가방 버튼으로 날아감 + 결과 알림(화면 아래쪽, 바로) */
  private onLevelUpPicked(result: LevelUpResult, gx: number, gy: number): void {
    // 대기 레벨업이 남았으면 고른 카드 연출 뒤 다음 카드들이 들어온다
    if (pendingLevelUps(this.run) > 0) this.cardFlipSfx(LEVEL_UP_NEXT_DEAL);
    const hpBefore = this.sim.player.hp;
    this.applyRunToSim();
    // 꿀잠 베개('바로 HP 회복'): setLoadout은 최대 HP가 이번 전투 최고치를 넘은 만큼만 회복한다(냄비 뚜껑 빼고 넣기 회복 방지) —
    // 전투 중 최대 HP 장비를 뺐었다면 그 몫이 0이 되어 약속한 회복이 사라졌다. 모자란 만큼 채우고, 알림은 sim에서 실제로 오른 HP로
    let healed = 0;
    if (result.kind === 'boon') {
      const heal = this.data.boons[result.boon]?.effect.heal ?? 0;
      if (heal > 0) {
        const got = this.sim.player.hp - hpBefore;
        if (got < heal) this.sim.healPlayer(heal - got);
        healed = Math.max(0, Math.round(this.sim.player.hp - hpBefore));
        this.hud.setHp(this.sim.player.hp, this.sim.player.maxHp);
      }
    }
    this.xpDirty = true;
    const from = this.toLocal({ x: gx, y: gy });
    const L = T.combat.levelUp;
    const y = (this.vp ? this.vp.height - this.vp.safeBottom : this.fieldY + FIELD_H) - LEVEL_UP_TOAST_BOTTOM;
    let n = 0;
    // 같은 프레임에 둘을 띄우면 Toast 쌓기 트윈이 겹쳐 서로 가린다 — 두 번째부터는 조금 늦게
    const note = (text: string, color: number): void => {
      const show = (): void => Toast.show(this.toastLayer, text, { y, color });
      if (n++ === 0) show();
      else this.after((n - 1) * LEVEL_UP_TOAST_GAP, show);
    };
    switch (result.kind) {
      case 'item': {
        const def = this.data.items[result.defId];
        const name = def?.name ?? result.defId;
        if (result.where === 'gold') {
          const gold = this.hud.goldTarget();
          this.flyers.coin(from.x, from.y, gold.x, this.hudY + gold.y, result.gold);
          note(T.combat.dropConverted(result.gold), 0x6b4a12);
        } else {
          const bag = this.hud.bagTarget();
          this.flyers.item(def?.icon ?? 'ui_bag', from.x, from.y, bag.x, this.hudY + bag.y);
          note(result.where === 'bag' ? L.toBag(name, result.x + 1, result.y + 1) : L.toStash(name), UI_COLORS.accent);
        }
        sfx.play('ui_purchase');
        break;
      }
      case 'upgrade': {
        const def = this.data.items[result.defId];
        note(L.tierUp(def?.name ?? result.defId, result.tier), 0xc98a10);
        sfx.play('merge_tier');
        break;
      }
      case 'boon': {
        const def = this.data.boons[result.boon];
        note(L.boonGot(def?.name ?? result.boon, result.stacks, def?.maxStacks ?? result.stacks), 0x2f8a4a);
        if (healed > 0) note(L.healed(healed), 0xb03050);
        sfx.play(healed > 0 ? 'heal' : 'ui_purchase');
        break;
      }
    }
  }

  private refreshXp(): void {
    this.xpDirty = false;
    if (!this.xpBar || !this.ready) return;
    const level = runLevel(this.run);
    this.xpBar.set(level, runXp(this.run), xpToNext(level), pendingLevelUps(this.run));
  }

  // ── 액티브 스킬 (docs/DESIGN.md '액티브 스킬') ──────────────

  /** 스킬 버튼을 지금 누를 수 있나: 전투 중(인트로·가방·레벨업 창·승패 밖) + 게이지 가득 + 이전 효과 끝 */
  private skillUsable(): boolean {
    const s = this.ready ? this.sim.skill : null;
    return (
      !!s &&
      s.ready &&
      this.phase === 'fight' &&
      !this.overlay &&
      !this.levelUp &&
      !this.ended &&
      !this.leaving &&
      this.sim.status === 'running'
    );
  }

  /** 스킬 버튼 탭·Space: 쓸 수 있으면 sim.activateSkill → 이벤트('skill'·'freeze' …)는 바로 연출로, 아니면 버튼이 떤다 */
  private tryActivateSkill(): void {
    if (!this.ready || !this.skillBtn) return;
    if (!this.skillUsable() || !this.sim.activateSkill()) {
      // 인트로·오버레이 중에는 조용히, 전투 중인데 아직 안 찼으면 떨림
      if (this.phase === 'fight' && !this.overlay && !this.levelUp && !this.ended) this.skillBtn.deny();
      return;
    }
    this.handleEvents(this.sim.drainEvents());
    this.skillBtn.burst();
    sfx.play(SKILL_SFX[this.skillBtn.def.kind]);
  }

  private updateBagAlert(): void {
    const merges = findMerges(this.run.bag, this.data).length > 0;
    this.hud.setBagAlert(merges || this.newItemAlert);
  }

  // ── 도우미 ──────────────────────────────────────────────────

  /** 미리 그리기: 프레임당 하나 (update는 렌더 전에 돈다 → 이번 프레임에 래스터화). 글자는 남겨 둔다 (warmLayer 참고) */
  private stepWarmup(): void {
    const next = this.warmQueue.shift();
    if (!next) return;
    for (const t of next()) {
      t.scale.set(WARM_TEXT_SCALE);
      this.warmLayer.addChild(t);
    }
  }

  // ── 효과음 도우미 ───────────────────────────────────────────

  private rebuildFireSfx(loadout: readonly WeaponLoadout[]): void {
    this.fireSfx.clear();
    for (const l of loadout) this.fireSfx.set(l.uid, weaponFireSfx(l.defId));
  }

  /** 투사체 꼬리 모양: 유도 리본이 맞닿은 무기 = 분홍 리본, 털뭉치 폭풍(스킬) 공 = 연보라 */
  private rebuildProjStyles(loadout: readonly WeaponLoadout[]): void {
    const p = this.projectiles;
    p.clearStyles();
    for (const l of loadout) if (l.homing !== undefined && l.homing > 0) p.setStyle(l.uid, PROJ_STYLE_HOMING);
    p.setStyle(SKILL_WEAPON_UID, PROJ_STYLE_SKILL);
  }

  /** 적 공격 탄 그림에 맞는 발사음. 보스 행동 탄은 이벤트의 sprite로 (보스는 EnemyDef.attack이 없다) */
  private enemyShotSfx(enemyId: number, x: number, sprite?: string): void {
    if (sprite) {
      const id = ENEMY_SHOT_SFX[sprite];
      if (id) sfx.playAt(id, panAt(x));
      return;
    }
    const list = this.sim.enemies;
    for (let i = 0; i < list.length; i++) {
      if (list[i].id !== enemyId) continue;
      const shot = this.data.enemies[list[i].defId]?.attack?.sprite;
      const id = shot ? ENEMY_SHOT_SFX[shot] : undefined;
      if (id) sfx.playAt(id, panAt(x));
      return;
    }
  }

  /** 동전이 HUD에 닿을 때 '띵' — 연달아 오면 반음씩 올라간다 */
  private coinSfx(): void {
    const t = this.sfxClock;
    this.coinStreak = t - this.lastCoinAt <= COIN_STREAK_WINDOW ? Math.min(COIN_STREAK_MAX, this.coinStreak + 1) : 0;
    this.lastCoinAt = t;
    // HUD 골드(왼쪽 위)로 모이므로 살짝 왼쪽
    sfx.playAt('coin', -COMBAT_PAN * 0.5, COIN_STREAK_STEP ** this.coinStreak);
  }

  /** 방어선 위험: 위험이 새로 시작될 때만, DANGER_REPEAT 안에는 다시 울리지 않는다 */
  private dangerSfx(danger: number): void {
    if (danger <= 0 || this.ended) {
      this.dangerOn = false;
      return;
    }
    if (this.dangerOn) return;
    this.dangerOn = true;
    if (this.sfxClock - this.lastDangerAt < DANGER_REPEAT) return;
    this.lastDangerAt = this.sfxClock;
    sfx.play('danger');
  }

  private toast(text: string, color: number): void {
    Toast.show(this.toastLayer, text, { y: this.fieldY + FIELD_H * 0.22, color });
  }

  private after(seconds: number, fn: () => void): void {
    this.timers.push({ t: seconds, fn });
  }

  private runTimers(dt: number): void {
    if (this.timers.length === 0) return;
    const due: Timer[] = [];
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) {
        due.push(tm);
        this.timers.splice(i, 1);
      }
    }
    for (const tm of due) {
      if (this.exited) return;
      tm.fn();
    }
  }
}

/**
 * 방패 '막음!' 꼬리표: 스타일 캐시 키·글자 크기·색, 막은 자리에서 아래로 띄우고 더 아래로 흐른다(튕겨 나간 공처럼 — 떠오르면 방패의 HP 숫자를 덮었다)
 */
const BLOCK_TAG_KEY = 'blocked';
const BLOCK_TAG_FONT = 30;
const BLOCK_TAG_COLOR = 0xe6f3ff;
const BLOCK_TAG_DY = 30;
const BLOCK_TAG_DRIFT = -18;

/** 페이즈 배너 부제 (페이즈 인덱스 1..), 문구가 모자라면 마지막 것 */
function phaseSub(phase: number): string | null {
  const list = T.combat.phaseSub;
  if (list.length === 0) return null;
  return list[Math.min(phase, list.length - 1)] || null;
}

/** 필드 x → 은은한 좌우 위치 (-COMBAT_PAN..COMBAT_PAN) */
function panAt(x: number): number {
  return clamp((x / FIELD_W) * 2 - 1, -1, 1) * COMBAT_PAN;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 미리 그리기용: 거의 안 보이는 크기의 스프라이트 (그려지는 순간 텍스처가 GPU에 올라간다) */
function warmSprite(t: Texture): Sprite {
  const s = new Sprite(t);
  s.scale.set(WARM_TEXT_SCALE);
  return s;
}

interface FrontWave {
  /** 맨 앞 웨이브의 뒤쪽 끝(칸 경계, 필드 y). 화면 밖 줄도 포함 → 웨이브가 다 들어오기 전엔 음수(아직 뒤쪽 공간 없음) */
  top: number;
  /** 그 웨이브의 적 수 */
  count: number;
  /** 적 충돌 박스 윗변의 격자 위치(아무 적의 y) — 모든 적이 같이 내려오므로 공통 */
  grid: number;
}

/** 맨 앞 웨이브 = 가장 아래 살아있는 적의 줄부터 위로 빈 줄 없이 이어진 줄들. 적이 없으면 null. 디버그 통계용 */
function frontWave(enemies: readonly EnemyEntity[]): FrontWave | null {
  // 모든 적은 같이 내려오므로 칸 경계도 공통 — 줄 번호(round(top / CELL))로 묶는다
  const rows = new Map<number, { top: number; count: number }>();
  let lowest = -Infinity;
  let grid = 0;
  for (const e of enemies) {
    if (!e.alive) continue;
    grid = e.y;
    const top = e.y - ENEMY_INSET;
    const n = Math.round((e.h + 2 * ENEMY_INSET) / CELL);
    for (let k = 0; k < n; k++) {
      const key = Math.round((top + k * CELL) / CELL);
      const row = rows.get(key);
      if (row) {
        if (k === 0) row.count++;
      } else rows.set(key, { top: top + k * CELL, count: k === 0 ? 1 : 0 });
      if (key > lowest) lowest = key;
    }
  }
  if (rows.size === 0) return null;
  let k = lowest;
  let count = rows.get(k)?.count ?? 0;
  while (rows.has(k - 1)) count += rows.get(--k)?.count ?? 0;
  return { top: rows.get(k)?.top ?? 0, count, grid };
}

/** 조준 가이드 공 반경: 가장 자주 쏘는(쿨타임이 가장 짧은) 무기의 반경 */
function guideRadius(loadout: readonly WeaponLoadout[]): number {
  let best: WeaponLoadout | null = null;
  for (const l of loadout) if (!best || l.cooldown < best.cooldown) best = l;
  return best ? best.radius : AIM_GUIDE_DEFAULT_RADIUS;
}
