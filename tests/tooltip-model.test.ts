// 가방 툴팁 모델(scenes/bag/tooltipModel — PixiJS 없음): 시너지 돌·장비의 효과 칩, '한 발 더' 보너스가 무기 툴팁에 보이는지,
// 스킬 한 줄 효과(scenes/skillText). 그리기는 Playwright(tools/)가 본다.
import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../src/data';
import { addNewToBag } from '../src/logic/bag';
import { newRun, runLoadout } from '../src/logic/run';
import { scaledGear, scaledStone } from '../src/logic/stats';
import { buildItemTooltip, gearEffectChips, stoneEffectChips } from '../src/scenes/bag/tooltipModel';
import { skillLine } from '../src/scenes/skillText';
import type { GearEffect, StoneEffect, Tier } from '../src/types';

const data = GAME_DATA;

function definedFields(effect: object): string[] {
  return Object.entries(effect)
    .filter(([, v]) => v !== undefined && v !== 0 && v !== false)
    .map(([k]) => k);
}

function clean(labels: string[]): boolean {
  return labels.every((l) => l.length > 0 && !/NaN|undefined|Infinity/.test(l));
}

describe('tooltip effect chips', () => {
  const tiers: Tier[] = [1, 2, 3];

  it('every stone field has a chip at every ★ (synergy stones included)', () => {
    for (const def of Object.values(data.items)) {
      if (def.kind !== 'stone' || !def.stone) continue;
      for (const t of tiers) {
        const eff: StoneEffect = scaledStone(def.stone, t);
        const chips = stoneEffectChips(eff);
        // 번개 코일의 대상 수는 ★1에서 2 → 정수 칩 1개, 한 번 더 1개, 피해 1개 — 필드 수와 같다
        expect(chips.length, `${def.id} ★${t}`).toBe(definedFields(eff).length);
        expect(clean(chips.map((c) => c.label)), `${def.id} ★${t}`).toBe(true);
      }
    }
  });

  it('every gear field has a chip at every ★ (synergy gear included)', () => {
    for (const def of Object.values(data.items)) {
      if (def.kind !== 'gear' || !def.gear) continue;
      for (const t of tiers) {
        const eff: GearEffect = scaledGear(def.gear, t);
        const chips = gearEffectChips(eff);
        expect(chips.length, `${def.id} ★${t}`).toBe(definedFields(eff).length);
        expect(clean(chips.map((c) => c.label)), `${def.id} ★${t}`).toBe(true);
      }
    }
  });

  it('synergy stone chips quote the ★1 numbers', () => {
    const label = (id: string): string => stoneEffectChips(scaledStone(data.items[id].stone!, 1)).map((c) => c.label).join(' | ');
    expect(label('s_rubber')).toContain('+10%');
    expect(label('s_hammer')).toContain('+60%');
    expect(label('s_seed')).toContain('40%');
    expect(label('s_coil')).toContain('+2');
    expect(label('s_mushroom')).toContain('+40%');
    expect(label('s_wheel')).toContain('+30%');
    expect(label('s_ribbon')).toContain('90');
  });
});

describe('weapon tooltip', () => {
  it('shows the multishot boon (+1 projectile on the fastest weapon) and the back-attack bonus', () => {
    const run = newRun(data, 'cat', 1);
    run.boons = { multishot: 1, backstab: 1 };
    const fastest = runLoadout(data, run).reduce((a, b) => (b.cooldown < a.cooldown ? b : a));
    const item = run.bag.items.find((i) => i.uid === fastest.uid)!;
    const tip = buildItemTooltip(data, run, { defId: item.defId, tier: item.tier, uid: item.uid, where: 'bag' }, []);
    expect(tip).not.toBeNull();
    const dmg = tip!.stats.find((s) => s.label === '공격력' || s.label.includes('공격'));
    expect(dmg?.value).toContain(`×${fastest.count}`);
    expect(dmg?.boosted).toBe(true);
    expect(tip!.stats.some((s) => s.value === `+${Math.round(data.boons.backstab.effect.backAttackBonus! * 100)}%`)).toBe(true);
  });

  it('a stone next to a weapon shows its synergy effect in the weapon buff line', () => {
    const run = newRun(data, 'penguin', 2);
    const w = run.bag.items.find((i) => data.items[i.defId].kind === 'weapon')!;
    const def = data.items[w.defId];
    // 무기 오른쪽(회전 0 기준) 빈 칸에 탄성 고무 (자리가 없으면 아래)
    const spots = [
      { x: w.x + def.w, y: w.y },
      { x: w.x, y: w.y + def.h },
      { x: w.x - 1, y: w.y },
    ];
    const placed = spots.map((s) => addNewToBag(run.bag, data.items, 's_rubber', 1, s.x, s.y, 0)).find((p) => p !== null);
    expect(placed).toBeTruthy();
    const tip = buildItemTooltip(data, run, { defId: w.defId, tier: w.tier, uid: w.uid, where: 'bag' }, []);
    const buffLine = tip!.lines.find((l) => l.tone === 'good');
    expect(buffLine?.text).toContain('+10%');
  });
});

describe('skill one-line effect', () => {
  it('each character skill has a short line with its numbers', () => {
    for (const s of Object.values(data.skills)) {
      const line = skillLine(s);
      expect(line.length).toBeGreaterThan(4);
      if (s.kind === 'freeze') expect(line).toContain(String(s.freeze.duration));
      if (s.kind === 'spring') expect(line).toContain(String(Math.round(s.spring.healFrac * 100)));
      if (s.kind === 'storm') expect(line).toContain(String(s.storm.count));
    }
  });
});
