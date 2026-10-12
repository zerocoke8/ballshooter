// 백어택 + 행동하는 적 (방패병·치유병·폭탄병·장갑병·젤리/꼬마 젤리·RC카) — sim 규칙 (docs/ARCHITECTURE.md 'sim.ts' 백어택·행동하는 적).
// 픽스처 적으로 기하·규칙을 확인하고, 마지막 묶음은 실제 데이터(st4·st5·보스 테스트)로 결정성·이벤트·성능을 본다.
import { describe, expect, it } from 'vitest';
import {
  BACK_ATTACK_MUL,
  CELL,
  ENEMY_INSET,
  FIELD_H,
  FIELD_W,
  PLAYER_HIT_RADIUS,
  SHIFT_PLAYER_MARGIN,
  SIM_DT,
  SPLIT_PLAYER_MARGIN,
  SUMMON_LAND_TIME,
} from '../src/config';
import { GAME_DATA } from '../src/data';
import { CombatSim } from '../src/logic/combat/sim';
import { Rng } from '../src/logic/rng';
import type {
  BossDef,
  CombatEvent,
  CombatInput,
  EnemyDef,
  EnemyEntity,
  Element,
  PlayerStats,
  ProjectileEntity,
  SplitSpec,
  StageDef,
  WeaponLoadout,
} from '../src/types';

// ── 픽스처 ────────────────────────────────────────────────────

function enemyDef(id: string, o: Partial<EnemyDef> = {}): EnemyDef {
  return { id, name: id, sprite: `enemy_${id}`, w: 1, h: 1, hp: 1000, gold: 0, dropChance: 0, ...o };
}

const ENEMIES: Record<string, EnemyDef> = {
  dummy: enemyDef('dummy'),
  weak: enemyDef('weak', { hp: 1 }),
  bossy: enemyDef('bossy', { boss: true }),
  guard: enemyDef('guard', { hp: 1e9 }),
  shield: enemyDef('shield', { shield: true }),
  healer: enemyDef('healer', { heal: { interval: 1, jitter: 0, radius: 134, frac: 0.15 } }),
  bomber: enemyDef('bomber', { hp: 1, deathBlast: { radius: 134, damage: 40 } }),
  bomb30: enemyDef('bomb30', { hp: 30, deathBlast: { radius: 134, damage: 40 } }),
  armored: enemyDef('armored', { armor: 0.3 }),
  jelly: enemyDef('jelly', { hp: 1, splitOnDeath: { into: 'mini', count: 2 } }),
  mini: enemyDef('mini', { hp: 50 }),
  car: enemyDef('car', { shift: { interval: 1, jitter: 0, speed: 210 } }),
  jittercar: enemyDef('jittercar', { shift: { interval: 1, jitter: 1, speed: 210 } }),
};

const LEGEND: Record<string, string> = {
  d: 'dummy',
  w: 'weak',
  X: 'bossy',
  G: 'guard',
  k: 'shield',
  h: 'healer',
  x: 'bomber',
  y: 'bomb30',
  a: 'armored',
  g: 'jelly',
  m: 'mini',
  c: 'car',
  r: 'jittercar',
};

const PLAYER: PlayerStats = { maxHp: 100, moveSpeed: 420, regenPerSec: 0, goldMul: 1, damageMul: 1, cooldownMul: 1 };
const IDLE: CombatInput = { targetX: null, targetY: null };

/** 줄 0(맨 아래 줄)의 충돌 박스 위끝 (주차 뒤). 줄 i는 ROW0_Y - i × CELL */
const ROW0_Y = 500;
/** 열 c의 충돌 박스 왼끝 / 가운데 */
const colX = (c: number): number => c * CELL + ENEMY_INSET;
const colMid = (c: number): number => c * CELL + CELL / 2;
/** 줄 0의 박스 가운데 y */
const ROW0_MID = ROW0_Y + (CELL - 2 * ENEMY_INSET) / 2;

interface Setup {
  stage?: Partial<StageDef>;
  seed?: number;
  /** 화면 밖에 안 죽는 적을 하나 둬서(기본 true) 다 잡아도 'won'으로 끝나지 않게 */
  guard?: boolean;
  enemies?: Record<string, EnemyDef>;
  bosses?: Record<string, BossDef>;
  loadout?: WeaponLoadout[];
  player?: Partial<PlayerStats>;
}

/** rows(아래 → 위)를 깔고 줄 0의 위끝이 ROW0_Y가 되게 화면 안으로 옮긴다 (하강 0 — 그 자리에 선다) */
function park(rows: string[], s: Setup = {}): CombatSim {
  const guard = s.guard ?? true;
  const stage: StageDef = {
    id: 'behave',
    name: 'behave',
    descentSpeed: 0,
    hpMul: 1,
    dmgMul: 1,
    clearGold: 0,
    rows: guard ? [...rows, 'G.......'] : rows,
    legend: LEGEND,
    background: 'bg_test',
    ...s.stage,
  };
  const player = { ...PLAYER, ...s.player };
  const sim = new CombatSim({
    stage,
    stageIndex: 0,
    enemies: s.enemies ?? ENEMIES,
    bosses: s.bosses,
    loadout: s.loadout ?? [],
    player,
    hp: player.maxHp,
    seed: s.seed ?? 1,
  });
  const dy = ROW0_Y - (-CELL + ENEMY_INSET);
  for (const e of sim.enemies) e.y += dy;
  if (guard) sim.enemies[sim.enemies.length - 1].y = -600; // 화면 밖 — 맞지 않고 보이지 않는다
  return sim;
}

let nextId = 9_000_000;
type ShotInit = Partial<ProjectileEntity> & Pick<ProjectileEntity, 'x' | 'y' | 'vx' | 'vy'>;

function shoot(sim: CombatSim, o: ShotInit): ProjectileEntity {
  const p: ProjectileEntity = {
    id: nextId++,
    weaponUid: 0,
    radius: 10,
    damage: 20,
    pierceLeft: 0,
    bouncesLeft: Infinity,
    elements: [],
    explodeRadius: 0,
    split: null,
    sprite: 'proj_test',
    spin: false,
    age: 0,
    alive: true,
    ...o,
  };
  sim.projectiles.push(p);
  return p;
}

/** 방향 deg(필드 각도: 0 = 오른쪽, 90 = 아래)로 speed px/s, (tx, ty)에 dist px 앞에서 출발 */
function shootAt(sim: CombatSim, tx: number, ty: number, deg: number, o: Partial<ProjectileEntity> = {}, dist = 150, speed = 600): ProjectileEntity {
  const a = (deg * Math.PI) / 180;
  return shoot(sim, { x: tx - Math.cos(a) * dist, y: ty - Math.sin(a) * dist, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, ...o });
}

function run(sim: CombatSim, steps: number, input: CombatInput = IDLE): CombatEvent[] {
  const out: CombatEvent[] = [];
  for (let i = 0; i < steps && sim.status === 'running'; i++) {
    sim.step(SIM_DT, input);
    out.push(...sim.drainEvents());
  }
  return out;
}

function runFor(sim: CombatSim, seconds: number, input: CombatInput = IDLE): CombatEvent[] {
  return run(sim, Math.round(seconds / SIM_DT), input);
}

function stepUntilEvent(sim: CombatSim, match: (e: CombatEvent) => boolean, max = 600, input: CombatInput = IDLE): CombatEvent[] {
  const out: CombatEvent[] = [];
  for (let i = 0; i < max; i++) {
    sim.step(SIM_DT, input);
    const ev = sim.drainEvents();
    out.push(...ev);
    if (ev.some(match)) return out;
  }
  throw new Error('stepUntilEvent: event not seen');
}

function ofType<T extends CombatEvent['type']>(ev: CombatEvent[], type: T): Extract<CombatEvent, { type: T }>[] {
  return ev.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === type);
}

const byDef = (sim: CombatSim, defId: string): EnemyEntity[] => sim.enemies.filter((e) => e.defId === defId);
/** rows 안의 문자 수 */
const byDefCount = (rows: readonly string[], ch: string): number => rows.join('').split(ch).length - 1;
const one = (sim: CombatSim, defId: string): EnemyEntity => {
  const es = byDef(sim, defId);
  if (es.length !== 1) throw new Error(`expected one ${defId}, got ${es.length}`);
  return es[0];
};

/** 첫 직접 적중(hit 또는 blocked)까지 */
function firstContact(sim: CombatSim): CombatEvent {
  const evs = stepUntilEvent(sim, (e) => e.type === 'hit' || e.type === 'blocked', 120);
  return evs.find((e) => e.type === 'hit' || e.type === 'blocked')!;
}

/** 두 충돌 박스가 겹치나 */
function overlaps(a: EnemyEntity, b: EnemyEntity): boolean {
  return a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
}

/** 플레이어 피격 원과 박스 사이 거리 */
function gapToPlayer(sim: CombatSim, e: EnemyEntity): number {
  const pl = sim.player;
  const qx = Math.max(e.x, Math.min(pl.x, e.x + e.w));
  const qy = Math.max(e.y, Math.min(pl.y, e.y + e.h));
  return Math.hypot(pl.x - qx, pl.y - qy) - pl.hitRadius;
}

/** 플레이어를 (x, y)에 세워 둔다 (그 자리를 목표로 — 움직이지 않는다) */
function standAt(sim: CombatSim, x: number, y: number): CombatInput {
  sim.player.x = x;
  sim.player.y = y;
  sim.player.vx = 0;
  sim.player.vy = 0;
  return { targetX: x, targetY: y };
}

// ─────────────────────────────────────────────────────────────
// 백어택
// ─────────────────────────────────────────────────────────────

describe('백어택: 윗면 직접 적중 × BACK_ATTACK_MUL', () => {
  // 3열 줄 0의 적: 박스 [256, 332] × [500, 576], 윗면 가운데 (294, 500), 왼쪽 위 모서리 (256, 500)
  const TOP_X = colMid(3);
  const R = 10;

  it.each([20, 35, 50, 70, 90, 110, 130, 145, 160])('위에서 %i°로 내려와 윗면에 맞으면 백어택 (hit.back, 피해 × 1.5)', (deg) => {
    const sim = park(['...d....']);
    const e = one(sim, 'dummy');
    shootAt(sim, TOP_X, ROW0_Y - R - 1, deg);
    const ev = firstContact(sim);
    expect(ev).toMatchObject({ type: 'hit', enemyId: e.id, back: true, damage: Math.round(20 * BACK_ATTACK_MUL) });
    expect(e.maxHp - e.hp).toBeCloseTo(20 * BACK_ATTACK_MUL, 9);
  });

  it.each([
    ['옆에서 수평으로', 0, colX(3) - R - 1, ROW0_MID],
    ['옆에서 비스듬히 아래로', 30, colX(3) - R - 1, ROW0_MID],
    ['옆에서 비스듬히 위로', -30, colX(3) - R - 1, ROW0_MID],
    ['아래에서 위로', -90, TOP_X, ROW0_Y + 76 + R + 1],
    ['아래에서 비스듬히', -60, TOP_X, ROW0_Y + 76 + R + 1],
  ] as const)('%s 맞으면 백어택이 아니다 (피해 그대로, back 없음)', (_label, deg, tx, ty) => {
    const sim = park(['...d....']);
    shootAt(sim, tx, ty, deg);
    const ev = firstContact(sim) as Extract<CombatEvent, { type: 'hit' }>;
    expect(ev.type).toBe('hit');
    expect(ev.back).toBeUndefined();
    expect(ev.damage).toBe(20);
  });

  it('모서리: 법선이 위쪽에 더 가까우면 백어택, 옆쪽에 더 가까우면 아니다 (공 중심이 윗변보다 위여도)', () => {
    const corner = { x: colX(3), y: ROW0_Y };
    const hitCorner = (nx: number, ny: number): Extract<CombatEvent, { type: 'hit' }> => {
      const sim = park(['...d....']);
      const len = Math.hypot(nx, ny);
      const ux = nx / len;
      const uy = ny / len;
      // 법선 방향 바깥에서 모서리를 향해 곧장 — 처음 닿는 곳이 모서리, 접촉 법선 = (ux, uy)
      shoot(sim, { x: corner.x + ux * 110, y: corner.y + uy * 110, vx: -ux * 600, vy: -uy * 600 });
      const ev = firstContact(sim);
      expect(ev.type).toBe('hit');
      return ev as Extract<CombatEvent, { type: 'hit' }>;
    };
    // 위쪽 60°(법선 (-0.5, -0.87)) → 윗면
    expect(hitCorner(-0.5, -Math.sqrt(3) / 2)).toMatchObject({ back: true, damage: 30 });
    // 위쪽 30°(법선 (-0.87, -0.5)) → 옆면 — 공 중심은 윗변보다 위지만 백어택 아님
    const side = hitCorner(-Math.sqrt(3) / 2, -0.5);
    expect(side.back).toBeUndefined();
    expect(side.damage).toBe(20);
    // 오른쪽 위 모서리도 같다
    const sim = park(['...d....']);
    const rc = { x: colX(3) + 76, y: ROW0_Y };
    shoot(sim, { x: rc.x + 0.5 * 110, y: rc.y - (Math.sqrt(3) / 2) * 110, vx: -0.5 * 600, vy: (Math.sqrt(3) / 2) * 600 });
    expect(firstContact(sim)).toMatchObject({ type: 'hit', back: true });
    // 아래쪽 모서리는 절대 아니다
    const below = hitCorner(-0.5, Math.sqrt(3) / 2);
    expect(below.back).toBeUndefined();
  });

  it('관통 공이 위에서 뚫고 지나가는 적중도 백어택, 연쇄·폭발은 원래 피해 기준', () => {
    const sim = park(['..ddd...']);
    const [l, mid, r] = byDef(sim, 'dummy');
    shoot(sim, { x: colMid(3), y: 300, vx: 0, vy: 600, pierceLeft: 1, elements: ['lightning'], explodeRadius: 1 });
    const evs = stepUntilEvent(sim, (e) => e.type === 'hit' && e.enemyId === mid.id);
    const hit = ofType(evs, 'hit').find((h) => h.enemyId === mid.id)!;
    expect(hit).toMatchObject({ back: true, damage: 30 });
    // 연쇄 피해 = 20 × CHAIN_DAMAGE_MUL(0.5) — 백어택 배수 없음
    const chained = ofType(evs, 'hit').filter((h) => h.enemyId === l.id || h.enemyId === r.id);
    expect(chained.length).toBeGreaterThan(0);
    for (const h of chained) {
      expect(h.damage).toBe(10);
      expect(h.back).toBeUndefined();
    }
  });

  it('백어택으로 죽이면 kill에도 back', () => {
    const sim = park(['...w....', '.......d']);
    const e = one(sim, 'weak');
    shoot(sim, { x: colMid(3), y: 300, vx: 0, vy: 600, damage: 5 });
    const evs = stepUntilEvent(sim, (x) => x.type === 'kill');
    expect(ofType(evs, 'kill')[0]).toMatchObject({ enemyId: e.id, back: true });

    const sim2 = park(['...w....', '.......d']);
    shoot(sim2, { x: colMid(3), y: 760, vx: 0, vy: -600, damage: 5 });
    const k = ofType(stepUntilEvent(sim2, (x) => x.type === 'kill'), 'kill')[0];
    expect(k.back).toBeUndefined();
  });

  it('보스 윗면도 백어택 — 보스 연타 감쇠와 곱해진다', () => {
    // 보스 위 92 px 틈(위 칸에 적)에서 덜그럭거리는 공: 윗면 → 위 적 아랫면 → 다시 윗면 (1초 안이면 × 0.3 × 1.5)
    const sim = park(['...X....', '........', '...d....']);
    const b = one(sim, 'bossy');
    shoot(sim, { x: colMid(3), y: 450, vx: 0, vy: 600 });
    const evs = runFor(sim, 0.5);
    const hits = ofType(evs, 'hit').filter((h) => h.enemyId === b.id);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]).toMatchObject({ back: true, damage: 30 });
    expect(hits[1]).toMatchObject({ back: true, damage: Math.round(20 * 0.3 * BACK_ATTACK_MUL) });
  });
});

// ─────────────────────────────────────────────────────────────
// 방패병
// ─────────────────────────────────────────────────────────────

describe('방패병: 정면(아랫면)은 막고 옆·위·폭발·연쇄·화상은 들어간다', () => {
  const split: SplitSpec = { count: 3, damageMul: 0.5, sprite: 'proj_child', radius: 6 };

  it('아래에서 맞으면 피해 0 + 반사 + blocked, 분열·폭발·상태이상 없음', () => {
    const sim = park(['..dkd...']);
    const k = one(sim, 'shield');
    const p = shoot(sim, { x: colMid(3), y: 700, vx: 0, vy: -600, split, explodeRadius: 120, elements: ['fire', 'lightning'] });
    const evs = stepUntilEvent(sim, (e) => e.type === 'blocked');
    const blocked = ofType(evs, 'blocked');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ enemyId: k.id, x: colMid(3), y: ROW0_Y + 76 });
    expect(ofType(evs, 'hit')).toEqual([]);
    expect(ofType(evs, 'explode')).toEqual([]);
    expect(ofType(evs, 'chain')).toEqual([]);
    expect(ofType(evs, 'split')).toEqual([]);
    expect(p.vy).toBeGreaterThan(0);
    expect(p.split).not.toBeNull();
    expect(k.hp).toBe(k.maxHp);
    expect(k.burnTime).toBe(0);
  });

  it('관통 공도 정면은 못 뚫는다 — 관통 횟수를 쓰지 않고 반사', () => {
    const sim = park(['...k....']);
    const k = one(sim, 'shield');
    const p = shoot(sim, { x: colMid(3), y: 700, vx: 0, vy: -600, pierceLeft: 2 });
    const evs = run(sim, 60);
    expect(ofType(evs, 'blocked')).toHaveLength(1);
    expect(ofType(evs, 'hit')).toEqual([]);
    expect(p.pierceLeft).toBe(2);
    expect(k.hp).toBe(k.maxHp);
    // 방패 위로 넘어가지 않았다 (반사돼 바닥으로)
    expect(p.alive ? p.y : FIELD_H).toBeGreaterThan(ROW0_Y + 76);
  });

  it('아래쪽 모서리: 법선이 아래에 더 가까우면 막고, 옆에 더 가까우면 맞는다', () => {
    const corner = { x: colX(3), y: ROW0_Y + 76 };
    const at = (nx: number, ny: number): CombatEvent => {
      const sim = park(['...k....']);
      shoot(sim, { x: corner.x + nx * 110, y: corner.y + ny * 110, vx: -nx * 600, vy: -ny * 600 });
      return firstContact(sim);
    };
    expect(at(-0.5, Math.sqrt(3) / 2).type).toBe('blocked');
    expect(at(-Math.sqrt(3) / 2, 0.5)).toMatchObject({ type: 'hit', damage: 20 });
  });

  it('옆에서 맞으면 피해 그대로, 위에서 맞으면 백어택', () => {
    const side = park(['...k....']);
    shoot(side, { x: 150, y: ROW0_MID, vx: 600, vy: 0 });
    expect(firstContact(side)).toMatchObject({ type: 'hit', damage: 20 });

    const top = park(['...k....']);
    shoot(top, { x: colMid(3), y: 300, vx: 0, vy: 600 });
    expect(firstContact(top)).toMatchObject({ type: 'hit', damage: 30, back: true });
  });

  it('관통 공이 옆으로 들어가면 그대로 뚫고(관통 적중), 몸속에서는 정면에 막히지 않는다', () => {
    const sim = park(['...k....']);
    const k = one(sim, 'shield');
    const p = shoot(sim, { x: 150, y: ROW0_MID, vx: 600, vy: 0, pierceLeft: 1 });
    const evs = run(sim, 40);
    expect(ofType(evs, 'hit').filter((h) => h.enemyId === k.id)[0]).toMatchObject({ damage: 20 });
    expect(ofType(evs, 'blocked')).toEqual([]);
    expect(p.pierceLeft).toBe(0);
  });

  it('자동조준(프로브·테스트용)은 방패병 정면을 노리지 않는다 — 다른 적이 없을 때만 방패병', () => {
    const weapon: WeaponLoadout = {
      uid: 1, defId: 'w', tier: 1, cooldown: 10, damage: 1, count: 1, spreadDeg: 0, speed: 600, radius: 8, pierce: 0,
      maxBounces: 0, elements: [], explodeRadius: 0, split: null, sprite: 'proj_test', spin: false,
    };
    const aimOf = (rows: string[]): { deg: number; target: EnemyEntity } => {
      const sim = park(rows, { loadout: [weapon] });
      run(sim, 40);
      const p = sim.projectiles[0];
      return { deg: (Math.atan2(p.vy, p.vx) * 180) / Math.PI, target: sim.enemies[0] };
    };
    const want = (e: EnemyEntity): number => {
      const ox = FIELD_W / 2;
      const oy = 864 - 30;
      return (Math.atan2(e.y + e.h / 2 - oy, e.x + e.w / 2 - ox) * 180) / Math.PI;
    };
    // 가장 아래는 방패병(3열 줄 0), 그 위 줄 5열에 병정 → 병정을 노린다
    const mixed = park(['...k....', '.....d..'], { loadout: [weapon] });
    run(mixed, 40);
    const p = mixed.projectiles[0];
    const deg = (Math.atan2(p.vy, p.vx) * 180) / Math.PI;
    expect(Math.abs(deg - want(one(mixed, 'dummy')))).toBeLessThanOrEqual(2 + 1e-6);
    // 방패병만 있으면 방패병
    const only = aimOf(['...k....']);
    expect(Math.abs(only.deg - want(only.target))).toBeLessThanOrEqual(2 + 1e-6);
  });

  it('폭발·연쇄·화상은 방패병에게 그대로 들어간다', () => {
    // 폭발: 옆 적을 아래에서 맞힌 폭발 공
    const ex = park(['..dk....']);
    const k1 = one(ex, 'shield');
    shoot(ex, { x: colMid(2), y: 700, vx: 0, vy: -600, explodeRadius: 120 });
    const e1 = run(ex, 40);
    expect(ofType(e1, 'hit').filter((h) => h.enemyId === k1.id)[0]).toMatchObject({ damage: 10 });

    // 연쇄: 옆 적을 맞힌 번개 공
    const ch = park(['..dk....']);
    const k2 = one(ch, 'shield');
    shoot(ch, { x: colMid(2), y: 700, vx: 0, vy: -600, elements: ['lightning'] });
    const e2 = run(ch, 40);
    expect(ofType(e2, 'chain').length).toBeGreaterThan(0);
    expect(ofType(e2, 'hit').filter((h) => h.enemyId === k2.id)[0]).toMatchObject({ damage: 10, element: 'lightning' });

    // 화상: 옆면에 불 공 → 화상 틱이 들어간다
    const fi = park(['...k....']);
    const k3 = one(fi, 'shield');
    shoot(fi, { x: 150, y: ROW0_MID, vx: 600, vy: 0, elements: ['fire'] });
    runFor(fi, 3);
    expect(k3.maxHp - k3.hp).toBeGreaterThan(20);
  });
});

// ─────────────────────────────────────────────────────────────
// 치유병
// ─────────────────────────────────────────────────────────────

describe('치유병: 반경 안의 다친 다른 적을 간격마다 회복 (최대 HP까지)', () => {
  // 줄 0: 3열 치유병, 4열(옆 84 px)·6열(252 px) 적 / 줄 1: 2열(대각 119 px) 적, 3열 보스(위 84 px) / 줄 2: 3열(168 px) 적
  const ROWS = ['...hd.d.', '..dX....', '...d....'];
  const hurtAll = (sim: CombatSim, by: number): void => {
    for (const e of sim.enemies) if (e.defId !== 'guard') e.hp = e.maxHp - by;
  };

  it('반경(중심 거리 134 px) 안의 다친 적만, 최대 HP × 15%씩 — 자기 자신·보스·반경 밖은 아니다', () => {
    const sim = park(ROWS);
    const h = one(sim, 'healer');
    hurtAll(sim, 300);
    const evs = stepUntilEvent(sim, (e) => e.type === 'heal');
    expect(sim.time).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(sim.time).toBeLessThanOrEqual(1 + SIM_DT + 1e-6);
    const heals = ofType(evs, 'heal');
    const near = sim.enemies.filter((e) => e.defId === 'dummy' && Math.hypot(e.x - h.x, e.y - h.y) <= 134);
    expect(near).toHaveLength(2);
    expect(heals.map((x) => x.enemyId).sort()).toEqual(near.map((e) => e.id).sort());
    for (const x of heals) {
      expect(x).toMatchObject({ sourceId: h.id, amount: 150, fromX: h.x + h.w / 2, fromY: h.y + h.h / 2 });
    }
    for (const e of near) expect(e.hp).toBe(e.maxHp - 150);
    expect(h.hp).toBe(h.maxHp - 300);
    expect(one(sim, 'bossy').hp).toBe(1000 - 300);
    for (const e of sim.enemies.filter((x) => x.defId === 'dummy' && !near.includes(x))) expect(e.hp).toBe(e.maxHp - 300);
  });

  it('간격마다 한 번, 최대 HP를 넘지 않고, 다 차면 이벤트 없이 기다렸다가 다치는 순간 바로 회복', () => {
    const sim = park(ROWS);
    hurtAll(sim, 200);
    const pulses: number[] = [];
    const amounts: number[] = [];
    for (let i = 0; i < 6 * 60; i++) {
      sim.step(SIM_DT, IDLE);
      const hs = ofType(sim.drainEvents(), 'heal');
      if (hs.length > 0) pulses.push(sim.time);
      amounts.push(...hs.map((x) => x.amount));
    }
    // 200 = 150 + 50 (상한) → 두 번 회복하고 끝
    expect(pulses).toHaveLength(2);
    expect(pulses[1] - pulses[0]).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(amounts.sort()).toEqual([150, 150, 50, 50].sort());
    const near = sim.enemies.filter((e) => e.defId === 'dummy' && e.hp === e.maxHp);
    expect(near).toHaveLength(2);
    for (const e of sim.enemies) expect(e.hp).toBeLessThanOrEqual(e.maxHp);

    // 다 찬 채로 기다리던 치유병: 옆 적이 다치면 바로 다음 스텝에 회복
    const target = near[0];
    target.hp -= 10;
    sim.step(SIM_DT, IDLE);
    expect(ofType(sim.drainEvents(), 'heal')).toEqual([expect.objectContaining({ enemyId: target.id, amount: 10 })]);
    expect(target.hp).toBe(target.maxHp);
  });

  it('화면에 들어오기 전엔 회복하지 않고, 냉기면 타이머가 느리게 흐른다 (공격과 같은 규칙)', () => {
    const off = park(ROWS);
    hurtAll(off, 300);
    for (const e of off.enemies) if (e.defId !== 'guard') e.y -= ROW0_Y + 60; // 줄 0 아래 끝 y = 16 < 40
    expect(ofType(runFor(off, 3), 'heal')).toEqual([]);

    const cold = park(ROWS);
    hurtAll(cold, 300);
    one(cold, 'healer').chillTime = 100;
    stepUntilEvent(cold, (e) => e.type === 'heal', 400);
    // interval 1 / CHILL_ATTACK_RATE 0.4 = 2.5초
    expect(cold.time).toBeGreaterThanOrEqual(2.5 - 1e-6);
    expect(cold.time).toBeLessThanOrEqual(2.5 + SIM_DT + 1e-6);
  });
});

// ─────────────────────────────────────────────────────────────
// 폭탄병
// ─────────────────────────────────────────────────────────────

describe('폭탄병: 죽으면 둘레 적에게 큰 피해, 연쇄 — 플레이어는 안 맞는다', () => {
  it('kill 바로 뒤 explode(fromEnemy) → 반경 안의 적마다 피해 × hpMul, 반경 밖·플레이어는 그대로', () => {
    // 줄 0: 2·4·5(130 px)·6(214 px)열 적, 3열 폭탄병 / 줄 1: 3열(46 px) / 줄 2: 3열(130 px)·4열(138 px — 밖)
    const sim = park(['..dxddd.', '...d....', '...dd...']);
    const b = one(sim, 'bomber');
    const input = standAt(sim, colMid(3), 640); // 폭발 반경 안이지만 몸은 안 닿음
    shoot(sim, { x: colMid(3), y: 760, vx: 0, vy: -600, damage: 5 });
    const evs = stepUntilEvent(sim, (e) => e.type === 'kill', 120, input);
    const kinds = evs.filter((e) => e.type !== 'bounce').map((e) => e.type);
    const k = kinds.indexOf('kill');
    expect(kinds[k + 1]).toBe('explode');
    const ex = ofType(evs, 'explode')[0];
    expect(ex).toMatchObject({ fromEnemy: b.id, radius: 134, element: null, x: colMid(3), y: ROW0_MID });
    const hit = new Map(ofType(evs, 'hit').filter((h) => h.enemyId !== b.id).map((h) => [h.enemyId, h.damage] as const));
    const dummies = byDef(sim, 'dummy');
    const inside = dummies.filter((e) => {
      const qx = Math.max(e.x, Math.min(colMid(3), e.x + e.w));
      const qy = Math.max(e.y, Math.min(ROW0_MID, e.y + e.h));
      return Math.hypot(colMid(3) - qx, ROW0_MID - qy) < 134;
    });
    expect(inside).toHaveLength(5);
    expect([...hit.keys()].sort()).toEqual(inside.map((e) => e.id).sort());
    for (const v of hit.values()) expect(v).toBe(40);
    for (const e of dummies) expect(e.hp).toBe(inside.includes(e) ? 960 : 1000);
    expect(sim.player.hp).toBe(PLAYER.maxHp);
    expect(ofType(evs, 'playerHit')).toEqual([]);
    expect(sim.status).toBe('running');
  });

  it('피해는 스테이지 HP 배수를 따른다', () => {
    const sim = park(['..dx....'], { stage: { hpMul: 2 } });
    const d = one(sim, 'dummy');
    one(sim, 'bomber').hp = 1;
    shoot(sim, { x: colMid(3), y: 760, vx: 0, vy: -600, damage: 5 });
    run(sim, 60);
    expect(d.maxHp - d.hp).toBe(80);
  });

  it('줄 하나가 연쇄로 다 터진다 — 적마다 kill·explode 한 번씩, 끝이 있다', () => {
    const sim = park(['yyyyyyyy']);
    const ids = byDef(sim, 'bomb30').map((e) => e.id);
    shoot(sim, { x: colMid(0), y: 760, vx: 0, vy: -600, damage: 30 });
    const evs = run(sim, 60);
    const kills = ofType(evs, 'kill').map((k) => k.enemyId);
    expect(kills.sort()).toEqual([...ids].sort());
    expect(new Set(kills).size).toBe(kills.length);
    const blasts = ofType(evs, 'explode').map((x) => x.fromEnemy);
    expect(blasts.sort()).toEqual([...ids].sort());
    expect(sim.killedEnemies).toBe(8);
  });

  it('빽빽한 덩어리(폭탄병끼리 서로 반경 안)도 한 번씩만 — 무한 반복 없음', () => {
    const rows = ['yyyyyyyy', 'yyyyyyyy', 'yyyyyyyy', 'yyyyyyyy'];
    const sim = park(rows);
    shoot(sim, { x: colMid(4), y: 760, vx: 0, vy: -600, damage: 30 });
    const evs = run(sim, 30);
    const kills = ofType(evs, 'kill').map((k) => k.enemyId);
    expect(kills).toHaveLength(32);
    expect(new Set(kills).size).toBe(32);
    expect(ofType(evs, 'explode')).toHaveLength(32);
    expect(byDef(sim, 'bomb30')).toEqual([]);
  });

  it('폭발에 죽은 젤리에서 나온 꼬마 젤리는 그 폭발에 휘말리지 않는다', () => {
    const sim = park(['..xg....']);
    shoot(sim, { x: colMid(2), y: 760, vx: 0, vy: -600, damage: 5 });
    const evs = stepUntilEvent(sim, (e) => e.type === 'enemySpawn');
    expect(ofType(evs, 'enemySpawn')).toHaveLength(2);
    for (const m of byDef(sim, 'mini')) expect(m.hp).toBe(m.maxHp);
  });
});

// ─────────────────────────────────────────────────────────────
// 장갑병
// ─────────────────────────────────────────────────────────────

describe('장갑병: 관통하지 않는 직접 적중 × armor, 관통·폭발은 그대로', () => {
  it('반사하는 공은 30% (hit.armor), 관통 적중은 100%', () => {
    const plain = park(['...a....']);
    shoot(plain, { x: colMid(3), y: 760, vx: 0, vy: -600 });
    expect(firstContact(plain)).toMatchObject({ type: 'hit', damage: 6, armor: true });

    const pierce = park(['...a....']);
    shoot(pierce, { x: colMid(3), y: 760, vx: 0, vy: -600, pierceLeft: 1 });
    const ev = firstContact(pierce) as Extract<CombatEvent, { type: 'hit' }>;
    expect(ev).toMatchObject({ type: 'hit', damage: 20 });
    expect(ev.armor).toBeUndefined();
  });

  it('폭발·연쇄 피해는 줄지 않는다, 백어택과 장갑은 곱해진다', () => {
    const ex = park(['..da....']);
    const a = one(ex, 'armored');
    shoot(ex, { x: colMid(2), y: 760, vx: 0, vy: -600, explodeRadius: 120, elements: ['lightning'] });
    const evs = run(ex, 30);
    const onA = ofType(evs, 'hit').filter((h) => h.enemyId === a.id);
    expect(onA.length).toBe(2); // 연쇄 10 + 폭발 10
    for (const h of onA) {
      expect(h.damage).toBe(10);
      expect(h.armor).toBeUndefined();
    }

    const top = park(['...a....']);
    shoot(top, { x: colMid(3), y: 300, vx: 0, vy: 600 });
    expect(firstContact(top)).toMatchObject({ type: 'hit', damage: 9, back: true, armor: true });
  });
});

// ─────────────────────────────────────────────────────────────
// 젤리 → 꼬마 젤리
// ─────────────────────────────────────────────────────────────

describe('젤리: 죽으면 빈 칸에 꼬마 젤리 둘 (자기 칸 먼저, 플레이어 위엔 안 생김, 필드 안, 결정적)', () => {
  /** 처치 공 (아래에서 젤리 가운데로, 피해 1 — 꼬마 젤리는 거의 안 다침) */
  const killFromBelow = (sim: CombatSim, col: number, y = 760): void => {
    shoot(sim, { x: colMid(col), y, vx: 0, vy: -600, damage: 1 });
  };
  const cellOf = (e: EnemyEntity): string => `${Math.round((e.x - ENEMY_INSET) / CELL)},${Math.round((e.y - ENEMY_INSET - (ROW0_Y - ENEMY_INSET)) / CELL)}`;

  it("kill 바로 뒤 'enemySpawn' 둘 — 자기 칸과 이웃 빈 칸 하나, 칸 격자 위, 겹침 없음, 착지 유예", () => {
    const sim = park(['...g....']);
    const j = one(sim, 'jelly');
    const total = sim.totalEnemies;
    expect(total).toBe(1 + 3); // 경비 + 젤리(자기 + 둘)
    killFromBelow(sim, 3);
    const evs = stepUntilEvent(sim, (e) => e.type === 'kill');
    const types = evs.filter((e) => e.type === 'kill' || e.type === 'enemySpawn').map((e) => e.type);
    expect(types).toEqual(['kill', 'enemySpawn', 'enemySpawn']);
    const spawns = ofType(evs, 'enemySpawn');
    for (const s of spawns) expect(s).toMatchObject({ defId: 'mini', parentId: j.id, fromX: colMid(3), fromY: ROW0_MID });
    const minis = byDef(sim, 'mini');
    expect(minis).toHaveLength(2);
    expect(cellOf(minis[0])).toBe('3,0');
    expect(['2,0', '4,0', '3,-1', '3,1']).toContain(cellOf(minis[1]));
    for (const m of minis) {
      expect((m.x - ENEMY_INSET) % CELL).toBeCloseTo(0, 9);
      expect(spawns.some((s) => s.enemyId === m.id && s.x === m.x + m.w / 2 && s.y === m.y + m.h / 2)).toBe(true);
      expect((m as EnemyEntity & { landing: number }).landing).toBeCloseTo(SUMMON_LAND_TIME, 9);
    }
    expect(overlaps(minis[0], minis[1])).toBe(false);
    expect(sim.totalEnemies).toBe(total);
    expect(sim.killedEnemies).toBe(1);
  });

  it('빈 칸에만: 위·왼쪽·오른쪽이 막혔으면 자기 칸 + 아래', () => {
    const sim = park(['........', '..dgd...', '...d....']);
    killFromBelow(sim, 3, 700);
    // 줄 1 젤리 아래 칸(줄 0)은 비어 있다 — 처치 공은 아래 칸을 지나 젤리를 친다
    stepUntilEvent(sim, (e) => e.type === 'enemySpawn');
    const cells = byDef(sim, 'mini').map(cellOf).sort();
    expect(cells).toEqual(['3,-1', '3,0'].sort());
    for (const a of sim.enemies) for (const b of sim.enemies) if (a !== b) expect(overlaps(a, b)).toBe(false);
  });

  it('자기 칸밖에 없으면 하나만 — 못 나온 수는 전체에서 빠져 진행도는 오른다', () => {
    const sim = park(['...d....', '..dgd...', '...d....'], { guard: false });
    const total = sim.totalEnemies;
    expect(total).toBe(4 + 3);
    // 옆에서 맞혀 죽인다 (위·아래·양옆이 다 막혀 있음 → 공은 위쪽 줄 2를 넘겨 떨어뜨림)
    one(sim, 'jelly').hp = 0.5;
    const before = sim.progress();
    // 화상 한 틱으로 죽인다 (공 경로 없이)
    one(sim, 'jelly').burnDps = 100;
    one(sim, 'jelly').burnTime = 1;
    const evs = stepUntilEvent(sim, (e) => e.type === 'kill');
    expect(ofType(evs, 'enemySpawn')).toHaveLength(1);
    expect(byDef(sim, 'mini').map(cellOf)).toEqual(['3,-1']);
    expect(sim.totalEnemies).toBe(total - 1);
    expect(sim.progress()).toBeGreaterThan(before);
  });

  it('플레이어 위에는 안 생긴다: 바로 옆 칸에 서 있으면 그 칸은 빼고, 몸에서 SPLIT_PLAYER_MARGIN 안의 칸도 뺀다', () => {
    // 왼쪽 칸 가운데에 서 있음: 왼쪽 칸 제외, 자기 칸은 26 px 떨어져 허용
    for (let seed = 1; seed <= 12; seed++) {
      const sim = park(['...g....'], { seed });
      const input = standAt(sim, colMid(2), ROW0_MID);
      killFromBelow(sim, 3);
      stepUntilEvent(sim, (e) => e.type === 'enemySpawn', 120, input);
      expect(sim.status).toBe('running');
      const minis = byDef(sim, 'mini');
      expect(minis).toHaveLength(2);
      for (const m of minis) {
        expect(gapToPlayer(sim, m), `seed ${seed} ${cellOf(m)}`).toBeGreaterThan(SPLIT_PLAYER_MARGIN);
        expect(cellOf(m)).not.toBe('2,0');
      }
      expect(minis.map(cellOf)).toContain('3,0');
    }
    // 젤리에 바짝 붙어 있으면(몸에서 6 px) 자기 칸도 뺀다
    const close = park(['...g....']);
    const input = standAt(close, colX(3) - PLAYER_HIT_RADIUS - 6, ROW0_MID);
    killFromBelow(close, 3);
    stepUntilEvent(close, (e) => e.type === 'enemySpawn', 120, input);
    const minis = byDef(close, 'mini');
    expect(minis.map(cellOf)).not.toContain('3,0');
    expect(minis.map(cellOf)).not.toContain('2,0');
    for (const m of minis) expect(gapToPlayer(close, m)).toBeGreaterThan(SPLIT_PLAYER_MARGIN);
  });

  it('필드 안에만: 왼쪽·오른쪽 끝 열, 방어선 바로 위 (아래 칸이 방어선을 넘으면 빼서 바로 지지 않는다)', () => {
    // 왼쪽 끝: 위·아래 막힘 → 자기 칸 + 오른쪽
    const left = park(['d.......', 'g.......', 'd.......']);
    shoot(left, { x: colMid(0) + 60, y: ROW0_Y - CELL + 38, vx: -600, vy: 0, damage: 1 });
    stepUntilEvent(left, (e) => e.type === 'enemySpawn');
    expect(byDef(left, 'mini').map(cellOf).sort()).toEqual(['0,-1', '1,-1'].sort());
    for (const m of byDef(left, 'mini')) expect(m.x).toBeGreaterThanOrEqual(0);
    // 오른쪽 끝
    const right = park(['.......d', '.......g', '.......d']);
    shoot(right, { x: colMid(7) - 60, y: ROW0_Y - CELL + 38, vx: 600, vy: 0, damage: 1 });
    stepUntilEvent(right, (e) => e.type === 'enemySpawn');
    expect(byDef(right, 'mini').map(cellOf).sort()).toEqual(['6,-1', '7,-1'].sort());
    for (const m of byDef(right, 'mini')) expect(m.x + m.w).toBeLessThanOrEqual(FIELD_W);
    // 방어선 근처: 양옆·위 막힘. 아래 칸은 방어선 안(아래 끝 954 < 960)이어도 방어선에서 한 칸이 안 남으면 빼서
    // 곧바로 방어선 패배가 나지 않는다 → 자기 칸 하나. 한 칸 넘게 남으면 아래 칸도 쓴다
    const lowAt = (bottom: number): EnemyEntity[] => {
      const low = park(['..dgd...', '...d....']);
      for (const e of low.enemies) if (e.defId !== 'guard') e.y += bottom - 76 - ROW0_Y;
      const input = standAt(low, 600, 400);
      const j = one(low, 'jelly');
      j.burnDps = 100;
      j.burnTime = 1;
      stepUntilEvent(low, (e) => e.type === 'kill', 120, input);
      run(low, 60, input);
      expect(low.status).toBe('running');
      return byDef(low, 'mini');
    };
    const near = lowAt(FIELD_H - 90);
    expect(near).toHaveLength(1);
    expect(near[0].y + near[0].h).toBeCloseTo(FIELD_H - 90, 6);
    const roomy = lowAt(FIELD_H - CELL - 100);
    expect(roomy).toHaveLength(2);
    expect(Math.max(...roomy.map((m) => m.y + m.h))).toBeLessThanOrEqual(FIELD_H - CELL);
  });

  it('결정적: 같은 시드 → 같은 칸, 시드가 바뀌면 이웃 칸이 바뀐다', () => {
    const cellsFor = (seed: number): string => {
      const sim = park(['...g....'], { seed });
      killFromBelow(sim, 3);
      stepUntilEvent(sim, (e) => e.type === 'enemySpawn');
      return byDef(sim, 'mini').map(cellOf).join(' ');
    };
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      expect(cellsFor(seed)).toBe(cellsFor(seed));
      seen.add(cellsFor(seed));
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('꼬마 젤리까지 다 잡아야 승리 (진행도는 처치 / 미리 센 전체), debugKillAll도 남김없이', () => {
    const sim = park(['...g....'], { guard: false });
    expect(sim.totalEnemies).toBe(3);
    killFromBelow(sim, 3);
    stepUntilEvent(sim, (e) => e.type === 'enemySpawn');
    expect(sim.status).toBe('running');
    expect(sim.progress()).toBeCloseTo(1 / 3, 9);
    sim.debugKillAll();
    expect(sim.status).toBe('won');
    expect(sim.progress()).toBe(1);

    const many = park(['gggggggg', 'g.g.g.g.'], { guard: false });
    many.debugKillAll();
    const evs = many.drainEvents();
    expect(many.status).toBe('won');
    expect(many.enemies).toEqual([]);
    const kills = ofType(evs, 'kill').map((k) => k.enemyId);
    expect(new Set(kills).size).toBe(kills.length);
    expect(kills.length).toBe(many.killedEnemies);
    expect(many.killedEnemies).toBe(many.totalEnemies);
  });

  it('갈라져 나오는 동안(SUMMON_LAND_TIME)은 몸에 닿아도 패배가 아니고, 내려앉은 뒤엔 접촉 패배', () => {
    // 위·아래·오른쪽 막힘 → 자기 칸 + 왼쪽 칸 (플레이어는 왼쪽 칸에서 26 px 넘게 떨어져 서 있다가 왼쪽 칸으로 들어간다)
    const sim = park(['...d....', '...gd...', '...d....']);
    const wait = standAt(sim, colX(2) - PLAYER_HIT_RADIUS - 30, ROW0_MID - CELL);
    const j = one(sim, 'jelly');
    j.burnDps = 100;
    j.burnTime = 1;
    stepUntilEvent(sim, (e) => e.type === 'enemySpawn', 120, wait);
    const leftMini = byDef(sim, 'mini').find((m) => cellOf(m) === '2,-1')!;
    expect(leftMini).toBeDefined();
    const into = standAt(sim, leftMini.x + leftMini.w / 2, leftMini.y + leftMini.h / 2);
    run(sim, Math.floor(SUMMON_LAND_TIME / SIM_DT) - 2, into);
    expect(sim.status).toBe('running');
    run(sim, 4, into);
    expect(sim.status).toBe('lost');
    expect(sim.lostReason).toBe('contact');
  });
});

// ─────────────────────────────────────────────────────────────
// RC카
// ─────────────────────────────────────────────────────────────

describe('RC카: 간격마다 옆 빈 칸으로 미끄러짐 (부드럽게, 예약, 플레이어 쪽으로는 안 감)', () => {
  const onGrid = (x: number): boolean => Math.abs(((x - ENEMY_INSET) / CELL) % 1) < 1e-9;

  it("간격마다 'shift' → speed px/s로 한 칸, 도착하면 정확히 칸 위치", () => {
    const sim = park(['...c....']);
    const c = one(sim, 'car');
    const evs = stepUntilEvent(sim, (e) => e.type === 'shift');
    expect(sim.time).toBeCloseTo(1, 6);
    const sh = ofType(evs, 'shift')[0];
    expect(sh.enemyId).toBe(c.id);
    expect(sh.fromX).toBe(colMid(3));
    expect([colMid(2), colMid(4)]).toContain(sh.toX);
    expect(sh.duration).toBeCloseTo(CELL / 210, 9);
    const target = sh.toX - c.w / 2;
    let prev = c.x;
    let steps = 0;
    while (c.x !== target && steps < 120) {
      sim.step(SIM_DT, IDLE);
      sim.drainEvents();
      expect(Math.abs(c.x - prev)).toBeLessThanOrEqual(210 * SIM_DT + 1e-9);
      expect(Math.sign(c.x - prev) === Math.sign(target - sh.fromX + c.w / 2) || c.x === prev).toBe(true);
      prev = c.x;
      steps++;
    }
    expect(c.x).toBe(target);
    expect(steps).toBe(Math.ceil(CELL / (210 * SIM_DT)));
    // 다음 옆걸음은 도착한 뒤 interval초 (미끄러지는 동안 타이머는 쉼) → 한 바퀴 1 + 0.4초.
    // 7초 동안 다섯 번, 멈춰 있을 때는 늘 칸 위, 필드 안
    let shifts = 0;
    const starts: number[] = [];
    for (let i = 0; i < 7 * 60; i++) {
      sim.step(SIM_DT, IDLE);
      const n = ofType(sim.drainEvents(), 'shift').length;
      if (n > 0) starts.push(sim.time);
      shifts += n;
      expect(c.x).toBeGreaterThanOrEqual(ENEMY_INSET - 1e-9);
      expect(c.x + c.w).toBeLessThanOrEqual(FIELD_W - ENEMY_INSET + 1e-9);
    }
    expect(shifts).toBe(5);
    for (let k = 1; k < starts.length; k++) expect(starts[k] - starts[k - 1]).toBeCloseTo(1 + Math.ceil(CELL / (210 * SIM_DT)) * SIM_DT, 6);
    expect(onGrid(c.x) || starts.length > 0).toBe(true);
  });

  it('양옆이 막혔으면 안 움직이고, 한쪽만 비었으면 그쪽으로', () => {
    const boxed = park(['..dcd...']);
    const c = one(boxed, 'car');
    expect(ofType(runFor(boxed, 5), 'shift')).toEqual([]);
    expect(c.x).toBe(colX(3));

    for (let seed = 1; seed <= 6; seed++) {
      const half = park(['..dc....'], { seed });
      const sh = ofType(stepUntilEvent(half, (e) => e.type === 'shift'), 'shift')[0];
      expect(sh.toX).toBe(colMid(4));
    }
  });

  it('플레이어가 있는 칸으로는 출발하지 않는다', () => {
    const sim = park(['..dc....']);
    const c = one(sim, 'car');
    const input = standAt(sim, colMid(4), ROW0_MID);
    const evs = runFor(sim, 5, input);
    expect(ofType(evs, 'shift')).toEqual([]);
    expect(c.x).toBe(colX(3));
    expect(sim.status).toBe('running');
  });

  it('미끄러지는 중에 플레이어가 길에 들어오면 멈춰 기다린다 — 몸으로 밀고 들어가지 않는다, 비키면 마저 간다', () => {
    const sim = park(['..dc....']);
    const c = one(sim, 'car');
    stepUntilEvent(sim, (e) => e.type === 'shift');
    // 목표 칸(4열) 오른쪽에 바짝: 목표에 닿으면 몸에서 4 px — 그 전에 멈춘다
    const block = standAt(sim, colX(4) + 76 + PLAYER_HIT_RADIUS + 4, ROW0_MID);
    let minGap = Infinity;
    for (let i = 0; i < 90; i++) {
      sim.step(SIM_DT, block);
      sim.drainEvents();
      minGap = Math.min(minGap, gapToPlayer(sim, c));
    }
    expect(sim.status).toBe('running');
    expect(minGap).toBeGreaterThan(SHIFT_PLAYER_MARGIN);
    const paused = c.x;
    expect(paused).toBeGreaterThan(colX(3));
    expect(paused).toBeLessThan(colX(4));
    run(sim, 30, block);
    expect(c.x).toBe(paused);
    // 비키면 마저 간다
    const away = standAt(sim, 600, 880);
    run(sim, 30, away);
    expect(c.x).toBe(colX(4));
  });

  it('열 버킷: 옮겨 간 열에서는 맞고, 떠난 열은 비어 있다', () => {
    const sim = park(['..dc....']);
    const c = one(sim, 'car');
    stepUntilEvent(sim, (e) => e.type === 'shift');
    run(sim, 30);
    expect(c.x).toBe(colX(4));
    shoot(sim, { x: colMid(4), y: 760, vx: 0, vy: -600, damage: 1 });
    expect(firstContact(sim)).toMatchObject({ type: 'hit', enemyId: c.id });

    const sim2 = park(['..dc....']);
    stepUntilEvent(sim2, (e) => e.type === 'shift');
    run(sim2, 30);
    // 떠난 3열로 똑바로: 천장까지 갔다가 그대로 내려와 빠진다 — 아무도 안 맞는다
    shoot(sim2, { x: colMid(3), y: 760, vx: 0, vy: -900, damage: 1, radius: 8 });
    const evs = runFor(sim2, 0.9);
    expect(ofType(evs, 'hit')).toEqual([]);
  });

  it('두 RC카가 같은 빈 칸을 노리면 하나만 간다 (예약) — 겹치는 순간이 없다', () => {
    // 2열·4열 RC카가 둘 다 3열만 갈 수 있고 같은 순간에 출발하려 한다 → 'shift'는 하나
    const pair = park(['.dc.cd..']);
    const first = stepUntilEvent(pair, (e) => e.type === 'shift');
    expect(ofType(first, 'shift')).toHaveLength(1);
    run(pair, 30);
    expect(byDef(pair, 'car').map((e) => e.x).sort((a, b) => a - b)).toHaveLength(2);
    // 여러 대가 무작위 간격으로 오가도 겹치지 않고, 늘 칸 위이거나 예약한 칸으로 가는 중
    for (let seed = 1; seed <= 8; seed++) {
      const sim = park(['.dc.c.d.', '.dcrc.d.', 'r.r.r.r.'], { seed });
      for (let i = 0; i < 8 * 60; i++) {
        sim.step(SIM_DT, IDLE);
        sim.drainEvents();
        const es = sim.enemies;
        for (let a = 0; a < es.length; a++) for (let b = a + 1; b < es.length; b++) expect(overlaps(es[a], es[b]), `seed ${seed} t ${sim.time}`).toBe(false);
        for (const e of [...byDef(sim, 'car'), ...byDef(sim, 'jittercar')]) {
          const slideTo = (e as EnemyEntity & { slideTo: number }).slideTo;
          expect(onGrid(e.x) || (slideTo >= 0 && onGrid(slideTo))).toBe(true);
        }
      }
    }
  });

  it('화면 밖에서는 안 움직이고, 냉기면 타이머가 느리게 흐른다', () => {
    const off = park(['...c....']);
    for (const e of off.enemies) if (e.defId !== 'guard') e.y = -60;
    expect(ofType(runFor(off, 4), 'shift')).toEqual([]);

    const cold = park(['...c....']);
    one(cold, 'car').chillTime = 100;
    stepUntilEvent(cold, (e) => e.type === 'shift', 400);
    expect(cold.time).toBeGreaterThanOrEqual(2.5 - 1e-6);
    expect(cold.time).toBeLessThanOrEqual(2.5 + SIM_DT + 1e-6);
  });
});

// ─────────────────────────────────────────────────────────────
// 보스전: 보스가 쓰러져 함께 터지는 졸개는 죽을 때 효과가 없다
// ─────────────────────────────────────────────────────────────

describe('보스전의 행동하는 졸개', () => {
  const KING: EnemyDef = enemyDef('king', { w: 4, h: 2, hp: 5000, boss: true });
  const enemies = { ...ENEMIES, king: KING };
  const boss: BossDef = {
    id: 'kingdef',
    enemy: 'king',
    anchorCol: 2,
    anchorY: 84,
    enterSpeed: 840,
    phases: [
      {
        hpFrac: 1,
        roar: 0.2,
        gap: 99,
        cooldownMul: 1,
        enterSummon: 4,
        minionCap: 4,
        creep: 0,
        minions: [
          { enemy: 'jelly', weight: 1 },
          { enemy: 'bomber', weight: 1 },
          { enemy: 'healer', weight: 1 },
          { enemy: 'car', weight: 1 },
        ],
      },
    ],
    actions: [{ id: 'summon', kind: 'summon', windup: 0.1, cooldown: 99, weights: [1], summon: { count: 4 } }],
  };

  it('보스 처치 → 졸개가 함께 터져도 폭발·분열 없이 승리, 남는 적 없음. 치유병은 보스를 회복하지 않는다', () => {
    const sim = new CombatSim({
      stage: { id: 'b', name: 'b', descentSpeed: 10, hpMul: 1, dmgMul: 1, clearGold: 0, rows: [], legend: {}, background: 'bg_test', boss: 'kingdef' },
      stageIndex: 0,
      enemies,
      bosses: { kingdef: boss },
      loadout: [],
      player: PLAYER,
      hp: 100,
      seed: 3,
    });
    const evs = runFor(sim, 1.5, { targetX: FIELD_W / 2, targetY: 880 });
    expect(ofType(evs, 'summon').length).toBeGreaterThan(0);
    const king = sim.enemies.find((e) => e.boss)!;
    king.hp -= 1000;
    for (const m of sim.enemies) if (!m.boss) m.hp = m.maxHp / 2;
    const later = runFor(sim, 5, { targetX: FIELD_W / 2, targetY: 880 });
    expect(ofType(later, 'heal').every((h) => h.enemyId !== king.id)).toBe(true);
    expect(king.hp).toBe(king.maxHp - 1000);
    sim.debugKillAll();
    const end = sim.drainEvents();
    expect(sim.status).toBe('won');
    expect(sim.enemies).toEqual([]);
    expect(ofType(end, 'enemySpawn')).toEqual([]);
    expect(ofType(end, 'explode')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// 실제 데이터: 결정성·이벤트·성능
// ─────────────────────────────────────────────────────────────

/** 픽스처 무기 (관통·폭발·번개·불·분열 섞음) — 행동하는 적의 모든 경로를 지나가게. dmg = 1발 피해 */
function heavyLoadout(dmg = 25): WeaponLoadout[] {
  const w = (uid: number, o: Partial<WeaponLoadout>): WeaponLoadout => ({
    uid,
    defId: `w${uid}`,
    tier: 1,
    cooldown: 0.4,
    damage: dmg,
    count: 1,
    spreadDeg: 0,
    speed: 700,
    radius: 10,
    pierce: 0,
    maxBounces: 0,
    elements: [],
    explodeRadius: 0,
    split: null,
    sprite: 'proj_test',
    spin: false,
    ...o,
  });
  const fire: Element[] = ['fire'];
  const zap: Element[] = ['lightning'];
  return [
    w(1, {}),
    w(2, { pierce: 1, cooldown: 0.7 }),
    w(3, { explodeRadius: 70, elements: fire, cooldown: 0.9 }),
    w(4, { count: 3, spreadDeg: 30, elements: zap, cooldown: 0.8, damage: dmg * 0.6 }),
    w(5, { split: { count: 3, damageMul: 0.5, sprite: 'proj_test', radius: 6 }, cooldown: 1.1 }),
  ];
}

function realSim(stageIndex: number, seed: number, dmg = 25): CombatSim {
  return new CombatSim({
    stage: GAME_DATA.stages[stageIndex],
    stageIndex,
    enemies: GAME_DATA.enemies,
    bosses: GAME_DATA.bosses,
    loadout: heavyLoadout(dmg),
    player: { ...PLAYER, maxHp: 1e6 },
    hp: 1e6,
    seed,
  });
}

/** 아래쪽 띠를 오가며 조준을 바꾸는 입력 (결정적) */
function wander(i: number): CombatInput {
  return { targetX: 336 + 260 * Math.sin(i / 70), targetY: 880, aimAngle: -Math.PI / 2 + 0.7 * Math.sin(i / 110) };
}

/** 한 판 (150초 상한): 이벤트 로그(JSON)·끝 상태, 본 이벤트 종류, 스텝마다 진행도 */
function play(si: number, seed: number, dmg = 25): { log: string; types: Set<string>; progress: number[]; status: string } {
  const sim = realSim(si, seed, dmg);
  const out: string[] = [];
  const types = new Set<string>();
  const progress: number[] = [];
  for (let i = 0; i < 150 * 60 && sim.status === 'running'; i++) {
    sim.step(SIM_DT, wander(i));
    for (const ev of sim.drainEvents()) {
      types.add(ev.type === 'explode' && ev.fromEnemy !== undefined ? 'deathBlast' : ev.type);
      if (ev.type === 'hit' && ev.back) types.add('back');
      if (ev.type === 'hit' && ev.armor) types.add('armor');
      out.push(JSON.stringify(ev));
    }
    progress.push(sim.progress());
  }
  const state = sim.enemies.map((e) => `${e.id}:${e.defId}:${e.x.toFixed(6)},${e.y.toFixed(6)}:${e.hp.toFixed(6)}`).join('|');
  return { log: `${sim.status} ${sim.time} ${sim.killedEnemies}/${sim.totalEnemies} ${state} ${out.join('\n')}`, types, progress, status: sim.status };
}

describe('실제 데이터 (st2~st5 — 행동하는 적)', () => {
  it.each([1, 2, 3, 4])('stage index %i: 같은 시드·입력 → 이벤트·상태가 똑같고, 진행도(처치 / 전체)는 줄지 않는다', (si) => {
    const a = play(si, 11);
    const b = play(si, 11);
    expect(a.log).toBe(b.log);
    expect(play(si, 12).log).not.toBe(a.log);
    for (let i = 1; i < a.progress.length; i++) expect(a.progress[i]).toBeGreaterThanOrEqual(a.progress[i - 1] - 1e-12);
    if (a.status === 'won') expect(a.progress.at(-1)).toBe(1);
  });

  it('st2~st5 판들에서 새 규칙의 이벤트가 다 나온다 (백어택·장갑·방패·치유·폭탄·분열·옆걸음)', () => {
    const seen = new Set<string>();
    for (const si of [1, 2, 3, 4]) for (const dmg of [10, 25]) for (const t of play(si, 11, dmg).types) seen.add(t);
    for (const t of ['blocked', 'heal', 'deathBlast', 'enemySpawn', 'shift', 'back', 'armor']) expect(seen.has(t), t).toBe(true);
  });

  it('적 객체는 모두 같은 모양 (스테이지 배치·꼬마 젤리 — 필드 순서가 같다)', () => {
    const sim = realSim(3, 5);
    const shapes = new Set<string>();
    for (let i = 0; i < 120 * 60 && sim.status === 'running'; i++) {
      sim.step(SIM_DT, wander(i));
      sim.drainEvents();
      if (i % 30 === 0) for (const e of sim.enemies) shapes.add(Object.keys(e).join(','));
    }
    expect(shapes.size).toBe(1);
  });

  it('성능: 행동하는 적 150 + 투사체 300 — 600스텝이 예산 안', () => {
    // 치유병·RC카·방패·장갑·폭탄·젤리가 섞인 대형 (빈칸이 있어 RC카가 움직인다), 체력이 커서 안 죽음
    const rows: string[] = [];
    const pattern = ['hk.cadxg', 'dkcd.adh', 'kd.hcdak', 'adkx.hdc'];
    for (let i = 0; i < 25; i++) rows.push(pattern[i % pattern.length]);
    const sim = park(rows, { stage: { hpMul: 1e6 }, player: { maxHp: 1e9 } });
    expect(sim.enemies.length).toBeGreaterThanOrEqual(150);
    for (const e of sim.enemies) if (e.defId !== 'guard') e.y += 300;
    const rng = new Rng(77);
    const refill = (): void => {
      while (sim.projectiles.length < 300) {
        const a = -Math.PI / 2 + rng.range(-1, 1);
        shoot(sim, { x: rng.range(20, FIELD_W - 20), y: rng.range(840, 900), vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, damage: 1e5, radius: 8 });
      }
    };
    const input = standAt(sim, FIELD_W / 2, 930);
    for (let i = 0; i < 60; i++) {
      refill();
      sim.step(SIM_DT, input);
      sim.drainEvents();
    }
    let heals = 0;
    let shifts = 0;
    let blocked = 0;
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) {
      refill();
      sim.step(SIM_DT, input);
      for (const ev of sim.drainEvents()) {
        if (ev.type === 'heal') heals++;
        else if (ev.type === 'shift') shifts++;
        else if (ev.type === 'blocked') blocked++;
      }
    }
    const ms = performance.now() - t0;
    expect(sim.status).toBe('running');
    expect(heals).toBeGreaterThan(0);
    expect(shifts).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
    expect(ms).toBeLessThan(3000);
  });

  it('성능: 화면을 채운 폭탄병·젤리가 연쇄로 한꺼번에 죽어도 빠르고, 처치는 한 번씩', () => {
    // 11줄 × 8칸이 화면 안 (줄 0 위끝 780 — 방어선 위, 맨 윗줄도 보임), 플레이어는 맨 아래
    const rows = Array.from({ length: 11 }, (_, i) => (i % 2 === 0 ? 'yyyyyyyy' : 'ygygygyg'));
    const sim = park(rows, { guard: false });
    for (const e of sim.enemies) e.y += 780 - ROW0_Y;
    for (const e of byDef(sim, 'jelly')) e.hp = 30;
    const initial = sim.enemies.length;
    const input = standAt(sim, colMid(0), 926);
    shoot(sim, { x: colMid(0), y: 890, vx: 0, vy: -600, damage: 30, radius: 6 });
    const t0 = performance.now();
    const evs = run(sim, 20, input);
    const ms = performance.now() - t0;
    const kills = ofType(evs, 'kill').map((k) => k.enemyId);
    expect(new Set(kills).size).toBe(kills.length);
    expect(kills.length).toBeGreaterThanOrEqual(initial);
    expect(ofType(evs, 'explode').length).toBe(byDefCount(rows, 'y'));
    expect(ms).toBeLessThan(500);
  });
});
