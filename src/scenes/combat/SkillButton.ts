// 액티브 스킬 버튼 (하단 바 오른쪽, docs/DESIGN.md '액티브 스킬'): 둥근 버튼 + 캐릭터 스킬 아이콘(skill_<캐릭터>)
// + 게이지(sim.skill.charge)만큼 12시부터 시계 방향으로 차는 부채꼴 + 효과 중 남은 시간 고리.
// 가득 차면(ready) 빛 + 숨쉬기. 인트로·오버레이·승패 중에는 흐리게(enabled false).
// 입력은 씬이 이 버튼에 직접 건다(pointerdown/up): 하단 바는 이동 드래그 패드라 버튼에서 시작한 드래그도 이동이 되고,
// 제자리 탭만 스킬 발동이다 (CombatScene.onSkillDown/onSkillUp). 여기서는 눌림 모양만.
// 원점 = 버튼 가운데. 그리기: 바탕·테두리는 한 번, 부채꼴·고리는 값이 SECTOR_STEPS 단계를 넘어갈 때만 다시 그린다
// (게이지는 적중마다 조금씩 오르므로 매 프레임 다시 그리지 않게).
import { Circle, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { UI_COLORS } from '../../config';
import { mixColor, shade } from '../../render/color';
import { tex } from '../../render/assets';
import type { SkillDef, SkillState } from '../../types';
import { OUTLINE_COLOR, textStyle } from '../../ui';
import { SKILL_COLORS } from '../skillText';

export const SKILL_BUTTON_R = 58;
/** 부채꼴·고리를 다시 그리는 단계 수 (한 바퀴) */
const SECTOR_STEPS = 60;
const ICON_SCALE = 1.28;
const BURST_TIME = 0.45;
const DENY_TIME = 0.3;
const READY_POP_TIME = 0.35;
const PRESS_SCALE = 0.92;

export class SkillButton extends Container {
  private readonly face = new Container();
  private readonly glow: Sprite;
  private readonly base = new Graphics();
  private readonly sector = new Graphics();
  private readonly ring = new Graphics();
  /** 게이지 테두리 호 (부채꼴과 같은 각도, 버튼 테두리 위) */
  private readonly chargeRim = new Graphics();
  private readonly activeRing = new Graphics();
  private readonly flash = new Graphics();
  private readonly icon: Sprite;
  private readonly iconScale: number;
  private readonly nameText: Text;
  private readonly color: number;
  private shownStep = -1;
  private shownActiveStep = -1;
  private ready = false;
  private pressed = false;
  private clock = 0;
  private burstT = 0;
  private denyT = 0;
  private readyPopT = 0;

  constructor(
    readonly def: SkillDef,
    glowTex: Texture,
  ) {
    super();
    const r = SKILL_BUTTON_R;
    this.color = SKILL_COLORS[def.kind];

    this.glow = new Sprite(glowTex);
    this.glow.anchor.set(0.5);
    this.glow.tint = mixColor(this.color, 0xffffff, 0.35);
    this.glow.width = this.glow.height = r * 3.6;
    this.glow.alpha = 0;

    this.base
      .circle(0, 4, r)
      .fill({ color: 0x000000, alpha: 0.35 })
      .circle(0, 0, r)
      .fill(shade(UI_COLORS.panel, 0.85))
      .circle(0, 0, r - 7)
      .fill(shade(this.color, 0.22));
    this.ring.circle(0, 0, r - 3).stroke({ width: 6, color: shade(this.color, 0.55) });

    this.icon = new Sprite(tex(def.icon));
    this.icon.anchor.set(0.5);
    this.iconScale = (r * ICON_SCALE) / Math.max(1, this.icon.texture.width, this.icon.texture.height);
    this.icon.scale.set(this.iconScale);

    this.flash.circle(0, 0, r).fill({ color: 0xffffff });
    this.flash.alpha = 0;

    this.nameText = new Text({
      text: def.name,
      style: textStyle('small', { fontSize: 22, fill: UI_COLORS.text, stroke: { color: OUTLINE_COLOR, width: 4, join: 'round' } }),
    });
    this.nameText.anchor.set(0.5, 0);
    this.nameText.position.set(0, r + 8);

    this.face.addChild(this.base, this.sector, this.icon, this.ring, this.chargeRim, this.activeRing, this.flash);
    this.addChild(this.glow, this.face, this.nameText);

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Circle(0, 0, r + 10);
    this.on('pointerdown', () => {
      this.pressed = true;
    });
    const release = (): void => {
      this.pressed = false;
    };
    this.on('pointerup', release);
    this.on('pointerupoutside', release);
    this.on('pointerleave', release);
    this.drawSector(0);
  }

  /** 버튼 아래 이름이 차지하는 높이 (레이아웃용) */
  get labelHeight(): number {
    return this.nameText.height + 8;
  }

  /** 이름 글자 표시 (하단 바가 낮으면 숨긴다) */
  setLabelVisible(on: boolean): void {
    this.nameText.visible = on;
  }

  /** 매 프레임: 게이지·효과 시간·준비 상태. enabled false면 흐리게(인트로·오버레이·승패) */
  sync(state: SkillState | null, enabled: boolean, dt: number): void {
    this.clock += dt;
    const charge = state ? state.charge : 0;
    const ready = !!state && state.ready;
    if (ready && !this.ready) this.readyPopT = READY_POP_TIME;
    this.ready = ready;

    const step = ready ? SECTOR_STEPS : Math.min(SECTOR_STEPS - 1, Math.floor(charge * SECTOR_STEPS));
    if (step !== this.shownStep) this.drawSector(step);
    const act = state && state.duration > 0 && state.active > 0 ? state.active / state.duration : 0;
    const aStep = Math.ceil(act * SECTOR_STEPS);
    if (aStep !== this.shownActiveStep) this.drawActive(aStep);

    if (this.burstT > 0) this.burstT = Math.max(0, this.burstT - dt);
    if (this.denyT > 0) this.denyT = Math.max(0, this.denyT - dt);
    if (this.readyPopT > 0) this.readyPopT = Math.max(0, this.readyPopT - dt);

    const live = ready && enabled;
    const wave = Math.sin(this.clock * 6);
    // 준비: 숨쉬기 + 빛, 누르는 중: 살짝 눌림, 발동: 커졌다 돌아옴, 거절: 좌우 떨림
    let s = live ? 1 + 0.05 * (0.5 + 0.5 * wave) : 1;
    if (this.pressed && enabled) s *= PRESS_SCALE;
    const pop = this.readyPopT / READY_POP_TIME;
    s *= 1 + 0.22 * pop * pop;
    const b = this.burstT / BURST_TIME;
    s *= 1 + 0.18 * b;
    this.face.scale.set(s);
    this.face.x = this.denyT > 0 ? Math.sin(this.denyT * 60) * 7 * (this.denyT / DENY_TIME) : 0;
    this.glow.alpha = live ? 0.55 + 0.35 * wave : b * 0.8;
    this.glow.scale.set((SKILL_BUTTON_R * 3.6 * (1 + 0.25 * b)) / Math.max(1, this.glow.texture.width));
    this.flash.alpha = b * 0.75;
    // 차는 중: 아이콘을 살짝 바래게 (안 보일 만큼 어둡지는 않게)
    this.icon.tint = ready || this.burstT > 0 || act > 0 ? 0xffffff : 0xc4bcd8;
    this.icon.alpha = ready || act > 0 ? 1 : 0.88;
    this.icon.rotation = live ? Math.sin(this.clock * 3) * 0.08 : 0;
    this.alpha = enabled ? 1 : 0.55;
    this.cursor = live ? 'pointer' : 'default';
  }

  /** 발동 연출 (씬이 sim.activateSkill 성공 뒤에) */
  burst(): void {
    this.burstT = BURST_TIME;
  }

  /** 아직 못 쓸 때 누름: 좌우 떨림 */
  deny(): void {
    this.denyT = DENY_TIME;
  }

  private drawSector(step: number): void {
    this.shownStep = step;
    const g = this.sector;
    const rim = this.chargeRim;
    g.clear();
    rim.clear();
    if (step <= 0) return;
    const r = SKILL_BUTTON_R - 7;
    if (step >= SECTOR_STEPS) {
      g.circle(0, 0, r).fill({ color: this.color, alpha: 0.95 });
      rim.circle(0, 0, SKILL_BUTTON_R - 3).stroke({ width: 6, color: mixColor(this.color, 0xffffff, 0.5) });
      return;
    }
    // 차는 중: 반투명 부채꼴 + 테두리 위 진한 호 (작은 화면에서도 얼마나 찼는지 보이게)
    const a0 = -Math.PI / 2;
    const a1 = a0 + (step / SECTOR_STEPS) * Math.PI * 2;
    g.moveTo(0, 0).arc(0, 0, r, a0, a1).lineTo(0, 0).fill({ color: this.color, alpha: 0.5 });
    rim.arc(0, 0, SKILL_BUTTON_R - 3, a0, a1).stroke({ width: 6, color: this.color, cap: 'round' });
  }

  /** 효과 남은 시간: 테두리 위 흰 고리가 시계 반대로 줄어든다 */
  private drawActive(step: number): void {
    this.shownActiveStep = step;
    const g = this.activeRing;
    g.clear();
    if (step <= 0) return;
    const r = SKILL_BUTTON_R - 3;
    const a0 = -Math.PI / 2;
    const a1 = a0 + (step / SECTOR_STEPS) * Math.PI * 2;
    g.arc(0, 0, r, a0, a1).stroke({ width: 8, color: 0xffffff, cap: 'round' });
  }
}
