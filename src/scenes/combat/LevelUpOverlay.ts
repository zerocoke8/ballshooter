// 레벨업 3지선다 창 (전투 일시정지 — docs/DESIGN.md '레벨업'). 어둡게 덮기(입력 차단) + 제목 + 큰 카드 3장(세로로).
// 카드: 아이콘(희귀도 색 상자, ★) · 이름 · 종류 딱지 · 효과 글. 탭(또는 키 1/2/3 — 씬이 pick을 부른다)으로 고른다.
// 고르기 = logic/run.ts applyLevelUpChoice → onPicked(결과, 아이콘 화면 좌표)로 씬이 sim.setLoadout·비행 연출·알림.
// 대기 레벨업이 남아 있으면 다음 선택지가 이어서 들어오고, 다 고르면 사라진 뒤 onDone.
// 실수 방지: 카드가 다 들어온 뒤(ARM_TIME)부터 받는다 — 조준하려고 탭하던 손가락이 갑자기 뜬 카드를 고르지 않게.
// 애니메이션은 update(dt)로 직접 (전투 씬이 멈춘 동안에도 씬이 부른다).
import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import { DESIGN_W, RARITY_COLORS, UI_COLORS } from '../../config';
import type { Viewport } from '../../core/app';
import { T } from '../../i18n/ko';
import { applyLevelUpChoice, levelUpOffer, pendingLevelUps, runBoons, runLevel, runPlayerStats } from '../../logic/run';
import { computeLoadout, scaledGear, scaledStone } from '../../logic/stats';
import { shade } from '../../render/color';
import type { GameData, LevelUpChoice, LevelUpResult, RunState, Tier } from '../../types';
import { OUTLINE_COLOR, textStyle } from '../../ui';
import { drawStars, fitSprite, rarityFill } from '../bag/itemSprite';
import { fmtNum, gearEffectChips, stoneEffectText } from '../bag/tooltipModel';

const CARD_W = 652;
const CARD_MIN_H = 176;
const CARD_GAP = 22;
const CARD_PAD = 20;
const ICON_BOX = 128;
const NAME_FONT = 34;
const DESC_FONT = 23;
const HEADER_H = 168;
const MARGIN = 22;
/** 카드 등장(한 장) / 장 사이 지연 / 받기 시작 (마지막 카드가 다 들어온 뒤) */
const CARD_IN_TIME = 0.28;
const CARD_STAGGER = 0.07;
const ARM_TIME = CARD_IN_TIME + CARD_STAGGER * 2 + 0.1;
const DIM_IN_TIME = 0.15;
const PICK_TIME = 0.42;
const OUT_TIME = 0.2;
const UPGRADE_COLOR = 0xffc93c;
const BOON_COLOR = UI_COLORS.good;
const DESC_COLOR = 0xeee4ff;

export interface LevelUpOverlayOptions {
  data: GameData;
  run: RunState;
  /** 하나를 골라 적용한 직후 (런은 이미 바뀌었다). gx, gy = 고른 카드 아이콘 가운데 (전역 좌표) */
  onPicked: (result: LevelUpResult, gx: number, gy: number) => void;
  /** 대기 레벨업을 다 골랐다(또는 굴릴 선택지가 없다) — 창이 사라진 뒤 */
  onDone: () => void;
}

interface Card {
  root: Container;
  body: Container;
  border: Graphics;
  icon: Container;
  h: number;
  y: number;
}

type Mode = 'in' | 'idle' | 'picked' | 'out' | 'done';

export class LevelUpOverlay extends Container {
  private readonly dim = new Graphics();
  private readonly header = new Container();
  private readonly title: Text;
  private readonly sub: Text;
  private readonly moreBadge = new Container();
  private readonly moreBg = new Graphics();
  private readonly moreText: Text;
  private readonly column = new Container();
  private cards: Card[] = [];
  private offer: LevelUpChoice[] = [];
  private vp: Viewport | null = null;
  private top = 0;
  private mode: Mode = 'in';
  private t = 0;
  private pickedIndex = -1;
  private dimT = 0;

  constructor(private readonly opts: LevelUpOverlayOptions) {
    super();
    this.dim.eventMode = 'static';
    this.title = new Text({ text: T.combat.levelUp.title, style: textStyle('title', { fontSize: 84, fill: UI_COLORS.gold }) });
    this.title.anchor.set(0.5);
    this.sub = new Text({ text: '', style: textStyle('heading', { fontSize: 32 }) });
    this.sub.anchor.set(0.5, 0);
    this.moreText = new Text({ text: '', style: textStyle('small', { fontSize: 22, fill: 0xffffff, stroke: { color: OUTLINE_COLOR, width: 4, join: 'round' } }) });
    this.moreText.anchor.set(0.5);
    this.moreBadge.addChild(this.moreBg, this.moreText);
    this.header.addChild(this.title, this.sub, this.moreBadge);
    this.addChild(this.dim, this.header, this.column);
    this.alpha = 0;
    this.next();
  }

  /** 카드를 받고 있는가 (등장 애니메이션이 끝나고 아직 안 골랐다) */
  get armed(): boolean {
    return this.mode === 'idle' || (this.mode === 'in' && this.t >= ARM_TIME);
  }

  /** 지금 보이는 선택지 수 */
  get choiceCount(): number {
    return this.offer.length;
  }

  /** top: HUD 아래 끝 (화면 y) */
  layout(vp: Viewport, top: number): void {
    this.vp = vp;
    this.top = top;
    this.dim.clear().rect(0, 0, vp.width, vp.height).fill({ color: 0x0b0612, alpha: 0.82 });
    this.dim.hitArea = new Rectangle(0, 0, vp.width, vp.height);
    this.relayout();
  }

  /** i번째 카드 고르기 (탭·키 1/2/3·디버그). 받는 중이 아니거나 없는 카드면 false */
  pick(index: number): boolean {
    if (!this.armed || index < 0 || index >= this.offer.length || this.destroyed) return false;
    const run = this.opts.run;
    const result = applyLevelUpChoice(this.opts.data, run, index);
    if (!result) {
      // 선택지가 그사이 무효가 됐다(거의 없음) — 새로 굴려서 다시 보여 준다
      this.next();
      return false;
    }
    const card = this.cards[index];
    const p = card.icon.getGlobalPosition();
    this.pickedIndex = index;
    this.mode = 'picked';
    this.t = 0;
    this.opts.onPicked(result, p.x, p.y);
    return true;
  }

  update(dt: number): void {
    if (this.destroyed || this.mode === 'done') return;
    this.t += dt;
    if (this.mode !== 'out') {
      this.dimT = Math.min(DIM_IN_TIME, this.dimT + dt);
      this.alpha = this.dimT / DIM_IN_TIME;
    }
    switch (this.mode) {
      case 'in':
        this.animateIn();
        if (this.t >= ARM_TIME) this.mode = 'idle';
        break;
      case 'idle':
        this.animateIn();
        break;
      case 'picked': {
        const k = Math.min(1, this.t / PICK_TIME);
        this.cards.forEach((c, i) => {
          if (i === this.pickedIndex) {
            // 고른 카드: 툭 커졌다가 제자리, 테두리 번쩍
            const pop = Math.sin(Math.min(1, k * 2) * Math.PI);
            c.body.scale.set(1 + 0.06 * pop);
            c.border.alpha = 0.5 + 0.5 * (1 - k);
          } else {
            c.root.alpha = Math.max(0.15, 1 - k * 2);
          }
        });
        if (k >= 1) {
          if (pendingLevelUps(this.opts.run) > 0) this.next();
          else {
            this.mode = 'out';
            this.t = 0;
          }
        }
        break;
      }
      case 'out': {
        const k = Math.min(1, this.t / OUT_TIME);
        // 지금 보이는 만큼에서 사라진다 (굴릴 선택지가 없어 바로 닫힐 때 번쩍이지 않게)
        this.alpha = Math.min(this.alpha, 1 - k);
        if (k >= 1) {
          this.mode = 'done';
          this.opts.onDone();
        }
        break;
      }
    }
  }

  // ───────────────────────────────────────────────────────────

  /** 다음 선택지(levelUpOffer)로 카드를 다시 만든다. 없으면 바로 닫는다 */
  private next(): void {
    const { data, run } = this.opts;
    const offer = levelUpOffer(data, run);
    for (const c of this.cards) c.root.destroy({ children: true, context: true });
    this.cards = [];
    this.pickedIndex = -1;
    if (!offer || offer.length === 0) {
      this.offer = [];
      this.mode = 'out';
      this.t = 0;
      return;
    }
    this.offer = offer;
    // 지금 고르는 레벨 = 도달한 레벨 - (남은 레벨업 - 1) — 여러 번 쌓이면 낮은 레벨부터
    const pending = pendingLevelUps(run);
    this.sub.text = T.combat.levelUp.sub(runLevel(run) - Math.max(0, pending - 1));
    this.moreText.text = T.combat.levelUp.more(pending - 1);
    this.moreBadge.visible = pending > 1;
    offer.forEach((c, i) => this.cards.push(this.buildCard(c, i)));
    this.mode = 'in';
    this.t = 0;
    this.relayout();
    this.animateIn();
  }

  private relayout(): void {
    const vp = this.vp;
    if (!vp || this.destroyed) return;
    const bottom = vp.height - vp.safeBottom - MARGIN;
    const avail = Math.max(200, bottom - this.top - MARGIN);
    const cardsH = this.cards.reduce((h, c) => h + c.h, 0) + CARD_GAP * Math.max(0, this.cards.length - 1);
    const total = HEADER_H + cardsH;
    // 화면이 짧으면 카드 묶음째 줄인다 (글자는 그대로 읽힌다 — 최소 0.75)
    const s = total > avail ? Math.max(0.75, avail / total) : 1;
    const used = total * s;
    const y0 = this.top + MARGIN + Math.max(0, (avail - used) * 0.4);
    this.header.scale.set(s);
    this.header.position.set(DESIGN_W / 2, y0);
    this.title.position.set(0, 52);
    this.sub.position.set(0, 100);
    this.drawMoreBadge();
    this.column.scale.set(s);
    this.column.position.set((DESIGN_W - CARD_W * s) / 2, y0 + HEADER_H * s);
    let y = 0;
    for (const c of this.cards) {
      c.y = y;
      c.root.position.set(CARD_W / 2, y + c.h / 2);
      y += c.h + CARD_GAP;
    }
  }

  /** '+N 더' 딱지 (제목 오른쪽 위, 살짝 기울임) */
  private drawMoreBadge(): void {
    const w = this.moreText.width + 28;
    const h = 36;
    this.moreBg.clear().roundRect(-w / 2, -h / 2, w, h, h / 2).fill(UI_COLORS.accent).stroke({ width: 3, color: shade(UI_COLORS.accent, 0.5) });
    // 제목 폭은 등장 애니메이션 크기와 무관하게 (원래 크기 기준)
    const titleW = this.title.width / Math.max(0.01, Math.abs(this.title.scale.x));
    this.moreBadge.position.set(titleW / 2 + w / 2 + 10, 26);
    this.moreBadge.rotation = 0.12;
  }

  /** 카드 등장: 아래에서 올라오며 나타남 (장마다 조금씩 늦게) */
  private animateIn(): void {
    this.cards.forEach((c, i) => {
      const k = Math.max(0, Math.min(1, (this.t - i * CARD_STAGGER) / CARD_IN_TIME));
      const e = 1 - (1 - k) * (1 - k);
      c.root.alpha = k;
      c.root.position.y = c.y + c.h / 2 + (1 - e) * 70;
      // outBack 살짝
      const back = 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2;
      c.body.scale.set(0.9 + 0.1 * back);
    });
    const hk = Math.min(1, this.t / 0.3);
    if (this.cards.length > 0 && this.mode === 'in') {
      const back = 1 + 2.7 * (hk - 1) ** 3 + 1.7 * (hk - 1) ** 2;
      this.title.scale.set(0.6 + 0.4 * back);
    } else this.title.scale.set(1);
  }

  private buildCard(choice: LevelUpChoice, index: number): Card {
    const info = this.cardInfo(choice);
    const root = new Container();
    const body = new Container();
    root.addChild(body);

    // 글자 먼저 만들어 높이를 잰다
    const textX = CARD_PAD + ICON_BOX + 22;
    const textW = CARD_W - textX - CARD_PAD;
    const name = new Text({
      text: info.name,
      style: textStyle('heading', { fontSize: NAME_FONT, fill: info.nameColor, align: 'left', stroke: { color: OUTLINE_COLOR, width: 6, join: 'round' } }),
    });
    const starR = 12;
    const starsW = info.stars > 0 ? info.stars * starR * 1.7 + 14 : 0;
    const chips = this.buildChips(info.chips);
    const nameMax = textW - starsW - chips.width - 12;
    if (name.width > nameMax) name.scale.set(Math.max(0.6, nameMax / name.width));
    const desc = new Text({
      text: info.desc,
      style: textStyle('body', { fontSize: DESC_FONT, lineHeight: DESC_FONT + 8, fill: DESC_COLOR, wordWrap: true, breakWords: true, wordWrapWidth: textW }),
    });
    const contentH = Math.max(ICON_BOX, 46 + desc.height);
    const h = Math.max(CARD_MIN_H, contentH + CARD_PAD * 2);
    const w = CARD_W;

    const g = new Graphics()
      .roundRect(-w / 2, -h / 2 + 6, w, h, 26)
      .fill({ color: 0x000000, alpha: 0.35 })
      .roundRect(-w / 2, -h / 2, w, h, 26)
      .fill(UI_COLORS.panel)
      .roundRect(-w / 2 + 6, -h / 2 + 6, w - 12, h * 0.42, 22)
      .fill({ color: 0xffffff, alpha: 0.04 });
    const border = new Graphics().roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 25).stroke({ width: 5, color: info.border });
    body.addChild(g, border);

    // 아이콘 상자
    const icon = new Container();
    const box = new Graphics()
      .roundRect(-ICON_BOX / 2, -ICON_BOX / 2 + 3, ICON_BOX, ICON_BOX, 22)
      .fill({ color: 0x000000, alpha: 0.25 })
      .roundRect(-ICON_BOX / 2, -ICON_BOX / 2, ICON_BOX, ICON_BOX, 22)
      .fill(info.iconFill)
      .roundRect(-ICON_BOX / 2 + 2, -ICON_BOX / 2 + 2, ICON_BOX - 4, ICON_BOX - 4, 20)
      .stroke({ width: 4, color: info.border });
    icon.addChild(box, fitSprite(info.icon, ICON_BOX - 24, ICON_BOX - 24));
    if (info.iconStars > 0) {
      const st = new Graphics();
      drawStars(st, -ICON_BOX / 2 + 16, -ICON_BOX / 2 + 16, info.iconStars, 10);
      icon.addChild(st);
    }
    icon.position.set(-w / 2 + CARD_PAD + ICON_BOX / 2, 0);
    body.addChild(icon);

    // 이름 + ★ + 딱지 (한 줄), 그 아래 효과 글
    const top = -h / 2 + CARD_PAD - 2;
    const left = -w / 2 + textX;
    name.position.set(left, top);
    body.addChild(name);
    if (info.stars > 0) {
      const st = new Graphics();
      drawStars(st, left + name.width + 10 + starR, top + name.height / 2, info.stars, starR);
      body.addChild(st);
    }
    chips.position.set(w / 2 - CARD_PAD - chips.width, top + 4);
    body.addChild(chips);
    desc.position.set(left, top + Math.max(46, name.height + 4));
    body.addChild(desc);

    // 키 번호 (데스크톱 1/2/3)
    const key = new Container();
    const kg = new Graphics().circle(0, 0, 17).fill(shade(info.border, 0.45)).stroke({ width: 3, color: info.border });
    const kt = new Text({ text: String(index + 1), style: textStyle('number', { fontSize: 20, stroke: { color: OUTLINE_COLOR, width: 4, join: 'round' } }) });
    kt.anchor.set(0.5);
    key.addChild(kg, kt);
    key.position.set(-w / 2 + 8, -h / 2 + 8);
    body.addChild(key);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Rectangle(-w / 2, -h / 2, w, h);
    root.on('pointertap', () => this.pick(index));
    root.alpha = 0;
    this.column.addChild(root);
    return { root, body, border, icon, h, y: 0 };
  }

  private buildChips(list: { text: string; color: number }[]): Container {
    const c = new Container();
    let x = 0;
    for (const chip of list) {
      const t = new Text({ text: chip.text, style: textStyle('small', { fontSize: 20, fill: 0xffffff, stroke: { color: shade(chip.color, 0.35), width: 4, join: 'round' } }) });
      const cw = t.width + 22;
      const g = new Graphics().roundRect(0, 0, cw, 32, 16).fill(shade(chip.color, 0.7)).stroke({ width: 2, color: chip.color });
      t.anchor.set(0.5);
      t.position.set(cw / 2, 16);
      const one = new Container();
      one.addChild(g, t);
      one.x = x;
      c.addChild(one);
      x += cw + 6;
    }
    return c;
  }

  /** 카드 내용: 아이콘·이름·★·딱지·효과 글·테두리 색 */
  private cardInfo(choice: LevelUpChoice): {
    icon: string;
    iconFill: number;
    iconStars: number;
    name: string;
    nameColor: number;
    stars: number;
    chips: { text: string; color: number }[];
    desc: string;
    border: number;
  } {
    const { data, run } = this.opts;
    const L = T.combat.levelUp;
    if (choice.kind === 'boon') {
      const b = data.boons[choice.boon];
      const n = (runBoons(run)[choice.boon] ?? 0) + 1;
      return {
        icon: b?.icon ?? 'ui_heart',
        iconFill: shade(BOON_COLOR, 0.35),
        iconStars: 0,
        name: b?.name ?? choice.boon,
        nameColor: BOON_COLOR,
        stars: 0,
        chips: [{ text: `${L.kindBoon} ${L.boonStacks(n, b?.maxStacks ?? n)}`, color: BOON_COLOR }],
        desc: b?.desc ?? '',
        border: BOON_COLOR,
      };
    }
    const def = data.items[choice.defId];
    const rarity = def?.rarity ?? 'common';
    const rc = RARITY_COLORS[rarity];
    if (choice.kind === 'item') {
      return {
        icon: def?.icon ?? 'ui_bag',
        iconFill: rarityFill(rarity),
        iconStars: 1,
        name: def?.name ?? choice.defId,
        nameColor: rc,
        stars: 0,
        chips: [
          { text: L.kindItem, color: UI_COLORS.accent },
          { text: T.common.rarity[rarity], color: rc },
        ],
        desc: def ? `${T.common.kind[def.kind]} · ${def.desc}` : '',
        border: rc,
      };
    }
    // ★ + 1
    const next = Math.min(3, choice.tier + 1) as Tier;
    return {
      icon: def?.icon ?? 'ui_bag',
      iconFill: rarityFill(rarity),
      iconStars: choice.tier,
      name: def?.name ?? choice.defId,
      nameColor: UPGRADE_COLOR,
      stars: next,
      chips: [{ text: L.kindUpgrade, color: 0xc98a10 }],
      desc: this.upgradeDesc(choice.uid, choice.defId, next),
      border: UPGRADE_COLOR,
    };
  }

  /** ★ + 1 효과: 무기 = 공격력·쿨타임 지금 → 강화 후 (가방 그대로, 맞닿은 돌·보너스 포함), 돌·장비 = 강화 후 효과 */
  private upgradeDesc(uid: number, defId: string, next: Tier): string {
    const { data, run } = this.opts;
    const def = data.items[defId];
    if (!def) return '';
    if (def.kind === 'weapon') {
      const stats = runPlayerStats(data, run);
      const now = computeLoadout(run.bag, data.items, stats).find((l) => l.uid === uid);
      const bag2 = structuredClone(run.bag);
      const it = bag2.items.find((b) => b.uid === uid);
      if (!now || !it) return def.desc;
      it.tier = next;
      const after = computeLoadout(bag2, data.items, stats).find((l) => l.uid === uid);
      if (!after) return def.desc;
      const dmg = (l: { damage: number; count: number }): string => fmtNum(l.damage) + (l.count > 1 ? ` ${T.bag.times(l.count)}` : '');
      return T.combat.levelUp.weaponUpgrade(dmg(now), dmg(after), T.bag.seconds(now.cooldown), T.bag.seconds(after.cooldown));
    }
    if (def.kind === 'stone' && def.stone) {
      const text = stoneEffectText(scaledStone(def.stone, next));
      return text ? T.combat.levelUp.effectUpgrade(text) : def.desc;
    }
    if (def.kind === 'gear' && def.gear) {
      const text = gearEffectChips(scaledGear(def.gear, next))
        .map((c) => c.label)
        .join(', ');
      return text ? T.combat.levelUp.effectUpgrade(text) : def.desc;
    }
    return def.desc;
  }
}
