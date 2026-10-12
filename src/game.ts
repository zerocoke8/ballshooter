// 전역 Game: 현재 런 상태를 들고 화면 전환을 담당한다.
import { initAudio } from './audio';
import type { GameApp } from './core/app';
import { SceneManager } from './core/scene';
import { GAME_DATA } from './data';
import { clampRunHp, clearRun, isBossTestRun, loadRun, newBossTestRun, newRun, runLevel, saveRun } from './logic/run';
import { randomSeed } from './logic/rng';
import type { GameData, LostReason, RunState, RunStats, Tier } from './types';
import { BossResultScene } from './scenes/BossResultScene';
import { CharacterSelectScene, type CharacterSelectMode } from './scenes/CharacterSelectScene';
import { CombatScene } from './scenes/combat/CombatScene';
import { ResultScene } from './scenes/ResultScene';
import { ShopScene } from './scenes/ShopScene';
import { StageClearScene } from './scenes/StageClearScene';
import { TitleScene } from './scenes/TitleScene';

export interface StageSummary {
  stageIndex: number;
  kills: number;
  goldEarned: number;
  drops: { defId: string; tier: Tier }[];
  clearGold: number;
  healed: number;
  /** 마지막 스테이지까지 클리어했으면 true → 결과 화면으로 */
  finished: boolean;
}

export interface RunResult {
  won: boolean;
  stageIndex: number;
  characterId: string;
  stats: RunStats;
  /** 도달 레벨 (레벨업). 없으면 toResult가 지금 런에서 채운다 */
  level?: number;
}

/** 보스 테스트 한 판의 결과 (보스 결과 화면이 그대로 보여 준다) */
export interface BossTestResult {
  won: boolean;
  characterId: string;
  /** 졌을 때 사유 (이겼으면 null) */
  lostReason: LostReason | null;
  /** 전투 시간(초, sim 시간 — 등장 연출 포함) */
  time: number;
  hp: number;
  maxHp: number;
  /** 보스에게 실제로 깎은 HP 합 (페이즈 문턱에서 잘린 양은 빠짐) / 보스 최대 HP */
  bossDamage: number;
  bossMaxHp: number;
  /** 보스 윗면 직접 적중 수 (양옆 통로로 넘어간 공의 백어택) */
  backAttacks: number;
  /** 처치한 졸개 수 (보스 처치 때 함께 터진 졸개 포함) */
  minionKills: number;
  /** 도달한 페이즈(1부터) / 페이즈 수 */
  phase: number;
  phases: number;
  /** 도달 레벨 (졸개 처치 경험치 — 보스 테스트도 레벨이 오른다). 없으면 표시하지 않음 */
  level?: number;
}

export interface Game {
  readonly gameApp: GameApp;
  readonly data: GameData;
  readonly scenes: SceneManager;
  run: RunState | null;
  /**
   * 측정 도구 전용(tools/*.mjs — 조준·이동 검사가 갑자기 뜬 레벨업 창에 끊기지 않게): true면 전투가 레벨업 창을 띄우지 않는다.
   * 대기 레벨업은 런에 그대로 쌓이고, false로 돌리면 다음 프레임에 뜬다. 게임 코드는 바꾸지 않는다 (기본 false)
   */
  debugHoldLevelUps: boolean;
  hasSave(): boolean;
  toTitle(): void;
  /** mode 'bossTest' = 보스 테스트용 캐릭터 선택 (시작하면 startBossTest) */
  toCharacterSelect(mode?: CharacterSelectMode): void;
  /** newRun → toCombat(저장 포함) */
  startRun(characterId: string): void;
  /**
   * 보스 테스트: 캐릭터별 프리셋 가방으로 보스전 한 판(newBossTestRun). 저장하지 않는다 —
   * 이기든 지든 그만두든 일반 런 세이브('이어하기')는 그대로 남는다.
   */
  startBossTest(characterId: string): void;
  /** loadRun → resumeAt에 따라 상점/전투. 세이브가 없거나 깨졌으면 캐릭터 선택 */
  continueRun(): void;
  toCombat(): void;
  toStageClear(summary: StageSummary): void;
  toShop(): void;
  /** 세이브 삭제 후 결과 화면 (보스 테스트 런이면 세이브를 건드리지 않음) */
  toResult(result: RunResult): void;
  /** 보스 테스트 결과 화면 (세이브를 건드리지 않음) */
  toBossResult(result: BossTestResult): void;
}

export let game: Game;

export function initGame(gameApp: GameApp): Game {
  // 효과음: 제스처 잠금 해제 리스너 + 백그라운드 로드 예약 (manifest가 없거나 비었으면 조용히 무음)
  initAudio();
  const data = GAME_DATA;
  const scenes = new SceneManager(gameApp);

  const g: Game = {
    gameApp,
    data,
    scenes,
    run: null,
    debugHoldLevelUps: false,
    hasSave: () => loadRun(data) !== null,
    toTitle() {
      // 보스 테스트를 그만두고 나가면 그 런은 버린다 (저장된 적이 없다)
      if (isBossTestRun(g.run)) g.run = null;
      scenes.goto(new TitleScene());
    },
    toCharacterSelect: (mode = 'normal') => scenes.goto(new CharacterSelectScene(mode)),
    startRun(characterId) {
      g.run = newRun(data, characterId, randomSeed());
      g.toCombat();
    },
    startBossTest(characterId) {
      g.run = newBossTestRun(data, characterId, randomSeed());
      g.toCombat();
    },
    continueRun() {
      const run = loadRun(data);
      if (!run) {
        g.toCharacterSelect();
        return;
      }
      g.run = run;
      if (run.resumeAt === 'shop') g.toShop();
      else g.toCombat();
    },
    toCombat() {
      const run = g.run;
      if (!run) return g.toTitle();
      clampRunHp(data, run);
      // 보스 테스트 런은 저장하지 않는다 (saveRun도 무시하지만 일반 런 세이브를 건드릴 경로 자체를 두지 않는다)
      if (!isBossTestRun(run)) {
        run.resumeAt = 'combat';
        saveRun(run);
      }
      scenes.goto(new CombatScene());
    },
    toStageClear: (summary) => scenes.goto(new StageClearScene(summary)),
    toShop() {
      const run = g.run;
      if (!run || isBossTestRun(run)) return g.toTitle();
      run.resumeAt = 'shop';
      clampRunHp(data, run);
      saveRun(run);
      scenes.goto(new ShopScene());
    },
    toResult(result) {
      const level = result.level ?? (g.run ? runLevel(g.run) : undefined);
      // 보스 테스트 런이 여기로 오면 세이브를 지우지 않는다 (clearRun(run)도 무시하지만 명시적으로)
      if (!isBossTestRun(g.run)) clearRun(g.run);
      g.run = null;
      scenes.goto(new ResultScene(level === undefined ? result : { ...result, level }));
    },
    toBossResult(result) {
      g.run = null;
      scenes.goto(new BossResultScene(result));
    },
  };

  game = g;
  return g;
}
