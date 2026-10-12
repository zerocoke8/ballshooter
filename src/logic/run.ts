// 런 상태·보상·스테이지 진행·세이브. 순수 로직 (PixiJS 금지, DOM은 localStorage 세이브만).

import {
  BAG_MAX_COLS,
  BAG_MAX_ROWS,
  LEVEL_UP_CHOICES,
  LEVEL_UP_KIND_MAX,
  LEVEL_UP_KIND_WEIGHTS,
  LEVEL_UP_UPGRADE_OTHER_WEIGHT,
  LEVEL_UP_UPGRADE_WEAPON_WEIGHT,
  LEVEL_XP_BASE,
  LEVEL_XP_STEP,
  MAX_TIER,
  SAVE_KEY,
  SAVE_VERSION,
  SHOP_REROLL_BASE,
  SHOP_SLOTS,
  STAGE_CLEAR_HEAL_RATIO,
} from '../config';
import type {
  BagItem,
  BagState,
  BoonDef,
  BoonId,
  BoonStacks,
  CharacterDef,
  EnemyDef,
  GameData,
  ItemDef,
  KillReward,
  LevelUpChoice,
  LevelUpResult,
  PlayerStats,
  Rot,
  RunState,
  SkillDef,
  StageDef,
  Tier,
  WeaponLoadout,
} from '../types';
import { addNewToBag, addToStash, areAdjacent, bagItemsInOrder, canPlace, createBag } from './bag';
import { Rng } from './rng';
import { rollItemDef, rollShop } from './shop';
import { boonBonus, computeLoadout, computePlayerStats, sellPrice, tierRaisesEffect } from './stats';

/** 32비트 정수 섞기 (splitmix 계열 finalizer) */
function mix32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d);
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

// goldMul 합산 오차(30 × 2.05 = 61.4999…)로 .5 경계가 내림되지 않게
const ROUND_EPS = 1e-9;

function roundGold(x: number): number {
  return Math.round(x + ROUND_EPS);
}

// ── 생성 / 조회 ──────────────────────────────────────────────

export function newRun(data: GameData, characterId: string, seed: number): RunState {
  const character = data.characters[characterId];
  if (!character) throw new Error(`run: unknown character '${characterId}'`);

  const bag = createBag();
  for (const si of character.startItems) {
    const placed = addNewToBag(bag, data.items, si.defId, si.tier ?? 1, si.x, si.y, si.rot);
    if (!placed) throw new Error(`run: cannot place start item '${si.defId}' for '${characterId}'`);
  }

  const run: RunState = {
    version: SAVE_VERSION,
    characterId,
    stageIndex: 0,
    resumeAt: 'combat',
    gold: 0,
    hp: 0,
    bag,
    shop: {
      slots: new Array<null>(SHOP_SLOTS).fill(null),
      rerollCost: SHOP_REROLL_BASE,
      healBought: false,
    },
    rngState: mix32((seed ^ 0x5bd1e995) >>> 0),
    seed: seed >>> 0,
    stats: { kills: 0, goldEarned: 0, stagesCleared: 0 },
  };
  run.hp = runPlayerStats(data, run).maxHp;
  return run;
}

/**
 * 보스 테스트 런: 캐릭터별 프리셋 가방(data.bossTest.presets — 이미 키운 빌드)으로 풀 HP, mode 'bossTest'.
 * 보스전 한 판용 — 저장되지 않는다(saveRun/clearRun 무시, loadRun이 거름). 일반 런 세이브는 절대 건드리지 않는다.
 */
export function newBossTestRun(data: GameData, characterId: string, seed: number): RunState {
  const character = data.characters[characterId];
  if (!character) throw new Error(`run: unknown character '${characterId}'`);
  const preset = data.bossTest.presets[characterId];
  if (!preset) throw new Error(`run: no boss test preset for '${characterId}'`);

  const bag = createBag(preset.cols, preset.rows);
  for (const si of preset.items) {
    const placed = addNewToBag(bag, data.items, si.defId, si.tier ?? 1, si.x, si.y, si.rot);
    if (!placed) throw new Error(`run: cannot place boss test preset item '${si.defId}' for '${characterId}'`);
  }

  const run: RunState = {
    version: SAVE_VERSION,
    characterId,
    stageIndex: 0,
    resumeAt: 'combat',
    gold: 0,
    hp: 0,
    bag,
    shop: {
      slots: new Array<null>(SHOP_SLOTS).fill(null),
      rerollCost: SHOP_REROLL_BASE,
      healBought: false,
    },
    rngState: mix32((seed ^ 0x5bd1e995) >>> 0),
    seed: seed >>> 0,
    stats: { kills: 0, goldEarned: 0, stagesCleared: 0 },
    mode: 'bossTest',
  };
  run.hp = runPlayerStats(data, run).maxHp;
  return run;
}

/** 보스 테스트 런인가 (저장·삭제·이어하기 대상이 아니다) */
export function isBossTestRun(run: RunState | null | undefined): boolean {
  return !!run && run.mode === 'bossTest';
}

export function runCharacter(data: GameData, run: RunState): CharacterDef {
  const character = data.characters[run.characterId];
  if (!character) throw new Error(`run: unknown character '${run.characterId}'`);
  return character;
}

/** 캐릭터 + 가방 + 런 보너스(RunState.boons) */
export function runPlayerStats(data: GameData, run: RunState): PlayerStats {
  return computePlayerStats(runCharacter(data, run), run.bag, data.items, boonBonus(data.boons, run.boons));
}

/** 이 런 캐릭터의 액티브 스킬 (CombatSimOptions.skill로 넘긴다). 없으면 null */
export function runSkill(data: GameData, run: RunState): SkillDef | null {
  return data.skills[run.characterId] ?? null;
}

export function runLoadout(data: GameData, run: RunState): WeaponLoadout[] {
  return computeLoadout(run.bag, data.items, runPlayerStats(data, run));
}

/** 진행 중인 스테이지. 런이 끝났으면(범위 밖) 마지막 스테이지. 보스 테스트 런은 늘 보스 테스트 스테이지 */
export function currentStage(data: GameData, run: RunState): StageDef {
  if (run.mode === 'bossTest') return data.bossTest.stage;
  const { stages } = data;
  if (stages.length === 0) throw new Error('run: no stages');
  return stages[Math.max(0, Math.min(run.stageIndex, stages.length - 1))];
}

export function combatSeed(run: RunState): number {
  return mix32((run.seed ^ Math.imul(run.stageIndex + 1, 0x9e3779b9)) >>> 0);
}

/** 일반 런: 마지막 스테이지까지 클리어. 보스 테스트 런: 보스를 한 번 잡음(completeStage) */
export function isRunComplete(data: GameData, run: RunState): boolean {
  if (run.mode === 'bossTest') return run.stats.stagesCleared > 0;
  return run.stageIndex >= data.stages.length;
}

/**
 * 데이터 기준으로 이어서 할 수 있는 런인지. 아이템 id가 바뀐 옛 세이브는 bag/stats가 throw 하므로 거른다:
 * 캐릭터·아이템 id 존재, 가방 아이템이 범위 안 + 겹침 없음, 상점 칸 id 존재, 아직 끝나지 않은 런.
 */
export function isRunValid(data: GameData, run: RunState): boolean {
  if (!data.characters[run.characterId]) return false;
  // 일반 런: stageIndex < 스테이지 수 / 보스 테스트 런: 아직 보스를 안 잡음 (프리셋 가방도 아래 검사를 그대로 통과해야 한다)
  if (isRunComplete(data, run)) return false;
  const { bag } = run;
  for (const it of bag.items) {
    if (!data.items[it.defId]) return false;
  }
  // 모든 id가 확인된 뒤에만 canPlace (모르는 id가 섞이면 throw)
  for (const it of bag.items) {
    if (!canPlace(bag, data.items, it.defId, it.x, it.y, it.rot, it.uid)) return false;
  }
  if (bag.stash.some((s) => !data.items[s.defId])) return false;
  return run.shop.slots.every((s) => s === null || data.items[s.defId] !== undefined);
}

/** 전투 밖에서 maxHp가 줄었을 때(장비 판매·보관함 이동) hp를 맞춘다. 늘어난 경우는 건드리지 않음 */
export function clampRunHp(data: GameData, run: RunState): void {
  const { maxHp } = runPlayerStats(data, run);
  if (run.hp > maxHp) run.hp = maxHp;
}

// ── 보상 ─────────────────────────────────────────────────────

/** 상점과 같은 희귀도 규칙으로 ★1 드롭 아이템 하나. 후보가 없으면 null */
export function rollDropItem(
  data: GameData,
  stageIndex: number,
  rng: Rng,
): { defId: string; tier: Tier } | null {
  const def = rollItemDef(data, stageIndex, rng);
  return def ? { defId: def.id, tier: 1 } : null;
}

/**
 * 처치 보상. 골드: g = (def.gold + 백어택 처치면 뒤통수 동전 PlayerStats.backKillGold) × goldMul (소수 가능)
 * → floor(g) 확정 + 소수 부분 확률로 +1. 0골드 처치도 있다. back = 그 'kill' 이벤트의 back (백어택 직접 적중으로 처치).
 * RNG는 매번 골드 1회 → 드롭 판정 1회(→ 드롭 아이템) 순으로 소비한다 (back과 무관하게 같은 횟수).
 */
export function rewardKill(data: GameData, run: RunState, enemyDefId: string, back = false): KillReward {
  const enemy = data.enemies[enemyDefId];
  if (!enemy) throw new Error(`run: unknown enemy '${enemyDefId}'`);

  const rng = new Rng(run.rngState);
  const stats = runPlayerStats(data, run);
  const bonus = back ? (stats.backKillGold ?? 0) : 0;
  const g = Math.max(0, (enemy.gold + bonus) * stats.goldMul);
  // 부동소수 오차(2.9999…)로 정수 배가 한 칸 내려가지 않게
  const whole = Math.floor(g + ROUND_EPS);
  const gold = whole + (rng.chance(g - whole) ? 1 : 0);
  run.gold += gold;
  run.stats.kills++;
  run.stats.goldEarned += gold;

  let drop: KillReward['drop'] = null;
  if (rng.chance(enemy.dropChance)) {
    const rolled = rollDropItem(data, run.stageIndex, rng);
    if (rolled) {
      const stashed = addToStash(run.bag, rolled.defId, rolled.tier);
      if (stashed) {
        drop = { ...rolled, uid: stashed.uid, converted: false, convertedGold: 0 };
      } else {
        // 보관함이 가득 → 판매가만큼 환전
        const convertedGold = sellPrice(data.items[rolled.defId], rolled.tier);
        run.gold += convertedGold;
        run.stats.goldEarned += convertedGold;
        drop = { ...rolled, uid: null, converted: true, convertedGold };
      }
    }
  }
  run.rngState = rng.state;
  return { gold, drop };
}

export function completeStage(
  data: GameData,
  run: RunState,
  hpAfterCombat: number,
): { clearGold: number; healed: number; finished: boolean } {
  if (isRunComplete(data, run)) return { clearGold: 0, healed: 0, finished: true };

  // 보스 테스트: 한 판으로 끝 — 골드·회복·상점 없이 HP와 클리어 수만 기록
  if (run.mode === 'bossTest') {
    const hpIn = Number.isNaN(hpAfterCombat) ? run.hp : hpAfterCombat;
    run.hp = Math.min(runPlayerStats(data, run).maxHp, Math.max(0, hpIn));
    run.stats.stagesCleared++;
    return { clearGold: 0, healed: 0, finished: true };
  }

  const stage = currentStage(data, run);
  const player = runPlayerStats(data, run);

  const clearGold = roundGold(stage.clearGold * player.goldMul);
  run.gold += clearGold;
  run.stats.goldEarned += clearGold;

  // NaN이 들어오면 전투 전 hp 유지 (NaN이 세이브에 새면 JSON null → 로드 실패로 런 유실)
  const hpIn = Number.isNaN(hpAfterCombat) ? run.hp : hpAfterCombat;
  run.hp = Math.min(player.maxHp, Math.max(0, hpIn));
  const healed = Math.min(player.maxHp - run.hp, Math.round(player.maxHp * STAGE_CLEAR_HEAL_RATIO));
  run.hp += healed;

  run.stats.stagesCleared++;
  run.stageIndex++;

  const finished = isRunComplete(data, run);
  if (!finished) {
    rollShop(data, run, true);
    run.shop.rerollCost = SHOP_REROLL_BASE;
    run.shop.healBought = false;
    run.resumeAt = 'shop';
  }
  return { clearGold, healed, finished };
}

// ── 레벨업 (docs/DESIGN.md '레벨업') ─────────────────────────
// 경험치는 'kill' 이벤트마다 grantKillXp 한 번 (sim은 적마다 'kill'을 정확히 한 번 낸다 — 연쇄 처치도 중복 없음). 레벨이 오르면
// RunState.levelUps가 쌓이고, 화면이 전투를 멈추고 levelUpOffer(선택지 3개)를 보여 준 뒤 applyLevelUpChoice → 전투 중이면
// sim.setLoadout(runLoadout, runPlayerStats)로 반영. 레벨·경험치·보너스는 런에 남는다(스테이지를 넘어 이어짐, 세이브됨).

/** 처치 경험치: EnemyDef.xp, 없으면 보스 0 · 그 밖은 칸 수(w × h) */
export function enemyXp(def: EnemyDef): number {
  if (def.xp !== undefined) return Math.max(0, def.xp);
  return def.boss === true ? 0 : def.w * def.h;
}

/** 레벨 level → level + 1에 필요한 경험치 */
export function xpToNext(level: number): number {
  return LEVEL_XP_BASE + LEVEL_XP_STEP * Math.max(0, Math.floor(level) - 1);
}

export function runLevel(run: RunState): number {
  return run.level ?? 1;
}

/** 지금 레벨에서 모은 경험치 (0 ≤ xp < xpToNext(level)) */
export function runXp(run: RunState): number {
  return run.xp ?? 0;
}

/** 아직 고르지 않은 레벨업 수 */
export function pendingLevelUps(run: RunState): number {
  return run.levelUps ?? 0;
}

/** 런 보너스 중첩 수 (읽기 전용으로 쓸 것 — 없으면 빈 객체) */
export function runBoons(run: RunState): BoonStacks {
  return run.boons ?? {};
}

/** 경험치 amount를 더하고 오른 레벨 수를 돌려준다 (levelUps에 쌓임). 0 이하·유한하지 않으면 아무것도 안 함 */
export function grantXp(run: RunState, amount: number): number {
  if (!(amount > 0) || !Number.isFinite(amount)) return 0;
  let level = runLevel(run);
  let xp = runXp(run) + amount;
  let gained = 0;
  for (let need = xpToNext(level); xp >= need; need = xpToNext(level)) {
    xp -= need;
    level++;
    gained++;
  }
  run.level = level;
  run.xp = xp;
  if (gained > 0) run.levelUps = pendingLevelUps(run) + gained;
  return gained;
}

/** 'kill' 이벤트 하나의 경험치 (보스 테스트 런도 — 졸개로 오른다). 오른 레벨 수 */
export function grantKillXp(data: GameData, run: RunState, enemyDefId: string): number {
  const enemy = data.enemies[enemyDefId];
  if (!enemy) throw new Error(`run: unknown enemy '${enemyDefId}'`);
  return grantXp(run, enemyXp(enemy));
}

/** 레벨업 아이템의 희귀도·등장 규칙에 쓰는 스테이지: 일반 런 = 지금 스테이지, 보스 테스트 = 마지막 스테이지(키운 빌드) */
function levelStageIndex(data: GameData, run: RunState): number {
  const last = Math.max(0, data.stages.length - 1);
  if (run.mode === 'bossTest') return last;
  return Math.max(0, Math.min(run.stageIndex, last));
}

/** 선택지 종류 순서 (LEVEL_UP_KIND_WEIGHTS·표시 순서) */
const CHOICE_KINDS: readonly LevelUpChoice['kind'][] = ['item', 'upgrade', 'boon'];

function boonList(data: GameData): BoonDef[] {
  return Object.values(data.boons);
}

/**
 * ★ + 1 후보: ★ < MAX_TIER이고 ★가 오르면 효과가 실제로 커지는 아이템(tierRaisesEffect — 켜고 끄는 효과뿐인 트램펄린은 ★를 올려도 같아
 * 선택지 하나를 헛되이 차지했다)
 */
function upgradable(data: GameData, it: BagItem): boolean {
  const def = data.items[it.defId];
  return def !== undefined && it.tier < MAX_TIER && tierRaisesEffect(def);
}

/**
 * 새 아이템으로 내밀어도 쓸모가 없는가: 켜고 끄는 효과뿐인 장비(트램펄린 — '여러 개 있어도 한 번', tierRaisesEffect false)가 이미 가방에 있다.
 * 레벨업 아이템 뽑기가 이미 나온 id처럼 다시 굴린다 (상점은 그대로 — 사서 팔 수 있다)
 */
function redundantNewItem(run: RunState, def: ItemDef): boolean {
  return def.kind === 'gear' && !tierRaisesEffect(def) && run.bag.items.some((b) => b.defId === def.id);
}

/** 선택지가 지금도 쓸 수 있는가: 아이템 id가 있음 / 그 uid 아이템이 가방에 같은 id·★로 있고 ★를 올릴 수 있음(upgradable) / 보너스가 최대 중첩 전 */
function choiceValid(data: GameData, run: RunState, c: LevelUpChoice): boolean {
  switch (c.kind) {
    case 'item':
      return data.items[c.defId] !== undefined;
    case 'upgrade': {
      const it = run.bag.items.find((b) => b.uid === c.uid);
      return it !== undefined && it.defId === c.defId && it.tier === c.tier && upgradable(data, it);
    }
    case 'boon': {
      const def = data.boons[c.boon];
      return def !== undefined && (runBoons(run)[c.boon] ?? 0) < def.maxStacks;
    }
  }
}

function sameChoice(a: LevelUpChoice, b: LevelUpChoice): boolean {
  if (a.kind === 'item' && b.kind === 'item') return a.defId === b.defId && a.tier === b.tier;
  if (a.kind === 'upgrade' && b.kind === 'upgrade') return a.uid === b.uid && a.defId === b.defId && a.tier === b.tier;
  if (a.kind === 'boon' && b.kind === 'boon') return a.boon === b.boon;
  return false;
}

/**
 * 선택지 LEVEL_UP_CHOICES개 굴리기 (시드 rng). 자리마다 종류를 LEVEL_UP_KIND_WEIGHTS로 고르고(후보가 없거나 LEVEL_UP_KIND_MAX개 찬 종류는 빠짐)
 * 그 종류의 후보 하나: 새 아이템 = rollItemDef(상점 규칙, 이미 나온 id·이미 가방에 있는 켜고 끄는 장비면 4번까지 다시), ★ + 1 = 가방 안 ★ < 3이고 ★로 효과가 커지는 아이템(무기 가중치 2, 그 밖 1),
 * 런 보너스 = 최대 중첩 전 보너스(BoonDef.weight). 같은 선택지는 두 번 나오지 않는다. 결과는 종류 순서(아이템 → ★ → 보너스)로 정렬
 */
function rollLevelOffer(data: GameData, run: RunState, rng: Rng): LevelUpChoice[] {
  const stageIdx = levelStageIndex(data, run);
  const upgrades: BagItem[] = bagItemsInOrder(run.bag).filter((it) => upgradable(data, it));
  const stacks = runBoons(run);
  const boons = boonList(data).filter((b) => (stacks[b.id] ?? 0) < b.maxStacks && b.weight > 0);
  const itemIds = new Set<string>();
  const used = [0, 0, 0];
  const open = [true, upgrades.length > 0, boons.length > 0];
  const offer: LevelUpChoice[] = [];
  const kindIdx = [0, 1, 2];
  while (offer.length < LEVEL_UP_CHOICES) {
    let weights = kindIdx.map((k) => (open[k] && used[k] < LEVEL_UP_KIND_MAX ? LEVEL_UP_KIND_WEIGHTS[k] : 0));
    // 종류 상한은 다른 종류가 남아 있을 때만 — 하나만 남았으면(★ 대상·보너스가 다 참) 그 종류로 끝까지 채운다
    if (weights.every((w) => w <= 0)) weights = kindIdx.map((k) => (open[k] ? LEVEL_UP_KIND_WEIGHTS[k] : 0));
    const k = rng.weighted(kindIdx, weights);
    if (k === null) break;
    let pick: LevelUpChoice | null = null;
    if (k === 0) {
      for (let t = 0; t < 4 && pick === null; t++) {
        const def = rollItemDef(data, stageIdx, rng);
        if (!def) break;
        if (!itemIds.has(def.id) && !redundantNewItem(run, def)) pick = { kind: 'item', defId: def.id, tier: 1 };
      }
      if (pick !== null) itemIds.add(pick.defId);
    } else if (k === 1) {
      const it = rng.weighted(
        upgrades,
        upgrades.map((u) => (data.items[u.defId].kind === 'weapon' ? LEVEL_UP_UPGRADE_WEAPON_WEIGHT : LEVEL_UP_UPGRADE_OTHER_WEIGHT)),
      );
      if (it) {
        upgrades.splice(upgrades.indexOf(it), 1);
        pick = { kind: 'upgrade', uid: it.uid, defId: it.defId, tier: it.tier };
      }
    } else {
      const b = rng.weighted(
        boons,
        boons.map((d) => d.weight),
      );
      if (b) {
        boons.splice(boons.indexOf(b), 1);
        pick = { kind: 'boon', boon: b.id };
      }
    }
    if (pick === null) {
      open[k] = false;
      continue;
    }
    offer.push(pick);
    used[k]++;
    if (k === 1 && upgrades.length === 0) open[1] = false;
    if (k === 2 && boons.length === 0) open[2] = false;
  }
  // 종류 순서로 (같은 종류 안에서는 뽑힌 순서)
  return CHOICE_KINDS.flatMap((kind) => offer.filter((c) => c.kind === kind));
}

/**
 * 지금 보여 줄 레벨업 선택지. 고르지 않은 레벨업이 없으면 null(남은 선택지도 지움).
 * 이미 굴린 선택지(RunState.levelOffer)가 모두 아직 유효하면 그대로(다시 열어도 같은 선택지), 아니면(가방이 바뀌어 ★ 대상이 사라짐 등)
 * run.rngState로 새로 굴려 저장한다. 굴릴 후보가 하나도 없으면(데이터상 거의 불가능) 그 레벨업은 건너뛴다
 */
export function levelUpOffer(data: GameData, run: RunState): LevelUpChoice[] | null {
  while (pendingLevelUps(run) > 0) {
    const cur = run.levelOffer;
    if (cur && cur.length > 0 && cur.every((c) => choiceValid(data, run, c))) return cur;
    const rng = new Rng(run.rngState);
    const offer = rollLevelOffer(data, run, rng);
    run.rngState = rng.state;
    if (offer.length > 0) {
      run.levelOffer = offer;
      return offer;
    }
    run.levelUps = pendingLevelUps(run) - 1;
    delete run.levelOffer;
  }
  delete run.levelOffer;
  return null;
}

/**
 * 레벨업 아이템을 자동으로 놓을 가방 자리 (회전 0·1, 읽기 순서): 돌은 맞닿는 무기가 가장 많은 자리, 무기는 맞닿는 돌이 가장 많은 자리,
 * 장비는 처음 빈 자리. 동률이면 먼저 찾은 자리. 들어갈 곳이 없으면 null
 */
export function levelUpSpot(items: Record<string, ItemDef>, bag: BagState, defId: string): { x: number; y: number; rot: Rot } | null {
  const def = items[defId];
  if (!def) return null;
  const want = def.kind === 'stone' ? 'weapon' : def.kind === 'weapon' ? 'stone' : null;
  let best: { x: number; y: number; rot: Rot } | null = null;
  let bestScore = -1;
  for (const rot of [0, 1] as const) {
    for (let y = 0; y < bag.rows; y++) {
      for (let x = 0; x < bag.cols; x++) {
        if (!canPlace(bag, items, defId, x, y, rot)) continue;
        let score = 0;
        if (want !== null) {
          const cand: BagItem = { uid: -1, defId, tier: 1, x, y, rot };
          for (const other of bag.items) {
            const od = items[other.defId];
            if (od && od.kind === want && areAdjacent(cand, def, other, od)) score++;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          best = { x, y, rot };
        }
      }
    }
  }
  return best;
}

/**
 * 선택지 하나를 고른다 (choice = levelUpOffer가 준 선택지 또는 그 인덱스). 지금 선택지에 없거나 더 이상 유효하지 않으면 null(상태 그대로).
 * - item: levelUpSpot 자리에 자동 배치 → 없으면 보관함 → 보관함도 가득이면 판매가만큼 골드(드롭 환전과 같음)
 * - upgrade: 그 아이템 ★ + 1
 * - boon: 중첩 + 1. heal이 있으면 run.hp를 (새 최대 HP까지) 회복 — 전투 중이면 화면이 부르는 sim.setLoadout이 최대 HP 증가분만큼 sim HP를 올린다
 * 고르면 levelUps - 1, 선택지는 지운다(남은 레벨업이 있으면 levelUpOffer가 새로 굴린다). 전투 중이면 화면이 sim.setLoadout으로 반영할 것
 */
export function applyLevelUpChoice(data: GameData, run: RunState, choice: LevelUpChoice | number): LevelUpResult | null {
  const offer = run.levelOffer;
  if (!offer || pendingLevelUps(run) <= 0) return null;
  const idx = typeof choice === 'number' ? choice : offer.findIndex((c) => sameChoice(c, choice));
  const c = Number.isInteger(idx) ? offer[idx] : undefined;
  if (!c || !choiceValid(data, run, c)) return null;

  let result: LevelUpResult;
  switch (c.kind) {
    case 'item': {
      const spot = levelUpSpot(data.items, run.bag, c.defId);
      const placed = spot ? addNewToBag(run.bag, data.items, c.defId, c.tier, spot.x, spot.y, spot.rot) : null;
      if (placed) {
        result = { kind: 'item', defId: c.defId, tier: c.tier, where: 'bag', uid: placed.uid, x: placed.x, y: placed.y, rot: placed.rot };
        break;
      }
      const stashed = addToStash(run.bag, c.defId, c.tier);
      if (stashed) {
        result = { kind: 'item', defId: c.defId, tier: c.tier, where: 'stash', uid: stashed.uid };
        break;
      }
      const gold = sellPrice(data.items[c.defId], c.tier);
      run.gold += gold;
      run.stats.goldEarned += gold;
      result = { kind: 'item', defId: c.defId, tier: c.tier, where: 'gold', gold };
      break;
    }
    case 'upgrade': {
      const it = run.bag.items.find((b) => b.uid === c.uid)!;
      it.tier = (it.tier + 1) as Tier;
      result = { kind: 'upgrade', uid: it.uid, defId: it.defId, tier: it.tier };
      break;
    }
    case 'boon': {
      const stacks = (run.boons ??= {});
      const n = (stacks[c.boon] ?? 0) + 1;
      stacks[c.boon] = n;
      const heal = data.boons[c.boon].effect.heal ?? 0;
      let healed = 0;
      if (heal > 0) {
        const maxHp = runPlayerStats(data, run).maxHp;
        healed = Math.max(0, Math.min(heal, maxHp - run.hp));
        run.hp += healed;
      }
      result = { kind: 'boon', boon: c.boon, stacks: n, healed };
      break;
    }
  }
  run.levelUps = pendingLevelUps(run) - 1;
  delete run.levelOffer;
  return result;
}

/** 보너스 id가 데이터에 있는가 (세이브 검사·화면용) */
export function isBoonId(data: GameData, id: string): id is BoonId {
  return Object.prototype.hasOwnProperty.call(data.boons, id);
}

// ── 세이브 ───────────────────────────────────────────────────

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null ? localStorage : null;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isInt(v: unknown, min: number, max = Infinity): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isTier(v: unknown): boolean {
  return v === 1 || v === 2 || v === 3;
}

// defId 존재·겹침은 GameData 없이는 확인할 수 없다. 여기선 로직이 터지거나 NaN이 새는 모양만 거른다.
function isBagShape(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const { cols, rows, items, stash, stashCapacity, nextUid } = v;
  if (!isInt(cols, 1, BAG_MAX_COLS) || !isInt(rows, 1, BAG_MAX_ROWS)) return false;
  if (!isInt(stashCapacity, 0) || !isInt(nextUid, 1)) return false;
  if (!Array.isArray(items) || !Array.isArray(stash)) return false;
  if (items.length > cols * rows || stash.length > stashCapacity) return false;

  const uids = new Set<number>();
  const itemOk = (it: unknown): it is Record<string, unknown> => {
    if (!isRecord(it) || !isInt(it.uid, 1, nextUid - 1) || uids.has(it.uid)) return false;
    uids.add(it.uid);
    return typeof it.defId === 'string' && isTier(it.tier);
  };
  return (
    items.every(
      (it) => itemOk(it) && isInt(it.x, 0, cols - 1) && isInt(it.y, 0, rows - 1) && isInt(it.rot, 0, 3),
    ) && stash.every(itemOk)
  );
}

function isShopShape(v: unknown): boolean {
  if (!isRecord(v) || !Array.isArray(v.slots) || v.slots.length !== SHOP_SLOTS) return false;
  const slotOk = (s: unknown): boolean =>
    s === null ||
    (isRecord(s) &&
      typeof s.defId === 'string' &&
      isTier(s.tier) &&
      isNum(s.price) &&
      s.price >= 0 &&
      typeof s.locked === 'boolean');
  return v.slots.every(slotOk) && isInt(v.rerollCost, 0) && typeof v.healBought === 'boolean';
}

/** 레벨업 선택지 하나의 모양 (id 존재는 levelUpOffer가 다시 확인하고 아니면 새로 굴린다) */
function isChoiceShape(c: unknown): boolean {
  if (!isRecord(c)) return false;
  switch (c.kind) {
    case 'item':
      return typeof c.defId === 'string' && isTier(c.tier);
    case 'upgrade':
      return isInt(c.uid, 1) && typeof c.defId === 'string' && isTier(c.tier);
    case 'boon':
      return typeof c.boon === 'string';
    default:
      return false;
  }
}

/**
 * 레벨업 필드(모두 선택 — 없으면 예전 세이브): level 정수 ≥ 1, xp 유한 ≥ 0, levelUps 정수 ≥ 0,
 * levelOffer 선택지 배열(LEVEL_UP_CHOICES개 이하), boons 문자열 → 정수 ≥ 0
 */
function isLevelShape(v: Record<string, unknown>): boolean {
  if (v.level !== undefined && !isInt(v.level, 1)) return false;
  if (v.xp !== undefined && !(isNum(v.xp) && v.xp >= 0)) return false;
  if (v.levelUps !== undefined && !isInt(v.levelUps, 0)) return false;
  if (v.levelOffer !== undefined && !(Array.isArray(v.levelOffer) && v.levelOffer.length <= LEVEL_UP_CHOICES && v.levelOffer.every(isChoiceShape))) {
    return false;
  }
  if (v.boons !== undefined && !(isRecord(v.boons) && Object.values(v.boons).every((n) => isInt(n, 0)))) return false;
  return true;
}

function isRunShape(v: unknown): v is RunState {
  if (!isRecord(v) || v.version !== SAVE_VERSION) return false;
  const { stats } = v;
  return (
    (v.mode === undefined || v.mode === 'normal' || v.mode === 'bossTest') &&
    isLevelShape(v) &&
    typeof v.characterId === 'string' &&
    isInt(v.stageIndex, 0) &&
    (v.resumeAt === 'combat' || v.resumeAt === 'shop') &&
    isNum(v.gold) &&
    v.gold >= 0 &&
    isNum(v.hp) &&
    v.hp >= 0 &&
    isNum(v.rngState) &&
    isNum(v.seed) &&
    isBagShape(v.bag) &&
    isShopShape(v.shop) &&
    isRecord(stats) &&
    isNum(stats.kills) &&
    isNum(stats.goldEarned) &&
    isNum(stats.stagesCleared)
  );
}

/** 보스 테스트 런은 저장하지 않는다 (일반 런 세이브를 덮어쓰지 않게) — 아무것도 하지 않고 돌아간다 */
export function saveRun(run: RunState): void {
  if (run.mode === 'bossTest') return;
  try {
    storage()?.setItem(SAVE_KEY, JSON.stringify(run));
  } catch {
    // 용량 초과·비공개 모드 등 — 세이브 없이 계속
  }
}

/**
 * data를 넘기면 isRunValid까지 확인한다 (게임에서는 항상 넘길 것).
 * 보스 테스트 런은 이어하기 대상이 아니다 — 어쩌다 저장돼 있어도 null (지우지도 않는다).
 */
export function loadRun(data?: GameData): RunState | null {
  try {
    const raw = storage()?.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRunShape(parsed) || parsed.mode === 'bossTest') return null;
    return data && !isRunValid(data, parsed) ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * 세이브 삭제 (일반 런이 끝났을 때). 지금 런을 넘기면 그 런이 보스 테스트일 때는 아무것도 지우지 않는다 —
 * 보스 테스트를 끝내거나 그만둬도 일반 런 세이브(이어하기)는 남는다. 게임 코드는 항상 지금 런을 넘길 것.
 */
export function clearRun(run?: RunState | null): void {
  if (run && run.mode === 'bossTest') return;
  try {
    storage()?.removeItem(SAVE_KEY);
  } catch {
    // 무시
  }
}
