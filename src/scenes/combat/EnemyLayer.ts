// 적 스프라이트: sim 엔티티 id로 diff. 화면에 들어오기 직전에 만들고, 처치되면 '펑'(부풀며 하얘짐) 후 제거.
// HP 숫자는 비트맵 텍스트(값이 바뀔 때만 갱신).
// 피격: 맞은 면 반대로 밀렸다가 스프링으로 복귀 + 맞은 축으로 스쿼시(출렁) + 흰 번쩍임.
// 번쩍임·냉기·화상은 필터 대신 '덮개' 스프라이트(키마다 한 번 구운 흰/얼음 실루엣)를 몸 위에 겹친다 → 필터 비용 없음.
// 프레임 애니메이션이 있는 적(실루엣이 프레임과 안 맞음)은 예전 방식(ActorSprite 'hit' + tint)으로.
// 보스전: 씬이 보스 자세(setPose — 예비 동작·포효)를 덧입히고, 소환된 졸개는 입에서 칸으로 튀어나와 내려앉는다(hop).
// 행동하는 적: 폭탄병 심지 불꽃(간격마다), RC카가 옆으로 미끄러지면 뒤로 젖히며 바퀴 먼지, 치유받으면 연두 번쩍임,
// 빙하기로 언 적(EnemyEntity.frozen)은 진한 얼음 덮개 + 얼음 상자(처음 얼 때 한 번 만듦)를 씌우고 숨쉬기를 멈춘다 — 풀리면 얼음 조각.
import { BitmapText, Container, Sprite, type Renderer, type Texture } from 'pixi.js';
import { ActorSprite } from '../../render/actor';
import { animFrames, tex } from '../../render/assets';
import type { AnimState, EnemyDef, EnemyEntity } from '../../types';
import { enemyOverlayTextures, NUM_FONT, type EnemyOverlayTextures } from './fxTextures';
import {
  BIG_ENEMY_HIT_THROTTLE,
  BURN_EMIT_INTERVAL,
  BURN_OVERLAY_ALPHA,
  BURN_OVERLAY_COLOR,
  BURN_TINT,
  CHILL_TINT,
  ENEMY_DIE_TIME,
  ENEMY_FLASH_TIME,
  ENEMY_HIT_THROTTLE,
  ENEMY_HP_LIFT,
  ENEMY_HP_LIFT_BIG,
  ENEMY_KNOCKBACK,
  ENEMY_POP_SCALE,
  ENEMY_POP_TIME,
  ENEMY_PRESPAWN,
  ENEMY_SPRING_W,
  ENEMY_SPRING_ZETA,
  ENEMY_SPRITE_SCALE,
  ENEMY_SQUASH,
  FROST_EMIT_INTERVAL,
  BOSS_FROST_OVERLAY_ALPHA,
  FROST_OVERLAY_ALPHA,
  FROZEN_OVERLAY_ALPHA,
  FUSE_EMIT_INTERVAL,
  HEAL_FLASH_TIME,
  HEAL_FLASH_TINT,
  ICE_BLOCK_ALPHA,
  MAX_HIT_FLASHES,
  SLIDE_DUST_INTERVAL,
  SLIDE_LEAN,
  SLIDE_SETTLE_TIME,
} from './visual';

/** ActorSprite 코드 애니메이션 'hit' 길이 (actor.ts의 CODE_DURATION.hit) */
const HIT_ANIM_TIME = 0.3;
const ANIM_STATES: readonly AnimState[] = ['idle', 'move', 'attack', 'hit', 'die'];
/** 스프링 적분 최대 스텝 (명시적 적분이 느린 프레임에서도 튀지 않게 쪼갠다) */
const SPRING_DT = 1 / 120;
/** 냉기·화상 덮개가 켜지고 꺼지는 속도 (1/초) */
const STATUS_FADE = 7;
/** 직접 타격으로 볼 적중점: 중심에서 반 크기의 이 비율 밖(가장자리) */
const EDGE_RATIO = 0.55;
/** 얼어 있는 적의 피격 번쩍임 색 (흰 실루엣에 곱함 — 아주 옅은 하늘색) */
const FROST_FLASH_TINT = 0xe2f6ff;
/** 소환 졸개가 입에서 칸으로 날아가는 포물선 높이(px)와 시작 크기 */
const HOP_ARC = 70;
const HOP_START_SCALE = 0.35;

/** 상태이상·행동 파티클을 뿌리는 쪽 (Effects) */
export interface StatusEmitter {
  burnEmit(x: number, y: number, w: number, h: number): void;
  frostEmit(x: number, y: number, w: number, h: number): void;
  /** 폭탄병 심지 끝 불꽃 */
  fuseEmit(x: number, y: number): void;
  /** RC카 바퀴 먼지 (뒤쪽 바닥, dir = 가는 쪽) */
  slideDust(x: number, y: number, dir: number): void;
  /** 얼림이 풀림 — 얼음 조각 */
  iceShatter(x: number, y: number, size: number): void;
}
/** 폭탄병 그림의 심지 끝 (보이는 크기 대비, 몸 중심 기준) */
const FUSE_DX = 0.08;
const FUSE_DY = -0.43;
/** 이만큼(px) 넘게 옆으로 움직였으면 미끄러지는 중 (적은 옆걸음으로만 옆으로 움직인다) */
const SLIDE_EPS = 0.05;
/** 얼음 상자 크기 (충돌 박스 대비) */
const ICE_BLOCK_SCALE = 1.16;

/** hitInfo 결과 (호출 쪽이 하나 만들어 재사용) */
export interface HitInfo {
  /** 적중점이 가장자리(직접 타격)인가 — 아니면 중심(화상 틱·폭발·연쇄) */
  edge: boolean;
  /** 맞은 면의 바깥 법선 (축 정렬) — 공이 온 쪽 */
  nx: number;
  ny: number;
  cx: number;
  cy: number;
  /** 보이는 크기(긴 변) */
  size: number;
}

interface EnemyView {
  id: number;
  actor: ActorSprite;
  hp: BitmapText;
  /** HP 숫자 중심을 충돌 박스 아래 끝에서 이만큼 위에 */
  hpLift: number;
  shownHp: number;
  tint: number;
  hitCd: number;
  hitAnim: number;
  throttle: number;
  stamp: number;
  /** 처치 후 남은 연출 시간 */
  dieT: number;
  /** 마지막 동기화 때 충돌 박스 */
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  big: boolean;
  /** 덮개 (프레임 애니메이션이 없을 때만) */
  overlay: Sprite | null;
  ov: EnemyOverlayTextures | null;
  ovMode: 0 | 1 | 2 | 3;
  flashT: number;
  frost: number;
  /** 냉기 덮개 최대 알파 — 보스는 낮게(큰 그림이 얼음 실루엣에 묻혀 읽히지 않게) */
  frostAlpha: number;
  burn: number;
  /** 밀림 스프링 (px) */
  kx: number;
  ky: number;
  kvx: number;
  kvy: number;
  /** 스쿼시 스프링 (1 = 최대 납작), 축: 0 = 위아래에서 맞음(세로로 납작), 1 = 옆에서 */
  sq: number;
  sqv: number;
  sqAxis: 0 | 1;
  springing: boolean;
  burnEmitT: number;
  frostEmitT: number;
  /** 처치 '펑' 진행 (초). 덮개 없는 적은 쓰지 않음 */
  popT: number;
  /** 씬이 덧입히는 자세 (보스 예비 동작·포효): 위치 오프셋(px)·크기 배수 */
  poseX: number;
  poseY: number;
  poseSx: number;
  poseSy: number;
  /** 소환 튀어나오기: 진행(초) / 길이, 시작점 - 칸 중심 */
  hopT: number;
  hopDur: number;
  hopDx: number;
  hopDy: number;
  /** 번쩍임 색·길이 (피격 = 흰색 ENEMY_FLASH_TIME, 회복 = 연두 HEAL_FLASH_TIME) */
  flashTint: number;
  flashDur: number;
  /** 폭탄병: 심지 불꽃 다음까지 */
  fuse: boolean;
  fuseT: number;
  /** 옆걸음(RC카): 지난 프레임 x와의 차로 미끄러짐을 본다 — 기울기(라디안)·방향·멈춘 뒤 남은 시간·먼지 타이머 */
  lean: number;
  slideDir: number;
  slideT: number;
  dustT: number;
  /** 얼림(빙하기): 얼음 상자 진하기 0..1, 얼음 상자(처음 얼 때 만듦), 지난 프레임에 얼어 있었나 */
  frozenA: number;
  ice: Sprite | null;
  wasFrozen: boolean;
}

const OV_NONE = 0;
const OV_FLASH = 1;
const OV_FROST = 2;
const OV_BURN = 3;

export class EnemyLayer extends Container {
  private readonly actors = new Container();
  private readonly labels = new Container();
  private readonly views = new Map<number, EnemyView>();
  /** 살아있는 뷰 목록 (매 프레임 회수 검사 — Map을 for-of로 돌면 반복자 결과 객체가 할당된다) */
  private readonly live: EnemyView[] = [];
  private readonly dying: EnemyView[] = [];
  private readonly framesByKey = new Map<string, boolean>();
  /** 아직 뷰가 없는 적의 소환 튀어나오기 (뷰를 만들 때 적용) */
  private readonly pendingHops = new Map<number, { x: number; y: number; dur: number }>();
  private stamp = 0;
  private flashing = 0;
  private clock = 0;
  private seq = 0;

  /**
   * @param iceTex 얼음 상자 텍스처 (fxTextures().iceBlock) — 없으면 빙하기에 얼음 덮개만
   */
  constructor(
    private readonly defs: Record<string, EnemyDef>,
    private readonly renderer: Renderer,
    private readonly emitter: StatusEmitter,
    private readonly iceTex: Texture | null = null,
  ) {
    super();
    this.eventMode = 'none';
    this.interactiveChildren = false;
    this.addChild(this.actors, this.labels);
  }

  /** 매 프레임. 가장 아래 적의 아래 끝(y+h)을 반환 (적이 없으면 -Infinity) */
  sync(enemies: readonly EnemyEntity[], dt: number): number {
    const stamp = ++this.stamp;
    this.clock += dt;
    let lowest = -Infinity;
    let flashing = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const bottom = e.y + e.h;
      if (bottom > lowest) lowest = bottom;
      if (bottom <= -ENEMY_PRESPAWN) continue;
      let v = this.views.get(e.id);
      if (!v) v = this.create(e);
      v.stamp = stamp;
      // 옆으로 움직였다 = RC카가 미끄러지는 중 (하강·보스 기어 내려오기는 세로뿐)
      const sdx = e.x - v.x;
      if (sdx > SLIDE_EPS || sdx < -SLIDE_EPS) {
        v.slideDir = sdx > 0 ? 1 : -1;
        v.slideT = SLIDE_SETTLE_TIME;
      }
      v.x = e.x;
      v.y = e.y;
      v.w = e.w;
      v.h = e.h;
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      v.hp.position.set(cx, e.y + e.h - v.hpLift);
      const hp = e.hp > 0 ? Math.ceil(e.hp) : 0;
      if (hp !== v.shownHp) {
        v.shownHp = hp;
        v.hp.text = String(hp);
      }
      if (v.hitCd > 0) v.hitCd -= dt;
      if (v.hitAnim > 0) {
        v.hitAnim -= dt;
        flashing++;
      }

      // 얼림(빙하기): 얼음 상자 + 진한 덮개, 풀리는 순간 얼음 조각
      const frozen = e.frozen > 0;
      if (frozen || v.frozenA > 0) {
        v.frozenA = approach(v.frozenA, frozen ? 1 : 0, (frozen ? STATUS_FADE * 1.6 : STATUS_FADE) * dt);
        this.applyIce(v, e);
      }
      if (v.wasFrozen && !frozen && e.alive) this.emitter.iceShatter(cx, cy, v.size);
      v.wasFrozen = frozen;
      if (v.overlay) {
        v.frost = approach(v.frost, e.chillTime > 0 ? 1 : 0, STATUS_FADE * dt);
        v.burn = approach(v.burn, e.burnTime > 0 ? 1 : 0, STATUS_FADE * dt);
        if (v.flashT > 0) v.flashT = Math.max(0, v.flashT - dt);
        this.applyOverlay(v);
      } else {
        const tint = e.chillTime > 0 ? CHILL_TINT : e.burnTime > 0 ? BURN_TINT : 0xffffff;
        if (tint !== v.tint) {
          v.tint = tint;
          v.actor.setTint(tint);
        }
      }

      // 상태이상 파티클 (화면 안의 적만)
      if (bottom > 0) {
        if (e.burnTime > 0) {
          v.burnEmitT -= dt;
          if (v.burnEmitT <= 0) {
            v.burnEmitT += BURN_EMIT_INTERVAL * (0.75 + 0.5 * this.jitter());
            this.emitter.burnEmit(cx, cy, e.w, e.h);
          }
        } else v.burnEmitT = 0;
        if (e.chillTime > 0) {
          v.frostEmitT -= dt;
          if (v.frostEmitT <= 0) {
            v.frostEmitT += FROST_EMIT_INTERVAL * (0.75 + 0.5 * this.jitter());
            this.emitter.frostEmit(cx, cy, e.w, e.h);
          }
        } else v.frostEmitT = 0;
        // 폭탄병 심지: 얼어 있지 않으면 계속 타들어 간다
        if (v.fuse && !frozen) {
          v.fuseT -= dt;
          if (v.fuseT <= 0) {
            v.fuseT += FUSE_EMIT_INTERVAL * (0.7 + 0.6 * this.jitter());
            const s = v.size;
            this.emitter.fuseEmit(cx + v.kx + s * FUSE_DX * v.actor.scale.x, cy + v.ky + s * FUSE_DY * v.actor.scale.y);
          }
        }
        // RC카 바퀴 먼지 (미끄러지는 동안)
        if (v.slideT >= SLIDE_SETTLE_TIME - 1e-6) {
          v.dustT -= dt;
          if (v.dustT <= 0) {
            v.dustT += SLIDE_DUST_INTERVAL;
            this.emitter.slideDust(cx - v.slideDir * e.w * 0.38, e.y + e.h - 2, v.slideDir);
          }
        } else v.dustT = 0;
      }
      // 미끄러지는 동안 뒤로 젖힘(앞바퀴가 들림), 멈추면 SLIDE_SETTLE_TIME 동안 돌아온다
      if (v.slideT > 0 || v.lean !== 0) {
        const want = v.slideT >= SLIDE_SETTLE_TIME - 1e-6 ? -v.slideDir * SLIDE_LEAN : 0;
        v.lean = approach(v.lean, want, (SLIDE_LEAN / 0.08) * dt);
        if (v.slideT > 0) v.slideT = Math.max(0, v.slideT - dt);
        v.actor.rotation = v.lean;
      }

      if (v.hopT < v.hopDur) {
        v.hopT += dt;
        if (v.hopT >= v.hopDur) {
          // 착지: 세로로 납작했다 출렁
          v.sq = Math.max(v.sq, 0.75);
          v.sqv = 0;
          v.sqAxis = 0;
          v.springing = true;
          v.hp.visible = true;
        }
      }
      if (v.springing) stepSpring(v, dt);
      this.applyPose(v, cx, cy);
      // 꽁꽁 얼면 숨쉬기(코드 애니메이션)도 멈춘다
      if (v.frozenA < 0.5) v.actor.update(dt);
    }
    this.flashing = flashing;

    // 이벤트 없이 사라진 적(정상 흐름에선 없음)도 정리. 처치(onKill)로 이미 빠진 뷰는 목록에서만 뺀다
    const live = this.live;
    let w = 0;
    for (let i = 0; i < live.length; i++) {
      const v = live[i];
      if (this.views.get(v.id) !== v) continue;
      if (v.stamp !== stamp) {
        this.startDie(v);
        continue;
      }
      live[w++] = v;
    }
    live.length = w;

    for (let i = this.dying.length - 1; i >= 0; i--) {
      const v = this.dying[i];
      v.dieT -= dt;
      if (v.overlay) {
        // 펑: 부풀며 하얘지다가 사라짐 (터지는 연기·파편은 Effects.killBurst가 같은 순간에)
        v.popT += dt;
        const k = Math.min(1, v.popT / ENEMY_POP_TIME);
        const s = 1 + (ENEMY_POP_SCALE - 1) * (1 - (1 - k) * (1 - k));
        v.actor.scale.set(s * (1 + 0.06 * k), s * (1 - 0.04 * k));
        const o = v.overlay;
        if (o.texture !== v.ov!.white) o.texture = v.ov!.white;
        o.tint = 0xffffff;
        o.alpha = 0.35 + 0.65 * k;
        o.visible = true;
        if (k >= 1) v.actor.visible = false;
      } else {
        v.actor.update(dt);
      }
      if (v.dieT <= 0) {
        v.actor.destroy({ children: true });
        v.hp.destroy();
        this.dying.splice(i, 1);
      }
    }
    return lowest;
  }

  /**
   * 적중점 분류 + 밀림 방향. 보이는 적이 아니면 null.
   * 가장자리(직접 타격)면 맞은 면의 바깥 법선(공이 온 쪽, 축 정렬), 중심이면 위쪽.
   */
  hitInfo(enemyId: number, x: number, y: number, out: HitInfo): HitInfo | null {
    const v = this.views.get(enemyId);
    if (!v) return null;
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;
    const u = (x - cx) / Math.max(1, v.w / 2);
    const w = (y - cy) / Math.max(1, v.h / 2);
    out.cx = cx;
    out.cy = cy;
    out.size = v.size;
    out.edge = Math.max(Math.abs(u), Math.abs(w)) > EDGE_RATIO;
    if (!out.edge) {
      out.nx = 0;
      out.ny = -1;
    } else if (Math.abs(w) >= Math.abs(u)) {
      out.nx = 0;
      out.ny = w < 0 ? -1 : 1;
    } else {
      out.nx = u < 0 ? -1 : 1;
      out.ny = 0;
    }
    return out;
  }

  /**
   * 피격 연출: (dx, dy) 방향(단위 벡터)으로 밀리고 그 축으로 납작해졌다 출렁이며 복귀 + 흰 번쩍임.
   * strength 0..1 (폭발·연쇄는 작게). 적마다 스로틀.
   */
  onHit(enemyId: number, dx: number, dy: number, strength: number): void {
    const v = this.views.get(enemyId);
    if (!v || v.hitCd > 0) return;
    v.hitCd = v.throttle;
    if (!v.overlay) {
      if (this.flashing >= MAX_HIT_FLASHES) return;
      this.flashing++;
      v.hitAnim = HIT_ANIM_TIME;
      void v.actor.play('hit');
      return;
    }
    v.flashT = ENEMY_FLASH_TIME;
    v.flashTint = 0xffffff;
    v.flashDur = ENEMY_FLASH_TIME;
    const kb = ENEMY_KNOCKBACK * strength * (v.big ? 0.45 : 1);
    const lim = ENEMY_KNOCKBACK * 1.6;
    v.kx = clampAbs(v.kx + dx * kb, lim);
    v.ky = clampAbs(v.ky + dy * kb, lim);
    v.sq = Math.max(v.sq, strength * (v.big ? 0.4 : 1));
    v.sqv = 0;
    v.sqAxis = Math.abs(dy) >= Math.abs(dx) ? 0 : 1;
    v.springing = true;
  }

  /** 치유병에게 회복받음: 연두 번쩍임 + 옆으로 살짝 부풀었다 출렁 (피격 스로틀과 무관) */
  onHeal(enemyId: number): void {
    const v = this.views.get(enemyId);
    if (!v || !v.overlay) return;
    v.flashT = HEAL_FLASH_TIME;
    v.flashTint = HEAL_FLASH_TINT;
    v.flashDur = HEAL_FLASH_TIME;
    v.sq = Math.min(v.sq, -0.5);
    v.sqv = 0;
    v.sqAxis = 0;
    v.springing = true;
  }

  /**
   * 씬이 덧입히는 자세 (보스): 위치 오프셋(px)과 크기 배수. 피격 밀림·스쿼시 위에 곱해진다. 뷰가 없으면 무시
   */
  setPose(enemyId: number, x: number, y: number, sx: number, sy: number): void {
    const v = this.views.get(enemyId);
    if (!v) return;
    v.poseX = x;
    v.poseY = y;
    v.poseSx = sx;
    v.poseSy = sy;
  }

  /**
   * 소환 연출: (fromX, fromY)(보스 입)에서 작게 튀어나와 포물선을 그리며 자기 칸으로 날아가 내려앉는다(dur초).
   * 판정은 sim이 이미 칸에 두었다 — 그림만. 뷰가 아직 없으면 만들 때 적용
   */
  hop(enemyId: number, fromX: number, fromY: number, dur: number): void {
    const v = this.views.get(enemyId);
    if (!v) {
      this.pendingHops.set(enemyId, { x: fromX, y: fromY, dur });
      return;
    }
    startHop(v, fromX, fromY, dur);
  }

  onAttack(enemyId: number): void {
    const v = this.views.get(enemyId);
    if (!v || v.hitAnim > 0) return;
    const s = v.actor.state;
    if (s === 'idle' || s === 'move') void v.actor.play('attack');
  }

  /** 처치 연출 시작. 보이던 적이면 보이는 크기(긴 변) 반환, 아니면 0 */
  onKill(enemyId: number): number {
    const v = this.views.get(enemyId);
    if (!v) return 0;
    // 언 채로 깨지면 얼음 상자 조각도 같이
    if (v.frozenA > 0.3) {
      this.emitter.iceShatter(v.x + v.w / 2, v.y + v.h / 2, v.size);
      if (v.ice) v.ice.visible = false;
    }
    this.startDie(v);
    return v.size;
  }

  private startDie(v: EnemyView): void {
    this.views.delete(v.id);
    v.hp.visible = false;
    if (v.overlay) {
      v.dieT = ENEMY_POP_TIME + 0.02;
      v.popT = 0;
      v.springing = false;
      v.actor.position.set(v.x + v.w / 2 + v.kx * 0.5, v.y + v.h / 2 + v.ky * 0.5);
    } else {
      v.dieT = ENEMY_DIE_TIME;
      v.actor.setTint(0xffffff);
      void v.actor.play('die');
    }
    this.dying.push(v);
  }

  private applyPose(v: EnemyView, cx: number, cy: number): void {
    let ox = v.kx + v.poseX;
    let oy = v.ky + v.poseY;
    let ex = v.poseSx;
    let ey = v.poseSy;
    if (v.hopT < v.hopDur) {
      const k = v.hopT / v.hopDur;
      const e = 1 - (1 - k) * (1 - k);
      ox += v.hopDx * (1 - e);
      oy += v.hopDy * (1 - e) - Math.sin(Math.PI * k) * HOP_ARC;
      const s = HOP_START_SCALE + (1 - HOP_START_SCALE) * e;
      ex *= s;
      ey *= s;
    }
    v.actor.position.set(cx + ox, cy + oy);
    if (!v.overlay) {
      if (v.actor.scale.x !== ex || v.actor.scale.y !== ey) v.actor.scale.set(ex, ey);
      return;
    }
    const a = ENEMY_SQUASH * v.sq;
    if (v.sqAxis === 0) v.actor.scale.set((1 + a * 0.75) * ex, (1 - a) * ey);
    else v.actor.scale.set((1 - a) * ex, (1 + a * 0.75) * ey);
  }

  private applyOverlay(v: EnemyView): void {
    const o = v.overlay!;
    const ov = v.ov!;
    let mode: EnemyView['ovMode'] = OV_NONE;
    if (v.flashT > 0) mode = OV_FLASH;
    else if (v.frost > 0.01) mode = OV_FROST;
    else if (v.burn > 0.01) mode = OV_BURN;
    if (mode !== v.ovMode) {
      v.ovMode = mode;
      o.visible = mode !== OV_NONE;
      const t = mode === OV_FROST ? ov.frost : ov.white;
      if (o.texture !== t) o.texture = t;
      o.tint = mode === OV_BURN ? BURN_OVERLAY_COLOR : 0xffffff;
    }
    if (mode === OV_FLASH) {
      const heal = v.flashTint !== 0xffffff;
      const a = heal ? 0.12 + 0.5 * (v.flashT / v.flashDur) : 0.25 + 0.7 * (v.flashT / v.flashDur);
      if (heal) {
        if (o.texture !== ov.white) o.texture = ov.white;
        if (o.tint !== v.flashTint) o.tint = v.flashTint;
        o.alpha = a;
      } else if (v.frost > 0.01) {
        // 얼어 있는 적: 하늘빛 흰 번쩍임, 냉기 덮개 알파 아래로는 내려가지 않음 — 번쩍임 끝에 원래 색(빨강·크림)이
        // 비쳐 '파랑 → 분홍 → 파랑'으로 깜빡이던 것을 막는다
        if (o.tint !== FROST_FLASH_TINT) o.tint = FROST_FLASH_TINT;
        o.alpha = Math.max(v.frostAlpha * v.frost, a);
      } else {
        if (o.tint !== 0xffffff) o.tint = 0xffffff;
        // 번쩍임이 끝나 갈 때 아래 깔린 덮개 쪽으로 자연스럽게 (알파만)
        o.alpha = a;
      }
    } else if (mode === OV_FROST) {
      // 얼림(빙하기)은 냉기보다 진하게 — 꽁꽁 언 얼음 색
      const base = Math.max(v.frostAlpha * v.frost, FROZEN_OVERLAY_ALPHA * v.frozenA);
      o.alpha = base * (0.92 + 0.08 * Math.sin(this.clock * 5 + v.id));
    } else if (mode === OV_BURN) {
      o.alpha = BURN_OVERLAY_ALPHA * v.burn * (0.65 + 0.35 * Math.sin(this.clock * 13 + v.id * 1.7));
    }
  }

  /** 얼음 상자: 처음 얼 때 한 번 만들고(액터 자식 — 피격 스쿼시를 같이 탄다), 진하기만 바꾼다 */
  private applyIce(v: EnemyView, e: EnemyEntity): void {
    if (!this.iceTex) return;
    let ice = v.ice;
    if (!ice) {
      if (v.frozenA <= 0) return;
      ice = new Sprite(this.iceTex);
      ice.anchor.set(0.5);
      v.actor.addChild(ice);
      v.ice = ice;
    }
    const a = v.frozenA;
    ice.visible = a > 0.01;
    if (!ice.visible) return;
    // 얼어붙는 순간 살짝 크게 → 제 크기 ('쩡')
    const pop = 1 + 0.12 * (1 - a);
    ice.width = e.w * ICE_BLOCK_SCALE * pop;
    ice.height = e.h * ICE_BLOCK_SCALE * pop;
    ice.alpha = ICE_BLOCK_ALPHA * a;
  }

  /** 이 에셋 키의 덮개 텍스처를 미리 굽는다 (인트로 동안 — 처음 나타날 때 끊기지 않게) */
  prepare(key: string): void {
    if (!this.hasFrames(key)) enemyOverlayTextures(this.renderer, key);
  }

  private hasFrames(key: string): boolean {
    let has = this.framesByKey.get(key);
    if (has === undefined) {
      has = ANIM_STATES.some((s) => animFrames(key, s) !== null);
      this.framesByKey.set(key, has);
    }
    return has;
  }

  /** 0..1 결정적 의사난수 (연출 간격 흔들기용 — 게임 RNG와 무관) */
  private jitter(): number {
    this.seq = (this.seq * 1103515245 + 12345) & 0x7fffffff;
    return this.seq / 0x7fffffff;
  }

  private create(e: EnemyEntity): EnemyView {
    const def = this.defs[e.defId];
    const key = def?.sprite ?? `enemy_${e.defId}`;
    // 텍스처 비율을 유지한 채 충돌 박스에 맞춤 (긴 변 기준 displaySize로 환산)
    const t = tex(key);
    const tw = Math.max(1, t.width);
    const th = Math.max(1, t.height);
    const fit = Math.min(e.w / tw, e.h / th) * Math.max(tw, th) * ENEMY_SPRITE_SCALE;
    const actor = new ActorSprite(key, fit);
    const big = e.boss || e.w > 100;
    const hp = new BitmapText({
      text: String(Math.ceil(e.hp)),
      style: { fontFamily: NUM_FONT, fontSize: e.boss ? 40 : big ? 32 : 26 },
    });
    hp.anchor.set(0.5, 0.5);
    this.actors.addChild(actor);
    this.labels.addChild(hp);

    // 덮개: 몸(포즈가 적용되는 컨테이너 = baseSprite의 부모)에 같은 앵커·크기로 겹친다
    let overlay: Sprite | null = null;
    let ov: EnemyOverlayTextures | null = null;
    const body = actor.baseSprite.parent;
    if (body && !this.hasFrames(key)) {
      ov = enemyOverlayTextures(this.renderer, key);
      overlay = new Sprite(ov.white);
      overlay.anchor.copyFrom(actor.baseSprite.anchor);
      overlay.scale.copyFrom(actor.baseSprite.scale);
      overlay.position.copyFrom(actor.baseSprite.position);
      overlay.visible = false;
      body.addChild(overlay);
    }

    const v: EnemyView = {
      id: e.id,
      actor,
      hp,
      hpLift: big ? ENEMY_HP_LIFT_BIG : ENEMY_HP_LIFT,
      shownHp: Math.ceil(e.hp),
      tint: 0xffffff,
      hitCd: 0,
      hitAnim: 0,
      throttle: big ? BIG_ENEMY_HIT_THROTTLE : ENEMY_HIT_THROTTLE,
      stamp: 0,
      dieT: 0,
      x: e.x,
      y: e.y,
      w: e.w,
      h: e.h,
      size: fit,
      big,
      overlay,
      ov,
      ovMode: OV_NONE,
      flashT: 0,
      frost: 0,
      frostAlpha: e.boss ? BOSS_FROST_OVERLAY_ALPHA : FROST_OVERLAY_ALPHA,
      burn: 0,
      kx: 0,
      ky: 0,
      kvx: 0,
      kvy: 0,
      sq: 0,
      sqv: 0,
      sqAxis: 0,
      springing: false,
      burnEmitT: 0,
      frostEmitT: 0,
      popT: 0,
      poseX: 0,
      poseY: 0,
      poseSx: 1,
      poseSy: 1,
      hopT: 0,
      hopDur: 0,
      hopDx: 0,
      hopDy: 0,
      flashTint: 0xffffff,
      flashDur: ENEMY_FLASH_TIME,
      fuse: def?.deathBlast !== undefined,
      fuseT: FUSE_EMIT_INTERVAL * this.jitter(),
      lean: 0,
      slideDir: 1,
      slideT: 0,
      dustT: 0,
      frozenA: 0,
      ice: null,
      wasFrozen: false,
    };
    this.views.set(e.id, v);
    this.live.push(v);
    const hop = this.pendingHops.get(e.id);
    if (hop) {
      this.pendingHops.delete(e.id);
      startHop(v, hop.x, hop.y, hop.dur);
    }
    return v;
  }
}

function startHop(v: EnemyView, fromX: number, fromY: number, dur: number): void {
  if (!(dur > 0)) return;
  v.hopT = 0;
  v.hopDur = dur;
  v.hopDx = fromX - (v.x + v.w / 2);
  v.hopDy = fromY - (v.y + v.h / 2);
  v.hp.visible = false;
}

/** 밀림·스쿼시 스프링 (반암시적 오일러, 작은 스텝으로 쪼갬). 멈추면 springing = false */
function stepSpring(v: EnemyView, dt: number): void {
  const w = ENEMY_SPRING_W;
  const k = w * w;
  const c = 2 * ENEMY_SPRING_ZETA * w;
  let left = dt;
  while (left > 1e-6) {
    const h = left > SPRING_DT ? SPRING_DT : left;
    left -= h;
    v.kvx += (-k * v.kx - c * v.kvx) * h;
    v.kvy += (-k * v.ky - c * v.kvy) * h;
    v.kx += v.kvx * h;
    v.ky += v.kvy * h;
    v.sqv += (-k * v.sq - c * v.sqv) * h;
    v.sq += v.sqv * h;
  }
  if (
    Math.abs(v.kx) + Math.abs(v.ky) < 0.05 &&
    Math.abs(v.kvx) + Math.abs(v.kvy) < 0.5 &&
    Math.abs(v.sq) < 0.004 &&
    Math.abs(v.sqv) < 0.05
  ) {
    v.kx = v.ky = v.kvx = v.kvy = v.sq = v.sqv = 0;
    v.springing = false;
  }
}

function approach(cur: number, target: number, step: number): number {
  return cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
}

function clampAbs(v: number, lim: number): number {
  return v > lim ? lim : v < -lim ? -lim : v;
}
