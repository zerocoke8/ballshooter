// 짧은 글자 꼬리표 풀 (필드 좌표, topLayer) — 방패병이 공을 막을 때 '막음!'. 같은 글자 하나만 쓰는 풀이라
// 글자는 한 번만 래스터화된다: pixi 8의 글자 텍스처 캐시 키가 (글자 + TextStyle 인스턴스 + 해상도)여서 같은 스타일 인스턴스를
// 공유하면 풀의 Text들과 미리 그려 둔 글자(warmupText)가 텍스처 하나를 같이 쓴다 (ComboLabel·Banner와 같은 방식).
// 뜨기: 톡 커졌다가 살짝 위로 떠오르며 사라짐. 풀이 다 차면 가장 오래된 것을 다시 쓴다. 매 프레임 할당 없음.
import { Container, Text, TextStyle } from 'pixi.js';
import { textStyle } from '../../ui';

const LIFE = 0.62;
const POP_TIME = 0.14;
/** 기본 떠오름(px) — 음수면 아래로 흐른다 (생성자 drift) */
const DEFAULT_DRIFT = 46;
/** 꼬리표마다 스타일 하나 (같은 글자·같은 스타일 인스턴스 = 텍스처 하나) */
const styles = new Map<string, TextStyle>();

function styleFor(key: string, fontSize: number, fill: number): TextStyle {
  let s = styles.get(key);
  if (!s) {
    s = new TextStyle(textStyle('heading', { fontSize, fill, letterSpacing: 1 }));
    styles.set(key, s);
  }
  return s;
}

interface Tag {
  t: Text;
  age: number;
  active: boolean;
  x: number;
  y: number;
}

export class FloatTags extends Container {
  private readonly tags: Tag[] = [];
  private next = 0;
  private readonly drift: number;

  /**
   * @param key 스타일 캐시 키 (같은 key = 같은 스타일 인스턴스 — warmupText와 맞춘다)
   * @param drift 사는 동안 떠오르는 거리(px, 음수 = 아래로)
   */
  constructor(
    text: string,
    key: string,
    fontSize: number,
    fill: number,
    size: number,
    drift = DEFAULT_DRIFT,
  ) {
    super();
    this.drift = drift;
    this.eventMode = 'none';
    this.interactiveChildren = false;
    const style = styleFor(key, fontSize, fill);
    for (let i = 0; i < size; i++) {
      const t = new Text({ text, style });
      t.anchor.set(0.5);
      t.visible = false;
      this.addChild(t);
      this.tags.push({ t, age: 0, active: false, x: 0, y: 0 });
    }
  }

  /** 미리 그리기용 같은 글자 (호출 쪽이 아주 작게 계속 그려 둔다 — CombatScene.warmLayer) */
  static warmupText(text: string, key: string, fontSize: number, fill: number): Text {
    return new Text({ text, style: styleFor(key, fontSize, fill) });
  }

  /** (x, y)에 띄운다 (필드 좌표) */
  show(x: number, y: number): void {
    const g = this.tags[this.next];
    this.next = (this.next + 1) % this.tags.length;
    g.active = true;
    g.age = 0;
    g.x = x;
    g.y = y;
    g.t.visible = true;
    g.t.position.set(x, y);
    g.t.scale.set(0.5);
    g.t.alpha = 1;
    // 최신 것이 위에
    this.addChild(g.t);
  }

  update(dt: number): void {
    for (let i = 0; i < this.tags.length; i++) {
      const g = this.tags[i];
      if (!g.active) continue;
      g.age += dt;
      if (g.age >= LIFE) {
        g.active = false;
        g.t.visible = false;
        continue;
      }
      const k = g.age / LIFE;
      const q = Math.min(1, g.age / POP_TIME);
      // 0.5 → 1.15 → 1 (톡), 떠오르며 마지막 40%에 사라짐
      const s = q < 1 ? 0.5 + 0.65 * q : 1.15 - 0.15 * Math.min(1, (g.age - POP_TIME) / 0.12);
      g.t.scale.set(s);
      g.t.position.set(g.x, g.y - this.drift * (1 - (1 - k) * (1 - k)));
      g.t.alpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }
  }

  /** 승패 등으로 다 숨김 */
  clear(): void {
    for (const g of this.tags) {
      g.active = false;
      g.t.visible = false;
    }
  }
}
