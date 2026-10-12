// 유효 스탯(플레이어/무기) 계산과 가격. 순수 로직 (PixiJS/DOM 금지).

import {
  CHAIN_TARGETS,
  CHAIN_TARGETS_MAX,
  COOLDOWN_FLOOR_MUL,
  HOMING_MAX_DEG,
  KILL_BURST_MAX,
  PROJ_RADIUS_BONUS_MAX,
  PROJ_SPEED_BONUS_MAX,
  PROJ_SPEED_BONUS_MIN,
  SEED_CHILD_MIN_RADIUS,
  SEED_CHILD_RADIUS_MUL,
  SEED_SPLIT_COUNT,
  SEED_SPLIT_DAMAGE_MAX,
  SELL_RATIO,
  TIER_COOLDOWN_MUL,
  TIER_DAMAGE_MUL,
  TIER_EFFECT_MUL,
  TIER_PRICE_MUL,
} from '../config';
import type {
  BagState,
  BoonDef,
  BoonId,
  BoonStacks,
  CharacterDef,
  Element,
  GearEffect,
  ItemDef,
  PlayerStats,
  SplitSpec,
  StoneEffect,
  Tier,
  WeaponLoadout,
} from '../types';
import { bagItemsInOrder, neighbors } from './bag';

type ItemMap = Record<string, ItemDef>;

/**
 * 런 보너스(레벨업 'boon') 합 — 중첩 수 × 1중첩 효과(BoonDef.effect). computePlayerStats의 4번째 인자.
 * 모든 값은 '없음 = 0' (heal은 고르는 순간 한 번이라 여기 없다)
 */
export interface RunBonus {
  damageMul: number;
  cooldownMul: number;
  moveSpeedMul: number;
  maxHpAdd: number;
  extraShots: number;
  backAttackBonus: number;
}

/** 중첩 수(RunState.boons)를 정의(GameData.boons)로 합친다. 모르는 id·0 이하 중첩은 건너뛴다 */
export function boonBonus(defs: Record<BoonId, BoonDef>, stacks: BoonStacks | undefined): RunBonus {
  const out: RunBonus = { damageMul: 0, cooldownMul: 0, moveSpeedMul: 0, maxHpAdd: 0, extraShots: 0, backAttackBonus: 0 };
  if (!stacks) return out;
  for (const [id, n] of Object.entries(stacks) as [BoonId, number | undefined][]) {
    const def = defs[id];
    if (!def || n === undefined || !(n > 0)) continue;
    const e = def.effect;
    out.damageMul += (e.damageMul ?? 0) * n;
    out.cooldownMul += (e.cooldownMul ?? 0) * n;
    out.moveSpeedMul += (e.moveSpeedMul ?? 0) * n;
    out.maxHpAdd += (e.maxHpAdd ?? 0) * n;
    out.extraShots += (e.extraShots ?? 0) * n;
    out.backAttackBonus += (e.backAttackBonus ?? 0) * n;
  }
  return out;
}

/**
 * 맞닿은 돌들의 합 (scaledStone 뒤). 아래 선택 필드는 시너지 돌(docs/DESIGN.md '시너지 아이템')의 합 —
 * 0이면 키가 없다(없음 = 0). 상한·하한은 computeWeapon이 적용한다
 */
export interface StoneBuffs {
  damageMul: number;
  cooldownMul: number;
  elements: Element[];
  countAdd: number;
  pierceAdd: number;
  sourceUids: number[];
  /** 탄성 고무: 반사당 데미지 + (합) */
  bounceDamage?: number;
  /** 뒤통수 망치: 백어택 직접 피해 + (합) */
  backAttackBonus?: number;
  /** 분열 씨앗: 자식 1개 데미지 배수 (합) */
  seedSplit?: number;
  /** 번개 코일: 연쇄 대상 + (합산 후 내림) */
  chainTargetsAdd?: number;
  /** 번개 코일: 연쇄 피해 + (합) */
  chainDamageAdd?: number;
  /** 번개 코일이 하나라도 있으면 1 (몇 개든 한 번만 더 튄다) */
  chainHops?: number;
  /** 거대화 버섯: 반경 + (합) */
  radiusMul?: number;
  /** 버섯·바퀴: 속도 + (합, 음수 가능) */
  speedMul?: number;
  /** 전염 성냥: 불 옮김 반경(px, 가장 큰 값) */
  burnSpread?: number;
  /** 유도 리본: 회전 속도(도/초, 합) */
  homingDeg?: number;
}

const ELEMENT_ORDER: readonly Element[] = ['fire', 'ice', 'lightning'];
// ★배수(1.6 등) 합산 오차로 2.9999…가 2로 내려가지 않게
const FLOOR_EPS = 1e-9;
const DEG = Math.PI / 180;

/** 숫자 필드만 mul배, 그 외(element·boolean 등)는 그대로. undefined 필드는 생략 */
function scaleNumeric<T extends object>(effect: T, mul: number): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(effect)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'number' ? v * mul : v;
  }
  return out as T;
}

function sortElements(set: Iterable<Element>): Element[] {
  const has = new Set(set);
  return ELEMENT_ORDER.filter((e) => has.has(e));
}

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function scaledStone(effect: StoneEffect, tier: Tier): StoneEffect {
  return scaleNumeric(effect, TIER_EFFECT_MUL[tier]);
}

export function scaledGear(effect: GearEffect, tier: Tier): GearEffect {
  return scaleNumeric(effect, TIER_EFFECT_MUL[tier]);
}

/**
 * ★를 올리면 효과가 커지는 아이템인가: 무기는 늘(데미지·쿨타임), 돌·장비는 ★ 배수가 닿는 숫자 효과가 하나라도 있을 때만.
 * 켜고 끄는 효과뿐인 것(트램펄린 — scaledGear가 boolean은 그대로 둔다)은 ★가 올라도 똑같다 — 레벨업 '★ + 1' 후보에서 뺀다(logic/run.ts)
 */
export function tierRaisesEffect(def: ItemDef): boolean {
  if (def.kind === 'weapon') return def.weapon !== undefined;
  const eff: object | undefined = def.kind === 'stone' ? def.stone : def.gear;
  if (!eff) return false;
  return Object.values(eff).some((v) => typeof v === 'number' && v !== 0);
}

/**
 * bonus = 런 보너스 합(boonBonus — 없으면 예전과 같은 값·모양). 최대 HP는 패시브 배수 뒤에 bonus.maxHpAdd를 그대로 더하고,
 * 이동·데미지·쿨타임 배수는 패시브·장비와 더한다. backAttackBonus·extraShots는 0이 아닐 때만 키를 단다
 */
export function computePlayerStats(
  character: CharacterDef,
  bag: BagState,
  items: ItemMap,
  bonus?: RunBonus,
): PlayerStats {
  let maxHpAdd = 0;
  let moveSpeedMul = 0;
  let regenPerSec = 0;
  let goldMul = 0;
  let damageMul = 0;
  let steamMul = 0;
  let killBurst = 0;
  let trampoline = false;
  let backKillGold = 0;
  // 가방 안 장비만 (보관함 제외)
  for (const it of bagItemsInOrder(bag)) {
    const def = items[it.defId];
    if (!def || def.kind !== 'gear' || !def.gear) continue;
    const g = scaledGear(def.gear, it.tier);
    maxHpAdd += g.maxHpAdd ?? 0;
    moveSpeedMul += g.moveSpeedMul ?? 0;
    regenPerSec += g.regenPerSec ?? 0;
    goldMul += g.goldMul ?? 0;
    damageMul += g.damageMul ?? 0;
    steamMul += g.steamMul ?? 0;
    killBurst += g.killBurst ?? 0;
    if (g.trampoline === true) trampoline = true;
    backKillGold += g.backKillGold ?? 0;
  }
  const p = character.passive;
  const b = bonus;
  const stats: PlayerStats = {
    maxHp: Math.round((character.baseMaxHp + maxHpAdd) * (1 + (p.maxHpMul ?? 0))) + (b ? Math.round(b.maxHpAdd) : 0),
    moveSpeed: character.baseMoveSpeed * (1 + (p.moveSpeedMul ?? 0) + moveSpeedMul + (b ? b.moveSpeedMul : 0)),
    regenPerSec,
    goldMul: 1 + (p.goldMul ?? 0) + goldMul,
    damageMul: 1 + (p.damageMul ?? 0) + damageMul + (b ? b.damageMul : 0),
    cooldownMul: 1 + (p.cooldownMul ?? 0) + (b ? b.cooldownMul : 0),
  };
  // 시너지 장비: 있을 때만 키를 단다 (없는 빌드의 스탯은 예전과 모양까지 같다)
  if (steamMul > 0) stats.steamMul = steamMul;
  if (killBurst > 0) stats.killBurst = Math.min(KILL_BURST_MAX, killBurst);
  if (trampoline) stats.trampoline = 1;
  if (backKillGold > 0) stats.backKillGold = backKillGold;
  // 런 보너스: 있을 때만
  if (b && b.backAttackBonus > 0) stats.backAttackBonus = b.backAttackBonus;
  if (b && b.extraShots >= 1) stats.extraShots = Math.floor(b.extraShots + FLOOR_EPS);
  return stats;
}

export function stoneBuffsFor(bag: BagState, items: ItemMap, uid: number): StoneBuffs {
  let damageMul = 0;
  let cooldownMul = 0;
  let count = 0;
  let pierce = 0;
  let bounceDamage = 0;
  let backAttackBonus = 0;
  let seedSplit = 0;
  let chainTargets = 0;
  let chainDamage = 0;
  let chainHop = false;
  let radiusMul = 0;
  let speedMul = 0;
  let burnSpread = 0;
  let homingDeg = 0;
  const elements = new Set<Element>();
  const sourceUids: number[] = [];
  for (const nb of neighbors(bag, items, uid)) {
    const def = items[nb.defId];
    if (!def || def.kind !== 'stone' || !def.stone) continue;
    const s = scaledStone(def.stone, nb.tier);
    damageMul += s.damageMul ?? 0;
    cooldownMul += s.cooldownMul ?? 0;
    count += s.projectileCountAdd ?? 0;
    pierce += s.pierceAdd ?? 0;
    if (s.element) elements.add(s.element);
    bounceDamage += s.bounceDamage ?? 0;
    backAttackBonus += s.backAttackBonus ?? 0;
    seedSplit += s.seedSplit ?? 0;
    chainTargets += s.chainTargetsAdd ?? 0;
    chainDamage += s.chainDamageAdd ?? 0;
    if (s.chainHop === true) chainHop = true;
    radiusMul += s.radiusMul ?? 0;
    speedMul += s.speedMul ?? 0;
    burnSpread = Math.max(burnSpread, s.burnSpread ?? 0);
    homingDeg += s.homingDeg ?? 0;
    sourceUids.push(nb.uid);
  }
  const out: StoneBuffs = {
    damageMul,
    cooldownMul,
    elements: sortElements(elements),
    countAdd: Math.floor(count + FLOOR_EPS),
    pierceAdd: Math.floor(pierce + FLOOR_EPS),
    sourceUids,
  };
  // 시너지 돌: 있을 때만 키를 단다
  if (bounceDamage > 0) out.bounceDamage = bounceDamage;
  if (backAttackBonus > 0) out.backAttackBonus = backAttackBonus;
  if (seedSplit > 0) out.seedSplit = seedSplit;
  const chainAdd = Math.floor(chainTargets + FLOOR_EPS);
  if (chainAdd > 0) out.chainTargetsAdd = chainAdd;
  if (chainDamage > 0) out.chainDamageAdd = chainDamage;
  if (chainHop) out.chainHops = 1;
  if (radiusMul > 0) out.radiusMul = radiusMul;
  if (speedMul !== 0) out.speedMul = speedMul;
  if (burnSpread > 0) out.burnSpread = burnSpread;
  if (homingDeg > 0) out.homingDeg = homingDeg;
  return out;
}

/** 0 이하면 undefined (WeaponLoadout 시너지 필드: 키는 늘 쓰고 값만 비운다 — 시너지 없는 무기는 예전과 같은 값) */
function orNone(v: number): number | undefined {
  return v > 0 ? v : undefined;
}

/** 가방 안의 무기만 계산. 보관함에 있거나 무기가 아니면 null */
export function computeWeapon(
  bag: BagState,
  items: ItemMap,
  uid: number,
  player: PlayerStats,
): WeaponLoadout | null {
  const item = bag.items.find((it) => it.uid === uid);
  if (!item) return null;
  const def = items[item.defId];
  const weapon = def?.weapon;
  if (!def || def.kind !== 'weapon' || !weapon) return null;

  const proj = weapon.projectile;
  const buffs = stoneBuffsFor(bag, items, uid);
  const cdMul = Math.max(COOLDOWN_FLOOR_MUL, (1 + buffs.cooldownMul) * player.cooldownMul);
  const elements = weapon.element ? [weapon.element, ...buffs.elements] : buffs.elements;

  // 거대화 버섯·가속 바퀴: 반경·속도 배수 (없으면 정확히 1 — 곱해도 값이 그대로)
  const radiusMul = 1 + clampNum(buffs.radiusMul ?? 0, 0, PROJ_RADIUS_BONUS_MAX);
  const speedMul = 1 + clampNum(buffs.speedMul ?? 0, PROJ_SPEED_BONUS_MIN, PROJ_SPEED_BONUS_MAX);
  const radius = proj.radius * radiusMul;
  let split: SplitSpec | null = null;
  if (proj.split) {
    split = { ...proj.split };
    if (radiusMul !== 1) split.radius = proj.split.radius * radiusMul;
  } else if (buffs.seedSplit !== undefined && buffs.seedSplit > 0) {
    // 분열 씨앗: 원래 분열이 없는 무기만 — 자기 공을 작게 한 자식 SEED_SPLIT_COUNT개
    split = {
      count: SEED_SPLIT_COUNT,
      damageMul: Math.min(SEED_SPLIT_DAMAGE_MAX, buffs.seedSplit),
      sprite: proj.sprite,
      radius: Math.max(SEED_CHILD_MIN_RADIUS, radius * SEED_CHILD_RADIUS_MUL),
      seed: true,
    };
  }
  const chainAdd = Math.min(buffs.chainTargetsAdd ?? 0, CHAIN_TARGETS_MAX - CHAIN_TARGETS);
  const homingDeg = Math.min(HOMING_MAX_DEG, buffs.homingDeg ?? 0);

  return {
    uid: item.uid,
    defId: item.defId,
    tier: item.tier,
    cooldown: weapon.cooldown * TIER_COOLDOWN_MUL[item.tier] * cdMul,
    damage: proj.damage * TIER_DAMAGE_MUL[item.tier] * (1 + buffs.damageMul) * player.damageMul,
    count: proj.count + buffs.countAdd,
    spreadDeg: proj.spreadDeg,
    speed: proj.speed * speedMul,
    radius,
    pierce: proj.pierce + buffs.pierceAdd,
    maxBounces: proj.maxBounces,
    elements: sortElements(elements),
    explodeRadius: proj.explodeRadius ?? 0,
    split,
    sprite: proj.sprite,
    spin: proj.spin ?? false,
    bounceDamage: orNone(buffs.bounceDamage ?? 0),
    backAttackBonus: orNone((buffs.backAttackBonus ?? 0) + (player.backAttackBonus ?? 0)),
    chainTargetsAdd: orNone(chainAdd),
    chainDamageAdd: orNone(buffs.chainDamageAdd ?? 0),
    chainHops: orNone(buffs.chainHops ?? 0),
    burnSpread: orNone(buffs.burnSpread ?? 0),
    homing: orNone(homingDeg * DEG),
  };
}

/**
 * bagItemsInOrder 순서의 무기들. 런 보너스 '한 발 더'(player.extraShots)는 쿨타임이 가장 짧은 무기(동률이면 읽기 순서로 앞)의
 * count에 더한다 — 가방이 바뀌면 그때 가장 빠른 무기로 옮겨 간다 (computeWeapon 하나만으로는 모른다: fastestWeaponUid)
 */
export function computeLoadout(bag: BagState, items: ItemMap, player: PlayerStats): WeaponLoadout[] {
  const out: WeaponLoadout[] = [];
  for (const it of bagItemsInOrder(bag)) {
    const w = computeWeapon(bag, items, it.uid, player);
    if (w) out.push(w);
  }
  const extra = player.extraShots ?? 0;
  if (extra > 0) {
    const uid = fastestWeaponUid(out);
    const w = out.find((l) => l.uid === uid);
    if (w) w.count += extra;
  }
  return out;
}

/** 쿨타임이 가장 짧은 무기 uid (동률이면 배열에서 앞 — 가방 읽기 순서). 무기가 없으면 null */
export function fastestWeaponUid(loadout: readonly WeaponLoadout[]): number | null {
  let best: WeaponLoadout | null = null;
  for (const l of loadout) if (best === null || l.cooldown < best.cooldown - 1e-9) best = l;
  return best ? best.uid : null;
}

export function itemPrice(def: ItemDef, tier: Tier): number {
  return def.price * TIER_PRICE_MUL[tier];
}

export function sellPrice(def: ItemDef, tier: Tier): number {
  return Math.max(1, Math.floor(itemPrice(def, tier) * SELL_RATIO));
}
