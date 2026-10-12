// 밸런스 프로브: 스테이지마다 그럴듯한 빌드로 CombatSim을 돌려 결과를 표로 찍는다.
// 단언은 "예외·NaN 없음, 끝까지 진행됨"뿐이다. 수치 판단은 사람이 로그를 보고 한다.
// 보기: npx vitest run tests/balance.probe.test.ts --silent=false
//
// 조준: 기본 열은 sim의 자동조준(CombatInput.aimAngle 생략 — 맨 앞 적을 매 발 정확히 노림).
// 'manual' 열은 실제 게임처럼 수동 조준(aimAngle)을 쓰는 사람 흉내: 약 1.5초마다 다시 탭(±1.5° 손 오차),
// 조준 가이드(traceAim)로 맨 앞 웨이브의 틈을 확실히(±1.5°) 통과시킬 수 있으면 틈으로, 아니면 가장 아래 적으로.
//
// 투사체 밀도: 판마다 살아있는 플레이어 투사체(분열 자식 포함)의 평균·최대, 발사 1개당 직접 적중, 맨 앞 웨이브 뒤에서의 적중,
// 수명으로 사라진 비율을 잰다(직접 적중은 sim의 내부 적중 처리를 가로채 센다). 'stress' 빌드는 7×6 가방을 무기 10종 +
// 분신 거울·태엽으로 채운 상한 측정용. 맨 아래 'targets' 줄이 밀도 목표(docs/DESIGN.md '무기 수치와 투사체 밀도')와의 비교.
//
// 승률 스윕(두 번째 테스트): 판 하나는 시드에 크게 흔들리므로 스테이지 × 설정(시작 무기 / 프로브 빌드 / 얼음 비교(-ice·+ice, st4~5) /
// 'strong' 빌드 × 자동·수동 조준 × 회피·가만히)마다 시드 8개 × 캐릭터 3 = 24판의 승률과 분포(가장 깊은 적·잃은 HP·보스전 시간)와
// 보스·피해 진단(보스 냉기 비율, 보스 위 공·개틀링 몫, 보스 DPS, 톱니 적중, 받은 피해 출처)을 찍고,
// HP를 다음 스테이지로 가져가는 '이어서 하는 런'(st1 → st5)의 런 승률도 찍는다. 난이도 목표는 docs/DESIGN.md '난이도 목표'.
// 스윕만: npx vitest run tests/balance.probe.test.ts -t win-rate --silent=false
// 공정성(이상적인 회피 — 피할 수 없는 탄막이 있는가, 최악 3초 피해): PROBE_IDEAL=1 … -t ideal — 아래 '이상적인 회피' 참고
// 반복 조정: PROBE_SEEDS=4, PROBE_SEED_LIST=1,2,3, PROBE_STAGES=2,3, PROBE_COLS=build,strong, PROBE_CHARS=cat,
// PROBE_PATCH='{"enemies":{"boss_robot":{"hp":1200}}}'(데이터 복사본에 덮어쓰기), PROBE_SHOWBUILD=1 — 아래 '승률 스윕' 참고,
// PROBE_DODGE=static(회피 AI의 예전 자리 고르기) / PROBE_DODGE=human(반응 0.25초·0.2초마다만 목표를 다시 정하는 사람 흉내 —
// 이동 속도를 바꿔 비교할 때. PROBE_HUMAN_REACT·PROBE_HUMAN_REPLAN) — 아래 '간단한 AI' 참고
// 이동은 sim이 정한다(목표로 걷기: 가속·최고 속도·도착 감속 — AI는 목표만 준다). 적 몸에 닿으면 즉시 패배(LOST(contact)).
// 보스 테스트(네 번째 테스트, -t "boss test"): 캐릭터별 프리셋 가방으로 보스전 — 승률·시간·잃은 HP·도달 페이즈·보스 DPS·보스 윗면 적중(백어택)·
// 졸개 평균/최대·위험 지역/적 탄 맞은 수 + 이상적인 회피(반응 0 / 0.25초, 앞 2.2초)의 공정성. PROBE_BOSS_IDEAL_SEEDS(기본 4)·
// PROBE_BOSS_IDEAL_HORIZON(기본 2.2). 회피 AI·이상적인 회피는 보스 위험 지역(예고·발동 중)도 피한다(일반 스테이지는 위험 지역이 없어 그대로).
// PROBE_DUMP_NOSAFE=1: 이상적인 회피가 '안 맞는 자리가 없던' 순간의 장면을 판마다 한 번 찍는다.
// 백어택·행동하는 적(첫 테스트의 'back attacks and behaving enemies' 표): 직접 적중 중 백어택 몫, 방패에 막힌 공, 치유 HP, 폭탄 폭발,
// 꼬마 젤리, RC카 옆걸음 (판당). 스테이지 표의 'behaving enemies' = 스테이지에 놓인 행동하는 적 수. PROBE_PATCH는 bosses도 받는다(배열은 통째로).
// 레벨업·액티브 스킬(docs/DESIGN.md '레벨업'·'액티브 스킬'): 프로브 AI는 처치마다 경험치를 받아 레벨업 선택지를 고르고(무기가 가방에 들어가면 무기 >
// 가장 센 무기 ★ + 1 > 데미지 보너스 > …, probeChoice), 게이지가 차면 스킬을 쓴다(빙하기·폭풍 = 보이는 적 PROBE_SKILL_MIN(기본 8)마리 이상이거나 보스,
// 온천 = HP 60% 아래이거나 가까운 적 탄 3발 이상, skillAi). st2부터의 빌드는 앞 스테이지 적을 다 잡은 만큼 레벨업을 미리 고른 채로 시작한다(catchUpLevels).
// 끄기(예전 프로브와 비교): PROBE_LEVELUP=0(레벨업 없음 — 경험치도 안 받음), PROBE_SKILL=0(스킬 안 씀). 이상적인 회피(공정성)는 둘 다 쓰지 않는다
// (레벨업·스킬은 플레이어를 해치는 경로가 없다 — 공정성 판정에는 영향 없음). 표: 첫 테스트의 'level-ups and skills', 스윕·보스 테스트의 'lv · skill' 열.
import { describe, expect, it } from 'vitest';
import {
  BAG_EXPAND_COSTS,
  CELL,
  CHILL_DAMAGE_TAKEN_MUL,
  ENEMY_INSET,
  FIELD_COLS,
  FIELD_H,
  FIELD_W,
  PLAYER_ACCEL_TIME,
  PLAYER_HIT_RADIUS,
  PLAYER_MAX_X,
  PLAYER_MAX_Y,
  PLAYER_MIN_X,
  PROJECTILE_MAX_AGE,
  SIM_DT,
} from '../src/config';
import { GAME_DATA } from '../src/data/index';
import {
  addNewToBag,
  applyMerge,
  areAdjacent,
  canPlace,
  createBag,
  expandBag,
  findMerges,
  itemSockets,
  moveItem,
} from '../src/logic/bag';
import { stepPlayerMotion, type Mover } from '../src/logic/combat/movement';
import { CombatSim, FIRE_OFFSET_Y, traceAim, type AimTrace } from '../src/logic/combat/sim';
import { Rng } from '../src/logic/rng';
import {
  applyLevelUpChoice,
  enemyXp,
  grantKillXp,
  grantXp,
  levelUpOffer,
  levelUpSpot,
  newBossTestRun,
  newRun,
  pendingLevelUps,
  rewardKill,
  runLevel,
  runLoadout,
  runPlayerStats,
  runSkill,
} from '../src/logic/run';
import { itemPrice } from '../src/logic/stats';
import type {
  BagItem,
  BagState,
  CombatInput,
  EnemyEntity,
  EnemyShotEntity,
  LevelUpChoice,
  PlayerStats,
  ProjectileEntity,
  Rot,
  RunState,
  StageDef,
  Tier,
  WeaponLoadout,
} from '../src/types';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

/** 객체 b의 값을 a에 깊게 덮어쓴다 (배열·원시값은 통째로) — PROBE_PATCH용 */
function deepPatch(a: Record<string, unknown>, b: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(b)) {
    const cur = a[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      deepPatch(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else a[k] = v;
  }
}

/**
 * 반복 조정용: PROBE_PATCH='{"stages":{"st5":{"dmgMul":2.5}},"enemies":{"boss_robot":{"hp":2400}}}' 처럼 게임 데이터를
 * 복사본에 덮어써서 돌린다 (stages는 id로, 나머지는 레코드 키로). 소스 데이터는 그대로.
 */
function probeData(): typeof GAME_DATA {
  if (!env.PROBE_PATCH) return GAME_DATA;
  const d = structuredClone(GAME_DATA);
  const patch = JSON.parse(env.PROBE_PATCH) as Record<string, Record<string, Record<string, unknown>>>;
  for (const [id, p] of Object.entries(patch.stages ?? {})) {
    const st = d.stages.find((s) => s.id === id);
    if (!st) throw new Error(`PROBE_PATCH: no stage ${id}`);
    deepPatch(st as unknown as Record<string, unknown>, p);
  }
  // bossTest: 보스 테스트 스테이지·프리셋 — 예 {"bossTest":{"stage":{"dmgMul":2.2}}} (presets의 items 배열은 통째로)
  if (patch.bossTest) deepPatch(d.bossTest as unknown as Record<string, unknown>, patch.bossTest as Record<string, unknown>);
  // bosses: 배열(phases·actions·minions)은 통째로 바뀐다 — 예 {"bosses":{"toybox_king":{"phases":[…]}}}
  for (const key of ['enemies', 'items', 'characters', 'bosses', 'skills', 'boons'] as const) {
    for (const [id, p] of Object.entries(patch[key] ?? {})) {
      const rec = (d[key] as unknown as Record<string, Record<string, unknown> | undefined>)[id];
      if (!rec) throw new Error(`PROBE_PATCH: no ${key}.${id}`);
      deepPatch(rec, p);
    }
  }
  return d;
}

const data = probeData();
const items = data.items;
/** 레벨업(경험치·선택지)·액티브 스킬을 쓰나 — PROBE_LEVELUP=0 / PROBE_SKILL=0이면 끈다 (예전 프로브와 비교용) */
const LEVELUPS = env.PROBE_LEVELUP !== '0';
const SKILLS = env.PROBE_SKILL !== '0';
/** 빙하기·털뭉치 폭풍을 쓰는 보이는 적 수 (보스가 보이면 바로) */
const SKILL_MIN_ENEMIES = Number(env.PROBE_SKILL_MIN ?? 8);
const CHARACTERS_ALL = ['penguin', 'capybara', 'cat'] as const;
/** PROBE_CHARS=capybara,cat 로 캐릭터를 줄일 수 있다 */
const CHARACTERS = env.PROBE_CHARS
  ? CHARACTERS_ALL.filter((c) => env.PROBE_CHARS!.split(',').includes(c))
  : CHARACTERS_ALL;
const SEEDS = [11, 2024];
/** 무한 루프 방지용 상한 (게임 시간 초). 정상이라면 승패가 먼저 난다 */
const MAX_SIM_SECONDS = 300;

// ── 빌드 진행 ────────────────────────────────────────────────

interface Addition {
  defId: string;
  tier?: Tier;
}

/**
 * 스테이지 인덱스 i 전투 전 상점에서 산 것 (누적). 상점마다 '의미 있는 구매 2개' 남짓 + st4·st5 전에 가방 확장.
 * 레시피 재료를 무기 소켓에 붙이는 "아는 사람" 빌드 — 드롭·판매·새로고침·회복 구매는 없다고 본다.
 * 누적 비용이 그 시점까지의 실제 수입을 넘지 않아야 한다 (표의 economy 참고).
 */
const PROGRESSION: { expand?: ('col' | 'row')[]; add: Addition[] }[] = [
  { add: [] },
  { add: [{ defId: 's_fire' }, { defId: 'w_sock' }] },
  { add: [{ defId: 'w_duck' }, { defId: 's_power' }, { defId: 's_haste' }, { defId: 'g_potlid' }] },
  { expand: ['col'], add: [{ defId: 'w_toaster' }, { defId: 's_fire' }] },
  { expand: ['row'], add: [{ defId: 'w_watermelon' }, { defId: 's_ice' }, { defId: 's_power' }] },
];

/**
 * '잘하는 사람' 빌드 (캐릭터별, 누적): 시작 무기를 바로 진화시키는 돌부터 사고(카피 유자★2 + 불 = 화염병★2,
 * 냥냥 털뭉치 + 번개 = 정전기), 값싼 진화(양말 + 태엽 = 개틀링, 유자 + 불 = 화염병)를 우선, 보스를 얼릴 얼음 속성을
 * 챙기고(펭구는 참치), 분신 거울은 가장 센 무기 옆. 프로브 빌드와 같은 예산 안에서 고른다 (표의 economy 참고).
 * 수동 조준(틈 쏘기)과 같이 쓰면 '실력 상한'.
 */
const STRONG: Record<(typeof CHARACTERS_ALL)[number], { expand?: ('col' | 'row')[]; add: Addition[] }[]> = {
  // 재미 기능 뒤(네 번째 조정): 잘하는 사람은 시너지 장비도 산다 — 대형을 쓸어 내는 폭죽 심지(st3)·불 + 얼음의 증기 주전자(st4).
  // 예전 목록은 레벨업이 들어온 뒤 st3·st4에서 프로브 빌드보다 약했다(시드 16개 st3 12/16)
  penguin: [
    { add: [] },
    { add: [{ defId: 'w_sock' }, { defId: 's_haste' }] },
    { add: [{ defId: 'w_yuzu' }, { defId: 's_fire' }, { defId: 'g_potlid' }, { defId: 'g_firecracker' }] },
    { expand: ['col'], add: [{ defId: 'w_toaster' }, { defId: 's_fire' }, { defId: 'g_kettle' }] },
    { expand: ['row'], add: [{ defId: 's_mirror' }, { defId: 's_ice' }, { defId: 's_power' }] },
  ],
  // 카피: st3 상점에서 쓸 돈이 많이 남아(16 / 약 50골드) 고무오리·뒤통수 망치(관통 개틀링의 보스 윗면 백어택)를 더 산다 — 레벨업·보스 체력이
  // 바뀐 뒤 예전 목록은 st5 보스를 방어선 전에 못 잡았다(시드 16개 2승). st4 냄비 대신 폭죽 심지
  capybara: [
    { add: [] },
    { add: [{ defId: 's_fire' }, { defId: 'w_sock' }] },
    { add: [{ defId: 's_haste' }, { defId: 's_ice' }, { defId: 's_hammer' }, { defId: 'w_duck' }] },
    { expand: ['col'], add: [{ defId: 'w_toaster' }, { defId: 's_fire' }, { defId: 'g_firecracker' }] },
    { expand: ['row'], add: [{ defId: 's_mirror' }, { defId: 's_power' }, { defId: 's_hammer' }] },
  ],
  cat: [
    { add: [] },
    { add: [{ defId: 's_lightning' }, { defId: 'w_sock' }] },
    { add: [{ defId: 's_haste' }, { defId: 'w_yuzu' }, { defId: 's_fire' }, { defId: 'g_firecracker' }] },
    { expand: ['col'], add: [{ defId: 'w_toaster' }, { defId: 's_fire' }, { defId: 'g_potlid' }] },
    { expand: ['row'], add: [{ defId: 's_mirror' }, { defId: 's_ice' }] },
  ],
};

function placedItem(uid: number, defId: string, tier: Tier, x: number, y: number, rot: Rot): BagItem {
  return { uid, defId, tier, x, y, rot };
}

/** 이 자리에 놓으면 얼마나 좋은지: 레시피 소켓 > 같은 아이템 ★합성 > 무기·돌 인접 */
function placementScore(bag: BagState, cand: BagItem): number {
  const def = items[cand.defId];
  let score = 0;
  // 레시피 base 무기는 소켓 칸이 가방 안에 비어 있는 자리로 (나중에 재료를 놓을 자리)
  if (data.recipes.some((r) => r.base === cand.defId)) {
    const free = itemSockets(cand, def).some(
      (c) => c.x >= 0 && c.y >= 0 && c.x < bag.cols && c.y < bag.rows && !bag.items.some((it) => hasCell(it, c)),
    );
    if (free) score += 20;
  }
  for (const other of bag.items) {
    const od = items[other.defId];
    const adjacent = areAdjacent(cand, def, other, od);
    // 레시피 재료가 base 소켓에 들어가는가 (양방향). 재료가 아닌 것으로 base 소켓을 막지 않는다 (나중에 살 재료 자리)
    for (const r of data.recipes) {
      if (r.base === other.defId) {
        const onSocket = itemSockets(other, od).some((c) => hasCell(cand, c));
        if (onSocket) score += r.ingredient === cand.defId ? 100 : -60;
      }
      if (r.base === cand.defId && r.ingredient === other.defId) {
        // 다른 무기를 버프하고 있는 돌(냥냥 시작 공격 강화석)은 재료로 먹지 않는다
        const buffing = bag.items.some(
          (w) => items[w.defId].kind === 'weapon' && areAdjacent(other, od, w, items[w.defId]),
        );
        if (!buffing && itemSockets(cand, def).some((c) => hasCell(other, c))) score += 100;
      }
    }
    if (!adjacent) continue;
    if (other.defId === cand.defId && other.tier === cand.tier) score += 50;
    // 버프 돌은 자주 쏘는 무기 옆으로 (발사 수 / 쿨타임 — 개틀링·불꽃 토스터처럼 많이 쏘는 무기가 버프를 많이 쓴다)
    if (def.kind === 'stone' && od.kind === 'weapon') score += 10 + (4 * od.weapon!.projectile.count) / od.weapon!.cooldown;
    if (def.kind === 'weapon' && od.kind === 'stone') score += 10;
    if (def.kind === 'gear' && od.kind !== 'gear') score -= 3; // 장비는 구석으로
  }
  return score;
}

function hasCell(item: BagItem, c: { x: number; y: number }): boolean {
  const def = items[item.defId];
  const odd = item.rot % 2 === 1;
  const w = odd ? def.h : def.w;
  const h = odd ? def.w : def.h;
  return c.x >= item.x && c.x < item.x + w && c.y >= item.y && c.y < item.y + h;
}

function addBest(bag: BagState, defId: string, tier: Tier): boolean {
  let best: { x: number; y: number; rot: Rot; score: number } | null = null;
  for (const rot of [0, 1, 2, 3] as Rot[]) {
    for (let y = 0; y < bag.rows; y++) {
      for (let x = 0; x < bag.cols; x++) {
        if (!canPlace(bag, items, defId, x, y, rot)) continue;
        const score = placementScore(bag, placedItem(-1, defId, tier, x, y, rot));
        if (!best || score > best.score) best = { x, y, rot, score };
      }
    }
  }
  return best !== null && addNewToBag(bag, items, defId, tier, best.x, best.y, best.rot) !== null;
}

/** 가능한 합성을 모두 적용 (레시피 우선 — findMerges 정렬 순서) */
function mergeAll(bag: BagState): string[] {
  const done: string[] = [];
  for (let guard = 0; guard < 20; guard++) {
    const opts = findMerges(bag, data);
    if (opts.length === 0) break;
    const o = opts[0];
    if (!applyMerge(bag, data, o)) break;
    done.push(o.kind === 'recipe' ? o.resultDefId : `${o.resultDefId}★${o.resultTier}`);
  }
  return done;
}

/**
 * 가방에 이미 있는 레시피 재료를 짝 무기의 빈 소켓으로 옮긴다 (예: 펭구 시작 얼음석 → 생선 소켓 = 참치 미사일).
 * 합성 반짝임을 본 플레이어라면 공짜로 하는 일이라 "그럴듯한 빌드"에 포함한다.
 */
function fillSockets(bag: BagState): void {
  for (const r of data.recipes) {
    for (const base of bag.items.filter((it) => it.defId === r.base)) {
      const sockets = itemSockets(base, items[base.defId]).filter(
        (c) => c.x >= 0 && c.y >= 0 && c.x < bag.cols && c.y < bag.rows,
      );
      // 다른 무기 옆에서 버프로 쓰이는 돌(냥냥 시작 공격 강화석 등)은 빼 오지 않는다 — 펭구 얼음석은 생선(base) 옆이라 옮긴다
      const buffsOther = (it: BagItem): boolean =>
        bag.items.some((w) => w !== base && items[w.defId].kind === 'weapon' && areAdjacent(it, items[it.defId], w, items[w.defId]));
      const ing = bag.items.find((it) => it.defId === r.ingredient && !sockets.some((c) => hasCell(it, c)) && !buffsOther(it));
      if (!ing || sockets.some((c) => bag.items.some((it) => it.defId === r.ingredient && hasCell(it, c)))) continue;
      for (const c of sockets) if (moveItem(bag, items, ing.uid, c.x, c.y, 0)) break;
    }
  }
}

type BuildMode = 'probe' | 'noice' | 'ice' | 'strong' | 'starter' | 'raw' | 'greedy';
type ShopMode = 'probe' | 'noice' | 'ice' | 'strong' | 'greedy';

/** 얼음 비교 빌드에서 속성석 하나를 더 사는 상점 (st4 전투 전 — 프로브 빌드가 쓰고 남는 돈 14골드 안, 속성석 10골드) */
const EXTRA_STONE_AT = 3;

/**
 * 얼음 비교 빌드 (st4·st5): 프로브 빌드 + st4 상점에서 속성석 하나 더 — 같은 지출, 속성만 다르다.
 *   ice   = 얼음 속성석 (자주 쏘는 무기 옆에 붙는다 — 얼음을 여러 발에 붙인 빌드). st5에는 수박 빙수도 그대로.
 *   noice = 번개 속성석. st5 수박 빙수 재료도 번개 속성석으로 — 상점에 얼음 속성석이 한 번도 안 나온 판
 *           (st5는 수박 빙수 대신 번개 수박). 펭구는 시작 얼음석(참치 미사일)이 있어 상점 운과 상관없이 얼음이 있다 — 그대로 둔다.
 */
function progressionOf(characterId: string, mode: ShopMode): { expand?: ('col' | 'row')[]; add: Addition[] }[] {
  if (mode === 'strong') return STRONG[characterId as (typeof CHARACTERS_ALL)[number]];
  if (mode === 'probe' || mode === 'greedy') return PROGRESSION;
  return PROGRESSION.map((step, i) => ({
    expand: step.expand,
    add: [
      ...step.add.map((a) => (mode === 'noice' && a.defId === 's_ice' ? { ...a, defId: 's_lightning' } : a)),
      ...(i === EXTRA_STONE_AT ? [{ defId: mode === 'ice' ? 's_ice' : 's_lightning' }] : []),
    ],
  }));
}

/**
 * probe   = 소켓 정리·합성(시작 직후) + 상점마다 PROGRESSION 구매 → 소켓 정리·합성
 * noice / ice = 프로브 빌드의 얼음 없는 / 얼음 더한 판 (progressionOf 참고)
 * strong  = 같은 방식으로 STRONG(캐릭터별 '잘하는 사람') 구매
 * starter = 구매 없이 소켓 정리·합성만 (펭구 참치 미사일, 카피 유자★2) — "상점 없이" 기준선
 * raw     = 시작 아이템 배치 그대로 (가방을 한 번도 안 연 첫 플레이)
 */
type Progression = { expand?: ('col' | 'row')[]; add: Addition[] }[];

/** buildRun 옵션 (분석 테스트용): 런 시드(레벨업 선택지 운), 상점 구매 목록 덮어쓰기, 앞 스테이지 레벨업을 고르는 함수(다음 전투 스테이지 → Chooser) */
interface BuildOpts {
  seed?: number;
  prog?: Progression;
  chooseFor?: (nextStage: number, shop: (r: RunState) => void) => Chooser;
}

/** 상점 한 번(스테이지 i 전투 전)의 구매를 가방에 적용 → 소켓 정리·합성 */
function applyShopStep(run: RunState, step: Progression[number], notes: string[]): void {
  for (const dir of step.expand ?? []) expandBag(run.bag, dir);
  for (const a of step.add) {
    if (!addBest(run.bag, a.defId, a.tier ?? 1)) notes.push(`no room: ${a.defId}`);
  }
  fillSockets(run.bag);
  notes.push(...mergeAll(run.bag));
}

/**
 * 'greedy' 빌드(프로브 상점 + 앞 스테이지 레벨업을 그리디 평가로)와 PROBE_STRONG_GREEDY=1일 때의 'strong'은
 * (그리디 평가는 다음 전투 시드 2판만 보는 근시안이라 st5 보스에 약한 선택을 자주 해서 — 예: 카피 관통 무기 대신 다른 것 — 기본 'strong'은 probeChoice)
 * greedyChooser를 쓴다 — 무거우므로 buildRun 결과를 (캐릭터, 스테이지, 모드, 시드)로 기억해 복사본을 준다
 */
const STRONG_GREEDY = env.PROBE_STRONG_GREEDY === '1';
const GREEDY_BUILD_SEEDS = (env.PROBE_GREEDY_SEEDS ?? '11,2024').split(',').map(Number);
const buildCache = new Map<string, { run: RunState; notes: string[] }>();

function buildRun(characterId: string, stageIndex: number, mode: BuildMode = 'probe', o: BuildOpts = {}): { run: RunState; notes: string[] } {
  const greedy = !o.chooseFor && !o.prog && LEVELUPS && (mode === 'greedy' || (mode === 'strong' && STRONG_GREEDY));
  if (!greedy) return buildRunRaw(characterId, stageIndex, mode, o);
  const key = `${characterId}|${stageIndex}|${mode}|${o.seed ?? 7}`;
  let hit = buildCache.get(key);
  if (!hit) {
    hit = buildRunRaw(characterId, stageIndex, mode, { ...o, chooseFor: (next, shop) => greedyChooser(next, shop, GREEDY_BUILD_SEEDS, []) });
    buildCache.set(key, hit);
  }
  return structuredClone(hit);
}

function buildRunRaw(characterId: string, stageIndex: number, mode: BuildMode, o: BuildOpts): { run: RunState; notes: string[] } {
  const run = newRun(data, characterId, o.seed ?? 7);
  const notes: string[] = [];
  const prog = o.prog ?? (mode === 'starter' || mode === 'raw' ? null : progressionOf(characterId, mode as ShopMode));
  for (let i = 0; mode !== 'raw' && i <= stageIndex; i++) {
    const step = prog ? prog[i] : { add: [] };
    // 앞 스테이지(i - 1)에서 오른 레벨: 그 스테이지 적을 다 잡은 경험치로 레벨업을 미리 고른다 (상점보다 먼저 — 실제 순서)
    if (LEVELUPS && i > 0) notes.push(...catchUpLevels(run, i - 1, o.chooseFor?.(i, (r) => applyShopStep(r, step, []))));
    applyShopStep(run, step, notes);
  }
  run.stageIndex = stageIndex;
  run.hp = runPlayerStats(data, run).maxHp;
  return { run, notes };
}

// ── 레벨업 · 스킬 AI ─────────────────────────────────────────

/** 장착 무기 중 초당 피해(damage × count / cooldown)가 가장 큰 무기 uid */
function bestWeaponUid(run: RunState): number | null {
  let best: WeaponLoadout | null = null;
  for (const l of runLoadout(data, run)) if (!best || (l.damage * l.count) / l.cooldown > (best.damage * best.count) / best.cooldown) best = l;
  return best ? best.uid : null;
}

/**
 * 프로브 AI의 레벨업 선택: 가방에 들어가는 새 무기 > 가장 센 무기 ★ + 1 > 데미지 보너스 > 다른 무기 ★ + 1 > 쿨타임 보너스 >
 * 가방에 들어가는 돌 > 그 밖의 보너스 > ★ + 1 > 맨 앞. (보관함으로 가는 아이템은 프로브가 꺼내 놓지 않으니 버린 셈)
 */
function probeChoice(run: RunState, offer: LevelUpChoice[]): number {
  const fits = (defId: string): boolean => levelUpSpot(items, run.bag, defId) !== null;
  const best = bestWeaponUid(run);
  const kindOf = (c: LevelUpChoice): string | null => (c.kind === 'boon' ? null : items[c.defId].kind);
  const rules: ((c: LevelUpChoice) => boolean)[] = [
    (c) => c.kind === 'item' && kindOf(c) === 'weapon' && fits(c.defId),
    (c) => c.kind === 'upgrade' && c.uid === best,
    (c) => c.kind === 'boon' && c.boon === 'power',
    (c) => c.kind === 'upgrade' && kindOf(c) === 'weapon',
    (c) => c.kind === 'boon' && c.boon === 'haste',
    (c) => c.kind === 'item' && kindOf(c) === 'stone' && fits(c.defId),
    (c) => c.kind === 'boon',
    (c) => c.kind === 'upgrade',
  ];
  for (const rule of rules) {
    const i = offer.findIndex(rule);
    if (i >= 0) return i;
  }
  return 0;
}

/** 레벨업 선택 함수 (선택지 인덱스) — 기본 probeChoice, 그리디 평가(PROBE_GREEDY 분석)는 다른 함수를 넘긴다 */
type Chooser = (run: RunState, offer: LevelUpChoice[]) => number;

/** 대기 중인 레벨업을 전부 choose(기본 probeChoice)로 고른다. 고른 것의 요약(빌드 로그용: +아이템@자리 / 아이템★n / boon id) */
function resolveLevelUps(run: RunState, choose: Chooser = probeChoice): string[] {
  const picked: string[] = [];
  for (let guard = 0; guard < 50; guard++) {
    const offer = levelUpOffer(data, run);
    if (!offer) break;
    const res = applyLevelUpChoice(data, run, choose(run, offer));
    if (!res) throw new Error('probe: level-up choice rejected');
    picked.push(res.kind === 'item' ? `+${res.defId}@${res.where}` : res.kind === 'upgrade' ? `${res.defId}★${res.tier}` : `boon ${res.boon}`);
  }
  return picked;
}

/** 스테이지 s의 적을 다 잡은 만큼 경험치 → 레벨업을 고른다 (st2+ 빌드가 앞 스테이지에서 오른 레벨로 시작하게) */
function catchUpLevels(run: RunState, s: number, choose: Chooser = probeChoice): string[] {
  const st = data.stages[s];
  let xp = 0;
  for (const row of st.rows) for (const ch of row) if (ch !== '.') xp += enemyXp(data.enemies[st.legend[ch]]);
  grantXp(run, xp);
  return resolveLevelUps(run, choose).map((t) => `L${s + 1}:${t}`);
}

// ── 그리디 평가 (레벨업 선택지 분석 — PROBE_GREEDY) ──────────────

interface GreedyPick {
  stage: number;
  offer: LevelUpChoice[];
  scores: number[];
  pick: number;
  probe: number;
  /** 선택 전 가방에 들어가는가 (item 선택지만 — 보관함으로 가면 프로브에게는 버린 셈) */
  fits: boolean[];
}

/** 그리디 평가 점수: 이김 1 + 남은 HP 비율 × 0.5 + (1 - 가장 깊은 적) × 0.5 + 처치 비율 × 0.5 - 전투 시간(초) × 0.002 */
function greedyScore(o: Outcome): number {
  return (o.won ? 1 : 0) + 0.5 * (o.hpLeft / o.maxHp) + 0.5 * (1 - o.deepest) + 0.5 * (o.kills / Math.max(1, o.total)) - 0.002 * o.time;
}

/**
 * 그리디 평가로 고르는 Chooser: 선택지마다 런을 복사해 그 선택을 적용하고(+ 바로 다음 상점 구매 shop) 다음 전투(nextStage)를
 * 수동 조준 회피 AI로 seeds 판 돌려(전투 중 레벨업 없음 — 이 선택만의 값, 선택지끼리 같은 시드 = 공통 난수) 점수 합이 가장 큰 것
 */
function greedyChooser(nextStage: number, shop: (r: RunState) => void, seeds: readonly number[], log: GreedyPick[]): Chooser {
  return (run, offer) => {
    let best = 0;
    let bestScore = -Infinity;
    const scores: number[] = [];
    for (let i = 0; i < offer.length; i++) {
      const r = structuredClone(run);
      if (!applyLevelUpChoice(data, r, i)) throw new Error('greedy: choice rejected');
      r.levelUps = 0;
      delete r.levelOffer;
      shop(r);
      r.stageIndex = nextStage;
      r.hp = runPlayerStats(data, r).maxHp;
      let sc = 0;
      for (const seed of seeds) {
        const o = simulate(r, nextStage, seed, manualAi(seed, guideRadius(runLoadout(data, r))), data.stages[nextStage], { levelups: false });
        sc += greedyScore(o);
      }
      scores.push(sc / seeds.length);
      if (sc > bestScore + 1e-9) {
        bestScore = sc;
        best = i;
      }
    }
    log.push({
      stage: nextStage,
      offer: offer.map((c) => ({ ...c })),
      scores,
      pick: best,
      probe: probeChoice(run, offer),
      fits: offer.map((c) => c.kind === 'item' && levelUpSpot(items, run.bag, c.defId) !== null),
    });
    return best;
  };
}

/**
 * 프로브 AI의 스킬 발동 판단 (게이지가 찼을 때): 빙하기·폭풍 = 보이는 적 SKILL_MIN_ENEMIES 이상 또는 보스가 보임,
 * 온천 = HP 60% 아래 또는 가까운(250 px) 적 탄 3발 이상
 */
function skillAi(sim: CombatSim): boolean {
  const s = sim.skill;
  if (!s || !s.ready) return false;
  const pl = sim.player;
  if (s.kind === 'spring') {
    if (pl.hp < 0.6 * pl.maxHp) return true;
    let near = 0;
    for (const sh of sim.enemyShots) if (Math.hypot(sh.x - pl.x, sh.y - pl.y) < 250) near++;
    return near >= 3;
  }
  let n = 0;
  for (const e of sim.enemies) {
    if (!e.alive || e.y + e.h <= 0) continue;
    if (e.boss) return true;
    n++;
  }
  return n >= SKILL_MIN_ENEMIES;
}

/**
 * 투사체 밀도 스트레스 빌드: 최대 가방(7×6)에 무기 10종(진화 7종 포함) — 빠른 무기 옆에 태엽·분신 거울.
 * 상점 경제는 무시한 "끝까지 키운 가방"의 상한 측정용. 위 → 아래:
 *   y0  개틀링  태엽  화염병  거울  정전기  태엽  유자
 *   y1  거울    공격  털뭉치  .     .       .     .
 *   y2  불꽃토스터(2×2) 빙수(2×2)  엄마오리  메탄(2×1)
 *   y3  〃               〃         〃        참치(2×1)
 *   y4  반창고  냄비뚜껑
 *   y5  .       〃
 */
const STRESS_LAYOUT: { defId: string; x: number; y: number; rot?: Rot }[] = [
  { defId: 'w_sock_gatling', x: 0, y: 0 },
  { defId: 's_haste', x: 1, y: 0 },
  { defId: 'w_yuzu_molotov', x: 2, y: 0 },
  { defId: 's_mirror', x: 3, y: 0 },
  { defId: 'w_static_hairball', x: 4, y: 0 },
  { defId: 's_haste', x: 5, y: 0 },
  { defId: 'w_yuzu', x: 6, y: 0 },
  { defId: 's_mirror', x: 0, y: 1 },
  { defId: 's_power', x: 1, y: 1 },
  { defId: 'w_hairball', x: 2, y: 1 },
  { defId: 'w_flame_toaster', x: 0, y: 2 },
  { defId: 'w_melon_bingsu', x: 2, y: 2 },
  { defId: 'w_mama_duck', x: 4, y: 2 },
  { defId: 'w_methane_bomb', x: 5, y: 2 },
  { defId: 'w_tuna_missile', x: 5, y: 3 },
  { defId: 'g_bandage', x: 0, y: 4 },
  { defId: 'g_potlid', x: 1, y: 4 },
];

function stressRun(characterId: string, stageIndex: number): RunState {
  const run = newRun(data, characterId, 7);
  run.bag = createBag(7, 6);
  for (const it of STRESS_LAYOUT) {
    if (!addNewToBag(run.bag, items, it.defId, 1, it.x, it.y, it.rot ?? 0)) throw new Error(`stress layout: ${it.defId}`);
  }
  run.stageIndex = stageIndex;
  run.hp = runPlayerStats(data, run).maxHp;
  return run;
}

/** 스테이지 i 전투 전 상점에서 프로브(또는 strong) 빌드에 쓴 골드 (그 상점 한 번) */
function shopSpend(stageIndex: number, prog: { expand?: ('col' | 'row')[]; add: Addition[] }[] = PROGRESSION): number {
  let expands = 0;
  for (let i = 1; i < stageIndex; i++) expands += (prog[i].expand ?? []).length;
  const step = prog[stageIndex];
  let cost = 0;
  for (const _ of step.expand ?? []) cost += BAG_EXPAND_COSTS[expands++];
  for (const a of step.add) cost += itemPrice(items[a.defId], a.tier ?? 1);
  return cost;
}

// ── 스테이지 구조 ────────────────────────────────────────────

interface StageShape {
  rows: number;
  waves: number[];
  enemies: number;
  attackers: number;
  elites: number;
  totalHp: number;
  /** 처치 골드 기대값 (goldMul 1) */
  killGold: number;
  /** 아이템 드롭 기대 개수 */
  drops: number;
  /** 행동하는 적 수 (적 id → 수: 방패·치유·폭탄·장갑·젤리·RC카) */
  special: Record<string, number>;
}

/** 행동하는 적인가 (EnemyDef의 특수 행동 필드 중 하나라도) */
const isSpecial = (id: string): boolean => {
  const e = data.enemies[id];
  return !!(e && (e.shield || e.armor !== undefined || e.heal || e.deathBlast || e.splitOnDeath || e.shift));
};

/** 여러 칸 적이 덮는 칸까지 포함한 점유 격자 → 웨이브(연속된 비어 있지 않은 줄) 높이 목록 */
function stageShape(st: StageDef): StageShape {
  const occupied = st.rows.map(() => new Array<boolean>(FIELD_COLS).fill(false));
  const shape: StageShape = { rows: st.rows.length, waves: [], enemies: 0, attackers: 0, elites: 0, totalHp: 0, killGold: 0, drops: 0, special: {} };
  st.rows.forEach((row, i) => {
    [...row].forEach((ch, c) => {
      if (ch === '.') return;
      const e = data.enemies[st.legend[ch]];
      for (let dy = 0; dy < e.h; dy++) for (let dx = 0; dx < e.w; dx++) occupied[i + dy][c + dx] = true;
      shape.enemies++;
      if (isSpecial(e.id)) shape.special[e.id] = (shape.special[e.id] ?? 0) + 1;
      if (e.attack && !e.boss && e.w * e.h === 1) shape.attackers++;
      if (!e.boss && e.w * e.h > 1) shape.elites++;
      shape.totalHp += Math.max(1, Math.round(e.hp * st.hpMul));
      shape.killGold += e.gold;
      shape.drops += e.dropChance;
    });
  });
  let run = 0;
  for (const r of occupied) {
    if (r.some(Boolean)) run++;
    else if (run > 0) {
      shape.waves.push(run);
      run = 0;
    }
  }
  if (run > 0) shape.waves.push(run);
  return shape;
}

// ── 간단한 AI ────────────────────────────────────────────────
// 플레이어는 필드 벽 안 어디든 갈 수 있지만, 보통 사람처럼 바닥(예전 이동 구역의 아래쪽)을 지킨다.
// 이동은 sim의 모델 그대로(목표만 준다 — 가속 0.1초·최고 속도·도착 감속, logic/combat/movement.ts). AI는 그 모델로
// '그 탄이 내 줄에 올 때 나는 어디쯤 있을까'를 어림해 옆걸음 자리를 고른다(순간이동 가정 없음).
// 적 몸에 닿으면 즉시 패배라 내려온 적 아래는 피한다.

/** 집: 바닥 가운데 (예전 PLAYER_ZONE_BOTTOM - 40 = 884와 같은 높이) */
const HOME_Y = FIELD_H - 76;
const X_MIN = PLAYER_MIN_X;
const X_MAX = PLAYER_MAX_X;
/** 이보다 멀리 있는 탄은 무시 (px) */
const THREAT_RANGE = 420;
/** 한 번에 옆으로 피하는 최대 거리 */
const SIDESTEP = 170;
/** 몸 피하기: 아래 끝이 이 시간(초) 안에 내 피격 원 위끝(+ 여유)까지 내려올 적의 열은 피한다 */
const BODY_LOOKAHEAD = 2.5;
const BODY_MARGIN = 10;
/**
 * PROBE_DODGE=static: 예전 회피 AI의 자리 고르기(지금 자리에서 ±SIDESTEP 안, 탄 통과 x에서 가장 먼 곳 — 거기까지 가는 시간을
 * 생각하지 않음)를 새 이동 모델로 그대로 돌린다. 이동이 순간이동에 가까웠을 때 만든 AI가 느린 걸음으로 얼마나 더 맞는지 비교용
 */
const DODGE_STATIC = env.PROBE_DODGE === 'static';
/**
 * PROBE_DODGE=human: 사람 흉내 회피 — 생긴 지 HUMAN_REACT초(기본 0.25) 안 된 탄은 못 보고, HUMAN_REPLAN초(기본 0.2)마다만
 * 이동 목표를 다시 정한다(그 사이 손가락은 그대로). 매 스텝 완벽하게 다시 고르는 기본 AI는 이동 속도에 따라 버릇이 크게 바뀌므로
 * (900 px/s에서는 피할 자리를 쫓아 내달리다 더 맞았다) 이동 속도를 바꿔 비교할 때 쓴다 —
 * 예: PROBE_PATCH='{"characters":{"cat":{"baseMoveSpeed":900},…}}'. PROBE_HUMAN_REACT·PROBE_HUMAN_REPLAN으로 조절.
 */
const DODGE_HUMAN = env.PROBE_DODGE === 'human';
const HUMAN_REACT = Number(env.PROBE_HUMAN_REACT ?? 0.25);
const HUMAN_REPLAN = Number(env.PROBE_HUMAN_REPLAN ?? 0.2);
const humanState = new WeakMap<CombatSim, { seenAt: Map<number, number>; next: number; input: CombatInput | null }>();

/** sim 내부 값 (프로브 전용 — 이동 속도·하강 속도). 이름이 바뀌면 바로 알 수 있게 확인한다 */
function simSpeed(sim: CombatSim): number {
  const st = (sim as unknown as { stats?: PlayerStats }).stats;
  if (!st || !Number.isFinite(st.moveSpeed)) throw new Error('probe: CombatSim.stats.moveSpeed not found (renamed?)');
  return st.moveSpeed;
}

function simDescent(sim: CombatSim): number {
  const st = (sim as unknown as { stage?: StageDef }).stage;
  if (!st || !Number.isFinite(st.descentSpeed)) throw new Error('probe: CombatSim.stage.descentSpeed not found (renamed?)');
  return st.descentSpeed;
}

/**
 * sim 이동 모델의 1차원 어림: 목표 쪽 속도 v0(+ = 목표 쪽)에서 출발해 t초 동안 목표 쪽으로 간 거리(최대 d).
 * 가속도 = 최고 속도 / PLAYER_ACCEL_TIME, 반대로 가던 중이면 먼저 멈췄다가 돌아선다. 끝의 도착 감속은 무시(d에서 자름).
 */
function travel(d: number, v0: number, speed: number, t: number): number {
  const a = speed / PLAYER_ACCEL_TIME;
  let x = 0;
  let v = v0;
  let left = t;
  if (v < 0) {
    const tb = Math.min(left, -v / a);
    x += v * tb + 0.5 * a * tb * tb;
    v += a * tb;
    left -= tb;
  }
  if (left > 0) {
    const ta = Math.min(left, Math.max(0, (speed - v) / a));
    x += v * ta + 0.5 * a * ta * ta;
    v += a * ta;
    left -= ta;
    x += v * left;
  }
  return Math.min(d, x);
}

/**
 * 높이 y에서 내려오는 적 몸에 막힌 x 구간 [lo, hi] 목록 (곧 닿을 적만), 그리고 지금 이미 그 높이까지 내려와
 * 밑으로 지나갈 수 없는 적의 구간(wall = true)
 */
function bodyBlocks(sim: CombatSim, y: number): { lo: number; hi: number; wall: boolean }[] {
  const desc = simDescent(sim);
  const top = y - PLAYER_HIT_RADIUS - BODY_MARGIN;
  const out: { lo: number; hi: number; wall: boolean }[] = [];
  for (const e of sim.enemies) {
    if (!e.alive) continue;
    const bottom = e.y + e.h;
    if (bottom + desc * BODY_LOOKAHEAD < top) continue;
    out.push({ lo: e.x - PLAYER_HIT_RADIUS - BODY_MARGIN, hi: e.x + e.w + PLAYER_HIT_RADIUS + BODY_MARGIN, wall: bottom >= top });
  }
  // 보스 위험 지역(예고·발동 중 — 내려찍기 열, 구슬 그림자)도 그 높이에서 막힌 구간으로 (지나가는 것은 괜찮다 — 벽 아님).
  // 일반 스테이지는 hazards가 늘 비어 있어 그대로
  for (const h of sim.hazards) {
    if (h.state === 'done') continue;
    const reach = PLAYER_HIT_RADIUS + BODY_MARGIN;
    if (h.shape === 'rect') {
      if (y + reach <= h.y || y - reach >= h.y + h.h) continue;
      out.push({ lo: h.x - reach, hi: h.x + h.w + reach, wall: false });
    } else {
      const r = h.w / 2 + reach;
      const dy = y - (h.y + h.h / 2);
      if (Math.abs(dy) >= r) continue;
      const half = Math.sqrt(r * r - dy * dy);
      out.push({ lo: h.x + h.w / 2 - half, hi: h.x + h.w / 2 + half, wall: false });
    }
  }
  return out;
}

const blocked = (x: number, blocks: readonly { lo: number; hi: number }[]): boolean => blocks.some((b) => x > b.lo && x < b.hi);

/**
 * 바닥 가운데를 지키다가, 가장 가까운 위협 탄을 옆걸음으로 피한다: ±SIDESTEP 안의 자리마다 sim 이동 모델로
 * '탄이 내 줄에 오는 순간 내 x'를 어림해 그 탄의 통과 x에서 가장 먼 자리. 내려온 적 몸 아래는 후보에서 뺀다
 * (이미 내 높이까지 내려온 적 밑으로는 지나가지 않는다). 집 높이가 모두 막히면 맨 아래 줄로.
 */
function aiInput(sim: CombatSim): CombatInput {
  if (!DODGE_HUMAN) return dodgeInput(sim, null);
  let hs = humanState.get(sim);
  if (!hs) {
    hs = { seenAt: new Map(), next: 0, input: null };
    humanState.set(sim, hs);
  }
  for (const s of sim.enemyShots) if (!hs.seenAt.has(s.id)) hs.seenAt.set(s.id, sim.time);
  if (hs.input && sim.time < hs.next - 1e-9) return hs.input;
  hs.input = dodgeInput(sim, hs.seenAt);
  hs.next = sim.time + HUMAN_REPLAN;
  return hs.input;
}

/** aiInput 본체. seenAt이 있으면(사람 흉내) 생긴 지 HUMAN_REACT초 안 된 탄은 무시한다 */
function dodgeInput(sim: CombatSim, seenAt: Map<number, number> | null): CombatInput {
  const pl = sim.player;
  const speed = simSpeed(sim);
  let y = HOME_Y;
  let blocks = bodyBlocks(sim, y);
  const anyFree = (bs: typeof blocks): boolean => {
    for (let x = X_MIN; x <= X_MAX; x += 6) if (!blocked(x, bs)) return true;
    return false;
  };
  if (blocks.length > 0 && !anyFree(blocks)) {
    y = PLAYER_MAX_Y;
    blocks = bodyBlocks(sim, y);
  }
  // 지금 높이까지 내려와 벽이 된 적 사이 — 이 범위 안에서만 움직인다
  let lo = X_MIN;
  let hi = X_MAX;
  for (const b of blocks) {
    if (!b.wall) continue;
    if (b.hi <= pl.x) lo = Math.max(lo, b.hi);
    else if (b.lo >= pl.x) hi = Math.min(hi, b.lo);
  }
  const free = (x: number): boolean => x >= lo && x <= hi && !blocked(x, blocks);
  /** 막히지 않은 자리 중 want에 가장 가까운 곳 */
  const nearestFree = (want: number): number => {
    let best = pl.x;
    let bestD = Infinity;
    for (let x = lo; x <= hi + 1e-9; x += 6) {
      if (!free(x)) continue;
      const d = Math.abs(x - want);
      if (d < bestD) {
        bestD = d;
        best = x;
      }
    }
    return best;
  };

  let nearest: { d: number; crossX: number; t: number; rr: number } | null = null;
  for (const s of sim.enemyShots) {
    if (s.vy <= 0 || s.y > pl.y + pl.hitRadius) continue;
    if (seenAt && sim.time - (seenAt.get(s.id) ?? sim.time) < HUMAN_REACT - 1e-9) continue;
    const d = Math.hypot(s.x - pl.x, s.y - pl.y);
    if (d > THREAT_RANGE) continue;
    const t = (pl.y - s.y) / s.vy;
    const crossX = s.x + s.vx * t;
    if (Math.abs(crossX - pl.x) > s.radius + pl.hitRadius + 40) continue; // 안 맞는 탄
    if (!nearest || d < nearest.d) nearest = { d, crossX, t, rr: s.radius + pl.hitRadius };
  }
  if (!nearest) return { targetX: nearestFree(FIELD_W / 2), targetY: y };
  let bestX = pl.x;
  let bestGap = -Infinity;
  for (let x = Math.max(lo, pl.x - SIDESTEP); x <= Math.min(hi, pl.x + SIDESTEP) + 1e-9; x += 10) {
    if (!free(x)) continue;
    let gap: number;
    if (DODGE_STATIC) gap = Math.abs(x - nearest.crossX);
    else {
      // 그쪽으로 가면 탄이 내 줄에 올 때 어디쯤인가 (sim 이동 모델 어림)
      const dir = x >= pl.x ? 1 : -1;
      const at = pl.x + dir * travel(Math.abs(x - pl.x), dir * pl.vx, speed, nearest.t);
      // 도착 뒤의 여유(최종 자리)도 조금 본다 — 같은 시점 여유면 더 멀리 벗어나는 쪽
      gap = Math.min(Math.abs(at - nearest.crossX), nearest.rr + 40) + 0.05 * Math.abs(x - nearest.crossX);
    }
    if (gap > bestGap) {
      bestGap = gap;
      bestX = x;
    }
  }
  return { targetX: bestX, targetY: y };
}

/** 비교 기준선: 가운데에 가만히 서 있기 (회피 없음 — 내려온 적 몸에 닿아 질 수도 있다) */
function standStill(): CombatInput {
  return { targetX: FIELD_W / 2, targetY: HOME_Y };
}

// ── 보스 옆 통로 캠핑 (보스 테스트 'lane camp' 열) ──────────────
// 사용자 리뷰의 꼼수: 왼쪽 통로 위쪽(x 45, y 200)에 서서 거의 수직(-82°)으로만 쏜다 — 공이 바로 보스 윗면 틈으로 들어가 백어택이 쏟아진다.
// still = 그 자리에 가만히(예전 측정: 냥냥 12판 중 10승, 43~45초). smart = 위험 지역(예고·발동)이 그 자리나 지금 자리에 걸리면
// 회피 AI(aiInput)로 내려가 피했다가, 다 끝나면 바닥을 따라 왼쪽 끝으로 가서 통로로 다시 올라간다(보스 아래 졸개 줄을 가로지르지 않게).

const LANE_X = Number(env.PROBE_CAMP_X ?? 45);
const LANE_Y = Number(env.PROBE_CAMP_Y ?? 200);
const LANE_AIM = (Number(env.PROBE_CAMP_AIM ?? -82) * Math.PI) / 180;

function laneCamper(smart: boolean): Ai {
  const touches = (h: { shape: 'rect' | 'circle'; x: number; y: number; w: number; h: number }, x: number, y: number, pad: number): boolean => {
    if (h.shape === 'circle') return Math.hypot(x - (h.x + h.w / 2), y - (h.y + h.h / 2)) < h.w / 2 + pad;
    const dx = Math.max(h.x - x, 0, x - (h.x + h.w));
    const dy = Math.max(h.y - y, 0, y - (h.y + h.h));
    return Math.hypot(dx, dy) < pad;
  };
  return (sim) => {
    const pl = sim.player;
    if (smart) {
      const pad = PLAYER_HIT_RADIUS + 14;
      const live = sim.hazards.filter((h) => h.state !== 'done');
      if (live.some((h) => touches(h, LANE_X, LANE_Y, pad) || touches(h, pl.x, pl.y, pad))) {
        // 통로 안이면 통로를 따라 아래로 — 위험 지역이 안 닿는 가장 가까운 높이(보스 아래 졸개 줄을 가로지르지 않는다). 없으면 회피 AI
        if (pl.x <= CELL - PLAYER_HIT_RADIUS) {
          for (let y = Math.max(pl.y, LANE_Y); y <= PLAYER_MAX_Y; y += 12) {
            if (!live.some((h) => touches(h, LANE_X, y, pad))) return { targetX: LANE_X, targetY: y, aimAngle: LANE_AIM };
          }
        }
        return { ...aiInput(sim), aimAngle: LANE_AIM };
      }
    }
    // 통로 열(0열) 밖이면 먼저 바닥을 따라 왼쪽 끝으로, 그다음 통로로 올라간다
    if (pl.x > CELL - PLAYER_HIT_RADIUS) return { targetX: LANE_X, targetY: Math.max(pl.y, HOME_Y), aimAngle: LANE_AIM };
    return { targetX: LANE_X, targetY: LANE_Y, aimAngle: LANE_AIM };
  };
}

// ── 수동 조준 흉내 (실제 게임의 탭 조준) ─────────────────────

const DEG = Math.PI / 180;
/** 다시 탭하는 간격(초)과 탭 오차(±도), 틈으로 인정하는 가이드 여유(±도), 이보다 깊으면(필드 비율) 틈 대신 맨 앞 */
const MANUAL_REAIM = 1.5;
const MANUAL_TAP_ERR = 1.5;
const MANUAL_GAP_WIN = 1.5;
const MANUAL_DANGER = 0.7;

/** 맨 앞 웨이브의 뒤쪽 끝(칸 경계 y): 가장 아래 적의 줄부터 빈 줄 없이 이어진 줄들의 맨 위. 화면 밖 줄 포함 */
function frontWaveTop(enemies: readonly EnemyEntity[]): number | null {
  const rows = new Map<number, number>();
  let lowest = -Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const top = e.y - ENEMY_INSET;
    const n = Math.round((e.h + 2 * ENEMY_INSET) / CELL);
    for (let k = 0; k < n; k++) {
      const key = Math.round((top + k * CELL) / CELL);
      rows.set(key, top + k * CELL);
      if (key > lowest) lowest = key;
    }
  }
  if (rows.size === 0) return null;
  let k = lowest;
  while (rows.has(k - 1)) k--;
  return rows.get(k) ?? null;
}

const traceOut = new Float64Array(6);
const traceRes: AimTrace = { points: 0, hitId: -1 };

/** 가이드로 본 '틈 쏘기' 각도(통과하는 각도 중 가장 수직에 가까운 것) 또는 null */
function gapAngle(sim: CombatSim, r: number): number | null {
  const ft = frontWaveTop(sim.enemies);
  if (ft === null || ft < 0) return null; // 웨이브가 아직 다 안 들어옴 → 뒤쪽 공간 없음
  const ox = sim.player.x;
  const oy = sim.player.y - FIRE_OFFSET_Y;
  const STEP = 0.5;
  const ok: boolean[] = [];
  for (let deg = -172; deg <= -8; deg += STEP) {
    traceAim(ox, oy, deg * DEG, r, sim.enemies, 1600, 2, traceOut, traceRes);
    ok.push(traceRes.hitId >= 0 && traceOut[2 * (traceRes.points - 1) + 1] <= ft + ENEMY_INSET + 0.5);
  }
  const w = Math.round(MANUAL_GAP_WIN / STEP);
  let best: number | null = null;
  for (let i = w; i < ok.length - w; i++) {
    let all = true;
    for (let k = i - w; k <= i + w && all; k++) all = ok[k];
    const a = (-172 + i * STEP) * DEG;
    if (all && (best === null || Math.abs(a + Math.PI / 2) < Math.abs(best + Math.PI / 2))) best = a;
  }
  return best;
}

/** 가장 아래(동률이면 x가 가까운) 보이는 적의 중심 방향과 그 적의 아래 끝 */
function lowestAngle(sim: CombatSim): { angle: number; bottom: number } {
  const ox = sim.player.x;
  const oy = sim.player.y - FIRE_OFFSET_Y;
  let best: EnemyEntity | null = null;
  for (const e of sim.enemies) {
    if (!e.alive || e.y + e.h <= 0) continue;
    const b = e.y + e.h;
    const closer = Math.abs(e.x + e.w / 2 - ox) < (best ? Math.abs(best.x + best.w / 2 - ox) : Infinity);
    if (!best || b > best.y + best.h + 0.5 || (Math.abs(b - best.y - best.h) <= 0.5 && closer)) best = e;
  }
  if (!best) return { angle: -Math.PI / 2, bottom: 0 };
  return { angle: Math.atan2(best.y + best.h / 2 - oy, best.x + best.w / 2 - ox), bottom: best.y + best.h };
}

/** 수동 조준 AI (이동은 aiInput과 같음). r = 가이드 공 반경(쿨타임이 가장 짧은 무기 — 게임의 조준 가이드와 같음) */
function manualAi(seed: number, r: number): Ai {
  const rng = new Rng(seed ^ 0x5151);
  let aim = -Math.PI / 2;
  let next = 0;
  return (sim) => {
    const move = aiInput(sim);
    if (sim.time >= next && sim.enemies.some((e) => e.alive && e.y + e.h > 0)) {
      const low = lowestAngle(sim);
      const gap = low.bottom < MANUAL_DANGER * FIELD_H ? gapAngle(sim, r) : null;
      aim = (gap ?? low.angle) + rng.range(-MANUAL_TAP_ERR, MANUAL_TAP_ERR) * DEG;
      next = sim.time + MANUAL_REAIM;
    }
    return { ...move, aimAngle: aim };
  };
}

function guideRadius(loadout: WeaponLoadout[]): number {
  let best: WeaponLoadout | null = null;
  for (const l of loadout) if (!best || l.cooldown < best.cooldown) best = l;
  return best ? best.radius : 12;
}

// ── 실행 / 기록 ──────────────────────────────────────────────

type Ai = (sim: CombatSim) => CombatInput;


interface Outcome {
  status: string;
  won: boolean;
  time: number;
  kills: number;
  total: number;
  /** 적 아래 끝이 가장 깊이 내려온 위치 (방어선 = 100%) */
  deepest: number;
  taken: number;
  hpLeft: number;
  maxHp: number;
  dealt: number;
  /** 실제 rewardKill로 받은 처치 골드 (goldMul·소수 골드 굴림 반영, 드롭 환전 포함) */
  gold: number;
  drops: number;
  /** 보스가 화면에 들어온 뒤 쓰러질 때까지(또는 전투 끝까지) 초. 보스 없으면 null */
  bossTime: number | null;
  /** 보스가 화면에 있던 동안 냉기에 걸려 있던 시간 비율. 보스 없으면 null */
  bossChill: number | null;
  /** 보스가 받은 피해(체력 감소 합)와 그중 투사체 직접 적중이 보스 윗면(공이 보스보다 위)에서 낸 몫 / 양말 개틀링 직접 적중의 몫 */
  bossDamage: number;
  bossAboveDamage: number;
  bossGatlingDamage: number;
  /** 보스가 받은 투사체 직접 피해 중 냉기(+25%)가 더한 몫, 무기별 직접 피해 */
  bossChillBonus: number;
  bossByWeapon: Record<string, number>;
  /** 받은 피해의 출처: 적 탄 그림/반경(gear = 보스, dart/12 = 다트총, dart/14 = 곰인형, bolt = 로봇, spring = 깜짝 상자). 적 몸 접촉은 피해가 아니라 패배(LOST(contact)) */
  takenBy: Record<string, number>;
  /** 보스가 화면에 들어오기 전까지 받은 피해 (보스 없으면 전부) */
  takenBeforeBoss: number;
  /** 보스 발사 횟수와 그중 플레이어에게 맞은 톱니 수 (무적 시간 동안 지나간 탄은 안 셈) */
  bossVolleys: number;
  gearHits: number;
  /** 살아있는 플레이어 투사체(분열 자식 포함) — 스텝 평균 / 최대 */
  avgProj: number;
  maxProj: number;
  /** 발사된 투사체 수 (fire count 합 + 분열 자식) */
  launched: number;
  /** 투사체 직접 적중 수 (폭발·연쇄·화상 제외) */
  directHits: number;
  /** 그중 공 중심이 맨 앞 웨이브의 뒤쪽 끝보다 위(뒤)에서 맞힌 것 */
  behindHits: number;
  /** 뒤에서 한 번이라도 맞힌 공의 수와 그 공들의 직접 적중 합 (틈으로 들어가 덜그럭거린 공) */
  behindBalls: number;
  behindBallHits: number;
  /** 공마다 직접 적중 BOUNCE_CAP_PROBE번을 넘은 적중 수의 합 — 반사 횟수 상한을 그만큼 두면 사라질 적중의 하한(벽 반사는 안 셈) */
  hitsBeyondCap: number;
  /** 사라진 투사체의 사유: 바닥으로 빠짐 / 수명 / 반사 횟수 소진 */
  deaths: { bottom: number; age: number; cap: number };
  /** 무기별 살아있던 투사체-초 (분열 자식은 '무기id/split') */
  projSecByWeapon: Record<string, number>;
  /** 최대치였던 순간의 구성 (무기별 수, 시각) */
  peakMix: string;
  ms: number;
  /** 보스전(보스 테스트): 위험 지역에 맞은 수·피해, 적 탄에 맞은 수, 살아있는 졸개 평균/최대, 도달한 페이즈(0부터), 소환된 졸개 수,
   *  보스 윗면 직접 적중 수(공이 보스보다 위 — 양옆 통로로 넘어간 공의 '백어택') */
  hazardHits: number;
  hazardTaken: number;
  shotHits: number;
  minionAvg: number;
  minionPeak: number;
  phaseMax: number;
  summoned: number;
  bossTopHits: number;
  /**
   * 보스전: 플레이어 투사체 직접 적중 중 졸개가 받은 수(보스 대신 맞아 준 '방패' 몫), 보스가 살아 있는 동안 처치한 졸개 수,
   * 살아있는 졸개 아래 끝이 가장 깊이 내려온 위치(필드 높이 비율 — 1 = 방어선)
   */
  minionDirectHits: number;
  minionKills: number;
  minionDeepest: number;
  /**
   * 백어택·행동하는 적 (docs/DESIGN.md '백어택'·'행동하는 적'): 직접 적중 중 백어택(윗면) 수, 방패병 정면에 막힌 수,
   * 치유병이 회복한 HP 합, 폭탄병 폭발 수, 갈라져 나온 꼬마 젤리 수, RC카 옆걸음 수
   */
  backHits: number;
  blocked: number;
  healed: number;
  blasts: number;
  spawned: number;
  shifts: number;
  /** 레벨업·스킬: 전투를 시작한 레벨, 전투 중 고른 레벨업 수(종류별 item/upgrade/boon), 스킬 쓴 횟수 */
  entryLevel: number;
  levelUps: number;
  levelKinds: { item: number; upgrade: number; boon: number };
  skillUses: number;
}

/** '반사 횟수 상한을 두면?' 계측용 가정 상한 (maxBounces 0 무기의 기본 상한 후보) */
const BOUNCE_CAP_PROBE = 12;

/**
 * 프로브 계측용: CombatSim의 내부 적중 처리(투사체 직접 적중 1번마다 1회 호출 — 방패병 정면에 막힌 것은 아님)를 가로챈다.
 * back = 백어택(윗면), pierce = 관통 적중 — 원래 함수에 그대로 넘긴다
 */
interface ProbeHooks {
  projectileHit(p: ProjectileEntity, e: EnemyEntity, hx: number, hy: number, back: boolean, pierce: boolean): void;
}

/** 투사체가 사라진 사유. 수명 상한은 sim 내부 값(분열 자식은 더 짧을 수 있음)을 그대로 읽는다 */
function deathCause(p: ProjectileEntity): 'bottom' | 'age' | 'cap' {
  if (p.y - p.radius > FIELD_H) return 'bottom';
  const cap = (p as ProjectileEntity & { maxAge?: number }).maxAge ?? PROJECTILE_MAX_AGE;
  return p.age > cap - 1e-9 ? 'age' : 'cap';
}

function sheetDps(loadout: WeaponLoadout[]): number {
  return loadout.reduce((s, l) => s + (l.damage * l.count) / l.cooldown, 0);
}

function assertFiniteState(sim: CombatSim): void {
  const pl = sim.player;
  if (!Number.isFinite(pl.hp) || !Number.isFinite(pl.x) || !Number.isFinite(pl.y)) {
    throw new Error(`player NaN: ${JSON.stringify(pl)}`);
  }
  for (const e of sim.enemies) {
    if (Number.isNaN(e.hp) || !Number.isFinite(e.y)) throw new Error(`enemy NaN: ${e.defId}#${e.id}`);
  }
  for (const p of sim.projectiles) {
    if (!Number.isFinite(p.x + p.y + p.vx + p.vy + p.damage)) throw new Error(`projectile NaN: ${p.sprite}#${p.id}`);
  }
}

/** simulate 옵션: 스킬·레벨업을 판마다 켜고 끄기(기본 PROBE_SKILL·PROBE_LEVELUP), 전투 중 레벨업 선택 함수(기본 probeChoice) */
interface SimOpts {
  skill?: boolean;
  levelups?: boolean;
  choose?: Chooser;
}

/** stage를 주면 그 스테이지(보스 테스트 등 data.stages 밖)로, 아니면 data.stages[stageIndex] */
function simulate(
  source: RunState,
  stageIndex: number,
  seed: number,
  ai: Ai,
  stage: StageDef = data.stages[stageIndex],
  opts: SimOpts = {},
): Outcome {
  const useSkill = opts.skill ?? SKILLS;
  const useLevel = opts.levelups ?? LEVELUPS;
  // 보상은 복사본 런에 받는다 (빌드 런은 다른 시뮬에서도 쓴다)
  const run = structuredClone(source);
  // 처치 골드(소수 부분 확률)·드롭 굴림이 판마다 같은 운이 되지 않게 보상 RNG를 시드로 바꾼다
  run.rngState = (Math.imul(seed ^ 0x5bd1e995, 0x9e3779b1) ^ source.rngState) >>> 0;
  const player = runPlayerStats(data, run);
  const sim = new CombatSim({
    stage,
    stageIndex,
    enemies: data.enemies,
    bosses: data.bosses,
    loadout: runLoadout(data, run),
    player,
    hp: run.hp,
    seed,
    skill: useSkill ? runSkill(data, run) : null,
  });
  const entryLevel = runLevel(run);
  let levelUps = 0;
  const levelKinds = { item: 0, upgrade: 0, boon: 0 };
  // 보스전 계측 (보스 테스트 표): 위험 지역·적 탄 맞은 수, 살아있는 졸개, 도달한 페이즈, 소환 수
  let hazardHits = 0;
  let hazardTaken = 0;
  let shotHits = 0;
  let minionSum = 0;
  let minionPeak = 0;
  let phaseMax = 0;
  let summoned = 0;
  let bossTopHits = 0;
  let minionDirectHits = 0;
  let minionKills = 0;
  let minionDeepest = 0;
  let backHits = 0;
  let blocked = 0;
  let healed = 0;
  let blasts = 0;
  let spawned = 0;
  let shifts = 0;

  let taken = 0;
  let dealt = 0;
  let maxProj = 0;
  let projSum = 0;
  let steps = 0;
  let launched = 0;
  let deepest = 0;
  const takenBy: Record<string, number> = {};
  let takenBeforeBoss = 0;
  let bossVolleys = 0;
  let gearHits = 0;
  let prevShots: EnemyShotEntity[] = [];
  let drops = 0;
  let bossSeen: number | null = null;
  let bossEnd: number | null = null;

  // ── 투사체 계측 ──
  let frontTop: number | null = null;
  let directHits = 0;
  let behindHits = 0;
  /** 투사체 id → [직접 적중, 뒤 적중] */
  const perProj = new Map<number, [number, number]>();
  const hooks = sim as unknown as ProbeHooks;
  const origHit = hooks.projectileHit;
  if (typeof origHit !== 'function') throw new Error('probe: CombatSim.projectileHit not found (renamed?)');
  const defByUid = new Map(runLoadout(data, run).map((l) => [l.uid, l.defId] as const));
  let bossAboveDamage = 0;
  let bossGatlingDamage = 0;
  let bossChillBonus = 0;
  const bossByWeapon: Record<string, number> = {};
  if (origHit.length !== 6) throw new Error(`probe: CombatSim.projectileHit takes ${origHit.length} args (expected 6 — signature changed?)`);
  hooks.projectileHit = (p, e, hx, hy, back, pierce) => {
    directHits++;
    if (back) backHits++;
    const behind = frontTop !== null && frontTop >= 0 && p.y < frontTop + ENEMY_INSET;
    if (behind) behindHits++;
    const rec = perProj.get(p.id);
    if (rec) {
      rec[0]++;
      if (behind) rec[1]++;
    } else perProj.set(p.id, [1, behind ? 1 : 0]);
    const before = e.hp;
    const chilled = e.chillTime > 0;
    origHit.call(sim, p, e, hx, hy, back, pierce);
    if (sim.boss && !e.boss) minionDirectHits++;
    if (e.boss) {
      const d = before - Math.max(0, e.hp);
      const w = defByUid.get(p.weaponUid) ?? '?';
      if (p.y < e.y) {
        bossAboveDamage += d;
        bossTopHits++;
      }
      if (w === 'w_sock_gatling') bossGatlingDamage += d;
      bossByWeapon[w] = (bossByWeapon[w] ?? 0) + d;
      if (chilled) bossChillBonus += d * (1 - 1 / CHILL_DAMAGE_TAKEN_MUL);
    }
  };
  const deaths = { bottom: 0, age: 0, cap: 0 };
  let bossVisibleSteps = 0;
  let bossChilledSteps = 0;
  let bossRef: EnemyEntity | null = null;
  const splitSprites = new Set(Object.values(items).flatMap((d) => (d.weapon?.projectile.split ? [d.weapon.projectile.split.sprite] : [])));
  const projSecByWeapon: Record<string, number> = {};
  let peakMix = '';
  let prevLive: ProjectileEntity[] = [];

  const goldBefore = run.gold;
  const started = performance.now();
  const maxSteps = Math.round(MAX_SIM_SECONDS / SIM_DT);
  for (let i = 0; i < maxSteps && sim.status === 'running'; i++) {
    frontTop = frontWaveTop(sim.enemies);
    sim.step(SIM_DT, ai(sim));
    const shotsBefore = prevShots;
    prevShots = sim.enemyShots.slice();
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'playerHit') {
        taken += ev.damage;
        let key = '?';
        if (ev.source === 'shot') {
          // 이번 스텝에 사라진 탄 중 플레이어에 가장 가까운 것
          let best = Infinity;
          for (const sh of shotsBefore) {
            if (sh.alive) continue;
            const d = Math.hypot(sh.x - sim.player.x, sh.y - sim.player.y);
            if (d < best) {
              best = d;
              key = `${sh.sprite.replace(/^shot_/, '')}/${sh.radius}`;
            }
          }
        }
        if (ev.source === 'hazard') {
          key = 'hazard';
          hazardHits++;
          hazardTaken += ev.damage;
        } else shotHits++;
        takenBy[key] = (takenBy[key] ?? 0) + ev.damage;
        if (bossSeen === null) takenBeforeBoss += ev.damage;
        if (key.startsWith('gear')) gearHits++;
      } else if (ev.type === 'enemyShoot' && bossRef && ev.enemyId === bossRef.id) bossVolleys++;
      else if (ev.type === 'hit') dealt += ev.damage;
      else if (ev.type === 'fire') launched += ev.count;
      else if (ev.type === 'split') launched += ev.count;
      else if (ev.type === 'kill') {
        if (rewardKill(data, run, ev.defId).drop) drops++;
        if (useLevel) grantKillXp(data, run, ev.defId);
        if (ev.boss) bossEnd = sim.time;
        else if (sim.boss && sim.boss.mode !== 'dead') minionKills++;
      } else if (ev.type === 'summon') summoned++;
      else if (ev.type === 'bossPhase') phaseMax = Math.max(phaseMax, ev.phase);
      else if (ev.type === 'blocked') blocked++;
      else if (ev.type === 'heal') healed += ev.amount;
      else if (ev.type === 'enemySpawn') spawned++;
      else if (ev.type === 'shift') shifts++;
      if (ev.type === 'explode' && ev.fromEnemy !== undefined) blasts++;
    }
    // 레벨업: 화면처럼 전투를 멈추고(스텝 사이) 고른 뒤 가방 변화를 sim에 반영
    if (useLevel && sim.status === 'running' && pendingLevelUps(run) > 0) {
      for (const t of resolveLevelUps(run, opts.choose)) {
        levelUps++;
        if (t.startsWith('+')) levelKinds.item++;
        else if (t.startsWith('boon')) levelKinds.boon++;
        else levelKinds.upgrade++;
      }
      const lo = runLoadout(data, run);
      for (const l of lo) defByUid.set(l.uid, l.defId);
      sim.setLoadout(lo, runPlayerStats(data, run));
    }
    if (useSkill && skillAi(sim)) sim.activateSkill();
    if (sim.boss) {
      minionSum += sim.boss.minions;
      minionPeak = Math.max(minionPeak, sim.boss.minions);
    }
    for (const p of prevLive) if (!p.alive) deaths[deathCause(p)]++;
    prevLive = sim.projectiles.slice();
    steps++;
    projSum += sim.projectiles.length;
    const mix: Record<string, number> = {};
    for (const p of sim.projectiles) {
      const k = `${defByUid.get(p.weaponUid) ?? '?'}${splitSprites.has(p.sprite) ? '/split' : ''}`;
      projSecByWeapon[k] = (projSecByWeapon[k] ?? 0) + SIM_DT;
      mix[k] = (mix[k] ?? 0) + 1;
    }
    if (sim.projectiles.length > maxProj) {
      maxProj = sim.projectiles.length;
      const boss = sim.enemies.some((e) => e.boss && e.y + e.h > 0) ? ' boss' : '';
      peakMix = `t${sim.time.toFixed(0)}s${boss} ${Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace(/^w_/, '')} ${v}`).join(', ')}`;
    }
    for (const e of sim.enemies) {
      deepest = Math.max(deepest, e.y + e.h);
      if (sim.boss && !e.boss && e.alive) minionDeepest = Math.max(minionDeepest, e.y + e.h);
      if (e.boss && bossSeen === null && e.y + e.h > 0) bossSeen = sim.time;
      if (e.boss) {
        bossRef = e;
        if (e.alive && e.y + e.h > 0) {
          bossVisibleSteps++;
          if (e.chillTime > 0) bossChilledSteps++;
        }
      }
    }
    if (i % 30 === 0) assertFiniteState(sim);
  }
  assertFiniteState(sim);
  let behindBalls = 0;
  let behindBallHits = 0;
  let hitsBeyondCap = 0;
  for (const [hits, behind] of perProj.values()) {
    hitsBeyondCap += Math.max(0, hits - BOUNCE_CAP_PROBE);
    if (behind === 0) continue;
    behindBalls++;
    behindBallHits += hits;
  }

  return {
    status: sim.status === 'lost' ? `LOST(${sim.lostReason})` : sim.status === 'won' ? 'won' : 'TIMEOUT',
    won: sim.status === 'won',
    time: sim.time,
    kills: sim.killedEnemies,
    total: sim.totalEnemies,
    deepest: deepest / FIELD_H,
    taken,
    hpLeft: Math.max(0, sim.player.hp),
    maxHp: sim.player.maxHp,
    dealt,
    gold: run.gold - goldBefore,
    drops,
    bossTime: bossSeen === null ? null : (bossEnd ?? sim.time) - bossSeen,
    bossChill: bossVisibleSteps > 0 ? bossChilledSteps / bossVisibleSteps : null,
    bossDamage: bossRef ? bossRef.maxHp - (bossRef.alive ? Math.max(0, bossRef.hp) : 0) : 0,
    bossAboveDamage,
    bossGatlingDamage,
    bossChillBonus,
    bossByWeapon,
    takenBy,
    takenBeforeBoss,
    bossVolleys,
    gearHits,
    avgProj: steps > 0 ? projSum / steps : 0,
    maxProj,
    launched,
    directHits,
    behindHits,
    behindBalls,
    behindBallHits,
    hitsBeyondCap,
    deaths,
    projSecByWeapon,
    peakMix,
    ms: performance.now() - started,
    hazardHits,
    hazardTaken,
    shotHits,
    minionAvg: steps > 0 ? minionSum / steps : 0,
    minionPeak,
    phaseMax,
    summoned,
    bossTopHits,
    minionDirectHits,
    minionKills,
    minionDeepest: minionDeepest / FIELD_H,
    backHits,
    blocked,
    healed,
    blasts,
    spawned,
    shifts,
    entryLevel,
    levelUps,
    levelKinds,
    skillUses: sim.skill?.uses ?? 0,
  };
}

function cell(o: Outcome): string {
  const kills = o.kills < o.total ? ` ${o.kills}/${o.total}` : '';
  const boss = o.bossTime === null ? '' : ` boss${o.bossTime.toFixed(0)}s`;
  return `${o.status}${kills} ${o.time.toFixed(0)}s deep${Math.round(o.deepest * 100)}% -${o.taken}hp${boss} p${o.avgProj.toFixed(1)}/${o.maxProj}`;
}

/** 투사체 밀도 칸: 평균/최대 살아있는 수 · 발사 1개당 직접 적중 · 뒤 적중 비율 · 뒤로 들어간 공 1개당 적중 · 수명으로 사라진 비율 */
function projCell(o: Outcome): string {
  const died = o.deaths.bottom + o.deaths.age + o.deaths.cap;
  const hpp = o.launched > 0 ? o.directHits / o.launched : 0;
  const rattle = o.behindBalls > 0 ? o.behindBallHits / o.behindBalls : 0;
  return (
    `${o.avgProj.toFixed(1)}/${o.maxProj} h${hpp.toFixed(1)} b${pct(o.directHits > 0 ? o.behindHits / o.directHits : 0)}` +
    ` r${rattle.toFixed(1)} age${pct(died > 0 ? o.deaths.age / died : 0)} cap${pct(died > 0 ? o.deaths.cap / died : 0)}`
  );
}

/** 여러 결과를 합친 밀도 요약 */
function projSummary(os: Outcome[]): {
  avg: number;
  peak: number;
  hpp: number;
  behind: number;
  rattle: number;
  age: number;
  beyondCap: number;
} {
  const sum = (f: (o: Outcome) => number): number => os.reduce((s, o) => s + f(o), 0);
  const died = sum((o) => o.deaths.bottom + o.deaths.age + o.deaths.cap);
  return {
    avg: os.length > 0 ? sum((o) => o.avgProj) / os.length : 0,
    peak: Math.max(0, ...os.map((o) => o.maxProj)),
    hpp: sum((o) => o.directHits) / Math.max(1, sum((o) => o.launched)),
    behind: sum((o) => o.behindHits) / Math.max(1, sum((o) => o.directHits)),
    rattle: sum((o) => o.behindBallHits) / Math.max(1, sum((o) => o.behindBalls)),
    age: sum((o) => o.deaths.age) / Math.max(1, died),
    beyondCap: sum((o) => o.hitsBeyondCap) / Math.max(1, sum((o) => o.directHits)),
  };
}

function table(header: string[], rows: string[][]): string {
  const width = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (vals: string[]): string => `| ${vals.map((v, i) => v.padEnd(width[i])).join(' | ')} |`;
  return [line(header), line(width.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

// ── 승률 스윕 ────────────────────────────────────────────────
// 판 하나는 운(시드)에 크게 흔들린다 → 스테이지 × 설정마다 시드 여러 개 × 캐릭터 3을 돌려 승률과 분포를 본다.
// 반복 조정용 환경 변수: PROBE_SEEDS=4 (앞 4개 시드만), PROBE_SEED_LIST=1,2,3 (시드를 직접 — 다른 시드로 다시 재기),
// PROBE_STAGES=2,3 (그 스테이지 인덱스만), PROBE_COLS=build,strong (라벨에 그 글자가 들어간 설정만), PROBE_CHARS (위),
// PROBE_PATCH (위). PROBE_STAGES·PROBE_COLS를 주면 이어서 하는 런은 건너뛴다.

const SWEEP_SEEDS_ALL = env.PROBE_SEED_LIST
  ? env.PROBE_SEED_LIST.split(',').map(Number)
  : [11, 2024, 7, 99, 314, 4242, 5150, 8080];
const SWEEP_SEEDS = SWEEP_SEEDS_ALL.slice(0, Math.max(1, Number(env.PROBE_SEEDS) || SWEEP_SEEDS_ALL.length));
/**
 * 보스 테스트 표의 시드: 앞 PROBE_BOSS_SEEDS개(기본 12). 앞 8개는 승률 스윕과 같고, 24개 뒤로는 정해진 식으로 이어 만든다
 * (승률은 시드 하나에 크게 흔들려 — 판 하나 = 12시드에서 8%p — 조정 비교는 PROBE_BOSS_SEEDS=96 정도로)
 */
function bossSeedList(n: number): number[] {
  const base = [11, 2024, 7, 99, 314, 4242, 5150, 8080, 13, 777, 1999, 31337, 42, 123, 2718, 9001, 65, 404, 5555, 8888, 21, 1234, 3141, 6006];
  const out = base.slice(0, n);
  for (let k = base.length; out.length < n; k++) out.push((Math.imul(k + 1, 0x9e3779b1) >>> 0) % 1_000_003);
  return out;
}
const SWEEP_STAGES: number[] | null = env.PROBE_STAGES ? env.PROBE_STAGES.split(',').map(Number) : null;
const SWEEP_COL_FILTER: string[] | null = env.PROBE_COLS ? env.PROBE_COLS.split(',') : null;

interface SweepCol {
  label: string;
  mode: BuildMode;
  aim: 'auto' | 'manual';
  /** 회피 없이 가운데에 가만히 */
  still?: boolean;
  /** 이 스테이지 인덱스 범위에서만 */
  from?: number;
  to?: number;
}

const SWEEP_COLS: SweepCol[] = [
  { label: 'starter auto', mode: 'starter', aim: 'auto' },
  { label: 'starter manual', mode: 'starter', aim: 'manual' },
  { label: 'starter still', mode: 'starter', aim: 'auto', still: true, to: 0 },
  { label: 'raw auto', mode: 'raw', aim: 'auto', to: 0 },
  { label: 'raw manual', mode: 'raw', aim: 'manual', to: 0 },
  { label: 'build auto', mode: 'probe', aim: 'auto', from: 1 },
  { label: 'build manual', mode: 'probe', aim: 'manual', from: 1 },
  { label: 'build still', mode: 'probe', aim: 'auto', still: true, from: 1 },
  // 프로브 상점 + 레벨업을 그리디 평가로 (느리다 — PROBE_GREEDY_COL=1일 때만)
  ...(env.PROBE_GREEDY_COL ? [{ label: 'greedy manual', mode: 'greedy' as const, aim: 'manual' as const, from: 1 }] : []),
  { label: 'build -ice auto', mode: 'noice', aim: 'auto', from: 3 },
  { label: 'build -ice manual', mode: 'noice', aim: 'manual', from: 3 },
  { label: 'build +ice auto', mode: 'ice', aim: 'auto', from: 3 },
  { label: 'build +ice manual', mode: 'ice', aim: 'manual', from: 3 },
  { label: 'strong auto', mode: 'strong', aim: 'auto', from: 1 },
  { label: 'strong manual', mode: 'strong', aim: 'manual', from: 1 },
  { label: 'strong still', mode: 'strong', aim: 'auto', still: true, from: 3 },
];

function aiFor(col: Pick<SweepCol, 'aim' | 'still'>, run: RunState, seed: number): Ai {
  if (col.aim === 'auto') return col.still ? standStill : aiInput;
  const manual = manualAi(seed, guideRadius(runLoadout(data, run)));
  return col.still ? (sim) => ({ ...manual(sim), ...standStill() }) : manual;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 'med (min–max)' — 백분율이면 pctScale 100 */
function spread(xs: number[], scale = 100, unit = '%'): string {
  if (xs.length === 0) return '-';
  const f = (x: number): string => `${Math.round(x * scale)}`;
  return `${f(median(xs))}${unit} (${f(Math.min(...xs))}–${f(Math.max(...xs))})`;
}

const hpLost = (o: Outcome): number => o.taken / o.maxHp;

/** 'lv · skill' 칸: 시작 레벨(중앙값) + 전투 중 레벨업(판당 평균) · 스킬 사용(판당 평균) */
function lvSkill(os: Outcome[]): string {
  if (os.length === 0) return '-';
  const avg = (f: (o: Outcome) => number): number => os.reduce((a, o) => a + f(o), 0) / os.length;
  return `L${median(os.map((o) => o.entryLevel))} +${avg((o) => o.levelUps).toFixed(1)} · ${avg((o) => o.skillUses).toFixed(1)}`;
}

/** 빌드 한 줄 요약 (PROBE_SHOWBUILD): 가방 격자(아이템 머리글자) + 무기 목록 */
function describeRun(run: RunState): string {
  const grid = Array.from({ length: run.bag.rows }, () => new Array<string>(run.bag.cols).fill('.'));
  run.bag.items.forEach((it, i) => {
    const def = items[it.defId];
    const odd = it.rot % 2 === 1;
    const w = odd ? def.h : def.w;
    const h = odd ? def.w : def.h;
    for (let y = it.y; y < it.y + h; y++) for (let x = it.x; x < it.x + w; x++) grid[y][x] = String.fromCharCode(97 + i);
  });
  const legend = run.bag.items.map((it, i) => `${String.fromCharCode(97 + i)}=${it.defId.replace(/^[wsg]_/, '')}${it.tier > 1 ? `★${it.tier}` : ''}`);
  const weapons = runLoadout(data, run).map(
    (l) => `${l.defId.replace(/^w_/, '')}${l.elements.length ? `{${l.elements.join(',')}}` : ''}${l.count > 1 ? `x${l.count}` : ''} ${Math.round((l.damage * l.count) / l.cooldown)}dps`,
  );
  return `[${grid.map((r) => r.join('')).join('/')}] ${legend.join(' ')} | ${weapons.join(', ')}`;
}

/** 보스 직접 피해: 냉기(+25%)가 더한 몫 · 무기별 상위 4개의 몫 (보스가 나온 판 합산) */
function bossShares(os: Outcome[]): string {
  const acc: Record<string, number> = {};
  let total = 0;
  let chill = 0;
  for (const o of os) {
    chill += o.bossChillBonus;
    for (const [k, v] of Object.entries(o.bossByWeapon)) {
      acc[k] = (acc[k] ?? 0) + v;
      total += v;
    }
  }
  if (total <= 0) return '-';
  const top = Object.entries(acc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/^w_/, '')} ${pct(v / total)}`)
    .join(' ');
  return `chill+ ${pct(chill / total)} · ${top}`;
}

/** 받은 피해 출처 상위 3개의 몫 (모든 판 합산): gear = 보스 톱니, dart/12 = 다트총, dart/14 = 곰인형, bolt = 로봇, spring = 깜짝 상자 */
function takenShares(os: Outcome[]): string {
  const acc: Record<string, number> = {};
  let total = 0;
  for (const o of os) {
    for (const [k, v] of Object.entries(o.takenBy)) {
      acc[k] = (acc[k] ?? 0) + v;
      total += v;
    }
  }
  if (total <= 0) return '-';
  return Object.entries(acc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${pct(v / total)}`)
    .join(' ');
}

// ── 이상적인 회피 (공정성 검사) ──────────────────────────────
// 매 스텝 살아있는 적 탄(직선)과 내려오는 적 몸을 IDEAL_HORIZON초 앞까지 예측하고, 바닥 띠(IDEAL_BAND_TOP ~ 맨 아래 — 예전 이동 구역)에 흩은
// 이동 목표 후보마다 그쪽으로 가는 경로가 무엇에도 안 닿는지 본다. 경로는 sim과 똑같은 이동 함수(stepPlayerMotion — 지금 속도에서 가속·
// 최고 속도·도착 감속)로 스텝마다 굴린다(순간이동 없음). 적 몸은 무적 시간에도 피한다(접촉 = 즉시 패배). 집(바닥 가운데)이 안전하면 집으로,
// 지금 목표가 안전하면 그대로, 아니면 안전한 후보 중 가장 여유 있는(40 px까지) 곳. 안전한 후보가 하나도 없던 스텝 = '안 맞는 자리가 없던 순간'(noSafe) —
// 피할 수 없는 탄막. 맞은 피해 중 그 직전 IDEAL_HORIZON초 안에 noSafe가 있었으면 '피할 수 없음', 아니면 '피할 수 있었음'.
// PROBE_IDEAL_REACT=0.25: 생긴 지 0.25초 안 된 탄은 못 본다(사람 반응 시간). PROBE_IDEAL_MOVE=probe: 이동은 프로브 회피 AI(aiInput),
// 이상적인 회피는 옆에서 noSafe만 판정 — 프로브 AI의 최악 3초 피해와 그 피해가 피할 수 있었는지를 본다.
// nochill 열은 매 스텝 모든 적의 냉기를 지워(공격이 늦춰지지 않음 — 보스가 가장 자주 쏘는 경우) 같은 것을 잰다.

const IDEAL_HORIZON = 1.4;
const IDEAL_MARGIN = 6;
const IDEAL_REACT = Number(env.PROBE_IDEAL_REACT ?? 0);
/** 보스 테스트 이상적인 회피의 앞 내다보기: 쏘는 졸개의 탄이 이 시간(초)에 가는 거리 안(총구 앞)에는 되도록 서지 않는다 */
const ANTICIPATE_TIME = 0.6;
/** 이상적인 회피가 쓰는 바닥 띠의 위끝 (예전 이동 구역 FIELD_H - 260). 더 위로는 가지 않아도 늘 안전한 자리가 있는지 본다 */
const IDEAL_BAND_TOP = FIELD_H - 260;
const IDEAL_CANDIDATES: [number, number][] = [];
/** 띠 위(적 사이) 후보 — 띠가 다 막혔을 때만 (y 300 ~ 띠 위끝, 40 px 간격) */
const IDEAL_UPPER_CANDIDATES: [number, number][] = [];
for (let cy = 300; cy < FIELD_H - 260; cy += 40) {
  for (let x = PLAYER_MIN_X; x <= PLAYER_MAX_X + 0.01; x += 16) IDEAL_UPPER_CANDIDATES.push([Math.min(x, PLAYER_MAX_X), cy]);
}
for (let row = 0; row < 5; row++) {
  const cy = IDEAL_BAND_TOP + ((PLAYER_MAX_Y - IDEAL_BAND_TOP) * row) / 4;
  for (let x = X_MIN; x <= X_MAX + 0.01; x += 16) IDEAL_CANDIDATES.push([Math.min(x, X_MAX), cy]);
}

/** react: 생긴 지 이만큼(초) 안 된 탄·위험 지역은 못 본다 (기본 PROBE_IDEAL_REACT) */
function idealDodger(
  /** 경로 예측에 쓰는 이동 속도 — 전투 중 레벨업('가벼운 발걸음')으로 바뀌면 simulateIdeal이 v를 고친다 */
  speed: { v: number },
  descentSpeed: number,
  react = IDEAL_REACT,
  horizon = IDEAL_HORIZON,
  /**
   * 보스 테스트: 쏘는 졸개 앞(로봇 바로 아래 열, 다트총·깜짝 상자 총구 둘레 — 탄이 ANTICIPATE_TIME초에 가는 거리)을 피해 서려 한다.
   * 사람은 졸개 그림을 보고 그 앞에 서지 않는데, 이미 나간 탄만 보는 회피는 쏘기 직전의 졸개 바로 밑에 서 있다가 반응 시간 안에 맞았다.
   * 늘 지키는 규칙은 아니다 — 안전한 자리가 그 안밖에 없으면 그리로 간다(점수만 깎음)
   */
  anticipate = false,
): { ai: Ai; noSafeTimes: number[]; episodes: () => number } {
  const steps = Math.round(horizon / SIM_DT);
  /** anticipate: 쏘는 졸개 앞 [0, x0, y0, x1, y1](로봇 열) 또는 [1, 총구 x, 총구 y, 반경, 0] */
  let keepOut: number[][] = [];
  /** 경로 예측용 (sim의 플레이어와 같은 이동 함수) */
  const ghost: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  const seenAt = new Map<number, number>();
  const noSafeTimes: number[] = [];
  let episodes = 0;
  let wasNoSafe = false;
  let tx = FIELD_W / 2;
  let ty = HOME_Y;
  // 이번 스텝의 위협: 탄 [x, y, vx, vy, 닿는 거리], 적 몸 [x, y, w, h],
  // 보스 위험 지역 [원이면 1, x, y, w, h, 발동 시작, 발동 끝(초, 지금부터)] — 일반 스테이지는 늘 비어 있다
  let shots: number[][] = [];
  let bodies: number[][] = [];
  let hazards: number[][] = [];
  let desc = 0;
  let invuln = 0;
  let px0 = 0;
  let py0 = 0;
  let vx0 = 0;
  let vy0 = 0;
  /** (gx, gy)로 가는 경로(sim 이동 모델)의 최소 여유(px). 음수 = 맞음 / 닿음 (그 자리에서 멈춤) */
  const clearance = (gx: number, gy: number): number => {
    ghost.x = px0;
    ghost.y = py0;
    ghost.vx = vx0;
    ghost.vy = vy0;
    let best = Infinity;
    for (let k = 1; k <= steps; k++) {
      stepPlayerMotion(ghost, gx, gy, true, speed.v, SIM_DT);
      const px = ghost.x;
      const py = ghost.y;
      const t = k * SIM_DT;
      // 무적 동안 지나가는 탄은 안 아프다 (적 몸은 무적과 상관없이 즉시 패배 — 아래에서 늘 본다)
      if (t >= invuln - 1e-9) {
        for (const [x, y, vx, vy, rr] of shots) {
          const c = Math.hypot(x + vx * t - px, y + vy * t - py) - rr;
          if (c < best) {
            best = c;
            if (best < 0) return best;
          }
        }
        for (const [circle, x, y, w, h, t0, t1] of hazards) {
          if (t < t0 - 1e-9 || t > t1 + 1e-9) continue;
          const d = circle
            ? Math.hypot(px - (x + w / 2), py - (y + h / 2)) - w / 2
            : Math.hypot(px - Math.max(x, Math.min(px, x + w)), py - Math.max(y, Math.min(py, y + h)));
          const c = d - (PLAYER_HIT_RADIUS + IDEAL_MARGIN);
          if (c < best) {
            best = c;
            if (best < 0) return best;
          }
        }
      }
      for (const [x, y, w, h] of bodies) {
        const top = y + desc * t;
        const c = Math.hypot(Math.max(x, Math.min(px, x + w)) - px, Math.max(top, Math.min(py, top + h)) - py) - (PLAYER_HIT_RADIUS + IDEAL_MARGIN);
        if (c < best) {
          best = c;
          if (best < 0) return best;
        }
      }
    }
    return best;
  };
  const ai: Ai = (sim) => {
    const pl = sim.player;
    px0 = pl.x;
    py0 = pl.y;
    vx0 = pl.vx;
    vy0 = pl.vy;
    invuln = pl.invuln;
    shots = [];
    for (const s of sim.enemyShots) {
      if (!s.alive) continue;
      if (!seenAt.has(s.id)) seenAt.set(s.id, sim.time);
      if (sim.time - seenAt.get(s.id)! < react - 1e-9) continue;
      const rr = s.radius + pl.hitRadius + IDEAL_MARGIN;
      if (Math.max(s.y, s.y + s.vy * horizon) < IDEAL_BAND_TOP - rr - 10) continue;
      shots.push([s.x, s.y, s.vx, s.vy, rr]);
    }
    hazards = [];
    for (const h of sim.hazards) {
      if (h.state === 'done') continue;
      if (!seenAt.has(h.id)) seenAt.set(h.id, sim.time);
      if (sim.time - seenAt.get(h.id)! < react - 1e-9) continue;
      const t0 = h.state === 'warn' ? h.timer : 0;
      hazards.push([h.shape === 'circle' ? 1 : 0, h.x, h.y, h.w, h.h, t0, t0 + (h.state === 'warn' ? h.activeTime : h.timer)]);
    }
    const visible = sim.enemies.some((e) => e.alive && e.y + e.h > 0);
    desc = descentSpeed * (visible ? 1 : 6);
    bodies = sim.enemies
      .filter((e) => e.alive && e.y + e.h + desc * horizon >= IDEAL_BAND_TOP - 40)
      .map((e) => [e.x, e.y, e.w, e.h]);
    const homeX = FIELD_W / 2;
    if (anticipate) {
      keepOut = [];
      for (const e of sim.enemies) {
        const atk = e.alive && !e.boss ? data.enemies[e.defId]?.attack : undefined;
        if (!atk) continue;
        const reach = atk.projSpeed * ANTICIPATE_TIME;
        if (atk.kind === 'straight') {
          const pad = atk.radius + PLAYER_HIT_RADIUS + IDEAL_MARGIN;
          keepOut.push([0, e.x + e.w / 2 - pad, e.y + e.h, e.x + e.w / 2 + pad, e.y + e.h + reach]);
        } else keepOut.push([1, e.x + e.w / 2, e.y + e.h, reach, 0]);
      }
    }
    // 앞을 내다본 '쏘는 졸개 앞' 자리 (anticipate일 때만 — 아니면 늘 false)
    const exposed = (x: number, y: number): boolean => {
      for (const [circle, a, b, c, d] of keepOut) {
        if (circle ? Math.hypot(x - a, y - b) < c : x > a && x < c && y > b && y < d) return true;
      }
      return false;
    };
    // 안전한 자리 1000+, 그중 쏘는 졸개 앞은 500 깎는다(안전한 다른 자리가 없을 때만 고름). 안 안전하면 여유(음수) 그대로
    const score = (c: number, x: number, y: number): number =>
      c >= 0 ? 1000 + Math.min(c, 40) - 0.02 * Math.hypot(x - homeX, y - HOME_Y) - (exposed(x, y) ? 500 : 0) : c;
    let noSafe = false;
    if (clearance(homeX, HOME_Y) >= 12 && !exposed(homeX, HOME_Y)) {
      tx = homeX;
      ty = HOME_Y;
    } else if (clearance(tx, ty) < 12 || exposed(tx, ty)) {
      let best = score(clearance(pl.x, pl.y), pl.x, pl.y);
      tx = pl.x;
      ty = pl.y;
      for (const [cx, cy] of IDEAL_CANDIDATES) {
        const sc = score(clearance(cx, cy), cx, cy);
        if (sc > best) {
          best = sc;
          tx = cx;
          ty = cy;
        }
      }
      // 바닥 띠에 안전한 자리가 없고 대형이 띠까지 내려와 있으면(방어선 직전) 띠 위 — 적 사이 — 도 본다: 플레이어는 필드 어디든 갈 수 있다.
      // 띠에 안전한 자리가 있으면 예전과 같은 판정 (밸런스 조정으로 대형이 더 깊이 내려오는 판이 생겨 추가)
      if (best + (exposed(tx, ty) ? 500 : 0) < 1000 && bodies.some(([, y, , h]) => y + h + desc * horizon >= IDEAL_BAND_TOP)) {
        for (const [cx, cy] of IDEAL_UPPER_CANDIDATES) {
          const sc = score(clearance(cx, cy), cx, cy);
          if (sc > best) {
            best = sc;
            tx = cx;
            ty = cy;
          }
        }
      }
      // 쏘는 졸개 앞 감점은 빼고 잰다 (anticipate가 아니면 예전과 같은 판정)
      noSafe = best + (exposed(tx, ty) ? 500 : 0) < 1000;
    }
    if (noSafe) {
      noSafeTimes.push(sim.time);
      if (!wasNoSafe) episodes++;
    }
    wasNoSafe = noSafe;
    return { targetX: tx, targetY: ty };
  };
  return { ai, noSafeTimes, episodes: () => episodes };
}

interface IdealOutcome {
  won: boolean;
  status: string;
  deepest: number;
  lostFrac: number;
  bossTime: number | null;
  shotHits: number;
  /** 적 몸에 닿아 진 판 (접촉 = 즉시 패배) */
  contactHits: number;
  noSafeEpisodes: number;
  unavoidable: number;
  avoidable: number;
  /** 3초 안에 잃은 HP의 최댓값 (최대 HP 대비)과 그 순간의 출처·시각·가장 깊은 적 */
  worst3: number;
  worst3Desc: string;
  /** 처음 '안 맞는 자리가 없던' 순간(초) — 없으면 null */
  noSafeAt: number | null;
  /**
   * 그중 '방어선 직전'(살아있는 적 아래 끝이 필드의 NEAR_BREACH 넘게 — 대형이 플레이어 띠 안으로 들어와 몇 초 안에 방어선 패배가 나는 판)에
   * 일어난 '안 맞는 자리가 없던' 구간 수·접촉 패배 수. 공정성 단언은 이것을 뺀 값으로 본다 (이미 진 판 — 탄막이 아니라 적 몸이 바닥을 메운 것)
   */
  noSafeNearBreach: number;
  contactNearBreach: number;
}

/** '방어선 직전': 살아있는 적 아래 끝이 이 비율(필드 높이) 넘게 내려온 순간 — 23~34 px/s 하강이면 4~6초 안에 방어선 패배 */
const NEAR_BREACH = 0.85;

function simulateIdeal(
  source: RunState,
  stageIndex: number,
  seed: number,
  aim: 'auto' | 'manual',
  nochill: boolean,
  probeMove: boolean,
  stage: StageDef = data.stages[stageIndex],
  react = IDEAL_REACT,
  horizon = IDEAL_HORIZON,
  /** 이동 속도 상한 (px/s) — 보스 테스트의 공정성 기준 '걸어서 420 px/s'로 신발·패시브 없이 재 볼 때 */
  speedCap = Infinity,
  /** idealDodger의 anticipate (보스 테스트) */
  anticipate = false,
): IdealOutcome {
  const run = structuredClone(source);
  const stats = runPlayerStats(data, run);
  const player = speedCap < stats.moveSpeed ? { ...stats, moveSpeed: speedCap } : stats;
  const loadout = runLoadout(data, run);
  // 실제 게임처럼 전투 중 레벨업(probeChoice)·스킬(skillAi)도 쓴다 — 둘 다 플레이어를 해치는 경로가 없고, 빠진 채로 재면 실제보다 약한 빌드로
  // 대형이 방어선 바로 위까지 내려와 '안 맞는 자리가 없던' 순간(몸으로 막힘)이 생겼다. PROBE_IDEAL_PLAIN=1이면 예전처럼 둘 다 없이
  const useLevel = LEVELUPS && !env.PROBE_IDEAL_PLAIN;
  const useSkill = SKILLS && !env.PROBE_IDEAL_PLAIN;
  const sim = new CombatSim({
    stage,
    stageIndex,
    enemies: data.enemies,
    bosses: data.bosses,
    loadout,
    player,
    hp: run.hp,
    seed,
    skill: useSkill ? runSkill(data, run) : null,
  });
  const speed = { v: player.moveSpeed };
  const ideal = idealDodger(speed, stage.descentSpeed, react, horizon, anticipate);
  const aimAi = aim === 'manual' ? manualAi(seed, guideRadius(loadout)) : null;
  let dumped = false;
  const hits: { t: number; d: number; src: string; deep: number }[] = [];
  let deepest = 0;
  let bossSeen: number | null = null;
  let bossEnd: number | null = null;
  let shotHits = 0;
  let contactHits = 0;
  let noSafeNearBreach = 0;
  let contactNearBreach = 0;
  let wasNoSafeStep = false;
  let prevShots: EnemyShotEntity[] = [];
  const maxSteps = Math.round(MAX_SIM_SECONDS / SIM_DT);
  for (let i = 0; i < maxSteps && sim.status === 'running'; i++) {
    if (nochill) for (const e of sim.enemies) e.chillTime = 0;
    const nsBefore = ideal.noSafeTimes.length;
    const planned = ideal.ai(sim);
    // 이번 스텝이 '안 맞는 자리가 없던' 구간의 시작인가 — 그때 대형 깊이로 '방어선 직전'인지 가른다
    const nsNow = ideal.noSafeTimes.length > nsBefore;
    if (nsNow && !wasNoSafeStep) {
      let deepLive = 0;
      for (const e of sim.enemies) if (e.alive) deepLive = Math.max(deepLive, e.y + e.h);
      if (deepLive / FIELD_H > NEAR_BREACH) noSafeNearBreach++;
    }
    wasNoSafeStep = nsNow;
    // PROBE_DUMP_NOSAFE=1: 판마다 처음 '안 맞는 자리가 없던' 순간의 장면(플레이어·적 탄·위험 지역·적)을 찍는다 — 무엇이 겹쳤는지 볼 때
    if (env.PROBE_DUMP_NOSAFE && !dumped && ideal.noSafeTimes.length > 0 && ideal.noSafeTimes[ideal.noSafeTimes.length - 1] === sim.time) {
      dumped = true;
      const pl = sim.player;
      const lines = [
        `[noSafe] ${stage.id} seed ${seed} t ${sim.time.toFixed(2)}s player (${pl.x.toFixed(0)}, ${pl.y.toFixed(0)}) v (${pl.vx.toFixed(0)}, ${pl.vy.toFixed(0)})` +
          (sim.boss ? ` boss phase ${sim.boss.phase} ${sim.boss.mode} ${sim.boss.actionId ?? ''}` : ''),
        ...sim.enemyShots.map((s) => `  shot ${s.sprite} (${s.x.toFixed(0)}, ${s.y.toFixed(0)}) v (${s.vx.toFixed(0)}, ${s.vy.toFixed(0)}) r ${s.radius}`),
        ...sim.hazards.map((h) => `  hazard ${h.kind} ${h.state} ${h.timer.toFixed(2)}s (${h.x.toFixed(0)}, ${h.y.toFixed(0)}) ${h.w.toFixed(0)}×${h.h.toFixed(0)}`),
        ...sim.enemies.map((e) => `  enemy ${e.defId} (${e.x.toFixed(0)}, ${e.y.toFixed(0)}) ${e.w}×${e.h}`),
      ];
      console.log(lines.join('\n'));
    }
    const move = probeMove ? aiInput(sim) : planned;
    sim.step(SIM_DT, aimAi ? { ...move, aimAngle: aimAi(sim).aimAngle } : move);
    const before = prevShots;
    prevShots = sim.enemyShots.slice();
    let deepNow = 0;
    for (const e of sim.enemies) {
      if (e.alive) deepNow = Math.max(deepNow, e.y + e.h);
      deepest = Math.max(deepest, e.y + e.h);
      if (e.boss && bossSeen === null && e.y + e.h > 0) bossSeen = sim.time;
    }
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'kill' && useLevel) grantKillXp(data, run, ev.defId);
      if (ev.type === 'kill' && ev.boss) bossEnd = sim.time;
      if (ev.type === 'lost' && ev.reason === 'contact') {
        contactHits++;
        let deepLive = 0;
        for (const e of sim.enemies) if (e.alive) deepLive = Math.max(deepLive, e.y + e.h);
        if (deepLive / FIELD_H > NEAR_BREACH) contactNearBreach++;
      }
      if (ev.type !== 'playerHit') continue;
      let src = '?';
      shotHits++;
      let best = Infinity;
      if (ev.source === 'hazard') src = 'hazard';
      else {
        for (const sh of before) {
          const d = Math.hypot(sh.x - sim.player.x, sh.y - sim.player.y);
          if (!sh.alive && d < best) {
            best = d;
            src = `${sh.sprite.replace(/^shot_/, '')}/${sh.radius}`;
          }
        }
      }
      hits.push({ t: sim.time, d: ev.damage, src, deep: deepNow / FIELD_H });
    }
    if (useLevel && sim.status === 'running' && pendingLevelUps(run) > 0) {
      resolveLevelUps(run);
      const ps = runPlayerStats(data, run);
      const p2 = speedCap < ps.moveSpeed ? { ...ps, moveSpeed: speedCap } : ps;
      sim.setLoadout(runLoadout(data, run), p2);
      speed.v = p2.moveSpeed;
    }
    if (useSkill && skillAi(sim)) sim.activateSkill();
  }
  let unavoidable = 0;
  for (const h of hits) if (ideal.noSafeTimes.some((t) => t <= h.t + 1e-9 && t > h.t - horizon - 1e-9)) unavoidable++;
  let worst = 0;
  let worstDesc = '';
  for (let a = 0; a < hits.length; a++) {
    let sum = 0;
    const srcs: string[] = [];
    for (let b = a; b < hits.length && hits[b].t < hits[a].t + 3; b++) {
      sum += hits[b].d;
      srcs.push(hits[b].src);
    }
    if (sum > worst) {
      worst = sum;
      worstDesc = `${srcs.join('+')} @${hits[a].t.toFixed(0)}s deep${Math.round(hits[a].deep * 100)}%`;
    }
  }
  return {
    won: sim.status === 'won',
    status: sim.status === 'lost' ? `LOST(${sim.lostReason})` : sim.status,
    deepest: deepest / FIELD_H,
    lostFrac: hits.reduce((s, h) => s + h.d, 0) / sim.player.maxHp,
    bossTime: bossSeen === null ? null : (bossEnd ?? sim.time) - bossSeen,
    shotHits,
    contactHits,
    noSafeEpisodes: ideal.episodes(),
    noSafeNearBreach,
    contactNearBreach,
    unavoidable,
    avoidable: hits.length - unavoidable,
    worst3: worst / sim.player.maxHp,
    worst3Desc: worstDesc,
    noSafeAt: ideal.noSafeTimes.length > 0 ? ideal.noSafeTimes[0] : null,
  };
}

describe('balance probe', () => {
  it('runs every stage with a plausible build and logs the outcome', () => {
    // ── 스테이지 구조 ──
    const shapes = data.stages.map(stageShape);
    const shapeRows = data.stages.map((st, i) => {
      const s = shapes[i];
      return [
        st.id,
        `${s.rows} (${(s.rows * CELL) / st.descentSpeed | 0}s)`,
        s.waves.join('+'),
        String(s.enemies),
        `${s.attackers} (${pct(s.attackers / s.enemies)})`,
        String(s.elites),
        String(s.totalHp),
        `${st.descentSpeed} / ×${st.hpMul} / ×${st.dmgMul}`,
        s.killGold.toFixed(1),
        String(st.clearGold),
        (s.killGold + st.clearGold).toFixed(0),
        s.drops.toFixed(1),
        Object.entries(s.special).map(([id, n]) => `${id} ${n}`).join(', ') || '-',
      ];
    });

    // ── 시뮬 ──
    const header = [
      'stage',
      'char',
      'maxHp',
      'dps',
      `build+dodge s${SEEDS[0]}`,
      `build+dodge s${SEEDS[1]}`,
      'build+still',
      'starter only (dodge)',
      'starter raw (dodge)',
      `build manual s${SEEDS[0]}`,
      'starter manual',
      'raw manual',
      'gold/drops',
    ];
    const rows: string[][] = [];
    const buildLog: string[] = [];
    const all: Outcome[] = [];
    /** 스테이지별 프로브 빌드(dodge) 실제 수입 평균: 처치 골드 + 클리어 골드 */
    const measuredIncome: number[] = [];
    const measuredDrops: number[] = [];
    let totalMs = 0;
    let maxProj = 0;
    /** 투사체 밀도 표 (스테이지 × 캐릭터) */
    const projRows: string[][] = [];
    const dens = { starter: [] as Outcome[][], build: [] as Outcome[][], stress: [] as Outcome[][] };

    for (let s = 0; s < data.stages.length; s++) {
      let incomeSum = 0;
      let dropSum = 0;
      dens.starter.push([]);
      dens.build.push([]);
      dens.stress.push([]);
      for (const c of CHARACTERS) {
        const { run, notes } = buildRun(c, s);
        const starter = buildRun(c, s, 'starter').run;
        const raw = buildRun(c, s, 'raw').run;
        const loadout = runLoadout(data, run);
        const describeBuild = (label: string, r: RunState, n: string[]): string =>
          `${label} ${c.padEnd(8)} bag ${r.bag.cols}x${r.bag.rows} dps ${Math.round(sheetDps(runLoadout(data, r)))}` +
          ` weapons [${runLoadout(data, r).map((l) => `${l.defId}${l.tier > 1 ? `★${l.tier}` : ''}${l.elements.length ? `{${l.elements.join(',')}}` : ''}${l.count > 1 ? `x${l.count}` : ''}`).join(' ')}]` +
          ` other [${r.bag.items.filter((it) => data.items[it.defId].kind !== 'weapon').map((it) => it.defId).join(' ')}]` +
          (n.length ? ` notes (L<stage>: = level-ups picked after that stage; merges): ${n.join(', ')}` : '');
        buildLog.push(describeBuild(data.stages[s].id, run, notes));
        if (s > 0) {
          const strong = buildRun(c, s, 'strong');
          buildLog.push(describeBuild(`${data.stages[s].id} strong`, strong.run, strong.notes));
        }
        const results = [
          simulate(run, s, SEEDS[0], aiInput),
          simulate(run, s, SEEDS[1], aiInput),
          simulate(run, s, SEEDS[0], standStill),
          simulate(starter, s, SEEDS[0], aiInput),
          simulate(raw, s, SEEDS[0], aiInput),
          simulate(run, s, SEEDS[0], manualAi(SEEDS[0], guideRadius(loadout))),
          simulate(starter, s, SEEDS[0], manualAi(SEEDS[0], guideRadius(runLoadout(data, starter)))),
          simulate(raw, s, SEEDS[0], manualAi(SEEDS[0], guideRadius(runLoadout(data, raw)))),
        ];
        const stress = stressRun(c, s);
        const stressLoadout = runLoadout(data, stress);
        if (s === 0) {
          const desc = stressLoadout.map(
            (l) => `${l.defId}${l.elements.length ? `{${l.elements.join(',')}}` : ''}${l.count > 1 ? `x${l.count}` : ''}@${l.cooldown.toFixed(2)}s`,
          );
          buildLog.push(`stress   ${c.padEnd(8)} bag 7x6 weapons [${desc.join(' ')}]`);
        }
        const stressResults = [
          simulate(stress, s, SEEDS[0], aiInput),
          simulate(stress, s, SEEDS[0], manualAi(SEEDS[0], guideRadius(stressLoadout))),
        ];
        // 밀도 묶음: build = 프로브 빌드 4판, starter = 시작 무기(정리·합성 / 그대로) 자동·수동, stress = 자동·수동
        dens.build[s].push(results[0], results[1], results[2], results[5]);
        dens.starter[s].push(results[3], results[4], results[6], results[7]);
        dens.stress[s].push(...stressResults);
        projRows.push([
          data.stages[s].id,
          c,
          projCell(results[3]),
          projCell(results[6]),
          projCell(results[0]),
          projCell(results[5]),
          `${stressResults[0].status} ${projCell(stressResults[0])}`,
          `${stressResults[1].status} ${projCell(stressResults[1])}`,
        ]);
        all.push(...results, ...stressResults);
        for (const r of [...results, ...stressResults]) {
          totalMs += r.ms;
          maxProj = Math.max(maxProj, r.maxProj);
        }
        const clear = Math.round(data.stages[s].clearGold * runPlayerStats(data, run).goldMul);
        const dodge = results.slice(0, 2);
        const gold = dodge.reduce((sum, r) => sum + r.gold + (r.won ? clear : 0), 0) / dodge.length;
        const drops = dodge.reduce((sum, r) => sum + r.drops, 0) / dodge.length;
        incomeSum += gold;
        dropSum += drops;
        rows.push([
          data.stages[s].id,
          c,
          String(runPlayerStats(data, run).maxHp),
          String(Math.round(sheetDps(loadout))),
          ...results.map(cell),
          `${gold.toFixed(0)}g ${drops.toFixed(1)}d`,
        ]);
      }
      measuredIncome.push(incomeSum / CHARACTERS.length);
      measuredDrops.push(dropSum / CHARACTERS.length);
    }

    // ── 경제: 상점 i(스테이지 i 전투 전)에서 쓸 수 있는 돈 vs 프로브 빌드 지출 ──
    let expectedBank = 0;
    let measuredBank = 0;
    const econRows = data.stages.map((st, i) => {
      const spend = i === 0 ? 0 : shopSpend(i);
      const row = [
        st.id,
        i === 0 ? '-' : `${expectedBank.toFixed(0)} / ${measuredBank.toFixed(0)}`,
        i === 0 ? '-' : String(spend),
        i === 0 ? '-' : (measuredBank - spend).toFixed(0),
        i === 0 ? '-' : CHARACTERS.map((c) => shopSpend(i, STRONG[c])).join(' / '),
        (shapes[i].killGold + st.clearGold).toFixed(0),
        measuredIncome[i].toFixed(0),
        measuredDrops[i].toFixed(1),
      ];
      expectedBank += shapes[i].killGold + st.clearGold - spend;
      measuredBank += measuredIncome[i] - spend;
      return row;
    });

    console.log(
      `\n[balance probe] stages (rows incl. empty separators; (Ns) = rows×CELL/descent, time for the last row to reach the top edge)\n` +
        table(
          ['stage', 'rows', 'waves', 'enemies', 'attackers', 'elites', 'total HP', 'descent / hp / dmg', 'E[kill g]', 'clear', 'E[income]', 'E[drops]', 'behaving enemies'],
          shapeRows,
        ),
    );
    // 백어택·행동하는 적: 스테이지마다 프로브 빌드 판(자동 회피 2 + 가만히 + 수동)의 판당 평균
    const behaveRows = data.stages.map((st, i) => {
      const os = dens.build[i];
      const per = (f: (o: Outcome) => number): string => (os.reduce((a, o) => a + f(o), 0) / Math.max(1, os.length)).toFixed(1);
      const direct = os.reduce((a, o) => a + o.directHits, 0);
      return [
        st.id,
        `${pct(os.reduce((a, o) => a + o.backHits, 0) / Math.max(1, direct))}`,
        per((o) => o.blocked),
        per((o) => o.healed),
        per((o) => o.blasts),
        per((o) => o.spawned),
        per((o) => o.shifts),
      ];
    });
    console.log(
      `\n[balance probe] back attacks and behaving enemies — build runs (2× auto dodge, still, manual), per run` +
        `\n  back = share of direct hits on an enemy's top face (×BACK_ATTACK_MUL); blocked = shots reflected by a shield's front;` +
        ` healed = HP restored by healers; blasts = bomber death blasts; spawned = splitlings; shifts = RC car side steps\n` +
        table(['stage', 'back', 'blocked', 'healed', 'blasts', 'spawned', 'shifts'], behaveRows),
    );
    // 레벨업·스킬: 스테이지 × 캐릭터마다 프로브 빌드 판(자동 회피 2 + 가만히 + 수동)의 판당 평균
    const levelRows = data.stages.flatMap((st, i) =>
      CHARACTERS.map((c, ci) => {
        const os = dens.build[i].slice(ci * 4, ci * 4 + 4);
        const per = (f: (o: Outcome) => number): string => (os.reduce((a, o) => a + f(o), 0) / Math.max(1, os.length)).toFixed(1);
        return [
          st.id,
          c,
          String(os[0]?.entryLevel ?? '-'),
          per((o) => o.levelUps),
          `${per((o) => o.levelKinds.item)} / ${per((o) => o.levelKinds.upgrade)} / ${per((o) => o.levelKinds.boon)}`,
          per((o) => o.skillUses),
          `${os.filter((o) => o.won).length}/${os.length}`,
        ];
      }),
    );
    console.log(
      `\n[balance probe] level-ups and skills — build runs (2× auto dodge, still, manual), per run` +
        `\n  entry = level at the start of the stage (build pre-picked the level-ups of earlier stages, all enemies killed);` +
        ` level-ups = picked during the fight (item / ★+1 / boon); skill = activations (${LEVELUPS ? 'level-ups on' : 'PROBE_LEVELUP=0'}, ${SKILLS ? 'skills on' : 'PROBE_SKILL=0'})\n` +
        table(['stage', 'char', 'entry lv', 'level-ups', 'item / ★+1 / boon', 'skill uses', 'won'], levelRows),
    );
    console.log(
      `\n[balance probe] economy — bank = gold available at that shop (expected / measured), spend = probe build purchases there` +
        `\n  (drops, sells and rerolls not counted; measured = probe build+dodge average incl. goldMul)\n` +
        table(['stage', 'bank before', 'spend', 'left (measured)', 'strong spend p/c/c', 'E[income]', 'measured income', 'measured drops'], econRows),
    );
    console.log(`\n[balance probe] builds (seed-independent)\n${buildLog.join('\n')}`);
    console.log(
      `\n[balance probe] full HP each stage; dps = Σ damage×count/cooldown (no elements/explode/split/bounces)` +
        `\n  dodge = hold bottom-center, sidestep the nearest threatening shot (spot picked with the sim's walk model: accel + top speed), keep out from under low enemies; still = stand at bottom-center` +
        `\n  auto (default) = sim auto-aim, every shot at the lowest enemy; manual = tap-aim like the live game: re-aim every ${MANUAL_REAIM}s (±${MANUAL_TAP_ERR}° error),` +
        ` thread a gap when the guide passes the front wave robustly (±${MANUAL_GAP_WIN}°), else the lowest enemy; dodge movement` +
        `\n  build = probe purchases + socket fixes/merges; starter only = no purchases, free socket fix/merges` +
        ` (penguin tuna missile, capybara yuzu★2); starter raw = start items untouched (st1 = build = starter only)` +
        `\n  deep = lowest enemy bottom edge reached, % of field height (100% = breach); boss = seconds from boss entering to its death` +
        `\n  gold/drops = kill gold + clear gold and item drops (avg of the two build+dodge runs)\n` +
        table(header, rows) +
        `\n  ${all.length} sims, ${Math.round(totalMs)} ms total, max ${maxProj} live projectiles\n`,
    );

    // ── 투사체 밀도 ──
    const fmt = (os: Outcome[]): string => {
      const d = projSummary(os);
      return (
        `avg ${d.avg.toFixed(1)} peak ${d.peak} | hits/proj ${d.hpp.toFixed(2)} behind ${pct(d.behind)}` +
        ` rattle ${d.rattle.toFixed(1)} age-expired ${pct(d.age)} hits-past-${BOUNCE_CAP_PROBE} ${pct(d.beyondCap)}`
      );
    };
    const densLines = data.stages.map(
      (st, i) =>
        `  ${st.id}  starter ${fmt(dens.starter[i])}\n       build   ${fmt(dens.build[i])}\n       stress  ${fmt(dens.stress[i])}`,
    );
    /** 무기별 평균 살아있는 수 (상위 순): 여러 판 합산 투사체-초 / 합산 전투 시간 */
    const byWeapon = (os: Outcome[]): string => {
      const acc: Record<string, number> = {};
      let t = 0;
      for (const o of os) {
        t += o.time;
        for (const [k, v] of Object.entries(o.projSecByWeapon)) acc[k] = (acc[k] ?? 0) + v;
      }
      return Object.entries(acc)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k.replace(/^w_/, '')} ${(v / Math.max(1e-9, t)).toFixed(1)}`)
        .join(', ');
    };
    const lastStage = data.stages.length - 1;
    const weaponLines = [lastStage - 1, lastStage].flatMap((i) =>
      CHARACTERS.map((c, ci) => `  ${data.stages[i].id} build ${c.padEnd(8)} ${byWeapon(dens.build[i].slice(ci * 4, ci * 4 + 4))}`),
    );
    weaponLines.push(...[2, lastStage].map((i) => `  ${data.stages[i].id} stress (all)    ${byWeapon(dens.stress[i])}`));
    /** 스테이지 전체에서 최대치를 찍은 판의 그 순간 구성 */
    const peakOf = (os: Outcome[]): string => os.reduce((a, b) => (b.maxProj > a.maxProj ? b : a)).peakMix;
    weaponLines.push(`  peak mix: st5 build ${peakOf(dens.build[data.stages.length - 1])}`, `            st5 stress ${peakOf(dens.stress[data.stages.length - 1])}`);
    const sum = (k: keyof typeof dens, i: number): ReturnType<typeof projSummary> => projSummary(dens[k][i]);
    const last = data.stages.length - 1;
    const stressPeak = Math.max(...dens.stress.map((os) => projSummary(os).peak));
    console.log(
      `\n[balance probe] live player projectiles (incl. split children) per run: avg over the fight / peak` +
        `\n  h = direct hits per launched projectile; b = share of direct hits made from behind the front wave (ball above its back edge)` +
        `\n  r = rattle: avg direct hits of balls that hit at least once from behind` +
        `\n  age / cap = share of vanished projectiles that ran out of lifetime / bounces (the rest left through the bottom)` +
        `\n  stress = 7x6 bag, 10 weapons (7 evolved), mirrors + hastes on the fast ones (seed ${SEEDS[0]})\n` +
        table(['stage', 'char', 'starter auto', 'starter manual', 'build auto', 'build manual', 'stress auto', 'stress manual'], projRows) +
        `\n  per stage, all characters (starter = starter/raw × auto/manual, build = the four build runs, stress = auto/manual):\n` +
        densLines.join('\n') +
        `\n  avg live projectiles by weapon (/split = split children):\n${weaponLines.join('\n')}` +
        `\n  targets: st1 starter avg ${sum('starter', 0).avg.toFixed(1)} (≤4) · st3 build avg ${sum('build', 2).avg.toFixed(1)} (≤15)` +
        ` · st5 build avg ${sum('build', last).avg.toFixed(1)} (≤25) peak ${sum('build', last).peak} (≤45) · stress peak ${stressPeak} (≤60)\n`,
    );

    for (const r of all) {
      expect(r.status).not.toBe('TIMEOUT');
      expect(Number.isFinite(r.dealt) && Number.isFinite(r.taken) && Number.isFinite(r.hpLeft)).toBe(true);
    }
  }, 120_000);

  it('win-rate sweep: seeds × characters per stage and build, plus chained runs (HP carried over)', () => {
    // PROBE_CHAIN_ONLY=1: 스테이지 표는 건너뛰고 이어서 하는 런만 (PROBE_CHARS로 캐릭터별 병렬, PROBE_CHAINS=build manual,… 로 런 종류 고르기)
    const chainOnly = !!env.PROBE_CHAIN_ONLY;
    const stageIdx = chainOnly ? [] : data.stages.map((_, i) => i).filter((i) => !SWEEP_STAGES || SWEEP_STAGES.includes(i));
    const rows: string[][] = [];
    const all: Outcome[] = [];
    let ms = 0;
    for (const s of stageIdx) {
      for (const col of SWEEP_COLS) {
        if ((col.from ?? 0) > s || (col.to ?? Infinity) < s) continue;
        if (SWEEP_COL_FILTER && !SWEEP_COL_FILTER.some((f) => col.label.includes(f))) continue;
        const outs: Outcome[] = [];
        const perChar: string[] = [];
        for (const c of CHARACTERS) {
          const run = buildRun(c, s, col.mode).run;
          if (env.PROBE_SHOWBUILD) console.log(`${data.stages[s].id} ${col.label} ${c}: ${describeRun(run)}`);
          const mine: Outcome[] = [];
          for (const seed of SWEEP_SEEDS) {
            const o = simulate(run, s, seed, aiFor(col, run, seed));
            mine.push(o);
            ms += o.ms;
          }
          const won = mine.filter((o) => o.won);
          perChar.push(
            `${won.length}/${mine.length}` +
              (won.length ? ` d${Math.round(median(won.map((o) => o.deepest)) * 100)} h${Math.round(median(won.map(hpLost)) * 100)}` : ''),
          );
          outs.push(...mine);
        }
        all.push(...outs);
        const won = outs.filter((o) => o.won);
        const breach = outs.filter((o) => o.status === 'LOST(breach)').length;
        const dead = outs.filter((o) => o.status === 'LOST(hp)').length;
        const crushed = outs.filter((o) => o.status === 'LOST(contact)').length;
        const boss = won.flatMap((o) => (o.bossTime === null ? [] : [o.bossTime]));
        // 보스 냉기·피해 구성은 이기고 진 판 모두 (보스가 나온 판)
        const withBoss = outs.filter((o) => o.bossChill !== null);
        const bossDmg = withBoss.reduce((sum, o) => sum + o.bossDamage, 0);
        const bossCol = withBoss.length
          ? `${spread(withBoss.map((o) => o.bossChill!))} · ` +
            `${pct(withBoss.reduce((sum, o) => sum + o.bossAboveDamage, 0) / Math.max(1, bossDmg))} / ` +
            `${pct(withBoss.reduce((sum, o) => sum + o.bossGatlingDamage, 0) / Math.max(1, bossDmg))} · ` +
            `${Math.round(median(withBoss.map((o) => o.bossDamage / Math.max(1e-9, o.bossTime ?? 0))))}`
          : '-';
        const volleys = withBoss.reduce((sum, o) => sum + o.bossVolleys, 0);
        const preBoss = withBoss.length
          ? `${spread(withBoss.map((o) => o.takenBeforeBoss / o.maxHp))} · ` +
            `${(withBoss.reduce((sum, o) => sum + o.gearHits, 0) / Math.max(1, volleys)).toFixed(2)} of ${(volleys / withBoss.length).toFixed(0)}`
          : '-';
        rows.push([
          data.stages[s].id,
          col.label,
          `${pct(won.length / outs.length)} (${won.length}/${outs.length})`,
          ...perChar,
          spread(won.map((o) => o.deepest)),
          spread(won.map(hpLost)),
          boss.length ? spread(boss, 1, 's') : '-',
          bossCol,
          preBoss,
          `${Math.round(median(outs.map((o) => o.time)))}s`,
          [breach ? `breach ${breach}` : '', dead ? `hp ${dead}` : '', crushed ? `contact ${crushed}` : ''].filter(Boolean).join(', ') || '-',
          takenShares(outs),
          bossShares(withBoss),
          lvSkill(outs),
        ]);
      }
    }

    // ── 이어서 하는 런: HP를 다음 스테이지로 가져간다 (클리어 회복 30%, 상점에서 HP가 60% 밑이면 회복 50% 구매) ──
    const HEAL_BELOW = 0.6;
    const chainRows: string[][] = [];
    if (chainOnly || (!SWEEP_STAGES && !SWEEP_COL_FILTER)) {
      const chains: { label: string; mode: BuildMode; aim: 'auto' | 'manual' }[] = [
        { label: 'build manual', mode: 'probe', aim: 'manual' },
        { label: 'build auto', mode: 'probe', aim: 'auto' },
        { label: 'strong manual', mode: 'strong', aim: 'manual' },
      ];
      const chainFilter = env.PROBE_CHAINS ? env.PROBE_CHAINS.split(',') : null;
      for (const ch of chains) {
        if (chainFilter && !chainFilter.includes(ch.label)) continue;
        const diedAt = new Array<number>(data.stages.length).fill(0);
        let wins = 0;
        let heals = 0;
        let n = 0;
        const perChar: string[] = [];
        const entryHp: number[][] = data.stages.map(() => []);
        for (const c of CHARACTERS) {
          let cw = 0;
          for (const seed of SWEEP_SEEDS) {
            n++;
            let hp = Infinity;
            let won = true;
            for (let s = 0; s < data.stages.length; s++) {
              const run = buildRun(c, s, s === 0 ? 'starter' : ch.mode).run;
              const maxHp = runPlayerStats(data, run).maxHp;
              if (s > 0 && hp < HEAL_BELOW * maxHp) {
                hp = Math.min(maxHp, hp + Math.round(maxHp * 0.5));
                heals++;
              }
              run.hp = Math.min(hp, maxHp);
              entryHp[s].push(run.hp / maxHp);
              const simSeed = (seed * 31 + s * 7919) >>> 0;
              const o = simulate(run, s, simSeed, aiFor({ aim: ch.aim }, run, simSeed));
              ms += o.ms;
              if (!o.won) {
                diedAt[s]++;
                won = false;
                break;
              }
              hp = Math.min(o.maxHp, o.hpLeft + Math.round(o.maxHp * 0.3));
            }
            if (won) {
              wins++;
              cw++;
            }
          }
          perChar.push(`${cw}/${SWEEP_SEEDS.length}`);
        }
        chainRows.push([
          ch.label,
          `${pct(wins / n)} (${wins}/${n})`,
          ...perChar,
          data.stages.map((st, i) => `${st.id} ${diedAt[i]}`).join(', '),
          data.stages.map((st, i) => (entryHp[i].length ? `${st.id} ${Math.round(median(entryHp[i]) * 100)}%` : '')).join(' '),
          (heals / n).toFixed(1),
        ]);
      }
    }

    console.log(
      `\n[win-rate sweep] ${SWEEP_SEEDS.length} seeds × ${CHARACTERS.length} characters per row, full HP each stage` +
        `\n  per character: wins/runs, median deepest % and HP lost % (of max) over won runs` +
        `\n  deep / hp lost / boss = median (min–max) over won runs; time = median stage time; losses = breach / hp / contact (touched an enemy body = instant loss)` +
        `\n  build = probe purchases (PROGRESSION), strong = STRONG per character; still = no dodging (auto aim)` +
        `\n  build -ice / +ice = build + one more element stone at the st4 shop: lightning (and the st5 ice stone → lightning:` +
        ` no melon bingsu — the shop never offered ice; penguin keeps his start ice stone = tuna missile) / ice (on a fast weapon; st5 still has the bingsu)` +
        `\n  boss chill · above / gatling · dps = boss chilled share of its on-screen time, median (min–max) · share of boss damage from direct hits` +
        ` on its top face (balls above the boss) / from sock gatling direct hits · median boss damage per second — over all runs that reached the boss` +
        `\n  pre-boss hp lost = HP lost (of max) before the boss came on screen, median (min–max) · gear hits per boss volley` +
        ` (5 gears; a gear passing during invulnerability doesn't count) of boss volleys per run (avg)` +
        `\n  damage taken from = top 3 sources of all HP lost in the row (gear = boss, dart/12 = dart gun, dart/14 = teddy, bolt = robot, spring = jack)` +
        `\n  boss direct damage = share of projectile direct damage on the boss added by chill (+25%) · top 4 weapons` +
        `\n  lv · skill = start level (median) + level-ups picked in the fight (avg) · skill activations (avg)\n` +
        table(
          [
            'stage', 'config', 'win', ...CHARACTERS, 'deep', 'hp lost', 'boss', 'boss chill · above / gatling · dps',
            'pre-boss hp lost · gear hits/volley of volleys', 'time', 'losses', 'damage taken from',
            'boss direct damage: chill bonus · by weapon',
            'lv · skill',
          ],
          rows,
        ) +
        (chainRows.length
          ? `\n\n[chained runs] st1 starter → st5, HP carried over: +30% on clear, buy the 50% heal (10g) when HP < ${HEAL_BELOW * 100}% at the shop\n` +
            table(['run', 'run win', ...CHARACTERS, 'died at', 'median entry HP', 'heals/run'], chainRows)
          : '') +
        `\n  ${all.length} sweep sims + chains, ${Math.round(ms)} ms\n`,
    );
    for (const r of all) expect(r.status).not.toBe('TIMEOUT');
  }, 3_600_000);

  // 공정성: PROBE_IDEAL=1 npx vitest run tests/balance.probe.test.ts -t ideal --silent=false (+ PROBE_SEEDS·PROBE_SEED_LIST·PROBE_STAGES·
  // PROBE_CHARS·PROBE_PATCH, PROBE_IDEAL_REACT, PROBE_IDEAL_MOVE=probe). 시드 16개 × 캐릭터 3 전체 약 70초.
  it.runIf(!!env.PROBE_IDEAL)('ideal dodger: unavoidable hits and worst 3 s damage per stage × build (chilled / never chilled)', () => {
    const probeMove = env.PROBE_IDEAL_MOVE === 'probe';
    const rows: string[][] = [];
    const all: IdealOutcome[] = [];
    const modes: BuildMode[] = ['starter', 'probe', 'noice', 'ice', 'strong'];
    for (let s = 0; s < data.stages.length; s++) {
      if (SWEEP_STAGES && !SWEEP_STAGES.includes(s)) continue;
      for (const mode of modes) {
        if (mode === 'starter' ? s > 0 : mode === 'noice' || mode === 'ice' ? s < 3 : s === 0) continue;
        for (const nochill of [false, true]) {
          for (const aim of ['auto', 'manual'] as const) {
            const outs: IdealOutcome[] = [];
            const perChar: string[] = [];
            for (const c of CHARACTERS) {
              const run = buildRun(c, s, mode).run;
              const mine = SWEEP_SEEDS.map((seed) => simulateIdeal(run, s, seed, aim, nochill, probeMove));
              perChar.push(`${mine.filter((o) => o.won).length}/${mine.length}`);
              outs.push(...mine);
            }
            all.push(...outs);
            const won = outs.filter((o) => o.won);
            const worst = outs.reduce((a, b) => (b.worst3 > a.worst3 ? b : a));
            const boss = won.flatMap((o) => (o.bossTime === null ? [] : [o.bossTime]));
            const losses = outs.filter((o) => !o.won).map((o) => o.status);
            const sum = (f: (o: IdealOutcome) => number): number => outs.reduce((a, o) => a + f(o), 0);
            rows.push([
              data.stages[s].id,
              `${mode}${nochill ? ' nochill' : ''} ${aim}`,
              `${pct(won.length / outs.length)} (${perChar.join(' ')})`,
              won.length ? `${pct(median(won.map((o) => o.deepest)))} / ${pct(median(won.map((o) => o.lostFrac)))}${boss.length ? ` / ${median(boss).toFixed(0)}s` : ''}` : '-',
              `${(sum((o) => o.shotHits) / outs.length).toFixed(2)} / ${(sum((o) => o.contactHits) / outs.length).toFixed(2)}`,
              `${sum((o) => o.noSafeEpisodes)} · ${sum((o) => o.unavoidable)} / ${sum((o) => o.avoidable)}` +
                (sum((o) => o.noSafeNearBreach + o.contactNearBreach) > 0 ? ` (near-breach ${sum((o) => o.noSafeNearBreach)} / ${sum((o) => o.contactNearBreach)})` : ''),
              `${pct(worst.worst3)}${worst.worst3 > 0 ? ` (${worst.worst3Desc})` : ''} · med ${pct(median(outs.map((o) => o.worst3)))}`,
              [...new Set(losses)].map((k) => `${k} ${losses.filter((x) => x === k).length}`).join(', ') || '-',
            ]);
          }
        }
      }
    }
    console.log(
      `\n[ideal dodger] ${SWEEP_SEEDS.length} seeds × ${CHARACTERS.length} characters, look-ahead ${IDEAL_HORIZON}s, reaction ${IDEAL_REACT}s,` +
        ` movement = ${probeMove ? 'probe dodge AI (ideal planner only judges noSafe)' : 'ideal planner'}; nochill = chill wiped every step` +
        `\n  won: deep / hp lost / boss = medians over won runs; hits/run = enemy shots / contact losses (touching an enemy body ends the run)` +
        `\n  noSafe · unavoidable / avoidable = steps with no safe target (episodes) · hits with / without a noSafe step in the ${IDEAL_HORIZON}s before` +
        `\n  worst 3 s = max HP lost within 3 s (of max HP) over all runs (sources, time, deepest enemy) · median over runs\n` +
        table(['stage', 'config', 'win', 'deep / hp lost / boss', 'hits/run shot / contact loss', 'noSafe · unavoidable / avoidable', 'worst 3 s', 'losses'], rows),
    );
    // 피할 수 없는 탄막이 없어야 한다 (반응 시간 0, 이상적인 이동일 때). 적 몸에 닿아 지는 일도 없어야 한다.
    // '방어선 직전'(대형 아래 끝이 필드의 NEAR_BREACH 넘게 — 이미 몇 초 안에 방어선으로 지는 판)에서 대형 몸이 바닥 띠를 메워 생긴 것은 빼고 본다
    // (네 번째 조정 뒤 적 체력이 ~3배라 진 판에서 대형이 바닥까지 내려오는 일이 생겼다 — 표의 near-breach 칸에 따로 센다)
    if (!probeMove && IDEAL_REACT === 0) {
      for (const o of all) {
        expect(o.noSafeEpisodes - o.noSafeNearBreach).toBe(0);
        expect(o.contactHits - o.contactNearBreach).toBe(0);
      }
    }
  }, 3_600_000);
  // ── 보스 테스트 (타이틀 '보스 테스트' → 캐릭터별 프리셋 가방으로 '장난감 상자 대마왕' 한 판) ──
  // 캐릭터 × 시드 × 자동·수동 조준 × 회피·가만히, 그리고 이상적인 회피(앞 2.2초 예측)로 '피할 수 없는 공격'이 있는지.
  // 시드: bossSeedList — 앞 PROBE_BOSS_SEEDS개(기본 12), PROBE_SEED_LIST를 주면 그 목록. 이상적인 회피는 그 앞 PROBE_BOSS_IDEAL_SEEDS개
  // (기본 6 — 4설정 × 3캐릭터 = 72판, 약 20초. 조정을 끝낼 땐 PROBE_BOSS_SEEDS=24 PROBE_BOSS_IDEAL_SEEDS=24로 288판 전부 확인).
  // PROBE_CHARS·PROBE_PATCH(enemies·items·characters) 적용. 조정 목표는 docs/DESIGN.md '보스 테스트 모드 — 조정'.
  // 보기: npx vitest run tests/balance.probe.test.ts -t "boss test" --silent=false
  // 이상적인 회피(4설정 모두)는 피할 수 없는 피해·접촉 패배가 0이어야 한다 — 늘 단언한다(결정적).
  // 보스 이상적인 회피는 쏘는 졸개 앞에 되도록 서지 않는다(idealDodger anticipate — 사람은 졸개를 보고 피한다)
  it('boss test: preset builds vs the boss (characters × seeds, auto/manual aim × dodge/still, ideal dodger fairness)', () => {
    const stage = data.bossTest.stage;
    const bossDef = data.bosses[stage.boss!];
    const nBossSeeds = Math.max(1, Number(env.PROBE_BOSS_SEEDS) || 12);
    const BOSS_SEEDS = env.PROBE_SEED_LIST ? SWEEP_SEEDS_ALL.slice(0, nBossSeeds) : bossSeedList(nBossSeeds);
    const rows: string[][] = [];
    const buildLines: string[] = [];
    const all: Outcome[] = [];
    const summary: string[] = [];
    let ms = 0;
    // lane camp = 보스 옆 통로 캠핑 꼼수 (laneCamper — 왼쪽 통로 위쪽에서 거의 수직으로만 쏜다). still = 가만히, smart = 위험 지역만 피했다 돌아옴
    const cols: { label: string; aim: 'auto' | 'manual'; still: boolean; ai?: () => Ai }[] = [
      { label: 'auto dodge', aim: 'auto', still: false },
      { label: 'manual dodge', aim: 'manual', still: false },
      { label: 'auto still', aim: 'auto', still: true },
      { label: 'manual still', aim: 'manual', still: true },
      { label: 'lane camp still', aim: 'manual', still: true, ai: () => laneCamper(false) },
      { label: 'lane camp smart', aim: 'manual', still: false, ai: () => laneCamper(true) },
    ];
    const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    const lossText = (outs: Outcome[]): string =>
      ['LOST(hp)', 'LOST(breach)', 'LOST(contact)', 'TIMEOUT']
        .map((k) => [k.replace(/^LOST\((.*)\)$/, '$1'), outs.filter((o) => o.status === k).length] as const)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ');
    for (const c of CHARACTERS) {
      const run = newBossTestRun(data, c, 7);
      const ps = runPlayerStats(data, run);
      buildLines.push(
        `  ${c.padEnd(8)} maxHp ${ps.maxHp} regen ${ps.regenPerSec}/s speed ${Math.round(ps.moveSpeed)} sheet dps ${Math.round(sheetDps(runLoadout(data, run)))} ${describeRun(run)}`,
      );
      const byCol: Record<string, Outcome[]> = {};
      for (const col of cols) {
        const outs: Outcome[] = [];
        for (const seed of BOSS_SEEDS) {
          const o = simulate(run, 0, seed, col.ai ? col.ai() : aiFor(col, run, seed), stage);
          outs.push(o);
          ms += o.ms;
        }
        byCol[col.label] = outs;
        all.push(...outs);
        const won = outs.filter((o) => o.won);
        const phases = bossDef.phases.map((_, i) => outs.filter((o) => o.phaseMax === i).length);
        const bossDmg = outs.reduce((a, o) => a + o.bossDamage, 0);
        const direct = outs.reduce((a, o) => a + o.directHits, 0);
        rows.push([
          c,
          col.label,
          `${pct(won.length / outs.length)} (${won.length}/${outs.length})`,
          won.length ? spread(won.map((o) => o.time), 1, 's') : '-',
          won.length ? `${spread(won.map(hpLost))} · ${pct(median(won.map((o) => o.hpLeft / o.maxHp)))}` : '-',
          phases.map((n, i) => `p${i + 1}:${n}`).join(' '),
          String(Math.round(median(outs.map((o) => o.bossDamage / Math.max(1e-9, o.bossTime ?? o.time))))),
          `${avg(outs.map((o) => o.bossTopHits)).toFixed(0)} · ${pct(outs.reduce((a, o) => a + o.bossAboveDamage, 0) / Math.max(1, bossDmg))}`,
          `${avg(outs.map((o) => o.minionAvg)).toFixed(1)} / ${Math.max(...outs.map((o) => o.minionPeak))} · ` +
            `${avg(outs.map((o) => o.summoned)).toFixed(0)} / ${avg(outs.map((o) => o.minionKills)).toFixed(0)} · ` +
            `${pct(outs.reduce((a, o) => a + o.minionDirectHits, 0) / Math.max(1, direct))} · ${pct(median(outs.map((o) => o.minionDeepest)))}`,
          `${avg(outs.map((o) => o.hazardHits)).toFixed(2)} / ${avg(outs.map((o) => o.shotHits)).toFixed(2)}`,
          takenShares(outs),
          lossText(outs) || '-',
          lvSkill(outs),
        ]);
      }
      const rate = (labels: string[]): string => {
        const os = labels.flatMap((l) => byCol[l]);
        return `${pct(os.filter((o) => o.won).length / os.length)}`;
      };
      const md = byCol['manual dodge'];
      summary.push(
        `  ${c.padEnd(8)} manual dodge win ${rate(['manual dodge'])} (${lossText(md) || 'no losses'}), ` +
          `won fight ${md.some((o) => o.won) ? median(md.filter((o) => o.won).map((o) => o.time)).toFixed(0) : '-'}s · ` +
          `auto dodge win ${rate(['auto dodge'])} · still win ${rate(['auto still', 'manual still'])}` +
          ` · lane camp still / smart win ${rate(['lane camp still'])} / ${rate(['lane camp smart'])}` +
          ` (won fight ${['lane camp still', 'lane camp smart'].map((l) => (byCol[l].some((o) => o.won) ? median(byCol[l].filter((o) => o.won).map((o) => o.time)).toFixed(0) : '-')).join(' / ')}s)`,
      );
    }
    const dodgeLosses = all.filter((o, i) => !o.won && Math.floor(i / BOSS_SEEDS.length) % cols.length < 2);
    const breachShare = dodgeLosses.length ? dodgeLosses.filter((o) => o.status === 'LOST(breach)').length / dodgeLosses.length : 0;

    // 공정성: 이상적인 회피(앞 BOSS_IDEAL_HORIZON초 예측, 바닥 띠)로 '안 맞는 자리가 하나도 없던' 순간이 있는가.
    // 반응 0 + 자동 조준(기준선) / 반응 0.25초 + 수동 조준(냉기 있음·없음, 이동 속도 상한 420 px/s — 신발·패시브 없이 걸어서)
    const BOSS_IDEAL_SEEDS = BOSS_SEEDS.slice(0, Math.max(1, Number(env.PROBE_BOSS_IDEAL_SEEDS) || 6));
    // 보스 탄은 느리고 멀리서 온다(입 → 바닥 약 2초) — 앞을 1.4초만 보면 빈틈·부채꼴 밖으로 갈 시간을 늦게 알아챈다. 기본 2.2초 (PROBE_BOSS_IDEAL_HORIZON)
    const BOSS_IDEAL_HORIZON = Number(env.PROBE_BOSS_IDEAL_HORIZON ?? 2.2);
    const idealConfigs: { label: string; react: number; aim: 'auto' | 'manual'; nochill: boolean; cap: number }[] = [
      { label: 'react 0 auto', react: 0, aim: 'auto', nochill: false, cap: Infinity },
      { label: 'react 0.25 manual', react: 0.25, aim: 'manual', nochill: false, cap: Infinity },
      { label: 'react 0.25 manual nochill', react: 0.25, aim: 'manual', nochill: true, cap: Infinity },
      { label: 'react 0.25 manual 420px/s', react: 0.25, aim: 'manual', nochill: false, cap: 420 },
    ];
    const idealRows: string[][] = [];
    const idealAll: IdealOutcome[] = [];
    for (const ic of idealConfigs) {
      const outs: IdealOutcome[] = [];
      const perChar: string[] = [];
      /** '안 맞는 자리가 없던' 판: 캐릭터 시드@처음 시각 */
      const noSafeRuns: string[] = [];
      for (const c of CHARACTERS) {
        const run = newBossTestRun(data, c, 7);
        const mine = BOSS_IDEAL_SEEDS.map((seed) =>
          simulateIdeal(run, 0, seed, ic.aim, ic.nochill, false, stage, ic.react, BOSS_IDEAL_HORIZON, ic.cap, true),
        );
        perChar.push(`${mine.filter((o) => o.won).length}/${mine.length}`);
        mine.forEach((o, i) => {
          if (o.noSafeAt !== null) noSafeRuns.push(`${c} s${BOSS_IDEAL_SEEDS[i]}@${o.noSafeAt.toFixed(1)}s`);
        });
        outs.push(...mine);
      }
      idealAll.push(...outs);
      const won = outs.filter((o) => o.won);
      const worst = outs.reduce((a, b) => (b.worst3 > a.worst3 ? b : a));
      const sum = (f: (o: IdealOutcome) => number): number => outs.reduce((a, o) => a + f(o), 0);
      const lossKinds = outs.filter((o) => !o.won).map((o) => o.status);
      idealRows.push([
        ic.label,
        `${pct(won.length / outs.length)} (${perChar.join(' ')})`,
        won.length
          ? `${pct(median(won.map((o) => o.lostFrac)))} (max ${pct(Math.max(...won.map((o) => o.lostFrac)))}) / ${median(won.map((o) => o.bossTime ?? 0)).toFixed(0)}s`
          : '-',
        `${(sum((o) => o.shotHits) / outs.length).toFixed(2)} / ${(sum((o) => o.contactHits) / outs.length).toFixed(2)}`,
        `${sum((o) => o.noSafeEpisodes)} · ${sum((o) => o.unavoidable)} / ${sum((o) => o.avoidable)}` +
          (noSafeRuns.length ? ` (${noSafeRuns.join(' ')})` : ''),
        `${pct(worst.worst3)}${worst.worst3 > 0 ? ` (${worst.worst3Desc})` : ''}`,
        [...new Set(lossKinds)].map((k) => `${k} ${lossKinds.filter((x) => x === k).length}`).join(', ') || '-',
      ]);
    }

    const be = data.enemies[bossDef.enemy];
    console.log(
      `\n[boss test] ${stage.id} '${stage.name}' — boss ${bossDef.id} (${be.hp} hp × ${stage.hpMul} = ${Math.round(be.hp * stage.hpMul)}),` +
        ` phases at ${bossDef.phases.map((p) => pct(p.hpFrac)).join(' / ')}, minion descent ${stage.descentSpeed} px/s, hp ×${stage.hpMul} dmg ×${stage.dmgMul};` +
        ` ${BOSS_SEEDS.length} seeds per row, full HP, preset bags:\n${buildLines.join('\n')}` +
        `\n  time = median (min–max) over won runs; hp lost · left = HP lost (gross, of max — regen not subtracted) median (min–max) · HP left median, won runs;` +
        ` phases = runs whose last phase was pN (p1 = first)` +
        `\n  boss dps = median boss damage per second on screen; top hits · share = direct hits on the boss top face (ball above the boss — the` +
        ` side-lane 'back attack') per run · their share of boss damage` +
        `\n  minions = avg alive / peak · summoned / killed per run · share of player direct hits taken by minions (shield) · median deepest minion bottom (100% = breach)` +
        `\n  hits/run = hazard (slam / marble) / enemy shot hits; still = stand at bottom-center (no dodging)` +
        `\n  lv · skill = start level + level-ups picked in the fight from minion kills (avg) · skill activations (avg)\n` +
        table(
          [
            'char',
            'config',
            'win',
            'time',
            'hp lost · left',
            'phases',
            'boss dps',
            'top hits · share',
            'minions avg/peak · summoned/killed · shield · deep',
            'hits/run hazard / shot',
            'damage taken from',
            'losses',
            'lv · skill',
          ],
          rows,
        ) +
        `\n${summary.join('\n')}` +
        `\n  breach share of dodge losses (auto + manual dodge): ${pct(breachShare)} (${dodgeLosses.length} losses)` +
        `\n\n[boss test] ideal dodger (${BOSS_IDEAL_SEEDS.length} seeds × ${CHARACTERS.length} characters, look-ahead ${BOSS_IDEAL_HORIZON}s,` +
        ` sees shots and hazards after the reaction time; nochill = chill wiped every step; 420px/s = move speed capped at 420)\n` +
        table(['config', 'win', 'hp lost (max) / boss fight', 'hits/run / contact loss', 'noSafe · unavoidable / avoidable', 'worst 3 s', 'losses'], idealRows) +
        `\n  ${all.length} sims + ${idealAll.length} ideal, ${Math.round(ms)} ms\n`,
    );
    for (const o of all) {
      expect(o.status).not.toBe('TIMEOUT');
      expect(Number.isFinite(o.taken) && Number.isFinite(o.hpLeft)).toBe(true);
    }
    // 이상적인 회피는 피할 수 없는 피해(맞기 직전 앞 예측 시간 안에 '안 맞는 자리가 없던' 순간)·접촉 패배가 없어야 한다.
    // noSafe 순간 자체(맞지 않음)는 표에만 — 장면은 PROBE_DUMP_NOSAFE=1로 본다
    for (const o of idealAll) {
      expect(o.unavoidable).toBe(0);
      expect(o.contactHits).toBe(0);
    }
  }, 3_600_000);

  // ── 레벨업 선택지 분석: 그리디 평가 (PROBE_GREEDY=1 npx vitest run tests/balance.probe.test.ts -t greedy --silent=false) ──
  // 캐릭터 × 런 시드(PROBE_GREEDY_RUNS — 레벨업 선택지 운)마다 프로브 빌드(PROGRESSION 상점)로 st1 → st5를 쌓으며 앞 스테이지의 레벨업을
  // 모두 greedyChooser로 고른다(선택지마다 그 선택 + 바로 다음 상점 구매로 다음 전투를 시드 PROBE_GREEDY_SEEDS판, 수동 조준 회피 AI). 표:
  //  - 다음 전투 스테이지별: 선택 수 · 고른 종류 비율(새 아이템 무기/돌/장비 · ★ + 1 무기/그 밖 · 런 보너스) · 프로브 AI(probeChoice)와 같은 선택 · 1등과 2등 점수 차 중앙값
  //  - 종류별·보너스별: 나온 선택 수 · 고른 수 · 나왔을 때 고른 비율 (한 보너스가 나오기만 하면 늘 이기면 '지배')
  it.runIf(!!env.PROBE_GREEDY)('level-up choices: greedy evaluator (pick mix by kind, boon pick rates)', () => {
    const runSeeds = (env.PROBE_GREEDY_RUNS ?? '7,21,99,1234,4242,8080').split(',').map(Number);
    const evalSeeds = (env.PROBE_GREEDY_SEEDS ?? '11,2024').split(',').map(Number);
    const log: GreedyPick[] = [];
    const finals: string[] = [];
    const last = data.stages.length - 1;
    for (const c of CHARACTERS) {
      for (const rs of runSeeds) {
        const { run } = buildRun(c, last, 'probe', { seed: rs, chooseFor: (next, shop) => greedyChooser(next, shop, evalSeeds, log) });
        finals.push(`  ${c.padEnd(8)} run ${String(rs).padEnd(5)} L${runLevel(run)} boons ${JSON.stringify(run.boons ?? {})} | ${describeRun(run)}`);
      }
    }
    const kindOf = (c: LevelUpChoice): string =>
      c.kind === 'boon' ? 'boon' : c.kind === 'upgrade' ? (items[c.defId].kind === 'weapon' ? '★+1 weapon' : '★+1 other') : `item ${items[c.defId].kind}`;
    const KINDS = ['item weapon', 'item stone', 'item gear', '★+1 weapon', '★+1 other', 'boon'];
    const margin = (p: GreedyPick): number => {
      const sc = [...p.scores].sort((a, b) => b - a);
      return sc[0] - (sc[1] ?? sc[0]);
    };
    const mixRow = (label: string, ps: GreedyPick[]): string[] => {
      const picked = ps.map((p) => kindOf(p.offer[p.pick]));
      const n = Math.max(1, ps.length);
      return [
        label,
        String(ps.length),
        ...KINDS.map((k) => pct(picked.filter((x) => x === k).length / n)),
        pct(ps.filter((p) => p.offer[p.pick].kind === 'item' && !p.fits[p.pick]).length / n),
        pct(ps.filter((p) => p.pick === p.probe).length / n),
        ps.length ? median(ps.map(margin)).toFixed(3) : '-',
      ];
    };
    const stageRows: string[][] = [];
    for (let st = 1; st <= last; st++) {
      const ps = log.filter((p) => p.stage === st);
      if (ps.length > 0) stageRows.push(mixRow(`L${st} → ${data.stages[st].id}`, ps));
    }
    stageRows.push(mixRow('all', log));
    const rateRow = (label: string, has: (c: LevelUpChoice) => boolean): string[] => {
      const offered = log.filter((p) => p.offer.some(has));
      const picked = offered.filter((p) => has(p.offer[p.pick]));
      return [label, String(offered.length), String(picked.length), offered.length ? pct(picked.length / offered.length) : '-'];
    };
    const kindRows = KINDS.map((k) => rateRow(k, (c) => kindOf(c) === k));
    const boonRows = Object.keys(data.boons).map((id) => rateRow(`boon ${id}`, (c) => c.kind === 'boon' && c.boon === id));
    const itemCounts: Record<string, number> = {};
    for (const p of log) {
      const c = p.offer[p.pick];
      if (c.kind !== 'boon') {
        const k = `${c.kind === 'upgrade' ? '★' : '+'}${c.defId.replace(/^[wsg]_/, '')}`;
        itemCounts[k] = (itemCounts[k] ?? 0) + 1;
      }
    }
    console.log(
      `\n[level-up greedy] ${CHARACTERS.length} characters × ${runSeeds.length} run seeds, probe shop purchases, every level-up of st1–st${last} picked by a greedy evaluator:` +
        `\n  each choice applied (+ the next shop's purchases) and the next stage simulated (${evalSeeds.length} seeds, manual-aim dodge AI, no further level-ups);` +
        `\n  score = won + 0.5·HP left + 0.5·(1 − deepest) + 0.5·kill share − 0.002·seconds; agree = same pick as the probe AI's fixed rule; margin = best − 2nd score (median)\n` +
        table(['level-ups', 'picks', ...KINDS, 'item → stash', 'agree probe AI', 'margin'], stageRows) +
        `\n\n  pick rate when offered (an offer counts once per kind):\n` +
        table(['choice', 'offered', 'picked', 'pick rate'], [...kindRows, ...boonRows]) +
        `\n  items picked: ${Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}` +
        `\n  final builds (st5):\n${finals.join('\n')}\n`,
    );
    expect(log.length).toBeGreaterThan(0);
  }, 3_600_000);

  // ── 시너지 조합 분석 (PROBE_SYNERGY=1 npx vitest run tests/balance.probe.test.ts -t "synergy combos" --silent=false) ──
  // 프로브 빌드의 st4·st5 상점 구매(토스터 + 불 속성석 / 수박 + 얼음 속성석 + 공격 강화석, 합 72골드)를 비슷한 돈의 시너지 조합으로 바꿔
  // st4·st5를 돌린다(시드 × 캐릭터, 수동·자동 회피, 가만히). 같은 시드의 generic(바꾸지 않음)·strong(잘하는 사람)과 비교 —
  // 조합 하나가 승률·시간·가장 깊은 적을 strong보다 크게 좋게 만들면 '판을 깨는' 조합이다. 밀도(살아있는 투사체 평균/최대)도 함께.
  it.runIf(!!env.PROBE_SYNERGY)('synergy combos: shop combos vs the generic build (st4, st5)', () => {
    const A = (...ids: string[]): Addition[] => ids.map((defId) => ({ defId }));
    const combos: { name: string; shop3: Addition[]; shop4: Addition[] }[] = [
      { name: 'generic', shop3: PROGRESSION[3].add, shop4: PROGRESSION[4].add },
      { name: 'trampoline+seed+mirror', shop3: A('g_trampoline', 's_seed'), shop4: A('s_mirror', 's_seed') },
      { name: 'rubber+hammer', shop3: A('s_rubber', 's_hammer', 's_rubber'), shop4: A('s_hammer', 's_rubber', 's_ribbon') },
      { name: 'kettle+fire/ice', shop3: A('g_kettle', 's_ice', 's_fire'), shop4: A('w_watermelon', 's_ice', 's_match') },
      { name: 'firecracker x2', shop3: A('g_firecracker', 's_power', 's_haste'), shop4: A('g_firecracker', 'w_watermelon') },
      { name: 'coil+lightning', shop3: A('s_lightning', 's_coil', 's_coil'), shop4: A('s_lightning', 's_coil', 's_mirror') },
      { name: 'ribbon+wheel+mushroom', shop3: A('s_wheel', 's_mushroom', 's_mushroom'), shop4: A('s_ribbon', 's_wheel', 's_mushroom') },
      { name: 'match+seed', shop3: A('s_match', 's_seed', 's_power'), shop4: A('s_match', 's_seed', 'g_firecracker') },
    ];
    const comboFilter = env.PROBE_COMBOS ? env.PROBE_COMBOS.split(',') : null;
    const cfgs: { label: string; aim: 'auto' | 'manual'; still?: boolean }[] = [
      { label: 'manual', aim: 'manual' },
      { label: 'auto', aim: 'auto' },
      { label: 'still', aim: 'auto', still: true },
    ];
    const rows: string[][] = [];
    let ms = 0;
    for (const s of SWEEP_STAGES ?? [3, 4]) {
      const variants: { name: string; build: (c: string) => RunState }[] = [
        ...combos
          .filter((cb) => !comboFilter || cb.name === 'generic' || comboFilter.includes(cb.name))
          .map((cb) => ({
            name: cb.name,
            build: (c: string): RunState => {
              const prog: Progression = PROGRESSION.map((st, i) => ({ expand: st.expand, add: i === 3 ? cb.shop3 : i === 4 ? cb.shop4 : st.add }));
              return buildRun(c, s, 'probe', { prog }).run;
            },
          })),
        { name: 'strong', build: (c: string): RunState => buildRun(c, s, 'strong').run },
      ];
      for (const v of variants) {
        const runs = CHARACTERS.map((c) => v.build(c));
        const cells: string[] = [];
        let densAvg = 0;
        let densPeak = 0;
        let densN = 0;
        for (const cfg of cfgs) {
          const outs: Outcome[] = [];
          for (const run of runs) {
            for (const seed of SWEEP_SEEDS) {
              const o = simulate(run, s, seed, aiFor(cfg, run, seed));
              outs.push(o);
              ms += o.ms;
              if (!cfg.still) {
                densAvg += o.avgProj;
                densPeak = Math.max(densPeak, o.maxProj);
                densN++;
              }
            }
          }
          const won = outs.filter((o) => o.won);
          cells.push(
            `${pct(won.length / outs.length)} d${won.length ? Math.round(median(won.map((o) => o.deepest)) * 100) : '-'}` +
              ` h${won.length ? Math.round(median(won.map(hpLost)) * 100) : '-'} ${Math.round(median(outs.map((o) => o.time)))}s`,
          );
        }
        rows.push([
          data.stages[s].id,
          v.name,
          String(Math.round(median(runs.map((r) => sheetDps(runLoadout(data, r)))))),
          ...cells,
          `${(densAvg / Math.max(1, densN)).toFixed(1)} / ${densPeak}`,
        ]);
      }
    }
    console.log(
      `\n[synergy combos] ${SWEEP_SEEDS.length} seeds × ${CHARACTERS.length} characters per cell; st4/st5 shop purchases replaced by the combo (generic = probe build, strong = STRONG)` +
        `\n  cell = win · median deepest % · median HP lost % (won runs) · median time; dps = median sheet dps (no synergy effects); density = live projectiles avg / peak (dodge runs)\n` +
        table(['stage', 'variant', 'dps', ...cfgs.map((c) => c.label), 'density'], rows) +
        `\n  ${Math.round(ms)} ms\n`,
    );
    expect(rows.length).toBeGreaterThan(0);
  }, 3_600_000);
});
