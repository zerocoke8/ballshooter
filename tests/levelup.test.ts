// 레벨업 3지선다 (docs/DESIGN.md '레벨업', docs/ARCHITECTURE.md 'run.ts' 레벨업): 경험치·레벨 곡선, 선택지 뽑기(결정성·유효성),
// 선택 적용(새 아이템 자동 배치/보관함/골드, ★ + 1, 런 보너스), 보너스 스탯 계산, 세이브(새 필드·옛 세이브).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CELL,
  ENEMY_INSET,
  LEVEL_UP_CHOICES,
  LEVEL_UP_KIND_MAX,
  LEVEL_XP_BASE,
  LEVEL_XP_STEP,
  MAX_TIER,
  SAVE_KEY,
  SIM_DT,
} from '../src/config';
import { ASSET_MAP, GAME_DATA } from '../src/data';
import { BOON_IDS } from '../src/data/boons';
import { addNewToBag, addToStash, areAdjacent, createBag } from '../src/logic/bag';
import { CombatSim } from '../src/logic/combat/sim';
import { Rng } from '../src/logic/rng';
import {
  applyLevelUpChoice,
  combatSeed,
  currentStage,
  enemyXp,
  grantKillXp,
  grantXp,
  isRunValid,
  levelUpOffer,
  levelUpSpot,
  loadRun,
  newBossTestRun,
  newRun,
  pendingLevelUps,
  runBoons,
  runCharacter,
  runLevel,
  runLoadout,
  runPlayerStats,
  runXp,
  saveRun,
  xpToNext,
} from '../src/logic/run';
import { buyHeal, shopCandidates } from '../src/logic/shop';
import { boonBonus, computeLoadout, computePlayerStats, fastestWeaponUid, scaledGear, scaledStone, tierRaisesEffect } from '../src/logic/stats';
import type { BoonId, CombatEvent, LevelUpChoice, ProjectileEntity, RunState, StageDef, Tier } from '../src/types';

const data = GAME_DATA;
const CHARACTER_IDS = ['penguin', 'capybara', 'cat'] as const;

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** 지금까지 얻은 경험치 합 (레벨 1부터) */
function totalXp(run: RunState): number {
  let sum = runXp(run);
  for (let l = 1; l < runLevel(run); l++) sum += xpToNext(l);
  return sum;
}

const choiceKey = (c: LevelUpChoice): string =>
  c.kind === 'item' ? `item:${c.defId}` : c.kind === 'upgrade' ? `upgrade:${c.uid}` : `boon:${c.boon}`;

/** 레벨업 선택지 하나가 지금 런에서 규칙대로인가 */
function expectValidOffer(run: RunState, offer: LevelUpChoice[], stageIndex: number): void {
  expect(offer.length).toBeGreaterThan(0);
  expect(offer.length).toBeLessThanOrEqual(LEVEL_UP_CHOICES);
  expect(new Set(offer.map(choiceKey)).size).toBe(offer.length);
  const pool = new Set(shopCandidates(data, stageIndex).map((d) => d.id));
  const order = ['item', 'upgrade', 'boon'];
  for (let i = 1; i < offer.length; i++) expect(order.indexOf(offer[i].kind)).toBeGreaterThanOrEqual(order.indexOf(offer[i - 1].kind));
  for (const c of offer) {
    if (c.kind === 'item') {
      expect(pool.has(c.defId), c.defId).toBe(true);
      expect(c.tier).toBe(1);
    } else if (c.kind === 'upgrade') {
      const it = run.bag.items.find((b) => b.uid === c.uid);
      expect(it, `uid ${c.uid}`).toBeDefined();
      expect(it!.defId).toBe(c.defId);
      expect(it!.tier).toBe(c.tier);
      expect(c.tier).toBeLessThan(MAX_TIER);
      // ★가 올라도 효과가 같은 아이템(켜고 끄는 효과뿐 — 트램펄린)은 후보가 아니다
      expect(tierRaisesEffect(data.items[c.defId]), c.defId).toBe(true);
    } else {
      const def = data.boons[c.boon];
      expect(def).toBeDefined();
      expect(runBoons(run)[c.boon] ?? 0).toBeLessThan(def.maxStacks);
    }
  }
}

/** 시드로 만든 여러 모양의 런: 캐릭터·스테이지·가방(아이템·★)·보관함·보너스 중첩이 제각각 */
function randomRun(seed: number): { run: RunState; stageIndex: number } {
  const rng = new Rng(seed * 7919 + 13);
  const run = newRun(data, rng.pick(CHARACTER_IDS), seed);
  const stageIndex = rng.int(0, data.stages.length - 1);
  run.stageIndex = stageIndex;
  if (rng.chance(0.5)) {
    run.bag.cols = rng.int(5, 7);
    run.bag.rows = rng.int(4, 6);
  }
  const all = Object.values(data.items);
  for (let k = rng.int(0, 7); k > 0; k--) {
    const def = rng.pick(all);
    const spot = levelUpSpot(data.items, run.bag, def.id);
    const tier = rng.int(1, 3) as Tier;
    if (spot) addNewToBag(run.bag, data.items, def.id, tier, spot.x, spot.y, spot.rot);
    else addToStash(run.bag, def.id, tier);
  }
  if (rng.chance(0.3)) for (const it of run.bag.items) it.tier = MAX_TIER;
  for (const id of BOON_IDS) {
    if (rng.chance(0.4)) (run.boons ??= {})[id] = rng.int(0, data.boons[id].maxStacks);
  }
  run.levelUps = 1;
  return { run, stageIndex };
}

// ─────────────────────────────────────────────────────────────
// 데이터 · 곡선
// ─────────────────────────────────────────────────────────────

describe('경험치 데이터와 레벨 곡선', () => {
  it('적 경험치: 기본값(1칸 1, 곰인형 4, 보스 0)과 데이터 값(치유병 2, 꼬마 젤리 0) — 모두 0 이상 정수', () => {
    for (const def of Object.values(data.enemies)) {
      const xp = enemyXp(def);
      expect(Number.isInteger(xp) && xp >= 0, def.id).toBe(true);
      if (def.boss) expect(xp, def.id).toBe(0);
    }
    expect(enemyXp(data.enemies.soldier)).toBe(1);
    expect(enemyXp(data.enemies.block)).toBe(1);
    expect(enemyXp(data.enemies.teddy)).toBe(4);
    expect(enemyXp(data.enemies.healer)).toBe(2);
    expect(enemyXp(data.enemies.splitling)).toBe(0);
    expect(enemyXp(data.enemies.toybox_king)).toBe(0);
    expect(enemyXp({ ...data.enemies.soldier, xp: -3 })).toBe(0);
  });

  it('레벨 곡선: LEVEL_XP_BASE + LEVEL_XP_STEP × (L - 1)', () => {
    expect(xpToNext(1)).toBe(LEVEL_XP_BASE);
    expect(xpToNext(2)).toBe(LEVEL_XP_BASE + LEVEL_XP_STEP);
    expect(xpToNext(10)).toBe(LEVEL_XP_BASE + 9 * LEVEL_XP_STEP);
    for (let l = 1; l < 50; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
  });

  it('스테이지를 모두 잡으면 판마다 레벨업이 1~4번, 런 전체 8~20번 (곡선이 데이터와 맞는다)', () => {
    const run = newRun(data, 'cat', 1);
    const perStage: number[] = [];
    for (const st of data.stages) {
      let gained = 0;
      for (const row of st.rows) for (const ch of row) if (ch !== '.') gained += grantKillXp(data, run, st.legend[ch]);
      perStage.push(gained);
    }
    for (const g of perStage) expect(g).toBeGreaterThanOrEqual(1);
    for (const g of perStage) expect(g).toBeLessThanOrEqual(4);
    const total = perStage.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(8);
    expect(total).toBeLessThanOrEqual(20);
    expect(pendingLevelUps(run)).toBe(total);
    expect(runLevel(run)).toBe(1 + total);
  });

  it('grantXp: 한 번에 여러 레벨, 남는 경험치, 레벨업이 쌓인다 / 0·음수·NaN은 무시 (필드도 안 생김)', () => {
    const run = newRun(data, 'penguin', 3);
    expect(grantXp(run, 0)).toBe(0);
    expect(grantXp(run, -5)).toBe(0);
    expect(grantXp(run, NaN)).toBe(0);
    expect('level' in run || 'xp' in run || 'levelUps' in run).toBe(false);
    const first = xpToNext(1) - 1;
    expect(grantXp(run, first)).toBe(0);
    expect(runLevel(run)).toBe(1);
    expect(runXp(run)).toBe(first);
    expect(pendingLevelUps(run)).toBe(0);
    // 1 → 2 → 3 → 4 를 한 번에 넘기고 13 남김 (곡선 값은 config — LEVEL_XP_BASE·STEP)
    const toL4 = xpToNext(1) + xpToNext(2) + xpToNext(3);
    expect(13).toBeLessThan(xpToNext(4));
    expect(grantXp(run, toL4 + 13 - first)).toBe(3);
    expect(runLevel(run)).toBe(4);
    expect(runXp(run)).toBe(13);
    expect(pendingLevelUps(run)).toBe(3);
    expect(totalXp(run)).toBe(toL4 + 13);
  });
});

// ─────────────────────────────────────────────────────────────
// 경험치 계산 — 'kill' 이벤트마다 한 번 (연쇄 처치도 중복 없음)
// ─────────────────────────────────────────────────────────────

const STAGE_LEGEND = data.stages[0].legend;

/** 실제 적 데이터로 rows(아래 → 위)를 깔아 줄 0의 위끝이 y0에 오게 세운다 (하강 0) */
function parkedReal(rows: string[], y0 = 600, hpMul = 1): CombatSim {
  const stage: StageDef = {
    id: 'xp',
    name: 'xp',
    descentSpeed: 0,
    hpMul,
    dmgMul: 1,
    clearGold: 0,
    rows,
    legend: STAGE_LEGEND,
    background: 'bg_toyroom',
  };
  const sim = new CombatSim({
    stage,
    stageIndex: 0,
    enemies: data.enemies,
    loadout: [],
    player: { maxHp: 100, moveSpeed: 420, regenPerSec: 0, goldMul: 1, damageMul: 1, cooldownMul: 1 },
    hp: 100,
    seed: 5,
  });
  const dy = y0 - (-CELL + ENEMY_INSET);
  for (const e of sim.enemies) e.y += dy;
  return sim;
}

function shot(sim: CombatSim, x: number, y: number, vy: number, damage: number): void {
  const p: ProjectileEntity = {
    id: 8_000_000 + sim.projectiles.length,
    weaponUid: 0,
    x,
    y,
    vx: 0,
    vy,
    radius: 8,
    damage,
    pierceLeft: 0,
    bouncesLeft: Infinity,
    elements: [],
    explodeRadius: 0,
    split: null,
    sprite: 'proj_test',
    spin: false,
    age: 0,
    alive: true,
  };
  sim.projectiles.push(p);
}

describe("경험치는 'kill' 이벤트마다 정확히 한 번", () => {
  it('폭탄병이 줄줄이 터지는 연쇄 처치: 처치마다 한 번, 경험치 합 = 죽은 적 경험치 합 (꼬마 젤리 0)', () => {
    // 폭탄병 40 × hpMul > 폭탄병 18 × hpMul — 한 마리를 쏘면 화면의 폭탄병·젤리가 연쇄로 다 죽는다
    const rows = ['xxxxxxxx', 'xgxhxgxx', 'xxxxxxxx', 'xhxxxxgx'];
    const sim = parkedReal(rows);
    const initial = sim.enemies.map((e) => e.defId);
    shot(sim, CELL / 2, 900, -800, 1000);
    const run = newRun(data, 'cat', 9);
    const kills: Extract<CombatEvent, { type: 'kill' }>[] = [];
    for (let i = 0; i < 120 && sim.status === 'running'; i++) {
      sim.step(SIM_DT, { targetX: 600, targetY: 930 });
      for (const ev of sim.drainEvents()) {
        if (ev.type !== 'kill') continue;
        kills.push(ev);
        grantKillXp(data, run, ev.defId);
      }
    }
    const ids = kills.map((k) => k.enemyId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(kills.length).toBeGreaterThanOrEqual(initial.length);
    expect(kills.some((k) => k.defId === 'splitling')).toBe(true);
    const expected = kills.reduce((s, k) => s + enemyXp(data.enemies[k.defId]), 0);
    // 처음 깔린 적 경험치 합과 같다 (꼬마 젤리는 0)
    expect(expected).toBe(initial.reduce((s, id) => s + enemyXp(data.enemies[id]), 0));
    expect(totalXp(run)).toBe(expected);
    expect(runLevel(run)).toBeGreaterThan(1);
  });

  it('실제 st2를 끝까지: 처치 이벤트는 적마다 한 번, 경험치 = Σ 처치한 적 경험치, 레벨업이 쌓인다', () => {
    const run = newRun(data, 'capybara', 21);
    run.stageIndex = 1;
    const loadout = runLoadout(data, run).map((l) => ({ ...l, damage: l.damage * 6, cooldown: l.cooldown * 0.5 }));
    const sim = new CombatSim({
      stage: currentStage(data, run),
      stageIndex: 1,
      enemies: data.enemies,
      loadout,
      player: { ...runPlayerStats(data, run), maxHp: 1e6 },
      hp: 1e6,
      seed: combatSeed(run),
    });
    const seen = new Set<number>();
    let xp = 0;
    let gained = 0;
    for (let i = 0; i < 200 * 60 && sim.status === 'running'; i++) {
      sim.step(SIM_DT, { targetX: 336 + 250 * Math.sin(i / 60), targetY: 880 });
      for (const ev of sim.drainEvents()) {
        if (ev.type !== 'kill') continue;
        expect(seen.has(ev.enemyId)).toBe(false);
        seen.add(ev.enemyId);
        xp += enemyXp(data.enemies[ev.defId]);
        gained += grantKillXp(data, run, ev.defId);
      }
    }
    expect(sim.status).toBe('won');
    expect(seen.size).toBe(sim.killedEnemies);
    expect(totalXp(run)).toBe(xp);
    expect(pendingLevelUps(run)).toBe(gained);
    expect(gained).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────
// 선택지 뽑기
// ─────────────────────────────────────────────────────────────

describe('레벨업 선택지 (levelUpOffer)', () => {
  it('600개 런: 선택지는 규칙대로(중복 없음·종류 ≤ 2·★ 대상은 가방 안 ★ < 3·아이템은 그 스테이지 풀·보너스는 최대 전)이고 결정적', () => {
    let kinds = { item: 0, upgrade: 0, boon: 0 };
    let threes = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const { run, stageIndex } = randomRun(seed);
      const twin = structuredClone(run);
      const offer = levelUpOffer(data, run)!;
      expect(offer).not.toBeNull();
      expectValidOffer(run, offer, stageIndex);
      if (offer.length === LEVEL_UP_CHOICES) threes++;
      const per = { item: 0, upgrade: 0, boon: 0 };
      for (const c of offer) per[c.kind]++;
      // 다른 종류가 남아 있으면 같은 종류는 LEVEL_UP_KIND_MAX까지
      const distinct = Object.values(per).filter((n) => n > 0).length;
      if (distinct > 1) for (const n of Object.values(per)) expect(n).toBeLessThanOrEqual(LEVEL_UP_KIND_MAX);
      kinds = { item: kinds.item + per.item, upgrade: kinds.upgrade + per.upgrade, boon: kinds.boon + per.boon };
      // 같은 상태 → 같은 선택지·같은 RNG 상태
      const again = levelUpOffer(data, twin)!;
      expect(again).toEqual(offer);
      expect(twin.rngState).toBe(run.rngState);
      expect(run.levelOffer).toBe(offer);
    }
    // 아이템은 늘 후보가 있어 거의 모든 선택지가 3개
    expect(threes).toBeGreaterThan(590);
    for (const n of Object.values(kinds)) expect(n).toBeGreaterThan(200);
  });

  it('다시 열면 같은 선택지 (RNG를 더 쓰지 않음) — 고른 뒤에야 새로 굴린다', () => {
    const run = newRun(data, 'cat', 77);
    grantXp(run, xpToNext(1) + xpToNext(2)); // 2번 레벨업
    const a = levelUpOffer(data, run)!;
    const state = run.rngState;
    expect(levelUpOffer(data, run)).toBe(a);
    expect(run.rngState).toBe(state);
    expect(applyLevelUpChoice(data, run, 0)).not.toBeNull();
    expect(pendingLevelUps(run)).toBe(1);
    expect(run.levelOffer).toBeUndefined();
    const b = levelUpOffer(data, run)!;
    expect(b).not.toBe(a);
    expect(applyLevelUpChoice(data, run, b[b.length - 1])).not.toBeNull();
    expect(pendingLevelUps(run)).toBe(0);
    expect(levelUpOffer(data, run)).toBeNull();
  });

  it('★ 대상이 가방에서 사라지면(판매·보관함) 그 선택지는 버리고 새로 굴린다', () => {
    let checked = 0;
    for (let seed = 1; seed <= 200 && checked < 20; seed++) {
      const { run, stageIndex } = randomRun(seed);
      const offer = levelUpOffer(data, run)!;
      const up = offer.find((c) => c.kind === 'upgrade');
      if (!up || up.kind !== 'upgrade') continue;
      run.bag.items = run.bag.items.filter((b) => b.uid !== up.uid);
      expect(applyLevelUpChoice(data, run, up)).toBeNull();
      const next = levelUpOffer(data, run)!;
      expect(next).not.toBe(offer);
      expectValidOffer(run, next, stageIndex);
      checked++;
    }
    expect(checked).toBe(20);
  });

  it('후보가 모자라면: ★ 대상·보너스가 다 찼어도 아이템으로 3개 (종류 상한은 다른 종류가 있을 때만)', () => {
    const run = newRun(data, 'penguin', 4);
    for (const it of run.bag.items) it.tier = MAX_TIER;
    run.boons = Object.fromEntries(BOON_IDS.map((id) => [id, data.boons[id].maxStacks]));
    run.levelUps = 1;
    const offer = levelUpOffer(data, run)!;
    expect(offer.length).toBe(LEVEL_UP_CHOICES);
    expect(offer.every((c) => c.kind === 'item')).toBe(true);
    expectValidOffer(run, offer, 0);
  });

  it('아이템 풀: 일반 런은 그 스테이지의 상점 풀(minStage), 보스 테스트는 마지막 스테이지 풀 (키운 빌드)', () => {
    const st1 = new Set(shopCandidates(data, 0).map((d) => d.id));
    let late = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const run = newRun(data, 'cat', seed);
      run.levelUps = 1;
      for (const c of levelUpOffer(data, run)!) if (c.kind === 'item') expect(st1.has(c.defId), c.defId).toBe(true);
      const boss = newBossTestRun(data, 'cat', seed);
      boss.levelUps = 1;
      const offer = levelUpOffer(data, boss)!;
      expectValidOffer(boss, offer, data.stages.length - 1);
      for (const c of offer) if (c.kind === 'item' && data.items[c.defId].minStage > 0) late++;
    }
    expect(late).toBeGreaterThan(20);
  });

  it('★ + 1 후보: ★가 올라도 효과가 같은 아이템(트램펄린 — 켜고 끄는 효과뿐)은 빠진다. 저장된 선택지가 그런 것이면 새로 굴린다', () => {
    // tierRaisesEffect = ★ 배수가 닿는 숫자 효과가 있다 ⇔ 실제로 ★1·★2·★3 효과가 다르다 (모든 돌·장비)
    for (const def of Object.values(data.items)) {
      if (def.kind === 'weapon') {
        expect(tierRaisesEffect(def), def.id).toBe(true);
        continue;
      }
      const eff = (t: Tier): string => JSON.stringify(def.kind === 'stone' ? scaledStone(def.stone!, t) : scaledGear(def.gear!, t));
      expect(tierRaisesEffect(def), def.id).toBe(eff(1) !== eff(2) && eff(2) !== eff(3));
    }
    expect(tierRaisesEffect(data.items.g_trampoline)).toBe(false);
    // 트램펄린만 ★ 대상 후보인 가방: ★ + 1이 나오지 않는다
    for (let seed = 1; seed <= 60; seed++) {
      const run = newRun(data, 'cat', seed);
      run.bag = createBag(5, 4);
      expect(addNewToBag(run.bag, data.items, 'g_trampoline', 1, 0, 0, 0)).not.toBeNull();
      run.levelUps = 1;
      expect(levelUpOffer(data, run)!.some((c) => c.kind === 'upgrade')).toBe(false);
    }
    // 예전 세이브에 남은 '트램펄린 ★ + 1' 선택지 → 고를 수 없고(null, 상태 그대로) 다시 열면 새로 굴린다
    const run = newRun(data, 'cat', 3);
    const tramp = addNewToBag(run.bag, data.items, 'g_trampoline', 1, 3, 3, 0)!;
    expect(tramp).not.toBeNull();
    const stale: LevelUpChoice = { kind: 'upgrade', uid: tramp.uid, defId: 'g_trampoline', tier: 1 };
    run.levelUps = 1;
    run.levelOffer = [stale, { kind: 'boon', boon: 'power' }];
    expect(applyLevelUpChoice(data, run, 0)).toBeNull();
    expect(tramp.tier).toBe(1);
    const fresh = levelUpOffer(data, run)!;
    expect(fresh.some((c) => c.kind === 'upgrade' && c.uid === tramp.uid)).toBe(false);
  });

  it('새 아이템: 트램펄린이 이미 가방에 있으면 하나 더는 내밀지 않는다(여러 개 있어도 한 번) — 없으면 나온다', () => {
    // 트램펄린이 나오는 마지막 스테이지 풀, 시드 여럿
    let without = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const has = newRun(data, 'cat', seed);
      has.stageIndex = data.stages.length - 1;
      expect(addNewToBag(has.bag, data.items, 'g_trampoline', 1, 3, 3, 0)).not.toBeNull();
      has.levelUps = 1;
      for (const c of levelUpOffer(data, has)!) expect(c.kind === 'item' && c.defId === 'g_trampoline', `seed ${seed}`).toBe(false);
      const none = newRun(data, 'cat', seed);
      none.stageIndex = data.stages.length - 1;
      none.levelUps = 1;
      if (levelUpOffer(data, none)!.some((c) => c.kind === 'item' && c.defId === 'g_trampoline')) without++;
    }
    expect(without).toBeGreaterThan(0);
  });

  it('고르지 않은 레벨업이 없으면 null (남은 선택지도 지움)', () => {
    const run = newRun(data, 'cat', 5);
    expect(levelUpOffer(data, run)).toBeNull();
    run.levelOffer = [{ kind: 'boon', boon: 'power' }];
    expect(levelUpOffer(data, run)).toBeNull();
    expect(run.levelOffer).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// 선택 적용
// ─────────────────────────────────────────────────────────────

/** 선택지를 직접 넣고(굴리지 않고) 레벨업 1번 대기 */
function withOffer(run: RunState, offer: LevelUpChoice[]): RunState {
  run.levelUps = (run.levelUps ?? 0) + 1;
  run.levelOffer = offer;
  return run;
}

describe('applyLevelUpChoice', () => {
  it('새 무기: 들어갈 자리가 있으면 가방에 자동 배치(맞닿는 돌이 많은 자리) — 결과가 자리를 알려 준다', () => {
    const run = withOffer(newRun(data, 'cat', 1), [{ kind: 'item', defId: 'w_sock', tier: 1 }]);
    const res = applyLevelUpChoice(data, run, 0)!;
    expect(res.kind).toBe('item');
    if (res.kind !== 'item' || res.where !== 'bag') throw new Error('expected bag');
    const it = run.bag.items.find((b) => b.uid === res.uid)!;
    expect(it).toMatchObject({ defId: 'w_sock', tier: 1, x: res.x, y: res.y, rot: res.rot });
    // 냥냥 시작 공격 강화석 옆
    const stone = run.bag.items.find((b) => b.defId === 's_power')!;
    expect(areAdjacent(it, data.items.w_sock, stone, data.items.s_power)).toBe(true);
    expect(pendingLevelUps(run)).toBe(0);
    expect(run.levelOffer).toBeUndefined();
    expect(runLoadout(data, run).some((l) => l.uid === res.uid)).toBe(true);
  });

  it('새 돌은 맞닿는 무기가 가장 많은 자리로', () => {
    const run = newRun(data, 'penguin', 1);
    run.bag = createBag(5, 4);
    addNewToBag(run.bag, data.items, 'w_yuzu', 1, 0, 0, 0);
    addNewToBag(run.bag, data.items, 'w_sock', 1, 2, 0, 0);
    withOffer(run, [{ kind: 'item', defId: 's_power', tier: 1 }]);
    const res = applyLevelUpChoice(data, run, 0)!;
    if (res.kind !== 'item' || res.where !== 'bag') throw new Error('expected bag');
    // (1, 0)이 유자·양말 둘 다와 맞닿는 유일한 자리
    expect([res.x, res.y]).toEqual([1, 0]);
  });

  it('가방이 꽉 차면 보관함, 보관함도 가득이면 판매가만큼 골드', () => {
    const run = newRun(data, 'capybara', 2);
    run.bag = createBag(1, 1);
    addNewToBag(run.bag, data.items, 'w_yuzu', 1, 0, 0, 0);
    withOffer(run, [{ kind: 'item', defId: 'w_hairball', tier: 1 }]);
    const a = applyLevelUpChoice(data, run, 0)!;
    expect(a).toMatchObject({ kind: 'item', where: 'stash', defId: 'w_hairball' });
    while (addToStash(run.bag, 's_power', 1)) {
      // 가득 찰 때까지
    }
    const gold = run.gold;
    const earned = run.stats.goldEarned;
    withOffer(run, [{ kind: 'item', defId: 'w_watermelon', tier: 1 }]);
    const b = applyLevelUpChoice(data, run, 0)!;
    expect(b.kind === 'item' && b.where === 'gold').toBe(true);
    if (b.kind !== 'item' || b.where !== 'gold') throw new Error();
    expect(b.gold).toBeGreaterThan(0);
    expect(run.gold).toBe(gold + b.gold);
    expect(run.stats.goldEarned).toBe(earned + b.gold);
  });

  it('★ + 1: 그 uid의 ★만 오른다 (무기면 데미지도)', () => {
    const run = newRun(data, 'cat', 3);
    const hb = run.bag.items.find((b) => b.defId === 'w_hairball')!;
    const before = runLoadout(data, run).find((l) => l.uid === hb.uid)!.damage;
    withOffer(run, [{ kind: 'upgrade', uid: hb.uid, defId: hb.defId, tier: hb.tier }]);
    expect(applyLevelUpChoice(data, run, { kind: 'upgrade', uid: hb.uid, defId: hb.defId, tier: 1 })).toEqual({
      kind: 'upgrade',
      uid: hb.uid,
      defId: 'w_hairball',
      tier: 2,
    });
    expect(hb.tier).toBe(2);
    expect(runLoadout(data, run).find((l) => l.uid === hb.uid)!.damage).toBeCloseTo(before * 1.6, 9);
  });

  it('런 보너스: 중첩 + 1, 꿀잠 베개는 최대 HP + 20 그리고 HP 20 회복 (최대 HP까지)', () => {
    const run = newRun(data, 'capybara', 4);
    const max0 = runPlayerStats(data, run).maxHp;
    run.hp = max0 - 5;
    withOffer(run, [{ kind: 'boon', boon: 'vitality' }]);
    expect(applyLevelUpChoice(data, run, 0)).toEqual({ kind: 'boon', boon: 'vitality', stacks: 1, healed: 20 });
    expect(runPlayerStats(data, run).maxHp).toBe(max0 + 20);
    expect(run.hp).toBe(max0 + 15);
    withOffer(run, [{ kind: 'boon', boon: 'power' }]);
    expect(applyLevelUpChoice(data, run, 0)).toEqual({ kind: 'boon', boon: 'power', stacks: 1, healed: 0 });
    withOffer(run, [{ kind: 'boon', boon: 'power' }]);
    expect(applyLevelUpChoice(data, run, 0)).toMatchObject({ stacks: 2 });
    expect(runBoons(run)).toEqual({ vitality: 1, power: 2 });
  });

  it('잘못된 선택은 null이고 상태는 그대로: 없는 인덱스·선택지에 없는 것·대기 레벨업 없음·최대 중첩', () => {
    const run = withOffer(newRun(data, 'penguin', 5), [{ kind: 'boon', boon: 'swift' }]);
    const snap = structuredClone(run);
    expect(applyLevelUpChoice(data, run, 3)).toBeNull();
    expect(applyLevelUpChoice(data, run, -1)).toBeNull();
    expect(applyLevelUpChoice(data, run, 0.5)).toBeNull();
    expect(applyLevelUpChoice(data, run, { kind: 'boon', boon: 'power' })).toBeNull();
    expect(run).toEqual(snap);
    run.boons = { swift: data.boons.swift.maxStacks };
    expect(applyLevelUpChoice(data, run, 0)).toBeNull();
    const none = newRun(data, 'penguin', 5);
    none.levelOffer = [{ kind: 'boon', boon: 'swift' }];
    expect(applyLevelUpChoice(data, none, 0)).toBeNull();
  });

  it('전투 중: 고른 뒤 sim.setLoadout으로 반영 — 꿀잠 베개는 sim HP도 + 20, 새 무기는 바로 쏜다', () => {
    const run = newRun(data, 'penguin', 6);
    const stage = currentStage(data, run);
    const sim = new CombatSim({
      stage,
      stageIndex: 0,
      enemies: data.enemies,
      loadout: runLoadout(data, run),
      player: runPlayerStats(data, run),
      hp: run.hp,
      seed: combatSeed(run),
    });
    for (let i = 0; i < 30; i++) sim.step(SIM_DT, { targetX: 336, targetY: 880 });
    sim.player.hp -= 30;
    const hp = sim.player.hp;
    withOffer(run, [{ kind: 'boon', boon: 'vitality' }, { kind: 'item', defId: 'w_yuzu', tier: 1 }]);
    applyLevelUpChoice(data, run, 0);
    sim.setLoadout(runLoadout(data, run), runPlayerStats(data, run));
    expect(sim.player.maxHp).toBe(runPlayerStats(data, run).maxHp);
    expect(sim.player.hp).toBe(hp + 20);
    withOffer(run, [{ kind: 'item', defId: 'w_yuzu', tier: 1 }]);
    const res = applyLevelUpChoice(data, run, 0)!;
    if (res.kind !== 'item' || res.where !== 'bag') throw new Error('expected bag');
    sim.setLoadout(runLoadout(data, run), runPlayerStats(data, run));
    expect(sim.weapons.some((w) => w.uid === res.uid)).toBe(true);
  });

  it('꿀잠 베개: 전투 중 냄비 뚜껑을 뺐었다면 setLoadout의 최대 HP 증가분 회복은 0 — 화면이 sim.healPlayer로 약속한 20을 채운다', () => {
    const run = newRun(data, 'penguin', 6);
    const lid = addNewToBag(run.bag, data.items, 'g_potlid', 1, 4, 0, 0)!;
    expect(lid).not.toBeNull();
    const sim = new CombatSim({
      stage: currentStage(data, run),
      stageIndex: 0,
      enemies: data.enemies,
      loadout: runLoadout(data, run),
      player: runPlayerStats(data, run),
      hp: runPlayerStats(data, run).maxHp,
      seed: combatSeed(run),
    });
    for (let i = 0; i < 30; i++) sim.step(SIM_DT, { targetX: 336, targetY: 880 });
    // 전투 중 가방에서 냄비 뚜껑을 보관함으로 (최대 HP가 이번 전투 최고치 아래로)
    run.bag.items = run.bag.items.filter((b) => b.uid !== lid.uid);
    sim.setLoadout(runLoadout(data, run), runPlayerStats(data, run));
    sim.player.hp -= 60;
    const hpBefore = sim.player.hp;
    withOffer(run, [{ kind: 'boon', boon: 'vitality' }]);
    applyLevelUpChoice(data, run, 0);
    sim.setLoadout(runLoadout(data, run), runPlayerStats(data, run));
    // 결함 재현: 최대 HP는 늘었지만 '바로 HP 20 회복'이 sim에 오지 않는다 (최고치 규칙)
    expect(sim.player.maxHp).toBe(runPlayerStats(data, run).maxHp);
    const got = sim.player.hp - hpBefore;
    expect(got).toBe(0);
    // 화면(CombatScene.onLevelUpPicked)이 하는 보충: 모자란 만큼 healPlayer
    const heal = data.boons.vitality.effect.heal!;
    expect(sim.healPlayer(heal - got)).toBe(heal);
    expect(sim.player.hp).toBe(hpBefore + heal);
    // healPlayer는 최대 HP를 넘지 않고, 0 이하·패배 뒤에는 아무것도 안 한다
    expect(sim.healPlayer(1e9)).toBe(sim.player.maxHp - hpBefore - heal);
    expect(sim.player.hp).toBe(sim.player.maxHp);
    expect(sim.healPlayer(-5)).toBe(0);
    sim.player.hp = 10;
    sim.debugLose();
    expect(sim.healPlayer(20)).toBe(0);
    expect(sim.player.hp).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────
// 런 보너스 스탯
// ─────────────────────────────────────────────────────────────

describe('런 보너스 → 스탯 (boonBonus · computePlayerStats · computeLoadout)', () => {
  const bonus = (stacks: Partial<Record<BoonId, number>>) => boonBonus(data.boons, stacks);

  it('보너스가 없으면 예전과 값·모양이 같다 (키도 늘지 않음)', () => {
    for (const id of CHARACTER_IDS) {
      const run = newRun(data, id, 1);
      const plain = computePlayerStats(runCharacter(data, run), run.bag, data.items);
      expect(computePlayerStats(runCharacter(data, run), run.bag, data.items, bonus({}))).toEqual(plain);
      expect(runPlayerStats(data, run)).toEqual(plain);
      expect(Object.keys(runPlayerStats(data, run)).sort()).toEqual(Object.keys(plain).sort());
    }
  });

  it('데미지·쿨타임·이동·최대 HP·백어택: 중첩 수 × 1중첩 값 (최대 HP는 패시브 배수 뒤에 정확히 더함)', () => {
    const run = newRun(data, 'capybara', 1);
    const ch = runCharacter(data, run);
    const base = computePlayerStats(ch, run.bag, data.items);
    const s = computePlayerStats(ch, run.bag, data.items, bonus({ power: 3, haste: 2, swift: 1, vitality: 2, backstab: 2 }));
    const B = data.boons;
    expect(s.damageMul).toBeCloseTo(base.damageMul + 3 * B.power.effect.damageMul!, 12);
    expect(s.cooldownMul).toBeCloseTo(base.cooldownMul + 2 * B.haste.effect.cooldownMul!, 12);
    expect(s.moveSpeed).toBeCloseTo(base.moveSpeed + ch.baseMoveSpeed * B.swift.effect.moveSpeedMul!, 9);
    expect(s.maxHp).toBe(base.maxHp + 2 * B.vitality.effect.maxHpAdd!);
    expect(s.backAttackBonus).toBeCloseTo(2 * B.backstab.effect.backAttackBonus!, 12);
    const l0 = computeLoadout(run.bag, data.items, base);
    const l1 = computeLoadout(run.bag, data.items, s);
    for (let i = 0; i < l0.length; i++) {
      expect(l1[i].damage).toBeCloseTo((l0[i].damage / base.damageMul) * s.damageMul, 9);
      expect(l1[i].cooldown).toBeCloseTo((l0[i].cooldown / base.cooldownMul) * s.cooldownMul, 9);
      expect(l1[i].backAttackBonus).toBeCloseTo(2 * data.boons.backstab.effect.backAttackBonus!, 12);
    }
  });

  it('뒤통수 전문가는 무기별 뒤통수 망치와 더해진다', () => {
    const bag = createBag(5, 4);
    addNewToBag(bag, data.items, 'w_yuzu', 1, 0, 0, 0);
    addNewToBag(bag, data.items, 's_hammer', 1, 1, 0, 0);
    const ch = data.characters.cat;
    const l = computeLoadout(bag, data.items, computePlayerStats(ch, bag, data.items, bonus({ backstab: 1 })));
    expect(l[0].backAttackBonus).toBeCloseTo(data.items.s_hammer.stone!.backAttackBonus! + data.boons.backstab.effect.backAttackBonus!, 12);
  });

  it('쿨타임 보너스도 무기 쿨타임 하한(COOLDOWN_FLOOR_MUL) 안에서', () => {
    const bag = createBag(5, 4);
    addNewToBag(bag, data.items, 'w_yuzu', 1, 1, 1, 0);
    for (const [x, y] of [[0, 1], [2, 1], [1, 0], [1, 2]]) addNewToBag(bag, data.items, 's_haste', 3, x, y, 0);
    const s = computePlayerStats(data.characters.cat, bag, data.items, bonus({ haste: 4 }));
    const w = computeLoadout(bag, data.items, s)[0];
    expect(w.cooldown).toBeCloseTo(data.items.w_yuzu.weapon!.cooldown * 0.35, 9);
  });

  it('한 발 더: 쿨타임이 가장 짧은 무기에 발사 수 + 1 — 더 빠른 무기를 넣으면 그 무기로 옮긴다', () => {
    const run = newRun(data, 'cat', 1);
    run.boons = { multishot: 1 };
    const hb = run.bag.items.find((b) => b.defId === 'w_hairball')!;
    let l = runLoadout(data, run);
    expect(l.find((x) => x.uid === hb.uid)!.count).toBe(2);
    const yuzu = addNewToBag(run.bag, data.items, 'w_yuzu', 1, 4, 3, 0)!;
    l = runLoadout(data, run);
    expect(fastestWeaponUid(l)).toBe(yuzu.uid);
    expect(l.find((x) => x.uid === yuzu.uid)!.count).toBe(2);
    expect(l.find((x) => x.uid === hb.uid)!.count).toBe(1);
    run.boons = { multishot: 2 };
    expect(runLoadout(data, run).find((x) => x.uid === yuzu.uid)!.count).toBe(3);
    expect(fastestWeaponUid([])).toBeNull();
  });

  it('모르는 보너스 id·0 이하 중첩은 무시', () => {
    const b = boonBonus(data.boons, { power: 0, haste: -2, ...({ bogus: 3 } as Record<string, number>) });
    expect(b).toEqual({ damageMul: 0, cooldownMul: 0, moveSpeedMul: 0, maxHpAdd: 0, extraShots: 0, backAttackBonus: 0 });
  });

  it('상점 회복도 보너스로 늘어난 최대 HP 기준', () => {
    const run = newRun(data, 'penguin', 8);
    run.boons = { vitality: 3 };
    const max = runPlayerStats(data, run).maxHp;
    run.gold = 100;
    run.hp = max - 10;
    expect(buyHeal(data, run)).toBe(true);
    expect(run.hp).toBe(max);
  });

  it('보너스 데이터: 아이콘·한국어 이름, 설명이 1중첩 수치를 그대로 말한다, 최대 중첩·가중치 > 0', () => {
    expect(Object.keys(data.boons).sort()).toEqual([...BOON_IDS].sort());
    for (const id of BOON_IDS) {
      const d = data.boons[id];
      expect(d.id).toBe(id);
      expect(ASSET_MAP[d.icon], d.icon).toBeDefined();
      expect(/[가-힣]/.test(d.name) && /[가-힣]/.test(d.desc)).toBe(true);
      expect(d.maxStacks).toBeGreaterThanOrEqual(1);
      expect(d.weight).toBeGreaterThan(0);
      const e = d.effect;
      const pctOf = (v: number): string => `${Math.round(Math.abs(v) * 100)}%`;
      const wants: string[] = [];
      if (e.damageMul) wants.push(pctOf(e.damageMul));
      if (e.cooldownMul) wants.push(pctOf(e.cooldownMul));
      if (e.moveSpeedMul) wants.push(pctOf(e.moveSpeedMul));
      if (e.maxHpAdd) wants.push(`${e.maxHpAdd}`);
      if (e.heal) wants.push(`${e.heal}`);
      if (e.extraShots) wants.push(`+${e.extraShots}`);
      if (e.backAttackBonus) wants.push(pctOf(e.backAttackBonus));
      expect(wants.length, id).toBeGreaterThan(0);
      for (const w of wants) expect(d.desc, `${id}: ${w}`).toContain(w);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 세이브
// ─────────────────────────────────────────────────────────────

describe('세이브: 레벨업 필드', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('새 필드(레벨·경험치·대기 레벨업·선택지·보너스)가 저장되고 그대로 열린다', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    const run = newRun(data, 'cat', 31);
    grantXp(run, 70);
    levelUpOffer(data, run);
    run.boons = { power: 2, vitality: 1 };
    run.hp = runPlayerStats(data, run).maxHp;
    saveRun(run);
    const loaded = loadRun(data)!;
    expect(loaded).toEqual(run);
    expect(runLevel(loaded)).toBe(runLevel(run));
    expect(levelUpOffer(data, loaded)).toEqual(run.levelOffer);
    expect(runPlayerStats(data, loaded)).toEqual(runPlayerStats(data, run));
  });

  it('옛 세이브(새 필드 없음)도 열리고 기본값: 레벨 1·경험치 0·대기 0·보너스 없음', () => {
    const mem = new MemoryStorage();
    vi.stubGlobal('localStorage', mem);
    const old = newRun(data, 'penguin', 32) as RunState & Record<string, unknown>;
    for (const k of ['level', 'xp', 'levelUps', 'levelOffer', 'boons']) expect(k in old).toBe(false);
    mem.setItem(SAVE_KEY, JSON.stringify(old));
    const loaded = loadRun(data)!;
    expect(loaded).toEqual(old);
    expect(runLevel(loaded)).toBe(1);
    expect(runXp(loaded)).toBe(0);
    expect(pendingLevelUps(loaded)).toBe(0);
    expect(runBoons(loaded)).toEqual({});
    expect(levelUpOffer(data, loaded)).toBeNull();
    expect(isRunValid(data, loaded)).toBe(true);
  });

  type Mutate = (r: Record<string, unknown>) => void;
  const CORRUPT: [string, Mutate][] = [
    ['level 0', (r) => (r.level = 0)],
    ['level 소수', (r) => (r.level = 2.5)],
    ['level 문자열', (r) => (r.level = '3')],
    ['xp 음수', (r) => (r.xp = -1)],
    ['xp null (NaN이 JSON에 샌 것)', (r) => (r.xp = null)],
    ['levelUps 음수', (r) => (r.levelUps = -1)],
    ['levelUps 소수', (r) => (r.levelUps = 1.5)],
    ['levelOffer 배열 아님', (r) => (r.levelOffer = { kind: 'boon', boon: 'power' })],
    ['levelOffer 4개', (r) => (r.levelOffer = Array.from({ length: 4 }, () => ({ kind: 'boon', boon: 'power' })))],
    ['levelOffer 모르는 종류', (r) => (r.levelOffer = [{ kind: 'gift', defId: 'w_yuzu', tier: 1 }])],
    ['levelOffer 아이템 tier 4', (r) => (r.levelOffer = [{ kind: 'item', defId: 'w_yuzu', tier: 4 }])],
    ['levelOffer ★ uid 0', (r) => (r.levelOffer = [{ kind: 'upgrade', uid: 0, defId: 'w_yuzu', tier: 1 }])],
    ['boons 배열', (r) => (r.boons = [1, 2])],
    ['boons 중첩 음수', (r) => (r.boons = { power: -1 })],
    ['boons 중첩 소수', (r) => (r.boons = { power: 1.5 })],
  ];

  it.each(CORRUPT)('깨진 레벨업 필드는 거부: %s', (_label, mutate) => {
    const mem = new MemoryStorage();
    vi.stubGlobal('localStorage', mem);
    const raw = structuredClone(newRun(data, 'capybara', 33)) as unknown as Record<string, unknown>;
    mutate(raw);
    mem.setItem(SAVE_KEY, JSON.stringify(raw));
    expect(loadRun()).toBeNull();
  });

  it('저장된 선택지가 데이터에 없는 아이템을 가리키면(아이템 id가 바뀐 세이브) 열리되 선택지는 새로 굴린다', () => {
    const mem = new MemoryStorage();
    vi.stubGlobal('localStorage', mem);
    const run = newRun(data, 'cat', 34);
    run.levelUps = 1;
    run.levelOffer = [{ kind: 'item', defId: 'w_gone', tier: 1 }];
    mem.setItem(SAVE_KEY, JSON.stringify(run));
    const loaded = loadRun(data)!;
    expect(loaded).not.toBeNull();
    const offer = levelUpOffer(data, loaded)!;
    expectValidOffer(loaded, offer, 0);
    expect(offer.some((c) => c.kind === 'item' && c.defId === 'w_gone')).toBe(false);
  });
});
