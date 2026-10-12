import type { SkillDef } from '../types';

// 캐릭터 액티브 스킬 (docs/DESIGN.md '액티브 스킬'). 캐릭터마다 하나 — GameData.skills[캐릭터 id].
// charge = 게이지가 차는 데 필요한 피해량(스테이지 HP 배수 1 기준 — sim이 stage.hpMul을 곱한다). 백어택 직접 적중은 config SKILL_BACK_CHARGE_MUL배.
// 스테이지 체력 합(HP 배수로 나눈 값)은 st1 1,500 · st2 2,800 · st3 2,750 · st4 4,200 · st5 2,650 + 대왕 로봇 2,700.
// 밸런스 조정(docs/DESIGN.md '네 번째 난이도 조정 — 재미 기능 뒤'): 첫 값 800은 st5에서 판마다 5~6번 — 프로브 AI 기준 스킬 있음/없음 승률 차가
// 이어서 하는 런 펭구 +25 · 냥냥 +32점(목표 +5~15)이었다 → 펭구·냥냥 1250(st1 1번 · st2~st3 1.5~2번 · st4 2.5번 · st5 4번), 폭풍 1발 0.6 → 0.45.
// 카피는 HP가 낮을 때만 쓰는 회복이라 2000(+ 회복 30 → 20%, 4 → 3초, 반경 140 → 120): 체력 싸움인 보스 테스트에서 온천이 승패를 거의 다 갈랐다.
const SKILL_LIST: SkillDef[] = [
  {
    id: 'glacier',
    character: 'penguin',
    name: '빙하기',
    desc: '화면의 모든 적을 3초 동안 꽁꽁 얼린다 — 공격·치유·이동이 멈추고 받는 피해 +25%. 보스는 얼지 않고 느려지기만 한다.',
    icon: 'skill_penguin',
    charge: 1250,
    kind: 'freeze',
    // 2초로 줄이면 프로브에서 스킬이 없는 것과 같았다(st5·이어서 하는 런) — 3초 그대로, 대신 충전량으로
    freeze: { duration: 3 },
  },
  {
    id: 'hot_spring',
    character: 'capybara',
    name: '온천 타임',
    desc: '최대 HP 20% 회복 + 3초 동안 둘레(반경 120)에 들어오는 적 탄을 모두 녹인다.',
    icon: 'skill_capybara',
    charge: 2000,
    kind: 'spring',
    spring: { healFrac: 0.2, duration: 3, radius: 120 },
  },
  {
    id: 'hairball_storm',
    character: 'cat',
    name: '털뭉치 폭풍',
    desc: '2초 동안 조준 방향 부채꼴로 털뭉치 24개를 퍼붓는다 — 가장 센 무기의 속성을 물려받고 적 하나를 뚫는다.',
    icon: 'skill_cat',
    charge: 1250,
    kind: 'storm',
    // 1발 = max(20 × 데미지 배수, 가장 센 무기 1발 × 0.45). 2초에 걸쳐 쏘고 수명 1초 — 첫 값(1.5초·수명 3초)은 폭풍 털뭉치가 한꺼번에
    // 20개 넘게 살아 있어 st5 빌드 최대 51·스트레스 최대 68(밀도 목표 45·60)을 넘겼다. 이제 한 번에 약 12개
    storm: {
      count: 24,
      duration: 2.0,
      spreadDeg: 70,
      damageMul: 0.45,
      minDamage: 20,
      pierce: 1,
      sprite: 'proj_hairball',
      radius: 13,
      speed: 950,
      life: 1.0,
    },
  },
];

/** 캐릭터 id → 스킬 */
export const SKILLS: Record<string, SkillDef> = Object.fromEntries(SKILL_LIST.map((d) => [d.character, d]));
