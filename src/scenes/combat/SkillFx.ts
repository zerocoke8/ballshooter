// 액티브 스킬의 '계속되는' 연출 (필드 좌표, 씬의 playerLayer — 캐릭터 아래): 캐릭터를 따라다닌다.
// - 온천 타임: 효과 시간(sim.skill.active) 동안 둘레 반경(SkillDef.spring.radius — 탄을 녹이는 원)에 따뜻한 고리 + 은은한 빛 +
//   안에서 밖으로 번지는 물결 + 둘레에서 피어오르는 김(Effects.auraWisp). 끝나면 흐려진다.
// - 털뭉치 폭풍: 쏘는 동안 캐릭터 둘레로 소용돌이 두 겹이 반대로 돈다.
// 발동 순간의 큰 연출(화면 번쩍임·서리 파도·고리)은 씬이 'skill' 이벤트에서 Effects로. 판정은 전부 sim. 매 프레임 할당 없음.
import { Container, Sprite } from 'pixi.js';
import type { SkillDef, SkillState } from '../../types';
import type { Effects } from './Effects';
import type { FxTextures } from './fxTextures';
import { AURA_WISP_INTERVAL, SPRING_AURA_COLOR, STORM_TRAIL_COLOR } from './visual';

/** fx.ring 텍스처(128px)의 고리 반경 / fx.soft(64px) 반경 / fx.swirl(128px) 바깥 반경 */
const RING_TEX_R = 58;
const SOFT_TEX_R = 31;
const SWIRL_TEX_R = 56;
const FADE_IN = 7;
const FADE_OUT = 4;
/** 물결 한 번 길이(초) */
const RIPPLE_TIME = 0.7;
/** 소용돌이 반경(px)·도는 속도(라디안/초) — 캐릭터(100px)를 감싸는 크기 */
const SWIRL_R = 84;
const SWIRL_SPIN = 9;
/** 소용돌이 가운데 = 캐릭터 몸 가운데 (발밑 기준 위로) */
const BODY_DY = -12;

export class SkillFx extends Container {
  private readonly aura: Sprite;
  private readonly auraGlow: Sprite;
  private readonly ripple: Sprite;
  private readonly swirlA: Sprite;
  private readonly swirlB: Sprite;
  private readonly radius: number;
  private auraA = 0;
  private swirlAlpha = 0;
  private clock = 0;
  private wispT = 0;
  private seq = 7;

  constructor(
    private readonly def: SkillDef,
    fx: FxTextures,
    private readonly particles: Effects,
  ) {
    super();
    this.eventMode = 'none';
    this.interactiveChildren = false;
    this.radius = def.kind === 'spring' ? def.spring.radius : 0;

    this.auraGlow = new Sprite(fx.soft);
    this.auraGlow.anchor.set(0.5);
    this.auraGlow.tint = SPRING_AURA_COLOR;
    this.ripple = new Sprite(fx.ring);
    this.ripple.anchor.set(0.5);
    this.ripple.tint = 0xfff4e6;
    this.aura = new Sprite(fx.ring);
    this.aura.anchor.set(0.5);
    this.aura.tint = SPRING_AURA_COLOR;
    this.swirlA = new Sprite(fx.swirl);
    this.swirlA.anchor.set(0.5);
    this.swirlA.tint = 0xffffff;
    this.swirlB = new Sprite(fx.swirl);
    this.swirlB.anchor.set(0.5);
    this.swirlB.tint = STORM_TRAIL_COLOR;
    this.addChild(this.auraGlow, this.ripple, this.aura, this.swirlB, this.swirlA);
    for (const c of this.children) c.visible = false;
  }

  /** 매 프레임 (필드 시계 — 히트스톱·가방·레벨업 창 동안은 씬이 부르지 않아 같이 멈춘다) */
  update(dt: number, px: number, py: number, state: SkillState | null): void {
    this.clock += dt;
    const on = !!state && state.active > 0;
    if (this.def.kind === 'spring') this.updateAura(dt, px, py, on);
    else if (this.def.kind === 'storm') this.updateSwirl(dt, px, py, on);
  }

  private updateAura(dt: number, px: number, py: number, on: boolean): void {
    this.auraA = approach(this.auraA, on ? 1 : 0, (on ? FADE_IN : FADE_OUT) * dt);
    const vis = this.auraA > 0.01;
    this.aura.visible = this.auraGlow.visible = this.ripple.visible = vis;
    if (!vis) return;
    const r = this.radius;
    const a = this.auraA;
    const pulse = 1 + 0.025 * Math.sin(this.clock * 6);
    this.aura.position.set(px, py);
    this.aura.scale.set(((r * pulse) / RING_TEX_R) * (0.85 + 0.15 * a));
    this.aura.alpha = 0.75 * a;
    this.auraGlow.position.set(px, py);
    this.auraGlow.scale.set((r * 1.05) / SOFT_TEX_R);
    this.auraGlow.alpha = 0.2 * a;
    // 물결: 안에서 바깥 고리까지 번지며 옅어짐
    const k = (this.clock % RIPPLE_TIME) / RIPPLE_TIME;
    this.ripple.position.set(px, py);
    this.ripple.scale.set((r * (0.45 + 0.55 * k)) / RING_TEX_R);
    this.ripple.alpha = 0.5 * a * (1 - k);
    if (!on) return;
    // 김: 둘레 무작위 자리에서 피어오름
    this.wispT -= dt;
    while (this.wispT <= 0) {
      this.wispT += AURA_WISP_INTERVAL;
      const ang = this.rand() * Math.PI * 2;
      this.particles.auraWisp(px + Math.cos(ang) * r, py + Math.sin(ang) * r);
    }
  }

  private updateSwirl(dt: number, px: number, py: number, on: boolean): void {
    this.swirlAlpha = approach(this.swirlAlpha, on ? 1 : 0, (on ? FADE_IN * 1.5 : FADE_OUT) * dt);
    const vis = this.swirlAlpha > 0.01;
    this.swirlA.visible = this.swirlB.visible = vis;
    if (!vis) return;
    const a = this.swirlAlpha;
    const s = (SWIRL_R / SWIRL_TEX_R) * (0.8 + 0.2 * a);
    this.swirlA.position.set(px, py + BODY_DY);
    this.swirlB.position.set(px, py + BODY_DY);
    this.swirlA.scale.set(s);
    this.swirlB.scale.set(s * 1.22);
    this.swirlA.rotation += SWIRL_SPIN * dt;
    this.swirlB.rotation -= SWIRL_SPIN * 0.65 * dt;
    this.swirlA.alpha = 0.85 * a;
    this.swirlB.alpha = 0.55 * a;
  }

  /** 0..1 결정적 의사난수 (연출 전용 — 게임 RNG와 무관) */
  private rand(): number {
    this.seq = (this.seq * 1103515245 + 12345) & 0x7fffffff;
    return this.seq / 0x7fffffff;
  }
}

function approach(cur: number, target: number, step: number): number {
  return cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
}
