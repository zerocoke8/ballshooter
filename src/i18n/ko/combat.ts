// 전투 화면 (HUD, 일시정지, 알림).

export const combat = {
  stage: (n: number): string => `스테이지 ${n}`,
  enemiesLeft: (n: number): string => `남은 적 ${n}`,
  pause: '일시정지',
  resume: '계속하기',
  bag: '가방',
  giveUp: '포기하기',
  confirmGiveUp: '정말 포기할까요?\n이번 모험이 끝나요.',

  bossIncoming: '보스 등장!',
  /** 보스 테스트: HUD 위 작은 글자 / 승리 배너 / 가방 오버레이의 그만두기 */
  bossTest: '보스 테스트',
  bossDefeated: '격파!',
  quitBossTest: '그만두기',
  /** 페이즈 전환 배너: 제목 (n = 1부터) + 부제 (페이즈 인덱스 1.. → 문구, 없으면 마지막 것) */
  phase: (n: number): string => `${n}페이즈!`,
  phaseSub: ['', '화가 났어요! 공격이 더 거세져요', '폭주! 천천히 내려와요'] as readonly string[],
  breach: '방어선이 뚫렸어요!',
  knockedOut: '쓰러졌어요…',
  /** 적 몸에 닿아 패배 (접촉 = 즉시 패배) */
  crushed: '장난감에 부딪혔어요!',
  cleared: '클리어!',
  defeat: '패배...',
  fight: '출동!',

  /** HUD 체력 "현재/최대" */
  hp: (cur: number, max: number): string => `${cur}/${max}`,
  goldGain: (n: number): string => `+${n}`,
  newItem: '새 아이템!',
  itemDropped: (name: string): string => `${name} 획득!`,
  newItemNamed: (name: string): string => `새 아이템! ${name}`,
  dropConverted: (n: number): string => `보관함이 가득 차서 +${n} 골드`,

  status: { burn: '화상', chill: '냉기', chain: '연쇄' },
  /** 하단 바 조작 안내 (탭 한 번 + 드래그 한 번 하면 사라짐) */
  controlsHint: '탭: 조준 · 드래그: 이동',
  /** 첫 스테이지에서 캐릭터 옆에 뜨는 말풍선 (첫 탭에 사라짐) */
  aimTutorial: '화면을 탭하면\n그 방향으로 쏴요!',
  bagPaused: '가방 정리 중 · 일시정지',
  /** 공이 웨이브 뒤·위에서 적을 때릴 때 뜨는 콤보 글자 (첫 타 / 연속이면 뒤에 배수) */
  backstab: '백어택!',
  backstabCombo: '백어택',
  /** 콤보 배수 — 숫자 비트맵 폰트로 그리므로 숫자·x·! 만 */
  comboCount: (n: number): string => `x${n}!`,
} as const;
