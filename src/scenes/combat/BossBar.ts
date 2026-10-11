// 필드 상단 보스 체력 바 (이름 + 큰 게이지). 필드 좌표, 원점은 필드 좌상단.
// 페이즈가 있는 보스(BossDef)는 페이즈 문턱(예: 70%·35%)에 눈금, 이름 양옆에 페이즈 점(●●○), 페이즈 전환 때 번쩍임,
// 포효(무적) 중에는 게이지 위에 옅은 방패 줄무늬가 깜빡인다. 값이 바뀔 때만 다시 그린다 (게이지는 FastBar).
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { FIELD_W, UI_COLORS } from '../../config';
import { textStyle } from '../../ui';
import { FastBar } from './FastBar';

const BAR_W = 440;
const BAR_H = 20;
const TOP = 6;
const PIP_R = 7;
const PIP_GAP = 20;
const PIP_ON = 0xffe14a;
const PIP_OFF = 0x4a2a36;
const TICK_COLOR = 0xfff4d6;
const FLASH_TIME = 0.45;
const SHIELD_COLOR = 0xbfe6ff;

export class BossBar extends Container {
  /** 보스는 거의 매 프레임 맞는다 → 다시 그리지 않는 게이지 (FastBar 참고) */
  private readonly bar = new FastBar(BAR_W, BAR_H, UI_COLORS.hp);
  private readonly nameText: Text;
  private readonly ticks = new Graphics();
  private readonly pips = new Graphics();
  /** 페이즈 전환 번쩍임 (게이지 위 흰 사각형) */
  private readonly flashSprite = new Sprite(Texture.WHITE);
  /** 포효(무적) 중 방패 덮개 */
  private readonly shield = new Sprite(Texture.WHITE);
  private readonly phaseCount: number;
  private shown = -1;
  private shownPhase = -1;
  private fade = 0;
  private hiding = false;
  private flashT = 0;
  private shieldOn = false;
  private clock = 0;

  /**
   * @param phaseFracs 페이즈가 시작되는 HP 비율 (BossDef.phases[i].hpFrac, 첫 페이즈 1 포함). 없으면 눈금·점 없음
   */
  constructor(name: string, phaseFracs: readonly number[] = []) {
    super();
    this.eventMode = 'none';
    this.interactiveChildren = false;
    const x = (FIELD_W - BAR_W) / 2;
    const bg = new Graphics()
      .roundRect(x - 12, TOP - 2, BAR_W + 24, BAR_H + 34, 14)
      .fill({ color: 0x1a0a14, alpha: 0.5 })
      .stroke({ width: 2, color: 0x7a0f1e, alpha: 0.7 });
    this.nameText = new Text({ text: name, style: textStyle('heading', { fontSize: 20, fill: 0xffe14a, stroke: { color: 0x2a0a10, width: 5, join: 'round' } }) });
    this.nameText.anchor.set(0.5, 0);
    this.nameText.position.set(FIELD_W / 2, TOP - 1);
    this.bar.position.set(x, TOP + 26);

    // 페이즈 문턱 눈금: 게이지 위아래로 살짝 삐져나온 밝은 막대 + 아래 작은 삼각형
    this.phaseCount = phaseFracs.length;
    for (let i = 1; i < phaseFracs.length; i++) {
      const f = phaseFracs[i];
      if (!(f > 0 && f < 1)) continue;
      const tx = x + BAR_W * f;
      this.ticks.rect(tx - 1.5, TOP + 22, 3, BAR_H + 8).fill({ color: TICK_COLOR, alpha: 0.95 });
      this.ticks.poly([tx - 5, TOP + 26 + BAR_H + 9, tx + 5, TOP + 26 + BAR_H + 9, tx, TOP + 26 + BAR_H + 3]).fill({ color: TICK_COLOR, alpha: 0.95 });
    }

    this.flashSprite.position.set(x, TOP + 26);
    this.flashSprite.width = BAR_W;
    this.flashSprite.height = BAR_H;
    this.flashSprite.alpha = 0;
    this.shield.position.set(x, TOP + 26);
    this.shield.width = BAR_W;
    this.shield.height = BAR_H;
    this.shield.tint = SHIELD_COLOR;
    this.shield.alpha = 0;
    this.shield.visible = false;

    this.addChild(bg, this.nameText, this.bar, this.shield, this.ticks, this.flashSprite, this.pips);
    this.setPhase(0);
    this.visible = false;
  }

  show(): void {
    this.visible = true;
    this.hiding = false;
    this.fade = 0;
  }

  hide(): void {
    this.hiding = true;
  }

  setHp(hp: number, maxHp: number): void {
    const cur = hp > 0 ? Math.ceil(hp) : 0;
    if (cur === this.shown) return;
    const first = this.shown < 0;
    this.shown = cur;
    this.bar.setValue(maxHp > 0 ? cur / maxHp : 0, !first);
  }

  /** 지금 페이즈(0부터). 이름 양옆 점을 다시 그린다 (바뀔 때만) */
  setPhase(phase: number): void {
    if (phase === this.shownPhase || this.phaseCount <= 1) return;
    this.shownPhase = phase;
    const g = this.pips.clear();
    const half = this.nameText.width / 2 + 18;
    // 이름 오른쪽에 페이즈 수만큼 점 — 지난·지금 페이즈는 채운 점
    for (let i = 0; i < this.phaseCount; i++) {
      const cx = FIELD_W / 2 + half + i * PIP_GAP;
      g.circle(cx, TOP + 11, PIP_R).fill(i <= phase ? PIP_ON : PIP_OFF).stroke({ width: 2, color: 0x2a0a10 });
    }
  }

  /** 페이즈 전환 번쩍임 */
  flash(): void {
    this.flashT = FLASH_TIME;
  }

  /** 포효(무적) 중 표시 */
  setShield(on: boolean): void {
    this.shieldOn = on;
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.clock += dt;
    this.bar.update(dt);
    if (this.hiding) {
      this.fade = Math.max(0, this.fade - dt * 2.5);
      if (this.fade <= 0) this.visible = false;
    } else {
      this.fade = Math.min(1, this.fade + dt * 4);
    }
    this.alpha = this.fade;
    this.y = (1 - this.fade) * -30;
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      this.flashSprite.alpha = (this.flashT / FLASH_TIME) * 0.95;
    } else if (this.flashSprite.alpha !== 0) this.flashSprite.alpha = 0;
    this.shield.visible = this.shieldOn;
    if (this.shieldOn) this.shield.alpha = 0.35 + 0.25 * Math.sin(this.clock * 14);
  }
}
