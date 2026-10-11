// 보스 테스트 모드: 보스 데이터·프리셋 검증, sim의 보스전(고정 보스·페이즈·스케줄러·졸개 소환·위험 지역·처치·기어 내려오기),
// 보스 테스트 런(저장 격리). 일반 스테이지가 그대로인지는 마지막 묶음.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BAG_MAX_COLS,
  BAG_MAX_ROWS,
  CELL,
  ENEMY_INSET,
  FIELD_COLS,
  FIELD_H,
  FIELD_W,
  PLAYER_ACCEL_TIME,
  PLAYER_HIT_RADIUS,
  SAVE_KEY,
  SIM_DT,
  SUMMON_LAND_TIME,
} from '../src/config';
import { ASSET_MAP, GAME_DATA } from '../src/data';
import { ENEMY_SHOT_SFX } from '../src/data/sfxMap';
import { areAdjacent, findMerges } from '../src/logic/bag';
import { CombatSim } from '../src/logic/combat/sim';
import { Rng } from '../src/logic/rng';
import {
  clearRun,
  combatSeed,
  completeStage,
  currentStage,
  isBossTestRun,
  isRunComplete,
  isRunValid,
  loadRun,
  newBossTestRun,
  newRun,
  runLoadout,
  runPlayerStats,
  saveRun,
} from '../src/logic/run';
import type {
  BossActionDef,
  BossDef,
  BossPhaseDef,
  CombatEvent,
  CombatInput,
  EnemyDef,
  EnemyEntity,
  PlayerStats,
  ProjectileEntity,
  StageDef,
  WeaponLoadout,
} from '../src/types';

const data = GAME_DATA;
const CHARACTER_IDS = Object.keys(data.characters);

// ─────────────────────────────────────────────────────────────
// 데이터
// ─────────────────────────────────────────────────────────────

/** 걸어서(최고 속도, 가속 PLAYER_ACCEL_TIME) 반응 0.25초 뒤 dist px을 빠져나가는 데 드는 시간(초) — 넉넉한 어림 */
function escapeTime(dist: number, speed: number): number {
  return 0.25 + PLAYER_ACCEL_TIME + dist / speed;
}

/** 이동 속도가 가장 느린 캐릭터 (패시브 포함, 장비 없음) */
const SLOWEST = Math.min(
  ...Object.values(data.characters).map((c) => c.baseMoveSpeed * (1 + (c.passive.moveSpeedMul ?? 0))),
);

describe('보스 데이터 (src/data/bosses.ts)', () => {
  const bosses = Object.entries(data.bosses);

  it('보스가 하나 이상, 레코드 키 = id, 보스 적(boss: true, EnemyDef.attack 없음)을 가리킨다', () => {
    expect(bosses.length).toBeGreaterThan(0);
    for (const [k, b] of bosses) {
      expect(b.id, k).toBe(k);
      const e = data.enemies[b.enemy];
      expect(e, `${k}.enemy`).toBeDefined();
      expect(e.boss, `${k} 적이 보스`).toBe(true);
      // 보스 공격은 행동 스케줄러가 한다 — 일반 적 공격 타이머와 겹치지 않게
      expect(e.attack, `${k} 적에 attack`).toBeUndefined();
      expect(ASSET_MAP[e.sprite], `${k} 그림 ${e.sprite}`).toBeDefined();
    }
  });

  it('고정 위치: 양옆에 1열 이상(공이 돌아 올라가는 길), 천장과의 틈 70~90 px, 필드 위쪽 절반 안', () => {
    for (const [k, b] of bosses) {
      const e = data.enemies[b.enemy];
      expect(b.anchorCol, `${k} 왼쪽 통로`).toBeGreaterThanOrEqual(1);
      expect(b.anchorCol + e.w, `${k} 오른쪽 통로`).toBeLessThanOrEqual(FIELD_COLS - 1);
      const topGap = b.anchorY + ENEMY_INSET;
      expect(topGap, `${k} 천장 틈`).toBeGreaterThanOrEqual(70);
      expect(topGap, `${k} 천장 틈`).toBeLessThanOrEqual(90);
      expect(b.anchorY + e.h * CELL, `${k} 아래 끝`).toBeLessThanOrEqual(FIELD_H / 2);
      expect(b.enterSpeed, `${k}.enterSpeed`).toBeGreaterThan(0);
    }
  });

  it('페이즈: 첫 페이즈 HP 100%, 문턱은 내림차순, 졸개 풀·상한이 올바르고 마지막 페이즈만 기어 내려온다', () => {
    for (const [k, b] of bosses) {
      expect(b.phases.length, `${k} 페이즈 수`).toBeGreaterThanOrEqual(2);
      expect(b.phases[0].hpFrac).toBe(1);
      b.phases.forEach((p: BossPhaseDef, i) => {
        const ctx = `${k} phase ${i}`;
        if (i > 0) {
          expect(p.hpFrac, ctx).toBeLessThan(b.phases[i - 1].hpFrac);
          expect(p.hpFrac, ctx).toBeGreaterThan(0);
        }
        expect(p.roar >= 0 && p.gap >= 0 && p.cooldownMul > 0, ctx).toBe(true);
        expect(Number.isInteger(p.minionCap) && p.minionCap > 0, `${ctx}.minionCap`).toBe(true);
        expect(Number.isInteger(p.enterSummon) && p.enterSummon >= 0 && p.enterSummon <= p.minionCap, `${ctx}.enterSummon`).toBe(true);
        expect(p.minions.length, `${ctx} 졸개 풀`).toBeGreaterThan(0);
        for (const m of p.minions) {
          const md = data.enemies[m.enemy];
          expect(md, `${ctx} 졸개 ${m.enemy}`).toBeDefined();
          expect(md.w === 1 && md.h === 1 && !md.boss, `${ctx} 졸개 ${m.enemy}는 1×1 일반 적`).toBe(true);
          expect(m.weight, `${ctx} ${m.enemy}.weight`).toBeGreaterThan(0);
        }
        expect(p.creep >= 0, `${ctx}.creep`).toBe(true);
        if (i < b.phases.length - 1) expect(p.creep, `${ctx} 마지막 페이즈 전에는 제자리`).toBe(0);
      });
      expect(b.phases[b.phases.length - 1].creep, `${k} 마지막 페이즈는 기어 내려온다`).toBeGreaterThan(0);
    }
  });

  it('행동: id 고유, 페이즈마다 가중치, 페이즈마다 공격 행동과 소환이 있고 뒤 페이즈일수록 행동이 늘거나 같다', () => {
    for (const [k, b] of bosses) {
      const ids = b.actions.map((a) => a.id);
      expect(new Set(ids).size, `${k} 행동 id 중복`).toBe(ids.length);
      for (const a of b.actions) {
        expect(a.weights.length, `${k}.${a.id}.weights`).toBe(b.phases.length);
        expect(a.weights.every((w) => w >= 0), `${k}.${a.id}.weights`).toBe(true);
        expect(a.cooldown > 0 && a.windup >= 0 && (a.recover ?? 0) >= 0, `${k}.${a.id} 시간`).toBe(true);
      }
      let prev = 0;
      b.phases.forEach((_, i) => {
        const on = b.actions.filter((a) => a.weights[i] > 0);
        expect(on.some((a) => a.kind !== 'summon'), `${k} phase ${i} 공격`).toBe(true);
        expect(on.some((a) => a.kind === 'summon'), `${k} phase ${i} 소환`).toBe(true);
        const kinds = new Set(on.map((a) => a.kind)).size;
        expect(kinds, `${k} phase ${i} 행동 종류 수`).toBeGreaterThanOrEqual(prev);
        prev = kinds;
      });
      // 다섯 가지 행동이 다 있다
      expect(new Set(b.actions.map((a) => a.kind))).toEqual(new Set(['volley', 'ring', 'slam', 'marbles', 'summon']));
    }
  });

  it('탄·위험 지역 그림이 assets.json에 있고, 보스 탄마다 발사음이 있다', () => {
    for (const [k, b] of bosses) {
      for (const a of b.actions) {
        const sprite =
          a.kind === 'volley' ? a.volley.sprite : a.kind === 'ring' ? a.ring.sprite : a.kind === 'slam' ? a.slam.sprite : a.kind === 'marbles' ? a.marbles.sprite : null;
        if (sprite === null) continue;
        expect(ASSET_MAP[sprite], `${k}.${a.id} → ${sprite}`).toBeDefined();
        if (a.kind === 'volley' || a.kind === 'ring') expect(ENEMY_SHOT_SFX[sprite], `${k}.${a.id} 발사음`).toBeDefined();
      }
    }
  });

  it('공정성: 예고는 0.8초 이상, 걸어서(가장 느린 캐릭터, 반응 0.25초) 예고 안에 빠져나갈 수 있다', () => {
    for (const [k, b] of bosses) {
      for (const a of b.actions) {
        const ctx = `${k}.${a.id}`;
        if (a.kind === 'slam') {
          const s = a.slam;
          expect(s.warn, ctx).toBeGreaterThanOrEqual(0.8);
          expect(s.active > 0 && s.active <= 0.5, `${ctx}.active`).toBe(true);
          // 2열: 플레이어가 폭 가운데쯤(가까운 이웃 열까지 덮음) → 가장 멀어야 한 칸 + 몸 반지름
          const exit = s.cols === 2 ? CELL + PLAYER_HIT_RADIUS : CELL / 2 + PLAYER_HIT_RADIUS;
          expect(escapeTime(exit, SLOWEST), `${ctx} 빠져나가기`).toBeLessThan(s.warn);
          expect(s.repeats >= 1 && s.repeatInterval >= 0, ctx).toBe(true);
        } else if (a.kind === 'marbles') {
          const m = a.marbles;
          expect(m.warn, ctx).toBeGreaterThanOrEqual(0.8);
          expect(m.active > 0 && m.active <= 0.5, `${ctx}.active`).toBe(true);
          expect(escapeTime(m.radius + PLAYER_HIT_RADIUS, SLOWEST), `${ctx} 빠져나가기`).toBeLessThan(m.warn);
          // 구슬 둘 사이로 몸(지름 40)이 지나갈 틈
          expect(m.spacing, `${ctx}.spacing`).toBeGreaterThanOrEqual(2 * (m.radius + PLAYER_HIT_RADIUS) + 10);
          expect(m.aimed <= m.count && m.yMinFrac > 0 && m.yMinFrac < 1, ctx).toBe(true);
        } else if (a.kind === 'ring') {
          const r = a.ring;
          expect(r.gap, `${ctx}.gap`).toBeGreaterThanOrEqual(2);
          expect(r.gap, `${ctx}.gap`).toBeLessThan(r.count);
          // 빈틈(gap+1칸)은 두 웨이브가 돌아도 겹치는 폭이 남는다
          const step = r.arcDeg / (r.count - 1);
          expect((r.gap + 1) * step - r.rotateDeg * (r.waves - 1), `${ctx} 겹치는 빈틈(도)`).toBeGreaterThan(2 * step);
          // 플레이어 쪽으로 어긋나는 거리만큼은 탄이 바닥에 닿기 전에 걸어갈 수 있다 (입 → 바닥 거리 / 속도)
          const e = data.enemies[b.enemy];
          const travel = (FIELD_H - (b.anchorY + e.h * CELL) - 100) / r.speed;
          expect(escapeTime(r.gapShiftPx, SLOWEST), `${ctx} 빈틈까지`).toBeLessThan(travel);
        } else if (a.kind === 'volley') {
          const v = a.volley;
          expect(v.count >= 1 && v.bursts >= 1 && v.speed > 0 && v.damage > 0, ctx).toBe(true);
          // 부채꼴 밖으로 나가는 거리(바닥, 입에서 약 450 px) vs 탄이 오는 시간
          const half = 450 * Math.tan(((v.spreadDeg / 2) * Math.PI) / 180) + v.radius + PLAYER_HIT_RADIUS;
          expect(escapeTime(half, SLOWEST), `${ctx} 부채꼴 밖`).toBeLessThan(450 / v.speed);
        } else {
          expect(a.summon.count, ctx).toBeGreaterThan(0);
        }
      }
    }
  });

  it('보스 테스트 스테이지: 보스전(rows 비움), 보스 데이터가 있고 졸개 하강 속도보다 느리게 기어 내려온다', () => {
    const st = data.bossTest.stage;
    expect(st.boss).toBeDefined();
    expect(st.rows).toEqual([]);
    expect(data.stages.some((s) => s.id === st.id), '일반 스테이지 목록에 없다').toBe(false);
    expect(ASSET_MAP[st.background]).toBeDefined();
    const b = data.bosses[st.boss!];
    expect(b).toBeDefined();
    expect(st.descentSpeed).toBeGreaterThan(0);
    for (const p of b.phases) expect(p.creep, '졸개와 겹치지 않게').toBeLessThan(st.descentSpeed);
  });
});

describe('보스 테스트 프리셋 (src/data/bossTest.ts)', () => {
  it.each(CHARACTER_IDS)('%s: 가방에 들어가고, 무기 4~6(진화 1+, ★2 있음)·버프 돌 2~3(무기에 맞닿음)·장비 1~2, 합성 거리 없음', (id) => {
    const preset = data.bossTest.presets[id];
    expect(preset, `${id} 프리셋`).toBeDefined();
    expect(preset.cols >= 1 && preset.cols <= BAG_MAX_COLS && preset.rows >= 1 && preset.rows <= BAG_MAX_ROWS).toBe(true);
    for (const si of preset.items) expect(data.items[si.defId], si.defId).toBeDefined();
    // 범위·겹침은 addNewToBag이 검사한다 (실패하면 throw)
    const run = newBossTestRun(data, id, 1);
    expect(run.bag.items.length).toBe(preset.items.length);
    expect(isRunValid(data, run)).toBe(true);

    const kinds = (k: string) => run.bag.items.filter((it) => data.items[it.defId].kind === k);
    const weapons = kinds('weapon');
    const stones = kinds('stone');
    const gear = kinds('gear');
    expect(weapons.length).toBeGreaterThanOrEqual(4);
    expect(weapons.length).toBeLessThanOrEqual(6);
    const evolved = new Set(data.recipes.map((r) => r.result));
    expect(weapons.some((w) => evolved.has(w.defId)), '진화 무기').toBe(true);
    expect(weapons.some((w) => w.tier >= 2), '★2').toBe(true);
    expect(stones.length).toBeGreaterThanOrEqual(2);
    expect(stones.length).toBeLessThanOrEqual(3);
    for (const s of stones) {
      const buffs = weapons.some((w) => areAdjacent(s, data.items[s.defId], w, data.items[w.defId]));
      expect(buffs, `${s.defId} 버프할 무기`).toBe(true);
    }
    expect(gear.length).toBeGreaterThanOrEqual(1);
    expect(gear.length).toBeLessThanOrEqual(2);
    expect(findMerges(run.bag, data), '시작하자마자 합성 가능 표시').toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// sim — 픽스처 보스 (src/data에 의존하지 않음)
// ─────────────────────────────────────────────────────────────

function enemyDef(id: string, o: Partial<EnemyDef> = {}): EnemyDef {
  return { id, name: id, sprite: `enemy_${id}`, w: 1, h: 1, hp: 50, gold: 0, dropChance: 0, ...o };
}

const ENEMIES: Record<string, EnemyDef> = {
  // 4×2 보스: 고정 위치 2~5열
  king: enemyDef('king', { w: 4, h: 2, hp: 1000, boss: true }),
  minion: enemyDef('minion'),
  shooter: enemyDef('shooter', {
    attack: { kind: 'aimed', interval: 1, jitter: 0.5, projSpeed: 200, damage: 3, count: 1, spreadDeg: 0, sprite: 'shot_test', radius: 8 },
  }),
};

function phase(o: Partial<BossPhaseDef> = {}): BossPhaseDef {
  return { hpFrac: 1, roar: 0.5, gap: 0.5, cooldownMul: 1, enterSummon: 0, minionCap: 4, creep: 0, minions: [{ enemy: 'minion', weight: 1 }], ...o };
}

function bossDef(actions: BossActionDef[], phases?: BossPhaseDef[]): BossDef {
  return {
    id: 'kingdef',
    enemy: 'king',
    anchorCol: 2,
    anchorY: 84,
    enterSpeed: 840,
    phases: phases ?? [phase(), phase({ hpFrac: 0.6, roar: 1 }), phase({ hpFrac: 0.3, roar: 1 })],
    actions,
  };
}

const PLAYER: PlayerStats = { maxHp: 100, moveSpeed: 420, regenPerSec: 0, goldMul: 1, damageMul: 1, cooldownMul: 1 };

interface BossSetup {
  boss: BossDef;
  stage?: Partial<StageDef>;
  loadout?: WeaponLoadout[];
  hp?: number;
  seed?: number;
}

function makeBossSim(s: BossSetup): CombatSim {
  const stage: StageDef = {
    id: 'bosstest',
    name: 'bosstest',
    descentSpeed: 20,
    hpMul: 1,
    dmgMul: 1,
    clearGold: 0,
    rows: [],
    legend: {},
    background: 'bg_test',
    boss: s.boss.id,
    ...s.stage,
  };
  return new CombatSim({
    stage,
    stageIndex: 0,
    enemies: ENEMIES,
    bosses: { [s.boss.id]: s.boss },
    loadout: s.loadout ?? [],
    player: PLAYER,
    hp: s.hp ?? PLAYER.maxHp,
    seed: s.seed ?? 1,
  });
}

/** 바닥 가운데에 서 있기 (시작 자리) */
const STAY: CombatInput = { targetX: FIELD_W / 2, targetY: 864 };

interface Timed {
  t: number;
  ev: CombatEvent;
}

function stepFor(sim: CombatSim, seconds: number, input: CombatInput = STAY, out: Timed[] = []): Timed[] {
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n && sim.status === 'running'; i++) {
    sim.step(SIM_DT, input);
    for (const ev of sim.drainEvents()) out.push({ t: sim.time, ev });
  }
  return out;
}

function stepUntil(sim: CombatSim, cond: () => boolean, max = 60, input: CombatInput = STAY, out: Timed[] = []): Timed[] {
  const n = Math.round(max / SIM_DT);
  for (let i = 0; i < n && !cond() && sim.status === 'running'; i++) {
    sim.step(SIM_DT, input);
    for (const ev of sim.drainEvents()) out.push({ t: sim.time, ev });
  }
  if (!cond()) throw new Error('stepUntil: condition not reached');
  return out;
}

const bossOf = (sim: CombatSim): EnemyEntity => sim.enemies.find((e) => e.boss)!;
const minionsOf = (sim: CombatSim): EnemyEntity[] => sim.enemies.filter((e) => !e.boss && e.alive);
const ofType = <K extends CombatEvent['type']>(evs: Timed[], type: K) =>
  evs.filter((x) => x.ev.type === type) as { t: number; ev: Extract<CombatEvent, { type: K }> }[];

let projId = 5_000_000;
/** 보스 아래에서 위로 쏘는 한 방 (무기 없이 피해만 — 맞고 바로 사라진다) */
function hitBoss(sim: CombatSim, damage: number): void {
  const b = bossOf(sim);
  const p: ProjectileEntity = {
    id: projId++,
    weaponUid: 0,
    x: b.x + b.w / 2,
    y: b.y + b.h + 12,
    vx: 0,
    vy: -600,
    radius: 8,
    damage,
    pierceLeft: 0,
    bouncesLeft: 0,
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

const SLAM: BossActionDef = {
  id: 'slam',
  kind: 'slam',
  windup: 0.3,
  cooldown: 100,
  weights: [1, 1, 1],
  slam: { cols: 2, warn: 1.0, active: 0.25, damage: 10, repeats: 1, repeatInterval: 0.3, sprite: 'enemy_jack' },
};

describe('보스전: 등장·페이즈', () => {
  it('화면 위에서 고정 위치로 내려와 페이즈 0 포효(무적) → 졸개 소환, 대형 하강을 따르지 않는다', () => {
    const sim = makeBossSim({ boss: bossDef([], [phase({ enterSummon: 3, roar: 1 }), phase({ hpFrac: 0.5 })]) });
    const b = bossOf(sim);
    expect(b.y + b.h).toBeLessThanOrEqual(0);
    expect(sim.boss?.mode).toBe('enter');
    const evs = stepUntil(sim, () => sim.boss!.mode === 'roar', 5);
    expect(b.y).toBe(84 + ENEMY_INSET);
    expect(ofType(evs, 'bossPhase').map((x) => x.ev.phase)).toEqual([0]);
    expect(ofType(evs, 'summon').length).toBe(3);
    expect(sim.boss!.invulnerable).toBe(true);
    // 포효 중 무적: 피해·상태이상 없음
    hitBoss(sim, 50);
    const during = stepFor(sim, 0.2);
    expect(b.hp).toBe(1000);
    expect(ofType(during, 'hit').filter((x) => x.ev.enemyId === b.id)).toEqual([]);
    // 포효가 끝나면 맞는다. 고정 위치 그대로 (졸개만 내려온다)
    stepUntil(sim, () => sim.boss!.mode === 'idle', 2);
    const m = minionsOf(sim)[0];
    const my = m.y;
    hitBoss(sim, 50);
    stepFor(sim, 0.2);
    expect(b.hp).toBe(950);
    expect(b.y).toBe(84 + ENEMY_INSET);
    expect(m.y - my).toBeCloseTo(20 * 0.2, 6);
  });

  it('HP 문턱(60%·30%)을 넘는 피해는 문턱에서 멈추고, 페이즈가 하나씩 바뀐다 (포효 무적), 마지막 페이즈에서 처치', () => {
    const sim = makeBossSim({ boss: bossDef([]) });
    stepUntil(sim, () => sim.boss!.mode === 'idle', 5);
    const b = bossOf(sim);
    hitBoss(sim, 1e6);
    let evs = stepUntil(sim, () => sim.boss!.phase === 1, 2);
    expect(b.hp).toBe(600);
    expect(ofType(evs, 'bossPhase').map((x) => x.ev.phase)).toEqual([1]);
    expect(sim.boss!.mode).toBe('roar');
    expect(sim.boss!.invulnerable).toBe(true);
    expect(sim.progress()).toBeCloseTo(0.4, 9);
    // 포효 중에는 아무리 세게 때려도 그대로
    hitBoss(sim, 1e6);
    stepFor(sim, 0.3);
    expect(b.hp).toBe(600);
    stepUntil(sim, () => sim.boss!.mode === 'idle', 3);
    hitBoss(sim, 1e6);
    evs = stepUntil(sim, () => sim.boss!.phase === 2, 2);
    expect(b.hp).toBe(300);
    expect(ofType(evs, 'bossPhase').map((x) => x.ev.phase)).toEqual([2]);
    stepUntil(sim, () => sim.boss!.mode === 'idle', 3);
    hitBoss(sim, 1e6);
    evs = stepUntil(sim, () => sim.status !== 'running', 2);
    expect(sim.status).toBe('won');
    expect(ofType(evs, 'kill').some((x) => x.ev.boss)).toBe(true);
    expect(sim.progress()).toBe(1);
  });

  it('화상도 포효 중엔 안 들고 문턱에서 멈춘다', () => {
    const sim = makeBossSim({ boss: bossDef([]) });
    stepUntil(sim, () => sim.boss!.mode === 'idle', 5);
    const b = bossOf(sim) as EnemyEntity;
    b.burnDps = 1e5;
    b.burnTime = 3;
    stepUntil(sim, () => sim.boss!.phase === 1, 1);
    expect(b.hp).toBe(600);
    stepFor(sim, 0.5); // 포효 1초 중
    expect(b.hp).toBe(600);
  });
});

describe('보스전: 행동 스케줄러', () => {
  const VOLLEY: BossActionDef = {
    id: 'v',
    kind: 'volley',
    windup: 0.4,
    cooldown: 1.5,
    weights: [2, 1, 1],
    volley: { sprite: 'shot_block', radius: 10, speed: 200, damage: 4, count: 5, spreadDeg: 40, bursts: 2, burstInterval: 0.3, reaim: true, burstShiftDeg: 0 },
  };
  const RING: BossActionDef = {
    id: 'r',
    kind: 'ring',
    windup: 0.5,
    cooldown: 3,
    recover: 0.5,
    weights: [0, 3, 3],
    ring: { sprite: 'shot_top', radius: 10, speed: 200, damage: 4, count: 13, arcDeg: 150, gap: 3, gapShiftPx: 150, waves: 2, waveInterval: 0.4, rotateDeg: 5 },
  };
  const SUMMON: BossActionDef = { id: 's', kind: 'summon', windup: 0.5, cooldown: 4, weights: [1, 1, 1], summon: { count: 2 } };

  function actionSeq(seed: number): string[] {
    const sim = makeBossSim({ boss: bossDef([VOLLEY, RING, SLAM, SUMMON]), seed });
    const evs = stepFor(sim, 40, { targetX: 100, targetY: 900 });
    return ofType(evs, 'bossAction').map((x) => `${x.ev.id}@${x.t.toFixed(3)}`);
  }

  it('같은 시드 → 같은 행동 순서·시각, 다른 시드 → 다른 순서', () => {
    const a = actionSeq(7);
    expect(a.length).toBeGreaterThan(10);
    expect(actionSeq(7)).toEqual(a);
    expect(actionSeq(8)).not.toEqual(a);
  });

  it('쿨타임을 지키고 가중치 0인 페이즈에서는 고르지 않는다, 행동 사이 gap 이상 쉰다', () => {
    const sim = makeBossSim({ boss: bossDef([VOLLEY, RING, SLAM, SUMMON]), seed: 3 });
    const evs = stepFor(sim, 30, { targetX: 100, targetY: 900 });
    const acts = ofType(evs, 'bossAction');
    // 페이즈 0에서는 고리(가중치 0)가 안 나온다 — 피해를 안 줬으니 30초 내내 페이즈 0
    expect(acts.some((x) => x.ev.id === 'r')).toBe(false);
    const last: Record<string, number> = {};
    for (const { t, ev } of acts) {
      const cd = [VOLLEY, RING, SLAM, SUMMON].find((a) => a.id === ev.id)!.cooldown;
      if (last[ev.id] !== undefined) expect(t - last[ev.id], ev.id).toBeGreaterThanOrEqual(cd - 1e-6);
      last[ev.id] = t;
    }
    expect(Object.keys(last).sort()).toEqual(['s', 'slam', 'v']);
  });

  it('일제 사격: 예비 동작 뒤 입(보스 아래 가운데)에서 플레이어를 노린 부채꼴, burst마다 다시 노림', () => {
    const sim = makeBossSim({ boss: bossDef([{ ...VOLLEY, weights: [1, 1, 1] }]) });
    const evs = stepUntil(sim, () => sim.enemyShots.length > 0, 10);
    const act = ofType(evs, 'bossAction')[0];
    const shoot = ofType(evs, 'enemyShoot')[0];
    expect(shoot.t - act.t).toBeCloseTo(0.4, 1);
    expect(shoot.ev.sprite).toBe('shot_block');
    const b = bossOf(sim);
    expect(sim.enemyShots.length).toBe(5);
    const mid = sim.enemyShots[2];
    expect(mid.x).toBeCloseTo(b.x + b.w / 2, 0);
    const pl = sim.player;
    const aim = Math.atan2(pl.y - (b.y + b.h), pl.x - (b.x + b.w / 2));
    expect(Math.atan2(mid.vy, mid.vx)).toBeCloseTo(aim, 1);
    expect(mid.damage).toBe(4);
    stepFor(sim, 0.35);
    expect(sim.enemyShots.length).toBe(10);
  });

  it('다시 노리지 않는 연속 사격: 두 번째 부채꼴은 첫 방향 + burstShiftDeg (플레이어를 따라가지 않는다)', () => {
    const sim = makeBossSim({ boss: bossDef([{ ...VOLLEY, weights: [1, 1, 1], volley: { ...VOLLEY.volley, reaim: false, burstShiftDeg: 5 } }]) });
    stepUntil(sim, () => sim.enemyShots.length > 0, 10);
    const first = Math.atan2(sim.enemyShots[2].vy, sim.enemyShots[2].vx);
    // 옆으로 크게 걸어도 같은 쪽으로 쏜다
    stepFor(sim, 0.35, { targetX: 60, targetY: 880 });
    expect(sim.enemyShots.length).toBe(10);
    const second = Math.atan2(sim.enemyShots[7].vy, sim.enemyShots[7].vx);
    expect(second - first).toBeCloseTo((5 * Math.PI) / 180, 9);
  });

  it('팽이 고리: gap발이 빠진 이어진 빈틈이 플레이어 쪽에 생긴다', () => {
    const phases = [phase({ roar: 0.1 }), phase({ hpFrac: 0.5 })];
    for (const px of [120, 336, 560]) {
      const sim = makeBossSim({ boss: bossDef([{ ...RING, weights: [1, 1], ring: { ...RING.ring, waves: 1 } }], phases) });
      stepUntil(sim, () => sim.enemyShots.length > 0, 10, { targetX: px, targetY: 880 });
      expect(sim.enemyShots.length).toBe(13 - 3);
      const b = bossOf(sim);
      const ox = b.x + b.w / 2;
      const oy = b.y + b.h;
      const angles = sim.enemyShots.map((s) => Math.atan2(s.vy, s.vx)).sort((a, c) => a - c);
      const step = ((150 / 12) * Math.PI) / 180;
      const gaps = angles.slice(1).map((a, i) => a - angles[i]);
      const bigIdx = gaps.findIndex((g) => g > 1.5 * step);
      expect(gaps.filter((g) => g > 1.5 * step).length, '빈틈 하나').toBe(1);
      expect(gaps[bigIdx]).toBeCloseTo(4 * step, 6);
      // 빈틈 가운데 방향이 플레이어 높이에서 플레이어 x로부터 gapShiftPx(+ 한 칸 반올림) 안
      const center = angles[bigIdx] + gaps[bigIdx] / 2;
      const pl = sim.player;
      const gx = ox + (pl.y - oy) / Math.tan(center);
      expect(Math.abs(gx - pl.x), `player x ${px}`).toBeLessThan(150 + (pl.y - oy) * Math.tan(step) + 20);
    }
  });

  it('냉기 중에는 쉬는 시간·쿨타임이 느리게 흐른다 (예비 동작 박자는 그대로)', () => {
    const fast = makeBossSim({ boss: bossDef([{ ...VOLLEY, weights: [1, 1, 1] }]) });
    const cold = makeBossSim({ boss: bossDef([{ ...VOLLEY, weights: [1, 1, 1] }]) });
    const count = (sim: CombatSim, chill: boolean): number => {
      let n = 0;
      for (let i = 0; i < 20 * 60; i++) {
        if (chill) bossOf(sim).chillTime = 1;
        sim.step(SIM_DT, STAY);
        n += sim.drainEvents().filter((e) => e.type === 'bossAction').length;
      }
      return n;
    };
    expect(count(cold, true)).toBeLessThan(count(fast, false));
  });
});

describe('보스전: 졸개 소환', () => {
  const SUMMON3: BossActionDef = { id: 's', kind: 'summon', windup: 0.2, cooldown: 0.5, weights: [1, 1, 1], summon: { count: 3 } };

  it('살아있는 졸개는 상한을 넘지 않고, 보스 바로 아래 줄·보스 열의 칸에 겹치지 않게 생겨 하강 속도로 내려온다', () => {
    const sim = makeBossSim({ boss: bossDef([SUMMON3], [phase({ minionCap: 5, gap: 0.1 }), phase({ hpFrac: 0.5 })]), seed: 11 });
    const evs: Timed[] = [];
    let peak = 0;
    for (let i = 0; i < 40 * 60 && sim.status === 'running'; i++) {
      sim.step(SIM_DT, { targetX: 40, targetY: 900 });
      for (const ev of sim.drainEvents()) evs.push({ t: sim.time, ev });
      const ms = minionsOf(sim);
      peak = Math.max(peak, ms.length);
      expect(ms.length).toBeLessThanOrEqual(5);
      // 어떤 두 적도 겹치지 않는다
      const all = sim.enemies.filter((e) => e.alive);
      for (let a = 0; a < all.length; a++) {
        for (let c = a + 1; c < all.length; c++) {
          const p = all[a];
          const q = all[c];
          const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
          expect(overlap, `${p.id}/${q.id}`).toBe(false);
        }
      }
    }
    expect(peak).toBe(5);
    const b = bossOf(sim);
    const summons = ofType(evs, 'summon');
    expect(summons.length).toBeGreaterThanOrEqual(5);
    for (const { ev } of summons) {
      const col = Math.floor(ev.x / CELL);
      expect(col).toBeGreaterThanOrEqual(2);
      expect(col).toBeLessThanOrEqual(5);
      expect(ev.x).toBeCloseTo(col * CELL + CELL / 2, 9);
      expect(ev.fromX).toBeCloseTo(b.x + b.w / 2, 9);
      expect(ev.fromY).toBeCloseTo(b.y + b.h, 9);
    }
    // 첫 소환: 칸 위끝 = 보스 칸 아래 끝 (84 + 2칸)
    expect(summons[0].ev.y).toBeCloseTo(84 + 2 * CELL + CELL / 2, 6);
  });

  it('플레이어 바로 근처 칸에는 소환하지 않는다 (눈앞 즉사 방지)', () => {
    // 천천히 등장 (그동안 플레이어가 자리를 잡는다)
    const sim = makeBossSim({ boss: { ...bossDef([], [phase({ enterSummon: 4, minionCap: 4 }), phase({ hpFrac: 0.5 })]), enterSpeed: 80 } });
    // 보스 아래 3열(x 252~336) 바로 밑에 서 있는다
    const evs = stepUntil(sim, () => sim.boss!.mode === 'roar', 10, { targetX: 294, targetY: 84 + 2 * CELL + 120 });
    expect(sim.player.y).toBeCloseTo(84 + 2 * CELL + 120, 3);
    const cols = ofType(evs, 'summon').map((x) => Math.floor(x.ev.x / CELL));
    expect(cols).not.toContain(3);
    expect(cols.length).toBeLessThan(4);
    expect(sim.status).toBe('running');
  });

  it('입에서 날아가는 중(SUMMON_LAND_TIME)인 졸개는 몸에 닿아도 즉사가 아니다 — 칸에 내려앉는 순간부터 몸이 있다', () => {
    // 소환 줄(보스 아래, 칸 박스 y 256~332) 3열 바로 밑, 소환이 허용되는 거리(85 px)에 서 있다가 소환되자마자 그 칸으로 걸어 들어간다
    const SUMMON4: BossActionDef = { id: 's4', kind: 'summon', windup: 0.2, cooldown: 100, weights: [1, 1, 1], summon: { count: 4 } };
    const rowBottom = 84 + 3 * CELL - ENEMY_INSET;
    const here: CombatInput = { targetX: 294, targetY: rowBottom + PLAYER_HIT_RADIUS + 65 };
    const sim = makeBossSim({ boss: bossDef([SUMMON4], [phase({ minionCap: 4 }), phase({ hpFrac: 0.5 })]) });
    stepUntil(sim, () => sim.boss!.mode === 'idle', 5, here);
    sim.player.x = here.targetX!;
    sim.player.y = here.targetY!;
    const evs = stepUntil(sim, () => minionsOf(sim).length > 0, 5, here);
    const summonT = ofType(evs, 'summon')[0].t;
    const m = minionsOf(sim).find((e) => e.x <= 294 && 294 <= e.x + e.w);
    expect(m, '3열에 소환').toBeDefined();
    const into: CombatInput = { targetX: 294, targetY: m!.y + m!.h / 2 };
    const overlapping = (): boolean => {
      const pl = sim.player;
      const qx = Math.max(m!.x, Math.min(pl.x, m!.x + m!.w));
      const qy = Math.max(m!.y, Math.min(pl.y, m!.y + m!.h));
      return Math.hypot(pl.x - qx, pl.y - qy) < pl.hitRadius;
    };
    // 날아오는 동안 칸 안으로 들어가도 살아 있다
    stepUntil(sim, overlapping, SUMMON_LAND_TIME, into);
    expect(sim.time - summonT).toBeLessThan(SUMMON_LAND_TIME);
    expect(sim.status).toBe('running');
    // 그 자리에 있다가 졸개가 내려앉으면 접촉 패배 (일반 규칙)
    stepFor(sim, SUMMON_LAND_TIME, into);
    expect(sim.status).toBe('lost');
    expect(sim.lostReason).toBe('contact');
    expect(sim.time - summonT).toBeGreaterThanOrEqual(SUMMON_LAND_TIME - 1e-9);
  });

  it('졸개는 일반 적처럼 쏘고, 바닥에 닿으면 방어선 패배', () => {
    const sim = makeBossSim({
      boss: bossDef([], [phase({ enterSummon: 1, minions: [{ enemy: 'shooter', weight: 1 }] }), phase({ hpFrac: 0.5 })]),
      stage: { descentSpeed: 200 },
    });
    const evs = stepUntil(sim, () => sim.status !== 'running', 20, { targetX: 40, targetY: 900 });
    const m = ofType(evs, 'summon')[0].ev;
    expect(ofType(evs, 'enemyShoot').some((x) => x.ev.enemyId === m.enemyId)).toBe(true);
    expect(sim.lostReason).toBe('breach');
  });
});

describe('보스전: 위험 지역', () => {
  const stand: CombatInput = { targetX: 300, targetY: 880 };

  it('내려찍기: 예고 1초 동안은 겹쳐도 무사, 발동 순간 피해 한 번(source hazard), 발동 0.25초 뒤 사라진다', () => {
    const sim = makeBossSim({ boss: bossDef([SLAM]) });
    const evs = stepUntil(sim, () => sim.hazards.length > 0, 10, stand);
    const h = sim.hazards[0];
    const warnEv = ofType(evs, 'hazardWarn')[0];
    expect(h.kind).toBe('slam');
    expect(h.state).toBe('warn');
    // 플레이어 열(+ 가까운 이웃 열), 보스 아래 끝부터 바닥까지
    const pl = sim.player;
    expect(pl.x).toBeGreaterThan(h.x + PLAYER_HIT_RADIUS);
    expect(pl.x).toBeLessThan(h.x + h.w - PLAYER_HIT_RADIUS);
    expect(h.w).toBe(2 * CELL);
    const b = bossOf(sim);
    expect(h.y).toBeCloseTo(b.y + b.h, 9);
    expect(h.y + h.h).toBe(FIELD_H);
    const more = stepUntil(sim, () => h.state !== 'warn', 2, stand);
    const impact = ofType(more, 'hazardImpact')[0];
    expect(impact.t - warnEv.t).toBeCloseTo(1.0, 6);
    expect(impact.ev.hitPlayer).toBe(true);
    const hits = ofType(more, 'playerHit');
    expect(hits.length).toBe(1);
    expect(hits[0].ev.source).toBe('hazard');
    expect(hits[0].t).toBe(impact.t);
    expect(pl.hp).toBe(90);
    // 예고 동안에는 맞지 않았다
    expect(more.filter((x) => x.ev.type === 'playerHit' && x.t < impact.t)).toEqual([]);
    stepUntil(sim, () => sim.hazards.length === 0, 1, stand);
    expect(sim.time - impact.t).toBeCloseTo(0.25, 6);
  });

  it('예고 동안 비켜서면 안 맞고, 무적 중이면 발동 중 겹쳐도 안 맞는다', () => {
    const away = makeBossSim({ boss: bossDef([SLAM]) });
    stepUntil(away, () => away.hazards.length > 0, 10, stand);
    const h = away.hazards[0];
    const evs = stepUntil(away, () => away.hazards.length === 0, 3, { targetX: h.x + h.w + 120, targetY: 880 });
    expect(ofType(evs, 'playerHit')).toEqual([]);
    expect(ofType(evs, 'hazardImpact')[0].ev.hitPlayer).toBe(false);

    const iframe = makeBossSim({ boss: bossDef([SLAM]) });
    stepUntil(iframe, () => iframe.hazards.length > 0, 10, stand);
    iframe.player.invuln = 5;
    const evs2 = stepUntil(iframe, () => iframe.hazards.length === 0, 3, stand);
    expect(ofType(evs2, 'playerHit')).toEqual([]);
    expect(iframe.player.hp).toBe(100);
  });

  it('발동 중 안으로 걸어 들어오면 그때 맞는다 (발동 시간 안에서 한 번)', () => {
    const sim = makeBossSim({ boss: bossDef([{ ...SLAM, slam: { ...SLAM.slam, active: 0.5 } }]) });
    stepUntil(sim, () => sim.hazards.length > 0, 10, stand);
    const h = sim.hazards[0];
    const out: CombatInput = { targetX: h.x + h.w + 60, targetY: 880 };
    stepUntil(sim, () => h.state === 'active', 2, out);
    expect(sim.player.hp).toBe(100);
    const evs = stepUntil(sim, () => sim.hazards.length === 0, 2, { targetX: h.x + h.w / 2, targetY: 880 });
    expect(ofType(evs, 'playerHit').length).toBe(1);
  });

  it('구슬 비: 첫 구슬은 플레이어 자리, 나머지는 서로 spacing 이상 — 예고 뒤 발동, 끝나면 행동이 끝난다', () => {
    const MARBLES: BossActionDef = {
      id: 'm',
      kind: 'marbles',
      windup: 0.3,
      cooldown: 100,
      weights: [1, 1, 1],
      marbles: { sprite: 'shot_marble', count: 5, aimed: 1, radius: 40, warn: 1, active: 0.15, damage: 7, stagger: 0.1, spacing: 150, yMinFrac: 0.55 },
    };
    const sim = makeBossSim({ boss: bossDef([MARBLES]) });
    const evs = stepUntil(sim, () => sim.hazards.length > 0, 10, stand);
    // stagger 0.1초 × 4 — 자리가 없는 구슬은 건너뛴다
    stepFor(sim, 0.5, stand, evs);
    const warns = ofType(evs, 'hazardWarn');
    expect(warns.length).toBeGreaterThanOrEqual(3);
    const first = warns[0].ev;
    expect(Math.hypot(first.x - 300, first.y - 880)).toBeLessThan(25);
    for (let i = 0; i < warns.length; i++) {
      for (let j = i + 1; j < warns.length; j++) {
        expect(Math.hypot(warns[i].ev.x - warns[j].ev.x, warns[i].ev.y - warns[j].ev.y)).toBeGreaterThanOrEqual(150);
      }
      expect(warns[i].ev.y).toBeGreaterThanOrEqual(0.55 * FIELD_H);
    }
    stepUntil(sim, () => sim.boss!.mode === 'idle', 3, stand, evs);
    expect(sim.hazards.length).toBe(0);
    expect(ofType(evs, 'hazardImpact').length).toBe(warns.length);
    const hits = ofType(evs, 'playerHit');
    expect(hits.length).toBe(1);
    expect(hits[0].ev.damage).toBe(7);
  });

  it('보스 옆 통로(보스 아래 끝보다 위)에 숨어도 노린 구슬은 그 자리에 떨어진다 — 통로 위는 하늘이 뚫려 있다. 통로를 따라 비키면 안 맞는다', () => {
    const AIMED: BossActionDef = {
      id: 'm1',
      kind: 'marbles',
      windup: 0.3,
      cooldown: 100,
      weights: [1, 1, 1],
      marbles: { sprite: 'shot_marble', count: 1, aimed: 1, radius: 40, warn: 1, active: 0.15, damage: 7, stagger: 0.1, spacing: 150, yMinFrac: 0.55 },
    };
    for (const side of ['left', 'right'] as const) {
      // 픽스처 보스는 2~5열(x 172~500) — 양옆 2열이 통로. 플레이어를 통로 안, 보스 몸 높이에 둔다
      const lx = side === 'left' ? 60 : FIELD_W - 60;
      const lane: CombatInput = { targetX: lx, targetY: 150 };
      const sim = makeBossSim({ boss: bossDef([AIMED]) });
      stepUntil(sim, () => sim.boss!.mode === 'idle', 5, lane);
      sim.player.x = lx;
      sim.player.y = 150;
      const b = bossOf(sim);
      expect(sim.player.y).toBeLessThan(b.y + b.h);
      const evs = stepUntil(sim, () => sim.hazards.length > 0, 10, lane);
      const h = sim.hazards[0];
      expect(h.kind).toBe('marble');
      // 플레이어 자리에, 보스 몸과 겹치지 않게
      expect(Math.hypot(h.x + h.w / 2 - lx, h.y + h.h / 2 - 150)).toBeLessThan(1);
      if (side === 'left') expect(h.x + h.w).toBeLessThanOrEqual(b.x + 1e-6);
      else expect(h.x).toBeGreaterThanOrEqual(b.x + b.w - 1e-6);
      stepUntil(sim, () => sim.hazards.length === 0, 3, lane, evs);
      expect(ofType(evs, 'playerHit').length, `${side}: 가만히 있으면 맞는다`).toBe(1);

      // 같은 상황에서 통로를 따라 아래로 비키면(구슬 반경 + 몸 반경 넘게) 안 맞는다
      const dodge = makeBossSim({ boss: bossDef([AIMED]) });
      stepUntil(dodge, () => dodge.boss!.mode === 'idle', 5, lane);
      dodge.player.x = lx;
      dodge.player.y = 150;
      stepUntil(dodge, () => dodge.hazards.length > 0, 10, lane);
      const evs2 = stepUntil(dodge, () => dodge.hazards.length === 0, 3, { targetX: lx, targetY: 150 + 40 + PLAYER_HIT_RADIUS + 30 });
      expect(ofType(evs2, 'playerHit'), `${side}: 비키면 안 맞는다`).toEqual([]);
    }
  });
});

describe('보스전: 처치·기어 내려오기', () => {
  it('보스가 죽으면 졸개가 함께 터지고(kill), 위험 지역·적 탄이 사라지며 승리', () => {
    const sim = makeBossSim({
      boss: bossDef([SLAM], [phase({ enterSummon: 4, minions: [{ enemy: 'shooter', weight: 1 }] }), phase({ hpFrac: 0.5 })]),
    });
    stepUntil(sim, () => sim.hazards.length > 0 && sim.enemyShots.length > 0, 10, { targetX: 40, targetY: 900 });
    const ms = minionsOf(sim).map((m) => m.id);
    expect(ms.length).toBe(4);
    hitBoss(sim, 1e6);
    stepUntil(sim, () => sim.boss!.mode === 'idle', 3, { targetX: 40, targetY: 900 });
    hitBoss(sim, 1e6);
    const evs = stepUntil(sim, () => sim.status !== 'running', 1, { targetX: 40, targetY: 900 });
    expect(sim.status).toBe('won');
    const kills = ofType(evs, 'kill').map((x) => x.ev.enemyId);
    for (const id of ms) expect(kills).toContain(id);
    expect(sim.enemies.length).toBe(0);
    expect(sim.hazards.length).toBe(0);
    expect(sim.enemyShots.length).toBe(0);
    expect(sim.boss!.mode).toBe('dead');
    expect(sim.boss!.hpFrac).toBe(0);
    expect(sim.killedEnemies).toBe(sim.totalEnemies);
  });

  it('마지막 페이즈에서만 기어 내려오고, 보스 아래 끝이 바닥에 닿으면 방어선 패배', () => {
    const sim = makeBossSim({ boss: bossDef([], [phase(), phase({ hpFrac: 0.5, roar: 0.2, creep: 300 })]) });
    stepUntil(sim, () => sim.boss!.mode === 'idle', 5);
    const b = bossOf(sim);
    const y0 = b.y;
    stepFor(sim, 1);
    expect(b.y).toBe(y0);
    hitBoss(sim, 1e6);
    stepUntil(sim, () => sim.boss!.phase === 1, 1);
    const evs = stepUntil(sim, () => sim.status !== 'running', 5, { targetX: 40, targetY: 900 });
    expect(sim.lostReason).toBe('breach');
    expect(b.y + b.h).toBeGreaterThanOrEqual(FIELD_H);
    expect(ofType(evs, 'lost')[0].ev.reason).toBe('breach');
  });

  it('보스 몸에 닿으면 즉시 패배 (일반 적과 같은 규칙)', () => {
    const sim = makeBossSim({ boss: bossDef([]) });
    stepUntil(sim, () => sim.boss!.mode === 'idle', 5);
    const b = bossOf(sim);
    stepUntil(sim, () => sim.status !== 'running', 5, { targetX: b.x + b.w / 2, targetY: b.y + b.h + 5 });
    expect(sim.lostReason).toBe('contact');
  });

  it('stage.boss가 있는데 보스 데이터를 안 넘기면 바로 알린다', () => {
    expect(
      () =>
        new CombatSim({
          stage: { ...data.bossTest.stage },
          stageIndex: 0,
          enemies: data.enemies,
          loadout: [],
          player: PLAYER,
          hp: 100,
          seed: 1,
        }),
    ).toThrow(/boss/);
  });
});

// ─────────────────────────────────────────────────────────────
// 실제 데이터로 한 판
// ─────────────────────────────────────────────────────────────

function realBossSim(characterId: string, seed: number): CombatSim {
  const run = newBossTestRun(data, characterId, seed);
  return new CombatSim({
    stage: currentStage(data, run),
    stageIndex: run.stageIndex,
    enemies: data.enemies,
    bosses: data.bosses,
    loadout: runLoadout(data, run),
    player: runPlayerStats(data, run),
    hp: run.hp,
    seed: combatSeed(run),
  });
}

describe('보스 테스트 한 판 (실제 데이터)', () => {
  it('같은 시드·같은 입력 → 이벤트까지 똑같다', () => {
    const play = (): string => {
      const sim = realBossSim('cat', 42);
      const out: string[] = [];
      for (let i = 0; i < 45 * 60 && sim.status === 'running'; i++) {
        sim.step(SIM_DT, { targetX: 336 + 200 * Math.sin(i / 40), targetY: 880, aimAngle: -Math.PI / 2 + 0.6 * Math.sin(i / 90) });
        for (const ev of sim.drainEvents()) out.push(JSON.stringify(ev));
      }
      return `${sim.status} ${sim.time} ${out.length} ${out.join('|').length} ${out.slice(-5).join('|')}`;
    };
    expect(play()).toBe(play());
  });

  it.each(CHARACTER_IDS)('%s: 보스가 내려와 페이즈를 다 거치고, 졸개가 상한 안에서 생기며 결판이 난다 (NaN 없음)', (id) => {
    const sim = realBossSim(id, 7);
    const boss = data.bosses[data.bossTest.stage.boss!];
    const phases = new Set<number>();
    const kinds = new Set<string>();
    for (let i = 0; i < 300 * 60 && sim.status === 'running'; i++) {
      sim.step(SIM_DT, { targetX: 336 + 250 * Math.sin(i / 50), targetY: 870 });
      for (const ev of sim.drainEvents()) {
        if (ev.type === 'bossPhase') phases.add(ev.phase);
        if (ev.type === 'bossAction') kinds.add(ev.action);
      }
      expect(sim.boss!.minions).toBeLessThanOrEqual(boss.phases[sim.boss!.phase].minionCap);
      expect(Number.isFinite(sim.player.hp) && Number.isFinite(sim.boss!.hpFrac)).toBe(true);
    }
    expect(sim.status).not.toBe('running');
    if (sim.status === 'won') {
      expect([...phases].sort()).toEqual(boss.phases.map((_, i) => i));
      expect(sim.progress()).toBe(1);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it('무작위로 돌아다녀도(아래쪽·양옆 통로, 피격 무시 판 포함) 규칙이 지켜진다 — 소환 자리, 겹침, 위험 지역 범위, 결판 한 번, 남는 것 없음', () => {
    const problems: string[] = [];
    let summons = 0;
    let ends = 0;
    for (const id of CHARACTER_IDS) {
      for (let seed = 1; seed <= 8; seed++) {
        const sim = realBossSim(id, seed * 7919);
        const rng = new Rng(seed * 31 + id.length);
        const tag = `${id}/${seed}`;
        // 짝수 시드는 HP를 매 스텝 채운다 (졸개·위험 지역이 쌓이는 뒤 페이즈까지 가게)
        const godMode = seed % 2 === 0;
        const born = new Map<number, number>();
        const killed = new Set<number>();
        let tx = FIELD_W / 2;
        let ty = 880;
        let aim = -Math.PI / 2;
        let next = 0;
        let terminal = 0;
        let lastProgress = 0;
        for (let i = 0; i < 300 * 60 && sim.status === 'running'; i++) {
          if (sim.time >= next) {
            // 아래쪽 띠 아무 데나 / 왼쪽 통로로 / 통로 안에서 위아래로 (보스 몸을 가로지르지 않는 길로)
            next = sim.time + rng.range(0.2, 1.5);
            const pl = sim.player;
            const r = rng.next();
            if (pl.x < 70 && r < 0.4) {
              tx = 45;
              ty = rng.range(120, FIELD_H);
            } else if (pl.y < 600 && pl.x >= 70) {
              tx = pl.x;
              ty = 880;
            } else if (r < 0.15) {
              tx = 45;
              ty = pl.y;
            } else {
              tx = rng.range(0, FIELD_W);
              ty = rng.range(620, FIELD_H);
            }
            aim = -rng.range(0.15, Math.PI - 0.15);
          }
          if (godMode) sim.player.hp = sim.player.maxHp;
          sim.step(SIM_DT, { targetX: tx, targetY: ty, aimAngle: aim });
          for (const ev of sim.drainEvents()) {
            if (ev.type === 'won' || ev.type === 'lost') terminal++;
            if (ev.type === 'kill') {
              if (killed.has(ev.enemyId)) problems.push(`${tag}: kill ${ev.enemyId} twice`);
              killed.add(ev.enemyId);
            }
            if (ev.type !== 'summon') continue;
            summons++;
            born.set(ev.enemyId, sim.time);
            const e = sim.enemies.find((x) => x.id === ev.enemyId);
            if (!e) {
              if (sim.status === 'running') problems.push(`${tag}: summoned ${ev.enemyId} missing`);
              continue;
            }
            if (e.x < 0 || e.x + e.w > FIELD_W || e.y < 0 || e.y + e.h > FIELD_H) problems.push(`${tag}: summon outside the field`);
            const pl = sim.player;
            const qx = Math.max(e.x, Math.min(pl.x, e.x + e.w));
            const qy = Math.max(e.y, Math.min(pl.y, e.y + e.h));
            if (Math.hypot(pl.x - qx, pl.y - qy) < pl.hitRadius + 40) problems.push(`${tag}: summon next to the player`);
          }
          // 어떤 두 적도 겹치지 않는다 (졸개끼리, 졸개와 기어 내려오는 보스)
          const es = sim.enemies;
          for (let a = 0; a < es.length; a++) {
            for (let c = a + 1; c < es.length; c++) {
              const p = es[a];
              const q = es[c];
              if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) problems.push(`${tag}: ${p.defId}/${q.defId} overlap`);
            }
          }
          for (const h of sim.hazards) {
            if (h.x < -1e-6 || h.y < 0 || h.x + h.w > FIELD_W + 1e-6 || h.y + h.h > FIELD_H + 1e-6) problems.push(`${tag}: ${h.kind} outside the field`);
          }
          const p = sim.progress();
          if (p + 1e-9 < lastProgress) problems.push(`${tag}: progress went down`);
          lastProgress = p;
        }
        if (sim.status === 'running') problems.push(`${tag}: no result in 300 s`);
        if (terminal !== 1) problems.push(`${tag}: ${terminal} won/lost events`);
        ends++;
        if (sim.status === 'won' && (sim.enemies.length || sim.hazards.length || sim.enemyShots.length)) problems.push(`${tag}: leftovers after the win`);
        if (sim.lostReason === 'contact') {
          // 진 접촉은 내려앉은 졸개(또는 보스)와만 — 아직 날아오는 졸개에 닿아 지지 않는다
          const pl = sim.player;
          for (const e of sim.enemies) {
            const qx = Math.max(e.x, Math.min(pl.x, e.x + e.w));
            const qy = Math.max(e.y, Math.min(pl.y, e.y + e.h));
            const b = born.get(e.id);
            if (Math.hypot(pl.x - qx, pl.y - qy) < pl.hitRadius && b !== undefined && sim.time - b < SUMMON_LAND_TIME - SIM_DT - 1e-9) {
              problems.push(`${tag}: contact with a minion still landing (${(sim.time - b).toFixed(3)} s)`);
            }
          }
        }
        // 끝난 뒤 스텝은 아무것도 하지 않는다
        sim.step(SIM_DT, STAY);
        if (sim.drainEvents().length > 0) problems.push(`${tag}: events after the end`);
      }
    }
    expect(problems).toEqual([]);
    expect(ends).toBe(CHARACTER_IDS.length * 8);
    expect(summons).toBeGreaterThan(100);
  });
});

// ─────────────────────────────────────────────────────────────
// 런: 보스 테스트는 일반 런 세이브를 절대 건드리지 않는다
// ─────────────────────────────────────────────────────────────

class MemoryStorage {
  private map = new Map<string, string>();
  writes = 0;
  removes = 0;
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.writes++;
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.removes++;
    this.map.delete(key);
  }
}

describe('보스 테스트 런', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(CHARACTER_IDS)('%s: 프리셋 가방·풀 HP·mode bossTest, 스테이지는 보스 테스트 스테이지', (id) => {
    const run = newBossTestRun(data, id, 99);
    expect(run.mode).toBe('bossTest');
    expect(isBossTestRun(run)).toBe(true);
    expect(run.bag.cols).toBe(data.bossTest.presets[id].cols);
    expect(run.bag.rows).toBe(data.bossTest.presets[id].rows);
    expect(run.hp).toBe(runPlayerStats(data, run).maxHp);
    expect(currentStage(data, run)).toBe(data.bossTest.stage);
    expect(isRunValid(data, run)).toBe(true);
    expect(isRunComplete(data, run)).toBe(false);
    expect(Number.isInteger(combatSeed(run))).toBe(true);
  });

  it('일반 런은 mode를 쓰지 않는다 (세이브 모양 그대로)', () => {
    const run = newRun(data, 'cat', 1);
    expect('mode' in run).toBe(false);
    expect(isBossTestRun(run)).toBe(false);
    expect(currentStage(data, run)).toBe(data.stages[0]);
  });

  it('saveRun / clearRun은 보스 테스트 런을 무시한다 — 일반 세이브가 그대로 남는다', () => {
    const mem = new MemoryStorage();
    vi.stubGlobal('localStorage', mem);
    const normal = newRun(data, 'penguin', 5);
    saveRun(normal);
    const saved = mem.getItem(SAVE_KEY);
    expect(saved).not.toBeNull();
    const writes = mem.writes;

    const boss = newBossTestRun(data, 'cat', 6);
    saveRun(boss);
    clearRun(boss);
    expect(mem.writes).toBe(writes);
    expect(mem.removes).toBe(0);
    expect(mem.getItem(SAVE_KEY)).toBe(saved);
    expect(loadRun(data)).toEqual(normal);

    // 보스 테스트를 끝까지 (completeStage) 해도 마찬가지
    const res = completeStage(data, boss, 12);
    expect(res).toEqual({ clearGold: 0, healed: 0, finished: true });
    expect(boss.hp).toBe(12);
    expect(boss.gold).toBe(0);
    expect(isRunComplete(data, boss)).toBe(true);
    expect(isRunValid(data, boss)).toBe(false);
    saveRun(boss);
    clearRun(boss);
    expect(mem.writes).toBe(writes);
    expect(mem.removes).toBe(0);
    expect(loadRun(data)).toEqual(normal);

    // 일반 런을 넘기거나 아무것도 안 넘기면 예전처럼 지운다
    clearRun(normal);
    expect(mem.getItem(SAVE_KEY)).toBeNull();
    saveRun(normal);
    clearRun();
    expect(mem.getItem(SAVE_KEY)).toBeNull();
  });

  it('loadRun은 (어쩌다 저장된) 보스 테스트 런을 이어하기로 돌려주지 않고 지우지도 않는다', () => {
    const mem = new MemoryStorage();
    vi.stubGlobal('localStorage', mem);
    const boss = newBossTestRun(data, 'capybara', 3);
    mem.setItem(SAVE_KEY, JSON.stringify(boss));
    expect(loadRun()).toBeNull();
    expect(loadRun(data)).toBeNull();
    expect(mem.getItem(SAVE_KEY)).not.toBeNull();
    // 모르는 mode는 깨진 세이브
    mem.setItem(SAVE_KEY, JSON.stringify({ ...newRun(data, 'cat', 1), mode: 'weird' }));
    expect(loadRun()).toBeNull();
    // mode 'normal'을 적은 세이브는 일반 런
    const explicit = { ...newRun(data, 'cat', 1), mode: 'normal' as const };
    mem.setItem(SAVE_KEY, JSON.stringify(explicit));
    expect(loadRun(data)).toEqual(explicit);
  });
});

// ─────────────────────────────────────────────────────────────
// 일반 스테이지는 그대로
// ─────────────────────────────────────────────────────────────

describe('일반 스테이지에는 보스 경로가 없다', () => {
  it.each(data.stages.map((s, i) => [s.id, i] as const))('%s: boss null, hazards 비어 있음, 보스 이벤트 없음, progress = 처치 비율', (_id, i) => {
    const run = newRun(data, 'cat', 3);
    run.stageIndex = i;
    const sim = new CombatSim({
      stage: data.stages[i],
      stageIndex: i,
      enemies: data.enemies,
      bosses: data.bosses,
      loadout: runLoadout(data, run),
      player: { ...runPlayerStats(data, run), maxHp: 1e6 },
      hp: 1e6,
      seed: 5,
    });
    expect(sim.boss).toBeNull();
    const BOSS_EVENTS = new Set(['bossPhase', 'bossAction', 'summon', 'hazardWarn', 'hazardImpact']);
    for (let k = 0; k < 40 * 60 && sim.status === 'running'; k++) {
      sim.step(SIM_DT, { targetX: 336 + 250 * Math.sin(k / 50), targetY: 870 });
      for (const ev of sim.drainEvents()) {
        expect(BOSS_EVENTS.has(ev.type), ev.type).toBe(false);
        if (ev.type === 'enemyShoot') expect('sprite' in ev).toBe(false);
        if (ev.type === 'playerHit') expect(ev.source).toBe('shot');
      }
      expect(sim.hazards.length).toBe(0);
    }
    expect(sim.progress()).toBe(sim.killedEnemies / sim.totalEnemies);
  });
});
