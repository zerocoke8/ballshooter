// 고정 스텝 전투 시뮬레이션. 같은 seed + 같은 입력 시퀀스 → 같은 결과.
// 필드 좌표: 좌상단 (0,0), 폭 FIELD_W, 높이 FIELD_H, y는 아래로 증가. 위·좌·우 벽, 아래는 열림.

import {
  AIM_MIN_DEG,
  BOSS_REHIT_DAMAGE_MUL,
  BOSS_REHIT_WINDOW,
  BURN_DURATION,
  BURN_RATIO,
  CELL,
  CHAIN_DAMAGE_MUL,
  CHAIN_RANGE,
  CHAIN_TARGETS,
  CHILL_ATTACK_RATE,
  CHILL_ATTACK_RATE_RESIST,
  CHILL_DAMAGE_TAKEN_MUL,
  CHILL_DURATION,
  DESCENT_FAST_FORWARD,
  ENEMY_INSET,
  EXPLODE_DAMAGE_MUL,
  FIELD_COLS,
  FIELD_H,
  FIELD_W,
  MAX_SUBSTEPS,
  MIN_VERTICAL_RATIO,
  PIERCE_REHIT_TIME,
  PLAYER_HIT_RADIUS,
  PLAYER_INVULN_TIME,
  PLAYER_START_Y,
  PROJECTILE_MAX_AGE,
  SPAWN_GAP,
  SPLIT_CHILD_MAX_AGE,
  SUMMON_LAND_TIME,
} from '../../config';
import type {
  BossActionDef,
  BossDef,
  BossMode,
  BossShotSpec,
  BossState,
  CombatEvent,
  CombatInput,
  CombatStatus,
  Element,
  EnemyAttack,
  EnemyDef,
  EnemyEntity,
  EnemyShotEntity,
  HazardEntity,
  HazardKind,
  LostReason,
  PlayerEntity,
  PlayerStats,
  ProjectileEntity,
  StageDef,
  WeaponLoadout,
  WeaponRuntime,
} from '../../types';
import { Rng } from '../rng';
import { stepPlayerMotion } from './movement';
import type { Contact, Velocity } from './physics';

export interface CombatSimOptions {
  stage: StageDef;
  stageIndex: number;
  enemies: Record<string, EnemyDef>;
  loadout: WeaponLoadout[];
  player: PlayerStats;
  hp: number;
  seed: number;
  /** 보스 행동 데이터 (보통 GAME_DATA.bosses). stage.boss가 있으면 필수, 없으면 쓰지 않는다 */
  bosses?: Record<string, BossDef>;
}

// ── 시뮬레이션 내부 상수 (밸런스 수치는 config.ts) ──────────────
const HIT_FLASH_TIME = 0.12;
/** 화상 피해를 hit 이벤트 하나로 묶어 보내는 간격(초) */
const BURN_EVENT_INTERVAL = 0.5;
/** 적의 아래 끝(y+h)이 이보다 내려와야 공격 타이머가 돈다 */
const ENEMY_ATTACK_MIN_BOTTOM = 40;
/** 발사 위치 = 플레이어 중심에서 이만큼 위 (조준 가이드·탭 조준도 여기를 기준으로 한다) */
export const FIRE_OFFSET_Y = 30;
/** 자동조준 발사 각도 지터(±도). 수동 조준(aimAngle)은 지터 없이 정확히 그 방향 — 조준 가이드가 거짓말하지 않게 */
const FIRE_JITTER_DEG = 2;
const SPLIT_FAN_DEG = 60;
/** 새로 장착한 무기의 첫 발사 대기 상한 */
const NEW_WEAPON_MAX_DELAY = 0.5;
const PUSH_EPS = 0.01;
const PUSH_ITERATIONS = 4;
/** 통과 중인 적 몸속에서 이만큼 반사하면 갇힌 것으로 보고 빠져나올 때까지 모든 적을 통과 */
const TRAP_BOUNCES = 4;
/** 자동조준 "가장 아래" 동률 판정 허용 오차(px) */
const AIM_TIE_EPS = 0.5;
/** 부채꼴 없는(spreadDeg 0) 다발 무기의 연사 간격(초): 한 발씩 차례로 나간다 */
const BURST_INTERVAL = 0.07;
const TIME_EPS = 1e-6;
const DEG = Math.PI / 180;
const AIM_MIN = AIM_MIN_DEG * DEG;
/** 졸개를 소환할 칸은 플레이어 피격 원에서 이만큼(px) 넘게 떨어져야 한다 (눈앞에 생겨 부딪히는 즉사 방지) */
const SUMMON_PLAYER_MARGIN = 60;
/** 구슬 비: 다른 구슬과 간격을 지키는 자리를 찾는 시도 횟수 */
const MARBLE_TRIES = 8;
/** 칸 겹침 판정 여유(px) — 맞닿은 칸은 겹치지 않은 것으로 */
const CELL_EPS = 0.5;

/** 연사 대기열: 첫 발 이후 남은 발들 */
interface PendingBurst {
  uid: number;
  /** 남은 발 수 */
  left: number;
  /** 다음 발까지 남은 시간 */
  timer: number;
  /** 마지막 발사 방향(라디안, 지터 제외). 자동조준 대상이 없을 때 이 방향으로 쏜다 */
  angle: number;
}

/** traceAim 결과 (호출 측이 한 개를 만들어 재사용) */
export interface AimTrace {
  /** out에 쓴 꼭짓점 수 (시작점 포함, ≥ 1) */
  points: number;
  /** 마지막 꼭짓점에서 닿은 적 id. 적에 닿지 않고 끝났으면 -1 */
  hitId: number;
}

interface Enemy extends EnemyEntity {
  def: EnemyDef;
  /** 냉기 중 공격 타이머 속도 (CHILL_ATTACK_RATE, 엘리트·보스는 CHILL_ATTACK_RATE_RESIST) */
  chillAttackRate: number;
  /** 브로드페이즈 중복 방문 방지 */
  stamp: number;
  /** 아직 이벤트로 보내지 않은 화상 피해 */
  burnAcc: number;
  burnTick: number;
  /**
   * 보스가 소환한 졸개가 칸에 내려앉기까지 남은 시간(초, SUMMON_LAND_TIME부터). 0보다 크면 플레이어 몸에 닿아도 즉사가 아니다
   * (화면에서는 아직 입에서 날아오는 중). 다른 적은 늘 0
   */
  landing: number;
}

interface Projectile extends ProjectileEntity {
  /** 수명 상한(초). 무기 발사 = PROJECTILE_MAX_AGE, 분열 자식 = SPLIT_CHILD_MAX_AGE. 없으면 PROJECTILE_MAX_AGE */
  maxAge?: number;
  /** 관통 타격 기록: 적 id → 마지막 타격 시각 */
  lastHit?: Map<number, number>;
  /**
   * 충돌을 무시하는 적 id (관통으로 뚫은 "터널" 또는 끼임 탈출 중).
   * 하나라도 아직 겹쳐 있으면 목록 전체를 유지하고, 모두 벗어나면 비운다.
   */
  passing?: number[];
  /** true면 빠져나올 때까지 닿는 적을 전부 passing에 넣는다 (끼임/갇힘 탈출) */
  ghost?: boolean;
  /** passing이 비지 않은 채로 적에게 반사한 횟수 */
  trapBounces?: number;
  /** 이 투사체가 마지막으로 보스를 직접 때린 시각 (보스 연타 감쇠 — BOSS_REHIT_WINDOW) */
  bossHitAt?: number;
}

/** 위험 지역 + 만든 행동 번호 (행동은 자기 위험 지역이 다 끝나야 끝난다) */
interface Hazard extends HazardEntity {
  owner: number;
  /** 이번 스텝에 생김 — 예고 시간은 다음 스텝부터 흐른다 (예고 이벤트부터 발동까지 정확히 warn초) */
  fresh: boolean;
}

/** 보스전 진행 상태 (sim 내부). 공개용 요약은 BossState(sim.boss) */
interface BossRuntime {
  def: BossDef;
  e: Enemy;
  /** 고정 위치의 충돌 박스 y */
  anchorY: number;
  phase: number;
  mode: BossMode;
  /** roar·windup에 남은 시간 */
  modeTime: number;
  /** 다음 행동까지 쉬는 시간 (idle) */
  gap: number;
  /** 행동별 남은 쿨타임 (def.actions 순서) */
  cds: number[];
  act: BossActionDef | null;
  /** 행동 번호 (고를 때마다 +1) — 위험 지역 주인 표시 */
  actSeq: number;
  /** 실행 중: 남은 펄스(발사·위험 지역·소환 한 번) 수 / 다음 펄스까지 / 지금 펄스 번호 */
  pulsesLeft: number;
  pulseTimer: number;
  pulse: number;
  /** 펄스를 다 쓴 뒤 끝날 때까지 남은 recover 시간 */
  tail: number;
  /** 팽이 고리: 이번 행동의 빈틈 시작 인덱스 / 회전 방향(±1) */
  ringGap: number;
  ringDir: number;
  /** 일제 사격: 첫 발의 조준 방향 (다시 노리지 않는 연속 사격의 기준) */
  volleyBase: number;
  /** 다음 페이즈 문턱 HP (마지막 페이즈면 0) — 넘는 피해는 여기서 멈춘다 */
  floor: number;
  /** 문턱에 닿음 → 다음 updateBoss에서 페이즈 전환 */
  phasePending: boolean;
}

/** 접촉 기록 (스텝마다 새로 만들지 않고 CombatSim이 풀로 재사용 — 매 서브스텝 할당을 없앤다) */
interface Hit extends Contact {
  e: Enemy;
}

function newHit(): Hit {
  return { e: null as unknown as Enemy, nx: 0, ny: 0, depth: 0 };
}

/** 번개 연쇄 후보 (풀 재사용) */
interface ChainPick {
  e: Enemy;
  d2: number;
}

function byDistanceThenId(a: ChainPick, b: ChainPick): number {
  return a.d2 - b.d2 || a.e.id - b.e.id;
}

export class CombatSim {
  private readonly es: Enemy[] = [];
  private readonly ps: Projectile[] = [];
  private readonly hz: Hazard[] = [];

  readonly player: PlayerEntity;
  /** 살아있는 적만 (죽은 적은 스텝 끝에 제거) */
  readonly enemies: EnemyEntity[] = this.es;
  readonly projectiles: ProjectileEntity[] = this.ps;
  readonly enemyShots: EnemyShotEntity[] = [];
  /** 보스 위험 지역 (예고·발동 중인 것만 — 끝난 것은 스텝 끝에 제거). 일반 스테이지는 늘 비어 있다 */
  readonly hazards: HazardEntity[] = this.hz;
  /** 보스전이면 보스 상태(매 스텝 제자리 갱신), 아니면 null */
  readonly boss: BossState | null = null;
  /** loadout 순서 */
  readonly weapons: WeaponRuntime[] = [];
  status: CombatStatus = 'running';
  lostReason: LostReason | null = null;
  time = 0;
  totalEnemies = 0;
  killedEnemies = 0;

  private readonly stage: StageDef;
  private readonly rng: Rng;
  /** 적 정의 (보스전의 졸개 소환용) */
  private readonly enemyDefs: Record<string, EnemyDef>;
  /** 보스전 진행 상태 (일반 스테이지는 null — 모든 보스 경로가 이것으로 갈린다) */
  private readonly bossRt: BossRuntime | null = null;
  /** 졸개 소환 후보 칸 (재사용) */
  private readonly summonCols: number[] = [];
  private stats: PlayerStats;
  private loadout = new Map<number, WeaponLoadout>();
  /** 전투 중 가방에서 뺀 무기: uid → 다시 쏠 수 있는 시각 */
  private readonly benched = new Map<number, number>();
  private readonly byId = new Map<number, Enemy>();
  /** 열 버킷 (보이는 살아있는 적). 적은 수직으로만 움직이므로 매 스텝 다시 채운다 */
  private readonly columns: Enemy[][] = [];
  private events: CombatEvent[] = [];
  private nextId = 1;
  private stampSeq = 0;
  /** 진행 중인 연사 (발사 순서) */
  private bursts: PendingBurst[] = [];
  /** 이번 전투에서 도달한 최대 maxHp. 이를 넘는 증가분만 hp로 준다 (냄비 뚜껑 빼고 넣기 회복 방지) */
  private peakMaxHp: number;

  // ── 재사용 임시 객체 (결과에는 영향 없음 — 서브스텝마다 생기던 작은 객체 할당을 없앤다) ──
  /** collideEnemies의 접촉 목록 (앞에서부터 hitCount개만 유효) */
  private readonly hits: Hit[] = [];
  private hitCount = 0;
  /** 접촉 계산 임시값 / scanBlocking의 가장 깊은 접촉 */
  private readonly ct: Contact = { nx: 0, ny: 0, depth: 0 };
  private readonly block: Hit = newHit();
  /** 반사 속도 임시값 */
  private readonly vel: Velocity = { vx: 0, vy: 0 };
  /** 이번 서브스텝 시작 위치 (collideEnemies 인자 — double 인자 박싱을 피하려고 필드로 넘긴다) */
  private subX = 0.5;
  private subY = 0.5;
  /** 번개 연쇄 후보 (picks = 이번 호출의 정렬 대상, pickPool = 객체 풀) */
  private readonly picks: ChainPick[] = [];
  private readonly pickPool: ChainPick[] = [];

  constructor(opts: CombatSimOptions) {
    this.stage = opts.stage;
    this.stats = opts.player;
    this.peakMaxHp = opts.player.maxHp;
    this.rng = new Rng(opts.seed);
    this.enemyDefs = opts.enemies;
    for (let c = 0; c < FIELD_COLS; c++) this.columns.push([]);
    this.player = {
      x: FIELD_W / 2,
      y: PLAYER_START_Y,
      vx: 0,
      vy: 0,
      hitRadius: PLAYER_HIT_RADIUS,
      hp: Math.min(opts.hp, opts.player.maxHp),
      maxHp: opts.player.maxHp,
      invuln: 0,
    };
    this.spawnEnemies(opts.enemies);
    if (opts.stage.boss !== undefined) {
      this.bossRt = this.spawnBoss(opts.stage.boss, opts);
      const rt = this.bossRt;
      this.boss = {
        enemyId: rt.e.id,
        defId: rt.def.id,
        phase: 0,
        phases: rt.def.phases.length,
        mode: rt.mode,
        action: null,
        actionId: null,
        modeTime: 0,
        invulnerable: false,
        minions: 0,
        minionCap: rt.def.phases[0].minionCap,
        hpFrac: 1,
      };
    }
    for (const l of opts.loadout) {
      this.loadout.set(l.uid, l);
      this.weapons.push({ uid: l.uid, timer: Math.min(l.cooldown, NEW_WEAPON_MAX_DELAY), cooldown: l.cooldown });
    }
  }

  step(dt: number, input: CombatInput): void {
    if (this.status !== 'running' || !(dt > 0)) return;
    this.time += dt;
    this.descend(dt);
    if (this.checkBreach()) {
      this.compact();
      if (this.bossRt !== null) this.syncBossState();
      return;
    }
    this.updatePlayer(dt, input);
    this.updateEnemies(dt);
    // 보스 행동 (보스전만): 페이즈 전환·스케줄러·발사·위험 지역·소환 — 새 졸개는 이번 스텝 조준·충돌부터 들어간다
    if (this.bossRt !== null) this.updateBoss(dt);
    this.fireWeapons(dt, inputAim(input));
    this.rebuildColumns();
    this.updateProjectiles(dt);
    this.updateEnemyShots(dt);
    if (this.hz.length > 0) this.updateHazards(dt);
    // 적 몸에 닿으면 즉시 패배 (이번 스텝에 죽은 적은 빼고 — 마지막 적을 잡으며 닿으면 승리)
    if (this.touchesEnemy()) this.lose('contact');
    else if (this.player.hp <= 0) this.lose('hp');
    else if (this.cleared()) this.win();
    this.compact();
    if (this.bossRt !== null) this.syncBossState();
  }

  setLoadout(loadout: WeaponLoadout[], player: PlayerStats): void {
    const prev = new Map<number, WeaponRuntime>();
    for (const w of this.weapons) prev.set(w.uid, w);
    this.loadout = new Map();
    this.weapons.length = 0;
    for (const l of loadout) {
      this.loadout.set(l.uid, l);
      const old = prev.get(l.uid);
      if (old) {
        prev.delete(l.uid);
        old.timer = Math.min(old.timer, l.cooldown);
        old.cooldown = l.cooldown;
        this.weapons.push(old);
        continue;
      }
      // 이번 전투에서 뺐던 무기를 다시 넣으면 남은 쿨타임을 이어서 쓴다 (빼고 넣기로 쿨 초기화 방지)
      const readyAt = this.benched.get(l.uid);
      this.benched.delete(l.uid);
      const wait = readyAt === undefined ? NEW_WEAPON_MAX_DELAY : Math.max(0, readyAt - this.time);
      this.weapons.push({ uid: l.uid, timer: Math.min(l.cooldown, wait), cooldown: l.cooldown });
    }
    for (const w of prev.values()) this.benched.set(w.uid, this.time + Math.max(0, w.timer));
    // 연사 중이던 무기를 뺐으면 남은 발은 버린다
    this.bursts = this.bursts.filter((b) => this.loadout.has(b.uid));

    // 최대 HP가 이번 전투 최고치를 넘은 만큼만 hp도 늘린다 (같은 장비를 빼고 넣어도 회복되지 않음)
    const pl = this.player;
    const gain = Math.max(0, player.maxHp - this.peakMaxHp);
    this.peakMaxHp = Math.max(this.peakMaxHp, player.maxHp);
    pl.maxHp = player.maxHp;
    pl.hp += gain;
    if (pl.hp > pl.maxHp) pl.hp = pl.maxHp;
    this.stats = player;
  }

  /** 디버그: 남은 적을 전부 정상 처치 경로로 죽인다 ('kill' 이벤트들 + 'won'). 보스전이면 보스 처치 → 졸개가 함께 터짐 */
  debugKillAll(): void {
    if (this.status !== 'running') return;
    for (const e of this.es) this.kill(e);
    if (this.cleared()) this.win();
    this.compact();
    if (this.bossRt !== null) this.syncBossState();
  }

  /** 디버그: 즉시 패배 (사유 'hp', 'lost' 이벤트) */
  debugLose(): void {
    this.lose('hp');
  }

  drainEvents(): CombatEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** 일반 스테이지 = 처치 수 / 전체, 보스전 = 보스에게 준 피해 비율(1 - 보스 HP / 최대 HP, 처치하면 1) */
  progress(): number {
    if (this.bossRt !== null) {
      const b = this.bossRt.e;
      return b.alive ? 1 - Math.max(0, b.hp) / b.maxHp : 1;
    }
    return this.totalEnemies > 0 ? this.killedEnemies / this.totalEnemies : 1;
  }

  /** 승리 조건: 일반 스테이지 = 모든 적 처치, 보스전 = 보스 처치 */
  private cleared(): boolean {
    return this.bossRt !== null ? !this.bossRt.e.alive : this.killedEnemies >= this.totalEnemies;
  }

  // ── 초기화 ──────────────────────────────────────────────────

  private spawnEnemies(defs: Record<string, EnemyDef>): void {
    const { rows, legend, hpMul } = this.stage;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (let c = 0; c < FIELD_COLS && c < row.length; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        const defId = legend[ch];
        const def = defId === undefined ? undefined : defs[defId];
        if (!def) {
          throw new Error(`CombatSim: stage '${this.stage.id}' row ${i} col ${c}: no enemy for '${ch}'`);
        }
        // 좌하단 문자 기준으로 오른쪽 w칸, 위로 h칸
        const top = -(i + def.h) * CELL - SPAWN_GAP;
        const hp = Math.max(1, Math.round(def.hp * hpMul));
        const atk = def.attack;
        const e: Enemy = {
          id: this.nextId++,
          defId,
          x: c * CELL + ENEMY_INSET,
          y: top + ENEMY_INSET,
          w: def.w * CELL - 2 * ENEMY_INSET,
          h: def.h * CELL - 2 * ENEMY_INSET,
          hp,
          maxHp: hp,
          alive: true,
          boss: def.boss === true,
          burnDps: 0,
          burnTime: 0,
          chillTime: 0,
          attackTimer: atk ? atk.interval + this.rng.next() * atk.jitter : 0,
          flash: 0,
          def,
          chillAttackRate: chillResistant(def) ? CHILL_ATTACK_RATE_RESIST : CHILL_ATTACK_RATE,
          stamp: 0,
          burnAcc: 0,
          burnTick: 0,
          landing: 0,
        };
        this.es.push(e);
        this.byId.set(e.id, e);
      }
    }
    this.totalEnemies = this.es.length;
  }

  // ── 스텝 단계 ───────────────────────────────────────────────

  // 배열 순회는 for...of 대신 인덱스 루프 (반복자 객체 할당 없음, 길이는 매번 다시 읽어 for...of와 같은 순서·범위)

  private descend(dt: number): void {
    if (this.bossRt !== null) {
      this.descendBossStage(dt);
      return;
    }
    const es = this.es;
    let visible = false;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.alive && e.y + e.h > 0) {
        visible = true;
        break;
      }
    }
    const dy = this.stage.descentSpeed * (visible ? 1 : DESCENT_FAST_FORWARD) * dt;
    for (let i = 0; i < es.length; i++) es[i].y += dy;
  }

  private checkBreach(): boolean {
    const es = this.es;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.alive && e.y + e.h >= FIELD_H) {
        this.lose('breach');
        return true;
      }
    }
    return false;
  }

  private updatePlayer(dt: number, input: CombatInput): void {
    const pl = this.player;
    const ix = input.targetX;
    const iy = input.targetY;
    const hasX = typeof ix === 'number' && Number.isFinite(ix);
    const hasY = typeof iy === 'number' && Number.isFinite(iy);
    // 목표를 향해 걷는다: 가속·최고 속도·도착 감속, 필드 벽 안 어디든 (movement.ts). 목표가 없으면 감속해서 선다
    stepPlayerMotion(pl, hasX ? ix : pl.x, hasY ? iy : pl.y, hasX || hasY, this.stats.moveSpeed, dt);
    if (pl.hp > 0 && this.stats.regenPerSec > 0) {
      pl.hp = Math.min(pl.maxHp, pl.hp + this.stats.regenPerSec * dt);
    }
    if (pl.invuln > 0) pl.invuln = tickDown(pl.invuln, dt);
  }

  private updateEnemies(dt: number): void {
    const es = this.es;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (!e.alive) continue;
      if (e.flash > 0) e.flash = tickDown(e.flash, dt);
      if (e.landing > 0) e.landing = tickDown(e.landing, dt);
      if (e.chillTime > 0) e.chillTime = tickDown(e.chillTime, dt);

      if (e.burnTime > 0) {
        let d = e.burnDps * Math.min(dt, e.burnTime);
        // 보스: 포효 중 무적, 페이즈 문턱에서 멈춤 (일반 적은 그대로)
        const bossHit = this.bossRt !== null && e === this.bossRt.e;
        if (bossHit) d = this.bossCap(d);
        e.burnTime -= dt;
        e.hp -= d;
        if (bossHit && this.bossRt!.phasePending) e.hp = this.bossRt!.floor;
        e.burnAcc += d;
        e.burnTick -= dt;
        const ended = e.burnTime <= TIME_EPS;
        if (ended) {
          e.burnTime = 0;
          e.burnDps = 0;
        }
        if (ended || e.burnTick <= 0 || e.hp <= 0) this.flushBurn(e);
        if (e.hp <= 0) {
          this.kill(e);
          continue;
        }
      }

      const atk = e.def.attack;
      if (atk && e.y + e.h > ENEMY_ATTACK_MIN_BOTTOM) {
        // 냉기는 공격을 멈추지 않고 타이머를 느리게 흘린다 (엘리트·보스는 덜 느려짐)
        e.attackTimer -= e.chillTime > 0 ? dt * e.chillAttackRate : dt;
        if (e.attackTimer <= TIME_EPS) {
          this.enemyFire(e, atk);
          e.attackTimer = atk.interval;
        }
      }
    }
  }

  private flushBurn(e: Enemy): void {
    const amount = Math.round(e.burnAcc);
    if (amount > 0) {
      this.emit({ type: 'hit', enemyId: e.id, x: e.x + e.w / 2, y: e.y + e.h / 2, damage: amount, element: 'fire' });
    }
    e.burnAcc -= amount;
    e.burnTick = BURN_EVENT_INTERVAL;
  }

  private enemyFire(e: Enemy, atk: EnemyAttack): void {
    const ox = e.x + e.w / 2;
    const oy = e.y + e.h;
    const base =
      atk.kind === 'straight' ? Math.PI / 2 : Math.atan2(this.player.y - oy, this.player.x - ox);
    const n = Math.max(1, Math.floor(atk.count));
    const spread = atk.spreadDeg * DEG;
    const damage = atk.damage * this.stage.dmgMul;
    for (let k = 0; k < n; k++) {
      const a = fanAngle(base, spread, k, n);
      this.enemyShots.push({
        id: this.nextId++,
        x: ox,
        y: oy,
        vx: Math.cos(a) * atk.projSpeed,
        vy: Math.sin(a) * atk.projSpeed,
        radius: atk.radius,
        damage,
        sprite: atk.sprite,
        alive: true,
      });
    }
    this.emit({ type: 'enemyShoot', enemyId: e.id, x: ox, y: oy });
  }

  /** aim: 이번 스텝의 수동 조준각(clamp 끝남) 또는 null(자동조준) */
  private fireWeapons(dt: number, aim: number | null): void {
    // 대상(수동 조준이면 '보이는 적이 있는가' 판정용)은 이 단계에서 바뀌지 않으므로(투사체는 아직 안 움직임)
    // 스텝마다 한 번만 찾는다
    let target: Enemy | null | undefined;
    if (this.bursts.length > 0) target = this.fireBursts(dt, aim);
    const weapons = this.weapons;
    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i];
      w.timer -= dt;
      if (w.timer > TIME_EPS) continue;
      if (target === undefined) target = this.findTarget();
      const l = this.loadout.get(w.uid);
      // 보이는 적이 없으면 수동 조준이어도 쏘지 않고 준비된 채 대기
      if (!target || !l) {
        w.timer = 0;
        continue;
      }
      this.fireWeapon(l, aim ?? this.angleTo(target), aim !== null);
      if (w.timer < 0) w.timer = 0;
      w.timer += w.cooldown;
    }
  }

  /**
   * 대기 중인 연사의 다음 발들. 발마다 그 순간의 방향을 다시 잡는다: 수동 조준이면 지금의 조준각(지터 없음),
   * 아니면 자동조준 대상(없으면 직전 방향, 지터). 자동조준이면 찾은 대상을 반환해 무기 단계가 재사용한다.
   */
  private fireBursts(dt: number, aim: number | null): Enemy | null | undefined {
    const target = aim === null ? this.findTarget() : undefined;
    let w = 0;
    for (let i = 0; i < this.bursts.length; i++) {
      const b = this.bursts[i];
      b.timer -= dt;
      const l = this.loadout.get(b.uid);
      while (l && b.left > 0 && b.timer <= TIME_EPS) {
        const ox = this.player.x;
        const oy = this.player.y - FIRE_OFFSET_Y;
        if (aim !== null) b.angle = aim;
        else if (target) b.angle = this.angleTo(target);
        this.launch(l, ox, oy, aim !== null ? b.angle : b.angle + this.jitter());
        this.emit({ type: 'fire', weaponUid: l.uid, x: ox, y: oy, count: 1 });
        b.left -= 1;
        b.timer += BURST_INTERVAL;
      }
      if (l && b.left > 0) this.bursts[w++] = b;
    }
    this.bursts.length = w;
    return target;
  }

  /** 발사 위치(플레이어 위 FIRE_OFFSET_Y)에서 적 중심으로의 각도 */
  private angleTo(t: Enemy): number {
    const ox = this.player.x;
    const oy = this.player.y - FIRE_OFFSET_Y;
    return Math.atan2(t.y + t.h / 2 - oy, t.x + t.w / 2 - ox);
  }

  /** 보이는 적 중 아래 끝이 가장 낮은 적, 동률이면 플레이어와 x가 가까운 적 */
  private findTarget(): Enemy | null {
    const px = this.player.x;
    let best: Enemy | null = null;
    let bestBottom = -Infinity;
    let bestDx = Infinity;
    const es = this.es;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (!e.alive) continue;
      const bottom = e.y + e.h;
      if (bottom <= 0) continue;
      const dx = Math.abs(e.x + e.w / 2 - px);
      if (bottom > bestBottom + AIM_TIE_EPS) {
        best = e;
        bestBottom = bottom;
        bestDx = dx;
      } else if (bottom >= bestBottom - AIM_TIE_EPS && dx < bestDx) {
        best = e;
        bestBottom = Math.max(bestBottom, bottom);
        bestDx = dx;
      }
    }
    return best;
  }

  /** base: 발사 중심 방향. exact(수동 조준)면 지터 없이 정확히 그 방향(부채꼴도 base 중심) */
  private fireWeapon(l: WeaponLoadout, base: number, exact: boolean): void {
    const ox = this.player.x;
    const oy = this.player.y - FIRE_OFFSET_Y;
    const n = Math.max(1, Math.floor(l.count));
    if (n > 1 && !(l.spreadDeg > 0)) {
      // 부채꼴 없는 다발(예: 분신 거울을 붙인 단발 무기)은 겹쳐 나가지 않게 연사로
      this.launch(l, ox, oy, exact ? base : base + this.jitter());
      this.emit({ type: 'fire', weaponUid: l.uid, x: ox, y: oy, count: 1 });
      this.bursts.push({ uid: l.uid, left: n - 1, timer: BURST_INTERVAL, angle: base });
      return;
    }
    const spread = l.spreadDeg * DEG;
    for (let k = 0; k < n; k++) {
      const a = fanAngle(base, spread, k, n);
      // 수동 조준: 낮게 쏠 때 부채꼴 바깥 발이 아래로 나가 바닥으로 버려지지 않게 발마다 위쪽 반원으로 접는다
      // (가운데 발은 조준각 그대로 — 조준 가이드와 일치)
      this.launch(l, ox, oy, exact ? clampAim(a) : a + this.jitter());
    }
    this.emit({ type: 'fire', weaponUid: l.uid, x: ox, y: oy, count: n });
  }

  private jitter(): number {
    return this.rng.range(-FIRE_JITTER_DEG, FIRE_JITTER_DEG) * DEG;
  }

  private launch(l: WeaponLoadout, ox: number, oy: number, a: number): void {
    this.ps.push({
      id: this.nextId++,
      weaponUid: l.uid,
      x: ox,
      y: oy,
      vx: Math.cos(a) * l.speed,
      vy: Math.sin(a) * l.speed,
      radius: l.radius,
      damage: l.damage,
      pierceLeft: l.pierce,
      bouncesLeft: l.maxBounces > 0 ? l.maxBounces : Infinity,
      elements: l.elements,
      explodeRadius: l.explodeRadius,
      split: l.split,
      sprite: l.sprite,
      spin: l.spin,
      age: 0,
      alive: true,
      maxAge: PROJECTILE_MAX_AGE,
      // 선택 필드도 처음부터 같은 순서로 만들어 둔다 (값은 undefined = 없음과 같다) — 투사체 객체가 모두 같은
      // 숨은 클래스를 쓰게 해서, 필드가 나중에 붙으며 모양이 여러 가지로 갈라지면 생기던 메가모픽 쓰기
      // (p.x 갱신마다 숫자 상자 할당 — 측정: 시뮬레이션 할당의 ~95%)를 없앤다. tests/sim-alloc.test.ts가 지킨다
      lastHit: undefined,
      passing: undefined,
      ghost: undefined,
      trapBounces: undefined,
      bossHitAt: undefined,
    });
  }

  private rebuildColumns(): void {
    const columns = this.columns;
    for (let c = 0; c < columns.length; c++) columns[c].length = 0;
    const es = this.es;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      // 화면 위(y+h ≤ 0)의 적에는 투사체가 닿을 수 없다 (상단 벽)
      if (!e.alive || e.y + e.h <= 0) continue;
      const c1 = colOf(e.x + e.w);
      for (let c = colOf(e.x); c <= c1; c++) columns[c].push(e);
    }
  }

  // ── 투사체 ──────────────────────────────────────────────────

  private updateProjectiles(dt: number): void {
    // 이번 스텝에 생긴 분열 자식은 다음 스텝부터 움직인다
    const count = this.ps.length;
    for (let i = 0; i < count; i++) {
      const p = this.ps[i];
      if (!p.alive) continue;
      p.age += dt;
      if (p.age > (p.maxAge ?? PROJECTILE_MAX_AGE)) {
        p.alive = false;
        continue;
      }
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      let n = Math.ceil((speed * dt) / (p.radius * 0.8));
      if (!(n >= 1)) n = 1;
      else if (n > MAX_SUBSTEPS) n = MAX_SUBSTEPS;
      const h = dt / n;
      for (let s = 0; s < n; s++) {
        this.subX = p.x;
        this.subY = p.y;
        p.x += p.vx * h;
        p.y += p.vy * h;
        // 천장에 걸친 적의 아랫면은 천장보다 앞에 있다 — 그 적과 겹쳤으면 적을 먼저 처리
        const topLater = p.y - p.radius < 0 && this.underEnemy(p);
        this.collideWalls(p, !topLater);
        if (p.alive) this.collideEnemies(p);
        if (topLater && p.alive) this.collideWalls(p, true);
        if (p.alive && p.y - p.radius > FIELD_H) p.alive = false;
        if (!p.alive) break;
      }
    }
  }

  private collideWalls(p: Projectile, top: boolean): void {
    const r = p.radius;
    if (p.x - r < 0) {
      p.x = r;
      if (p.vx < 0) this.wallBounce(p, 1, 0, 0, p.y);
    } else if (p.x + r > FIELD_W) {
      p.x = FIELD_W - r;
      if (p.vx > 0) this.wallBounce(p, -1, 0, FIELD_W, p.y);
    }
    if (top && p.alive && p.y - r < 0) {
      p.y = r;
      if (p.vy < 0) this.wallBounce(p, 0, 1, p.x, 0);
    }
  }

  /** 통과 중이 아닌 적과 그 아랫면 쪽(중심이 아랫변보다 아래)에서 겹치는가 */
  private underEnemy(p: Projectile): boolean {
    const r = p.radius;
    const c1 = colOf(p.x + r);
    for (let c = colOf(p.x - r); c <= c1; c++) {
      const col = this.columns[c];
      for (let j = 0; j < col.length; j++) {
        const e = col[j];
        if (!e.alive || p.y <= e.y + e.h || (p.passing && p.passing.includes(e.id))) continue;
        if (overlapsRect(p.x, p.y, r, e)) return true;
      }
    }
    return false;
  }

  private wallBounce(p: Projectile, nx: number, ny: number, x: number, y: number): void {
    if (p.bouncesLeft <= 0) {
      p.alive = false;
      return;
    }
    p.bouncesLeft -= 1;
    const v = bounceVelocityInto(this.vel, p.vx, p.vy, nx, ny);
    p.vx = v.vx;
    p.vy = v.vy;
    this.emit({ type: 'bounce', x, y, wall: true });
  }

  /** 이번 서브스텝 시작 위치(subX, subY)는 고속 충돌의 진입면 판정에 쓴다 */
  private collideEnemies(p: Projectile): void {
    if (p.ghost || (p.passing && p.passing.length > 0)) this.prunePassing(p);
    const r = p.radius;
    const stamp = ++this.stampSeq;
    const c1 = colOf(p.x + r);
    const ct = this.ct;
    let n = 0;
    for (let c = colOf(p.x - r); c <= c1; c++) {
      const col = this.columns[c];
      for (let j = 0; j < col.length; j++) {
        const e = col[j];
        if (e.stamp === stamp) continue;
        e.stamp = stamp;
        if (!e.alive || !aabbOverlap(p, e)) continue;
        if (!circleRectContactInto(ct, p.x, p.y, r, e.x, e.y, e.w, e.h)) continue;
        if (this.tryPierce(p, e)) continue;
        const h = this.hits[n] ?? (this.hits[n] = newHit());
        n++;
        h.e = e;
        // 중심까지 파고들었으면 최소 침투 축 대신 실제로 들어온 면을 쓴다
        if (!(centerInside(p, e) && entryContactInto(h, this.subX, this.subY, p.x, p.y, r, e))) {
          h.nx = ct.nx;
          h.ny = ct.ny;
          h.depth = ct.depth;
        }
      }
    }
    this.hitCount = n;
    if (n > 0) this.resolveBounce(p);
  }

  /** 관통으로 처리했거나(통과 중 포함) 무시해야 하면 true */
  private tryPierce(p: Projectile, e: Enemy): boolean {
    const passing = p.passing;
    if (p.ghost) {
      if (!passing) p.passing = [e.id];
      else if (!passing.includes(e.id)) passing.push(e.id);
      return true;
    }
    if (passing && passing.includes(e.id)) {
      if (p.pierceLeft > 0 && this.canRehit(p, e.id)) this.pierceHit(p, e);
      return true;
    }
    if (p.pierceLeft <= 0) return false;
    if (this.canRehit(p, e.id)) this.pierceHit(p, e);
    (p.passing ??= []).push(e.id);
    return true;
  }

  private canRehit(p: Projectile, enemyId: number): boolean {
    const last = p.lastHit?.get(enemyId);
    return last === undefined || this.time - last >= PIERCE_REHIT_TIME - TIME_EPS;
  }

  private pierceHit(p: Projectile, e: Enemy): void {
    p.pierceLeft -= 1;
    (p.lastHit ??= new Map()).set(e.id, this.time);
    this.projectileHit(p, e, clamp(p.x, e.x, e.x + e.w), clamp(p.y, e.y, e.y + e.h));
    if (p.split) this.spawnSplit(p, p.vx, p.vy, e.id);
  }

  /** 접촉 목록 = this.hits의 앞 hitCount개 (collideEnemies가 채움) */
  private resolveBounce(p: Projectile): void {
    // 실제로 파고드는 접촉만 피해·반사 대상. 주 대상 = 가장 깊은 접촉
    let primary: Hit | null = null;
    let nx = 0;
    let ny = 0;
    const hits = this.hits;
    for (let i = 0; i < this.hitCount; i++) {
      const h = hits[i];
      if (p.vx * h.nx + p.vy * h.ny >= 0) continue;
      nx += h.nx;
      ny += h.ny;
      if (!primary || h.depth > primary.depth) primary = h;
    }
    if (!primary) {
      this.pushOut(p);
      return;
    }

    const len = Math.sqrt(nx * nx + ny * ny);
    if (len > 1e-6) {
      nx /= len;
      ny /= len;
    } else {
      const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
      nx = -p.vx / sp;
      ny = -p.vy / sp;
    }
    const v = bounceVelocityInto(this.vel, p.vx, p.vy, nx, ny);
    // 임시 객체라 바로 꺼내 둔다
    const vx = v.vx;
    const vy = v.vy;
    const e = primary.e;
    const hx = clamp(p.x, e.x, e.x + e.w);
    const hy = clamp(p.y, e.y, e.y + e.h);
    this.projectileHit(p, e, hx, hy);

    const dying = p.bouncesLeft <= 0;
    if (!dying) {
      p.bouncesLeft -= 1;
      p.vx = vx;
      p.vy = vy;
      this.emit({ type: 'bounce', x: hx, y: hy, wall: false });
      // 뚫은 적 몸속에서 이웃 적들 사이를 계속 오가면 갇힌 것 — 빠져나올 때까지 통과
      if (p.passing && p.passing.length > 0) {
        p.trapBounces = (p.trapBounces ?? 0) + 1;
        if (p.trapBounces >= TRAP_BOUNCES) p.ghost = true;
      }
    }
    this.pushOut(p);
    if (p.split) this.spawnSplit(p, vx, vy, e.id);
    if (dying) p.alive = false;
  }

  /** 겹친 적에서 법선 방향으로 밀어낸다. 끝내 못 빠져나오면 겹친 적들을 통과시킨다 */
  private pushOut(p: Projectile): void {
    for (let it = 0; it < PUSH_ITERATIONS; it++) {
      const h = this.scanBlocking(p, false);
      if (!h) return;
      p.x += h.nx * (h.depth + PUSH_EPS);
      p.y += h.ny * (h.depth + PUSH_EPS);
      const r = p.radius;
      p.x = clamp(p.x, r, FIELD_W - r);
      if (p.y < r) p.y = r;
    }
    // 적 사이(또는 벽과 적 사이)에 끼었다 — 무한 핑퐁 대신 빠져나올 때까지 통과
    p.ghost = true;
    this.scanBlocking(p, true);
  }

  /**
   * 통과 중이 아닌 겹친 적 중 가장 깊은 접촉. ghost면 겹친 적 전부를 통과 목록에 넣는다.
   * 반환값은 재사용 객체(this.block) — 다음 호출 전에 읽고 버린다.
   */
  private scanBlocking(p: Projectile, ghost: boolean): Hit | null {
    const r = p.radius;
    const stamp = ++this.stampSeq;
    const c1 = colOf(p.x + r);
    const ct = this.ct;
    const best = this.block;
    let found = false;
    for (let c = colOf(p.x - r); c <= c1; c++) {
      const col = this.columns[c];
      for (let j = 0; j < col.length; j++) {
        const e = col[j];
        if (e.stamp === stamp) continue;
        e.stamp = stamp;
        if (!e.alive || !aabbOverlap(p, e)) continue;
        if (p.passing && p.passing.includes(e.id)) continue;
        if (!circleRectContactInto(ct, p.x, p.y, r, e.x, e.y, e.w, e.h)) continue;
        if (ghost) (p.passing ??= []).push(e.id);
        else if (!found || ct.depth > best.depth) {
          found = true;
          best.e = e;
          best.nx = ct.nx;
          best.ny = ct.ny;
          best.depth = ct.depth;
        }
      }
    }
    return found ? best : null;
  }

  /**
   * 통과 목록 정리. 죽은 적은 빼고, 남은 적 중 하나라도 겹쳐 있으면(터널 안) 유지,
   * 모두 벗어났으면 비우고 ghost 해제. 개별로 빼면 터널 속에서 되돌아올 때 이웃 적에 갇힌다.
   */
  private prunePassing(p: Projectile): void {
    const list = p.passing;
    let inside = false;
    if (list) {
      let w = 0;
      for (let i = 0; i < list.length; i++) {
        const e = this.byId.get(list[i]);
        if (!e || !e.alive) continue;
        list[w++] = list[i];
        if (!inside && overlapsRect(p.x, p.y, p.radius, e)) inside = true;
      }
      list.length = inside ? w : 0;
    }
    if (!inside) {
      p.ghost = false;
      p.trapBounces = 0;
    }
  }

  private projectileHit(p: Projectile, e: Enemy, hx: number, hy: number): void {
    let direct = p.damage;
    if (e.boss) {
      // 보스 연타 감쇠: 같은 공이 BOSS_REHIT_WINDOW 안에 또 때리면 약하게 (보스 위에서 덜그럭거리는 공)
      const last = p.bossHitAt;
      if (last !== undefined && this.time - last < BOSS_REHIT_WINDOW - TIME_EPS) direct *= BOSS_REHIT_DAMAGE_MUL;
      p.bossHitAt = this.time;
    }
    this.damage(e, direct, p.elements, hx, hy, p.elements[0] ?? null);
    if (p.elements.includes('lightning')) this.chain(e, p.damage, p.elements);
    if (p.explodeRadius > 0) this.explode(p.x, p.y, p.explodeRadius, e, p.damage, p.elements);
  }

  private spawnSplit(p: Projectile, dvx: number, dvy: number, fromEnemy: number): void {
    const spec = p.split;
    if (!spec) return;
    p.split = null;
    const n = Math.max(0, Math.floor(spec.count));
    if (n === 0) return;
    const speed = Math.sqrt(dvx * dvx + dvy * dvy);
    const base = Math.atan2(dvy, dvx);
    const fan = SPLIT_FAN_DEG * DEG;
    for (let k = 0; k < n; k++) {
      const a = fanAngle(base, fan, k, n);
      const child: Projectile = {
        id: this.nextId++,
        weaponUid: p.weaponUid,
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        radius: spec.radius,
        damage: p.damage * spec.damageMul,
        pierceLeft: 0,
        bouncesLeft: Infinity,
        elements: p.elements,
        explodeRadius: 0,
        split: null,
        sprite: spec.sprite,
        spin: p.spin,
        age: 0,
        alive: true,
        maxAge: SPLIT_CHILD_MAX_AGE,
        // launch와 같은 모양(필드 순서)으로 — launch 주석 참고
        lastHit: undefined,
        // 태어난 자리의 적을 곧바로 다시 때리지 않게
        passing: [fromEnemy],
        ghost: undefined,
        trapBounces: undefined,
        bossHitAt: undefined,
      };
      this.ps.push(child);
    }
    this.emit({ type: 'split', x: p.x, y: p.y, count: n });
  }

  // ── 피해 ────────────────────────────────────────────────────

  /** 피해 + 불/얼음 상태이상. 번개 연쇄·폭발은 직접 적중(projectileHit)에서만 */
  private damage(
    e: Enemy,
    base: number,
    elements: readonly Element[],
    x: number,
    y: number,
    element: Element | null,
  ): void {
    if (!e.alive) return;
    let dealt = base * (e.chillTime > 0 ? CHILL_DAMAGE_TAKEN_MUL : 1);
    const rt = this.bossRt;
    if (rt !== null && e === rt.e) {
      // 보스: 포효 중 무적(피해·상태이상 없음), 페이즈 문턱을 넘는 피해는 문턱에서 멈춘다 (다음 updateBoss에서 전환)
      dealt = this.bossCap(dealt);
      if (!(dealt > 0)) return;
      e.hp -= dealt;
      if (rt.phasePending) e.hp = rt.floor;
    } else e.hp -= dealt;
    e.flash = HIT_FLASH_TIME;
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (el === 'fire') this.ignite(e, dealt);
      else if (el === 'ice') e.chillTime = CHILL_DURATION;
    }
    this.emit({ type: 'hit', enemyId: e.id, x, y, damage: Math.round(dealt), element });
    if (e.hp <= 0) this.kill(e);
  }

  private ignite(e: Enemy, dealt: number): void {
    if (e.burnTime <= 0) {
      e.burnDps = 0;
      e.burnAcc = 0;
      e.burnTick = BURN_EVENT_INTERVAL;
    }
    e.burnDps = Math.max(e.burnDps, dealt * BURN_RATIO);
    e.burnTime = BURN_DURATION;
  }

  private chain(src: Enemy, base: number, elements: readonly Element[]): void {
    const sx = src.x + src.w / 2;
    const sy = src.y + src.h / 2;
    const range2 = CHAIN_RANGE * CHAIN_RANGE;
    // 후보 객체·배열은 재사용 (연쇄는 연쇄를 부르지 않으므로 겹쳐 쓰일 일이 없다)
    const picks = this.picks;
    const pool = this.pickPool;
    let count = 0;
    const es = this.es;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e === src || !e.alive || e.y + e.h <= 0) continue;
      const dx = e.x + e.w / 2 - sx;
      const dy = e.y + e.h / 2 - sy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= range2) {
        const pk = pool[count] ?? (pool[count] = { e, d2 });
        pk.e = e;
        pk.d2 = d2;
        picks[count++] = pk;
      }
    }
    picks.length = count;
    if (count === 0) return;
    picks.sort(byDistanceThenId);
    const dmg = base * CHAIN_DAMAGE_MUL;
    const n = Math.min(CHAIN_TARGETS, count);
    for (let i = 0; i < n; i++) {
      const t = picks[i].e;
      const tx = t.x + t.w / 2;
      const ty = t.y + t.h / 2;
      this.emit({ type: 'chain', fromX: sx, fromY: sy, toX: tx, toY: ty });
      this.damage(t, dmg, elements, tx, ty, 'lightning');
    }
  }

  private explode(
    x: number,
    y: number,
    radius: number,
    src: Enemy,
    base: number,
    elements: readonly Element[],
  ): void {
    const element = firstStatusElement(elements);
    this.emit({ type: 'explode', x, y, radius, element });
    const dmg = base * EXPLODE_DAMAGE_MUL;
    const es = this.es;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e === src || !e.alive || e.y + e.h <= 0) continue;
      if (!overlapsRect(x, y, radius, e)) continue;
      this.damage(e, dmg, elements, e.x + e.w / 2, e.y + e.h / 2, element);
    }
  }

  private kill(e: Enemy): void {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    this.killedEnemies++;
    this.emit({ type: 'kill', enemyId: e.id, defId: e.defId, x: e.x + e.w / 2, y: e.y + e.h / 2, boss: e.boss });
    if (this.bossRt !== null && e === this.bossRt.e) this.bossDefeated();
  }

  // ── 적 탄 / 접촉 (적 몸에 닿으면 즉시 패배 — step의 touchesEnemy) ──────────────

  private updateEnemyShots(dt: number): void {
    const pl = this.player;
    const shots = this.enemyShots;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (!s.alive) continue;
      const ox = s.x;
      const oy = s.y;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      // 이동 선분으로 판정해 빠른 탄도 플레이어를 건너뛰지 않게
      if (pl.invuln <= 0 && segmentHitsCircle(ox, oy, s.x, s.y, pl.x, pl.y, s.radius + pl.hitRadius)) {
        s.alive = false;
        this.hurtPlayer(s.damage, 'shot', s.x, s.y);
        continue;
      }
      const r = s.radius;
      if (s.x + r < 0 || s.x - r > FIELD_W || s.y + r < 0 || s.y - r > FIELD_H) s.alive = false;
    }
  }

  /** 플레이어 피격 원이 살아있는 적의 충돌 박스와 겹치는가 (무적 시간과 무관) */
  private touchesEnemy(): boolean {
    const pl = this.player;
    const es = this.es;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      // 소환 중(입에서 날아오는 중)인 졸개는 아직 몸이 없다 — 내려앉은 뒤부터 (Enemy.landing)
      if (e.alive && e.landing <= 0 && overlapsRect(pl.x, pl.y, pl.hitRadius, e)) return true;
    }
    return false;
  }

  private hurtPlayer(damage: number, source: 'shot' | 'hazard', x: number, y: number): void {
    const pl = this.player;
    pl.hp -= damage;
    pl.invuln = PLAYER_INVULN_TIME;
    this.emit({ type: 'playerHit', damage: Math.round(damage), x, y, source });
  }

  // ── 보스전 (stage.boss가 있을 때만 — 일반 스테이지는 이 아래를 하나도 지나가지 않는다) ──────────
  // 보스: 고정 위치(BossDef.anchorCol/anchorY)로 내려와(enter) 포효(roar, 무적) → 쉬기(idle, 페이즈 gap) → 행동 고르기(시드 RNG, 가중치·쿨타임)
  // → 예비 동작(windup) → 실행(act: 펄스 = 발사·위험 지역·소환 한 번씩) → 자기 위험 지역이 끝나고 recover → 다시 idle.
  // HP가 다음 페이즈 문턱에 닿으면 그 피해는 문턱에서 멈추고 다음 updateBoss에서 페이즈 전환(행동 취소 + 포효 + 소환).
  // 졸개는 보스 바로 아래 줄 칸에 생겨 스테이지 하강 속도로 내려온다(일반 적과 같은 규칙: 공격·방어선·접촉). 보스가 죽으면 졸개가 함께 터진다.

  private spawnBoss(bossId: string, opts: CombatSimOptions): BossRuntime {
    const def = opts.bosses?.[bossId];
    if (!def) throw new Error(`CombatSim: stage '${this.stage.id}': no boss def '${bossId}' (pass opts.bosses)`);
    const edef = opts.enemies[def.enemy];
    if (!edef) throw new Error(`CombatSim: boss '${bossId}': no enemy '${def.enemy}'`);
    if (def.phases.length === 0) throw new Error(`CombatSim: boss '${bossId}' has no phases`);
    const hp = Math.max(1, Math.round(edef.hp * this.stage.hpMul));
    const e: Enemy = {
      id: this.nextId++,
      defId: edef.id,
      x: def.anchorCol * CELL + ENEMY_INSET,
      // 화면 바로 위(칸 아래 끝 = 천장)에서 시작해 고정 위치까지 내려온다
      y: -edef.h * CELL + ENEMY_INSET,
      w: edef.w * CELL - 2 * ENEMY_INSET,
      h: edef.h * CELL - 2 * ENEMY_INSET,
      hp,
      maxHp: hp,
      alive: true,
      boss: true,
      burnDps: 0,
      burnTime: 0,
      chillTime: 0,
      attackTimer: 0,
      flash: 0,
      def: edef,
      chillAttackRate: CHILL_ATTACK_RATE_RESIST,
      stamp: 0,
      burnAcc: 0,
      burnTick: 0,
      landing: 0,
    };
    this.es.push(e);
    this.byId.set(e.id, e);
    this.totalEnemies++;
    return {
      def,
      e,
      anchorY: def.anchorY + ENEMY_INSET,
      phase: 0,
      mode: 'enter',
      modeTime: 0,
      gap: 0,
      cds: def.actions.map(() => 0),
      act: null,
      actSeq: 0,
      pulsesLeft: 0,
      pulseTimer: 0,
      pulse: 0,
      tail: 0,
      ringGap: -1,
      ringDir: 1,
      volleyBase: Math.PI / 2,
      floor: def.phases.length > 1 ? hp * def.phases[1].hpFrac : 0,
      phasePending: false,
    };
  }

  /** 보스전 하강: 졸개는 스테이지 하강 속도(빨리감기 없음 — 보스가 늘 화면에 있다), 보스는 등장 → 고정, creep 페이즈만 기어 내려옴 */
  private descendBossStage(dt: number): void {
    const rt = this.bossRt!;
    const b = rt.e;
    const es = this.es;
    const dy = this.stage.descentSpeed * dt;
    for (let i = 0; i < es.length; i++) if (es[i] !== b) es[i].y += dy;
    if (!b.alive) return;
    if (rt.mode === 'enter') {
      if (rt.def.enterSpeed > 0) b.y += rt.def.enterSpeed * dt;
      if (b.y >= rt.anchorY || !(rt.def.enterSpeed > 0)) {
        b.y = rt.anchorY;
        this.startPhase(0);
      }
      return;
    }
    const creep = rt.def.phases[rt.phase].creep;
    if (creep > 0 && rt.mode !== 'roar' && rt.mode !== 'dead') b.y += creep * dt;
  }

  /** 페이즈 p 시작: 진행 중이던 행동 취소(이미 나간 탄·위험 지역은 그대로) → 포효(무적·행동 정지) + 소환 */
  private startPhase(p: number): void {
    const rt = this.bossRt!;
    const phases = rt.def.phases;
    const ph = phases[p];
    rt.phase = p;
    rt.phasePending = false;
    rt.floor = p + 1 < phases.length ? rt.e.maxHp * phases[p + 1].hpFrac : 0;
    rt.act = null;
    rt.pulsesLeft = 0;
    rt.tail = 0;
    rt.mode = 'roar';
    rt.modeTime = ph.roar;
    rt.gap = ph.gap;
    this.emit({ type: 'bossPhase', enemyId: rt.e.id, phase: p, roar: ph.roar });
    if (ph.enterSummon > 0) this.summon(ph.enterSummon);
  }

  /**
   * 보스가 받을 피해 d를 자른다: 포효 중(또는 페이즈 전환 대기 중) 0, 다음 페이즈 문턱을 넘으면 문턱까지만(전환 예약).
   * 보스(this.bossRt.e)에만 부른다.
   */
  private bossCap(d: number): number {
    const rt = this.bossRt!;
    if (rt.mode === 'roar' || rt.phasePending) return 0;
    if (rt.floor > 0) {
      const room = rt.e.hp - rt.floor;
      if (d >= room) {
        rt.phasePending = true;
        return room > 0 ? room : 0;
      }
    }
    return d;
  }

  private updateBoss(dt: number): void {
    const rt = this.bossRt!;
    if (!rt.e.alive || rt.mode === 'enter' || rt.mode === 'dead') return;
    if (rt.phasePending && rt.phase + 1 < rt.def.phases.length) this.startPhase(rt.phase + 1);
    // 냉기: 보스(냉기 저항)는 행동 사이 쉬는 시간·쿨타임이 CHILL_ATTACK_RATE_RESIST 속도로 흐른다.
    // 예비 동작·실행 박자는 그대로 — 예고한 시간이 늘 정확하게
    const slow = rt.e.chillTime > 0 ? dt * rt.e.chillAttackRate : dt;
    const cds = rt.cds;
    for (let i = 0; i < cds.length; i++) if (cds[i] > 0) cds[i] = tickDown(cds[i], slow);
    switch (rt.mode) {
      case 'roar':
        rt.modeTime = tickDown(rt.modeTime, dt);
        if (rt.modeTime <= 0) rt.mode = 'idle';
        return;
      case 'idle':
        if (rt.gap > 0) rt.gap = tickDown(rt.gap, slow);
        if (rt.gap <= 0) this.chooseAction();
        return;
      case 'windup':
        rt.modeTime = tickDown(rt.modeTime, dt);
        if (rt.modeTime > 0) return;
        this.beginAct();
        this.runAct(0);
        return;
      case 'act':
        this.runAct(dt);
        return;
    }
  }

  /** 지금 페이즈 가중치로 쿨타임이 찬 행동 하나 (소환은 졸개가 상한보다 적을 때만). 없으면 다음 스텝에 다시 */
  private chooseAction(): void {
    const rt = this.bossRt!;
    const acts = rt.def.actions;
    const ph = rt.def.phases[rt.phase];
    const canSummon = this.minionsAlive() < ph.minionCap;
    let total = 0;
    for (let i = 0; i < acts.length; i++) total += this.actionWeight(i, canSummon);
    if (!(total > 0)) return;
    let r = this.rng.next() * total;
    let pick = -1;
    for (let i = 0; i < acts.length; i++) {
      const w = this.actionWeight(i, canSummon);
      if (w <= 0) continue;
      pick = i;
      r -= w;
      if (r < 0) break;
    }
    const a = acts[pick];
    rt.act = a;
    rt.actSeq++;
    rt.mode = 'windup';
    rt.modeTime = a.windup;
    rt.cds[pick] = a.cooldown * ph.cooldownMul;
    const b = rt.e;
    this.emit({ type: 'bossAction', enemyId: b.id, action: a.kind, id: a.id, windup: a.windup, x: b.x + b.w / 2, y: b.y + b.h });
  }

  private actionWeight(i: number, canSummon: boolean): number {
    const rt = this.bossRt!;
    const a = rt.def.actions[i];
    if (rt.cds[i] > 0 || (a.kind === 'summon' && !canSummon)) return 0;
    const w = a.weights[rt.phase] ?? 0;
    return w > 0 ? w : 0;
  }

  private beginAct(): void {
    const rt = this.bossRt!;
    const a = rt.act!;
    rt.mode = 'act';
    rt.pulse = 0;
    rt.pulseTimer = 0;
    rt.tail = 0;
    switch (a.kind) {
      case 'volley':
        rt.pulsesLeft = Math.max(1, Math.floor(a.volley.bursts));
        break;
      case 'ring':
        rt.pulsesLeft = Math.max(1, Math.floor(a.ring.waves));
        this.chooseRingGap(a.ring);
        break;
      case 'slam':
        rt.pulsesLeft = Math.max(1, Math.floor(a.slam.repeats));
        break;
      case 'marbles':
        rt.pulsesLeft = Math.max(0, Math.floor(a.marbles.count));
        break;
      case 'summon':
        rt.pulsesLeft = 1;
        break;
    }
  }

  /** 펄스 사이 간격(초). 내려찍기는 앞 위험 지역이 끝난 뒤 repeatInterval 뒤 (한 번에 하나) */
  private pulseInterval(a: BossActionDef): number {
    switch (a.kind) {
      case 'volley':
        return a.volley.burstInterval;
      case 'ring':
        return a.ring.waveInterval;
      case 'slam':
        return a.slam.warn + a.slam.active + a.slam.repeatInterval;
      case 'marbles':
        return a.marbles.stagger;
      case 'summon':
        return 0;
    }
  }

  /** 실행 중: 펄스를 박자대로 → 다 쓰면 이 행동의 위험 지역이 끝나길 기다리고 → recover → idle(페이즈 gap) */
  private runAct(dt: number): void {
    const rt = this.bossRt!;
    const a = rt.act!;
    if (rt.pulsesLeft > 0) {
      rt.pulseTimer -= dt;
      while (rt.pulsesLeft > 0 && rt.pulseTimer <= TIME_EPS) {
        this.actPulse(a, rt.pulse);
        rt.pulse++;
        rt.pulsesLeft--;
        rt.pulseTimer += this.pulseInterval(a);
      }
      if (rt.pulsesLeft === 0) rt.tail = a.recover ?? 0;
      return;
    }
    const hz = this.hz;
    for (let i = 0; i < hz.length; i++) if (hz[i].owner === rt.actSeq && hz[i].state !== 'done') return;
    if (rt.tail > 0) {
      rt.tail = tickDown(rt.tail, dt);
      if (rt.tail > 0) return;
    }
    rt.act = null;
    rt.mode = 'idle';
    rt.gap = rt.def.phases[rt.phase].gap;
  }

  private actPulse(a: BossActionDef, k: number): void {
    switch (a.kind) {
      case 'volley':
        this.bossVolley(a.volley, k);
        return;
      case 'ring':
        this.bossRing(a.ring, k);
        return;
      case 'slam':
        this.bossSlam(a.slam.cols, a.slam.warn, a.slam.active, a.slam.damage, a.slam.sprite);
        return;
      case 'marbles':
        this.bossMarble(a.marbles, k);
        return;
      case 'summon':
        this.summon(a.summon.count);
        return;
    }
  }

  private bossShot(ox: number, oy: number, a: number, spec: BossShotSpec): void {
    this.enemyShots.push({
      id: this.nextId++,
      x: ox,
      y: oy,
      vx: Math.cos(a) * spec.speed,
      vy: Math.sin(a) * spec.speed,
      radius: spec.radius,
      damage: spec.damage * this.stage.dmgMul,
      sprite: spec.sprite,
      alive: true,
    });
  }

  /** 블록 일제 사격 k번째: 입에서 지금 플레이어를 노린 부채꼴 (다시 노리지 않으면 첫 발 방향 + k × burstShiftDeg) */
  private bossVolley(spec: BossShotSpec & { count: number; spreadDeg: number; reaim: boolean; burstShiftDeg: number }, k: number): void {
    const rt = this.bossRt!;
    const b = rt.e;
    const ox = b.x + b.w / 2;
    const oy = b.y + b.h;
    let base: number;
    if (k === 0 || spec.reaim) {
      base = Math.atan2(this.player.y - oy, this.player.x - ox);
      rt.volleyBase = base;
    } else base = rt.volleyBase + k * spec.burstShiftDeg * DEG;
    const n = Math.max(1, Math.floor(spec.count));
    const spread = spec.spreadDeg * DEG;
    for (let k = 0; k < n; k++) this.bossShot(ox, oy, fanAngle(base, spread, k, n), spec);
    this.emit({ type: 'enemyShoot', enemyId: b.id, x: ox, y: oy, sprite: spec.sprite });
  }

  /**
   * 팽이 고리의 빈틈 자리(행동마다 한 번): 플레이어 쪽(가로 ±gapShiftPx 무작위)을 향한 각도에 빈틈 가운데가 오게 —
   * 웨이브마다 돌아가므로 가운데 웨이브 기준. 회전 방향도 여기서 정한다.
   */
  private chooseRingGap(spec: { count: number; arcDeg: number; gap: number; gapShiftPx: number; waves: number; rotateDeg: number }): void {
    const rt = this.bossRt!;
    const b = rt.e;
    const n = Math.max(1, Math.floor(spec.count));
    const gap = ringGapSize(spec.gap, n);
    rt.ringDir = this.rng.next() < 0.5 ? -1 : 1;
    if (gap === 0) {
      rt.ringGap = -1;
      return;
    }
    const pl = this.player;
    const ox = b.x + b.w / 2;
    const oy = b.y + b.h;
    const tx = pl.x + this.rng.range(-spec.gapShiftPx, spec.gapShiftPx);
    // 플레이어가 입보다 위에 있으면(양옆 통로) 그쪽 끝으로 — 각도는 아래 반원 안에서 잰다
    const dy = Math.max(1, pl.y - oy);
    const turns = (Math.max(1, Math.floor(spec.waves)) - 1) / 2;
    const want = Math.atan2(dy, tx - ox) - rt.ringDir * spec.rotateDeg * DEG * turns;
    const arc = spec.arcDeg * DEG;
    const step = n > 1 ? arc / (n - 1) : 0;
    let g0 = step > 0 ? Math.round((want - (Math.PI / 2 - arc / 2)) / step - (gap - 1) / 2) : 0;
    if (g0 < 0) g0 = 0;
    else if (g0 > n - gap) g0 = n - gap;
    rt.ringGap = g0;
  }

  /** 팽이 고리 웨이브 k: 아래쪽 arcDeg 부채꼴에 count발 (빈틈 gap발 빼고), 웨이브마다 rotateDeg씩 회전 */
  private bossRing(spec: BossShotSpec & { count: number; arcDeg: number; gap: number; rotateDeg: number }, k: number): void {
    const rt = this.bossRt!;
    const b = rt.e;
    const ox = b.x + b.w / 2;
    const oy = b.y + b.h;
    const n = Math.max(1, Math.floor(spec.count));
    const gap = ringGapSize(spec.gap, n);
    const arc = spec.arcDeg * DEG;
    const base = Math.PI / 2 + rt.ringDir * spec.rotateDeg * DEG * k;
    for (let j = 0; j < n; j++) {
      if (rt.ringGap >= 0 && j >= rt.ringGap && j < rt.ringGap + gap) continue;
      this.bossShot(ox, oy, fanAngle(base, arc, j, n), spec);
    }
    this.emit({ type: 'enemyShoot', enemyId: b.id, x: ox, y: oy, sprite: spec.sprite });
  }

  /** 내려찍기: 지금 플레이어가 있는 열(2열이면 가까운 이웃 열까지)에 보스 아래 끝부터 바닥까지 */
  private bossSlam(colsIn: number, warn: number, active: number, damage: number, sprite: string): void {
    const b = this.bossRt!.e;
    const pl = this.player;
    const cols = colsIn >= 2 ? 2 : 1;
    const pc = colOf(pl.x);
    let c0 = pc;
    // 2열: 플레이어가 칸의 왼쪽 절반이면 왼쪽 이웃까지 — 플레이어가 폭 가운데쯤에 놓여 어느 쪽으로든 한 칸 + 몸 반지름 안에 빠져나간다
    if (cols === 2 && pl.x - pc * CELL < CELL / 2) c0 = pc - 1;
    if (c0 < 0) c0 = 0;
    else if (c0 > FIELD_COLS - cols) c0 = FIELD_COLS - cols;
    const top = b.y + b.h;
    if (top >= FIELD_H) return;
    this.addHazard('slam', 'rect', c0 * CELL, top, cols * CELL, FIELD_H - top, warn, active, damage, sprite);
  }

  /** 구슬 하나: 처음 aimed개는 플레이어 자리, 나머지는 아래쪽 무작위(다른 구슬과 spacing 이상 — 자리가 없으면 건너뜀) */
  private bossMarble(
    spec: { aimed: number; radius: number; warn: number; active: number; damage: number; spacing: number; yMinFrac: number; sprite: string },
    k: number,
  ): void {
    const b = this.bossRt!.e;
    const pl = this.player;
    const r = spec.radius;
    const yMax = FIELD_H - r;
    let yMin = Math.max(b.y + b.h + r, spec.yMinFrac * FIELD_H);
    if (yMin > yMax) yMin = yMax;
    let cx = clamp(pl.x, r, FIELD_W - r);
    let cy = clamp(pl.y, yMin, yMax);
    if (k < spec.aimed && pl.y < yMin && (pl.x < b.x || pl.x > b.x + b.w)) {
      // 보스 옆 통로(아래쪽 띠보다 위)에 숨은 플레이어: 통로 위는 하늘이 뚫려 있다 — 노린 구슬은 그 자리에 (보스 몸과 겹치지 않게 통로 쪽으로).
      // 없으면 통로가 내려찍기·팽이 고리·구슬이 하나도 닿지 않는 안전 지대였다(일제 사격·졸개 탄만 닿음).
      // 예고는 그대로 — 통로를 따라 (반경 + 몸 반경) 위아래로 비키면 된다
      cy = clamp(pl.y, r, yMax);
      cx = pl.x < b.x ? Math.min(cx, b.x - r) : Math.max(cx, b.x + b.w + r);
    } else if (k >= spec.aimed) {
      let ok = false;
      for (let t = 0; t < MARBLE_TRIES && !ok; t++) {
        cx = this.rng.range(r, FIELD_W - r);
        cy = this.rng.range(yMin, yMax);
        ok = this.marbleClear(cx, cy, spec.spacing);
      }
      if (!ok) return;
    }
    this.addHazard('marble', 'circle', cx - r, cy - r, 2 * r, 2 * r, spec.warn, spec.active, spec.damage, spec.sprite);
  }

  /** (cx, cy)가 아직 안 끝난 다른 구슬 중심들과 spacing 이상 떨어졌나 */
  private marbleClear(cx: number, cy: number, spacing: number): boolean {
    const hz = this.hz;
    for (let i = 0; i < hz.length; i++) {
      const h = hz[i];
      if (h.kind !== 'marble' || h.state === 'done') continue;
      const dx = h.x + h.w / 2 - cx;
      const dy = h.y + h.h / 2 - cy;
      if (dx * dx + dy * dy < spacing * spacing) return false;
    }
    return true;
  }

  private addHazard(
    kind: HazardKind,
    shape: 'rect' | 'circle',
    x: number,
    y: number,
    w: number,
    h: number,
    warn: number,
    active: number,
    damage: number,
    sprite: string,
  ): void {
    const hz: Hazard = {
      id: this.nextId++,
      kind,
      shape,
      x,
      y,
      w,
      h,
      state: 'warn',
      timer: warn,
      warnTime: warn,
      activeTime: active,
      damage: damage * this.stage.dmgMul,
      sprite,
      hit: false,
      owner: this.bossRt!.actSeq,
      fresh: true,
    };
    this.hz.push(hz);
    this.emit({ type: 'hazardWarn', hazardId: hz.id, kind, x: x + w / 2, y: y + h / 2, warn });
  }

  /** 위험 지역: 예고 시간이 끝나면 발동(이 스텝부터 activeTime 동안 판정), 발동 중 겹치면 한 번 피해(무적 시간 적용) */
  private updateHazards(dt: number): void {
    const hz = this.hz;
    for (let i = 0; i < hz.length; i++) {
      const h = hz[i];
      if (h.state === 'done') continue;
      if (h.fresh) {
        h.fresh = false;
        continue;
      }
      if (h.state === 'warn') {
        h.timer = tickDown(h.timer, dt);
        if (h.timer > 0) continue;
        h.state = 'active';
        h.timer = h.activeTime;
        const hit = this.hazardHitsPlayer(h);
        this.emit({ type: 'hazardImpact', hazardId: h.id, kind: h.kind, x: h.x + h.w / 2, y: h.y + h.h / 2, hitPlayer: hit });
        if (hit) this.hazardHurt(h);
        continue;
      }
      h.timer = tickDown(h.timer, dt);
      if (h.timer <= 0) {
        h.state = 'done';
        continue;
      }
      if (this.hazardHitsPlayer(h)) this.hazardHurt(h);
    }
  }

  private hazardHitsPlayer(h: Hazard): boolean {
    const pl = this.player;
    if (h.hit || !(h.damage > 0) || pl.invuln > 0) return false;
    if (h.shape === 'circle') {
      const rr = h.w / 2 + pl.hitRadius;
      const dx = pl.x - (h.x + h.w / 2);
      const dy = pl.y - (h.y + h.h / 2);
      return dx * dx + dy * dy < rr * rr;
    }
    return overlapsRect(pl.x, pl.y, pl.hitRadius, h);
  }

  private hazardHurt(h: Hazard): void {
    h.hit = true;
    this.hurtPlayer(h.damage, 'hazard', this.player.x, this.player.y);
  }

  private minionsAlive(): number {
    const b = this.bossRt!.e;
    const es = this.es;
    let n = 0;
    for (let i = 0; i < es.length; i++) if (es[i].alive && es[i] !== b) n++;
    return n;
  }

  /**
   * 졸개 count마리 (지금 페이즈 상한 안에서): 보스 바로 아래 줄, 보스가 걸친 열 중 비어 있는 칸(다른 적과 안 겹침, 필드 안,
   * 플레이어 피격 원에서 SUMMON_PLAYER_MARGIN 넘게)을 시드 RNG로 골라 지금 페이즈 풀의 가중치로 뽑는다. 칸이 모자라면 덜 소환.
   */
  private summon(count: number): void {
    const rt = this.bossRt!;
    const b = rt.e;
    const ph = rt.def.phases[rt.phase];
    let n = Math.min(Math.floor(count), ph.minionCap - this.minionsAlive());
    if (n <= 0 || ph.minions.length === 0) return;
    const top = b.y + b.h + ENEMY_INSET;
    const cols = this.summonCols;
    cols.length = 0;
    const c0 = Math.max(0, rt.def.anchorCol);
    const c1 = Math.min(FIELD_COLS - 1, rt.def.anchorCol + b.def.w - 1);
    for (let c = c0; c <= c1; c++) if (this.summonCellFree(c * CELL, top)) cols.push(c);
    if (n > cols.length) n = cols.length;
    const ox = b.x + b.w / 2;
    const oy = b.y + b.h;
    for (let i = 0; i < n; i++) {
      // 남은 후보 중 하나 (부분 셔플)
      const j = this.rng.int(i, cols.length - 1);
      const c = cols[j];
      cols[j] = cols[i];
      cols[i] = c;
      const defId = this.pickMinion(ph.minions);
      const def = this.enemyDefs[defId];
      if (!def) throw new Error(`CombatSim: boss '${rt.def.id}': no minion enemy '${defId}'`);
      this.spawnMinion(def, c, top, ox, oy);
    }
  }

  /** 칸 (x, top, CELL×CELL)에 졸개를 놓을 수 있나 */
  private summonCellFree(x: number, top: number): boolean {
    if (top < 0 || top + CELL > FIELD_H || x < 0 || x + CELL > FIELD_W) return false;
    const es = this.es;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (!e.alive) continue;
      // 칸 영역끼리 (충돌 박스 + 사방 INSET). 맞닿은 칸은 겹치지 않은 것으로
      if (
        x < e.x + e.w + ENEMY_INSET - CELL_EPS &&
        x + CELL > e.x - ENEMY_INSET + CELL_EPS &&
        top < e.y + e.h + ENEMY_INSET - CELL_EPS &&
        top + CELL > e.y - ENEMY_INSET + CELL_EPS
      ) {
        return false;
      }
    }
    const pl = this.player;
    const qx = clamp(pl.x, x + ENEMY_INSET, x + CELL - ENEMY_INSET);
    const qy = clamp(pl.y, top + ENEMY_INSET, top + CELL - ENEMY_INSET);
    const rr = pl.hitRadius + SUMMON_PLAYER_MARGIN;
    const dx = pl.x - qx;
    const dy = pl.y - qy;
    return dx * dx + dy * dy >= rr * rr;
  }

  private pickMinion(pool: readonly { enemy: string; weight: number }[]): string {
    let total = 0;
    for (let i = 0; i < pool.length; i++) if (pool[i].weight > 0) total += pool[i].weight;
    let r = this.rng.next() * total;
    let pick = pool[0].enemy;
    for (let i = 0; i < pool.length; i++) {
      const m = pool[i];
      if (!(m.weight > 0)) continue;
      pick = m.enemy;
      r -= m.weight;
      if (r < 0) break;
    }
    return pick;
  }

  /** 졸개 하나 (spawnEnemies와 같은 규칙: HP × hpMul, 첫 공격 = interval + rng × jitter) */
  private spawnMinion(def: EnemyDef, c: number, top: number, fromX: number, fromY: number): void {
    const hp = Math.max(1, Math.round(def.hp * this.stage.hpMul));
    const atk = def.attack;
    const e: Enemy = {
      id: this.nextId++,
      defId: def.id,
      x: c * CELL + ENEMY_INSET,
      y: top + ENEMY_INSET,
      w: def.w * CELL - 2 * ENEMY_INSET,
      h: def.h * CELL - 2 * ENEMY_INSET,
      hp,
      maxHp: hp,
      alive: true,
      boss: def.boss === true,
      burnDps: 0,
      burnTime: 0,
      chillTime: 0,
      attackTimer: atk ? atk.interval + this.rng.next() * atk.jitter : 0,
      flash: 0,
      def,
      chillAttackRate: chillResistant(def) ? CHILL_ATTACK_RATE_RESIST : CHILL_ATTACK_RATE,
      stamp: 0,
      burnAcc: 0,
      burnTick: 0,
      // 입에서 칸까지 날아가는 동안은 몸에 닿아도 즉사가 아니다 (touchesEnemy)
      landing: SUMMON_LAND_TIME,
    };
    this.es.push(e);
    this.byId.set(e.id, e);
    this.totalEnemies++;
    this.emit({ type: 'summon', enemyId: e.id, defId: def.id, fromX, fromY, x: e.x + e.w / 2, y: e.y + e.h / 2 });
  }

  /** 보스 처치: 졸개가 전부 함께 터지고('kill' 이벤트들) 남은 위험 지역·적 탄은 사라진다 → 스텝 끝에 승리 */
  private bossDefeated(): void {
    const rt = this.bossRt!;
    rt.mode = 'dead';
    rt.act = null;
    rt.pulsesLeft = 0;
    const es = this.es;
    for (let i = 0; i < es.length; i++) if (es[i] !== rt.e) this.kill(es[i]);
    const hz = this.hz;
    for (let i = 0; i < hz.length; i++) hz[i].state = 'done';
    const shots = this.enemyShots;
    for (let i = 0; i < shots.length; i++) shots[i].alive = false;
  }

  /** 공개 요약(sim.boss) 갱신 — 제자리, 할당 없음 */
  private syncBossState(): void {
    const rt = this.bossRt!;
    const s = this.boss!;
    const b = rt.e;
    const acting = (rt.mode === 'windup' || rt.mode === 'act') && rt.act !== null;
    s.phase = rt.phase;
    s.mode = rt.mode;
    s.action = acting ? rt.act!.kind : null;
    s.actionId = acting ? rt.act!.id : null;
    s.modeTime = rt.mode === 'roar' || rt.mode === 'windup' ? rt.modeTime : 0;
    s.invulnerable = rt.mode === 'roar';
    s.minions = this.minionsAlive();
    s.minionCap = rt.def.phases[rt.phase].minionCap;
    s.hpFrac = b.alive ? Math.max(0, b.hp) / b.maxHp : 0;
  }

  // ── 종료 / 정리 ─────────────────────────────────────────────

  private lose(reason: LostReason): void {
    if (this.status !== 'running') return;
    this.status = 'lost';
    this.lostReason = reason;
    this.emit({ type: 'lost', reason });
  }

  private win(): void {
    if (this.status !== 'running') return;
    this.status = 'won';
    this.emit({ type: 'won' });
  }

  private compact(): void {
    retainAlive(this.ps);
    retainAlive(this.enemyShots);
    if (this.hz.length > 0) {
      const hz = this.hz;
      let k = 0;
      for (let i = 0; i < hz.length; i++) if (hz[i].state !== 'done') hz[k++] = hz[i];
      hz.length = k;
    }
    const es = this.es;
    let w = 0;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.alive) es[w++] = e;
      else this.byId.delete(e.id);
    }
    es.length = w;
  }

  private emit(ev: CombatEvent): void {
    this.events.push(ev);
  }
}

/**
 * 냉기 저항: 보스와 엘리트(보스가 아닌 2칸 이상 적 — 곰인형. 전투 씬의 처치 연출 등급과 같은 기준)는
 * 냉기 중에도 공격 타이머가 CHILL_ATTACK_RATE_RESIST로 흐른다 (일반 적은 CHILL_ATTACK_RATE).
 */
export function chillResistant(def: Pick<EnemyDef, 'w' | 'h' | 'boss'>): boolean {
  return def.boss === true || def.w * def.h > 1;
}

// ── 조준 (sim과 전투 씬이 함께 쓴다) ───────────────────────────

/**
 * 수동 조준각을 위쪽 반원 [-(π - AIM_MIN), -AIM_MIN]으로 clamp (AIM_MIN = AIM_MIN_DEG).
 * 범위 밖(수평 근처·아래쪽)은 오른쪽 반(cos ≥ 0)이면 -AIM_MIN, 왼쪽 반이면 -(π - AIM_MIN).
 * 아무 값(2π 넘게 돈 각도 포함)이나 받는다. 유한하지 않으면 바로 위(-π/2).
 */
export function clampAim(angle: number): number {
  if (!Number.isFinite(angle)) return -Math.PI / 2;
  let a = angle % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  else if (a <= -Math.PI) a += 2 * Math.PI;
  if (a <= -AIM_MIN && a >= AIM_MIN - Math.PI) return a;
  return Math.cos(a) >= 0 ? -AIM_MIN : AIM_MIN - Math.PI;
}

/** 입력의 수동 조준각(clamp 적용) 또는 null(자동조준) */
function inputAim(input: CombatInput): number | null {
  const a = input.aimAngle;
  return typeof a === 'number' && Number.isFinite(a) ? clampAim(a) : null;
}

/**
 * 조준 가이드 경로 (렌더 전용 미리보기, 게임 상태는 바꾸지 않음).
 * (x, y)에서 angle 방향으로 나가는 반경 r의 공을 직선으로 따라가며 좌·우·상단 벽에서 sim과 같은 규칙
 * (반사 + 수직 성분 보정)으로 꺾는다. 끝나는 곳: 처음 닿는 적(보이는 살아있는 적, r만큼 둥글게 넓힌 사각형 —
 * 실제 원-사각형 충돌과 같은 모양이라 모서리를 스쳐 지나갈 공을 '닿는다'고 그리지 않는다),
 * 선분 maxSegments개, 총 길이 maxLen, 또는 바닥 아래로 빠질 때.
 * 꼭짓점(시작점 포함)을 out[2i], out[2i+1]에 쓰고 res에 개수·닿은 적을 넣어 반환한다.
 * out 길이 ≥ 2 × (maxSegments + 1). 할당 없음 (반사 계산은 모듈 임시 객체에).
 */
export function traceAim(
  x: number,
  y: number,
  angle: number,
  r: number,
  enemies: readonly EnemyEntity[],
  maxLen: number,
  maxSegments: number,
  out: Float32Array | Float64Array | number[],
  res: AimTrace,
): AimTrace {
  let px = x;
  let py = y;
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  let left = maxLen;
  out[0] = px;
  out[1] = py;
  let n = 1;
  res.hitId = -1;
  for (let seg = 0; seg < maxSegments && left > 0; seg++) {
    // 이번 선분이 닿는 벽 (바닥은 열려 있음 → 빠져나감)
    let tWall = Infinity;
    let nx = 0;
    let ny = 0;
    if (dx < -1e-12) {
      tWall = (r - px) / dx;
      nx = 1;
    } else if (dx > 1e-12) {
      tWall = (FIELD_W - r - px) / dx;
      nx = -1;
    }
    let exits = false;
    if (dy < -1e-12) {
      const t = (r - py) / dy;
      if (t < tWall) {
        tWall = t;
        nx = 0;
        ny = 1;
      }
    } else if (dy > 1e-12) {
      const t = (FIELD_H + r - py) / dy;
      if (t < tWall) {
        tWall = t;
        exits = true;
      }
    }
    if (tWall < 0) tWall = 0;

    let tHit = Infinity;
    let hitId = -1;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive || e.y + e.h <= 0) continue;
      const t = rayRoundRect(px, py, dx, dy, e.x, e.y, e.x + e.w, e.y + e.h, r);
      if (t < tHit) {
        tHit = t;
        hitId = e.id;
      }
    }

    const lim = tWall < left ? tWall : left;
    if (hitId >= 0 && tHit <= lim) {
      out[2 * n] = px + dx * tHit;
      out[2 * n + 1] = py + dy * tHit;
      n++;
      res.hitId = hitId;
      break;
    }
    px += dx * lim;
    py += dy * lim;
    left -= lim;
    out[2 * n] = px;
    out[2 * n + 1] = py;
    n++;
    if (exits || left <= 0 || lim < tWall) break;
    const v = bounceVelocityInto(traceVel, dx, dy, nx, ny);
    const sp = Math.sqrt(v.vx * v.vx + v.vy * v.vy) || 1;
    dx = v.vx / sp;
    dy = v.vy / sp;
  }
  res.points = n;
  return res;
}

/**
 * 반직선 (px,py)+t(dx,dy) (단위 벡터, t ≥ 0) 위의 반경 r 공이 사각형 [x0,x1]×[y0,y1]에 처음 닿는 t.
 * = 사각형을 r만큼 '둥글게' 넓힌 영역(가로로 넓힌 사각형 ∪ 세로로 넓힌 사각형 ∪ 네 모서리 원)에 들어가는 첫 t.
 * 실제 충돌(circleRectContact)과 같은 모양 — 그냥 r만큼 넓힌 사각형이면 모서리를 스쳐 지나갈 공도 닿는다고 그린다.
 * 시작점이 이미 닿아 있으면 0, 안 닿으면 Infinity.
 */
function rayRoundRect(px: number, py: number, dx: number, dy: number, x0: number, y0: number, x1: number, y1: number, r: number): number {
  let t = rayBox(px, py, dx, dy, x0 - r, y0, x1 + r, y1);
  let u = rayBox(px, py, dx, dy, x0, y0 - r, x1, y1 + r);
  if (u < t) t = u;
  u = rayCircle(px, py, dx, dy, x0, y0, r);
  if (u < t) t = u;
  u = rayCircle(px, py, dx, dy, x1, y0, r);
  if (u < t) t = u;
  u = rayCircle(px, py, dx, dy, x0, y1, r);
  if (u < t) t = u;
  u = rayCircle(px, py, dx, dy, x1, y1, r);
  return u < t ? u : t;
}

/** 반직선 (단위 방향)이 원 (cx,cy,r)에 들어가는 첫 t ≥ 0. 시작점이 안이면 0, 안 닿으면 Infinity */
function rayCircle(px: number, py: number, dx: number, dy: number, cx: number, cy: number, r: number): number {
  const ox = px - cx;
  const oy = py - cy;
  const c = ox * ox + oy * oy - r * r;
  if (c <= 0) return 0;
  const b = ox * dx + oy * dy;
  if (b >= 0) return Infinity;
  const disc = b * b - c;
  return disc < 0 ? Infinity : -b - Math.sqrt(disc);
}

/** 반직선 (px,py)+t(dx,dy), t ≥ 0 이 사각형 [x0,x1]×[y0,y1]에 들어가는 첫 t. 시작점이 안이면 0, 안 닿으면 Infinity */
function rayBox(px: number, py: number, dx: number, dy: number, x0: number, y0: number, x1: number, y1: number): number {
  let tmin = 0;
  let tmax = Infinity;
  if (dx !== 0) {
    let a = (x0 - px) / dx;
    let b = (x1 - px) / dx;
    if (a > b) {
      const s = a;
      a = b;
      b = s;
    }
    if (a > tmin) tmin = a;
    if (b < tmax) tmax = b;
  } else if (px < x0 || px > x1) return Infinity;
  if (dy !== 0) {
    let a = (y0 - py) / dy;
    let b = (y1 - py) / dy;
    if (a > b) {
      const s = a;
      a = b;
      b = s;
    }
    if (a > tmin) tmin = a;
    if (b < tmax) tmax = b;
  } else if (py < y0 || py > y1) return Infinity;
  return tmin <= tmax ? tmin : Infinity;
}

// ── 헬퍼 ──────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 남은 시간 감소. 1/60을 반복해 빼면 정수배 시간도 +ε가 남아 한 스텝 늦게 끝나므로 TIME_EPS 이하는 0 */
function tickDown(t: number, dt: number): number {
  const r = t - dt;
  return r > TIME_EPS ? r : 0;
}

function colOf(x: number): number {
  const c = Math.floor(x / CELL);
  return c < 0 ? 0 : c >= FIELD_COLS ? FIELD_COLS - 1 : c;
}

/** 팽이 고리 빈틈 발 수: 0 ~ count-1 (정수) */
function ringGapSize(gap: number, n: number): number {
  const g = Math.floor(gap);
  return g < 0 ? 0 : g > n - 1 ? n - 1 : g;
}

/** n발을 spread(라디안) 부채꼴로 고르게. n=1이면 base */
function fanAngle(base: number, spread: number, k: number, n: number): number {
  return n > 1 ? base - spread / 2 + (spread * k) / (n - 1) : base;
}

/** traceAim 전용 반사 임시값 */
const traceVel: Velocity = { vx: 0, vy: 0 };

/**
 * 반사 + 수직 성분 보정. 보정 때문에 다시 파고드는 방향이 되면 vy를 뒤집는다. 결과를 out에 써서 반환(할당 없음).
 * physics.ts의 reflect → enforceMinVertical과 연산 순서까지 같다 (tests/sim-alloc.test.ts가 비트 단위로 비교).
 */
export function bounceVelocityInto(out: Velocity, vx: number, vy: number, nx: number, ny: number): Velocity {
  // reflect: v·n < 0 일 때만 반사
  const d = vx * nx + vy * ny;
  let rvx = vx;
  let rvy = vy;
  if (!(d >= 0)) {
    rvx = vx - 2 * d * nx;
    rvy = vy - 2 * d * ny;
  }
  // enforceMinVertical: 속력 유지, |vy| ≥ ratio × speed
  const speed = Math.sqrt(rvx * rvx + rvy * rvy);
  const minVy = Math.min(1, Math.max(0, MIN_VERTICAL_RATIO)) * speed;
  if (Math.abs(rvy) >= minVy) {
    out.vx = rvx;
    out.vy = rvy;
  } else {
    const nvy = rvy > 0 ? minVy : -minVy;
    const nvx = Math.sqrt(Math.max(0, speed * speed - nvy * nvy));
    out.vx = rvx < 0 ? -nvx : nvx;
    out.vy = nvy;
  }
  if (out.vx * nx + out.vy * ny < 0) out.vy = -out.vy;
  return out;
}

/**
 * physics.ts의 circleRectContact와 같은 계산을 out에 쓴다(할당 없음). 겹치면 true, 아니면 false(out 불변).
 */
export function circleRectContactInto(
  out: Contact,
  cx: number,
  cy: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  const right = rx + rw;
  const bottom = ry + rh;
  const qx = cx < rx ? rx : cx > right ? right : cx;
  const qy = cy < ry ? ry : cy > bottom ? bottom : cy;
  const dx = cx - qx;
  const dy = cy - qy;
  const d2 = dx * dx + dy * dy;

  if (d2 > 0) {
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    out.nx = dx / d;
    out.ny = dy / d;
    out.depth = r - d;
    return true;
  }

  // 중심이 안쪽: 가장 얕은 면으로 밀어낸다 (동률이면 위·아래 우선)
  let nx = 0;
  let ny = -1;
  let pen = cy - ry;
  const toBottom = bottom - cy;
  if (toBottom < pen) {
    ny = 1;
    pen = toBottom;
  }
  const toLeft = cx - rx;
  if (toLeft < pen) {
    nx = -1;
    ny = 0;
    pen = toLeft;
  }
  const toRight = right - cx;
  if (toRight < pen) {
    nx = 1;
    ny = 0;
    pen = toRight;
  }
  out.nx = nx;
  out.ny = ny;
  out.depth = pen + r;
  return true;
}

function aabbOverlap(p: ProjectileEntity, e: EnemyEntity): boolean {
  const r = p.radius;
  return p.x + r > e.x && p.x - r < e.x + e.w && p.y + r > e.y && p.y - r < e.y + e.h;
}

function centerInside(p: ProjectileEntity, e: EnemyEntity): boolean {
  return p.x >= e.x && p.x <= e.x + e.w && p.y >= e.y && p.y <= e.y + e.h;
}

function overlapsRect(cx: number, cy: number, r: number, e: { x: number; y: number; w: number; h: number }): boolean {
  const dx = cx - clamp(cx, e.x, e.x + e.w);
  const dy = cy - clamp(cy, e.y, e.y + e.h);
  return dx * dx + dy * dy < r * r;
}

/**
 * (sx,sy)→(cx,cy) 이동이 r만큼 넓힌 사각형에 들어온 면(슬랩 방식)을 out에 쓰고 true.
 * 시작점이 이미 안쪽이었으면 false, out 불변 (호출 측이 최소 침투 축으로 대체).
 */
function entryContactInto(
  out: Contact,
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  r: number,
  e: EnemyEntity,
): boolean {
  const minX = e.x - r;
  const maxX = e.x + e.w + r;
  const minY = e.y - r;
  const maxY = e.y + e.h + r;
  const dx = cx - sx;
  const dy = cy - sy;
  let tx = -Infinity;
  let ty = -Infinity;
  let fx = 0;
  let fy = 0;
  if (dx > 0) {
    tx = (minX - sx) / dx;
    fx = -1;
  } else if (dx < 0) {
    tx = (maxX - sx) / dx;
    fx = 1;
  }
  if (dy > 0) {
    ty = (minY - sy) / dy;
    fy = -1;
  } else if (dy < 0) {
    ty = (maxY - sy) / dy;
    fy = 1;
  }
  if (tx >= ty) {
    if (!(tx >= 0 && tx <= 1)) return false;
    out.nx = fx;
    out.ny = 0;
    out.depth = fx < 0 ? cx - minX : maxX - cx;
    return true;
  }
  if (!(ty >= 0 && ty <= 1)) return false;
  out.nx = 0;
  out.ny = fy;
  out.depth = fy < 0 ? cy - minY : maxY - cy;
  return true;
}

function segmentHitsCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  rr: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((cx - ax) * dx + (cy - ay) * dy) / len2, 0, 1) : 0;
  const px = ax + dx * t - cx;
  const py = ay + dy * t - cy;
  return px * px + py * py < rr * rr;
}

function firstStatusElement(elements: readonly Element[]): Element | null {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el === 'fire' || el === 'ice') return el;
  }
  return null;
}

function retainAlive<T extends { alive: boolean }>(arr: T[]): void {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (x.alive) arr[w++] = x;
  }
  arr.length = w;
}
