// 액티브 스킬 한 줄 효과 (캐릭터 선택·보스 테스트 선택·스킬 버튼): 문구는 i18n, 수치는 SkillDef(data/skills.ts)에서 —
// 스킬 수치를 바꾸면 문구도 같이 바뀐다.
import { T } from '../i18n/ko';
import type { SkillDef } from '../types';

export function skillLine(def: SkillDef): string {
  switch (def.kind) {
    case 'freeze':
      return T.menu.skillFreeze(def.freeze.duration);
    case 'spring':
      return T.menu.skillSpring(Math.round(def.spring.healFrac * 100), def.spring.duration);
    case 'storm':
      return T.menu.skillStorm(def.storm.count);
  }
}

/** 스킬 게이지·버튼 색 (종류별) */
export const SKILL_COLORS: Readonly<Record<SkillDef['kind'], number>> = {
  freeze: 0x6fd8ff,
  spring: 0xffa65c,
  storm: 0xc9a7ff,
};
