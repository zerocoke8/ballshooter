// 재미 기능 전체를 한꺼번에 (적대적 검토 — docs/DESIGN.md '백어택과 행동하는 적'·'시너지 아이템'·'액티브 스킬'):
// 행동하는 적으로 빽빽한 대형(폭탄병·젤리·RC카·치유병·방패병·장갑병) + 시너지 아이템 12종이 다 든 7×6 가방(연쇄·밀도 최대)과
// 캐릭터 시작 가방(느려서 치유·옆걸음이 오래 일어남), 캐릭터 스킬을 아무 때나 — 매 스텝 불변식을 본다: 적끼리 겹치지 않음(RC카 미끄러짐·꼬마 젤리·폭탄 연쇄 중에도), 필드 밖으로 안 나감,
// 'kill'은 적마다 한 번(폭탄 + 폭죽 + 성냥 연쇄), 꼬마 젤리는 플레이어 몸·필드 밖·방어선에 안 생김, 진행도는 줄지 않고 이기면 처치 = 전체,
// 회복이 최대 HP를 넘지 않음, NaN 없음, 투사체 수명 상한(트램펄린·유도·씨앗 자식도).
import { describe, expect, it } from 'vitest';
import { CELL, ENEMY_INSET, FIELD_H, FIELD_W, PLAYER_HIT_RADIUS, PROJECTILE_MAX_AGE, SIM_DT } from '../src/config';
import { GAME_DATA } from '../src/data';
import { addNewToBag, createBag } from '../src/logic/bag';
import { CombatSim } from '../src/logic/combat/sim';
import { Rng } from '../src/logic/rng';
import { combatSeed, newRun, runLoadout, runPlayerStats, runSkill } from '../src/logic/run';
import type { CombatInput, Rot, StageDef } from '../src/types';

/** tests/synergy.test.ts의 스트레스 가방과 같은 배치 (무기 9 + 시너지 돌 9 + 시너지 장비 4 + 분신 거울 2) */
const LAYOUT: { defId: string; x: number; y: number; rot?: Rot }[] = [
  { defId: 'w_static_hairball', x: 0, y: 0 }, { defId: 's_coil', x: 1, y: 0 }, { defId: 'w_sock_gatling', x: 2, y: 0 },
  { defId: 's_seed', x: 3, y: 0 }, { defId: 'w_hairball', x: 4, y: 0 }, { defId: 's_mirror', x: 5, y: 0 }, { defId: 'w_yuzu', x: 6, y: 0 },
  { defId: 's_rubber', x: 0, y: 1 }, { defId: 's_hammer', x: 1, y: 1 }, { defId: 's_ribbon', x: 2, y: 1 }, { defId: 's_wheel', x: 3, y: 1 },
  { defId: 's_mushroom', x: 4, y: 1 }, { defId: 's_match', x: 5, y: 1 }, { defId: 's_mirror', x: 6, y: 1 },
  { defId: 'w_flame_toaster', x: 0, y: 2 }, { defId: 'w_melon_bingsu', x: 2, y: 2 }, { defId: 'w_mama_duck', x: 4, y: 2 },
  { defId: 'w_tuna_missile', x: 5, y: 2 }, { defId: 'g_kettle', x: 5, y: 3 }, { defId: 'g_firecracker', x: 6, y: 3 },
  { defId: 'g_trampoline', x: 0, y: 4 }, { defId: 'g_backcoin', x: 2, y: 4 }, { defId: 's_seed', x: 6, y: 4 },
  { defId: 'w_yuzu_molotov', x: 6, y: 5 },
];

/**
 * 행동하는 적으로 빽빽한 st4 크기의 대형 (위 → 아래로 적음): x 폭탄병 · g 젤리 · c RC카 · h 치유병 · k 방패병 · a 장갑병, 줄마다 틈 1칸.
 * 맨 위 웨이브는 블록(b — 단단해 한 방에 안 죽는다) 사이 치유병 — 다친 이웃이 살아 있어야 치유가 일어난다
 */
const HEAVY = [
  'bhbb.bhb', 'bbhb.bbh', 'hbb.bhbb',
  '........',
  'xgcxgc.x', 'gxhgx.cg', 'cx.gxkxg', 'xg.cgxhx', 'kxgx.gxc', 'gcx.xgkx',
  '........',
  'cgxc.gxa', 'axg.cxgx', 'xh.xgcxg', 'gxk.xgxc', 'cxgx.axg', 'xgcgx.xh',
];

/** synergy = 시너지 스트레스 가방(빨리 끝남 — 연쇄·밀도), 아니면 캐릭터 시작 가방(느림 — 치유·옆걸음이 실제로 오래 일어난다) */
function heavySim(seed: number, characterId: string, synergy: boolean): CombatSim {
  const run = newRun(GAME_DATA, characterId, seed);
  if (synergy) {
    run.bag = createBag(7, 6);
    for (const it of LAYOUT) expect(addNewToBag(run.bag, GAME_DATA.items, it.defId, 1, it.x, it.y, it.rot ?? 0)).not.toBeNull();
  }
  run.stageIndex = 3;
  const stage: StageDef = { ...GAME_DATA.stages[3], id: 'fun_heavy', rows: [...HEAVY].reverse() };
  const ps = runPlayerStats(GAME_DATA, run);
  return new CombatSim({
    stage,
    stageIndex: 3,
    enemies: GAME_DATA.enemies,
    bosses: GAME_DATA.bosses,
    loadout: runLoadout(GAME_DATA, run),
    // 적 탄에 지지 않게 (판정·연쇄를 끝까지 보려고) — 접촉 패배는 그대로
    player: { ...ps, maxHp: 1e6 },
    hp: 1e6,
    seed: combatSeed(run) ^ seed,
    skill: runSkill(GAME_DATA, run),
  });
}

describe('재미 기능 전체 불변식 (행동하는 적 + 시너지 12종 + 스킬)', () => {
  it.each(['cat', 'penguin', 'capybara'])('%s: 시너지 가방(끝까지)·시작 가방(60초) — 겹침·중복 처치·위험한 꼬마 젤리·진행도·NaN 없음', (characterId) => {
    const kinds = new Set<string>();
    for (const synergy of [true, false]) {
      const seed = synergy ? 1 : 2;
      const sim = heavySim(seed, characterId, synergy);
      const rng = new Rng(seed * 7919);
      const killed = new Set<number>();
      let lastProgress = 0;
      let tx = FIELD_W / 2;
      let ty = 860;
      for (let i = 0; i < (synergy ? 120 : 60) / SIM_DT && sim.status === 'running'; i++) {
        // 아래쪽 띠를 이리저리 걸으며 조준을 흔든다, 스킬은 찰 때마다 가끔
        if (i % 40 === 0) {
          tx = 60 + rng.next() * (FIELD_W - 120);
          ty = 700 + rng.next() * 220;
        }
        const input: CombatInput = { targetX: tx, targetY: ty, aimAngle: -Math.PI / 2 + 1.2 * Math.sin(i / 37) };
        if (sim.skill?.ready && rng.next() < 0.05) sim.activateSkill();
        sim.step(SIM_DT, input);
        for (const ev of sim.drainEvents()) {
          kinds.add(ev.type === 'explode' && ev.cause ? ev.cause : ev.type);
          if (ev.type === 'kill') {
            expect(killed.has(ev.enemyId), `kill twice #${ev.enemyId}`).toBe(false);
            killed.add(ev.enemyId);
          } else if (ev.type === 'enemySpawn') {
            // 꼬마 젤리 칸(충돌 박스): 플레이어 피격 원과 떨어짐, 필드 안, 방어선 위
            const hw = CELL / 2 - ENEMY_INSET;
            const pl = sim.player;
            const dx = pl.x - Math.max(ev.x - hw, Math.min(pl.x, ev.x + hw));
            const dy = pl.y - Math.max(ev.y - hw, Math.min(pl.y, ev.y + hw));
            expect(Math.hypot(dx, dy) - PLAYER_HIT_RADIUS, 'splitling on the player').toBeGreaterThan(0);
            expect(ev.x - hw >= ENEMY_INSET - 0.5 && ev.x + hw <= FIELD_W - ENEMY_INSET + 0.5, 'splitling outside').toBe(true);
            expect(ev.y + hw, 'splitling on the defence line').toBeLessThan(FIELD_H);
          }
        }
        const progress = sim.progress();
        expect(progress, 'progress went down').toBeGreaterThanOrEqual(lastProgress - 1e-9);
        lastProgress = progress;
        for (const p of sim.projectiles) {
          expect(Number.isFinite(p.x + p.y + p.vx + p.vy + p.damage), 'projectile NaN').toBe(true);
          expect(p.age, 'projectile outlived its cap').toBeLessThanOrEqual(PROJECTILE_MAX_AGE + SIM_DT);
        }
        if (i % 6 !== 0) continue;
        const es = sim.enemies;
        for (let a = 0; a < es.length; a++) {
          const A = es[a];
          expect(Number.isFinite(A.x + A.y + A.hp), 'enemy NaN').toBe(true);
          expect(A.x >= ENEMY_INSET - 0.5 && A.x + A.w <= FIELD_W - ENEMY_INSET + 0.5, `${A.defId} left the field`).toBe(true);
          expect(A.hp, `${A.defId} overhealed`).toBeLessThanOrEqual(A.maxHp + 1e-6);
          for (let b = a + 1; b < es.length; b++) {
            const B = es[b];
            const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
            const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
            expect(ox > 1 && oy > 1, `${A.defId}#${A.id} overlaps ${B.defId}#${B.id} at t=${sim.time.toFixed(2)}`).toBe(false);
          }
        }
      }
      if (!synergy) continue;
      expect(sim.status, `${characterId} synergy`).toBe('won');
      expect(sim.killedEnemies).toBe(sim.totalEnemies);
      expect(sim.skill!.uses).toBeGreaterThan(0);
    }
    // 이 판들에서 새 규칙이 실제로 일어났다
    for (const k of ['heal', 'shift', 'enemySpawn', 'blocked', 'burnSpread', 'firecracker', 'steam', 'skill']) expect(kinds.has(k), k).toBe(true);
  }, 60000);
});
