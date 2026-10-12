// Playwright 실제 입력 검사 — 시스템 Edge(없으면 Chrome), 폰 세로 화면(390×844, dpr 2, 터치)에서
// 진짜 터치 이벤트(CDP Input.dispatchTouchEvent / touchscreen.tap)로 핵심 조작이 상태를 바꾸는지 확인한다.
//
// 사용법: node tools/interaction-check.mjs
//   [--port 5211]  자체 개발 서버 포트 (--strictPort)
//   [--headed]     브라우저 창 보이기
//
// 검사 (모두 화면 좌표의 실제 터치):
//   1. 타이틀 → (탭) 새 게임 → (탭) 카피 카드 → (탭) 시작!  → 전투
//   2. 전투: 하단 바에서 오른쪽으로 드래그 → 플레이어 x 증가, 필드 위에서 왼쪽 위로 드래그 → x·y 감소
//      이동 감각(걷기): 손가락을 휙 끌고 놓으면 캐릭터는 뒤처져 있다가 이동 속도(상한)로 걸어가 놓은 자리에 정확히 선다
//      (지나치지 않음, 예상 시간 안), 필드 위쪽(예전 이동 구역 밖)까지 드래그로 올라갔다가 내려온다
//      조준: 필드 짧게 탭 → 조준각이 그 점을 향함 + 캐릭터 그대로, 이후 쏜 투사체가 그 방향,
//      필드 드래그 → 이동만 (조준 유지), 하단 바 탭 → 조준 안 바뀜,
//      두 손가락(손가락 1 하단 바 드래그 중 손가락 2 필드 탭) → 조준 바뀌고 이동 계속,
//      내 캐릭터 몸 탭 → 조준 안 바뀜, 컨텍스트 메뉴 막힘, 마우스 누른 곳≠뗀 곳(사이 move 없음) → 조준 안 함,
//      드래그 중 touchcancel / 탭 숨김 → 드래그 풀림(다음 드래그 정상)
//   3. 가방 오버레이(HUD 가방 버튼 탭): 유자 탭 → 선택 + 툴팁에 이름,
//      보관함 → 가방 빈 칸으로 드래그 → run.bag 변경, 유자 선택 후 '★ 합성' 탭 → ★2 유자 1개,
//      '계속하기' 탭 → 오버레이 닫힘 + 전투 무기 목록 갱신
//   3b. 액티브 스킬(카피 온천 타임, 게이지는 디버그 채우기 debugFillSkill): 반쯤 찬 게이지 탭 → 안 나감, 가득 → 버튼 탭 → 발동
//      (횟수 +1·게이지 0·효과 중), Space → 발동, 버튼에서 시작한 드래그 → 이동만(스킬 안 나감)
//      레벨업(앞 검사들 동안은 Game.debugHoldLevelUps로 보류): 보류 해제 → 쌓인 것 고르기 → 경험치로 두 레벨 → 창이 전투를 멈추고
//      카드 3장(+1 대기) → 카드 탭 → 런에 적용 + 다음 선택지 → 키 2 → 닫힘 + 전투 재개(sim 시간 흐름) + 무기 목록 = 가방 무기
//      → 승리하면 마지막 처치로 오른 레벨업을 클리어 화면 전에 고른다(카드 탭)
//   4. 상점: 카드 탭 → 툴팁 미리보기, 가방 아이템 탭 → 툴팁, 보관함 → 가방 드래그 → run.bag 변경
//   5. 보스 테스트 (일반 런 세이브가 있는 채로, 실제 탭): 타이틀 '보스 테스트' → 펭구 카드 → '보스전!' → 보스 착지 →
//      HUD 가방 → '그만두기' → 타이틀 (세이브 그대로) → 다시 보스 테스트 → 승리 → 결과 '다시 도전' → 같은 캐릭터 → 패배 →
//      '캐릭터 변경' → 보스 테스트 선택 → '뒤로' → 타이틀: 일반 세이브가 한 글자도 안 바뀜 + '이어하기' → 상점
//   6. 접촉 = 즉시 패배: 다음 전투에서 드래그로 캐릭터를 적 몸에 밀어 넣음 → lostReason 'contact' + 패배 배너 문구 → 결과 화면
// 스크린샷: tools/.out/interaction/NN-name.png. stdout 마지막에 JSON 요약. 실패하면 exit 1.
// 드래그는 '닫힌 루프': 손가락을 목표 칸 쪽으로 옮긴 뒤 BagView가 계산한 목표 칸(drag.tx/ty)을 읽어
// 어긋나면 손가락을 보정하고 놓는다 (터치 고스트 띄움 거리 같은 내부 상수를 하드코딩하지 않기 위해).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'tools', '.out', 'interaction');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const PORT = Number(argValue('port', 5211));
const HEADED = args.includes('--headed');
const BASE_URL = `http://localhost:${PORT}/`;
const VIEWPORT = { width: 390, height: 844 };
const DPR = 2;
/** BagView 더블탭 판정(320ms)보다 길게 — 같은 아이템을 연달아 탭할 때 회전으로 읽히지 않게 */
const TAP_GAP_MS = 450;

const summary = { ok: false, url: BASE_URL, browser: null, checks: [], consoleErrors: [], pageErrors: [], ignoredErrors: [], failures: [], durationMs: 0 };
const started = Date.now();

// ── 개발 서버 (smoke.mjs와 같은 방식) ─────────────────────────

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
      const browser = await chromium.launch({ channel, headless: !HEADED });
      summary.browser = channel;
      return browser;
    } catch (err) {
      errors.push(`${channel}: ${String(err?.message ?? err).split('\n')[0]}`);
    }
  }
  throw new Error(`system browser launch failed (${errors.join(' | ')})`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isIgnorable(text, url) {
  const where = `${url ?? ''} ${text}`;
  return /\/favicon\.ico(\?|$|\s)/.test(where) || /fonts\.(googleapis|gstatic)\.com/.test(where);
}

// ── 공용 ─────────────────────────────────────────────────────

let page = null;
let cdp = null;
let shotNo = 0;

function fail(msg) {
  summary.failures.push(msg);
}

/** 검사 1개 기록 */
function check(name, ok, detail) {
  summary.checks.push({ name, ok: !!ok, ...detail });
  if (!ok) fail(`[${name}] ${JSON.stringify(detail)}`);
  return !!ok;
}

async function shot(name) {
  shotNo++;
  const file = path.join(OUT_DIR, `${String(shotNo).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  return path.relative(ROOT, file);
}

async function scene() {
  return page.evaluate(() => window.__game?.scene() ?? '');
}

async function waitFor(fn, arg, timeoutMs = 10000, what = 'condition') {
  try {
    await page.waitForFunction(fn, arg, { timeout: timeoutMs, polling: 50 });
    return true;
  } catch {
    fail(`[wait] timed out waiting for ${what} (scene ${await scene()})`);
    return false;
  }
}

/** 현재 씬(또는 rootExpr로 고른 하위 노드)에서 이 글자를 가진 Text의 가장 가까운 상호작용 조상 가운데 (CSS px) */
async function findTapTarget(label, rootExpr) {
  return page.evaluate(
    ({ text, rootExpr }) => {
      const s = window.__game?.game.scenes.current;
      // eslint-disable-next-line no-new-func
      const root = rootExpr ? new Function('s', `return ${rootExpr}`)(s) : s;
      if (!root) return null;
      const stack = [root];
      while (stack.length) {
        const node = stack.pop();
        if (node.visible === false || node.destroyed) continue;
        if (typeof node.text === 'string' && node.text === text) {
          let target = node;
          while (target && target.eventMode !== 'static' && target !== root) target = target.parent;
          const b = (target && target !== root ? target : node).getBounds();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
        }
        if (node.children) for (const c of node.children) stack.push(c);
      }
      return null;
    },
    { text: label, rootExpr },
  );
}

/** 대상이 나타나고 등장 애니메이션이 끝날 때까지 기다린 뒤 실제 터치 탭 */
async function tapText(label, what, rootExpr, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let prev = null;
  let pos = null;
  while (Date.now() < deadline) {
    pos = await findTapTarget(label, rootExpr);
    const stable = pos && prev && pos.w > 8 && pos.h > 8 && Math.abs(pos.w - prev.w) / pos.w < 0.06;
    if (stable) break;
    prev = pos;
    await sleep(150);
  }
  if (!pos || pos.w <= 8) {
    fail(`[tap] '${label}' (${what}) not found/visible in ${await scene()}`);
    return false;
  }
  await page.touchscreen.tap(pos.x, pos.y);
  return true;
}

async function touchStart(p) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
}
async function touchMove(p) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
}
async function touchEnd() {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** 터치 드래그 (from → to, steps번 나눠 이동) */
async function touchDrag(from, to, { steps = 16, holdMs = 250 } = {}) {
  await touchStart(from);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await touchMove({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    await sleep(16);
  }
  await sleep(holdMs);
  await touchEnd();
}

// ── 가방 도우미 (in-page) ───────────────────────────────────

/** viewExpr: 현재 씬 s에서 BagView를 고르는 식 */
const BAG_IN_COMBAT = 's.overlay?.view';
const BAG_IN_SHOP = 's.bagView';

async function bagInfo(viewExpr) {
  return page.evaluate((viewExpr) => {
    const s = window.__game.game.scenes.current;
    // eslint-disable-next-line no-new-func
    const v = new Function('s', `return ${viewExpr}`)(s);
    if (!v) return null;
    const bag = window.__game.game.run.bag;
    return {
      items: bag.items.map((i) => ({ uid: i.uid, defId: i.defId, tier: i.tier, x: i.x, y: i.y, rot: i.rot })),
      stash: bag.stash.map((i) => ({ uid: i.uid, defId: i.defId, tier: i.tier })),
      cols: bag.cols,
      rows: bag.rows,
      selected: v.selected,
    };
  }, viewExpr);
}

/** BagView 로컬 점 → 화면 CSS px */
async function bagPoint(viewExpr, what, a, b) {
  return page.evaluate(
    ({ viewExpr, what, a, b }) => {
      const s = window.__game.game.scenes.current;
      // eslint-disable-next-line no-new-func
      const v = new Function('s', `return ${viewExpr}`)(s);
      const m = v.m;
      let local;
      if (what === 'stash') local = v.stashSlotCenter(a);
      else if (what === 'cell') local = { x: m.gridX + (a + 0.5) * m.cell, y: m.gridY + (b + 0.5) * m.cell };
      const g = v.toGlobal(local);
      // 로컬 1칸이 화면에서 몇 CSS px인지 (드래그 보정용)
      return { x: g.x, y: g.y, cellCss: m.cell * Math.abs(v.worldTransform.a) };
    },
    { viewExpr, what, a, b },
  );
}

/** 툴팁에 이 글자(정확히 일치)를 가진 Text가 보이는지 */
async function tooltipHas(viewExpr, text) {
  return page.evaluate(
    ({ viewExpr, text }) => {
      const s = window.__game.game.scenes.current;
      // eslint-disable-next-line no-new-func
      const v = new Function('s', `return ${viewExpr}`)(s);
      const stack = [v.tooltip];
      while (stack.length) {
        const n = stack.pop();
        if (!n || n.destroyed || n.visible === false) continue;
        if (typeof n.text === 'string' && n.text === text) return true;
        if (n.children) stack.push(...n.children);
      }
      return false;
    },
    { viewExpr, text },
  );
}

async function dragState(viewExpr) {
  return page.evaluate((viewExpr) => {
    const s = window.__game.game.scenes.current;
    // eslint-disable-next-line no-new-func
    const v = new Function('s', `return ${viewExpr}`)(s);
    const d = v?.drag;
    return d ? { zone: d.zone, tx: d.tx, ty: d.ty, valid: d.valid, uid: d.uid } : null;
  }, viewExpr);
}

/**
 * 보관함 index번 아이템을 가방 (cx, cy) 칸으로 터치 드래그.
 * 터치는 고스트가 손가락 위로 떠 있으므로, 처음엔 손가락을 칸 중심보다 아래(띄움 거리 추정)로 옮기고
 * BagView가 계산한 목표 칸을 읽어 어긋나면 칸 단위로 보정한다.
 */
async function dragStashToCell(viewExpr, index, cx, cy) {
  const from = await bagPoint(viewExpr, 'stash', index);
  const cell = await bagPoint(viewExpr, 'cell', cx, cy);
  // 첫 추정: 칸 중심에서 아래로 70 CSS px(+ 칸 절반) — 정확하지 않아도 아래 보정 루프가 맞춘다
  let finger = { x: cell.x, y: cell.y + 70 };
  await touchStart(from);
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await touchMove({ x: from.x + (finger.x - from.x) * t, y: from.y + (finger.y - from.y) * t });
    await sleep(16);
  }
  await sleep(120);
  let st = await dragState(viewExpr);
  for (let k = 0; k < 4 && st && st.zone === 'grid' && (st.tx !== cx || st.ty !== cy); k++) {
    finger = { x: finger.x + (cx - st.tx) * cell.cellCss, y: finger.y + (cy - st.ty) * cell.cellCss };
    await touchMove(finger);
    await sleep(60);
    st = await dragState(viewExpr);
  }
  await sleep(150);
  const before = st;
  await touchEnd();
  await sleep(350);
  return { dragStarted: before !== null, target: before, finger };
}

/** 가방 아이템(uid)의 화면 중심 */
async function bagItemCenter(viewExpr, uid) {
  return page.evaluate(
    ({ viewExpr, uid }) => {
      const s = window.__game.game.scenes.current;
      // eslint-disable-next-line no-new-func
      const v = new Function('s', `return ${viewExpr}`)(s);
      const view = v.views.get(uid);
      if (!view) return null;
      const g = view.getGlobalPosition();
      return { x: g.x, y: g.y };
    },
    { viewExpr, uid },
  );
}

/** 가방에서 비어 있고 주어진 칸들과 변으로 붙지 않은 1×1 칸 (오른쪽 아래부터) */
async function freeCellAwayFrom(viewExpr) {
  return page.evaluate(async () => {
    const run = window.__game.game.run;
    const items = window.__game.game.data.items;
    const { getOccupant } = await import('/src/logic/bag.ts');
    const bag = run.bag;
    const occupied = (x, y) => x >= 0 && y >= 0 && x < bag.cols && y < bag.rows && getOccupant(bag, items, x, y) !== null;
    for (let y = bag.rows - 1; y >= 0; y--) {
      for (let x = bag.cols - 1; x >= 0; x--) {
        if (occupied(x, y)) continue;
        if (occupied(x - 1, y) || occupied(x + 1, y) || occupied(x, y - 1) || occupied(x, y + 1)) continue;
        return { x, y };
      }
    }
    return null;
  }, viewExpr);
}

// ── 전투 조준 도우미 / 검사 ─────────────────────────────────

async function combatState() {
  return page.evaluate(() => window.__game.game.scenes.current.debugState());
}

/** 필드(시뮬레이션) 좌표 → 화면 CSS px. 필드 안쪽 여백으로 clamp */
async function fieldToScreen(fx, fy) {
  return page.evaluate(
    ({ fx, fy }) => {
      const s = window.__game.game.scenes.current;
      const g = s.playerLayer.toGlobal({ x: Math.max(40, Math.min(632, fx)), y: Math.max(60, Math.min(900, fy)) });
      return { x: g.x, y: g.y };
    },
    { fx, fy },
  );
}

/** 화면 점(CSS px)을 탭했을 때 기대하는 조준각: 발사점 → 그 점, sim과 같은 clamp */
async function expectedAim(p) {
  return page.evaluate(
    async ({ x, y }) => {
      const { clampAim, FIRE_OFFSET_Y } = await import('/src/logic/combat/sim.ts');
      const s = window.__game.game.scenes.current;
      const f = s.playerLayer.toLocal({ x, y });
      const pl = s.sim.player;
      return clampAim(Math.atan2(f.y - (pl.y - FIRE_OFFSET_Y), f.x - pl.x));
    },
    { x: p.x, y: p.y },
  );
}

function angDiff(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

const touchPts = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });

// ── 이동 감각 (걷기) / 자유 이동 ─────────────────────────────

/** 필드 1 px이 화면에서 몇 CSS px인지 */
async function cssPerFieldPx() {
  return page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    const a = s.playerLayer.toGlobal({ x: 0, y: 0 });
    const b = s.playerLayer.toGlobal({ x: 100, y: 0 });
    return (b.x - a.x) / 100;
  });
}

/** 캐릭터가 목표에 서서 멈출 때까지 (sim 시간 기준 기록). onFrame(k)는 사이사이 스크린샷용 */
async function followUntilStopped(maxPolls = 160, onFrame = null) {
  const samples = [];
  let last = await combatState();
  samples.push({ t: last.time, x: last.playerX, y: last.playerY, vx: last.playerVx, vy: last.playerVy });
  for (let k = 0; k < maxPolls; k++) {
    if (onFrame) await onFrame(k);
    await sleep(20);
    last = await combatState();
    samples.push({ t: last.time, x: last.playerX, y: last.playerY, vx: last.playerVx, vy: last.playerVy });
    if (last.status !== 'running') break;
    if (last.targetX !== null && last.playerX === last.targetX && last.playerY === last.targetY && last.playerVx === 0 && last.playerVy === 0) break;
  }
  return { samples, last };
}

/** 표본 사이 평균 속도(sim 시간 기준)의 최댓값 */
function maxAvgSpeed(samples) {
  let v = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    if (dt < 0.03) continue;
    v = Math.max(v, Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y) / dt);
  }
  return v;
}

async function moveFeelChecks(barY) {
  // (a) 손가락을 휙(약 0.1초) 넓은 쪽으로 150 CSS px 끌고 바로 놓기 → 캐릭터는 아직 뒤에서 걷는 중
  const s0 = await combatState();
  const dir = s0.playerX < 336 ? 1 : -1;
  const from = { x: 195 - dir * 75, y: barY };
  await touchStart(from);
  for (let i = 1; i <= 5; i++) {
    await touchMove({ x: from.x + dir * 30 * i, y: barY });
    await sleep(8);
  }
  await touchEnd();
  const s1 = await combatState();
  const lag = s1.targetX === null ? 0 : Math.abs(s1.targetX - s1.playerX);
  check('move: right after a quick flick the character is still walking behind the finger (no jump)', s1.targetX !== null && lag > 80 && !s1.dragging && Math.abs(s1.playerVx) > 1, {
    player: { x: s0.playerX, then: s1.playerX, vx: s1.playerVx },
    target: s1.targetX,
    lag,
  });
  // (b) 놓은 자리(목표)까지 이동 속도로 걸어가 정확히 선다 — 걷는 동안 프레임 4장
  let frames = 0;
  const { samples, last } = await followUntilStopped(160, async (k) => {
    if (frames < 4 && k % 3 === 0) await shot(`combat-walk-${frames++}`);
  });
  const target = s1.targetX;
  const dist = Math.abs(target - s1.playerX);
  const took = last.time - s1.time;
  const speed = s1.moveSpeed;
  const maxV = Math.max(...samples.map((q) => Math.hypot(q.vx, q.vy)));
  const avgV = maxAvgSpeed(samples);
  const overshoot = Math.max(...samples.map((q) => (q.x - target) * dir));
  // 남은 거리를 최고 속도로 + 감속 몫(0.1초 남짓) + 폴링 간격 여유
  const expected = dist / speed + 0.3;
  check('move: walks at a capped speed and stops exactly on the release point without overshooting', last.playerX === target && last.playerVx === 0 && maxV <= speed + 1e-6 && avgV <= speed * 1.02 && overshoot <= 1e-6 && took >= dist / speed - 0.02 && took <= expected, {
    moveSpeed: speed,
    distAfterRelease: dist,
    tookSimSec: took,
    expectedMaxSec: expected,
    maxSpeed: maxV,
    maxAvgSpeed: avgV,
    overshoot,
    final: { x: last.playerX, vx: last.playerVx, target },
  });
}

/** 필드 위쪽(예전 이동 구역 FIELD_H - 260보다 위)까지 드래그로 올라갔다가 다시 바닥으로 */
async function freeMoveCheck() {
  const k = await cssPerFieldPx();
  const s0 = await combatState();
  const up = Math.max(0, s0.playerY - 420) * k;
  await touchDrag({ x: 195, y: 790 }, { x: 195, y: 790 - up }, { steps: 14, holdMs: 120 });
  const { last: s1 } = await followUntilStopped(200);
  await shot('combat-moved-up');
  const enemiesClear = await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    const p = s.sim.player;
    return s.sim.enemies.every((e) => !e.alive || e.y + e.h < p.y - p.hitRadius);
  });
  check('move: the character can walk up into the field (no player zone)', s1.playerY < 600 && s1.status === 'running', {
    before: { x: s0.playerX, y: s0.playerY },
    after: { x: s1.playerX, y: s1.playerY },
    oldZoneTop: 700,
    enemiesStillAbove: enemiesClear,
  });
  // 다시 바닥으로 (이후 검사가 적에 닿지 않게)
  const down = Math.max(0, 900 - s1.playerY) * k;
  await touchDrag({ x: 195, y: 790 - down }, { x: 195, y: 790 }, { steps: 14, holdMs: 120 });
  const { last: s2 } = await followUntilStopped(200);
  check('move: and back down to the bottom', s2.playerY > 860 && s2.status === 'running', { after: { x: s2.playerX, y: s2.playerY } });
}

/** 다음 전투에서 드래그로 캐릭터를 가장 아래 적의 몸에 밀어 넣는다 → 즉시 패배(접촉) */
async function contactDeathCheck(crushedText) {
  await page.evaluate(() => window.__game.game.toCombat());
  await waitFor(() => window.__game.game.scenes.current?.debugState?.()?.phase === 'fight', null, 12000, 'next combat fight');
  // 적이 화면에 충분히 내려올 때까지 (빨리감기)
  await page.evaluate(() => window.__game.debug.setSpeed(4));
  await waitFor(() => window.__game.game.scenes.current.sim.enemies.some((e) => e.alive && e.y + e.h > 260), null, 15000, 'enemies on screen');
  await page.evaluate(() => window.__game.debug.setSpeed(1));
  const plan = await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    const p = s.sim.player;
    let low = null;
    for (const e of s.sim.enemies) if (e.alive && (!low || e.y + e.h > low.y + low.h)) low = e;
    return { px: p.x, py: p.y, ex: low.x + low.w / 2, ey: low.y + low.h - 10, id: low.id };
  });
  const k = await cssPerFieldPx();
  // 하단 바에서 시작해 적 쪽으로 (드래그 = 상대 이동, 캐릭터는 걸어서 따라간다)
  const from = { x: 195, y: 800 };
  const to = { x: from.x + (plan.ex - plan.px) * k, y: from.y + (plan.ey - plan.py) * k };
  await touchStart(from);
  for (let i = 1; i <= 16; i++) {
    await touchMove({ x: from.x + ((to.x - from.x) * i) / 16, y: from.y + ((to.y - from.y) * i) / 16 });
    await sleep(16);
  }
  // 닿을 때까지 손가락을 둔 채 프레임 기록
  let frames = 0;
  let st = await combatState();
  for (let i = 0; i < 120 && st && st.status === 'running'; i++) {
    if (frames < 3 && i % 4 === 0) await shot(`contact-approach-${frames++}`);
    await sleep(25);
    st = await combatState();
  }
  await touchEnd();
  await sleep(350);
  await shot('contact-defeat');
  const after = await combatState();
  const banner = await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    const out = [];
    const stack = [s.banner];
    while (stack.length) {
      const n = stack.pop();
      if (!n || n.destroyed) continue;
      if (typeof n.text === 'string') out.push(n.text);
      if (n.children) stack.push(...n.children);
    }
    return out;
  });
  check('contact: walking into an enemy body ends the run at once (reason contact, defeat banner)', after?.status === 'lost' && after?.lostReason === 'contact' && banner.includes(crushedText), {
    status: after?.status,
    lostReason: after?.lostReason,
    hp: after ? { hp: after.hp, maxHp: after.maxHp } : null,
    bannerTexts: banner,
    enemy: plan,
  });
  await waitFor(() => window.__game.scene() === 'ResultScene', null, 8000, 'ResultScene after contact defeat');
  await sleep(600);
  await shot('contact-result');
}

// ── 보스 테스트 ──────────────────────────────────────────────

async function savedRun() {
  return page.evaluate(() => localStorage.getItem('ballshooter.run'));
}

async function tapBagButton() {
  const p = await page.evaluate(() => {
    const b = window.__game.game.scenes.current.hud.bag.getBounds();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.touchscreen.tap(p.x, p.y);
}

/** 타이틀 → (탭) 보스 테스트 → (탭) 캐릭터 카드 → (탭) 보스전! → 보스 착지까지. 들어간 런 요약 */
async function enterBossTest(T, cardName) {
  await waitFor(() => window.__game.scene() === 'TitleScene', null, 8000, 'TitleScene');
  await sleep(2600);
  await tapText(T.bossTest, 'title boss test');
  await waitFor(
    () => window.__game.scene() === 'CharacterSelectScene' && window.__game.game.scenes.current.mode === 'bossTest',
    null,
    8000,
    'boss test character select',
  );
  await sleep(1200);
  await tapText(cardName, 'boss character card');
  await sleep(600);
  await tapText(T.bossTestStart, 'boss start');
  await waitFor(() => window.__game.game.scenes.current?.debugState?.()?.phase === 'fight', null, 10000, 'boss fight');
  await waitFor(
    () => {
      const st = window.__game.game.scenes.current?.debugState?.();
      return !!st?.boss && st.boss.mode !== 'enter';
    },
    null,
    10000,
    'boss landed',
  );
  return page.evaluate(() => {
    const r = window.__game.game.run;
    return r ? { mode: r.mode ?? null, characterId: r.characterId, cols: r.bag.cols, rows: r.bag.rows, items: r.bag.items.length } : null;
  });
}

async function bossTestChecks(T, names) {
  const saveBefore = await savedRun();
  check('boss: a normal run save exists before the boss test', !!saveBefore, {});
  await page.evaluate(() => window.__game.game.toTitle());

  // 그만두기 (전투 중 가방 → '그만두기')
  const run1 = await enterBossTest(T, names.penguin);
  check('boss: title → card → start enters a boss-test fight with the 6×5 preset bag', run1?.mode === 'bossTest' && run1.characterId === 'penguin' && run1.cols === 6 && run1.rows === 5 && run1.items >= 8, { run: run1 });
  await sleep(600);
  await shot('boss-landed');
  await tapBagButton();
  await waitFor(() => window.__game.game.scenes.current.debugState().bagOpen && !!window.__game.game.scenes.current.overlay, null, 4000, 'boss bag overlay');
  await sleep(500);
  await shot('boss-bag-quit');
  await tapText(T.quitBossTest, 'quit boss test', 's.overlay');
  await waitFor(() => window.__game.scene() === 'TitleScene', null, 8000, 'TitleScene after quitting the boss test');
  const afterQuit = { save: (await savedRun()) === saveBefore, hasSave: await page.evaluate(() => window.__game.game.hasSave()), run: await page.evaluate(() => window.__game.game.run) };
  check('boss: quitting mid-fight (bag → quit) returns to the title and keeps the normal save', afterQuit.save && afterQuit.hasSave && afterQuit.run === null, {
    saveUnchanged: afterQuit.save,
    hasSave: afterQuit.hasSave,
    runCleared: afterQuit.run === null,
  });

  // 승리 → 다시 도전 → 패배 → 캐릭터 변경 → 뒤로
  await enterBossTest(T, names.penguin);
  await page.evaluate(() => window.__game.debug.winStage());
  await waitFor(() => window.__game.scene() === 'BossResultScene', null, 12000, 'BossResultScene (win)');
  await sleep(1500);
  const win = await page.evaluate(() => window.__game.game.scenes.current.result);
  check('boss: winning shows the boss result (won, full boss damage)', win?.won === true && win.bossDamage === win.bossMaxHp && win.characterId === 'penguin', { result: win });
  await shot('boss-result-win');
  await tapText(T.bossRetry, 'boss retry');
  await waitFor(() => window.__game.game.scenes.current?.debugState?.()?.phase === 'fight', null, 10000, 'boss retry fight');
  const retryRun = await page.evaluate(() => ({ mode: window.__game.game.run?.mode ?? null, characterId: window.__game.game.run?.characterId }));
  check('boss: 다시 도전 restarts the boss test with the same character', retryRun.mode === 'bossTest' && retryRun.characterId === 'penguin', { run: retryRun });
  await page.evaluate(() => window.__game.debug.loseStage());
  await waitFor(() => window.__game.scene() === 'BossResultScene', null, 12000, 'BossResultScene (lose)');
  await sleep(1500);
  const lose = await page.evaluate(() => window.__game.game.scenes.current.result);
  check('boss: losing shows the boss result (lost)', lose?.won === false, { result: lose });
  await shot('boss-result-lose');
  await tapText(T.changeCharacter, 'boss change character');
  await waitFor(
    () => window.__game.scene() === 'CharacterSelectScene' && window.__game.game.scenes.current.mode === 'bossTest',
    null,
    8000,
    'boss select after change character',
  );
  await sleep(1000);
  await tapText(T.back, 'boss select back');
  await waitFor(() => window.__game.scene() === 'TitleScene', null, 8000, 'TitleScene after boss select back');
  const saveAfter = await savedRun();
  const hasSave = await page.evaluate(() => window.__game.game.hasSave());
  check('boss: the normal run save is byte-identical after the boss test', saveAfter === saveBefore && hasSave, { saveUnchanged: saveAfter === saveBefore, hasSave });

  // 이어하기 → 상점 (일반 런)
  await sleep(2600);
  await tapText(T.continueRun, 'continue after boss test');
  await waitFor(() => window.__game.scene() === 'ShopScene', null, 8000, 'ShopScene after continue');
  await sleep(800);
  const cont = await page.evaluate(() => ({ scene: window.__game.scene(), mode: window.__game.game.run?.mode ?? 'normal', characterId: window.__game.game.run?.characterId }));
  check('boss: 이어하기 still resumes the normal run in the shop', cont.scene === 'ShopScene' && cont.mode === 'normal' && cont.characterId === 'capybara', cont);
}

async function combatAimChecks() {
  await sleep(300);

  // (1) 필드를 짧게 탭 → 조준각이 탭한 점을 향하고, 캐릭터는 그대로
  const s0 = await combatState();
  const tapPt = await fieldToScreen(s0.playerX - 220, s0.playerY - 30 - 380);
  const want = await expectedAim(tapPt);
  await page.touchscreen.tap(tapPt.x, tapPt.y);
  await sleep(200);
  const s1 = await combatState();
  const moved1 = Math.hypot(s1.playerX - s0.playerX, s1.playerY - s0.playerY);
  check('aim: quick tap in the field aims at the tap point and does not move the player', angDiff(s1.aimAngle, want) < 0.05 && angDiff(s1.aimAngle, s0.aimAngle) > 0.2 && moved1 < 2, {
    aimBefore: s0.aimAngle,
    aimAfter: s1.aimAngle,
    expected: want,
    playerMoved: moved1,
  });
  await shot('combat-after-tap-aim');

  // (5) 탭 이후에 쏜 투사체가 그 방향으로 날아간다 (수동 조준은 지터 없음)
  let fresh = [];
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && fresh.length === 0) {
    const st = await combatState();
    fresh = st.recentShots.filter((p) => p.age <= 0.05);
    if (fresh.length === 0) await sleep(30);
  }
  const aimNow = (await combatState()).aimAngle;
  const shotAngles = fresh.map((p) => Math.atan2(p.vy, p.vx));
  check('aim: shots fired after the tap travel along the aim angle', fresh.length > 0 && shotAngles.every((a) => angDiff(a, aimNow) < 0.02), {
    aim: aimNow,
    shotAngles,
  });

  // (2) 필드에서 드래그 → 캐릭터는 움직이고 조준은 그대로
  const s2 = await combatState();
  await touchDrag({ x: 250, y: VIEWPORT.height * 0.62 }, { x: 160, y: VIEWPORT.height * 0.62 });
  await followUntilStopped(100); // 놓은 자리까지 걸어가 설 때까지
  const s3 = await combatState();
  check('aim: dragging on the field moves the player without changing the aim', s2.playerX - s3.playerX > 60 && s3.aimAngle === s2.aimAngle && !s3.dragging, {
    before: { x: s2.playerX, aim: s2.aimAngle },
    after: { x: s3.playerX, aim: s3.aimAngle, dragging: s3.dragging },
  });

  // (4) 하단 바(필드 밖)를 탭 → 조준 그대로, 이동도 없음
  await page.touchscreen.tap(VIEWPORT.width * 0.5, VIEWPORT.height * 0.93);
  await sleep(200);
  const s4 = await combatState();
  check('aim: tapping the bottom bar does not aim (and does not move)', s4.aimAngle === s3.aimAngle && Math.hypot(s4.playerX - s3.playerX, s4.playerY - s3.playerY) < 2, {
    aimBefore: s3.aimAngle,
    aimAfter: s4.aimAngle,
    player: { before: { x: s3.playerX, y: s3.playerY }, after: { x: s4.playerX, y: s4.playerY } },
  });

  // (3) 두 손가락: 손가락 1로 하단 바를 끄는 동안 손가락 2로 필드 탭 → 조준 바뀜 + 이동 계속
  const barY = VIEWPORT.height * 0.9;
  let f1 = { x: 110, y: barY, id: 1 };
  await touchPts('touchStart', [f1]);
  for (let i = 1; i <= 8; i++) {
    f1 = { ...f1, x: 110 + i * 8 };
    await touchPts('touchMove', [f1]);
    await sleep(16);
  }
  const mid = await combatState();
  const tap2 = await fieldToScreen(mid.playerX + 230, mid.playerY - 30 - 330);
  const f2 = { x: tap2.x, y: tap2.y, id: 2 };
  await touchPts('touchStart', [f1, f2]);
  await sleep(70);
  await touchPts('touchEnd', [f2]);
  const want2 = await expectedAim(tap2);
  const afterTap = await combatState();
  for (let i = 1; i <= 8; i++) {
    f1 = { ...f1, x: f1.x + 8 };
    await touchPts('touchMove', [f1]);
    await sleep(16);
  }
  await sleep(200);
  const stillDragging = (await combatState()).dragging;
  await touchPts('touchEnd', []);
  await sleep(250);
  const s5 = await combatState();
  check('aim: two fingers — tap with finger 2 aims while finger 1 keeps moving the player', angDiff(afterTap.aimAngle, want2) < 0.1 && angDiff(afterTap.aimAngle, s4.aimAngle) > 0.2 && stillDragging && s5.playerX - s4.playerX > 60 && s5.aimAngle === afterTap.aimAngle && !s5.dragging && s5.pointers === 0, {
    aimBefore: s4.aimAngle,
    aimAfterTap: afterTap.aimAngle,
    expected: want2,
    draggingDuringTap: mid.dragging,
    stillDraggingAfterTap: stillDragging,
    playerX: { before: s4.playerX, after: s5.playerX },
    pointersLeft: s5.pointers,
  });
  await shot('combat-after-two-finger');

  // (6) 내 캐릭터 몸을 탭 → 조준 그대로 (몸 아래쪽은 '아래 방향'이라 수평 끝으로 clamp되어 엉뚱하게 꺾이면 안 됨)
  await followUntilStopped(100);
  const s6 = await combatState();
  const bodyTaps = [
    [0, 0],
    [-15, 20],
    [12, 38],
  ];
  const bodyAims = [];
  for (const [dx, dy] of bodyTaps) {
    const p = await fieldToScreen(s6.playerX + dx, s6.playerY + dy);
    await page.touchscreen.tap(p.x, p.y);
    await sleep(120);
    bodyAims.push((await combatState()).aimAngle);
  }
  check('aim: tapping on your own character does not change the aim', bodyAims.every((a) => a === s6.aimAngle), {
    aimBefore: s6.aimAngle,
    aimsAfterBodyTaps: bodyAims,
  });

  // (7) 컨텍스트 메뉴(우클릭 · 안드로이드 길게 누르기)는 전투 화면에서 막힌다 — 메뉴가 뜨면 다음 클릭(조준)을 메뉴가 먹는다
  const ctxPrevented = await page.evaluate(() => {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 200, clientY: 400 });
    document.querySelector('canvas').dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  check('aim: the browser context menu is suppressed in combat', ctxPrevented, { defaultPrevented: ctxPrevented });

  // (8) 마우스를 누른 곳과 뗀 곳이 TAP_SLOP 넘게 다르면 (사이 move가 없어도) 탭이 아니다 → 조준 안 함
  const s8 = await combatState();
  const m1 = await fieldToScreen(s8.playerX - 120, s8.playerY - 420);
  const m2 = await fieldToScreen(s8.playerX + 160, s8.playerY - 380);
  const mouseEv = (type, p) => cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  await mouseEv('mouseMoved', m1);
  await mouseEv('mousePressed', m1);
  await mouseEv('mouseReleased', m2);
  await sleep(150);
  const s8b = await combatState();
  check('aim: press and release far apart with no move in between is not a tap', s8b.aimAngle === s8.aimAngle && s8b.pointers === 0 && !s8b.dragging, {
    aimBefore: s8.aimAngle,
    aimAfter: s8b.aimAngle,
    pointers: s8b.pointers,
  });

  // (9) 드래그 중 touchcancel(시스템 제스처) → 드래그가 풀리고, 다음 드래그는 정상 이동 (포인터가 남아 이후 드래그가 조준으로 바뀌지 않게)
  const s9 = await combatState();
  await touchStart({ x: 150, y: barY });
  for (let i = 1; i <= 6; i++) {
    await touchMove({ x: 150 + i * 10, y: barY });
    await sleep(16);
  }
  const midCancel = await combatState();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await sleep(150);
  const afterCancel = await combatState();
  await touchDrag({ x: 260, y: barY }, { x: 160, y: barY }, { steps: 10, holdMs: 250 });
  await sleep(200);
  const s9b = await combatState();
  check('aim: touchcancel mid-drag releases the drag and the next drag still moves', midCancel.dragging && !afterCancel.dragging && afterCancel.pointers === 0 && afterCancel.playerX - s9b.playerX > 60 && s9b.aimAngle === s9.aimAngle, {
    draggingBeforeCancel: midCancel.dragging,
    afterCancel: { dragging: afterCancel.dragging, pointers: afterCancel.pointers },
    nextDragMovedX: afterCancel.playerX - s9b.playerX,
  });

  // (10) 드래그 중 탭이 가려짐(visibilitychange → hidden) → 포인터 정리 (돌아왔을 때 끊긴 드래그가 남지 않게)
  await touchStart({ x: 150, y: barY });
  for (let i = 1; i <= 6; i++) {
    await touchMove({ x: 150 + i * 10, y: barY });
    await sleep(16);
  }
  const midHide = await combatState();
  const afterHide = await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const st = window.__game.game.scenes.current.debugState();
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
    return { dragging: st.dragging, pointers: st.pointers };
  });
  await touchEnd();
  await sleep(100);
  check('aim: hiding the tab mid-drag releases the drag', midHide.dragging && !afterHide.dragging && afterHide.pointers === 0, {
    draggingBeforeHide: midHide.dragging,
    afterHide,
  });
}

// ── 레벨업 · 액티브 스킬 ─────────────────────────────────────

/** 측정 도구용 레벨업 보류 (Game.debugHoldLevelUps): true면 전투가 레벨업 창을 띄우지 않는다 */
async function setLevelUpHold(on) {
  await page.waitForFunction(() => !!window.__game?.game, null, { timeout: 30000 });
  await page.evaluate((v) => {
    window.__game.game.debugHoldLevelUps = v;
  }, on);
}

async function levelUpState() {
  return page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    const st = s?.debugState?.();
    return st ? { ...st.levelUp, time: st.time, scene: window.__game.scene() } : { scene: window.__game.scene() };
  });
}

/** 열린 레벨업 창 i번째 카드 가운데 (CSS px) */
async function levelUpCardCenter(i) {
  return page.evaluate((i) => {
    const o = window.__game.game.scenes.current?.levelUp;
    const c = o?.cards?.[i];
    if (!c) return null;
    const b = c.root.getBounds();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
  }, i);
}

/** 카드를 받을 때까지 기다렸다가 i번째 카드를 실제 터치로 탭 */
async function tapLevelUpCard(i, timeoutMs = 4000) {
  const ok = await waitFor(() => window.__game.game.scenes.current?.debugState?.()?.levelUp?.armed === true, null, timeoutMs, 'level-up cards armed');
  if (!ok) return false;
  const p = await levelUpCardCenter(i);
  if (!p) return false;
  await page.touchscreen.tap(p.x, p.y);
  return true;
}

/** 전투 씬에서 레벨업 창이 뜨는 대로 첫 카드를 탭하며 scene이 될 때까지. 고른 수 */
async function pickLevelUpsUntil(sceneName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let picks = 0;
  while (Date.now() < deadline) {
    const st = await levelUpState();
    if (st.scene === sceneName) return picks;
    if (st.open && st.armed) {
      const before = st.pending;
      if (await tapLevelUpCard(0, 1500)) {
        await page
          .waitForFunction((n) => (window.__game.game.scenes.current?.debugState?.()?.levelUp?.pending ?? 0) < n, before, { timeout: 2000, polling: 50 })
          .catch(() => {});
        picks++;
      }
    }
    await sleep(120);
  }
  fail(`[levelup] timed out picking level-ups waiting for ${sceneName} (picked ${picks})`);
  return picks;
}

async function skillState() {
  return page.evaluate(() => window.__game.game.scenes.current.debugState().skill);
}

/** 스킬 버튼 가운데 (CSS px) */
async function skillButtonCenter() {
  return page.evaluate(() => {
    const btn = window.__game.game.scenes.current.skillBtn;
    if (!btn) return null;
    const p = btn.toGlobal({ x: 0, y: 0 });
    return { x: p.x, y: p.y };
  });
}

async function fillSkill(frac) {
  return page.evaluate((f) => window.__game.game.scenes.current.debugFillSkill(f), frac);
}

/** 액티브 스킬: 버튼 탭(덜 찼으면 안 됨 / 가득이면 발동), Space, 버튼에서 시작한 드래그는 이동 (카피 — 온천 타임) */
async function skillChecks() {
  const btn = await skillButtonCenter();
  const s0 = await skillState();
  check('skill: the combat has a skill button and a skill gauge (capybara hot spring)', !!btn && s0?.id === 'hot_spring', { button: btn, skill: s0 });
  if (!btn || !s0) return;

  // 반쯤 찬 게이지: 탭해도 발동하지 않는다
  const filledHalf = await fillSkill(0.5);
  await sleep(120);
  await page.touchscreen.tap(btn.x, btn.y);
  await sleep(250);
  const s1 = await skillState();
  check('skill: tapping the button with a half gauge does nothing', filledHalf && s1.uses === s0.uses && !s1.ready, { filledHalf, before: s0, after: s1 });
  await shot('skill-half');

  // 가득 (디버그 채우기) → 준비 → 탭 → 발동 (게이지 0, 효과 시간)
  const filled = await fillSkill(1);
  await waitFor(() => window.__game.game.scenes.current.debugState().skill?.usable === true, null, 3000, 'skill usable after debug fill');
  await sleep(300);
  await shot('skill-ready');
  const s2 = await skillState();
  await page.touchscreen.tap(btn.x, btn.y);
  await sleep(200);
  const s3 = await skillState();
  check('skill: when full, tapping the button activates it (uses +1, gauge reset, effect running)', filled && s2.ready && s3.uses === s2.uses + 1 && s3.charge < 0.5 && s3.active > 0 && !s3.ready, {
    filled,
    before: s2,
    after: s3,
  });
  await shot('skill-active');

  // Space: 효과가 끝나고(온천 4초) 다시 가득이면 발동
  await waitFor(() => (window.__game.game.scenes.current.debugState().skill?.active ?? 1) <= 0, null, 8000, 'hot spring effect over');
  await fillSkill(1);
  await waitFor(() => window.__game.game.scenes.current.debugState().skill?.usable === true, null, 3000, 'skill usable again');
  const s4 = await skillState();
  await page.keyboard.press('Space');
  await sleep(200);
  const s5 = await skillState();
  check('skill: Space activates the skill when full', s5.uses === s4.uses + 1 && s5.active > 0, { before: s4, after: s5 });

  // 버튼에서 시작한 드래그는 이동 (하단 바 = 이동 패드), 스킬은 안 나간다. 왼쪽으로 끌 자리가 있게 먼저 캐릭터를 오른쪽으로
  await waitFor(() => (window.__game.game.scenes.current.debugState().skill?.active ?? 1) <= 0, null, 8000, 'hot spring effect over (2)');
  const px = await page.evaluate(() => window.__game.game.scenes.current.debugState().playerX);
  if (px < 420) {
    const barY = VIEWPORT.height * 0.9;
    await touchDrag({ x: 80, y: barY }, { x: 80 + Math.min(200, (480 - px) * 0.55), y: barY });
    await sleep(800);
  }
  await fillSkill(1);
  await waitFor(() => window.__game.game.scenes.current.debugState().skill?.usable === true, null, 3000, 'skill usable (drag check)');
  const before = await page.evaluate(() => {
    const st = window.__game.game.scenes.current.debugState();
    return { x: st.playerX, uses: st.skill.uses };
  });
  await touchDrag({ x: btn.x, y: btn.y }, { x: btn.x - 120, y: btn.y }, { steps: 12, holdMs: 250 });
  await sleep(800);
  const after = await page.evaluate(() => {
    const st = window.__game.game.scenes.current.debugState();
    return { x: st.playerX, uses: st.skill.uses, dragging: st.dragging, pointers: st.pointers };
  });
  check('skill: a drag that starts on the skill button moves the player and does not cast', before.x - after.x > 100 && after.uses === before.uses && !after.dragging && after.pointers === 0, {
    before,
    after,
  });
}

/** 레벨업 3지선다: 보류를 풀고 경험치로 레벨 둘 → 창이 전투를 멈춤, 카드 탭 적용 → 다음 선택지, 키 2로 마지막 → 전투 재개 */
async function levelUpChecks() {
  await setLevelUpHold(false);
  // 그동안(보류 중) 실제 처치로 쌓인 레벨업이 있으면 지금 뜬다 — 다 고르고 시작
  await sleep(300);
  const pre = await levelUpState();
  let prePicks = 0;
  if (pre.pending > 0) {
    while ((await levelUpState()).pending > 0 && prePicks < 12) {
      if (await tapLevelUpCard(0)) prePicks++;
      await sleep(600);
    }
  }
  await waitFor(() => window.__game.game.scenes.current.debugState().levelUp.open === false, null, 4000, 'level-up overlay closed (pre)');

  // 경험치로 정확히 두 레벨 (한 번에 — 그 사이 프레임이 없어 창은 대기 2로 열린다. 곡선은 게임 값을 읽는다)
  const gained = await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    const a = s.debugState().levelUp;
    let n = s.debugGrantXp(a.need - a.xp);
    const b = s.debugState().levelUp;
    n += s.debugGrantXp(b.need - b.xp);
    return n;
  });
  const opened = await waitFor(() => window.__game.game.scenes.current.debugState().levelUp.armed === true, null, 4000, 'level-up overlay');
  const l0 = await levelUpState();
  await sleep(400);
  const l0b = await levelUpState();
  check('levelup: gaining two levels pauses combat and shows 3 cards (+1 queued)', gained === 2 && opened && l0.open && l0.choices === 3 && l0.pending === 2 && l0b.time === l0.time, {
    prePicks,
    gained,
    state: l0,
    timeAfter400ms: l0b.time,
  });
  await shot('levelup-open');

  // 카드 1 탭 → 런에 적용(대기 1 감소, 선택지 지움) → 다음 선택지가 이어서
  const run0 = await page.evaluate(() => {
    const r = window.__game.game.run;
    return { offer: r.levelOffer, items: r.bag.items.length, stash: r.bag.stash.length, boons: { ...(r.boons ?? {}) }, tiers: r.bag.items.map((i) => i.tier), gold: r.gold };
  });
  await tapLevelUpCard(0);
  await waitFor(() => window.__game.game.scenes.current.debugState().levelUp.pending === 1, null, 3000, 'first pick applied');
  const run1 = await page.evaluate(() => {
    const r = window.__game.game.run;
    return { items: r.bag.items.length, stash: r.bag.stash.length, boons: { ...(r.boons ?? {}) }, tiers: r.bag.items.map((i) => i.tier), gold: r.gold };
  });
  const c0 = run0.offer?.[0];
  const applied =
    c0?.kind === 'item'
      ? run1.items + run1.stash > run0.items + run0.stash || run1.gold > run0.gold
      : c0?.kind === 'boon'
        ? (run1.boons[c0.boon] ?? 0) === (run0.boons[c0.boon] ?? 0) + 1
        : run1.tiers.reduce((a, b) => a + b, 0) === run0.tiers.reduce((a, b) => a + b, 0) + 1;
  await waitFor(() => window.__game.game.scenes.current.debugState().levelUp.armed === true, null, 4000, 'second level-up cards');
  const l1 = await levelUpState();
  check('levelup: tapping a card applies it and the queued level-up shows next', applied && l1.open && l1.pending === 1 && l1.choices === 3, {
    choice: c0,
    before: run0,
    after: run1,
    state: l1,
  });
  await shot('levelup-second');

  // 키 2 → 마지막 → 창 닫힘 + 전투 재개 (sim 시간이 흐른다)
  await page.keyboard.press('Digit2');
  await waitFor(() => window.__game.game.scenes.current.debugState().levelUp.open === false, null, 4000, 'level-up overlay closed');
  const l2 = await levelUpState();
  await sleep(500);
  const l3 = await levelUpState();
  const loadoutOk = await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    const st = s.debugState();
    const bagWeapons = window.__game.game.run.bag.items.filter((i) => window.__game.game.data.items[i.defId].kind === 'weapon').length;
    return st.weaponUids.length === bagWeapons;
  });
  check('levelup: key 2 picks the last card, the overlay closes and combat resumes with the new loadout', !l2.open && l2.pending === 0 && l3.time > l2.time && loadoutOk, {
    afterClose: l2,
    timeLater: l3.time,
    loadoutOk,
  });
  await shot('levelup-after');

  // 스테이지 끝 검사를 위해: 다음 처치 하나면 레벨이 오르게 (마지막 처치들의 레벨업은 클리어 화면 전에 고른다)
  await page.evaluate(() => {
    const s = window.__game.game.scenes.current;
    const lu = s.debugState().levelUp;
    if (lu.need - lu.xp > 1) s.debugGrantXp(lu.need - lu.xp - 1);
  });
}

// ── 메인 ─────────────────────────────────────────────────────

async function run() {
  if (existsSync(OUT_DIR)) for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.png')) rmSync(path.join(OUT_DIR, f));
  mkdirSync(OUT_DIR, { recursive: true });

  server = startServer();
  await waitForServer();
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
    page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const url = msg.location()?.url;
      const text = url ? `${msg.text()} @ ${url}` : msg.text();
      if (isIgnorable(msg.text(), url)) summary.ignoredErrors.push(text);
      else summary.consoleErrors.push(text);
    });
    page.on('pageerror', (err) => summary.pageErrors.push(String(err?.stack ?? err)));
    cdp = await context.newCDPSession(page);
    // Vite HMR 연결을 막아 검사 도중 파일이 바뀌어도 새로고침되지 않게
    await page.routeWebSocket(/^wss?:\/\//, () => {});
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => typeof window.__game?.scene === 'function', null, { timeout: 30000 });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) fail(`[reload] page navigated/reloaded mid-run (${frame.url()})`);
    });
    // 조준·이동·가방 검사가 처치 경험치로 갑자기 뜬 레벨업 창에 끊기지 않게 — 레벨업 검사(7)에서만 푼다
    await setLevelUpHold(true);
    const T = await page.evaluate(async () => {
      const { T } = await import('/src/i18n/ko/index.ts');
      return {
        newRun: T.menu.newRun,
        startRun: T.menu.startRun,
        toShop: T.menu.toShop,
        resume: T.combat.resume,
        mergeTier: T.bag.mergeTier,
        crushed: T.combat.crushed,
        continueRun: T.menu.continueRun,
        bossTest: T.menu.bossTest,
        bossTestStart: T.menu.bossTestStart,
        bossRetry: T.menu.bossRetry,
        changeCharacter: T.menu.changeCharacter,
        quitBossTest: T.combat.quitBossTest,
        back: T.common.back,
      };
    });
    const names = await page.evaluate(() => {
      const d = window.__game.game.data;
      return {
        capybara: d.characters.capybara.name,
        penguin: d.characters.penguin.name,
        yuzu: d.items.w_yuzu.name,
        fire: d.items.s_fire.name,
        sneakers: d.items.g_sneakers.name,
      };
    });

    // 1) 메뉴 → 카피로 시작 (실제 탭)
    await waitFor(() => window.__game.scene() === 'TitleScene', null, 20000, 'TitleScene');
    await sleep(2200);
    await tapText(T.newRun, 'title new game');
    await waitFor(() => window.__game.scene() === 'CharacterSelectScene', null, 8000, 'CharacterSelectScene');
    await sleep(1200);
    await tapText(names.capybara, 'capybara card');
    await sleep(600);
    await tapText(T.startRun, 'start run');
    await waitFor(() => window.__game.scene() === 'CombatScene', null, 10000, 'CombatScene');
    const charId = await page.evaluate(() => window.__game.game.run?.characterId);
    check('menu: start as capybara via taps', charId === 'capybara', { characterId: charId });

    // 2) 전투 드래그
    await waitFor(() => window.__game.game.scenes.current?.debugState?.()?.phase === 'fight', null, 8000, 'combat phase fight');
    const pl = () => page.evaluate(() => {
      const st = window.__game.game.scenes.current.debugState();
      return { x: st.playerX, y: st.playerY };
    });
    const p0 = await pl();
    // 하단 바(필드 아래) 빈 곳에서 오른쪽으로 120 CSS px
    const barY = VIEWPORT.height * 0.9;
    await touchDrag({ x: 140, y: barY }, { x: 260, y: barY });
    await sleep(450); // 캐릭터는 놓은 자리까지 걸어간다 (약 0.5초)
    const p1 = await pl();
    check('combat: drag right in bottom bar moves player right', p1.x - p0.x > 100, { before: p0, after: p1 });
    await shot('combat-after-drag-right');
    // 필드 위에서 왼쪽 위로
    await touchDrag({ x: 250, y: VIEWPORT.height * 0.5 }, { x: 130, y: VIEWPORT.height * 0.5 - 60 });
    await sleep(450);
    const p2 = await pl();
    check('combat: drag left-up on field moves player left and up', p1.x - p2.x > 100 && p1.y - p2.y > 30, { before: p1, after: p2 });
    await shot('combat-after-drag-left-up');

    // 2a) 이동 감각: 걷기(뒤처졌다 따라잡음, 속도 상한, 지나치지 않고 섬) + 필드 위쪽까지 자유 이동
    await moveFeelChecks(barY);
    await freeMoveCheck();

    // 2b) 조준: 탭 = 조준, 드래그 = 이동 (조준 유지), 두 손가락 (이동 + 탭 조준)
    await combatAimChecks();

    // 3) 가방 오버레이
    const added = await page.evaluate(() => window.__game.debug.addItem('s_fire'));
    check('debug: add fire stone to stash', !!added, { added });
    const bagBtn = await page.evaluate(() => {
      const b = window.__game.game.scenes.current.hud.bag.getBounds();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.touchscreen.tap(bagBtn.x, bagBtn.y);
    await waitFor(() => window.__game.game.scenes.current.debugState().bagOpen && !!window.__game.game.scenes.current.overlay?.view, null, 4000, 'bag overlay');
    await sleep(500);
    const simTimeOpen = await page.evaluate(() => window.__game.game.scenes.current.debugState().time);
    await shot('bag-overlay-open');

    let info = await bagInfo(BAG_IN_COMBAT);
    const yuzus = info.items.filter((i) => i.defId === 'w_yuzu');
    check('bag: capybara starts with two yuzu', yuzus.length === 2, { yuzus });

    // 탭 선택 → 툴팁
    const y0 = await bagItemCenter(BAG_IN_COMBAT, yuzus[0].uid);
    await page.touchscreen.tap(y0.x, y0.y);
    await sleep(300);
    info = await bagInfo(BAG_IN_COMBAT);
    const tipYuzu = await tooltipHas(BAG_IN_COMBAT, names.yuzu);
    check('bag overlay: tap selects item and tooltip shows its name', info.selected === yuzus[0].uid && tipYuzu, {
      selected: info.selected,
      tooltipHasName: tipYuzu,
    });
    await shot('bag-overlay-yuzu-selected');
    await sleep(TAP_GAP_MS);

    // 드래그 중 Esc → 드래그만 취소 (오버레이는 열린 채, 아이템은 보관함에 그대로)
    const fireUid = info.stash.find((s) => s.defId === 's_fire')?.uid;
    {
      const from = await bagPoint(BAG_IN_COMBAT, 'stash', info.stash.findIndex((s) => s.uid === fireUid));
      await touchStart(from);
      for (let i = 1; i <= 8; i++) {
        await touchMove({ x: from.x - i * 12, y: from.y + i * 6 });
        await sleep(16);
      }
      const dragging = (await dragState(BAG_IN_COMBAT)) !== null;
      await page.keyboard.press('Escape');
      await sleep(250);
      await touchEnd();
      await sleep(400);
      const st = await page.evaluate(() => window.__game.game.scenes.current.debugState());
      const after = await bagInfo(BAG_IN_COMBAT);
      check('bag overlay: Escape during a drag cancels only the drag', dragging && st.bagOpen && !!after?.stash.some((s) => s.uid === fireUid), {
        dragging,
        bagOpen: st.bagOpen,
        stash: after?.stash ?? null,
      });
      // 이후 검사는 열린 오버레이가 필요하다
      if (!after) throw new Error('bag overlay closed by Escape during a drag — remaining bag checks need it open');
      info = after;
    }

    // 보관함 → 가방 드래그
    const target = await freeCellAwayFrom(BAG_IN_COMBAT);
    const drag1 = await dragStashToCell(BAG_IN_COMBAT, info.stash.findIndex((s) => s.uid === fireUid), target.x, target.y);
    info = await bagInfo(BAG_IN_COMBAT);
    const placed = info.items.find((i) => i.uid === fireUid);
    check('bag overlay: touch drag stash → bag places the item', !!placed && placed.x === target.x && placed.y === target.y && !info.stash.some((s) => s.uid === fireUid), {
      target,
      drag: drag1,
      placed: placed ?? null,
      stash: info.stash,
    });
    await shot('bag-overlay-after-drag');
    await sleep(TAP_GAP_MS);

    // ★ 합성: 유자 선택 → '★ 합성' 탭
    const y1 = await bagItemCenter(BAG_IN_COMBAT, yuzus[0].uid);
    await page.touchscreen.tap(y1.x, y1.y);
    await sleep(350);
    await shot('bag-overlay-merge-ready');
    await tapText(T.mergeTier, 'merge button', BAG_IN_COMBAT);
    await sleep(600);
    info = await bagInfo(BAG_IN_COMBAT);
    const yuzusAfter = info.items.filter((i) => i.defId === 'w_yuzu');
    check('bag overlay: ★ merge button merges the two yuzu into one ★2', yuzusAfter.length === 1 && yuzusAfter[0].tier === 2, { yuzusAfter });
    await shot('bag-overlay-merged');

    // 계속하기 → 닫힘 + 전투 반영 (가방 시간 동안 시뮬레이션 정지)
    const simTimeBeforeClose = await page.evaluate(() => window.__game.game.scenes.current.debugState().time);
    check('bag overlay: combat is paused while the bag is open', Math.abs(simTimeBeforeClose - simTimeOpen) < 1e-6, { simTimeOpen, simTimeBeforeClose });
    await tapText(T.resume, 'resume button', 's.overlay');
    await waitFor(() => !window.__game.game.scenes.current.debugState().bagOpen, null, 3000, 'overlay closed');
    const weapons = await page.evaluate(() => window.__game.game.scenes.current.debugState().weaponUids);
    check('combat: closing the bag applies the merged loadout', weapons.length === 1 && weapons[0] === yuzusAfter[0]?.uid, { weapons });
    await sleep(300);
    await shot('combat-after-bag');

    // 3b) 액티브 스킬 버튼 (탭·Space·버튼에서 시작한 드래그) + 레벨업 3지선다 (탭·키 2·여러 번 쌓임)
    await skillChecks();
    await levelUpChecks();

    // 4) 상점 (승리 → 남은 레벨업은 클리어 화면 전에 고르기 → 스테이지 클리어 → 탭 '상점으로')
    await page.evaluate(() => window.__game.debug.winStage());
    const endPicks = await pickLevelUpsUntil('StageClearScene', 20000);
    const runAfterWin = await page.evaluate(() => ({ levelUps: window.__game.game.run?.levelUps ?? 0, level: window.__game.game.run?.level ?? 1 }));
    check('levelup: level-ups earned by the last kills are offered before the stage clear screen', endPicks >= 1 && runAfterWin.levelUps === 0, {
      picksAtStageEnd: endPicks,
      run: runAfterWin,
    });
    await setLevelUpHold(true);
    await waitFor(() => window.__game.scene() === 'StageClearScene', null, 12000, 'StageClearScene');
    await sleep(800);
    // 첫 탭은 연출 건너뛰기, 그다음 버튼
    await page.touchscreen.tap(VIEWPORT.width / 2, VIEWPORT.height * 0.3);
    await sleep(500);
    await tapText(T.toShop, 'to shop');
    await waitFor(() => window.__game.scene() === 'ShopScene', null, 8000, 'ShopScene');
    await sleep(1200);
    await shot('shop');

    // 카드 탭 → 미리보기 툴팁
    const card = await page.evaluate(() => {
      const s = window.__game.game.scenes.current;
      const i = window.__game.game.run.shop.slots.findIndex((x) => x !== null);
      if (i < 0) return null;
      const c = s.cards[i];
      const b = c.getBounds();
      // 카드 위쪽 1/3 (자물쇠·구매 버튼을 피해서)
      return { index: i, defId: window.__game.game.run.shop.slots[i].defId, x: b.x + b.width * 0.4, y: b.y + b.height * 0.35 };
    });
    if (card) {
      await page.touchscreen.tap(card.x, card.y);
      await sleep(350);
      const cardName = await page.evaluate((id) => window.__game.game.data.items[id].name, card.defId);
      const tipCard = await tooltipHas(BAG_IN_SHOP, cardName);
      check('shop: tapping a card previews it in the tooltip', tipCard, { card, itemName: cardName });
      await shot('shop-card-preview');
    } else check('shop: has a card to preview', false, {});

    // 가방 아이템 탭 → 툴팁 (★2 유자)
    info = await bagInfo(BAG_IN_SHOP);
    const yz = info.items.find((i) => i.defId === 'w_yuzu');
    const yc = await bagItemCenter(BAG_IN_SHOP, yz.uid);
    await page.touchscreen.tap(yc.x, yc.y);
    await sleep(350);
    info = await bagInfo(BAG_IN_SHOP);
    const tipShop = await tooltipHas(BAG_IN_SHOP, names.yuzu);
    check('shop: tap selects bag item and tooltip shows its name', info.selected === yz.uid && tipShop, { selected: info.selected, tooltipHasName: tipShop });
    await sleep(TAP_GAP_MS);

    // 보관함 → 가방 드래그
    const added2 = await page.evaluate(() => window.__game.debug.addItem('g_sneakers'));
    await sleep(300);
    info = await bagInfo(BAG_IN_SHOP);
    const snUid = added2?.uid;
    const target2 = await freeCellAwayFrom(BAG_IN_SHOP);
    const drag2 = await dragStashToCell(BAG_IN_SHOP, info.stash.findIndex((s) => s.uid === snUid), target2.x, target2.y);
    info = await bagInfo(BAG_IN_SHOP);
    const placed2 = info.items.find((i) => i.uid === snUid);
    check('shop: touch drag stash → bag places the item', !!placed2 && placed2.x === target2.x && placed2.y === target2.y && !info.stash.some((s) => s.uid === snUid), {
      target: target2,
      drag: drag2,
      placed: placed2 ?? null,
    });
    const saved = await page.evaluate(() => {
      const raw = localStorage.getItem('ballshooter.run');
      const r = raw ? JSON.parse(raw) : null;
      return r ? r.bag.items.map((i) => i.uid) : null;
    });
    check('shop: bag change is saved', !!saved && saved.includes(snUid), { savedUids: saved });
    await shot('shop-after-drag');

    // 5) 보스 테스트 (일반 세이브가 있는 채로) — 끝나면 '이어하기'로 상점에 돌아와 있다
    await bossTestChecks(T, names);

    // 6) 접촉 = 즉시 패배 (마지막: 런이 끝난다)
    await contactDeathCheck(T.crushed);
  } finally {
    await browser.close().catch(() => {});
  }
}

let fatal = null;
process.on('SIGINT', () => {
  stopServer();
  process.exit(130);
});
try {
  await run();
} catch (err) {
  fatal = String(err?.stack ?? err);
  summary.failures.push(`fatal: ${String(err?.message ?? err).split('\n')[0]}`);
} finally {
  stopServer();
}

if (summary.consoleErrors.length) summary.failures.push(`${summary.consoleErrors.length} console error(s)`);
if (summary.pageErrors.length) summary.failures.push(`${summary.pageErrors.length} page error(s)`);
summary.ok = summary.failures.length === 0 && summary.checks.length > 0;
summary.durationMs = Date.now() - started;
if (fatal) summary.fatal = fatal;
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
process.exit(summary.ok ? 0 : 1);
