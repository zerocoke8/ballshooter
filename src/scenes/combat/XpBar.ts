// HUD 경험치 막대 (레벨업 — docs/DESIGN.md '레벨업'): 'Lv N' 글자 + 다음 레벨까지 채움 (FastBar — 처치마다 다시 그리지 않음).
// CombatScene이 Hud 안(골드 오른쪽, HP 막대 아래)에 붙인다. 원점 좌상단, 폭 XP_BAR_W × XP_BAR_H.
// 레벨 글자는 레벨이 바뀔 때만 다시 그린다(레벨업은 전투가 멈춘 순간이라 래스터화가 눈에 띄지 않는다).
import { Container, Sprite, Text, type Texture } from 'pixi.js';
import { T } from '../../i18n/ko';
import { OUTLINE_COLOR, textStyle } from '../../ui';
import { FastBar } from './FastBar';

export const XP_BAR_W = 176;
export const XP_BAR_H = 24;
const XP_COLOR = 0x5ec8ff;
const XP_BG = 0x1c2a44;
const PULSE_TIME = 0.6;

export class XpBar extends Container {
  private readonly bar = new FastBar(XP_BAR_W, XP_BAR_H, XP_COLOR, XP_BG);
  private readonly lvText: Text;
  private readonly glow: Sprite;
  private shownLevel = -1;
  private shownFrac = -1;
  private pulseT = 0;
  /** 고르지 않은 레벨업이 남아 있으면 반짝임 (보류 중 — 측정 도구의 레벨업 보류 등) */
  private pending = false;
  private clock = 0;

  constructor(glowTex: Texture) {
    super();
    this.eventMode = 'none';
    this.interactiveChildren = false;
    this.glow = new Sprite(glowTex);
    this.glow.anchor.set(0.5);
    this.glow.tint = XP_COLOR;
    this.glow.position.set(XP_BAR_W / 2, XP_BAR_H / 2);
    this.glow.width = XP_BAR_W * 1.3;
    this.glow.height = XP_BAR_H * 2.6;
    this.glow.alpha = 0;
    this.lvText = new Text({
      text: '',
      style: textStyle('number', { fontSize: 18, stroke: { color: OUTLINE_COLOR, width: 4, join: 'round' } }),
    });
    this.lvText.anchor.set(0, 0.5);
    this.lvText.position.set(10, XP_BAR_H / 2);
    this.addChild(this.glow, this.bar, this.lvText);
  }

  /** level·xp(이번 레벨에서 모은 양)·need(다음 레벨까지). 레벨이 오르면 빈 막대에서 다시 차고 반짝인다 */
  set(level: number, xp: number, need: number, pending: number): void {
    const frac = need > 0 ? Math.max(0, Math.min(1, xp / need)) : 0;
    this.pending = pending > 0;
    if (level !== this.shownLevel) {
      const first = this.shownLevel < 0;
      this.shownLevel = level;
      this.lvText.text = T.combat.level(level);
      this.shownFrac = frac;
      this.bar.setValue(frac, false);
      if (!first) this.pulseT = PULSE_TIME;
      return;
    }
    if (Math.abs(frac - this.shownFrac) < 0.002) return;
    this.shownFrac = frac;
    this.bar.setValue(frac, true);
  }

  update(dt: number): void {
    this.clock += dt;
    this.bar.update(dt);
    if (this.pulseT > 0) this.pulseT = Math.max(0, this.pulseT - dt);
    const p = this.pulseT / PULSE_TIME;
    const wait = this.pending ? 0.25 + 0.2 * Math.sin(this.clock * 6) : 0;
    this.glow.alpha = Math.max(p * 0.9, wait);
    this.lvText.scale.set(1 + 0.35 * p * p);
  }
}
