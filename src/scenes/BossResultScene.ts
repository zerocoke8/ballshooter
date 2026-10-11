// 보스 테스트 결과: 승리(색종이 + 기절한 보스 + 신난 캐릭터) / 패배(웃는 보스 + 축 처진 캐릭터) + 기록
// (클리어·버틴 시간, 남은 HP, 보스에게 준 피해, 백어택, 처치한 졸개, 도달 페이즈) + 다시 도전 / 캐릭터 변경 / 타이틀로.
// 보스 테스트는 저장하지 않는다 — 여기서 어디로 가든 일반 런 세이브('이어하기')는 그대로다.
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { sfx } from '../audio';
import { UI_COLORS } from '../config';
import type { Viewport } from '../core/app';
import { Keyboard } from '../core/keyboard';
import { Scene } from '../core/scene';
import { killTweensOf, tween } from '../core/tween';
import { game, type BossTestResult } from '../game';
import { T } from '../i18n/ko';
import { tex } from '../render/assets';
import { Button, Panel, textStyle } from '../ui';
import { ConfettiLayer, CountUp, SunBurst, centeredButton, coverSprite, drawStar } from './menuFx';

/** 전투에서 패배 징글이 울린 지 이보다(초) 오래면 결과 화면에서 다시 울린다 */
const DEFEAT_JINGLE_GAP = 5;
const WIN_TITLE_COLOR = 0xffd23f;
const LOSE_TITLE_COLOR = 0x9fb3d9;
const LOSE_TINT = 0xaab4cc;
const BOSS_DIZZY_TINT = 0xb9b0c4;
const WIN_DIM = 0.72;
const LOSE_DIM = 0.84;
const LOSE_DIM_COLOR = 0x141a2e;
/** 대결 그림: 캐릭터 초상화·보스 크기(px), 둘 사이 간격 */
const PORTRAIT_SIZE = 230;
const BOSS_SIZE = 290;
const DUEL_GAP = 40;
const DUEL_H = 270;
const PANEL_W = 620;
const ROW_H = 62;
const ROW_PAD = 16;
const BTN_W = 460;
const BTN_H = 112;
const SUB_W = 220;
const SUB_H = 92;
const SUB_GAP = 20;
const RETRY_COLOR = 0x4cc96b;
const CHANGE_COLOR = 0x7a4fc4;
const CONFETTI_INTERVAL = 0.45;
const STAR_COLOR = 0xffe14a;

interface StatRow {
  body: Container;
  count: CountUp;
}

export class BossResultScene extends Scene {
  readonly sceneName = 'BossResultScene';

  private readonly bg = new Sprite(tex('bg_title'));
  private readonly dim = new Graphics();
  private readonly burst: SunBurst | null;
  private readonly confetti = new ConfettiLayer();
  private readonly titleHolder = new Container();
  private readonly desc: Text;
  /** 대결 그림 (캐릭터 왼쪽, 보스 오른쪽) */
  private readonly duel = new Container();
  private readonly hero = new Container();
  private readonly heroSprite: Sprite;
  private readonly boss = new Container();
  private readonly bossSprite: Sprite;
  /** 승리: 보스 머리 위를 도는 별 (기절) */
  private readonly dizzy: Graphics[] = [];
  private readonly panel: Panel;
  private readonly panelH: number;
  private readonly rows: StatRow[] = [];
  private readonly retryHolder: Container;
  private readonly changeHolder: Container;
  private readonly titleBtnHolder: Container;
  private keyboard: Keyboard | null = null;
  private vp: Viewport | null = null;
  private clock = 0;
  private confettiTimer = 0;
  private leaving = false;

  constructor(readonly result: BossTestResult) {
    super();
    const won = result.won;
    const data = game.data;
    const character = data.characters[result.characterId] ?? Object.values(data.characters)[0];
    const bossDef = data.bosses[data.bossTest.stage.boss ?? ''];
    const bossEnemy = bossDef ? data.enemies[bossDef.enemy] : undefined;
    const bossName = bossEnemy?.name ?? data.bossTest.stage.name;

    this.dim.eventMode = 'none';
    this.burst = won ? new SunBurst(620, 0xfff1a8, 16) : null;
    this.addChild(this.bg, this.dim);
    if (this.burst) this.addChild(this.burst);

    // 제목 + 설명
    const title = new Text({
      text: won ? T.menu.bossWin : T.menu.bossLose,
      style: textStyle('title', { fontSize: 120, fill: won ? WIN_TITLE_COLOR : LOSE_TITLE_COLOR }),
    });
    title.anchor.set(0.5);
    this.titleHolder.addChild(title);
    if (won) {
      for (const side of [-1, 1]) {
        const star = drawStar(new Graphics(), 34, WIN_TITLE_COLOR);
        star.position.set(side * (title.width / 2 + 50), -10);
        star.rotation = side * 0.25;
        this.titleHolder.addChild(star);
      }
    }
    const hpLeftPct = result.bossMaxHp > 0 ? Math.max(0, Math.ceil(((result.bossMaxHp - result.bossDamage) / result.bossMaxHp) * 100)) : 0;
    this.desc = new Text({
      text: won ? T.menu.bossWinDesc(bossName) : T.menu.bossLoseDesc(hpLeftPct),
      style: textStyle('body', { fontSize: 30, fill: UI_COLORS.text, align: 'center' }),
    });
    this.desc.anchor.set(0.5, 0);
    if (this.desc.width > 660) this.desc.scale.set(660 / this.desc.width);
    this.addChild(this.titleHolder, this.desc);

    // 대결 그림
    this.heroSprite = new Sprite(tex(character?.portrait ?? 'portrait_penguin'));
    this.heroSprite.anchor.set(0.5, 1);
    this.heroSprite.scale.set(PORTRAIT_SIZE / Math.max(1, this.heroSprite.texture.width, this.heroSprite.texture.height));
    const heroShadow = new Graphics().ellipse(0, 0, PORTRAIT_SIZE * 0.34, 16).fill({ color: 0x000000, alpha: 0.3 });
    this.hero.addChild(heroShadow, this.heroSprite);
    this.bossSprite = new Sprite(tex(bossEnemy?.sprite ?? 'enemy_toybox_king'));
    this.bossSprite.anchor.set(0.5, 1);
    this.bossSprite.scale.set(BOSS_SIZE / Math.max(1, this.bossSprite.texture.width, this.bossSprite.texture.height));
    const bossShadow = new Graphics().ellipse(0, 0, BOSS_SIZE * 0.4, 18).fill({ color: 0x000000, alpha: 0.3 });
    this.boss.addChild(bossShadow, this.bossSprite);
    if (won) {
      this.bossSprite.tint = BOSS_DIZZY_TINT;
      for (let i = 0; i < 3; i++) {
        const st = drawStar(new Graphics(), 13, STAR_COLOR);
        this.dizzy.push(st);
        this.boss.addChild(st);
      }
    } else {
      this.heroSprite.tint = LOSE_TINT;
    }
    this.hero.x = -(BOSS_SIZE / 2 + DUEL_GAP / 2) + 10;
    this.boss.x = PORTRAIT_SIZE / 2 + DUEL_GAP / 2 + 10;
    this.duel.addChild(this.boss, this.hero);
    this.addChild(this.duel);

    // 기록
    const timeTenths = Math.max(0, Math.round(result.time * 10));
    const maxHp = Math.max(1, Math.round(result.maxHp));
    const bossMax = Math.max(1, result.bossMaxHp);
    const rows: { label: string; value: number; fmt: (n: number) => string; color: number }[] = [
      { label: won ? T.menu.clearTime : T.menu.survivedTime, value: timeTenths, fmt: (n) => T.menu.tenths(n), color: UI_COLORS.text },
      { label: T.menu.hpLeft, value: Math.round(result.hp), fmt: (n) => T.menu.hpOf(n, maxHp), color: result.hp > 0 ? UI_COLORS.hp : UI_COLORS.textDim },
      {
        label: T.menu.bossDamage,
        value: Math.round(result.bossDamage),
        fmt: (n) => T.menu.damageOf(n, Math.min(100, Math.floor((n / bossMax) * 100))),
        color: UI_COLORS.gold,
      },
      { label: T.menu.backAttacks, value: result.backAttacks, fmt: (n) => String(n), color: 0xff9ad5 },
      { label: T.menu.minionKills, value: result.minionKills, fmt: (n) => String(n), color: UI_COLORS.text },
      { label: T.menu.phaseReached, value: result.phase, fmt: (n) => T.menu.phaseOf(n, result.phases), color: UI_COLORS.good },
    ];
    this.panelH = ROW_PAD * 2 + ROW_H * rows.length;
    this.panel = new Panel(PANEL_W, this.panelH, { radius: 30 });
    rows.forEach((r, i) => {
      const body = new Container();
      body.y = ROW_PAD + i * ROW_H;
      const pad = 30;
      if (i > 0) body.addChild(new Graphics().rect(pad, 0, PANEL_W - pad * 2, 2).fill({ color: UI_COLORS.panelBorder, alpha: 0.5 }));
      const label = new Text({ text: r.label, style: textStyle('body', { fontSize: 28 }) });
      label.anchor.set(0, 0.5);
      label.position.set(pad, ROW_H / 2);
      const value = new Text({ text: '', style: textStyle('number', { fontSize: 36, fill: r.color }) });
      value.anchor.set(1, 0.5);
      value.position.set(PANEL_W - pad, ROW_H / 2);
      body.addChild(label, value);
      this.panel.addChild(body);
      this.rows.push({ body, count: new CountUp(value, Math.max(0, Math.round(r.value)), r.fmt) });
    });
    this.addChild(this.panel);

    const retry = new Button({ label: T.menu.bossRetry, width: BTN_W, height: BTN_H, color: RETRY_COLOR, fontSize: 46, onTap: () => this.retry() });
    const change = new Button({
      label: T.menu.changeCharacter,
      width: SUB_W,
      height: SUB_H,
      color: CHANGE_COLOR,
      fontSize: 32,
      onTap: () => this.changeCharacter(),
    });
    const toTitle = new Button({
      label: T.menu.toTitle,
      width: SUB_W,
      height: SUB_H,
      color: UI_COLORS.panelBorder,
      fontSize: 32,
      sound: 'ui_back',
      onTap: () => this.toTitle(),
    });
    this.retryHolder = centeredButton(retry, BTN_W, BTN_H);
    this.changeHolder = centeredButton(change, SUB_W, SUB_H);
    this.titleBtnHolder = centeredButton(toTitle, SUB_W, SUB_H);
    this.addChild(this.retryHolder, this.changeHolder, this.titleBtnHolder);
    // 색종이는 배경 위, 기록·버튼 아래 (글자 가독성)
    this.addChildAt(this.confetti, this.getChildIndex(this.panel));
  }

  override onEnter(): void {
    const kb = (this.keyboard = new Keyboard());
    kb.onPress('Enter', () => this.retry());
    kb.onPress('Space', () => this.retry());
    kb.onPress('Escape', () => this.toTitle());
    if (this.result.won) sfx.play('victory_run');
    else if (sfx.sinceLastPlay('defeat') > DEFEAT_JINGLE_GAP) sfx.play('defeat');
    void this.playIntro();
  }

  override onExit(): void {
    this.keyboard?.dispose();
    this.keyboard = null;
    killTweensOf(this.titleHolder.scale);
    killTweensOf(this.desc);
    killTweensOf(this.duel);
    killTweensOf(this.panel);
    for (const r of this.rows) {
      killTweensOf(r.body);
      killTweensOf(r.count);
    }
    for (const h of [this.retryHolder, this.changeHolder, this.titleBtnHolder]) killTweensOf(h.scale);
  }

  layout(vp: Viewport): void {
    this.vp = vp;
    const w = vp.width;
    const h = vp.height;
    coverSprite(this.bg, w, h);
    const won = this.result.won;
    this.dim.clear().rect(0, 0, w, h).fill({ color: won ? UI_COLORS.bg : LOSE_DIM_COLOR, alpha: won ? WIN_DIM : LOSE_DIM });
    this.confetti.setBottom(h);

    const top = vp.safeTop;
    const bottom = h - vp.safeBottom;
    const subY = bottom - 34 - SUB_H / 2;
    const retryY = subY - SUB_H / 2 - 18 - BTN_H / 2;
    const titleH = 140;
    const descH = 48;
    const avail = retryY - BTN_H / 2 - 28 - top;
    const fixedH = titleH + descH + this.panelH;
    // 화면이 짧으면 대결 그림을 줄여서 맞춘다
    const k = Math.max(0.55, Math.min(1, (avail - fixedH - 40) / DUEL_H));
    this.duel.scale.set(k);
    const duelH = DUEL_H * k;
    const free = Math.max(0, avail - fixedH - duelH);
    const gap = Math.min(54, free / 5);

    let y = top + gap + titleH / 2 + 16;
    this.titleHolder.position.set(w / 2, y);
    y += titleH / 2;
    this.desc.position.set(w / 2, y);
    y += descH + gap;
    this.burst?.position.set(w / 2, y + duelH / 2);
    this.duel.position.set(w / 2, y + duelH - 8 * k);
    y += duelH + gap;
    this.panel.position.set((w - PANEL_W) / 2, y);

    this.retryHolder.position.set(w / 2, retryY);
    this.changeHolder.position.set(w / 2 - (SUB_W + SUB_GAP) / 2, subY);
    this.titleBtnHolder.position.set(w / 2 + (SUB_W + SUB_GAP) / 2, subY);
  }

  override update(dt: number): void {
    this.clock += dt;
    this.burst?.update(dt);
    this.confetti.update(dt);
    for (const r of this.rows) r.count.sync();

    const t = this.clock;
    const hs = this.heroSprite;
    const bs = this.bossSprite;
    if (this.result.won) {
      // 캐릭터: 통통 점프 / 보스: 납작 기절 + 머리 위 별
      const phase = (t * 1.7) % 1;
      const jump = Math.sin(phase * Math.PI);
      hs.y = -jump * 42;
      hs.rotation = Math.sin(t * 3.4) * 0.06;
      bs.rotation = -0.22 + Math.sin(t * 1.2) * 0.03;
      bs.scale.y = Math.abs(bs.scale.x) * (0.86 + Math.sin(t * 2) * 0.015);
      const r = BOSS_SIZE * 0.32;
      const cy = -BOSS_SIZE * 0.72;
      this.dizzy.forEach((st, i) => {
        const a = t * 3 + (i * Math.PI * 2) / this.dizzy.length;
        st.position.set(Math.cos(a) * r, cy + Math.sin(a) * r * 0.3);
        st.scale.set(0.8 + 0.2 * Math.sin(a));
        st.alpha = Math.sin(a) > -0.2 ? 1 : 0.55;
      });
      this.confettiTimer -= dt;
      if (this.confettiTimer <= 0 && this.vp) {
        this.confettiTimer = CONFETTI_INTERVAL;
        this.confetti.rain(this.vp.width, 0, 6);
      }
    } else {
      // 보스: 껄껄 웃으며 들썩 / 캐릭터: 축 처짐
      const laugh = Math.abs(Math.sin(t * 7));
      bs.y = -laugh * 14;
      bs.rotation = Math.sin(t * 3.5) * 0.05;
      const base = Math.abs(bs.scale.x);
      bs.scale.y = base * (1 + laugh * 0.04);
      const sigh = (Math.sin(t * 1.3) + 1) / 2;
      hs.rotation = -0.12 + Math.sin(t * 0.7) * 0.03;
      hs.y = sigh * 6;
    }
  }

  // ───────────────────────────────────────────────────────────

  private async playIntro(): Promise<void> {
    const won = this.result.won;
    this.titleHolder.scale.set(0);
    this.desc.alpha = 0;
    this.duel.alpha = 0;
    this.panel.alpha = 0;
    for (const r of this.rows) r.body.alpha = 0;
    for (const h of [this.retryHolder, this.changeHolder, this.titleBtnHolder]) h.scale.set(0);

    await tween(this.titleHolder.scale, { x: 1, y: 1 }, won ? 0.6 : 0.8, won ? 'outElastic' : 'outBack');
    if (this.destroyed) return;
    if (won && this.vp) {
      this.confetti.burst(this.vp.width * 0.25, this.titleHolder.y + 40, 40, 1200);
      this.confetti.burst(this.vp.width * 0.75, this.titleHolder.y + 40, 40, 1200);
    }
    void tween(this.desc, { alpha: 1 }, 0.3);
    // 버튼은 일찍 (기록이 올라가는 동안에도 바로 누를 수 있게)
    void tween(this.retryHolder.scale, { x: 1, y: 1 }, 0.4, 'outBack');
    void tween(this.changeHolder.scale, { x: 0 }, 0.06).then(() => tween(this.changeHolder.scale, { x: 1, y: 1 }, 0.4, 'outBack'));
    void tween(this.titleBtnHolder.scale, { x: 0 }, 0.12).then(() => tween(this.titleBtnHolder.scale, { x: 1, y: 1 }, 0.4, 'outBack'));
    await tween(this.duel, { alpha: 1 }, 0.3);
    if (this.destroyed) return;
    void tween(this.panel, { alpha: 1 }, 0.2);
    for (const r of this.rows) {
      void tween(r.body, { alpha: 1 }, 0.2);
      await r.count.play(0.32);
      if (this.destroyed) return;
    }
  }

  /** 같은 캐릭터로 다시 (새 시드) */
  private retry(): void {
    if (this.leaving) return;
    this.leaving = true;
    game.startBossTest(this.result.characterId);
  }

  private changeCharacter(): void {
    if (this.leaving) return;
    this.leaving = true;
    game.toCharacterSelect('bossTest');
  }

  private toTitle(): void {
    if (this.leaving) return;
    this.leaving = true;
    game.toTitle();
  }
}
