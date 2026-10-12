// 연출(이펙트) 리뷰 컨택트 시트 — 시스템 Edge(없으면 Chrome)로 폰 세로 화면(390×844, dpr 2)에서
// 전투 장면 16개를 연출하고, 장면마다 짧은 연속 촬영 중 연출이 가장 잘 보이는 프레임을 골라 한 장으로 붙인다.
//
// 사용법: node tools/juice-sheet.mjs [--port 5213] [--headed] [--hmr] [--only 9,10,13]
//
// 장면: 1 st1 기본 플레이(냥냥 시작 무기) · 2 틈 쏘기 '백어택' 콤보 · 3 폭발(수박·화염병) · 4 불(불꽃 토스터)
//       5 얼음(수박 빙수·참치) · 6 번개(정전기 털뭉치) · 7 곰인형(엘리트) 처치 · 8 보스전(무기 10종 스트레스 가방)
//       ── 재미 기능 연출 ──
//       9 백어택(분홍 숫자·별·콤보) + 방패병 '막음!' · 10 치유병 회복 + 폭탄병 연쇄 · 11 시너지(증기·폭죽·트램펄린·리본·버섯)
//       12 번개 코일 두 번째 줄기 + 전염 성냥 · 13 빙하기(펭구) · 14 온천 타임(카피 — 탄 녹이기) · 15 털뭉치 폭풍(냥냥)
//       16 젤리 분열(꼬마 젤리 튀어나옴) + RC카 미끄러짐
//   --only: 그 장면들만 (연출을 고칠 때 빨리 돌려 보기). 시트는 찍은 장면만으로.
// 프레임 고르기: 연속 촬영하면서 매 장 debugState(살아있는 이펙트 파티클 수·콤보)를 같이 읽어 점수가 가장 높은 장.
//   콤보 = 콤보 수가 가장 큰 장, 엘리트 처치 = 처치 순간에서 약 0.18초 뒤(펑 + 폭발 구름)에 가장 가까운 장.
// 연출을 잘 보이게 하려고 장면 상태를 직접 만든다(적 위치 옮기기·HP 고정·플레이어 무적) — 밸런스 측정용이 아니다.
// 출력: tools/.out/juice/NN-<장면>.png(고른 프레임 원본 해상도) + sheet.png(4열, 장면당 390×844) + sheet-new.png(9~16만 — 읽기 쉽게).
// stdout 마지막에 JSON 요약.
// 실패(exit 1): 콘솔/페이지 에러, 장면 준비 실패. 개발 서버는 끝날 때(실패 포함) 항상 종료한다.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'tools', '.out', 'juice');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const PORT = Number(argValue('port', 5213));
const ONLY = argValue('only', '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
const SCENE_COUNT = 16;
const HEADED = args.includes('--headed');
const ALLOW_HMR = args.includes('--hmr');
const BASE_URL = `http://localhost:${PORT}/`;
const VIEW = { width: 390, height: 844 };
const DPR = 2;
const LABEL_H = 30;
const GAP = 6;

const summary = { ok: false, url: BASE_URL, browser: null, scenes: [], consoleErrors: [], pageErrors: [], failures: [], sheet: null, durationMs: 0 };
const started = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 개발 서버 (smoke.mjs와 같은 방식) ───────────────────────

let server = null;
let serverLog = '';

function startServer() {
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const viteArgs = ['--port', String(PORT), '--strictPort'];
  const child = existsSync(viteBin)
    ? spawn(process.execPath, [viteBin, ...viteArgs], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('npx', ['vite', ...viteArgs], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  const collect = (buf) => {
    serverLog = (serverLog + buf.toString()).slice(-4000);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  return child;
}

function stopServer() {
  if (!server || server.exitCode !== null || server.killed) return;
  const pid = server.pid;
  if (process.platform === 'win32' && pid) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      server.kill('SIGTERM');
    } catch {
      /* 이미 종료 */
    }
  }
}

async function waitForServer(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`dev server exited (code ${server.exitCode}):\n${serverLog}`);
    try {
      const res = await fetch(BASE_URL);
      if (res.ok) return;
    } catch {
      /* 아직 */
    }
    await sleep(300);
  }
  throw new Error(`dev server did not respond on ${BASE_URL} within ${timeoutMs}ms:\n${serverLog}`);
}

async function launchBrowser() {
  const errors = [];
  for (const channel of ['msedge', 'chrome']) {
    try {
      const b = await chromium.launch({ channel, headless: !HEADED });
      summary.browser = channel;
      return b;
    } catch (err) {
      errors.push(`${channel}: ${String(err?.message ?? err).split('\n')[0]}`);
    }
  }
  throw new Error(`system browser launch failed (${errors.join(' | ')})`);
}

const isIgnorable = (text, url) => /\/favicon\.ico(\?|$|\s)/.test(`${url ?? ''} ${text}`) || /fonts\.(googleapis|gstatic)\.com/.test(`${url ?? ''} ${text}`);

// ── 장면 도우미 ──────────────────────────────────────────────

let page = null;

/** 런을 만들고(가방 배치·스테이지 지정) 전투 씬이 'fight'가 될 때까지 */
async function setup({ char = 'cat', stage = 0, items = null, layout = null }) {
  await page.evaluate(
    async ({ char, stage, items, layout }) => {
      const B = await import('/src/logic/bag.ts');
      const R = await import('/src/logic/run.ts');
      const g = window.__game.game;
      const s = g.scenes.current;
      if (s?.__iv) for (const iv of s.__iv) clearInterval(iv);
      g.startRun(char);
      const run = g.run;
      run.stageIndex = stage;
      if (layout) {
        run.bag = B.createBag(layout.cols, layout.rows);
        for (const it of layout.items) {
          if (!B.addNewToBag(run.bag, g.data.items, it.defId, it.tier ?? 1, it.x, it.y, it.rot ?? 0)) throw new Error(`layout ${it.defId}`);
        }
      } else if (items) {
        run.bag = B.createBag(7, 6);
        for (const [id, tier] of items) {
          const spot = B.findFreeSpot(run.bag, g.data.items, id);
          if (!spot || !B.addNewToBag(run.bag, g.data.items, id, tier, spot.x, spot.y, spot.rot)) throw new Error(`item ${id}`);
        }
      }
      run.hp = R.runPlayerStats(g.data, run).maxHp;
      window.__prevScene = g.scenes.current;
      g.toCombat();
    },
    { char, stage, items, layout },
  );
  await page.waitForFunction(
    () => {
      const c = window.__game.game.scenes.current;
      return c !== window.__prevScene && c?.debugState?.()?.phase === 'fight';
    },
    null,
    { timeout: 20000, polling: 50 },
  );
  // 플레이어 무적 (연출을 오래 보려고) — 씬이 바뀌면 같이 버려진다
  await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    s.__iv = [setInterval(() => s.sim && (s.sim.player.hp = s.sim.player.maxHp), 100)];
  });
}

/**
 * 가장 아래의 보이는 적을 0.25초마다 조준 (사람이 맨 앞 적을 계속 탭하는 흉내). 방패병은 다른 적이 없을 때만 — 정면을 쏘면 튕기기만 해서
 * 폭발·속성 장면이 '막음!'만 찍혔다 (sim의 자동조준과 같은 규칙)
 */
const autoAim = () =>
  page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    s.__iv.push(
      setInterval(() => {
        const sim = s.sim;
        let best = null;
        for (const e of sim.enemies) if (e.alive && e.defId !== 'shield' && e.y + e.h > 30 && (!best || e.y + e.h > best.y + best.h)) best = e;
        if (!best) for (const e of sim.enemies) if (e.alive && e.y + e.h > 30 && (!best || e.y + e.h > best.y + best.h)) best = e;
        if (best) s.setAim(Math.atan2(best.y + best.h / 2 - (sim.player.y - 30), best.x + best.w / 2 - sim.player.x));
      }, 250),
    );
  });

const state = () => page.evaluate(() => window.__game.game.scenes.current?.debugState?.() ?? null);

/** 연속 촬영: n장, 간격 every ms. 매 장 직전 debugState와 extra(선택)를 같이 기록 */
async function burst(n, every, extra = null) {
  const frames = [];
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const tf = Date.now();
    const st = await state();
    const ex = extra ? await page.evaluate(extra) : null;
    const buf = await page.screenshot({ type: 'png' });
    frames.push({ buf, ms: tf - t0, st, ex });
    const spent = Date.now() - tf;
    if (spent < every) await sleep(every - spent);
  }
  return frames;
}

function best(frames, score) {
  let b = frames[0];
  let bs = -Infinity;
  for (const f of frames) {
    const s = score(f);
    if (s > bs) {
      bs = s;
      b = f;
    }
  }
  return b;
}

async function keep(no, name, label, frame) {
  const file = path.join(OUT_DIR, `${String(no).padStart(2, '0')}-${name}.png`);
  writeFileSync(file, frame.buf);
  const st = frame.st ?? {};
  const rec = {
    no,
    name,
    label,
    file: path.relative(ROOT, file),
    fxParticles: st.fxParticles ?? null,
    combo: st.combo ?? null,
    hp: st.hp ?? null,
    time: st.time != null ? +st.time.toFixed(1) : null,
    proj: frame.ex?.proj ?? null,
    // 장면 점수에 쓴 연출 상태 (fxDetail·fxRecent — n_<메서드> = 촬영 끝까지 그 연출이 불린 횟수)
    detail: frame.ex && Object.keys(frame.ex).length > 1 ? frame.ex : undefined,
  };
  summary.scenes.push(rec);
  return { ...rec, buf: frame.buf };
}

const projCount = () => ({ proj: window.__game.game.scenes.current?.sim?.projectiles.length ?? 0 });

/**
 * 장면 점수용 연출 상태(내부 필드를 읽는 측정 전용): 투사체 수, 번개 수, 폭발 구름(주황/서리) 수, 불타는·얼어붙은 적 수
 */
const fxDetail = () => {
  const s = window.__game.game.scenes.current;
  const fx = s?.fx;
  const sim = s?.sim;
  if (!fx || !sim) return null;
  let booms = 0;
  let frost = 0;
  for (const f of fx.active) {
    if (f.delay > 0) continue;
    if (f.p.texture === fx.atlas.boom) booms++;
    else if (f.p.texture === fx.atlas.ice) frost++;
  }
  let bolts = 0;
  for (const b of fx.bolts) if (b.active) bolts++;
  let burning = 0;
  let chilled = 0;
  for (const e of sim.enemies) {
    if (!e.alive || e.y + e.h <= 0) continue;
    if (e.burnTime > 0) burning++;
    if (e.chillTime > 0) chilled++;
  }
  return { proj: sim.projectiles.length, bolts, booms, frost, burning, chilled };
};

/** 웨이브가 다 들어올 때까지(맨 앞 웨이브 뒤 끝이 화면 안) 빨리감기 */
async function untilFrontInside(minTop = 84, timeoutMs = 20000) {
  await page.evaluate(() => window.__game.debug.setSpeed(4));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await state();
    if (st && st.frontTop !== null && st.frontTop >= minTop) break;
    await sleep(100);
  }
  await page.evaluate(() => window.__game.debug.setSpeed(1));
}

/**
 * 조준 가이드(traceAim)로 맨 앞 웨이브 뒤로 확실히 넘어가는(±1.5°) 자리·각도를 찾는다. 지금 자리에서 되면 바로 조준하고
 * { moving: false }, 다른 자리면 그리로 걸어가게만 하고 { moving: true } — 캐릭터는 이동 속도로 걸어가므로 도착한 뒤 다시 계획한다
 */
const planGap = () =>
  page.evaluate(async () => {
    const { traceAim, FIRE_OFFSET_Y } = await import('/src/logic/combat/sim.ts');
    const s = window.__game.game.scenes.current;
    const sim = s.sim;
    const ft = s.debugState().frontTop;
    if (ft === null || ft < 0) return null;
    const r = s.guideRadius;
    const out = new Float64Array(6);
    const res = { points: 0, hitId: -1 };
    for (const px of [sim.player.x, 84, 168, 252, 336, 420, 504, 588]) {
      for (let deg = -170; deg <= -10; deg += 0.5) {
        const a = (deg * Math.PI) / 180;
        let ok = true;
        for (const dd of [-1.5, 0, 1.5]) {
          traceAim(px, sim.player.y - FIRE_OFFSET_Y, a + (dd * Math.PI) / 180, r, sim.enemies, 1600, 2, out, res);
          if (!(res.hitId >= 0 && out[2 * (res.points - 1) + 1] <= ft + 4.5)) ok = false;
        }
        if (ok) {
          if (Math.abs(px - sim.player.x) > 2) {
            s.input.targetX = px;
            s.input.targetY = sim.player.y;
            return { px, deg, moving: true };
          }
          s.setAim(a);
          return { px, deg, moving: false };
        }
      }
    }
    return null;
  });

// ── 장면들 ───────────────────────────────────────────────────

const ST5_BIG = {
  cols: 7,
  rows: 6,
  items: [
    { defId: 'w_sock_gatling', x: 0, y: 0 },
    { defId: 's_haste', x: 1, y: 0 },
    { defId: 'w_yuzu_molotov', x: 2, y: 0 },
    { defId: 's_mirror', x: 3, y: 0 },
    { defId: 'w_static_hairball', x: 4, y: 0 },
    { defId: 's_haste', x: 5, y: 0 },
    { defId: 'w_yuzu', x: 6, y: 0 },
    { defId: 's_mirror', x: 0, y: 1 },
    { defId: 's_power', x: 1, y: 1 },
    { defId: 'w_hairball', x: 2, y: 1 },
    { defId: 'w_flame_toaster', x: 0, y: 2 },
    { defId: 'w_melon_bingsu', x: 2, y: 2 },
    { defId: 'w_mama_duck', x: 4, y: 2 },
    { defId: 'w_methane_bomb', x: 5, y: 2 },
    { defId: 'w_tuna_missile', x: 5, y: 3 },
    { defId: 'g_bandage', x: 0, y: 4 },
    { defId: 'g_potlid', x: 1, y: 4 },
  ],
};

async function sceneNormal(no) {
  await setup({ char: 'cat', stage: 0 });
  await autoAim();
  await sleep(7000);
  const frames = await burst(14, 90, projCount);
  return keep(no, 'st1-normal', 'st1 normal (cat starter)', best(frames, (f) => f.st?.fxParticles ?? 0));
}

async function sceneCombo(no) {
  await setup({ char: 'cat', stage: 0, items: [['w_hairball', 1], ['w_hairball', 1], ['s_power', 1]] });
  let pick = null;
  for (let attempt = 0; attempt < 3 && !pick; attempt++) {
    await untilFrontInside();
    let plan = null;
    for (let i = 0; i < 40 && !plan; i++) {
      const p = await planGap();
      if (p?.moving) {
        // 그 자리까지 걸어가 설 때까지 (최대 약 2.5초) 기다렸다가 다시 계획
        for (let k = 0; k < 50; k++) {
          await sleep(50);
          const st = await state();
          if (!st || (Math.abs(st.playerX - p.px) < 1 && Math.abs(st.playerVx) < 1)) break;
        }
        continue;
      }
      plan = p;
      if (!plan) await sleep(250);
    }
    if (!plan) continue;
    await sleep(700);
    const frames = await burst(26, 80, projCount);
    const top = best(frames, (f) => (f.st?.combo ?? 0) * 1000 + (f.st?.fxParticles ?? 0));
    if ((top.st?.combo ?? 0) >= 2) pick = top;
    else if (attempt === 2) pick = top;
  }
  if (!pick) throw new Error('combo: no gap found');
  return keep(no, 'gap-combo', 'gap shot combo', pick);
}

/** score(ex): 장면마다 그 연출이 가장 잘 보이는 프레임. waitMs = 촬영 전 대기(번개는 연쇄할 이웃 적이 화면에 찰 때까지 더 길게) */
async function sceneElement(no, name, label, items, score, waitMs = 6500) {
  await setup({ char: 'cat', stage: 1, items });
  // 적 HP ×3: 빌드가 대형을 화면에 들어오자마자 지워 버리면 화상·냉기·연쇄가 보일 틈이 없다 (연출 촬영용)
  await page.evaluate(() => {
    for (const e of window.__game.game.scenes.current.sim.enemies) {
      e.hp *= 3;
      e.maxHp *= 3;
    }
  });
  await autoAim();
  await sleep(waitMs);
  const frames = await burst(16, 80, fxDetail);
  return keep(no, name, label, best(frames, (f) => (f.ex ? score(f.ex) : 0) * 100 + (f.st?.fxParticles ?? 0)));
}

async function sceneElite(no) {
  const stage = await page.evaluate(() =>
    window.__game.game.data.stages.findIndex((st) => Object.entries(st.legend).some(([ch, id]) => id === 'teddy' && st.rows.some((r) => r.includes(ch)))),
  );
  await setup({ char: 'cat', stage, items: [['w_tuna_missile', 3], ['w_static_hairball', 2], ['w_sock_gatling', 2]] });
  await sleep(400);
  const ok = await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    const sim = s.sim;
    const t = sim.enemies.find((e) => e.defId === 'teddy');
    if (!t) return false;
    const dy = 260 - t.y;
    for (const e of sim.enemies) e.y += dy;
    // 곰인형 앞(아래)·사선을 막는 적만 치운다 — 나머지 대형은 그대로 두고 보이게
    for (const e of sim.enemies) {
      if (e === t) continue;
      const below = e.y + e.h > t.y + t.h + 2;
      const beside = e.y + e.h > t.y + 4 && Math.abs(e.x + e.w / 2 - (t.x + t.w / 2)) < t.w / 2 + 90;
      if (below || beside) e.alive = false;
    }
    t.hp = 1e9;
    s.__teddy = t;
    const p = sim.player;
    s.setAim(Math.atan2(t.y + t.h / 2 - (p.y - 30), t.x + t.w / 2 - p.x));
    return true;
  });
  if (!ok) throw new Error('elite: no teddy');
  await sleep(1500);
  await page.evaluate(() => {
    const t = window.__game.game.scenes.current.__teddy;
    t.hp = 1;
  });
  const frames = await burst(20, 60, () => ({ dead: !window.__game.game.scenes.current.__teddy.alive }));
  const killAt = frames.find((f) => f.ex?.dead)?.ms;
  if (killAt === undefined) throw new Error('elite: teddy not killed during burst');
  // 처치 순간 이후 약 0.18초 — 부풀어 하얘진 뒤 연기·폭발 구름이 피어오른 순간
  return keep(no, 'elite-kill', 'teddy (elite) kill', best(frames, (f) => (f.ex?.dead ? -Math.abs(f.ms - killAt - 180) : -1e9)));
}

async function sceneBoss(no) {
  await setup({ char: 'capybara', stage: 4, layout: ST5_BIG });
  await sleep(300);
  await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    const sim = s.sim;
    const b = sim.enemies.find((e) => e.boss);
    const dy = 120 - b.y;
    for (const e of sim.enemies) e.y += dy;
    // 보스 웨이브만 남긴다 (보스 위아래로 3줄 안의 호위)
    for (const e of sim.enemies) if (!e.boss && (e.y + e.h > b.y + b.h + 2 * 84 || e.y < b.y - 84)) e.alive = false;
    s.__iv.push(setInterval(() => b.alive && b.hp < b.maxHp * 0.45 && (b.hp = b.maxHp * 0.7), 200));
    s.__iv.push(
      setInterval(() => {
        const p = sim.player;
        let best = null;
        for (const e of sim.enemies) if (e.alive && e.y + e.h > 30 && (!best || e.y + e.h > best.y + best.h)) best = e;
        if (best) s.setAim(Math.atan2(best.y + best.h / 2 - (p.y - 30), best.x + best.w / 2 - p.x) + Math.sin(Date.now() / 700) * 0.35);
      }, 250),
    );
  });
  await sleep(6500);
  const frames = await burst(14, 90, projCount);
  return keep(no, 'boss-bigbuild', 'st5 boss, 10-weapon bag', best(frames, (f) => f.st?.fxParticles ?? 0));
}

// ── 재미 기능 연출 장면 (9~16) ───────────────────────────────

/**
 * 장면 무대 만들기 (페이지 안): 지정한 종류의 적을 칸에 놓고 나머지는 치운다(처치 이벤트 없이 — 판이 끝나지 않게).
 * spec.keep = [{ def: [선호 id, …], col, row, hp? }] — 앞의 id부터 남은 적에서 찾는다. pinY면 하강을 막는다(y 고정).
 * 놓은 적 id 배열을 s.__staged에 둔다
 */
const stageEnemies = (spec) =>
  page.evaluate(async (spec) => {
    const C = await import('/src/config.ts');
    const s = window.__game.game.scenes.current;
    const sim = s.sim;
    const used = new Set();
    const placed = [];
    for (const k of spec.keep) {
      let e = null;
      for (const id of k.def) {
        e = sim.enemies.find((x) => x.alive && !x.boss && x.defId === id && !used.has(x)) ?? null;
        if (e) break;
      }
      if (!e) e = sim.enemies.find((x) => x.alive && !x.boss && !used.has(x) && !['shield', 'bomber', 'splitter', 'shifter', 'healer'].includes(x.defId)) ?? null;
      if (!e) throw new Error('stage: no enemy for ' + k.def.join('/'));
      used.add(e);
      e.x = k.col * C.CELL + C.ENEMY_INSET;
      e.y = k.row * C.CELL + C.ENEMY_INSET;
      if (k.hp !== undefined) {
        e.maxHp = Math.max(e.maxHp, k.hp);
        e.hp = k.hp;
      }
      if (k.hpFrac !== undefined) e.hp = e.maxHp * k.hpFrac;
      e.attackTimer = 99;
      placed.push(e);
    }
    for (const e of sim.enemies) if (!used.has(e)) e.alive = false;
    s.__staged = placed.map((e) => e.id);
    if (spec.pinY) {
      const ys = placed.map((e) => e.y);
      s.__iv.push(
        setInterval(() => {
          placed.forEach((e, i) => (e.y = ys[i]));
        }, 40),
      );
    }
    return placed.map((e) => e.defId);
  }, spec);

/** Effects 메서드 호출 시각 기록 (최근 몇 번 불렸나로 프레임 점수) — 측정 전용 감싸기 */
const trackFx = (names) =>
  page.evaluate((names) => {
    const s = window.__game.game.scenes.current;
    const fx = s.fx;
    s.__calls = {};
    for (const m of names) {
      const orig = fx[m].bind(fx);
      fx[m] = (...a) => {
        (s.__calls[m] ??= []).push(performance.now());
        return orig(...a);
      };
    }
  }, names);

/** 최근 ms 안에 불린 횟수 (trackFx) + 연출 상태 몇 가지 */
const fxRecent = () => {
  const s = window.__game.game.scenes.current;
  const now = performance.now();
  const out = {};
  for (const [m, ts] of Object.entries(s.__calls ?? {})) {
    out[m] = ts.filter((t) => now - t < 450).length;
    out['n_' + m] = ts.length;
  }
  let backNums = 0;
  for (const n of s.fx.nums) if (n.active && n.back) backNums++;
  let tags = 0;
  for (const g of s.blockTags.tags) if (g.active) tags++;
  let frozen = 0;
  let sliding = 0;
  let hopping = 0;
  for (const v of s.enemies.live) {
    if (v.frozenA > 0.8) frozen++;
    if (Math.abs(v.lean) > 0.05) sliding++;
    if (v.hopT < v.hopDur) hopping++;
  }
  let skillShots = 0;
  for (const p of s.sim.projectiles) if (p.weaponUid === -1) skillShots++;
  return { ...out, backNums, tags, frozen, sliding, hopping, skillShots, flash: s.flash.visible ? s.flash.alpha : 0, proj: s.sim.projectiles.length };
};

/** 플레이어를 (x, y)로 걸어가게 하고 도착할 때까지 */
async function walkTo(x, y) {
  await page.evaluate(
    ({ x, y }) => {
      const s = window.__game.game.scenes.current;
      s.input.targetX = x;
      s.input.targetY = y;
    },
    { x, y },
  );
  for (let k = 0; k < 60; k++) {
    await sleep(50);
    const st = await state();
    if (st && Math.abs(st.playerX - x) < 2 && Math.abs(st.playerY - y) < 2 && Math.abs(st.playerVx) < 1) break;
  }
}

/** 적 HP 배수 (연출이 보일 틈 — 빌드가 대형을 바로 지우지 않게) */
const scaleHp = (mul) =>
  page.evaluate((mul) => {
    for (const e of window.__game.game.scenes.current.sim.enemies) {
      e.hp *= mul;
      e.maxHp *= mul;
    }
  }, mul);

/** 9: 백어택 + 방패병 — 한 줄 대형(방패 둘) 위 공간으로 왼쪽 통로를 따라 공을 넘겨 윗면을 치고, 가끔 방패 정면을 쏜다 */
async function sceneBackShield(no) {
  await setup({ char: 'cat', stage: 1, items: [['w_hairball', 3], ['w_hairball', 3], ['w_yuzu', 3], ['w_yuzu', 3], ['w_sock_gatling', 2]] });
  await stageEnemies({
    pinY: true,
    keep: [
      { def: ['shield'], col: 1, row: 5, hp: 900 },
      { def: ['soldier'], col: 2, row: 5, hp: 900 },
      { def: ['shield'], col: 3, row: 5, hp: 900 },
      { def: ['soldier'], col: 4, row: 5, hp: 900 },
      { def: ['block', 'soldier'], col: 5, row: 5, hp: 900 },
      { def: ['soldier'], col: 6, row: 5, hp: 900 },
    ],
  });
  await trackFx(['backSpark', 'blockSpark']);
  await walkTo(42, 800);
  await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    let n = 0;
    const lane = () => s.setAim((-88 * Math.PI) / 180);
    lane();
    s.__iv.push(
      setInterval(() => {
        const p = s.sim.player;
        // 2번은 통로 위로 (천장에 맞고 윗면으로), 1번은 방패(3열) 정면을 아래에서
        if (n++ % 3 === 2) s.setAim(Math.atan2(5 * 84 + 84 - (p.y - 30), 3 * 84 + 42 - p.x));
        else lane();
      }, 330),
    );
  });
  await sleep(3200);
  const frames = await burst(22, 80, fxRecent);
  return keep(no, 'back-shield', 'back attack + shield block', best(frames, (f) => (f.ex ? f.ex.backNums * 4 + f.ex.tags * 8 + f.ex.blockSpark * 3 + (f.st?.combo ?? 0) * 2 : 0)));
}

/** 10: 치유병이 다친 둘레를 회복 + 폭탄병 셋 연쇄 폭발 (판정은 sim — 폭탄 하나를 정상 처치 경로로 터뜨린다) */
async function sceneHealBomb(no) {
  await setup({ char: 'penguin', stage: 2, items: [['w_yuzu', 1]] });
  await stageEnemies({
    pinY: true,
    keep: [
      { def: ['soldier'], col: 2, row: 3, hp: 600, hpFrac: 0.35 },
      { def: ['healer'], col: 3, row: 3, hp: 600 },
      { def: ['block', 'soldier'], col: 4, row: 3, hp: 600, hpFrac: 0.35 },
      { def: ['soldier'], col: 2, row: 4, hp: 600, hpFrac: 0.35 },
      { def: ['armored', 'soldier'], col: 3, row: 4, hp: 600, hpFrac: 0.35 },
      { def: ['soldier'], col: 4, row: 4, hp: 600, hpFrac: 0.35 },
      { def: ['bomber'], col: 1, row: 7 },
      { def: ['bomber'], col: 2, row: 7 },
      { def: ['bomber'], col: 3, row: 7 },
      { def: ['soldier'], col: 4, row: 7, hp: 600 },
      { def: ['block', 'soldier'], col: 2, row: 8, hp: 600 },
      { def: ['soldier'], col: 1, row: 6, hp: 600 },
    ],
  });
  await trackFx(['healPulse', 'healTarget', 'bombBlast']);
  // 쏘지 않게 (조준만 위로 — 무기는 유자 하나, 대형 위 빈 곳으로)
  await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    s.setAim(-Math.PI / 2 + 1.2);
  });
  await sleep(500);
  await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    const sim = s.sim;
    const healer = sim.enemies.find((e) => e.defId === 'healer');
    if (healer) healer.abilityTimer = 0;
    setTimeout(() => {
      const b = sim.enemies.find((e) => e.defId === 'bomber' && e.alive);
      if (b) sim.kill(b);
    }, 260);
  });
  const frames = await burst(20, 60, fxRecent);
  return keep(no, 'heal-bomb', 'healer pulse + bomber chain', best(frames, (f) => (f.ex ? (f.ex.bombBlast ?? 0) * 6 + (f.ex.healTarget ?? 0) * 4 : 0) * 10 + (f.st?.fxParticles ?? 0)));
}

const SYNERGY_BAG = {
  cols: 7,
  rows: 6,
  items: [
    { defId: 'w_tuna_missile', x: 0, y: 0 },
    { defId: 'w_flame_toaster', x: 2, y: 0 },
    { defId: 'g_kettle', x: 4, y: 0 },
    { defId: 'g_firecracker', x: 5, y: 0 },
    { defId: 'g_trampoline', x: 0, y: 1 },
    { defId: 'w_yuzu', x: 0, y: 2 },
    { defId: 's_ribbon', x: 1, y: 2 },
    { defId: 'w_hairball', x: 0, y: 3 },
    { defId: 's_mushroom', x: 1, y: 3 },
    { defId: 'w_yuzu_molotov', x: 4, y: 2 },
    { defId: 's_ribbon', x: 5, y: 2 },
  ],
};

/** 11: 시너지 — 증기 주전자(참치 얼음 ↔ 불꽃 토스터 불), 폭죽 심지(처치 팡), 트램펄린(바닥 튕김), 유도 리본 꼬리, 거대화 버섯 공 */
async function sceneSynergy(no) {
  await setup({ char: 'cat', stage: 1, layout: SYNERGY_BAG });
  await scaleHp(1.6);
  await trackFx(['steam', 'firecracker', 'trampoline']);
  await autoAim();
  await sleep(6500);
  const frames = await burst(22, 80, fxRecent);
  return keep(no, 'synergy', 'kettle steam, firecracker, trampoline, ribbon', best(frames, (f) => (f.ex ? (f.ex.steam ?? 0) * 8 + (f.ex.firecracker ?? 0) * 4 + (f.ex.trampoline ?? 0) * 4 : 0) * 10 + (f.st?.fxParticles ?? 0)));
}

/** 12: 번개 코일 두 번째 줄기(늦게 가늘게 한 번 더) + 전염 성냥(타며 죽으면 불이 옆으로 옮겨붙음) */
async function sceneCoilMatch(no) {
  await setup({
    char: 'cat',
    stage: 1,
    layout: {
      cols: 7,
      rows: 6,
      items: [
        { defId: 'w_static_hairball', x: 0, y: 0, tier: 2 },
        { defId: 's_coil', x: 1, y: 0 },
        { defId: 'w_static_hairball', x: 0, y: 1, tier: 2 },
        { defId: 's_coil', x: 1, y: 1 },
        { defId: 'w_flame_toaster', x: 2, y: 0 },
        { defId: 's_match', x: 4, y: 0 },
        { defId: 's_match', x: 4, y: 1 },
      ],
    },
  });
  await scaleHp(1.4);
  await trackFx(['chainHop', 'burnSpread']);
  await autoAim();
  await sleep(7000);
  const frames = await burst(22, 70, fxRecent);
  return keep(no, 'coil-match', 'coil 2nd hop + match burn spread', best(frames, (f) => (f.ex ? (f.ex.chainHop ?? 0) * 6 + (f.ex.burnSpread ?? 0) * 6 : 0) * 10 + (f.st?.fxParticles ?? 0)));
}

/** 스킬 장면: 게이지를 채우고 버튼과 같은 경로(tryActivateSkill)로 발동 → 연속 촬영 */
async function castSkill() {
  const ok = await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    if (!s.debugFillSkill(1)) return false;
    s.tryActivateSkill();
    return s.sim.skill.uses > 0;
  });
  if (!ok) throw new Error('skill: cast failed');
}

/** 13: 빙하기 — 파란 번쩍임 + 서리 파도 + 얼음 결정, 화면의 적은 얼음 상자 */
async function sceneFreeze(no) {
  await setup({ char: 'penguin', stage: 2 });
  await untilFrontInside(120);
  await scaleHp(3);
  await trackFx(['freezeHit', 'frostWave']);
  await sleep(300);
  await castSkill();
  const frames = await burst(16, 70, fxRecent);
  return keep(no, 'skill-freeze', 'penguin: glacier (freeze)', best(frames, (f) => (f.ex ? f.ex.frozen * 10 + f.ex.flash * 120 + (f.ex.freezeHit ?? 0) * 2 : 0)));
}

/** 14: 온천 타임 — 따뜻한 기운 원 + 둘레 김, 원에 들어온 적 탄이 녹는다 (쏘는 적을 가까이 두고 자주 쏘게) */
async function sceneSpring(no) {
  await setup({ char: 'capybara', stage: 3, items: [['w_yuzu', 1]] });
  await stageEnemies({
    pinY: true,
    keep: [
      { def: ['dartgun', 'robot', 'jack'], col: 1, row: 6, hp: 900 },
      { def: ['jack', 'dartgun', 'robot'], col: 3, row: 5, hp: 900 },
      { def: ['robot', 'dartgun', 'jack'], col: 4, row: 6, hp: 900 },
      { def: ['dartgun', 'jack', 'robot'], col: 6, row: 6, hp: 900 },
      { def: ['jack', 'robot', 'dartgun'], col: 5, row: 5, hp: 900 },
    ],
  });
  await trackFx(['dissolve']);
  await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    s.setAim(-Math.PI / 2 - 1.3);
    // 쏘는 적이 자주 쏘게 (탄이 기운 원에 계속 들어오게)
    s.__iv.push(
      setInterval(() => {
        for (const e of s.sim.enemies) if (e.alive && e.attackTimer > 0.5) e.attackTimer = 0.1 + Math.random() * 0.3;
      }, 250),
    );
  });
  await sleep(900);
  await castSkill();
  await sleep(250);
  const frames = await burst(18, 90, fxRecent);
  return keep(no, 'skill-spring', 'capybara: hot spring aura (shots melt)', best(frames, (f) => (f.ex ? (f.ex.dissolve ?? 0) * 10 : 0) + (f.st?.fxParticles ?? 0) * 0.1));
}

/** 15: 털뭉치 폭풍 — 소용돌이 + 연보라 꼬리의 털뭉치 24개 부채꼴 */
async function sceneStorm(no) {
  await setup({ char: 'cat', stage: 2 });
  await untilFrontInside(120);
  await scaleHp(3);
  await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    s.setAim(-Math.PI / 2);
  });
  await sleep(300);
  await castSkill();
  await sleep(150);
  const frames = await burst(16, 70, fxRecent);
  return keep(no, 'skill-storm', 'cat: hairball storm', best(frames, (f) => (f.ex ? f.ex.skillShots * 3 : 0) + (f.st?.fxParticles ?? 0) * 0.05));
}

/** 16: 젤리가 갈라져 꼬마 젤리가 칸으로 튀어나옴 + RC카가 옆 칸으로 미끄러짐(젖힘·바퀴 먼지) */
async function sceneJellyCar(no) {
  await setup({ char: 'cat', stage: 3, items: [['w_yuzu', 1]] });
  await stageEnemies({
    pinY: true,
    keep: [
      { def: ['shifter'], col: 2, row: 5, hp: 900 },
      { def: ['splitter'], col: 5, row: 5 },
      { def: ['soldier'], col: 4, row: 4, hp: 900 },
      { def: ['soldier'], col: 6, row: 4, hp: 900 },
      { def: ['block', 'soldier'], col: 1, row: 4, hp: 900 },
    ],
  });
  await trackFx(['jellySplat', 'slideDust']);
  await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    s.setAim(-Math.PI / 2 - 1.3);
  });
  await sleep(400);
  await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    const sim = s.sim;
    const car = sim.enemies.find((e) => e.defId === 'shifter');
    if (car) car.abilityTimer = 0;
    setTimeout(() => {
      const j = sim.enemies.find((e) => e.defId === 'splitter' && e.alive);
      if (j) sim.kill(j);
    }, 120);
  });
  const frames = await burst(18, 45, fxRecent);
  return keep(no, 'jelly-car', 'jelly split + RC car slide', best(frames, (f) => (f.ex ? f.ex.hopping * 6 + f.ex.sliding * 6 + (f.ex.jellySplat ?? 0) * 3 : 0)));
}

// ── 시트 ─────────────────────────────────────────────────────

async function makeSheet(cells, name = 'sheet.png') {
  const cols = 4;
  const rows = Math.ceil(cells.length / cols);
  const cw = VIEW.width;
  const ch = VIEW.height + LABEL_H;
  const comps = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const left = GAP + (i % cols) * (cw + GAP);
    const top = GAP + Math.floor(i / cols) * (ch + GAP);
    const img = await sharp(c.buf).resize(VIEW.width, VIEW.height).png().toBuffer();
    const info = [c.fxParticles != null ? `fx ${c.fxParticles}` : '', c.proj != null ? `proj ${c.proj}` : '', c.combo ? `combo ${c.combo}` : ''].filter(Boolean).join(' · ');
    const svg = `<svg width="${cw}" height="${LABEL_H}"><rect width="100%" height="100%" fill="#2b1d3a"/>
<text x="8" y="20" font-size="15" font-weight="bold" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif">${c.no}. ${c.label}</text>
<text x="${cw - 8}" y="20" font-size="12" fill="#c9b8e0" text-anchor="end" font-family="Segoe UI, Arial, sans-serif">${info}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left, top });
    comps.push({ input: img, left, top: top + LABEL_H });
  }
  const file = path.join(OUT_DIR, name);
  await sharp({ create: { width: GAP + cols * (cw + GAP), height: GAP + rows * (ch + GAP), channels: 3, background: '#140e1c' } })
    .composite(comps)
    .png()
    .toFile(file);
  return file;
}

// ── 메인 ─────────────────────────────────────────────────────

let browser = null;
try {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.png')) rmSync(path.join(OUT_DIR, f));
  server = startServer();
  await waitForServer();
  browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (!isIgnorable(text, m.location()?.url)) summary.consoleErrors.push(text);
  });
  page.on('pageerror', (e) => summary.pageErrors.push(String(e?.stack ?? e)));
  if (!ALLOW_HMR) await page.routeWebSocket(/^wss?:\/\//, () => {});
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__game?.scene === 'function', null, { timeout: 30000 });
  // 레벨업 창 보류 (Game.debugHoldLevelUps): 처치 경험치로 뜬 3지선다 창이 측정을 멈추지 않게 — 대기 레벨업은 런에만 쌓인다
  await page.evaluate(() => {
    window.__game.game.debugHoldLevelUps = true;
  });
  await sleep(1500);

  const cells = [];
  const run = async (no, fn) => {
    if (ONLY.length && !ONLY.includes(no)) return;
    try {
      cells.push(await fn());
    } catch (err) {
      summary.failures.push(`scene ${no}: ${String(err?.message ?? err)}`);
    }
  };
  await run(1, () => sceneNormal(1));
  await run(2, () => sceneCombo(2));
  await run(3, () => sceneElement(3, 'explosion', 'explosion (watermelon, molotov)', [['w_watermelon', 2], ['w_yuzu_molotov', 2]], (e) => e.booms));
  await run(4, () => sceneElement(4, 'fire', 'fire (flame toaster)', [['w_flame_toaster', 2], ['w_flame_toaster', 1]], (e) => e.burning));
  await run(5, () => sceneElement(5, 'ice', 'ice (bingsu, tuna)', [['w_melon_bingsu', 1], ['w_tuna_missile', 2]], (e) => e.frost + e.chilled));
  await run(6, () => sceneElement(6, 'lightning', 'lightning (static hairball)', [['w_static_hairball', 3], ['w_static_hairball', 2]], (e) => e.bolts, 9000));
  await run(7, () => sceneElite(7));
  await run(8, () => sceneBoss(8));
  await run(9, () => sceneBackShield(9));
  await run(10, () => sceneHealBomb(10));
  await run(11, () => sceneSynergy(11));
  await run(12, () => sceneCoilMatch(12));
  await run(13, () => sceneFreeze(13));
  await run(14, () => sceneSpring(14));
  await run(15, () => sceneStorm(15));
  await run(16, () => sceneJellyCar(16));
  if (cells.length) summary.sheet = path.relative(ROOT, await makeSheet(cells));
  const fresh = cells.filter((c) => c.no >= 9);
  if (fresh.length && fresh.length < cells.length) summary.sheetNew = path.relative(ROOT, await makeSheet(fresh, 'sheet-new.png'));
} catch (err) {
  summary.failures.push(String(err?.stack ?? err));
} finally {
  try {
    await browser?.close();
  } catch {
    /* 무시 */
  }
  stopServer();
}

if (summary.consoleErrors.length) summary.failures.push(`${summary.consoleErrors.length} console error(s)`);
if (summary.pageErrors.length) summary.failures.push(`${summary.pageErrors.length} page error(s)`);
summary.ok = summary.failures.length === 0 && summary.scenes.length === (ONLY.length ? ONLY.filter((n) => n <= SCENE_COUNT).length : SCENE_COUNT);
summary.durationMs = Date.now() - started;
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
