import type { BossTestDef, BossTestPreset, StageDef } from '../types';

// 보스 테스트 모드: 타이틀 '보스 테스트' → 캐릭터 선택 → 바로 보스전. 일반 런 세이브와 완전히 따로(logic/run.ts newBossTestRun).
// 주인공은 이미 어느 정도 키운 가방(중후반 빌드)으로 풀 HP에서 시작한다. 전투 중 가방을 열어 배치를 바꿀 수 있다.

/**
 * 보스 테스트 스테이지. rows는 비운다 — 위에서 내려오는 대형은 보스와 겹치므로 졸개는 보스가 소환한다(src/data/bosses.ts).
 * hpMul·dmgMul은 졸개(EnemyDef)와 보스 행동 피해 모두에 곱해진다. descentSpeed = 졸개가 내려오는 속도(보스는 고정, 마지막 페이즈만 기어 내려옴).
 * 조정(docs/DESIGN.md '보스 테스트 모드 — 조정'): hpMul은 사실상 졸개 체력 손잡이 — 보스 체력은 EnemyDef hp(1700)와 곱해 28,900.
 * 졸개 체력 ×17(태엽 병정 425)이라야 보스 아래를 막는 방패로 몇 초 버틴다. 하강 12: 더 빠르면 졸개가 플레이어 바로 위까지 내려와
 * 가까이서 쏘는 탄을 반응 0.25초로 못 피했다. dmgMul 1.9: 프로브 회피 AI(수동 조준) 승률 63~79%가 되도록 (블록 한 발 11.4).
 */
export const BOSS_TEST_STAGE: StageDef = {
  id: 'boss_test',
  name: '장난감 상자 대마왕',
  descentSpeed: 12,
  hpMul: 17,
  dmgMul: 1.9,
  clearGold: 0,
  rows: [],
  legend: {},
  background: 'bg_toyroom',
  boss: 'toybox_king',
};

// 프리셋 가방 6×5 (위 → 아래). 무기 5개(진화 무기 1개 포함, ★2 몇 개), 버프 돌 3개(모두 무기에 맞닿음), 장비 1~2개.
// 합성할 거리(★합성 쌍·레시피 소켓 재료)는 남기지 않는다 — 시작하자마자 '합성 가능' 반짝임이 뜨지 않게 (tests/boss.test.ts가 검사).
// 조정 기준(tests/balance.probe.test.ts 'boss test'):
//  - 반창고(초당 HP 1)는 뺐다: 보스전이 1분 반~2분이라 HP를 100 넘게 채워 줘 반창고가 있는 캐릭터는 거의 지지 않았다.
//  - 관통 무기는 캐릭터마다 하나만: 관통 공은 보스를 뚫고 윗면에서 덜그럭거려(백어택) 보스 피해의 절반 이상을 낸다. 둘이면 보스가 녹는다
//    (냥냥 정전기 털뭉치에 드릴을 붙이면 42초). 펭구 = 참치 미사일, 카피·냥냥 = 양말★2 (+ 냥냥 토스터에 드릴 — 약한 무기라 괜찮다).
//  - 승률은 체력에 가장 민감하다(같은 회피라면 맞는 양이 비슷): 카피 175(냄비), 냥냥 150(냄비 둘), 펭구 144(냄비 + 운동화 — 빠르게 피함).
const PRESETS: Record<string, BossTestPreset> = {
  // 펭구: 얼음 참치 미사일★2 + 토스터·고무오리에 얼음, 양말 (양말★2면 관통이 둘이라 보스전이 85초로 다른 캐릭터보다 30초 짧았다)
  //   y0  참치★2 참치★2 공격  양말   유자  냄비
  //   y1  토스터 토스터 태엽  오리   .     냄비
  //   y2  토스터 토스터 얼음  오리   .     .
  //   y3  .      .      .     .      .     .
  //   y4  운동화 .      .     .      .     .
  penguin: {
    cols: 6,
    rows: 5,
    items: [
      { defId: 'w_tuna_missile', x: 0, y: 0, rot: 0, tier: 2 },
      { defId: 's_power', x: 2, y: 0, rot: 0 },
      { defId: 'w_sock', x: 3, y: 0, rot: 0 },
      { defId: 'w_yuzu', x: 4, y: 0, rot: 0 },
      { defId: 'g_potlid', x: 5, y: 0, rot: 0 },
      { defId: 'w_toaster', x: 0, y: 1, rot: 0 },
      { defId: 's_haste', x: 2, y: 1, rot: 0 },
      { defId: 'w_duck', x: 3, y: 1, rot: 0 },
      { defId: 's_ice', x: 2, y: 2, rot: 0 },
      { defId: 'g_sneakers', x: 0, y: 4, rot: 0 },
    ],
  },
  // 카피: 유자 화염병★2 + 유자·털뭉치에 태엽, 양말★2·수박에 얼음. 장비는 냄비 하나(맷집 캐릭터 — 체력 +40%라 175)
  //   y0  화염병★2 공격  양말★2 얼음 수박 수박
  //   y1  태엽     털뭉치 .     .    수박 수박
  //   y2  유자     .     .     .    .    냄비
  //   y3  .        .     .     .    .    냄비
  //   y4  .        .     .     .    .    .
  capybara: {
    cols: 6,
    rows: 5,
    items: [
      { defId: 'w_yuzu_molotov', x: 0, y: 0, rot: 0, tier: 2 },
      { defId: 's_power', x: 1, y: 0, rot: 0 },
      { defId: 'w_sock', x: 2, y: 0, rot: 0, tier: 2 },
      { defId: 's_ice', x: 3, y: 0, rot: 0 },
      { defId: 'w_watermelon', x: 4, y: 0, rot: 0 },
      { defId: 's_haste', x: 0, y: 1, rot: 0 },
      { defId: 'w_hairball', x: 1, y: 1, rot: 0 },
      { defId: 'w_yuzu', x: 0, y: 2, rot: 0 },
      { defId: 'g_potlid', x: 5, y: 2, rot: 0 },
    ],
  },
  // 냥냥: 정전기 털뭉치★2 + 분신 거울(고무오리★2와 같이), 털뭉치★2, 드릴 토스터, 양말★2. 장비는 냄비 둘(체력 100 → 150)
  // (양말: 관통 1 — 보스를 뚫고 윗면에 올라가는 공. 처음엔 냉동 생선이었는데 관통 무기가 없어 보스전이 다른 캐릭터의 두 배 걸렸다.
  //  토스터 드릴: 불 토스터일 때는 체력 150으로도 승률이 다른 캐릭터보다 20~30%p 낮았다)
  //   y0  정전기★2 공격 털뭉치★2 .    양말★2 냄비
  //   y1  거울     .    .        .    .    냄비
  //   y2  오리★2   토스터 토스터 드릴 .    .
  //   y3  오리★2   토스터 토스터 .    .    냄비
  //   y4  .        .    .        .    .    냄비
  cat: {
    cols: 6,
    rows: 5,
    items: [
      { defId: 'w_static_hairball', x: 0, y: 0, rot: 0, tier: 2 },
      { defId: 's_power', x: 1, y: 0, rot: 0 },
      { defId: 'w_hairball', x: 2, y: 0, rot: 0, tier: 2 },
      { defId: 'w_sock', x: 4, y: 0, rot: 0, tier: 2 },
      { defId: 's_mirror', x: 0, y: 1, rot: 0 },
      { defId: 'w_duck', x: 0, y: 2, rot: 0, tier: 2 },
      { defId: 'w_toaster', x: 1, y: 2, rot: 0 },
      { defId: 's_drill', x: 3, y: 2, rot: 0 },
      { defId: 'g_potlid', x: 5, y: 0, rot: 0 },
      { defId: 'g_potlid', x: 5, y: 3, rot: 0 },
    ],
  },
};

export const BOSS_TEST: BossTestDef = {
  stage: BOSS_TEST_STAGE,
  presets: PRESETS,
};
