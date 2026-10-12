// 액티브 스킬 (docs/DESIGN.md '액티브 스킬', docs/ARCHITECTURE.md 'sim.ts' 액티브 스킬): 게이지(피해로 충전·스테이지 정규화·백어택 보너스·
// 스킬 공 제외), 발동 조건, 빙하기(얼림·보스 저항), 온천 타임(회복·탄 녹이기), 털뭉치 폭풍(발사·속성·피해), 보스 포효·히트스톱 중 발동, 결정성.
import { describe, expect, it } from 'vitest';
import {
  BACK_ATTACK_MUL,
  CELL,
  CHILL_DAMAGE_TAKEN_MUL,
  ENEMY_INSET,
  FIELD_W,
  SIM_DT,
  SKILL_BACK_CHARGE_MUL,
  SKILL_WEAPON_UID,
} from '../src/config';
import { ASSET_MAP, GAME_DATA } from '../src/data';
import { CombatSim, clampAim } from '../src/logic/combat/sim';
import { combatSeed, currentStage, newBossTestRun, newRun, runLoadout, runPlayerStats, runSkill } from '../src/logic/run';
import type {
  CombatEvent,
  CombatInput,
  EnemyDef,
  EnemyEntity,
  Element,
  PlayerStats,
  ProjectileEntity,
  SkillDef,
  StageDef,
  WeaponLoadout,
} from '../src/types';

const data = GAME_DATA;
const DEG = Math.PI / 180;

// ── 픽스처 ────────────────────────────────────────────────────

function enemyDef(id: string, o: Partial<EnemyDef> = {}): EnemyDef {
  return { id, name: id, sprite: `enemy_${id}`, w: 1, h: 1, hp: 1000, gold: 0, dropChance: 0, ...o };
}

const SHOOT = { kind: 'aimed', interval: 1, jitter: 0, projSpeed: 300, damage: 5, count: 1, spreadDeg: 0, sprite: 'shot_dart', radius: 12 } as const;

const ENEMIES: Record<string, EnemyDef> = {
  dummy: enemyDef('dummy'),
  weak: enemyDef('weak', { hp: 1 }),
  guard: enemyDef('guard', { hp: 1e9 }),
  shooter: enemyDef('shooter', { attack: { ...SHOOT } }),
  healer: enemyDef('healer', { heal: { interval: 0.5, jitter: 0, radius: 134, frac: 0.15 } }),
  car: enemyDef('car', { shift: { interval: 0.5, jitter: 0, speed: 210 } }),
  bossy: enemyDef('bossy', { boss: true, w: 2, h: 1, attack: { ...SHOOT } }),
};
const LEGEND: Record<string, string> = { d: 'dummy', w: 'weak', G: 'guard', s: 'shooter', h: 'healer', c: 'car', X: 'bossy' };

const PLAYER: PlayerStats = { maxHp: 100, moveSpeed: 420, regenPerSec: 0, goldMul: 1, damageMul: 1, cooldownMul: 1 };
const IDLE: CombatInput = { targetX: null, targetY: null };

const skillOf = (kind: SkillDef['kind'], charge = 1000): SkillDef => ({ ...data.skills[KIND_CHAR[kind]], charge });
const KIND_CHAR: Record<SkillDef['kind'], string> = { freeze: 'penguin', spring: 'capybara', storm: 'cat' };

const ROW0_Y = 400;
const colMid = (c: number): number => c * CELL + CELL / 2;

interface Setup {
  hpMul?: number;
  skill?: SkillDef | null;
  loadout?: WeaponLoadout[];
  player?: Partial<PlayerStats>;
  hp?: number;
  guard?: boolean;
  seed?: number;
}

/** rows(아래 → 위)를 줄 0 위끝 ROW0_Y에 세운다 (하강 0). 화면 밖에 안 죽는 적 하나(guard)를 둬서 'won'으로 안 끝나게 */
function park(rows: string[], s: Setup = {}): CombatSim {
  const guard = s.guard ?? true;
  const stage: StageDef = {
    id: 'skill',
    name: 'skill',
    descentSpeed: 0,
    hpMul: s.hpMul ?? 1,
    dmgMul: 1,
    clearGold: 0,
    rows: guard ? [...rows, 'G.......'] : rows,
    legend: LEGEND,
    background: 'bg_test',
  };
  const player = { ...PLAYER, ...s.player };
  const sim = new CombatSim({
    stage,
    stageIndex: 0,
    enemies: ENEMIES,
    loadout: s.loadout ?? [],
    player,
    hp: s.hp ?? player.maxHp,
    seed: s.seed ?? 1,
    skill: s.skill === undefined ? skillOf('freeze') : s.skill,
  });
  const dy = ROW0_Y - (-CELL + ENEMY_INSET);
  for (const e of sim.enemies) e.y += dy;
  if (guard) sim.enemies[sim.enemies.length - 1].y = -600;
  return sim;
}

let nextId = 7_000_000;
function shoot(sim: CombatSim, o: Partial<ProjectileEntity> & Pick<ProjectileEntity, 'x' | 'y' | 'vx' | 'vy'>): ProjectileEntity {
  const p: ProjectileEntity = {
    id: nextId++,
    weaponUid: 0,
    radius: 8,
    damage: 100,
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

function run(sim: CombatSim, steps: number, input: CombatInput = IDLE): CombatEvent[] {
  const out: CombatEvent[] = [];
  for (let i = 0; i < steps && sim.status === 'running'; i++) {
    sim.step(SIM_DT, input);
    out.push(...sim.drainEvents());
  }
  return out;
}
const runFor = (sim: CombatSim, s: number, input: CombatInput = IDLE): CombatEvent[] => run(sim, Math.round(s / SIM_DT), input);

function ofType<T extends CombatEvent['type']>(ev: CombatEvent[], type: T): Extract<CombatEvent, { type: T }>[] {
  return ev.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === type);
}

/** 게이지를 가득 채운다 (내부 값 — 충전 규칙은 아래 '게이지' 묶음이 따로 본다) */
function fill(sim: CombatSim): void {
  const s = sim as unknown as { chargeAcc: number; chargeNeed: number };
  s.chargeAcc = s.chargeNeed;
  sim.step(SIM_DT, IDLE);
  sim.drainEvents();
}

const visible = (sim: CombatSim): EnemyEntity[] => sim.enemies.filter((e) => e.alive && e.y + e.h > 0);
const standAt = (sim: CombatSim, x: number, y: number): CombatInput => {
  sim.player.x = x;
  sim.player.y = y;
  sim.player.vx = sim.player.vy = 0;
  return { targetX: x, targetY: y };
};

function weapon(uid: number, o: Partial<WeaponLoadout>): WeaponLoadout {
  return {
    uid,
    defId: `w${uid}`,
    tier: 1,
    cooldown: 1,
    damage: 20,
    count: 1,
    spreadDeg: 0,
    speed: 800,
    radius: 10,
    pierce: 0,
    maxBounces: 0,
    elements: [],
    explodeRadius: 0,
    split: null,
    sprite: 'proj_test',
    spin: false,
    ...o,
  };
}

// ─────────────────────────────────────────────────────────────
// 데이터
// ─────────────────────────────────────────────────────────────

describe('스킬 데이터', () => {
  it('캐릭터마다 스킬 하나: 펭구 빙하기(freeze) · 카피 온천 타임(spring) · 냥냥 털뭉치 폭풍(storm), 아이콘·한국어·충전량', () => {
    expect(Object.keys(data.skills).sort()).toEqual(Object.keys(data.characters).sort());
    expect(data.skills.penguin.kind).toBe('freeze');
    expect(data.skills.capybara.kind).toBe('spring');
    expect(data.skills.cat.kind).toBe('storm');
    for (const [ch, s] of Object.entries(data.skills)) {
      expect(s.character).toBe(ch);
      expect(ASSET_MAP[s.icon], s.icon).toBeDefined();
      expect(/[가-힣]/.test(s.name) && /[가-힣]/.test(s.desc)).toBe(true);
      expect(s.charge).toBeGreaterThan(0);
      if (s.kind === 'storm') expect(ASSET_MAP[s.storm.sprite]).toBeDefined();
      expect(runSkill(data, newRun(data, ch, 1))).toBe(s);
    }
    // 설명이 수치를 그대로 말한다
    const st = data.skills.cat;
    if (st.kind === 'storm') expect(st.desc).toContain(`${st.storm.count}`);
    const sp = data.skills.capybara;
    if (sp.kind === 'spring') expect(sp.desc).toContain(`${Math.round(sp.spring.healFrac * 100)}%`);
    const fz = data.skills.penguin;
    if (fz.kind === 'freeze') expect(fz.desc).toContain(`${fz.freeze.duration}초`);
  });
});

// ─────────────────────────────────────────────────────────────
// 게이지
// ─────────────────────────────────────────────────────────────

describe('스킬 게이지', () => {
  it('스킬이 없으면 sim.skill = null, activateSkill은 늘 false', () => {
    const sim = park(['d'], { skill: null });
    expect(sim.skill).toBeNull();
    shoot(sim, { x: colMid(0), y: 800, vx: 0, vy: -800 });
    runFor(sim, 1);
    expect(sim.activateSkill()).toBe(false);
  });

  it('깎은 HP만큼 찬다: 피해 / (charge × hpMul) — 스테이지 HP 배수로 정규화 (같은 비율의 피해 = 같은 충전)', () => {
    for (const hpMul of [1, 3]) {
      const sim = park(['d'], { hpMul, skill: skillOf('freeze', 1000) });
      shoot(sim, { x: colMid(0), y: 800, vx: 0, vy: -800, damage: 100 * hpMul });
      const evs = runFor(sim, 1);
      expect(ofType(evs, 'hit').length).toBeGreaterThan(0);
      expect(sim.skill!.charge).toBeCloseTo(0.1, 9);
      expect(sim.skill!.ready).toBe(false);
    }
  });

  it(`백어택 직접 적중은 ×${SKILL_BACK_CHARGE_MUL}로 찬다 (피해 자체도 ×${BACK_ATTACK_MUL})`, () => {
    const sim = park(['d'], { skill: skillOf('freeze', 1000) });
    // 위에서 아래로 — 윗면
    shoot(sim, { x: colMid(0), y: ROW0_Y - 120, vx: 0, vy: 800, damage: 100 });
    const evs = runFor(sim, 0.5);
    const hit = ofType(evs, 'hit')[0];
    expect(hit.back).toBe(true);
    expect(hit.damage).toBe(150);
    expect(sim.skill!.charge).toBeCloseTo((150 * SKILL_BACK_CHARGE_MUL) / 1000, 9);
  });

  it('넘친 피해는 안 센다 (HP 1인 적을 100으로 → 1), 화상 틱도 센다, 가득에서 멈춘다', () => {
    const sim = park(['w'], { skill: skillOf('freeze', 1000) });
    shoot(sim, { x: colMid(0), y: 800, vx: 0, vy: -800, damage: 100 });
    runFor(sim, 1);
    expect(sim.skill!.charge).toBeCloseTo(1 / 1000, 12);

    const burn = park(['d'], { skill: skillOf('freeze', 1000) });
    shoot(burn, { x: colMid(0), y: 800, vx: 0, vy: -800, damage: 100, elements: ['fire'] });
    runFor(burn, 0.4);
    const afterHit = burn.skill!.charge;
    runFor(burn, 3);
    // 화상 = 피해 × 0.25 / 초 × 3초 = 75 (얼추 — 마지막 틱까지)
    expect(burn.skill!.charge - afterHit).toBeCloseTo(75 / 1000, 3);

    const full = park(['d'], { skill: skillOf('freeze', 10) });
    shoot(full, { x: colMid(0), y: 800, vx: 0, vy: -800, damage: 500 });
    runFor(full, 1);
    expect(full.skill!.charge).toBe(1);
    expect(full.skill!.ready).toBe(true);
  });

  it('스킬 공(털뭉치 폭풍)의 적중은 게이지를 채우지 않는다', () => {
    const sim = park(['d'], { skill: skillOf('freeze', 1000) });
    shoot(sim, { x: colMid(0), y: 800, vx: 0, vy: -800, damage: 100, ...({ skill: true } as object) });
    const evs = runFor(sim, 1);
    expect(ofType(evs, 'hit').length).toBeGreaterThan(0);
    expect(sim.skill!.charge).toBe(0);
  });

  it('발동: 가득일 때만 true → 게이지 0, uses + 1, 효과가 끝나기 전에는 다시 못 씀 / 전투가 끝나면 false', () => {
    const sim = park(['d'], { skill: skillOf('freeze', 1) });
    expect(sim.activateSkill()).toBe(false);
    fill(sim);
    expect(sim.skill!.ready).toBe(true);
    expect(sim.activateSkill()).toBe(true);
    expect(sim.skill).toMatchObject({ charge: 0, ready: false, uses: 1, active: 3, duration: 3 });
    fill(sim);
    expect(sim.skill!.charge).toBe(1);
    expect(sim.skill!.ready).toBe(false);
    expect(sim.activateSkill()).toBe(false);
    runFor(sim, 3);
    expect(sim.skill!.active).toBe(0);
    expect(sim.skill!.ready).toBe(true);
    sim.debugLose();
    expect(sim.activateSkill()).toBe(false);
  });
});

describe('닿을 적이 없으면 발동하지 않는다 (게이지를 아낌)', () => {
  it('보이는 적이 없으면(웨이브 사이) 빙하기·털뭉치 폭풍은 false — 게이지·사용 횟수 그대로, 이벤트 없음. 온천 타임은 된다(회복)', () => {
    for (const kind of ['freeze', 'storm', 'spring'] as const) {
      const sim = park(['d'], { skill: skillOf(kind), hp: 50 });
      fill(sim);
      const target = visible(sim).find((e) => e.defId === 'dummy')!;
      const y0 = target.y;
      target.y = -400; // 화면 위로 (웨이브 사이 — 아직 내려오는 중)
      expect(visible(sim)).toEqual([]);
      if (kind === 'spring') {
        expect(sim.activateSkill(), kind).toBe(true);
        continue;
      }
      expect(sim.activateSkill(), kind).toBe(false);
      expect(sim.skill, kind).toMatchObject({ charge: 1, ready: true, uses: 0, active: 0 });
      expect(sim.drainEvents(), kind).toEqual([]);
      // 적이 화면에 들어오면 바로 쓸 수 있다
      target.y = y0;
      expect(sim.activateSkill(), kind).toBe(true);
      expect(sim.skill!.uses).toBe(1);
    }
  });

  it('보스 포효 중 보스만 보이면 빙하기는 false(포효 중 보스는 상태이상을 안 받는다) — 털뭉치 폭풍은 된다', () => {
    const stage = data.bossTest.stage;
    const input: CombatInput = { targetX: FIELD_W / 2, targetY: 900, aimAngle: -Math.PI / 2 };
    for (const kind of ['freeze', 'storm'] as const) {
      const sim = new CombatSim({ stage, stageIndex: 0, enemies: data.enemies, bosses: data.bosses, loadout: [], player: { ...PLAYER, maxHp: 1e6 }, hp: 1e6, seed: 4, skill: skillOf(kind) });
      for (let i = 0; i < 1200 && sim.boss!.mode !== 'roar'; i++) {
        sim.step(SIM_DT, input);
        sim.drainEvents();
      }
      expect(sim.boss!.mode).toBe('roar');
      // 졸개는 화면 위로 치워 둔다 — 보이는 적은 포효 중인 보스뿐
      for (const e of sim.enemies) if (!e.boss) e.y = -1000;
      (sim as unknown as { chargeAcc: number; chargeNeed: number }).chargeAcc = 1e12;
      expect(sim.activateSkill(), kind).toBe(kind === 'storm');
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 빙하기
// ─────────────────────────────────────────────────────────────

describe('빙하기 (freeze)', () => {
  it('보이는 적 전부 3초 얼림 + 냉기: 그동안 쏘지도·치유하지도·옆걸음하지도 않고, 풀리면 다시', () => {
    // 치유병(1열) 옆 사수(0열)가 다쳐 있다 — 치유는 찬 채로 기다린다
    const sim = park(['sh..c..s'], { skill: skillOf('freeze') });
    const input = standAt(sim, FIELD_W / 2, 900);
    runFor(sim, 0.5, input);
    fill(sim);
    // 발동 직전(같은 스텝 사이)에 다치게 — 치유 타이머는 이미 다 찼다
    for (const e of visible(sim)) if (e.defId === 'shooter') e.hp -= 100;
    expect(sim.activateSkill()).toBe(true);
    const start = sim.drainEvents();
    const skill = ofType(start, 'skill');
    expect(skill).toEqual([{ type: 'skill', skill: 'glacier', kind: 'freeze', x: sim.player.x, y: sim.player.y, duration: 3 }]);
    const frozen = ofType(start, 'freeze');
    expect(frozen.map((f) => f.enemyId).sort()).toEqual(visible(sim).map((e) => e.id).sort());
    expect(frozen.every((f) => !f.resisted && f.duration === 3)).toBe(true);
    for (const e of visible(sim)) {
      expect(e.frozen).toBe(3);
      expect(e.chillTime).toBeGreaterThanOrEqual(3);
    }
    // 화면 밖 적은 그대로
    expect(sim.enemies.find((e) => e.defId === 'guard')!.frozen).toBe(0);
    const during = runFor(sim, 2.9, input);
    expect(ofType(during, 'enemyShoot')).toEqual([]);
    expect(ofType(during, 'heal')).toEqual([]);
    expect(ofType(during, 'shift')).toEqual([]);
    const after = runFor(sim, 1.5, input);
    expect(ofType(after, 'enemyShoot').length).toBeGreaterThan(0);
    expect(ofType(after, 'heal').length).toBeGreaterThan(0);
    expect(ofType(after, 'shift').length).toBeGreaterThan(0);
    for (const e of visible(sim)) expect(e.frozen).toBe(0);
  });

  it('비교: 그냥 냉기(얼음 공)는 공격을 멈추지 않는다 — 얼림만 멈춘다', () => {
    const sim = park(['s'], { skill: skillOf('freeze') });
    const input = standAt(sim, FIELD_W / 2, 900);
    const s = sim.enemies.find((e) => e.defId === 'shooter')!;
    s.chillTime = 3;
    expect(ofType(runFor(sim, 2.9, input), 'enemyShoot').length).toBeGreaterThan(0);
  });

  it(`얼린 적은 받는 피해 × ${CHILL_DAMAGE_TAKEN_MUL}`, () => {
    const sim = park(['d'], { skill: skillOf('freeze') });
    fill(sim);
    sim.activateSkill();
    sim.drainEvents();
    shoot(sim, { x: colMid(0), y: 800, vx: 0, vy: -800, damage: 100 });
    const hit = ofType(runFor(sim, 1), 'hit')[0];
    expect(hit.damage).toBe(Math.round(100 * CHILL_DAMAGE_TAKEN_MUL));
  });

  it('미끄러지던 RC카는 얼면 그 자리에 선다', () => {
    const sim = park(['c.......'], { skill: skillOf('freeze') });
    const car = sim.enemies.find((e) => e.defId === 'car')!;
    const input = standAt(sim, FIELD_W - 60, 900);
    const evs: CombatEvent[] = [];
    for (let i = 0; i < 120 && ofType(evs, 'shift').length === 0; i++) evs.push(...run(sim, 1, input));
    expect(ofType(evs, 'shift').length).toBe(1);
    run(sim, 3, input);
    fill(sim);
    const x = car.x;
    sim.activateSkill();
    runFor(sim, 2, input);
    expect(car.x).toBe(x);
  });

  it('보스는 저항: 얼지 않고 냉기만 (resisted) — 계속 쏜다(느리게)', () => {
    const sim = park(['X.d'], { skill: skillOf('freeze') });
    const input = standAt(sim, FIELD_W / 2, 900);
    fill(sim);
    sim.activateSkill();
    const evs = sim.drainEvents();
    const boss = sim.enemies.find((e) => e.boss)!;
    const fb = ofType(evs, 'freeze').find((f) => f.enemyId === boss.id)!;
    expect(fb.resisted).toBe(true);
    expect(boss.frozen).toBe(0);
    expect(boss.chillTime).toBe(3);
    expect(ofType(runFor(sim, 2.9, input), 'enemyShoot').some((e) => e.enemyId === boss.id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 온천 타임
// ─────────────────────────────────────────────────────────────

describe('온천 타임 (spring)', () => {
  // 수치(회복 비율·시간·반경)는 데이터에서 — 밸런스 조정이 바꿔도 규칙 검사는 그대로
  const SPRING = (() => {
    const s = data.skills.capybara;
    if (s.kind !== 'spring') throw new Error('capybara skill is not spring');
    return s.spring;
  })();
  const healPct = Math.round(SPRING.healFrac * 100);

  it('최대 HP의 healFrac 회복 (최대 HP까지), skill 이벤트에 실제 회복량', () => {
    const sim = park(['d'], { skill: skillOf('spring'), hp: 50 });
    fill(sim);
    expect(sim.activateSkill()).toBe(true);
    expect(sim.player.hp).toBe(50 + healPct);
    expect(ofType(sim.drainEvents(), 'skill')[0]).toMatchObject({ kind: 'spring', heal: healPct, duration: SPRING.duration });
    const near = park(['d'], { skill: skillOf('spring'), hp: 100 - healPct / 2 });
    fill(near);
    near.activateSkill();
    expect(near.player.hp).toBe(100);
    expect(ofType(near.drainEvents(), 'skill')[0].heal).toBe(healPct / 2);
  });

  it('duration초 동안 둘레(radius)에 들어온 적 탄은 녹아 사라진다 — 그동안 안 맞고, 끝나면 다시 맞는다', () => {
    const sim = park(['s.s.s.s.'], { skill: skillOf('spring') });
    const input = standAt(sim, FIELD_W / 2, 900);
    fill(sim);
    sim.activateSkill();
    sim.drainEvents();
    const during = runFor(sim, SPRING.duration, input);
    expect(ofType(during, 'shotBlocked').length).toBeGreaterThan(Math.floor(1.5 * SPRING.duration));
    expect(ofType(during, 'playerHit')).toEqual([]);
    // 녹은 자리는 모두 기운 안(반경 + 탄 반경)
    for (const b of ofType(during, 'shotBlocked')) expect(Math.hypot(b.x - sim.player.x, b.y - sim.player.y)).toBeLessThan(SPRING.radius + 12 + 1e-6);
    expect(sim.skill!.active).toBe(0);
    const after = runFor(sim, 3, input);
    expect(ofType(after, 'shotBlocked')).toEqual([]);
    expect(ofType(after, 'playerHit').length).toBeGreaterThan(0);
  });

  it('기운 밖의 탄은 그대로 날아간다', () => {
    const sim = park(['s'], { skill: skillOf('spring') });
    const input = standAt(sim, FIELD_W - 50, 900);
    fill(sim);
    sim.activateSkill();
    runFor(sim, 1.5, input);
    expect(sim.enemyShots.length).toBeGreaterThan(0);
    for (const s of sim.enemyShots) expect(Math.hypot(s.x - sim.player.x, s.y - sim.player.y)).toBeGreaterThan(SPRING.radius);
  });
});

// ─────────────────────────────────────────────────────────────
// 털뭉치 폭풍
// ─────────────────────────────────────────────────────────────

describe('털뭉치 폭풍 (storm)', () => {
  const ice: Element[] = ['ice'];
  const loadout = (): WeaponLoadout[] => [
    weapon(1, { damage: 20, cooldown: 1 }),
    weapon(2, { damage: 50, cooldown: 2.5, elements: ['fire'] }),
    // 가장 센 무기: 60 × 2발 / 1초 = 120 dps
    weapon(3, { damage: 60, count: 2, spreadDeg: 20, cooldown: 1, elements: ice }),
  ];
  const spec = data.skills.cat.kind === 'storm' ? data.skills.cat.storm : null!;

  it(`${spec.duration}초 동안 ${spec.count}발 (weaponUid -1 fire), 조준 방향 ±${spec.spreadDeg / 2}° 부채꼴을 왼 → 오 → 왼으로 쓴다`, () => {
    const sim = park(['d'], { skill: skillOf('storm'), loadout: loadout() });
    sim.setLoadout([], PLAYER); // 무기 발사 없이 폭풍 공만 (피해·속성은 발동 때 정해짐 — 아래 테스트)
    fill(sim);
    expect(sim.activateSkill()).toBe(true);
    sim.drainEvents();
    const aim = -Math.PI / 2;
    const input: CombatInput = { ...standAt(sim, FIELD_W / 2, 900), aimAngle: aim };
    const angles: number[] = [];
    let fires = 0;
    let last = 0;
    for (let i = 0; i < 120; i++) {
      const before = new Set(sim.projectiles.map((p) => p.id));
      sim.step(SIM_DT, input);
      for (const ev of sim.drainEvents()) {
        if (ev.type !== 'fire') continue;
        expect(ev.weaponUid).toBe(SKILL_WEAPON_UID);
        expect(ev.count).toBe(1);
        fires++;
        last = sim.time;
      }
      for (const p of sim.projectiles) if (!before.has(p.id) && p.weaponUid === SKILL_WEAPON_UID) angles.push(Math.atan2(p.vy, p.vx));
    }
    expect(fires).toBe(spec.count);
    expect(angles.length).toBe(spec.count);
    expect(last).toBeLessThanOrEqual(spec.duration + SIM_DT + 1e-9);
    const half = (spec.spreadDeg / 2) * DEG;
    expect(angles[0]).toBeCloseTo(aim - half, 9);
    expect(angles[angles.length - 1]).toBeCloseTo(aim - half, 9);
    // 짝수 발이면 가운데 두 발이 끝에서 한 칸(부채꼴 / (n - 1) × 2 안) 모자란다
    expect(Math.max(...angles)).toBeLessThanOrEqual(aim + half + 1e-9);
    expect(Math.max(...angles)).toBeGreaterThanOrEqual(aim + half - ((2 * spec.spreadDeg) / (spec.count - 1)) * DEG);
    for (const a of angles) expect(a).toBeCloseTo(clampAim(a), 12);
    expect(sim.skill!.active).toBe(0);
  });

  it(`1발 = max(minDamage × 데미지 배수, 가장 센 무기 1발 × ${spec.damageMul}), 그 무기의 속성, 관통 ${spec.pierce}, 수명 ${spec.life}초 — 투사체 모양은 무기 공과 같다`, () => {
    const sim = park(['d'], { skill: skillOf('storm'), loadout: loadout() });
    fill(sim);
    sim.activateSkill();
    runFor(sim, 1, { targetX: FIELD_W / 2, targetY: 900, aimAngle: -Math.PI / 2 });
    const storm = sim.projectiles.filter((p) => p.weaponUid === SKILL_WEAPON_UID);
    const normal = sim.projectiles.filter((p) => p.weaponUid !== SKILL_WEAPON_UID);
    expect(storm.length).toBeGreaterThan(0);
    expect(normal.length).toBeGreaterThan(0);
    for (const p of storm) {
      expect(p.damage).toBeCloseTo(60 * spec.damageMul, 9);
      expect(p.elements).toEqual(ice);
      expect(p.radius).toBe(spec.radius);
      expect(p.sprite).toBe(spec.sprite);
      expect((p as ProjectileEntity & { maxAge: number }).maxAge).toBe(spec.life);
      expect(Object.keys(p).join(',')).toBe(Object.keys(normal[0]).join(','));
    }
    // 무기가 없거나 약하면 하한: minDamage × 전역 데미지 배수
    const weak = park(['d'], { skill: skillOf('storm'), player: { damageMul: 1.5 } });
    fill(weak);
    weak.activateSkill();
    runFor(weak, 0.5, { targetX: FIELD_W / 2, targetY: 900, aimAngle: -Math.PI / 2 });
    const ws = weak.projectiles.filter((p) => p.weaponUid === SKILL_WEAPON_UID);
    expect(ws.length).toBeGreaterThan(0);
    for (const p of ws) {
      expect(p.damage).toBeCloseTo(spec.minDamage * 1.5, 9);
      expect(p.elements).toEqual([]);
    }
  });

  it('폭풍 공의 적중(관통 포함)은 피해를 주지만 게이지는 안 찬다', () => {
    const sim = park(['dddddddd'], { skill: skillOf('storm', 1e6), loadout: loadout() });
    sim.setLoadout([], PLAYER);
    fill(sim);
    sim.activateSkill();
    const evs = runFor(sim, 2, { targetX: FIELD_W / 2, targetY: 900, aimAngle: -Math.PI / 2 });
    expect(ofType(evs, 'hit').length).toBeGreaterThan(10);
    expect(sim.skill!.charge).toBe(0);
  });

  it('자동조준(조준각 없음)이면 대상 쪽을 중심으로', () => {
    const sim = park(['.......d'], { skill: skillOf('storm') });
    fill(sim);
    sim.activateSkill();
    const input = standAt(sim, 100, 900);
    const evs = run(sim, 1, input);
    expect(ofType(evs, 'fire').length).toBe(1);
    const p = sim.projectiles.find((q) => q.weaponUid === SKILL_WEAPON_UID)!;
    const d = sim.enemies.find((e) => e.defId === 'dummy')!;
    const toTarget = Math.atan2(d.y + d.h / 2 - (sim.player.y - 30), d.x + d.w / 2 - sim.player.x);
    expect(Math.atan2(p.vy, p.vx)).toBeCloseTo(clampAim(toTarget - (spec.spreadDeg / 2) * DEG), 1);
  });
});

// ─────────────────────────────────────────────────────────────
// 히트스톱·보스 포효 중 · 결정성
// ─────────────────────────────────────────────────────────────

describe('스텝 사이(히트스톱)·보스 포효 중 발동, 결정성', () => {
  it('히트스톱(스텝이 멈춘 사이) 발동: 즉시 효과·이벤트는 바로, 시간 효과는 스텝이 흘러야 줄어든다. RNG를 쓰지 않는다', () => {
    const sim = park(['s.s'], { skill: skillOf('freeze') });
    fill(sim);
    const rng = (sim as unknown as { rng: { state: number } }).rng;
    const state = rng.state;
    expect(sim.activateSkill()).toBe(true);
    expect(rng.state).toBe(state);
    const evs = sim.drainEvents();
    expect(ofType(evs, 'skill').length).toBe(1);
    expect(ofType(evs, 'freeze').length).toBe(2);
    // 스텝 없이는 얼림·효과 시간이 그대로
    for (const e of visible(sim)) expect(e.frozen).toBe(3);
    expect(sim.skill!.active).toBe(3);
    sim.step(SIM_DT, IDLE);
    for (const e of visible(sim)) expect(e.frozen).toBeCloseTo(3 - SIM_DT, 12);
    expect(sim.skill!.active).toBeCloseTo(3 - SIM_DT, 12);
  });

  it('보스 포효 중(무적): 빙하기는 보스에게 냉기를 걸지 않고(졸개는 얼림), 폭풍은 보스 HP를 깎지 않는다', () => {
    const stage = data.bossTest.stage;
    const mk = (skill: SkillDef): CombatSim =>
      new CombatSim({ stage, stageIndex: 0, enemies: data.enemies, bosses: data.bosses, loadout: [], player: { ...PLAYER, maxHp: 1e6 }, hp: 1e6, seed: 4, skill });
    const input: CombatInput = { targetX: FIELD_W / 2, targetY: 900, aimAngle: -Math.PI / 2 };
    const toRoar = (sim: CombatSim): void => {
      for (let i = 0; i < 1200 && sim.boss!.mode !== 'roar'; i++) {
        sim.step(SIM_DT, input);
        sim.drainEvents();
      }
      expect(sim.boss!.mode).toBe('roar');
    };
    const frz = mk(skillOf('freeze'));
    toRoar(frz);
    (frz as unknown as { chargeAcc: number; chargeNeed: number }).chargeAcc = 1e12;
    expect(frz.activateSkill()).toBe(true);
    const boss = frz.enemies.find((e) => e.boss)!;
    const evs = frz.drainEvents();
    expect(boss.chillTime).toBe(0);
    expect(ofType(evs, 'freeze').some((f) => f.enemyId === boss.id)).toBe(false);
    const minions = visible(frz).filter((e) => !e.boss);
    expect(minions.length).toBeGreaterThan(0);
    for (const m of minions) expect(m.frozen).toBe(3);

    const storm = mk(skillOf('storm'));
    toRoar(storm);
    (storm as unknown as { chargeAcc: number; chargeNeed: number }).chargeAcc = 1e12;
    const king = storm.enemies.find((e) => e.boss)!;
    const hp = king.hp;
    expect(storm.activateSkill()).toBe(true);
    for (let i = 0; i < 600 && storm.boss!.mode === 'roar'; i++) {
      storm.step(SIM_DT, input);
      storm.drainEvents();
    }
    expect(king.hp).toBe(hp);
  });

  /**
   * 실제 데이터 한 판(보스 테스트 프리셋 가방 — 중후반 빌드로 끝까지 간다): 정해진 스텝마다 activateSkill — 이벤트 로그.
   * 결정성·여러 번 발동 검사라 밸런스 수치와 떼어 둔다: 스테이지 HP 배수는 프리셋 가방이 90초 안에 끝내는 3, 게이지 필요량은 800
   */
  function scripted(character: string, stageIndex: number, seed: number, every: number): { log: string; uses: number } {
    const r = newBossTestRun(data, character, seed);
    const sim = new CombatSim({
      stage: { ...data.stages[stageIndex], hpMul: 3 },
      stageIndex,
      enemies: data.enemies,
      loadout: runLoadout(data, r),
      player: { ...runPlayerStats(data, r), maxHp: 1e5 },
      hp: 1e5,
      seed: combatSeed(r),
      skill: { ...runSkill(data, r)!, charge: 800 },
    });
    const out: string[] = [];
    for (let i = 0; i < 90 * 60 && sim.status === 'running'; i++) {
      if (i % every === 0) sim.activateSkill();
      sim.step(SIM_DT, { targetX: 336 + 240 * Math.sin(i / 70), targetY: 880, aimAngle: -Math.PI / 2 + 0.6 * Math.sin(i / 90) });
      for (const ev of sim.drainEvents()) out.push(JSON.stringify(ev));
    }
    return { log: `${sim.status} ${sim.time} ${sim.player.hp} ${out.join('\n')}`, uses: sim.skill!.uses };
  }

  it.each(['penguin', 'capybara', 'cat'])('%s: 같은 시드·입력·발동 시점 → 같은 결과 (st3, 실제 데이터) — 스킬을 실제로 여러 번 쓴다', (ch) => {
    const a = scripted(ch, 2, 5, 60);
    const b = scripted(ch, 2, 5, 60);
    expect(a.log).toBe(b.log);
    expect(a.log.startsWith('won')).toBe(true);
    expect(a.uses).toBeGreaterThanOrEqual(2);
    expect(scripted(ch, 2, 5, 61).log).not.toBe(a.log);
  });

  it('보스 테스트(프리셋 가방)에서도 세 스킬이 차고 발동된다 — NaN 없음', () => {
    for (const ch of ['penguin', 'capybara', 'cat']) {
      const r = newBossTestRun(data, ch, 3);
      const sim = new CombatSim({
        stage: currentStage(data, r),
        stageIndex: 0,
        enemies: data.enemies,
        bosses: data.bosses,
        loadout: runLoadout(data, r),
        player: { ...runPlayerStats(data, r), maxHp: 1e5 },
        hp: 1e5,
        seed: combatSeed(r),
        skill: runSkill(data, r),
      });
      const kinds = new Set<string>();
      for (let i = 0; i < 80 * 60 && sim.status === 'running'; i++) {
        sim.activateSkill();
        sim.step(SIM_DT, { targetX: 336 + 240 * Math.sin(i / 70), targetY: 880, aimAngle: -Math.PI / 2 + 0.6 * Math.sin(i / 90) });
        for (const ev of sim.drainEvents()) kinds.add(ev.type);
      }
      expect(sim.skill!.uses, ch).toBeGreaterThanOrEqual(1);
      expect(kinds.has('skill')).toBe(true);
      expect(Number.isFinite(sim.player.hp)).toBe(true);
      for (const e of sim.enemies) expect(Number.isFinite(e.hp)).toBe(true);
    }
  });
});
