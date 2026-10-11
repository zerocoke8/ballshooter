import type { BossDef } from '../types';

// 보스 행동 데이터. sim(logic/combat/sim.ts)의 스케줄러가 페이즈마다 가중치·쿨타임으로 행동을 하나씩 고른다(시드 RNG — 결정적).
// 피해는 전부 stage.dmgMul이 곱해진다. 모든 피해 공격은 걸어서(420 px/s, 반응 0.25초) 피할 수 있게 만든다:
//  - 일제 사격: 발사 순간의 플레이어를 노린 부채꼴. 바닥(입에서 약 450 px)에서 발 사이 ≈ 94 px — 옆으로 한 걸음(≈ 50 px)이면 틈,
//    부채꼴 밖까지는 약 240 px(0.6초). 탄이 바닥까지 약 2초.
//  - 팽이 고리: 발 사이가 촘촘해(바닥에서 ≈ 83 px — 팽이 지름 + 몸 지름보다 겨우 넓다) 사실상 벽이고, 이어진 3발을 비운 빈틈(4칸 ≈ 43°)이
//    플레이어 쪽(가로 gapShiftPx 안)에 생긴다. 웨이브마다 5°씩 돌아도 두 웨이브의 빈틈이 38° 겹친다.
//  - 내려찍기: 예고 1초(발동 0.25초) — 2열(168 px) 폭이 플레이어 쪽으로 걸쳐 놓여 가장 멀어야 104 px만 비키면 된다.
//  - 구슬 비: 예고 1초, 그림자 반경 40 — 하나는 플레이어 자리, 나머지는 서로 150 px 이상 떨어져 사이로 빠져나갈 수 있다.
//  - 행동은 한 번에 하나(예비 동작 → 실행 → recover → 페이즈 gap). 졸개(다트총·로봇)는 일반 적과 같은 규칙으로 쏜다.
// 조정(tests/balance.probe.test.ts 'boss test', docs/DESIGN.md '보스 테스트 모드 — 조정'):
//  - 졸개 = 방패: 6칸 줄을 통째로 자주 소환(4초, 가중치 6)하고 대부분 쏘지 않는 태엽 병정 — 보스 아래를 막아 공이 보스 대신 졸개를 맞고
//    (직접 적중의 약 23~32%), 양옆 통로로 넘겨 윗면을 치는 '백어택'이 더 값지다. 살아있는 졸개 평균 약 3.5~4.5, 최대 10~12.
//  - 쏘는 졸개는 적게(페이즈마다 가중치의 10 / 20 / 27%): 깊이 내려온 졸개가 가까이서 노려 쏘는 탄은 반응 0.25초로 못 피한다. 깜짝 상자 졸개(조준 3발 부채꼴)는
//    뺐다 — 남아 있던 '피할 수 없는 피해'가 전부 깜짝 상자 스프링 + 보스 사격·팽이 고리의 겹침이었다(보스 내려찍기 그림은 그대로 깜짝 상자).
//  - 연속 사격은 3발 24°(두 부채꼴 합 30°): 5발 48°는 합 54°로 바닥 폭 대부분을 덮어 플레이어를 벽에 몰고, 거기서 졸개 탄에 갇혔다.
//  - 기어 내려오기 3 px/s: 6이면 오래 걸리는 판(3페이즈 40~60초)에서 보스 아래 끝이 플레이어 띠까지 내려와 그 아래 소환된 졸개에 닿았다.

const BOSS_LIST: BossDef[] = [
  {
    id: 'toybox_king',
    enemy: 'toybox_king',
    // 1~6열, 칸 위끝 84 → 충돌 박스 위끝 88 = 천장과의 틈 88 px, 양옆 0·7열(88 px)이 공이 돌아 올라가는 길
    anchorCol: 1,
    anchorY: 84,
    enterSpeed: 280,
    phases: [
      {
        hpFrac: 1,
        roar: 1.0,
        gap: 1.4,
        cooldownMul: 1,
        enterSummon: 6,
        minionCap: 10,
        creep: 0,
        minions: [
          { enemy: 'soldier', weight: 7 },
          { enemy: 'balloon', weight: 2 },
          { enemy: 'dartgun', weight: 1 },
        ],
      },
      {
        hpFrac: 0.7,
        roar: 1.5,
        gap: 1.1,
        cooldownMul: 0.85,
        enterSummon: 6,
        minionCap: 12,
        creep: 0,
        minions: [
          { enemy: 'soldier', weight: 6 },
          { enemy: 'balloon', weight: 2 },
          { enemy: 'dartgun', weight: 1 },
          { enemy: 'robot', weight: 1 },
        ],
      },
      {
        // 마지막 페이즈: 천천히 기어 내려온다(압박 — 보스 아래 끝이 바닥에 닿으면 패배). 졸개 하강(12)보다 느려 졸개와 겹치지 않는다
        hpFrac: 0.35,
        roar: 1.8,
        gap: 0.8,
        cooldownMul: 0.7,
        enterSummon: 6,
        minionCap: 14,
        creep: 3,
        minions: [
          { enemy: 'soldier', weight: 6 },
          { enemy: 'balloon', weight: 2 },
          { enemy: 'dartgun', weight: 1 },
          { enemy: 'robot', weight: 2 },
        ],
      },
    ],
    actions: [
      {
        id: 'block_volley',
        kind: 'volley',
        windup: 0.6,
        cooldown: 3.5,
        // 블록이 바닥 근처를 지나갈 때까지 다음 행동(특히 내려찍기 예고)을 미룬다
        recover: 0.8,
        weights: [4, 3, 0],
        volley: {
          sprite: 'shot_block',
          radius: 16,
          speed: 230,
          damage: 6,
          count: 5,
          spreadDeg: 48,
          bursts: 1,
          burstInterval: 0.5,
          reaim: true,
          burstShiftDeg: 0,
        },
      },
      {
        // 두 번째 부채꼴은 첫 부채꼴의 틈(발 사이 12°의 절반)을 메운다 — 틈 사이로는 못 빠지고 부채꼴 밖으로 나가야 한다.
        // 다시 노리지 않는다: 따라오는 두 번째 부채꼴은 피하는 플레이어를 구석에 몰아 피할 자리가 없어졌다(프로브 이상적인 회피).
        // 3발 24°(합 30° — 바닥에서 약 240 px 폭): 예전 5발 48°(합 54°, 약 460 px)는 벽까지 몰아 졸개 탄과 겹치면 피할 자리가 없었다
        id: 'block_barrage',
        kind: 'volley',
        windup: 0.6,
        cooldown: 4,
        recover: 1.0,
        weights: [0, 1, 3],
        volley: {
          sprite: 'shot_block',
          radius: 16,
          speed: 230,
          damage: 6,
          count: 3,
          spreadDeg: 24,
          bursts: 2,
          burstInterval: 0.6,
          reaim: false,
          burstShiftDeg: 6,
        },
      },
      {
        id: 'jack_slam',
        kind: 'slam',
        windup: 0.3,
        cooldown: 6,
        weights: [3, 3, 0],
        slam: { cols: 2, warn: 1.0, active: 0.25, damage: 14, repeats: 1, repeatInterval: 0.3, sprite: 'enemy_jack' },
      },
      {
        id: 'jack_slam_double',
        kind: 'slam',
        windup: 0.3,
        cooldown: 6,
        weights: [0, 0, 3],
        slam: { cols: 2, warn: 1.0, active: 0.25, damage: 14, repeats: 2, repeatInterval: 0.3, sprite: 'enemy_jack' },
      },
      {
        id: 'top_spiral',
        kind: 'ring',
        windup: 0.8,
        cooldown: 7,
        // 고리가 바닥을 지나갈 때까지 다음 행동을 미룬다 (다른 공격과 겹쳐 피할 자리가 없어지지 않게)
        recover: 1.6,
        weights: [0, 3, 3],
        ring: {
          sprite: 'shot_top',
          radius: 16,
          speed: 210,
          damage: 5,
          count: 15,
          arcDeg: 150,
          gap: 3,
          gapShiftPx: 200,
          waves: 2,
          waveInterval: 0.45,
          rotateDeg: 5,
        },
      },
      {
        id: 'marble_rain',
        kind: 'marbles',
        windup: 0.5,
        cooldown: 8,
        weights: [0, 2, 3],
        marbles: {
          sprite: 'shot_marble',
          count: 6,
          aimed: 1,
          radius: 40,
          warn: 1.0,
          active: 0.15,
          damage: 8,
          stagger: 0.15,
          spacing: 150,
          yMinFrac: 0.55,
        },
      },
      {
        // 보스 아래 줄 6칸을 통째로 (빈 칸만 — 앞 졸개가 한 칸 내려가거나 죽어야 다시 찬다. 졸개 하강 12 px/s면 7초)
        id: 'summon',
        kind: 'summon',
        windup: 0.7,
        cooldown: 4,
        weights: [6, 6, 6],
        summon: { count: 6 },
      },
    ],
  },
];

export const BOSSES: Record<string, BossDef> = Object.fromEntries(BOSS_LIST.map((d) => [d.id, d]));
