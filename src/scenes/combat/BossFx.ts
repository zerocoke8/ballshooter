// 보스전 연출 (장난감 상자 대마왕): 보스 자세(숨쉬기 위의 예비 동작·실행 팝·포효 떨림·착지 출렁), 입 빛(행동 예고 색),
// 위험 지역 예고(sim.hazards) — 내려찍기 = 빨간 열 + 흐르는 줄무늬 + 차오르는 카운트다운 + 경고 표지 + 열 위의 깜짝 상자,
// 구슬 비 = 떨어질 자리 그림자 + 빨간 고리 + 위에서 떨어지는 구슬. 발동 순간 충격 연출(먼지·폭발은 Effects).
// 판정은 전부 sim — 여기서는 sim 상태·이벤트를 그림으로 옮기기만 한다. 매 프레임 할당 없음(위험 지역이 새로 생길 때만 스프라이트 생성).
import { Container, Graphics, Rectangle, Sprite, Texture, TilingSprite, type Renderer } from 'pixi.js';
import { CELL, FIELD_H } from '../../config';
import { tex } from '../../render/assets';
import type { BossActionKind, BossState, EnemyEntity, HazardEntity, HazardKind } from '../../types';
import type { Effects } from './Effects';
import type { EnemyLayer } from './EnemyLayer';
import type { FxTextures } from './fxTextures';
import {
  BOSS_GLOW_FLASH_TIME,
  BOSS_GLOW_MAX,
  BOSS_GLOW_MIN,
  BOSS_LAND_TIME,
  BOSS_POSE_RATE,
  BOSS_PUNCH_DECAY,
  BOSS_ROAR_COLOR,
  BOSS_TELL_COLOR,
  HAZARD_FADE_TIME,
  HAZARD_FILL_ALPHA,
  HAZARD_FILL_ALPHA_END,
  HAZARD_RED,
  HAZARD_STRIPE_ALPHA,
  HAZARD_STRIPE_SPEED,
  MARBLE_DROP_H,
  MARBLE_DROP_SCALE,
  MARBLE_SHOW_AT,
  MARBLE_SIZE,
  SLAM_DROP_TIME,
  SLAM_JACK_W,
  SUMMON_HOP_TIME,
} from './visual';

/** 구운 텍스처 (모듈 캐시 — 보스전마다 다시 굽지 않는다) */
interface BossTextures {
  /** 45° 흰 줄무늬 타일 (32×32, 이음매 없음) */
  stripes: Texture;
  /** 노란 삼각 경고 표지 (!) */
  sign: Texture;
  /** 흰 원 (128px) — 구슬 그림자 */
  disc: Texture;
}

let texCache: BossTextures | null = null;

/** 소환 착지 표시(칸 발밑 그림자): 폭(px)·최대 알파·사라지는 시간 */
const MARK_W = 70;
const MARK_ALPHA = 0.45;
const MARK_FADE = 0.15;
/** 칸 중심 → 발밑 */
const MARK_DY = CELL * 0.4;

interface LandMark {
  s: Sprite;
  /** 표시 시작 뒤 흐른 시간 (< 0 = 쉬는 중) */
  t: number;
}

function bake(renderer: Renderer, w: number, h: number, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  const t = renderer.generateTexture({ target: g, frame: new Rectangle(0, 0, w, h), resolution: 2, antialias: true });
  g.destroy();
  return t;
}

function bossTextures(renderer: Renderer): BossTextures {
  if (texCache) return texCache;
  texCache = {
    stripes: bake(renderer, 32, 32, (g) => {
      // 폭 32 주기의 45° 띠 (왼쪽 아래 → 오른쪽 위). 옆 타일과 이어지게 -32·0·32 세 번
      for (let i = -1; i <= 1; i++) {
        const o = i * 32;
        g.poly([o, 32, o + 14, 32, o + 46, 0, o + 32, 0]);
      }
      g.fill(0xffffff);
    }),
    sign: bake(renderer, 72, 64, (g) => {
      g.poly([36, 4, 68, 60, 4, 60]).fill(0xffd23f).stroke({ width: 6, color: 0x3a1a00, join: 'round' });
      g.roundRect(32, 20, 8, 24, 4).fill(0x3a1a00);
      g.circle(36, 51, 4.5).fill(0x3a1a00);
    }),
    disc: bake(renderer, 128, 128, (g) => {
      g.circle(64, 64, 62).fill(0xffffff);
    }),
  };
  return texCache;
}

interface HazardView {
  id: number;
  kind: HazardKind;
  /** 바닥 쪽 (적 아래) / 공중 쪽 (이펙트 위, 적 탄 아래) */
  ground: Container;
  air: Container;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  warnTime: number;
  activeTime: number;
  /** 바닥 부분 */
  fill: Sprite;
  stripes: TilingSprite | null;
  meter: Sprite | null;
  meterEdge: Sprite | null;
  edgeL: Sprite | null;
  edgeR: Sprite | null;
  sign: Sprite | null;
  ring: Sprite | null;
  /** 떨어지는 것 (깜짝 상자 / 구슬) */
  obj: Sprite;
  objScale: number;
  /** 'warn' 예고 중 / 'active' 발동 후 / 'gone' sim 목록에서 빠짐(사라지는 중) */
  state: 'warn' | 'active' | 'gone';
  /** 예고 진행 0..1 */
  k: number;
  /** 발동 뒤 / 사라지기 시작한 뒤 흐른 시간 */
  t: number;
  /** 발동 없이 사라졌나 (보스 처치로 취소) */
  cancelled: boolean;
  stamp: number;
}

export class BossFx {
  private readonly textures: BossTextures;
  private readonly views = new Map<number, HazardView>();
  private readonly list: HazardView[] = [];
  private readonly glow: Sprite;
  /** 소환 착지 표시 풀 (필요할 때만 늘어난다 — 동시에 최대 한 줄 + 포효 소환) */
  private readonly marks: LandMark[] = [];
  private stamp = 0;
  private clock = 0;

  // ── 입 빛 ──
  private glowColor = 0xffffff;
  private glowDur = 0;
  private glowFlash = 0;
  private actionKind: BossActionKind | null = null;

  // ── 자세 ──
  private px = 0;
  private py = 0;
  private psx = 1;
  private psy = 1;
  private punch = 0;
  private landT = 0;
  private roarDur = 1;
  private prevMode: BossState['mode'] | null = null;
  private dead = false;

  constructor(
    renderer: Renderer,
    private readonly fxTex: FxTextures,
    private readonly effects: Effects,
    private readonly enemies: EnemyLayer,
    private readonly groundLayer: Container,
    private readonly airLayer: Container,
  ) {
    this.textures = bossTextures(renderer);
    this.glow = new Sprite(fxTex.soft);
    this.glow.anchor.set(0.5);
    this.glow.blendMode = 'add';
    this.glow.alpha = 0;
    this.glow.visible = false;
    this.airLayer.addChild(this.glow);
  }

  // ── sim 이벤트 ──────────────────────────────────────────────

  /** 'bossAction' — 예비 동작 시작: 입 빛 색을 행동 종류로 */
  onAction(kind: BossActionKind, windup: number): void {
    this.actionKind = kind;
    this.glowColor = BOSS_TELL_COLOR[kind];
    this.glowDur = Math.max(0.05, windup);
  }

  /** 'bossPhase' — 포효 시작 (phase 0 = 등장 착지) */
  onPhase(phase: number, roar: number, boss: EnemyEntity | null): void {
    this.roarDur = Math.max(0.1, roar);
    this.actionKind = null;
    this.glowColor = BOSS_ROAR_COLOR;
    if (!boss) return;
    const mx = boss.x + boss.w / 2;
    const my = boss.y + boss.h;
    this.effects.roar(mx, my - boss.h * 0.35, boss.w * 0.55);
    if (phase === 0) {
      this.landT = BOSS_LAND_TIME;
      this.effects.landDust(boss.x + 20, boss.x + boss.w - 20, my);
    } else {
      this.punch = 1;
    }
  }

  /**
   * 'summon' 한 마리 — 입을 벌려 뱉는 팝 + 내려앉을 칸 발밑에 그림자(착지 표시), 내려앉는 순간 먼지. 졸개 몸은 이미 그 칸에 있고(sim)
   * 내려앉는 순간(SUMMON_LAND_TIME)부터 닿으면 즉사라, 어디에 떨어지는지 첫 프레임부터 보이게 한다 (x, y = 칸 중심)
   */
  onSummon(x: number, y: number): void {
    this.punch = Math.max(this.punch, 0.7);
    let m: LandMark | undefined;
    for (let i = 0; i < this.marks.length; i++) {
      if (this.marks[i].t < 0) {
        m = this.marks[i];
        break;
      }
    }
    if (!m) {
      const sp = new Sprite(this.fxTex.shadow);
      sp.anchor.set(0.5);
      this.groundLayer.addChild(sp);
      m = { s: sp, t: -1 };
      this.marks.push(m);
    }
    m.t = 0;
    m.s.visible = true;
    m.s.position.set(x, y + MARK_DY);
    this.drawMark(m);
  }

  private drawMark(m: LandMark): void {
    const k = Math.min(1, m.t / SUMMON_HOP_TIME);
    const fade = m.t > SUMMON_HOP_TIME ? 1 - Math.min(1, (m.t - SUMMON_HOP_TIME) / MARK_FADE) : 1;
    m.s.scale.set(((0.45 + 0.55 * k) * MARK_W) / Math.max(1, this.fxTex.shadow.width));
    m.s.alpha = (0.15 + (MARK_ALPHA - 0.15) * k) * fade;
  }

  private updateMarks(dt: number): void {
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i];
      if (m.t < 0) continue;
      const before = m.t;
      m.t += dt;
      // 졸개가 내려앉는 순간 발밑 먼지
      if (before < SUMMON_HOP_TIME && m.t >= SUMMON_HOP_TIME) this.effects.landPuff(m.s.x, m.s.y);
      if (m.t >= SUMMON_HOP_TIME + MARK_FADE) {
        m.t = -1;
        m.s.visible = false;
        continue;
      }
      this.drawMark(m);
    }
  }

  /** 'hazardImpact' — 발동 연출. 반환: 그 위험 지역 (흔들림·소리 결정용), 없으면 null */
  onHazardImpact(hazardId: number): HazardView | null {
    const v = this.views.get(hazardId);
    if (!v || v.state !== 'warn') return null;
    v.state = 'active';
    v.t = 0;
    v.k = 1;
    if (v.kind === 'slam') {
      v.fill.tint = 0xffffff;
      if (v.stripes) v.stripes.visible = false;
      if (v.meter) v.meter.visible = false;
      if (v.meterEdge) v.meterEdge.visible = false;
      if (v.sign) v.sign.visible = false;
      this.effects.slamImpact(v.cx, FIELD_H - 6, v.w);
    } else {
      this.effects.marbleImpact(v.cx, v.cy, v.w / 2);
    }
    return v;
  }

  /** 보스 처치: 빛·자세를 거두고 남은 예고는 사라지게 */
  onBossDead(): void {
    this.dead = true;
    this.glow.visible = false;
    this.actionKind = null;
  }

  // ── 매 프레임 ───────────────────────────────────────────────

  update(dt: number, boss: BossState | null, e: EnemyEntity | null, hazards: readonly HazardEntity[]): void {
    this.clock += dt;
    this.syncHazards(hazards, dt);
    this.updateMarks(dt);
    if (!boss || !e || !e.alive || this.dead) {
      this.glow.visible = false;
      return;
    }
    this.updatePose(dt, boss, e);
    this.updateGlow(dt, boss, e);
  }

  private updatePose(dt: number, boss: BossState, e: EnemyEntity): void {
    let tx = 0;
    let ty = 0;
    let tsx = 1;
    let tsy = 1;
    const mode = boss.mode;
    if (mode === 'act' && this.prevMode === 'windup') {
      // 실행 순간: 몸이 앞으로 튀는 팝 + 입 빛 번쩍
      this.punch = 1;
      this.glowFlash = BOSS_GLOW_FLASH_TIME;
    }
    this.prevMode = mode;
    const c = this.clock;
    if (mode === 'roar') {
      const k = Math.min(1, boss.modeTime / this.roarDur);
      tx = Math.sin(c * 48) * 6 * k;
      ty = -5 * k;
      tsx = 1 + 0.04 * k;
      tsy = 1 + 0.05 * k * (0.6 + 0.4 * Math.sin(c * 22));
    } else if (mode === 'windup' && boss.action) {
      const k = 1 - Math.min(1, boss.modeTime / this.glowDur);
      switch (boss.action) {
        case 'volley':
        case 'ring':
          // 숨 들이마시듯 뒤로 젖힘
          ty = -10 * k;
          tsy = 1 + 0.05 * k;
          tsx = 1 - 0.03 * k;
          break;
        case 'slam':
          // 들썩 솟아오름 + 부르르
          ty = -18 * k;
          tx = Math.sin(c * 40) * 2.5 * k;
          tsy = 1 + 0.03 * k;
          break;
        case 'marbles':
          tx = Math.sin(c * 46) * 4 * k;
          tsy = 1 + 0.03 * k;
          break;
        case 'summon':
          // 입(뚜껑)을 쩍 벌림: 세로로 늘어남
          ty = -6 * k;
          tsy = 1 + 0.12 * k;
          tsx = 1 - 0.05 * k;
          break;
      }
    }
    const a = Math.min(1, dt * BOSS_POSE_RATE);
    this.px += (tx - this.px) * a;
    this.py += (ty - this.py) * a;
    this.psx += (tsx - this.psx) * a;
    this.psy += (tsy - this.psy) * a;

    this.punch *= Math.exp(-BOSS_PUNCH_DECAY * dt);
    if (this.punch < 0.002) this.punch = 0;
    let sx = this.psx + 0.08 * this.punch;
    let sy = this.psy - 0.09 * this.punch;
    let oy = this.py + 8 * this.punch;
    if (this.landT > 0) {
      this.landT = Math.max(0, this.landT - dt);
      const k = this.landT / BOSS_LAND_TIME;
      const wob = Math.cos((1 - k) * Math.PI * 2.5) * k;
      sx += 0.1 * wob;
      sy -= 0.13 * wob;
      oy += 10 * wob;
    }
    this.enemies.setPose(e.id, this.px, oy, sx, sy);
  }

  private updateGlow(dt: number, boss: BossState, e: EnemyEntity): void {
    const g = this.glow;
    const mx = e.x + e.w / 2 + this.px;
    const my = e.y + e.h - 6 + this.py;
    let alpha = 0;
    let size = BOSS_GLOW_MIN;
    if (boss.mode === 'windup' && this.actionKind) {
      const k = 1 - Math.min(1, boss.modeTime / this.glowDur);
      const pulse = 0.85 + 0.15 * Math.sin(this.clock * (14 + 16 * k));
      alpha = (0.25 + 0.65 * k) * pulse;
      size = BOSS_GLOW_MIN + (BOSS_GLOW_MAX - BOSS_GLOW_MIN) * k;
    } else if (boss.mode === 'roar') {
      // 포효: 입 안이 붉게 일렁임 (졸개·HP 숫자를 덮어 하얗게 날리지 않게 옅게)
      alpha = 0.28 + 0.14 * Math.sin(this.clock * 30);
      size = BOSS_GLOW_MAX * 0.85;
      g.tint = BOSS_ROAR_COLOR;
    }
    if (this.glowFlash > 0) {
      this.glowFlash = Math.max(0, this.glowFlash - dt);
      const f = this.glowFlash / BOSS_GLOW_FLASH_TIME;
      alpha = Math.max(alpha, f);
      size = Math.max(size, BOSS_GLOW_MAX * (1.1 + 0.4 * (1 - f)));
    }
    if (alpha <= 0.01) {
      g.visible = false;
      return;
    }
    g.visible = true;
    if (boss.mode !== 'roar') g.tint = this.glowColor;
    g.alpha = Math.min(1, alpha);
    g.position.set(mx, my);
    g.scale.set(size / Math.max(1, this.fxTex.soft.width));
  }

  // ── 위험 지역 ───────────────────────────────────────────────

  private syncHazards(hazards: readonly HazardEntity[], dt: number): void {
    const stamp = ++this.stamp;
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      if (h.state === 'done') continue;
      let v = this.views.get(h.id);
      if (!v) {
        if (h.state !== 'warn') continue;
        v = this.create(h);
      }
      v.stamp = stamp;
      if (v.state === 'warn' && h.state === 'warn') v.k = 1 - Math.max(0, Math.min(1, h.timer / Math.max(1e-6, h.warnTime)));
    }
    const list = this.list;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (v.stamp !== stamp && v.state !== 'gone') {
        // sim 목록에서 빠짐: 발동 없이 빠졌으면 취소(보스 처치)
        v.cancelled = v.state === 'warn';
        v.state = 'gone';
        v.t = 0;
      }
      if (v.state === 'gone' && v.t >= (v.cancelled ? HAZARD_FADE_TIME * 0.6 : HAZARD_FADE_TIME)) {
        this.views.delete(v.id);
        v.ground.destroy({ children: true });
        v.air.destroy({ children: true });
        continue;
      }
      if (v.kind === 'slam') this.drawSlam(v, dt);
      else this.drawMarble(v, dt);
      list[w++] = v;
    }
    list.length = w;
  }

  private create(h: HazardEntity): HazardView {
    const ground = new Container();
    const air = new Container();
    const T = this.textures;
    const fill = new Sprite(Texture.WHITE);
    let stripes: TilingSprite | null = null;
    let meter: Sprite | null = null;
    let meterEdge: Sprite | null = null;
    let edgeL: Sprite | null = null;
    let edgeR: Sprite | null = null;
    let sign: Sprite | null = null;
    let ring: Sprite | null = null;
    const obj = new Sprite(tex(h.sprite));
    let objScale = 1;
    if (h.kind === 'slam') {
      fill.position.set(h.x, h.y);
      fill.width = h.w;
      fill.height = h.h;
      fill.tint = HAZARD_RED;
      stripes = new TilingSprite({ texture: T.stripes, width: h.w, height: h.h });
      stripes.position.set(h.x, h.y);
      stripes.tint = HAZARD_RED;
      meter = new Sprite(Texture.WHITE);
      meter.position.set(h.x, h.y);
      meter.width = h.w;
      meter.height = 0;
      meter.tint = HAZARD_RED;
      meter.alpha = 0.22;
      meterEdge = new Sprite(Texture.WHITE);
      meterEdge.width = h.w;
      meterEdge.height = 4;
      meterEdge.tint = 0xffe2e2;
      edgeL = new Sprite(Texture.WHITE);
      edgeR = new Sprite(Texture.WHITE);
      for (const [s, ex] of [
        [edgeL, h.x],
        [edgeR, h.x + h.w - 4],
      ] as const) {
        s.position.set(ex, h.y);
        s.width = 4;
        s.height = h.h;
        s.tint = HAZARD_RED;
      }
      sign = new Sprite(T.sign);
      sign.anchor.set(0.5);
      // 열 가운데쯤 (아래쪽에 두면 노리는 대상인 플레이어 몸에 가려진다)
      sign.position.set(h.x + h.w / 2, h.y + (FIELD_H - h.y) * 0.42);
      ground.addChild(fill, stripes, meter, meterEdge, edgeL, edgeR, sign);
      // 깜짝 상자: 열 위끝(보스 입 아래)에서 웅크렸다가 발동 순간 바닥으로 쾅
      obj.anchor.set(0.5, 0);
      objScale = Math.min(SLAM_JACK_W, h.w * 0.6) / Math.max(1, obj.texture.width);
      obj.scale.set(objScale);
      obj.position.set(h.x + h.w / 2, h.y);
    } else {
      const r = h.w / 2;
      fill.texture = T.disc;
      fill.anchor.set(0.5);
      fill.position.set(h.x + r, h.y + r);
      fill.tint = 0x1a0a14;
      ring = new Sprite(this.fxTex.ring);
      ring.anchor.set(0.5);
      ring.position.set(h.x + r, h.y + r);
      // 고리 텍스처: 128px에 반경 58
      ring.scale.set(r / 58);
      ring.tint = HAZARD_RED;
      ground.addChild(fill, ring);
      obj.anchor.set(0.5);
      objScale = (2 * r * MARBLE_SIZE) / Math.max(1, obj.texture.width, obj.texture.height);
      obj.scale.set(objScale);
      obj.position.set(h.x + r, h.y + r - MARBLE_DROP_H);
      obj.visible = false;
    }
    air.addChild(obj);
    this.groundLayer.addChild(ground);
    this.airLayer.addChild(air);
    const v: HazardView = {
      id: h.id,
      kind: h.kind,
      ground,
      air,
      x: h.x,
      y: h.y,
      w: h.w,
      h: h.h,
      cx: h.x + h.w / 2,
      cy: h.y + h.h / 2,
      warnTime: h.warnTime,
      activeTime: h.activeTime,
      fill,
      stripes,
      meter,
      meterEdge,
      edgeL,
      edgeR,
      sign,
      ring,
      obj,
      objScale,
      state: 'warn',
      k: 0,
      t: 0,
      cancelled: false,
      stamp: this.stamp,
    };
    this.views.set(h.id, v);
    this.list.push(v);
    return v;
  }

  private drawSlam(v: HazardView, dt: number): void {
    const c = this.clock;
    const jack = v.obj;
    if (v.state === 'warn') {
      const k = v.k;
      const pulse = 0.5 + 0.5 * Math.sin(c * (9 + 14 * k));
      v.fill.alpha = HAZARD_FILL_ALPHA + (HAZARD_FILL_ALPHA_END - HAZARD_FILL_ALPHA) * k + 0.06 * pulse;
      const st = v.stripes!;
      st.alpha = HAZARD_STRIPE_ALPHA + 0.15 * k;
      st.tilePosition.y += HAZARD_STRIPE_SPEED * (1 + k) * dt;
      // 카운트다운: 위에서부터 차오르는 빨간 막 + 밝은 앞선
      const mh = v.h * k;
      v.meter!.height = mh;
      v.meterEdge!.position.set(v.x, v.y + mh - 2);
      v.meterEdge!.alpha = 0.9;
      const blink = 0.55 + 0.45 * Math.abs(Math.sin(c * (6 + 12 * k)));
      v.edgeL!.alpha = blink;
      v.edgeR!.alpha = blink;
      const sg = v.sign!;
      sg.scale.set(1 + 0.12 * pulse * (0.4 + k));
      sg.alpha = 0.7 + 0.3 * pulse;
      // 깜짝 상자: 점점 웅크리며 떨림 (튀어나가기 직전)
      jack.x = v.cx + Math.sin(c * 50) * 3 * k;
      jack.y = v.y - 6 + 10 * k;
      jack.scale.set(v.objScale * (1 + 0.12 * k), v.objScale * (1 - 0.28 * k));
      jack.alpha = Math.min(1, k * 4);
      return;
    }
    v.t += dt;
    const jackH = jack.texture.height * v.objScale;
    if (v.state === 'active') {
      // 바닥으로 쾅: 열 전체가 흰빛으로 번쩍였다가 빨갛게 식는다
      const d = Math.min(1, v.t / SLAM_DROP_TIME);
      jack.x = v.cx;
      jack.y = v.y + (FIELD_H - jackH - v.y) * d * d;
      const land = Math.max(0, 1 - (v.t - SLAM_DROP_TIME) / 0.2);
      jack.scale.set(v.objScale * (1 + 0.25 * land * (d >= 1 ? 1 : 0)), v.objScale * (1 - 0.3 * land * (d >= 1 ? 1 : 0)));
      jack.alpha = 1;
      const f = Math.min(1, v.t / Math.max(0.05, v.activeTime));
      v.fill.tint = f < 0.35 ? 0xffffff : HAZARD_RED;
      v.fill.alpha = 0.6 * (1 - f) + 0.2;
      v.edgeL!.alpha = 1;
      v.edgeR!.alpha = 1;
      return;
    }
    // 사라짐
    const k = 1 - Math.min(1, v.t / HAZARD_FADE_TIME);
    v.ground.alpha = k;
    v.air.alpha = v.cancelled ? k : Math.min(1, k * 1.5);
  }

  private drawMarble(v: HazardView, dt: number): void {
    const c = this.clock;
    const m = v.obj;
    const r = v.w / 2;
    if (v.state === 'warn') {
      const k = v.k;
      // 그림자: 구슬이 가까워질수록 커지고 진해짐
      v.fill.alpha = 0.12 + 0.38 * k;
      v.fill.scale.set((2 * r * (0.45 + 0.55 * k)) / 128);
      const ring = v.ring!;
      ring.alpha = 0.45 + 0.35 * Math.abs(Math.sin(c * (8 + 14 * k)));
      // 구슬: 예고 뒤쪽 동안 자기 자리 바로 위에서 크게(가까이) 나타나 작아지며 떨어진다 — 위에서 내려다본 낙하.
      // 필드를 가로질러 날아오지 않게(적 탄으로 보이지 않게) 자리 근처에서만, 내려앉을 때까지 반투명
      if (k < MARBLE_SHOW_AT) {
        m.visible = false;
        return;
      }
      const q = (k - MARBLE_SHOW_AT) / (1 - MARBLE_SHOW_AT);
      const e = q * q;
      m.visible = true;
      m.x = v.cx;
      m.y = v.cy - MARBLE_DROP_H * (1 - e);
      m.rotation += dt * 7;
      m.scale.set(v.objScale * (1 + MARBLE_DROP_SCALE * (1 - e)));
      m.alpha = 0.25 + 0.65 * q;
      return;
    }
    v.t += dt;
    if (v.state === 'active') {
      m.visible = true;
      m.alpha = 1;
      m.x = v.cx;
      m.y = v.cy;
      const s = Math.max(0, 1 - v.t / 0.18);
      m.scale.set(v.objScale * (1 + 0.25 * s), v.objScale * (1 - 0.35 * s));
      v.fill.alpha = 0.5;
      v.ring!.alpha = 0.9;
      v.ring!.tint = 0xffffff;
      return;
    }
    const k = 1 - Math.min(1, v.t / HAZARD_FADE_TIME);
    v.ground.alpha = k;
    v.air.alpha = k;
    if (!v.cancelled) m.scale.set(v.objScale * (1 + 0.3 * (1 - k)));
  }

  /** 디버그/측정용: 그리고 있는 위험 지역 수 */
  get hazardViews(): number {
    return this.list.length;
  }

  destroy(): void {
    for (const v of this.list) {
      v.ground.destroy({ children: true });
      v.air.destroy({ children: true });
    }
    this.list.length = 0;
    this.views.clear();
    for (const m of this.marks) m.s.destroy();
    this.marks.length = 0;
    this.glow.destroy();
  }
}
