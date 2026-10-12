// 시너지 아이템 12종 (docs/DESIGN.md '시너지 아이템', docs/ARCHITECTURE.md 'stats.ts'·'sim.ts' 시너지).
// 데이터·상점 풀 → 스탯(맞닿은 무기에만 / 전역, ★ 배수, 겹침 규칙·상한) → sim 규칙(픽스처 적에 직접 넣은 공) →
// 실제 가방에서 발사까지 → 상호작용(관통·분열·반사·트램펄린·유도) → 모든 아이템을 한꺼번에(NaN·결정성·모양).
import { describe, expect, it } from 'vitest';
import {
  BACK_ATTACK_MUL,
  CELL,
  CHAIN_DAMAGE_MUL,
  CHAIN_TARGETS,
  CHAIN_TARGETS_MAX,
  ENEMY_INSET,
  FIELD_H,
  HOMING_MAX_DEG,
  KILL_BURST_MAX,
  KILL_BURST_RADIUS,
  PROJ_RADIUS_BONUS_MAX,
  PROJ_SPEED_BONUS_MAX,
  PROJ_SPEED_BONUS_MIN,
  PROJECTILE_MAX_AGE,
  RUBBER_BONUS_CAP,
  SEED_CHILD_MAX_AGE,
  SEED_CHILD_MIN_RADIUS,
  SEED_CHILD_RADIUS_MUL,
  SEED_SPLIT_COUNT,
  SEED_SPLIT_DAMAGE_MAX,
  SIM_DT,
  SPLIT_CHILD_MAX_AGE,
  STEAM_ENEMY_COOLDOWN,
  STEAM_RADIUS,
  SYNERGY_PROJECTILE_CAP,
  TIER_EFFECT_MUL,
  TRAMPOLINE_AFTER_LIFE,
} from '../src/config';
import { ASSET_MAP, GAME_DATA } from '../src/data';
import { addNewToBag, addToStash, createBag, findFreeSpot } from '../src/logic/bag';
import { CombatSim } from '../src/logic/combat/sim';
import { Rng } from '../src/logic/rng';
import { combatSeed, newRun, rewardKill, runLoadout, runPlayerStats } from '../src/logic/run';
import { rollItemDef, shopCandidates } from '../src/logic/shop';
import { computeLoadout, computePlayerStats, computeWeapon, scaledGear, scaledStone } from '../src/logic/stats';
import type {
  BagState,
  CombatEvent,
  CombatInput,
  EnemyDef,
  EnemyEntity,
  PlayerStats,
  ProjectileEntity,
  Rot,
  StageDef,
  Tier,
  WeaponLoadout,
} from '../src/types';

const ITEMS = GAME_DATA.items;
const DEG = Math.PI / 180;

const SYNERGY_STONES = ['s_rubber', 's_hammer', 's_seed', 's_coil', 's_mushroom', 's_wheel', 's_match', 's_ribbon'] as const;
const SYNERGY_GEAR = ['g_kettle', 'g_firecracker', 'g_trampoline', 'g_backcoin'] as const;
const SYNERGY_IDS = [...SYNERGY_STONES, ...SYNERGY_GEAR];

// ═════════════════════════════════════════════════════════════
// 데이터 / 상점 풀
// ═════════════════════════════════════════════════════════════

describe('시너지 아이템 데이터', () => {
  it('12종 모두 있고 종류·아이콘·이름·상점 필드가 맞다', () => {
    for (const id of SYNERGY_IDS) {
      const d = ITEMS[id];
      expect(d, id).toBeDefined();
      expect(d.kind, id).toBe(id.startsWith('s_') ? 'stone' : 'gear');
      expect(d.icon, id).toBe(`item_${id}`);
      expect(ASSET_MAP[d.icon], `${id} icon in assets.json`).toBeDefined();
      expect(/[가-힣]/.test(d.name) && /[가-힣]/.test(d.desc), `${id} 한국어 이름·설명`).toBe(true);
      expect(d.shopWeight, id).toBeGreaterThan(0);
      expect(d.minStage, id).toBeLessThanOrEqual(2);
      // 시너지 돌은 1칸 (어느 무기 옆에나 붙일 수 있게)
      if (d.kind === 'stone') expect([d.w, d.h], id).toEqual([1, 1]);
    }
  });

  it('설명이 ★1 효과 수치를 그대로 말한다 (수치를 바꾸면 설명도 바꿀 것)', () => {
    const pct = (v: number): string => `${Math.round(Math.abs(v) * 100)}%`;
    const s = (id: string) => ITEMS[id].stone!;
    const g = (id: string) => ITEMS[id].gear!;
    const expectations: [string, string[]][] = [
      ['s_rubber', [pct(s('s_rubber').bounceDamage!), `+${Math.round(RUBBER_BONUS_CAP * 100)}%`]],
      ['s_hammer', [pct(s('s_hammer').backAttackBonus!)]],
      ['s_seed', [`${SEED_SPLIT_COUNT}개`, pct(s('s_seed').seedSplit!)]],
      ['s_coil', [`+${s('s_coil').chainTargetsAdd}`, pct(s('s_coil').chainDamageAdd!)]],
      ['s_mushroom', [pct(s('s_mushroom').radiusMul!), pct(s('s_mushroom').damageMul!), pct(s('s_mushroom').speedMul!)]],
      ['s_wheel', [pct(s('s_wheel').speedMul!), pct(s('s_wheel').damageMul!)]],
      ['s_ribbon', [`${s('s_ribbon').homingDeg}°`]],
      ['g_kettle', [pct(g('g_kettle').steamMul!), `${STEAM_ENEMY_COOLDOWN}초`]],
      ['g_firecracker', [pct(g('g_firecracker').killBurst!)]],
      ['g_backcoin', [`+${g('g_backcoin').backKillGold}`]],
    ];
    for (const [id, parts] of expectations) for (const part of parts) expect(ITEMS[id].desc, `${id}: '${part}'`).toContain(part);
    expect(ITEMS.s_match.stone!.element).toBe('fire');
    expect(ITEMS.g_trampoline.gear!.trampoline).toBe(true);
    expect(ITEMS.s_coil.stone!.chainHop).toBe(true);
  });

  it('minStage부터 상점·드롭 후보에 들고, 마지막 스테이지 상점 굴림에서 12종이 모두 나온다', () => {
    for (const id of SYNERGY_IDS) {
      const d = ITEMS[id];
      expect(shopCandidates(GAME_DATA, d.minStage).some((c) => c.id === id), id).toBe(true);
      if (d.minStage > 0) expect(shopCandidates(GAME_DATA, d.minStage - 1).some((c) => c.id === id), id).toBe(false);
    }
    const rng = new Rng(4242);
    const seen = new Set<string>();
    for (let i = 0; i < 6000; i++) seen.add(rollItemDef(GAME_DATA, 4, rng)!.id);
    for (const id of SYNERGY_IDS) expect(seen.has(id), id).toBe(true);
  });

  it('★ 배수: 수치 효과는 TIER_EFFECT_MUL배, boolean 효과(번개 코일 한 번 더·트램펄린)는 그대로', () => {
    for (const t of [1, 2, 3] as Tier[]) {
      const m = TIER_EFFECT_MUL[t];
      expect(scaledStone(ITEMS.s_rubber.stone!, t).bounceDamage).toBeCloseTo(0.1 * m, 12);
      expect(scaledStone(ITEMS.s_coil.stone!, t).chainHop).toBe(true);
      expect(scaledStone(ITEMS.s_match.stone!, t)).toMatchObject({ element: 'fire' });
      expect(scaledStone(ITEMS.s_match.stone!, t).burnSpread).toBeCloseTo(100 * m, 9);
      expect(scaledGear(ITEMS.g_trampoline.gear!, t)).toEqual({ trampoline: true });
      expect(scaledGear(ITEMS.g_kettle.gear!, t).steamMul).toBeCloseTo(ITEMS.g_kettle.gear!.steamMul! * m, 12);
    }
  });
});

// ═════════════════════════════════════════════════════════════
// 스탯: 맞닿은 무기에만 / 전역 장비 / 겹침 규칙·상한
// ═════════════════════════════════════════════════════════════

const CAT = GAME_DATA.characters.cat;
const BASE: PlayerStats = { maxHp: 100, moveSpeed: 420, regenPerSec: 0, goldMul: 1, damageMul: 1, cooldownMul: 1 };

function put(bag: BagState, defId: string, x: number, y: number, tier: Tier = 1, rot: Rot = 0): number {
  const it = addNewToBag(bag, ITEMS, defId, tier, x, y, rot);
  if (!it) throw new Error(`cannot place ${defId} at ${x},${y}`);
  return it.uid;
}

/** 털뭉치 둘: 왼쪽(0,0)은 (1,0)의 돌과 맞닿고, 오른쪽(4,0)은 아무것도 안 닿는다 */
function pairWith(stone: string, tier: Tier = 1): { near: WeaponLoadout; far: WeaponLoadout } {
  const bag = createBag(5, 4);
  const near = put(bag, 'w_hairball', 0, 0);
  put(bag, stone, 1, 0, tier);
  const far = put(bag, 'w_hairball', 4, 0);
  return { near: computeWeapon(bag, ITEMS, near, BASE)!, far: computeWeapon(bag, ITEMS, far, BASE)! };
}

const PLAIN_HAIRBALL = (() => {
  const bag = createBag(5, 4);
  return computeWeapon(bag, ITEMS, put(bag, 'w_hairball', 0, 0), BASE)!;
})();

describe('스탯: 시너지 돌은 맞닿은 무기에만', () => {
  it.each(SYNERGY_STONES.map((s) => [s] as const))('%s: 맞닿은 무기만 바뀌고 떨어진 무기는 그대로', (stone) => {
    const { near, far } = pairWith(stone);
    expect(far).toEqual({ ...PLAIN_HAIRBALL, uid: far.uid });
    expect(near).not.toEqual({ ...PLAIN_HAIRBALL, uid: near.uid });
  });

  it('각 돌의 ★1 값이 무기에 그대로 들어간다', () => {
    const hb = ITEMS.w_hairball.weapon!.projectile;
    expect(pairWith('s_rubber').near.bounceDamage).toBeCloseTo(0.1, 12);
    expect(pairWith('s_hammer').near.backAttackBonus).toBeCloseTo(0.6, 12);
    expect(pairWith('s_coil').near).toMatchObject({ chainTargetsAdd: 2, chainHops: 1 });
    expect(pairWith('s_coil').near.chainDamageAdd).toBeCloseTo(0.25, 12);
    expect(pairWith('s_coil').near.elements).toEqual([]); // 번개를 주지는 않는다 (번개 무기용)
    expect(pairWith('s_match').near).toMatchObject({ burnSpread: 100, elements: ['fire'] });
    expect(pairWith('s_ribbon').near.homing).toBeCloseTo(90 * DEG, 12);
    const mush = pairWith('s_mushroom').near;
    expect(mush.radius).toBeCloseTo(hb.radius * 1.4, 9);
    expect(mush.speed).toBeCloseTo(hb.speed * 0.85, 9);
    expect(mush.damage).toBeCloseTo(hb.damage * 1.2, 9);
    const wheel = pairWith('s_wheel').near;
    expect(wheel.speed).toBeCloseTo(hb.speed * 1.3, 9);
    expect(wheel.damage).toBeCloseTo(hb.damage * 1.05, 9);
    expect(wheel.radius).toBe(hb.radius);
    const seed = pairWith('s_seed').near;
    expect(seed.split).toEqual({
      count: SEED_SPLIT_COUNT,
      damageMul: 0.4,
      sprite: hb.sprite,
      radius: Math.max(SEED_CHILD_MIN_RADIUS, hb.radius * SEED_CHILD_RADIUS_MUL),
      seed: true,
    });
  });

  it('★2·★3: 수치는 1.6·2.2배, 연쇄 대상은 합산 후 내림, 한 번 더 튀기는 그대로 1', () => {
    expect(pairWith('s_rubber', 3).near.bounceDamage).toBeCloseTo(0.22, 12);
    expect(pairWith('s_coil', 2).near).toMatchObject({ chainTargetsAdd: 3, chainHops: 1 }); // 3.2 → 3
    expect(pairWith('s_coil', 3).near).toMatchObject({ chainTargetsAdd: 4, chainHops: 1 }); // 4.4 → 4
    expect(pairWith('s_seed', 2).near.split!.damageMul).toBeCloseTo(0.64, 12);
    expect(pairWith('s_ribbon', 3).near.homing).toBeCloseTo(198 * DEG, 9);
    expect(pairWith('s_match', 2).near.burnSpread).toBeCloseTo(160, 9);
  });

  it('겹치기: 합산 + 상한 (씨앗 데미지, 연쇄 대상, 반경, 속도, 유도), 성냥은 가장 큰 반경, 코일 여러 개도 한 번만 더', () => {
    // 2×2 토스터 둘레 8칸에 같은 돌 ★3을 여럿
    const ring: [number, number][] = [[1, 0], [2, 0], [0, 1], [0, 2], [3, 1], [3, 2], [1, 3], [2, 3]];
    const around = (stone: string, n: number, tier: Tier = 3): WeaponLoadout => {
      const bag = createBag(5, 4);
      const w = put(bag, 'w_toaster', 1, 1);
      for (let i = 0; i < n; i++) put(bag, stone, ring[i][0], ring[i][1], tier);
      return computeWeapon(bag, ITEMS, w, BASE)!;
    };
    const toast = ITEMS.w_toaster.weapon!.projectile;
    expect(around('s_rubber', 2, 1).bounceDamage).toBeCloseTo(0.2, 12);
    expect(around('s_seed', 2).split!.damageMul).toBe(SEED_SPLIT_DAMAGE_MAX); // 0.88 × 2 → 상한
    expect(around('s_coil', 3)).toMatchObject({ chainTargetsAdd: CHAIN_TARGETS_MAX - CHAIN_TARGETS, chainHops: 1 }); // 13 → 6
    expect(around('s_mushroom', 3).radius).toBeCloseTo(toast.radius * (1 + PROJ_RADIUS_BONUS_MAX), 9);
    expect(around('s_mushroom', 4).speed).toBeCloseTo(toast.speed * (1 + PROJ_SPEED_BONUS_MIN), 9);
    expect(around('s_wheel', 3).speed).toBeCloseTo(toast.speed * (1 + PROJ_SPEED_BONUS_MAX), 9);
    expect(around('s_ribbon', 3).homing).toBeCloseTo(HOMING_MAX_DEG * DEG, 9);
    // 버섯 + 바퀴: 속도 -15% + 30% = +15%
    const bag = createBag(5, 4);
    const w = put(bag, 'w_toaster', 1, 1);
    put(bag, 's_mushroom', 1, 0);
    put(bag, 's_wheel', 2, 0);
    put(bag, 's_match', 0, 1, 1);
    put(bag, 's_match', 0, 2, 3);
    const mix = computeWeapon(bag, ITEMS, w, BASE)!;
    expect(mix.speed).toBeCloseTo(toast.speed * 1.15, 9);
    expect(mix.burnSpread).toBeCloseTo(220, 9);
    // 버섯은 원래 분열(고무오리)의 자식 반경도 키우고, 씨앗은 원래 분열 무기에는 효과 없음
    const duckBag = createBag(5, 4);
    const duck = put(duckBag, 'w_duck', 0, 0);
    put(duckBag, 's_mushroom', 1, 0);
    put(duckBag, 's_seed', 1, 1);
    const dl = computeWeapon(duckBag, ITEMS, duck, BASE)!;
    expect(dl.split).toEqual({ ...ITEMS.w_duck.weapon!.projectile.split!, radius: ITEMS.w_duck.weapon!.projectile.split!.radius * 1.4 });
  });

  it('가장 빠르게(바퀴 ★3 셋 = 속도 상한) + 씨앗 자식(가장 작게)이어도 서브스텝이 틈새로 새지 않는 범위 (audit-combat과 같은 기준)', () => {
    const weapons = Object.values(ITEMS).filter((d) => d.weapon);
    for (const d of weapons) {
      const bag = createBag(7, 6);
      const w = put(bag, d.id, 2, 2);
      // 바퀴 셋(위·오른쪽·아래) + 씨앗(왼쪽) — 크기와 무관하게 무기의 첫 칸 줄·열에 맞닿는 칸
      put(bag, 's_wheel', 2, 1, 3);
      put(bag, 's_wheel', 2 + d.w, 2, 3);
      put(bag, 's_wheel', 2, 2 + d.h, 3);
      put(bag, 's_seed', 1, 2, 3);
      const l = computeWeapon(bag, ITEMS, w, BASE)!;
      expect(l.split, d.id).not.toBeNull();
      expect(l.speed, d.id).toBeCloseTo(d.weapon!.projectile.speed * (1 + PROJ_SPEED_BONUS_MAX), 9);
      const specs: [string, number][] = [[d.id, l.radius]];
      if (l.split) specs.push([`${d.id}/split`, l.split.radius]);
      for (const [id, r] of specs) {
        const travel = l.speed * SIM_DT;
        const n = Math.min(6, Math.max(1, Math.ceil(travel / (r * 0.8))));
        expect(r, id).toBeGreaterThan(ENEMY_INSET);
        expect(travel / n, id).toBeLessThan(Math.sqrt(r * r - ENEMY_INSET * ENEMY_INSET));
      }
    }
  });

  it('뒤통수 망치는 PlayerStats.backAttackBonus(런 보너스 자리)와 더해진다', () => {
    const bag = createBag(5, 4);
    const w = put(bag, 'w_hairball', 0, 0);
    expect(computeWeapon(bag, ITEMS, w, { ...BASE, backAttackBonus: 0.15 })!.backAttackBonus).toBeCloseTo(0.15, 12);
    put(bag, 's_hammer', 1, 0);
    expect(computeWeapon(bag, ITEMS, w, { ...BASE, backAttackBonus: 0.15 })!.backAttackBonus).toBeCloseTo(0.75, 12);
  });
});

describe('스탯: 시너지 장비는 가방 안에서 전역', () => {
  it('없으면 키가 없다 (예전 스탯 모양 그대로)', () => {
    const s = computePlayerStats(CAT, createBag(), ITEMS);
    for (const k of ['steamMul', 'killBurst', 'trampoline', 'backKillGold', 'backAttackBonus']) expect(k in s, k).toBe(false);
  });

  it('주전자·동전은 합산, 폭죽은 합 상한, 트램펄린은 몇 개·★든 1, 보관함은 무시', () => {
    const bag = createBag(7, 6);
    put(bag, 'g_kettle', 0, 0, 1);
    put(bag, 'g_kettle', 1, 0, 2);
    put(bag, 'g_firecracker', 2, 0, 3);
    put(bag, 'g_firecracker', 3, 0, 3);
    put(bag, 'g_trampoline', 0, 1, 3);
    put(bag, 'g_trampoline', 2, 1, 1);
    put(bag, 'g_backcoin', 4, 0, 1);
    put(bag, 'g_backcoin', 5, 0, 2);
    addToStash(bag, 'g_kettle', 3);
    const s = computePlayerStats(CAT, bag, ITEMS);
    expect(s.steamMul).toBeCloseTo(ITEMS.g_kettle.gear!.steamMul! * (TIER_EFFECT_MUL[1] + TIER_EFFECT_MUL[2]), 12);
    // ★3 두 개의 합 — 상한(KILL_BURST_MAX)을 넘으면 상한에서 멈춘다
    expect(s.killBurst).toBeCloseTo(Math.min(KILL_BURST_MAX, 2 * ITEMS.g_firecracker.gear!.killBurst! * TIER_EFFECT_MUL[3]), 12);
    // 상한: ★3 폭죽을 상한을 넘도록 쌓으면 정확히 KILL_BURST_MAX
    const many = createBag(7, 6);
    const need = Math.ceil(KILL_BURST_MAX / (ITEMS.g_firecracker.gear!.killBurst! * TIER_EFFECT_MUL[3])) + 1;
    for (let i = 0; i < need; i++) put(many, 'g_firecracker', i % 7, Math.floor(i / 7), 3);
    expect(computePlayerStats(CAT, many, ITEMS).killBurst).toBe(KILL_BURST_MAX);
    expect(s.trampoline).toBe(1);
    expect(s.backKillGold).toBeCloseTo(2.6, 12);
    // 장비는 무기 스탯을 바꾸지 않는다 (전역 효과는 sim·보상에서)
    const w = put(bag, 'w_hairball', 6, 5);
    const { steamMul: _a, killBurst: _b, trampoline: _c, backKillGold: _d, ...plain } = s;
    expect(computeWeapon(bag, ITEMS, w, s)).toEqual(computeWeapon(bag, ITEMS, w, plain));
  });
});

// ═════════════════════════════════════════════════════════════
// sim 규칙 (픽스처 적 + 직접 넣은 공)
// ═════════════════════════════════════════════════════════════

function enemyDef(id: string, o: Partial<EnemyDef> = {}): EnemyDef {
  return { id, name: id, sprite: `enemy_${id}`, w: 1, h: 1, hp: 1000, gold: 0, dropChance: 0, ...o };
}

const ENEMIES: Record<string, EnemyDef> = {
  dummy: enemyDef('dummy'),
  guard: enemyDef('guard', { hp: 1e9 }),
  vic: enemyDef('vic', { hp: 30 }),
  twelve: enemyDef('twelve', { hp: 12 }),
  pop: enemyDef('pop', { hp: 100 }),
  fifty: enemyDef('fifty', { hp: 50 }),
  bossy: enemyDef('bossy', { hp: 1, boss: true }),
};
const LEGEND: Record<string, string> = { d: 'dummy', G: 'guard', v: 'vic', b: 'twelve', p: 'pop', q: 'fifty', X: 'bossy' };

const IDLE: CombatInput = { targetX: null, targetY: null };
const ROW0_Y = 500;
const ROW0_BOTTOM = ROW0_Y + CELL - 2 * ENEMY_INSET;
const colMid = (c: number): number => c * CELL + CELL / 2;

/** rows(아래 → 위), 줄 0의 위끝 = ROW0_Y. 맨 위에 화면 밖 경비(G, 안 보이고 안 맞는다) — 다 잡아도 'won'으로 끝나지 않게 */
function park(rows: string[], player: Partial<PlayerStats> = {}, loadout: WeaponLoadout[] = [], seed = 1): CombatSim {
  const stage: StageDef = {
    id: 'syn', name: 'syn', descentSpeed: 0, hpMul: 1, dmgMul: 1, clearGold: 0,
    rows: [...rows, 'G.......'], legend: LEGEND, background: 'bg_test',
  };
  const ps = { ...BASE, maxHp: 1e6, ...player };
  const sim = new CombatSim({ stage, stageIndex: 0, enemies: ENEMIES, loadout, player: ps, hp: ps.maxHp, seed });
  const dy = ROW0_Y - (-CELL + ENEMY_INSET);
  for (const e of sim.enemies) e.y += dy;
  sim.enemies[sim.enemies.length - 1].y = -600;
  return sim;
}

/** sim 내부 시너지 필드 (launch가 쓰는 것과 같은 이름) */
interface Syn {
  rubber: number;
  bounces: number;
  backBonus: number;
  homing: number;
  floorBounces: number;
  burnSpread: number;
  chainAdd: number;
  chainMul: number;
  chainHops: number;
  maxAge?: number;
}
const SYN0: Syn = { rubber: 0, bounces: 0, backBonus: 0, homing: 0, floorBounces: 0, burnSpread: 0, chainAdd: 0, chainMul: 0, chainHops: 0 };
type Ball = ProjectileEntity & Syn;
type BallInit = Partial<Ball> & Pick<ProjectileEntity, 'x' | 'y' | 'vx' | 'vy'>;

let nextId = 8_000_000;
function shoot(sim: CombatSim, o: BallInit): Ball {
  const p: Ball = {
    id: nextId++, weaponUid: 0, radius: 10, damage: 20, pierceLeft: 0, bouncesLeft: Infinity, elements: [], explodeRadius: 0,
    split: null, sprite: 'proj_test', spin: false, age: 0, alive: true, ...SYN0, ...o,
  };
  sim.projectiles.push(p);
  return p;
}

/** 방향 deg(0 = 오른쪽, 90 = 아래)로, (tx, ty)에서 dist px 앞에서 출발 */
function shootAt(sim: CombatSim, tx: number, ty: number, deg: number, o: Partial<Ball> = {}, dist = 150, speed = 600): Ball {
  const a = deg * DEG;
  return shoot(sim, { x: tx - Math.cos(a) * dist, y: ty - Math.sin(a) * dist, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, ...o });
}

function run(sim: CombatSim, seconds: number, input: CombatInput = IDLE): CombatEvent[] {
  const out: CombatEvent[] = [];
  for (let i = 0; i < Math.round(seconds / SIM_DT) && sim.status === 'running'; i++) {
    sim.step(SIM_DT, input);
    out.push(...sim.drainEvents());
  }
  return out;
}

/** 그 이벤트가 나온 스텝까지 (그 스텝의 이벤트만 반환) */
function stepUntil(sim: CombatSim, match: (e: CombatEvent) => boolean, maxSteps = 600): CombatEvent[] {
  for (let i = 0; i < maxSteps; i++) {
    sim.step(SIM_DT, IDLE);
    const ev = sim.drainEvents();
    if (ev.some(match)) return ev;
  }
  throw new Error('stepUntil: event not seen');
}

function ofType<T extends CombatEvent['type']>(ev: CombatEvent[], type: T): Extract<CombatEvent, { type: T }>[] {
  return ev.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === type);
}

/** 줄 row, 열 col의 적 (충돌 박스 가운데로 찾음) */
function at(sim: CombatSim, col: number, row = 0): EnemyEntity {
  const cx = colMid(col);
  const cy = ROW0_Y - row * CELL + (CELL - 2 * ENEMY_INSET) / 2;
  const e = sim.enemies.find((q) => Math.abs(q.x + q.w / 2 - cx) < 1 && Math.abs(q.y + q.h / 2 - cy) < 1);
  if (!e) throw new Error(`no enemy at ${col},${row}`);
  return e;
}

describe('sim: 탄성 고무 (반사마다 데미지)', () => {
  /** 꽉 찬 줄 위(천장과 사이)에 갇혀 덜그럭거리는 공 하나 — 적중마다 그 전까지의 반사 수로 피해가 정해진다 */
  function rattle(rubber: number): { hits: { damage: number; back: boolean; n: number }[] } {
    const sim = park(['GGGGGGGG']);
    shoot(sim, { x: 300, y: 200, vx: 700, vy: -1100, rubber });
    const hits: { damage: number; back: boolean; n: number }[] = [];
    let n = 0;
    for (const ev of run(sim, PROJECTILE_MAX_AGE + 0.5)) {
      if (ev.type === 'bounce') n++;
      if (ev.type === 'hit') hits.push({ damage: ev.damage, back: ev.back === true, n });
    }
    return { hits };
  }

  it('적중 피해 = 기본 × (1 + min(상한, 반사 수 × 값)) — 벽·적 반사 모두 센다, 상한 +100%', () => {
    const { hits } = rattle(0.25);
    expect(hits.length).toBeGreaterThanOrEqual(4);
    for (const h of hits) {
      const want = Math.round(20 * (1 + Math.min(RUBBER_BONUS_CAP, h.n * 0.25)) * (h.back ? BACK_ATTACK_MUL : 1));
      expect(h.damage, `after ${h.n} bounces`).toBe(want);
    }
    expect(hits.some((h) => h.n * 0.25 > RUBBER_BONUS_CAP)).toBe(true); // 상한까지 갔다
    expect(Math.max(...hits.map((h) => h.damage))).toBe(Math.round(20 * (1 + RUBBER_BONUS_CAP) * BACK_ATTACK_MUL));
  });

  it('고무가 없으면 반사해도 피해가 그대로', () => {
    for (const h of rattle(0).hits) expect(h.damage).toBe(Math.round(20 * (h.back ? BACK_ATTACK_MUL : 1)));
  });
});

describe('sim: 뒤통수 망치 (백어택만)', () => {
  it('윗면 적중은 × 1.5 × (1 + 0.6), 아랫면은 그대로', () => {
    const top = park(['.d......']);
    shootAt(top, colMid(1), ROW0_Y, 90, { backBonus: 0.6 });
    const t = ofType(stepUntil(top, (e) => e.type === 'hit'), 'hit')[0];
    expect(t.back).toBe(true);
    expect(t.damage).toBe(Math.round(20 * BACK_ATTACK_MUL * 1.6));
    const bottom = park(['.d......']);
    shootAt(bottom, colMid(1), ROW0_BOTTOM, -90, { backBonus: 0.6 });
    const b = ofType(stepUntil(bottom, (e) => e.type === 'hit'), 'hit')[0];
    expect(b.back).toBeUndefined();
    expect(b.damage).toBe(20);
  });
});

describe('sim: 번개 코일', () => {
  const BLOCK = ['.ddddd..', '.ddddd..', '.ddddd..'];
  function zap(o: Partial<Ball>): { chains: Extract<CombatEvent, { type: 'chain' }>[]; hits: Extract<CombatEvent, { type: 'hit' }>[]; src: number } {
    const sim = park(BLOCK);
    const src = at(sim, 3).id;
    shootAt(sim, colMid(3), ROW0_BOTTOM, -90, { damage: 40, elements: ['lightning'], ...o });
    const ev = stepUntil(sim, (e) => e.type === 'hit');
    return { chains: ofType(ev, 'chain'), hits: ofType(ev, 'hit').filter((h) => h.element === 'lightning' && h.enemyId !== src), src };
  }

  it('코일 없음: 대상 2, 연쇄의 연쇄 없음', () => {
    const z = zap({});
    expect(z.chains).toHaveLength(CHAIN_TARGETS);
    expect(z.hits.map((h) => h.damage)).toEqual([20, 20]);
  });

  it('대상 +2, 피해 +25%, 맞은 적마다 한 번 더 — 같은 적을 두 번 맞히지 않고 원래 맞은 적도 다시 안 맞는다', () => {
    const z = zap({ chainAdd: 2, chainMul: 0.25, chainHops: 1 });
    const first = z.chains.filter((c) => c.fromX === colMid(3) && c.fromY === ROW0_Y + (CELL - 2 * ENEMY_INSET) / 2);
    expect(first).toHaveLength(CHAIN_TARGETS + 2);
    expect(z.chains).toHaveLength(2 * (CHAIN_TARGETS + 2));
    const ids = z.hits.map((h) => h.enemyId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(z.src);
    for (const h of z.hits) expect(h.damage).toBe(Math.round(40 * CHAIN_DAMAGE_MUL * 1.25));
  });

  it('한 번 더 튀기만 있으면 2 + 2, 대상 수는 CHAIN_TARGETS_MAX에서 멈춘다', () => {
    expect(zap({ chainHops: 1 }).chains).toHaveLength(2 * CHAIN_TARGETS);
    // 맞은 적 바로 위에 적 12마리를 몰아 둔다 (연쇄 범위 안 후보 > 상한)
    const sim = park(['dddddddd', 'ddddd...']);
    const src = at(sim, 3);
    let k = 0;
    for (const e of sim.enemies) {
      if (e === src || e.y < -100) continue;
      e.x = src.x + ((k % 5) - 2) * 25;
      e.y = src.y - 30 - Math.floor(k / 5) * 30;
      k++;
    }
    expect(k).toBeGreaterThan(CHAIN_TARGETS_MAX);
    shootAt(sim, colMid(3), ROW0_BOTTOM, -90, { damage: 40, elements: ['lightning'], chainAdd: 50 });
    const ev = stepUntil(sim, (e) => e.type === 'hit');
    expect(ofType(ev, 'chain')).toHaveLength(CHAIN_TARGETS_MAX);
  });

  it('번개가 없는 공은 코일이 있어도 연쇄하지 않는다', () => {
    expect(zap({ elements: [], chainAdd: 2, chainMul: 0.25, chainHops: 1 }).chains).toHaveLength(0);
  });
});

describe('sim: 전염 성냥', () => {
  it('성냥 불이 타는 채로 죽은 적에서 반경 안(맞닿은 칸)의 적에게 불이 옮는다 — 두 칸 떨어진 적은 아니다', () => {
    const sim = park(['ddvdd...', '..d.....']);
    const victim = at(sim, 2);
    const near = [at(sim, 1).id, at(sim, 3).id, at(sim, 2, 1).id].sort();
    shootAt(sim, colMid(2), ROW0_BOTTOM, -90, { elements: ['fire'], burnSpread: 100 });
    const ev = run(sim, 3);
    expect(ofType(ev, 'kill').map((k) => k.enemyId)).toContain(victim.id);
    const spread = ofType(ev, 'burnSpread');
    expect(spread.every((s) => s.sourceId === victim.id)).toBe(true);
    expect(spread.map((s) => s.enemyId).sort()).toEqual(near);
    // 옮은 불은 원래 불과 같은 세기 (적중 20 × 화상 비율 → 초당 5)
    for (const id of near) expect(sim.enemies.find((e) => e.id === id)!.burnTime).toBeGreaterThan(0);
  });

  it('성냥 없는 불은 옮지 않는다', () => {
    const sim = park(['ddvdd...']);
    shootAt(sim, colMid(2), ROW0_BOTTOM, -90, { elements: ['fire'] });
    expect(ofType(run(sim, 3), 'burnSpread')).toHaveLength(0);
  });

  it('옮은 불도 전염된다: 한 줄이 차례로 타 죽는다 (적마다 한 번만)', () => {
    const sim = park(['bbbbbbbb']);
    shootAt(sim, colMid(0), ROW0_BOTTOM, -90, { elements: ['fire'], damage: 48, burnSpread: 100 });
    const ev = run(sim, 12);
    const kills = ofType(ev, 'kill').map((k) => k.enemyId);
    expect(kills).toHaveLength(8);
    expect(new Set(kills).size).toBe(8);
    expect(ofType(ev, 'burnSpread').length).toBeGreaterThanOrEqual(7);
  });
});

describe('sim: 유도 리본', () => {
  function flight(homing: number): { hitIds: number[]; target: number; turns: number[]; speeds: number[] } {
    const sim = park(['...d....']);
    const target = at(sim, 3).id;
    const p = shoot(sim, { x: colMid(1), y: 900, vx: 0, vy: -950, homing });
    const hitIds: number[] = [];
    const turns: number[] = [];
    const speeds: number[] = [];
    for (let i = 0; i < 120 && p.alive; i++) {
      const a0 = Math.atan2(p.vy, p.vx);
      sim.step(SIM_DT, IDLE);
      const ev = sim.drainEvents();
      for (const h of ofType(ev, 'hit')) hitIds.push(h.enemyId);
      speeds.push(Math.hypot(p.vx, p.vy));
      if (ev.some((e) => e.type === 'bounce')) continue;
      let d = Math.atan2(p.vy, p.vx) - a0;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      turns.push(Math.abs(d));
    }
    return { hitIds, target, turns, speeds };
  }

  it('곧게 쏘면 못 맞힐 적을, 초당 90°까지만 휘어 맞힌다 — 속력은 그대로, 반사도 그대로', () => {
    const straight = flight(0);
    expect(straight.hitIds).not.toContain(straight.target);
    const homing = flight(90 * DEG);
    expect(homing.hitIds).toContain(homing.target);
    for (const t of homing.turns) expect(t).toBeLessThanOrEqual(90 * DEG * SIM_DT + 1e-9);
    expect(Math.max(...homing.turns)).toBeGreaterThan(0);
    for (const s of homing.speeds) expect(s).toBeCloseTo(950, 6);
  });

  it('보이는 적이 없으면 휘지 않는다', () => {
    const sim = park(['........']);
    const p = shoot(sim, { x: 300, y: 900, vx: 0, vy: -950, homing: 90 * DEG });
    run(sim, 0.5);
    expect(p.vx).toBe(0);
  });
});

describe('sim: 증기 주전자', () => {
  /** 가운데(3열) 적에 공 하나 (아래에서). 3열 적의 상태를 미리 정한다 */
  function steamTest(player: Partial<PlayerStats>, elements: ('fire' | 'ice')[], status: { burn?: number; chill?: number }) {
    const sim = park(['..ddd...'], player);
    const t = at(sim, 3);
    if (status.burn) t.burnTime = status.burn; // burnDps 0 — 상태만 (틱 피해 없음)
    if (status.chill) t.chillTime = status.chill;
    shootAt(sim, colMid(3), ROW0_BOTTOM, -90, { elements });
    return { sim, t, ev: stepUntil(sim, (e) => e.type === 'hit') };
  }

  it('불타는 적을 얼음으로: 적중점에서 증기 폭발 — 맞은 적 포함 반경 안 적에게 직접 피해 × 1.5', () => {
    const { sim, t, ev } = steamTest({ steamMul: 1.5 }, ['ice'], { burn: 5 });
    const steam = ofType(ev, 'explode').filter((e) => e.cause === 'steam');
    expect(steam).toHaveLength(1);
    expect(steam[0]).toMatchObject({ x: colMid(3), y: ROW0_BOTTOM, radius: STEAM_RADIUS, element: null });
    const idx = ev.indexOf(steam[0]);
    const after = ofType(ev.slice(idx), 'hit');
    // 맞은 적은 이번 얼음 적중으로 냉기 → 받는 피해 +25%
    expect(after.find((h) => h.enemyId === t.id)!.damage).toBe(Math.round(30 * 1.25));
    expect(after.filter((h) => h.enemyId !== t.id).map((h) => [h.enemyId, h.damage])).toEqual([
      [at(sim, 2).id, 30],
      [at(sim, 4).id, 30],
    ]);
    // 직접 적중 'hit'이 먼저
    expect(ev.findIndex((e) => e.type === 'hit')).toBeLessThan(idx);
  });

  it('얼어붙은 적을 불로도 터진다. 같은 적은 1초에 한 번', () => {
    const { sim, t, ev } = steamTest({ steamMul: 1.5 }, ['fire'], { chill: 5 });
    expect(ofType(ev, 'explode').filter((e) => e.cause === 'steam')).toHaveLength(1);
    t.chillTime = 5;
    shootAt(sim, colMid(3), ROW0_BOTTOM, -90, { elements: ['fire'] });
    const again = stepUntil(sim, (e) => e.type === 'hit' && e.enemyId === t.id && e.element === 'fire');
    expect(ofType(again, 'explode').filter((e) => e.cause === 'steam')).toHaveLength(0);
    run(sim, STEAM_ENEMY_COOLDOWN);
    t.chillTime = 5;
    shootAt(sim, colMid(3), ROW0_BOTTOM, -90, { elements: ['fire'] });
    const later = stepUntil(sim, (e) => e.type === 'hit' && e.enemyId === t.id && e.element === 'fire');
    expect(ofType(later, 'explode').filter((e) => e.cause === 'steam')).toHaveLength(1);
  });

  it('조건이 안 맞거나(같은 속성·상태 없음) 주전자가 없으면 터지지 않는다', () => {
    const none = (ev: CombatEvent[]) => ofType(ev, 'explode').filter((e) => e.cause === 'steam');
    expect(none(steamTest({ steamMul: 1.5 }, ['fire'], {}).ev)).toHaveLength(0);
    expect(none(steamTest({ steamMul: 1.5 }, ['fire'], { burn: 5 }).ev)).toHaveLength(0);
    expect(none(steamTest({ steamMul: 1.5 }, ['ice'], { chill: 5 }).ev)).toHaveLength(0);
    expect(none(steamTest({}, ['ice'], { burn: 5 }).ev)).toHaveLength(0);
  });
});

describe('sim: 폭죽 심지', () => {
  it('처치한 적이 최대 HP × 0.3으로 맞닿은 적에게 터진다 (두 칸 떨어진 적은 아니다)', () => {
    const sim = park(['dpd.d...', '.d......'], { killBurst: 0.3 });
    const pop = at(sim, 1);
    const near = [at(sim, 0).id, at(sim, 2).id, at(sim, 1, 1).id];
    shootAt(sim, colMid(1), ROW0_BOTTOM, -90, { damage: 200 });
    const ev = stepUntil(sim, (e) => e.type === 'kill');
    const boom = ofType(ev, 'explode').find((e) => e.cause === 'firecracker')!;
    expect(boom).toMatchObject({ fromEnemy: pop.id, radius: KILL_BURST_RADIUS, element: null, x: colMid(1) });
    const after = ofType(ev.slice(ev.indexOf(boom)), 'hit');
    expect(after.map((h) => h.enemyId).sort()).toEqual([...near].sort());
    for (const h of after) expect(h.damage).toBe(30);
  });

  it('연쇄: 휘말려 죽은 적도 터진다 — 한 줄이 다 터지고 끝난다 (적마다 한 번만)', () => {
    const sim = park(['qqqqqqqq'], { killBurst: 1 });
    shootAt(sim, colMid(0), ROW0_BOTTOM, -90, { damage: 200 });
    const ev = run(sim, 0.6);
    const kills = ofType(ev, 'kill').map((k) => k.enemyId);
    expect(kills).toHaveLength(8);
    expect(new Set(kills).size).toBe(8);
    expect(ofType(ev, 'explode').filter((e) => e.cause === 'firecracker')).toHaveLength(8);
  });

  it('보스는 터지지 않고, 장비가 없으면 아무 일도 없다', () => {
    const boss = park(['dXd.....'], { killBurst: 0.3 });
    shootAt(boss, colMid(1), ROW0_BOTTOM, -90, { damage: 200 });
    expect(ofType(run(boss, 0.5), 'explode')).toHaveLength(0);
    const plain = park(['dpd.....']);
    shootAt(plain, colMid(1), ROW0_BOTTOM, -90, { damage: 200 });
    expect(ofType(run(plain, 0.5), 'explode')).toHaveLength(0);
  });

  it('보스 테스트: 보스가 쓰러져 함께 터지는 졸개는 폭죽·불 옮김이 없다', () => {
    const bt = GAME_DATA.bossTest;
    const sim = new CombatSim({
      stage: bt.stage, stageIndex: 0, enemies: GAME_DATA.enemies, bosses: GAME_DATA.bosses, loadout: [],
      player: { ...BASE, maxHp: 1e9, killBurst: 0.7 }, hp: 1e9, seed: 5,
    });
    run(sim, 8);
    const alive = sim.enemies.length;
    expect(alive).toBeGreaterThan(1); // 졸개가 있다
    // 졸개들이 성냥 불에 타는 중이었다고 해도
    for (const e of sim.enemies) {
      if (e.boss) continue;
      e.burnTime = 2;
      e.burnDps = 5;
      (e as unknown as { burnSpread: number }).burnSpread = 100;
    }
    sim.debugKillAll();
    const ev = sim.drainEvents();
    expect(ofType(ev, 'kill')).toHaveLength(alive);
    expect(ofType(ev, 'kill')[0].boss).toBe(true);
    expect(ofType(ev, 'explode')).toHaveLength(0);
    expect(ofType(ev, 'burnSpread')).toHaveLength(0);
    expect(sim.status).toBe('won');
  });
});

describe('sim: 트램펄린', () => {
  it('바닥에 닿은 공이 한 번 위로 튕기고(floor 이벤트), 남은 수명은 TRAMPOLINE_AFTER_LIFE — 두 번째는 빠진다', () => {
    const sim = park(['........']);
    const p = shoot(sim, { x: 300, y: 850, vx: 120, vy: 900, floorBounces: 1, maxAge: PROJECTILE_MAX_AGE });
    const ev = stepUntil(sim, (e) => e.type === 'bounce' && e.floor === true);
    const fb = ofType(ev, 'bounce').find((b) => b.floor)!;
    expect(fb).toMatchObject({ y: FIELD_H, wall: false });
    expect(p.alive).toBe(true);
    expect(p.vy).toBeLessThan(0);
    expect(p.floorBounces).toBe(0);
    const bouncedAt = p.age;
    expect(p.maxAge).toBeCloseTo(bouncedAt + TRAMPOLINE_AFTER_LIFE, 9);
    const rest = run(sim, 3);
    expect(p.alive).toBe(false);
    expect(ofType(rest, 'bounce').filter((b) => b.floor)).toHaveLength(0);
    expect(p.age).toBeLessThanOrEqual(bouncedAt + TRAMPOLINE_AFTER_LIFE + SIM_DT + 1e-9);
  });

  it('트램펄린이 없으면 예전처럼 바닥 아래로 빠진다', () => {
    const sim = park(['........']);
    const p = shoot(sim, { x: 300, y: 850, vx: 0, vy: 900 });
    const ev = run(sim, 0.5);
    expect(p.alive).toBe(false);
    expect(p.y - p.radius).toBeGreaterThan(FIELD_H);
    expect(ofType(ev, 'bounce')).toHaveLength(0);
  });

  it('탄성 고무와: 바닥 튕김도 반사로 센다', () => {
    const sim = park(['........']);
    const p = shoot(sim, { x: 300, y: 850, vx: 0, vy: 900, floorBounces: 1, rubber: 0.1 });
    stepUntil(sim, (e) => e.type === 'bounce' && e.floor === true);
    expect(p.bounces).toBe(1);
  });

  it(`시너지 밀도 상한: 투사체가 ${SYNERGY_PROJECTILE_CAP}개 이상이면 쉰다`, () => {
    const sim = park(['........']);
    // 위쪽에서 천천히 떠다니는 공들로 필드를 채운다
    for (let i = 0; i < SYNERGY_PROJECTILE_CAP; i++) shoot(sim, { x: 40 + (i % 15) * 40, y: 100 + Math.floor(i / 15) * 40, vx: 30, vy: -5 });
    const p = shoot(sim, { x: 300, y: 850, vx: 0, vy: 900, floorBounces: 1 });
    const ev = run(sim, 0.5);
    expect(ofType(ev, 'bounce').filter((b) => b.floor)).toHaveLength(0);
    expect(p.alive).toBe(false);
  });
});

describe('sim: 분열 씨앗 (밀도 상한)', () => {
  it(`투사체가 ${SYNERGY_PROJECTILE_CAP}개 이상이면 씨앗 분열이 쉰다 (무기 고유 분열은 그대로)`, () => {
    const seedSpec = { count: 2, damageMul: 0.4, sprite: 'proj_test', radius: 8, seed: true };
    const duckSpec = { count: 3, damageMul: 0.5, sprite: 'proj_duckling', radius: 10 };
    for (const [spec, full, want] of [
      [seedSpec, false, 1],
      [seedSpec, true, 0],
      [duckSpec, true, 1],
    ] as const) {
      const sim = park(['.d......']);
      if (full) for (let i = 0; i < SYNERGY_PROJECTILE_CAP; i++) shoot(sim, { x: 300 + (i % 8) * 40, y: 100 + Math.floor(i / 8) * 40, vx: 30, vy: -5 });
      shootAt(sim, colMid(1), ROW0_BOTTOM, -90, { split: { ...spec } });
      const ev = run(sim, 0.4);
      expect(ofType(ev, 'split'), `${spec.sprite} full=${full}`).toHaveLength(want);
    }
  });
});

// ═════════════════════════════════════════════════════════════
// 실제 가방 → 발사 (launch·분열 자식이 시너지 값을 싣는다)
// ═════════════════════════════════════════════════════════════

describe('실제 가방에서 발사', () => {
  /** 2×2 토스터 둘레 8칸에 시너지 돌 8종 + 트램펄린 */
  function toasterBag(): { bag: BagState; uid: number } {
    const bag = createBag(5, 4);
    const uid = put(bag, 'w_toaster', 1, 1);
    const ring: [string, number, number][] = [
      ['s_rubber', 1, 0], ['s_hammer', 2, 0], ['s_coil', 0, 1], ['s_ribbon', 0, 2],
      ['s_match', 3, 1], ['s_mushroom', 3, 2], ['s_wheel', 1, 3], ['s_seed', 2, 3],
    ];
    for (const [id, x, y] of ring) put(bag, id, x, y);
    put(bag, 'g_trampoline', 3, 0);
    return { bag, uid };
  }

  it('발사한 공과 씨앗 자식이 무기의 시너지 값을 싣는다 (자식은 짧은 수명, 트램펄린 새로 한 번)', () => {
    const { bag, uid } = toasterBag();
    const player = computePlayerStats(CAT, bag, ITEMS);
    const l = computeWeapon(bag, ITEMS, uid, player)!;
    expect(player.trampoline).toBe(1);
    const sim = park(['...dd...'], player, [l]);
    const ev = stepUntil(sim, (e) => e.type === 'fire');
    expect(ev.length).toBeGreaterThan(0);
    const shots = sim.projectiles as unknown as Ball[];
    expect(shots).toHaveLength(l.count);
    for (const p of shots) {
      expect(p).toMatchObject({
        rubber: l.bounceDamage, bounces: 0, backBonus: l.backAttackBonus, homing: l.homing, floorBounces: 1,
        burnSpread: l.burnSpread, chainAdd: l.chainTargetsAdd, chainMul: l.chainDamageAdd, chainHops: l.chainHops,
        radius: l.radius, damage: l.damage, elements: ['fire'],
      });
      expect(Math.hypot(p.vx, p.vy)).toBeCloseTo(l.speed, 6);
    }
    stepUntil(sim, (e) => e.type === 'split');
    const kids = (sim.projectiles as unknown as Ball[]).filter((p) => p.radius === l.split!.radius);
    expect(kids.length).toBeGreaterThanOrEqual(SEED_SPLIT_COUNT);
    for (const k of kids) {
      expect(k).toMatchObject({ rubber: l.bounceDamage, homing: l.homing, floorBounces: 1, burnSpread: l.burnSpread, split: null, sprite: 'proj_toast' });
      expect(k.maxAge).toBe(SEED_CHILD_MAX_AGE);
      expect(k.damage).toBeCloseTo(l.damage * l.split!.damageMul, 9);
    }
  });

  it('씨앗 + 관통(양말): 첫 관통 적중에서 갈라진다. 고무오리의 원래 분열은 씨앗과 무관하게 그대로', () => {
    const sockBag = createBag(5, 4);
    const sock = put(sockBag, 'w_sock', 0, 0);
    put(sockBag, 's_seed', 1, 0);
    const ls = computeWeapon(sockBag, ITEMS, sock, BASE)!;
    expect(ls.pierce).toBe(1);
    const sim = park(['...dd...'], {}, [ls]);
    const ev = stepUntil(sim, (e) => e.type === 'split');
    expect(ofType(ev, 'split')[0].count).toBe(SEED_SPLIT_COUNT);
    expect(ofType(ev, 'hit')).toHaveLength(1); // 관통 적중 하나에서
    const duckBag = createBag(5, 4);
    const duck = put(duckBag, 'w_duck', 0, 0);
    put(duckBag, 's_seed', 1, 0);
    const ld = computeWeapon(duckBag, ITEMS, duck, BASE)!;
    const dsim = park(['...dd...'], {}, [ld]);
    stepUntil(dsim, (e) => e.type === 'split');
    const kids = (dsim.projectiles as unknown as Ball[]).filter((p) => p.sprite === 'proj_duckling');
    expect(kids).toHaveLength(3);
    for (const k of kids) expect(k.maxAge).toBe(SPLIT_CHILD_MAX_AGE);
  });
});

// ═════════════════════════════════════════════════════════════
// 뒤통수 동전 (처치 보상)
// ═════════════════════════════════════════════════════════════

describe('뒤통수 동전 (rewardKill)', () => {
  function runWith(gear: boolean) {
    const run = newRun(GAME_DATA, 'penguin', 3);
    if (gear) {
      const spot = findFreeSpot(run.bag, ITEMS, 'g_backcoin')!;
      addNewToBag(run.bag, ITEMS, 'g_backcoin', 1, spot.x, spot.y, spot.rot);
    }
    return run;
  }

  it('백어택 처치에만 +1골드 (골드 배수 적용 전), RNG 소비는 같다', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const base = runWith(true);
      base.rngState = seed * 7919;
      const gm = runPlayerStats(GAME_DATA, base).goldMul;
      const u = new Rng(base.rngState).next();
      const expectGold = (g: number): number => Math.floor(g + 1e-9) + (u < g - Math.floor(g + 1e-9) ? 1 : 0);
      const a = structuredClone(base);
      const b = structuredClone(base);
      const ra = rewardKill(GAME_DATA, a, 'soldier', true);
      const rb = rewardKill(GAME_DATA, b, 'soldier', false);
      const soldier = GAME_DATA.enemies.soldier.gold;
      expect(ra.gold).toBe(expectGold((soldier + 1) * gm));
      expect(rb.gold).toBe(expectGold(soldier * gm));
      expect(a.rngState).toBe(b.rngState);
    }
  });

  it('동전이 없으면 back 플래그는 아무것도 바꾸지 않는다', () => {
    const base = runWith(false);
    const a = structuredClone(base);
    const b = structuredClone(base);
    expect(rewardKill(GAME_DATA, a, 'soldier', true)).toEqual(rewardKill(GAME_DATA, b, 'soldier', false));
    expect(a).toEqual(b);
  });
});

// ═════════════════════════════════════════════════════════════
// 모든 시너지 아이템을 한꺼번에 (실제 데이터)
// ═════════════════════════════════════════════════════════════

/**
 * 7×6 가방: 무기 9종 + 시너지 돌 8종(+ 씨앗 하나 더) + 시너지 장비 4종 + 분신 거울 2. 위 → 아래:
 *   y0  정전기  코일  개틀링  씨앗   털뭉치  거울  유자
 *   y1  고무    망치  리본    바퀴   버섯    성냥  거울
 *   y2  불꽃토스터(2×2) 빙수(2×2) 엄마오리  참치(2×1)
 *   y3  〃              〃        〃        주전자 폭죽
 *   y4  트램펄린(2×1)   동전  .   .   .     씨앗
 *   y5  .   .   .   .   .   .   화염병
 */
const SYNERGY_STRESS_LAYOUT: { defId: string; x: number; y: number; rot?: Rot }[] = [
  { defId: 'w_static_hairball', x: 0, y: 0 }, { defId: 's_coil', x: 1, y: 0 }, { defId: 'w_sock_gatling', x: 2, y: 0 },
  { defId: 's_seed', x: 3, y: 0 }, { defId: 'w_hairball', x: 4, y: 0 }, { defId: 's_mirror', x: 5, y: 0 }, { defId: 'w_yuzu', x: 6, y: 0 },
  { defId: 's_rubber', x: 0, y: 1 }, { defId: 's_hammer', x: 1, y: 1 }, { defId: 's_ribbon', x: 2, y: 1 }, { defId: 's_wheel', x: 3, y: 1 },
  { defId: 's_mushroom', x: 4, y: 1 }, { defId: 's_match', x: 5, y: 1 }, { defId: 's_mirror', x: 6, y: 1 },
  { defId: 'w_flame_toaster', x: 0, y: 2 }, { defId: 'w_melon_bingsu', x: 2, y: 2 }, { defId: 'w_mama_duck', x: 4, y: 2 },
  { defId: 'w_tuna_missile', x: 5, y: 2 }, { defId: 'g_kettle', x: 5, y: 3 }, { defId: 'g_firecracker', x: 6, y: 3 },
  { defId: 'g_trampoline', x: 0, y: 4 }, { defId: 'g_backcoin', x: 2, y: 4 }, { defId: 's_seed', x: 6, y: 4 },
  { defId: 'w_yuzu_molotov', x: 6, y: 5 },
];

function stressSim(stageIndex: number | 'boss', seed: number, characterId = 'cat'): CombatSim {
  const run = newRun(GAME_DATA, characterId, seed);
  run.bag = createBag(7, 6);
  for (const it of SYNERGY_STRESS_LAYOUT) put(run.bag, it.defId, it.x, it.y, 1, it.rot ?? 0);
  run.stageIndex = stageIndex === 'boss' ? 0 : stageIndex;
  const ps = runPlayerStats(GAME_DATA, run);
  const stage = stageIndex === 'boss' ? GAME_DATA.bossTest.stage : GAME_DATA.stages[stageIndex];
  return new CombatSim({
    stage, stageIndex: run.stageIndex, enemies: GAME_DATA.enemies, bosses: GAME_DATA.bosses, loadout: runLoadout(GAME_DATA, run),
    player: { ...ps, maxHp: 1e6 }, hp: 1e6, seed: combatSeed(run),
  });
}

/** 수동 조준 흉내: 좌우로 걸으며 조준을 천천히 흔든다 (sim-alloc 테스트와 같은 입력) */
const sweep = (i: number): CombatInput => ({ targetX: 336 + 250 * Math.sin(i / 29), targetY: 840, aimAngle: -Math.PI / 2 + 1.1 * Math.sin(i / 41) });

function fnv(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

describe('모든 시너지 아이템을 한꺼번에 (스트레스)', () => {
  it('모든 무기에 시너지가 실리고, st2~st5·보스 테스트에서 NaN 없이 새 규칙이 다 일어난다', () => {
    const bag = createBag(7, 6);
    for (const it of SYNERGY_STRESS_LAYOUT) put(bag, it.defId, it.x, it.y, 1, it.rot ?? 0);
    const loadout = computeLoadout(bag, ITEMS, computePlayerStats(CAT, bag, ITEMS));
    expect(loadout.filter((l) => l.split?.seed)).toHaveLength(3); // 개틀링·털뭉치·화염병
    const seen: Record<string, number> = { steam: 0, firecracker: 0, burnSpread: 0, floor: 0, back: 0, chain: 0, split: 0 };
    for (const stage of [1, 2, 3, 4, 'boss'] as const) {
      const sim = stressSim(stage, 11);
      for (let i = 0; i < 60 / SIM_DT && sim.status === 'running'; i++) {
        sim.step(SIM_DT, sweep(i));
        for (const ev of sim.drainEvents()) {
          if (ev.type === 'explode' && ev.cause) seen[ev.cause]++;
          else if (ev.type === 'burnSpread') seen.burnSpread++;
          else if (ev.type === 'bounce' && ev.floor) seen.floor++;
          else if (ev.type === 'hit' && ev.back) seen.back++;
          else if (ev.type === 'chain') seen.chain++;
          else if (ev.type === 'split') seen.split++;
        }
        if (i % 30 === 0) {
          for (const p of sim.projectiles) {
            expect(Number.isFinite(p.x + p.y + p.vx + p.vy + p.damage + p.radius), `${stage} projectile ${p.sprite}`).toBe(true);
          }
          for (const e of sim.enemies) expect(Number.isFinite(e.hp) && Number.isFinite(e.y), `${stage} enemy ${e.defId}`).toBe(true);
          expect(Number.isFinite(sim.player.hp)).toBe(true);
        }
      }
      expect(sim.time, `stage ${stage}`).toBeGreaterThan(10);
    }
    for (const [k, n] of Object.entries(seen)) expect(n, k).toBeGreaterThan(0);
  });

  it('결정성: 같은 시드 + 같은 입력 → 같은 이벤트·상태 (st4, 보스 테스트)', () => {
    for (const stage of [3, 'boss'] as const) {
      const hashes: number[] = [];
      for (let k = 0; k < 2; k++) {
        const sim = stressSim(stage, 23);
        let h = 2166136261;
        for (let i = 0; i < 40 / SIM_DT && sim.status === 'running'; i++) {
          sim.step(SIM_DT, sweep(i));
          h = fnv(h, JSON.stringify(sim.drainEvents()));
        }
        h = fnv(h, JSON.stringify([sim.status, sim.time, sim.player, sim.enemies.map((e) => [e.id, e.hp, e.x, e.y]), sim.projectiles.length]));
        hashes.push(h);
      }
      expect(hashes[0], `stage ${stage}`).toBe(hashes[1]);
    }
  });

  it('투사체 객체는 시너지 경로(씨앗 자식·트램펄린·유도)를 지나도 한 모양 (숨은 클래스 하나)', () => {
    const sim = stressSim(4, 99);
    const shapes = new Set<string>();
    let seedKids = 0;
    for (let i = 0; i < 2400 && sim.status === 'running'; i++) {
      sim.step(SIM_DT, sweep(i));
      sim.drainEvents();
      for (const p of sim.projectiles) {
        shapes.add(Object.keys(p).join(','));
        if ((p as unknown as Ball).maxAge === SEED_CHILD_MAX_AGE) seedKids++;
      }
    }
    expect(seedKids).toBeGreaterThan(0);
    expect([...shapes]).toHaveLength(1);
  });
});
