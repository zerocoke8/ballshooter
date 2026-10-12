import type { BoonDef, BoonId } from '../types';

// 레벨업 런 보너스 (docs/DESIGN.md '레벨업'). effect는 1중첩 값 — 중첩 수만큼 더해진다(logic/stats.ts boonBonus).
// 아이콘은 전용 그림이 아직 없어 비슷한 아이템·UI 아이콘을 빌린다(assets.json에 있는 키).
// 밸런스 조정(docs/DESIGN.md '레벨업' — 그리디 평가): 나왔을 때 고른 비율이 뒤통수 전문가 7~33%로 가장 낮아 +15 → +25%,
// 한 발 더는 50~70%로 가장 높아 가중치 6 → 5 (최대 2중첩이라 그대로 두어도 '늘 이기는' 보너스는 아니다).
// 설명은 1중첩 수치를 그대로 말한다(tests/levelup.test.ts가 데이터와 대조).
const BOON_LIST: BoonDef[] = [
  {
    id: 'power',
    name: '든든한 간식',
    desc: '모든 무기 데미지 +10%.',
    icon: 'item_s_power',
    maxStacks: 5,
    weight: 10,
    effect: { damageMul: 0.1 },
  },
  {
    id: 'haste',
    name: '빠른 손놀림',
    desc: '모든 무기 쿨타임 -8%.',
    icon: 'item_s_haste',
    maxStacks: 4,
    weight: 10,
    effect: { cooldownMul: -0.08 },
  },
  {
    id: 'swift',
    name: '가벼운 발걸음',
    desc: '이동 속도 +12%.',
    icon: 'item_g_sneakers',
    maxStacks: 3,
    weight: 8,
    effect: { moveSpeedMul: 0.12 },
  },
  {
    id: 'vitality',
    name: '꿀잠 베개',
    desc: '최대 HP +20, 바로 HP 20 회복.',
    icon: 'ui_heart',
    maxStacks: 5,
    weight: 10,
    effect: { maxHpAdd: 20, heal: 20 },
  },
  {
    id: 'multishot',
    name: '한 발 더',
    desc: '가장 빨리 쏘는 무기의 발사 수 +1.',
    icon: 'item_s_mirror',
    maxStacks: 2,
    weight: 5,
    effect: { extraShots: 1 },
  },
  {
    id: 'backstab',
    name: '뒤통수 전문가',
    desc: '백어택(적의 윗면 타격) 피해 +25%.',
    icon: 'item_s_hammer',
    maxStacks: 4,
    weight: 8,
    effect: { backAttackBonus: 0.25 },
  },
];

export const BOONS: Record<BoonId, BoonDef> = Object.fromEntries(BOON_LIST.map((d) => [d.id, d])) as Record<BoonId, BoonDef>;

/** 선택지 뽑기·표시 순서 (데이터 정의 순서) */
export const BOON_IDS: readonly BoonId[] = BOON_LIST.map((d) => d.id);
