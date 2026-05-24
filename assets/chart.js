// 가족관계도 — 관계 기반 자동 레이아웃 + SVG 연결선.
// 데이터는 parents/spouses 관계만 저장하고, 좌표는 매번 layout() 으로 계산.

const STORAGE_KEY = 'family-chart-state-v2';
const TOKEN_KEY   = 'family-chart-edit-token';
const API_BASE    = 'https://family-chart-api.junyoung-cha83.workers.dev';
const SAVE_DEBOUNCE_MS = 800;
const CARD_W = 180;
const CARD_H = 250;
const COL_UNIT = 200;     // col 1 단위 = 화면상 200px
const ROW_GAP = 110;      // 세대 간 세로 간격
const SIBLING_GAP = 1;    // 형제 unit 간 추가 간격 (col 단위) — 정수 그리드 정렬
const PAD = 80;           // 보드 내부 padding (좌상)
const HOVER_PAD = 50;     // + 버튼 hit-area 확장 (px)

const INITIAL_STATE = () => ({
  perspective: 'A',
  people: [
    { id: 'p1', photo: '', title_a: '나',  title_b: '남편', name: '', parents: [], spouses: ['p2'] },
    { id: 'p2', photo: '', title_a: '아내', title_b: '나',  name: '', parents: [], spouses: ['p1'] }
  ]
});

let state = null;
let zoom = 1;
let autoFit = true;
// 부모 지정 모드 상태: { childId, selected: string[], blocked: Set<string> }
let parentMode = null;
// 드래그앤드롭 상태: { id, startX, startY, started, ghost, blocked, dropTarget, dropZone, zonesEl }
let drag = null;
const DRAG_THRESHOLD = 5;  // px

// ── 영속화 ─────────────────────────────────────────
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.people)) return parsed;
  } catch (e) { /* ignore */ }
  return null;
}

// 서버에 디바운스 PUT — 마지막 호출만 실제로 전송
let _saveTimer = null;
let _saveCtrl  = null;
let _syncStatus = 'idle';  // idle | pending | saving | saved | error | unauthorized | readonly

function setSyncStatus(s) {
  _syncStatus = s;
  const el = document.getElementById('syncStatus');
  if (!el) return;
  const map = {
    idle:        { text: '',           cls: '' },
    pending:     { text: '변경됨',     cls: 'pending' },
    saving:      { text: '저장중…',    cls: 'saving' },
    saved:       { text: '저장됨 ✓',   cls: 'saved' },
    error:       { text: '오프라인',   cls: 'error' },
    unauthorized:{ text: '토큰 오류',  cls: 'error' },
    readonly:    { text: '읽기전용',   cls: 'readonly' },
  };
  const m = map[s] || map.idle;
  el.textContent = m.text;
  el.className   = 'sync-status ' + m.cls;
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('저장 실패 — localStorage 용량 초과일 수 있어요.');
  }

  const token = getEditToken();
  if (!token) { setSyncStatus('readonly'); return; }

  setSyncStatus('pending');
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(pushToServer, SAVE_DEBOUNCE_MS);
}

async function pushToServer() {
  const token = getEditToken();
  if (!token) return;

  if (_saveCtrl) _saveCtrl.abort();
  _saveCtrl = new AbortController();

  setSyncStatus('saving');
  try {
    const clean = JSON.parse(JSON.stringify(state));
    for (const p of clean.people) { delete p._row; delete p._col; }

    const res = await fetch(`${API_BASE}/api/family`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Edit-Token': token },
      body: JSON.stringify(clean),
      signal: _saveCtrl.signal,
    });
    if (res.ok) {
      setSyncStatus('saved');
    } else if (res.status === 401) {
      // 잘못된 토큰 → 제거하고 읽기 전용으로
      localStorage.removeItem(TOKEN_KEY);
      updateEditUI();
      setSyncStatus('unauthorized');
    } else if (res.status === 413) {
      setSyncStatus('error');
      alert('데이터가 너무 큽니다 (사진을 줄이거나 일부 삭제해 보세요).');
    } else {
      setSyncStatus('error');
    }
  } catch (e) {
    if (e.name !== 'AbortError') setSyncStatus('error');
  }
}

async function fetchFromServer() {
  try {
    const res = await fetch(`${API_BASE}/api/family`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    if (json && Array.isArray(json.people)) return json;
  } catch (e) { /* offline */ }
  return null;
}

async function loadInitial() {
  // 1) 서버 우선 — 다른 기기와 동기화
  const remote = await fetchFromServer();
  if (remote) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(remote)); } catch (e) {}
    return migrate(remote);
  }
  // 2) localStorage 캐시 (오프라인 fallback)
  const local = loadLocal();
  if (local) return migrate(local);
  // 3) 번들된 기본값
  try {
    const res = await fetch('data/family.json?t=' + Date.now());
    if (res.ok) {
      const json = await res.json();
      if (json && Array.isArray(json.people)) return migrate(json);
    }
  } catch (e) { /* ignore */ }
  return INITIAL_STATE();
}

// ── 편집 토큰 ─────────────────────────────────
function getEditToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function promptEditToken() {
  const cur = getEditToken();
  const v = prompt(cur ? '편집 비밀번호 (비우면 로그아웃):' : '편집 비밀번호를 입력하세요:', cur);
  if (v === null) return;  // 취소
  if (v === '') {
    localStorage.removeItem(TOKEN_KEY);
  } else {
    localStorage.setItem(TOKEN_KEY, v.trim());
  }
  updateEditUI();
  // 새 토큰으로 즉시 한 번 push 시도 (검증 겸 첫 저장)
  if (getEditToken()) pushToServer();
  else setSyncStatus('readonly');
}

function updateEditUI() {
  const has = !!getEditToken();
  document.body.classList.toggle('read-only', !has);
  const btn = document.getElementById('btnEdit');
  if (btn) {
    btn.textContent  = has ? '✏️ 편집중' : '🔒 편집';
    btn.classList.toggle('active', has);
  }
  if (!has) setSyncStatus('readonly');
}

// 옛 스키마(row/col) → 새 스키마(parents/spouses) 마이그레이션
function migrate(loaded) {
  for (const p of loaded.people) {
    p.parents = p.parents || [];
    p.spouses = p.spouses || [];
    delete p.row;
    delete p.col;
  }
  return loaded;
}

// ── 유틸 ─────────────────────────────────────────
function escapeAttr(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function nextId() {
  const max = state.people.reduce((acc, p) => {
    const n = parseInt(String(p.id || '').replace(/\D/g, '')) || 0;
    return Math.max(acc, n);
  }, 0);
  return 'p' + (max + 1);
}

function findPerson(id) {
  return state.people.find(p => p.id === id);
}

// ── 레이아웃 계산 ─────────────────────────────────
// 각 사람의 _row, _col 을 계산. unit = 부부(또는 혼자) 묶음.
function layout() {
  const people = state.people;

  // 1) 세대 계산 (부모 max + 1, 부모 없으면 0)
  const gens = {};
  function getGen(p, stack = new Set()) {
    if (gens[p.id] !== undefined) return gens[p.id];
    if (stack.has(p.id)) return 0;  // 사이클 방지
    stack.add(p.id);
    if (p.parents.length === 0) {
      gens[p.id] = 0;
    } else {
      const parentGens = p.parents
        .map(pid => findPerson(pid))
        .filter(Boolean)
        .map(pp => getGen(pp, stack));
      gens[p.id] = parentGens.length ? Math.max(...parentGens) + 1 : 0;
    }
    return gens[p.id];
  }
  people.forEach(p => getGen(p));

  // 배우자는 같은 세대 — 높은 쪽으로 정렬
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of people) {
      for (const sid of p.spouses) {
        const s = findPerson(sid);
        if (!s) continue;
        const g = Math.max(gens[p.id], gens[s.id]);
        if (gens[p.id] !== g) { gens[p.id] = g; changed = true; }
        if (gens[s.id] !== g) { gens[s.id] = g; changed = true; }
      }
    }
  }

  // 2) 부부 단위(unit) 묶기
  const unitOf = {};   // id → unit
  const units = [];
  for (const p of people) {
    if (unitOf[p.id]) continue;
    const members = [p];
    for (const sid of p.spouses) {
      const s = findPerson(sid);
      if (s && !unitOf[s.id]) members.push(s);
    }
    const unit = { id: 'u' + units.length, members, gen: gens[p.id] };
    units.push(unit);
    members.forEach(m => { unitOf[m.id] = unit; });
  }

  // 3) unit 간 부모-자식 연결
  // unit.childUnits = 이 unit 멤버의 자식들이 속한 unit 집합
  for (const unit of units) {
    const memberIds = new Set(unit.members.map(m => m.id));
    const childUnits = [];
    const seen = new Set();
    for (const p of people) {
      if (p.parents.some(pid => memberIds.has(pid))) {
        const cu = unitOf[p.id];
        if (cu && !seen.has(cu.id)) {
          seen.add(cu.id);
          childUnits.push(cu);
        }
      }
    }
    unit.childUnits = childUnits;
  }

  // 4) root units (이 unit 멤버 중 누구도 외부 unit 의 자식이 아님)
  function isRoot(unit) {
    for (const m of unit.members) {
      for (const pid of m.parents) {
        const parentUnit = unitOf[pid];
        if (parentUnit && parentUnit !== unit) return false;
      }
    }
    return true;
  }
  const rootUnits = units.filter(isRoot);

  // 5) 각 unit 의 subtree width (재귀)
  function subtreeWidth(unit) {
    if (unit._sw !== undefined) return unit._sw;
    const selfW = unit.members.length;
    if (unit.childUnits.length === 0) {
      unit._sw = selfW;
      return unit._sw;
    }
    let childW = 0;
    unit.childUnits.forEach((cu, i) => {
      childW += subtreeWidth(cu);
      if (i > 0) childW += SIBLING_GAP;
    });
    unit._sw = Math.max(selfW, childW);
    return unit._sw;
  }
  units.forEach(subtreeWidth);

  // 6) col 할당 (top-down, 자식들은 부모 중심에 정렬)
  const cols = {};
  function assignCols(unit, centerCol) {
    const startCol = centerCol - (unit.members.length - 1) / 2;
    unit.members.forEach((m, i) => { cols[m.id] = startCol + i; });

    if (unit.childUnits.length === 0) return;
    const totalChildW = unit.childUnits.reduce((acc, cu, i) => {
      return acc + subtreeWidth(cu) + (i > 0 ? SIBLING_GAP : 0);
    }, 0);
    let cursor = centerCol - totalChildW / 2;
    for (const cu of unit.childUnits) {
      const cw = subtreeWidth(cu);
      assignCols(cu, cursor + cw / 2);  // 자식 unit 의 중심 = cursor + cw/2
      cursor += cw + SIBLING_GAP;
    }
  }
  let rootCursor = 0;
  for (const r of rootUnits) {
    const rw = subtreeWidth(r);
    assignCols(r, rootCursor + rw / 2);
    rootCursor += rw + 1.5;
  }

  // 7) 결과 저장
  for (const p of people) {
    p._row = gens[p.id] || 0;
    p._col = cols[p.id] !== undefined ? cols[p.id] : 0;
  }
}

// 카드 좌상단 X
function cardX(p, minCol) {
  return PAD + (p._col - minCol) * COL_UNIT;
}
// 카드 좌상단 Y
function cardY(p, minRow) {
  return PAD + (p._row - minRow) * (CARD_H + ROW_GAP);
}

// ── 렌더링 ─────────────────────────────────────────
function render() {
  const board = document.getElementById('board');
  board.innerHTML = '';

  if (state.people.length === 0) {
    board.style.width = '';
    board.style.height = '';
    board.innerHTML = '<div class="empty-hint">카드가 없습니다. "초기화" 를 눌러 시작 카드를 복구하세요.</div>';
    return;
  }

  layout();

  const minR = Math.min(...state.people.map(p => p._row));
  const minC = Math.min(...state.people.map(p => p._col));
  const maxR = Math.max(...state.people.map(p => p._row));
  const maxC = Math.max(...state.people.map(p => p._col));
  const widthCols = maxC - minC + 1;
  const heightRows = maxR - minR + 1;
  const totalW = PAD * 2 + (widthCols - 1) * COL_UNIT + CARD_W;
  const totalH = PAD * 2 + (heightRows - 1) * (CARD_H + ROW_GAP) + CARD_H;
  board.style.width = totalW + 'px';
  board.style.height = totalH + 'px';

  // 1) SVG 연결선 (카드 뒤)
  const svg = makeConnectionsSvg(totalW, totalH, minR, minC);
  board.appendChild(svg);

  // 2) 카드들
  for (const p of state.people) {
    const wrapper = makeCardWrapper(p, minR, minC);
    board.appendChild(wrapper);
  }

  applyZoom();
  applyParentModeClasses();
}

function makeConnectionsSvg(w, h, minR, minC) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'connections');
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  const addLine = (x1, y1, x2, y2) => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    svg.appendChild(line);
  };

  // (a) 부부 가로선 (한 쌍당 한 번만)
  const drawnPairs = new Set();
  for (const p of state.people) {
    for (const sid of p.spouses) {
      const key = [p.id, sid].sort().join('-');
      if (drawnPairs.has(key)) continue;
      drawnPairs.add(key);
      const s = findPerson(sid);
      if (!s) continue;
      if (p._row !== s._row) continue;
      const left  = p._col < s._col ? p : s;
      const right = p._col < s._col ? s : p;
      const x1 = cardX(left, minC) + CARD_W;
      const x2 = cardX(right, minC);
      const y  = cardY(left, minR) + CARD_H / 2;
      addLine(x1, y, x2, y);
    }
  }

  // (b) 부모-자식 (부모 그룹별로 묶어서)
  const groups = {};
  for (const p of state.people) {
    if (p.parents.length === 0) continue;
    const key = [...p.parents].sort().join('+');
    if (!groups[key]) groups[key] = { parents: p.parents, children: [] };
    groups[key].children.push(p);
  }
  for (const key in groups) {
    const g = groups[key];
    const parents = g.parents.map(findPerson).filter(Boolean);
    if (parents.length === 0 || g.children.length === 0) continue;

    // 부모 가운데 X (부부면 두 카드 가운데, 단독이면 그 카드 가운데)
    const parentCxs = parents.map(pp => cardX(pp, minC) + CARD_W / 2);
    const parentCenterX = (Math.min(...parentCxs) + Math.max(...parentCxs)) / 2;
    const parentBottomY = Math.max(...parents.map(pp => cardY(pp, minR) + CARD_H));
    const childTopY = Math.min(...g.children.map(c => cardY(c, minR)));
    const midY = (parentBottomY + childTopY) / 2;

    // 부모 가운데 → midY 까지 세로선
    addLine(parentCenterX, parentBottomY, parentCenterX, midY);

    // 자식들의 가로 연결선 — parentCenterX 도 범위에 포함시켜
    // 부모 세로선과 자식 세로선이 항상 만나도록 한다 (자식 1명 + 오프셋 케이스 대응)
    const childCxs = g.children.map(c => cardX(c, minC) + CARD_W / 2);
    const horizLeft  = Math.min(parentCenterX, ...childCxs);
    const horizRight = Math.max(parentCenterX, ...childCxs);
    if (horizRight > horizLeft) {
      addLine(horizLeft, midY, horizRight, midY);
    }
    // 각 자식 → midY 으로 세로선
    for (const c of g.children) {
      const cx = cardX(c, minC) + CARD_W / 2;
      addLine(cx, midY, cx, cardY(c, minR));
    }
  }

  return svg;
}

function makeCardWrapper(p, minR, minC) {
  const wrapper = document.createElement('div');
  wrapper.className = 'card-wrapper';
  wrapper.dataset.id = p.id;
  // wrapper 는 카드보다 사방으로 HOVER_PAD 만큼 큼 → + 버튼 hit area 포함
  wrapper.style.left = (cardX(p, minC) - HOVER_PAD) + 'px';
  wrapper.style.top  = (cardY(p, minR) - HOVER_PAD) + 'px';
  wrapper.style.width  = (CARD_W + HOVER_PAD * 2) + 'px';
  wrapper.style.height = (CARD_H + HOVER_PAD * 2) + 'px';

  const titleKey = state.perspective === 'A' ? 'title_a' : 'title_b';
  const titleVal = p[titleKey] || '';

  wrapper.innerHTML = `
    <div class="card">
      <button class="card-parents" title="부모 지정/변경" aria-label="부모 지정">↑</button>
      <button class="card-delete" title="삭제" aria-label="삭제">×</button>
      <div class="card-photo" title="사진 첨부">
        ${p.photo
          ? `<img src="${escapeAttr(p.photo)}" alt="" />`
          : '<span class="photo-placeholder">+</span>'}
      </div>
      <div class="card-fields">
        <input class="card-title" type="text" placeholder="호칭" value="${escapeAttr(titleVal)}" />
        <input class="card-name"  type="text" placeholder="이름" value="${escapeAttr(p.name || '')}" />
      </div>
    </div>
    <button class="card-add card-add-up"    data-dir="up"    title="위에 부모 추가">+</button>
    <button class="card-add card-add-down"  data-dir="down"  title="아래에 자식 추가">+</button>
    <button class="card-add card-add-left"  data-dir="left"  title="왼쪽에 배우자 또는 형제 추가">+</button>
    <button class="card-add card-add-right" data-dir="right" title="오른쪽에 배우자 또는 형제 추가">+</button>
  `;

  const cardEl = wrapper.querySelector('.card');
  wrapper.querySelector('.card-delete').onclick  = (e) => { e.stopPropagation(); deleteCard(p.id); };
  wrapper.querySelector('.card-parents').onclick = (e) => { e.stopPropagation(); enterParentMode(p.id); };
  wrapper.querySelector('.card-photo').onclick   = (e) => { if (parentMode) return; uploadPhoto(p.id); };
  cardEl.onclick = (e) => {
    if (!parentMode) return;
    if (e.target.closest('.card-add, .card-delete, .card-parents')) return;
    e.stopPropagation();
    togglePickParent(p.id);
  };
  wrapper.querySelector('.card-title').oninput  = (e) => updateField(p.id, titleKey, e.target.value);
  wrapper.querySelector('.card-name').oninput   = (e) => updateField(p.id, 'name', e.target.value);
  wrapper.querySelectorAll('.card-add').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const dir = btn.dataset.dir;
      if (dir === 'left' || dir === 'right') {
        showRelationMenu(p.id, btn, dir);
      } else {
        addByDirection(p.id, dir);
      }
    };
  });

  // 드래그 시작 — input/photo/+버튼/×/↑ 위에선 시작 안 함, parentMode·read-only 중에도 비활성
  cardEl.addEventListener('mousedown', (e) => {
    if (parentMode) return;
    if (document.body.classList.contains('read-only')) return;
    if (e.button !== 0) return;
    if (e.target.closest('input, .card-photo, .card-add, .card-delete, .card-parents')) return;
    startDrag(p.id, e);
  });

  return wrapper;
}

// ── 데이터 동기화 ─────────────────────────────────
// 배우자가 추가되면 그 부부의 자식들이 두 부모 모두를 parents 로 가져야 함.
// 안 그러면 자식이 "한쪽 부모 그룹" 으로 따로 묶여 별도 연결선이 그어짐.
function syncSpouseParents() {
  for (const p of state.people) {
    for (const sid of p.spouses) {
      for (const c of state.people) {
        if (c.parents.includes(p.id) && !c.parents.includes(sid)) {
          c.parents.push(sid);
        }
      }
    }
  }
}

// ── 액션 ─────────────────────────────────────────
function updateField(id, key, value) {
  const p = findPerson(id);
  if (!p) return;
  p[key] = value;
  saveLocal();
  // 입력 중 재렌더 X (포커스 유지)
}

function addByDirection(id, dir) {
  const p = findPerson(id);
  if (!p) return;
  let newId;
  if (dir === 'up')   newId = addParent(p);
  if (dir === 'down') newId = addChild(p);
  if (!newId) return;
  finalizeAdd(newId);
}

function finalizeAdd(newId) {
  syncSpouseParents();
  saveLocal();
  render();
  // 새 카드 호칭 input 에 포커스
  const inp = document.querySelector(`.card-wrapper[data-id="${newId}"] .card-title`);
  if (inp) inp.focus();
}

function addParent(p) {
  if (p.parents.length >= 2) {
    alert('부모는 최대 2명까지 가능합니다.');
    return null;
  }
  const newId = nextId();
  const np = { id: newId, photo: '', title_a: '', title_b: '', name: '', parents: [], spouses: [] };
  state.people.push(np);
  p.parents.push(newId);
  // 부모가 이미 1명 있었으면 그 부모와 새 부모를 배우자로 묶음
  if (p.parents.length === 2) {
    const otherId = p.parents.find(x => x !== newId);
    const other = findPerson(otherId);
    if (other) {
      np.spouses.push(otherId);
      if (!other.spouses.includes(newId)) other.spouses.push(newId);
    }
  }
  return newId;
}

function addChild(p) {
  const newId = nextId();
  const parents = [p.id];
  if (p.spouses.length > 0) parents.push(p.spouses[0]);  // 배우자도 부모로
  const np = { id: newId, photo: '', title_a: '', title_b: '', name: '', parents, spouses: [] };
  state.people.push(np);
  return newId;
}

function addSibling(p, side) {
  if (p.parents.length === 0) {
    alert('형제를 추가하려면 먼저 부모를 추가해주세요.\n(이 카드의 위에 + 클릭)');
    return null;
  }
  const newId = nextId();
  const np = { id: newId, photo: '', title_a: '', title_b: '', name: '', parents: [...p.parents], spouses: [] };
  state.people.push(np);
  return newId;
}

function addSpouse(p) {
  if (p.spouses.length > 0) {
    alert('이미 배우자가 있습니다.');
    return null;
  }
  const newId = nextId();
  const np = { id: newId, photo: '', title_a: '', title_b: '', name: '', parents: [], spouses: [p.id] };
  state.people.push(np);
  p.spouses.push(newId);
  return newId;
}

// 좌/우 + 버튼 클릭 시 뜨는 [배우자] [형제] 팝오버 메뉴
function showRelationMenu(personId, anchorBtn, side) {
  document.querySelector('.card-add-menu')?.remove();

  const p = findPerson(personId);
  if (!p) return;

  const spouseDisabled  = p.spouses.length > 0;
  const siblingDisabled = p.parents.length === 0;

  const menu = document.createElement('div');
  menu.className = 'card-add-menu';
  menu.innerHTML = `
    <button data-rel="spouse"  ${spouseDisabled  ? 'disabled title="이미 배우자가 있습니다"' : ''}>배우자</button>
    <button data-rel="sibling" ${siblingDisabled ? 'disabled title="부모를 먼저 추가하세요"' : ''}>형제</button>
  `;
  document.body.appendChild(menu);

  // 위치 — anchor + 버튼 옆에 표시
  const rect = anchorBtn.getBoundingClientRect();
  const mRect = menu.getBoundingClientRect();
  let left = side === 'right' ? rect.right + 6 : rect.left - mRect.width - 6;
  let top  = rect.top + (rect.height - mRect.height) / 2;
  left = Math.max(4, Math.min(left, window.innerWidth  - mRect.width  - 4));
  top  = Math.max(4, Math.min(top,  window.innerHeight - mRect.height - 4));
  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';

  menu.addEventListener('mousedown', (e) => e.stopPropagation());

  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onEsc);
  };
  const onOutside = (e) => { if (!menu.contains(e.target)) close(); };
  const onEsc = (e) => { if (e.key === 'Escape') close(); };

  menu.querySelectorAll('button').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      const rel = btn.dataset.rel;
      let newId = null;
      if (rel === 'spouse')  newId = addSpouse(p);
      if (rel === 'sibling') newId = addSibling(p, side);
      close();
      if (newId) finalizeAdd(newId);
    };
  });

  // 같은 클릭 사이클에 onOutside가 트리거되지 않도록 다음 tick에 등록
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onEsc);
  }, 0);
}

function deleteCard(id) {
  const p = findPerson(id);
  if (!p) return;
  const label = p.name || p.title_a || p.title_b || '이 카드';
  if (!confirm(`"${label}" 카드를 삭제할까요?\n자손 카드들의 부모 링크에서도 제거됩니다.`)) return;
  state.people = state.people.filter(x => x.id !== id);
  // 다른 사람들의 관계에서 정리
  for (const x of state.people) {
    x.parents = x.parents.filter(pid => pid !== id);
    x.spouses = x.spouses.filter(sid => sid !== id);
  }
  syncSpouseParents();
  saveLocal();
  render();
}

// 파일 → Image 객체 (FileReader 경유)
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('이미지 디코드 실패'));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

// 크롭 영역 (원본 픽셀 기준) → canvas 로 잘라서 JPEG 압축
function cropToDataUrl(img, region, outDim = 600, quality = 0.78) {
  const canvas = document.createElement('canvas');
  canvas.width = outDim;
  canvas.height = outDim;
  canvas.getContext('2d').drawImage(
    img,
    region.x, region.y, region.size, region.size,   // src 영역 (원본 좌표)
    0, 0, outDim, outDim                            // dest (출력 캔버스 가득)
  );
  return canvas.toDataURL('image/jpeg', quality);
}

// 크롭 다이얼로그 — 이미지를 화면에 띄우고 1:1 박스 드래그/리사이즈
// resolve(region | null) — null 이면 사용자 취소
function openCropDialog(img) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'crop-overlay';
    overlay.innerHTML = `
      <div class="crop-hint">사진을 잘라낼 영역을 정사각형으로 선택하세요. 박스 안: 이동 · 모서리: 크기 조정</div>
      <div class="crop-stage">
        <div class="crop-img-wrap">
          <img class="crop-img" alt="" />
          <div class="crop-box">
            <div class="crop-handle h-tl" data-h="tl"></div>
            <div class="crop-handle h-tr" data-h="tr"></div>
            <div class="crop-handle h-bl" data-h="bl"></div>
            <div class="crop-handle h-br" data-h="br"></div>
          </div>
        </div>
      </div>
      <div class="crop-footer">
        <button class="btn secondary" data-act="cancel">취소</button>
        <button class="btn" data-act="ok">확인</button>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const imgEl = overlay.querySelector('.crop-img');
    const wrap  = overlay.querySelector('.crop-img-wrap');
    const box   = overlay.querySelector('.crop-box');

    imgEl.src = img.src;

    // 박스 상태 (wrap 기준 픽셀)
    let bx = 0, by = 0, bs = 0;  // box left, top, size
    let iw = 0, ih = 0;          // imgEl 표시 크기

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function applyBox() {
      box.style.left   = bx + 'px';
      box.style.top    = by + 'px';
      box.style.width  = bs + 'px';
      box.style.height = bs + 'px';
    }

    function initBox() {
      const r = imgEl.getBoundingClientRect();
      iw = r.width;
      ih = r.height;
      wrap.style.width  = iw + 'px';
      wrap.style.height = ih + 'px';
      bs = Math.round(Math.min(iw, ih) * 0.8);
      bx = Math.round((iw - bs) / 2);
      by = Math.round((ih - bs) / 2);
      applyBox();
    }

    // 이미지 로드 완료 시점 (캐시되면 이미 로드된 상태일 수도 있음)
    if (imgEl.complete && imgEl.naturalWidth > 0) {
      requestAnimationFrame(initBox);
    } else {
      imgEl.addEventListener('load', initBox, { once: true });
    }

    // ── 드래그 처리 (mouse + touch 양쪽 직접 처리 — 모바일 사파리 호환) ──
    let drag = null;  // { mode, startX, startY, sx, sy, ss }

    function pointPos(e) {
      const r = wrap.getBoundingClientRect();
      const cx = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
      const cy = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
      return { x: cx - r.left, y: cy - r.top };
    }

    function onDown(e) {
      const t = e.target;
      const handle = t.classList && t.classList.contains('crop-handle') ? t.dataset.h : null;
      if (!handle && t !== box) return;
      e.preventDefault();
      e.stopPropagation();
      const pt = pointPos(e);
      drag = {
        mode: handle || 'move',
        startX: pt.x, startY: pt.y,
        sx: bx, sy: by, ss: bs,
      };
    }

    function onMove(e) {
      if (!drag) return;
      e.preventDefault();
      const pt = pointPos(e);
      const dx = pt.x - drag.startX;
      const dy = pt.y - drag.startY;

      if (drag.mode === 'move') {
        bx = clamp(drag.sx + dx, 0, iw - bs);
        by = clamp(drag.sy + dy, 0, ih - bs);
      } else {
        let newSize = drag.ss;
        let newX = drag.sx, newY = drag.sy;
        if (drag.mode === 'br') {
          newSize = Math.max(40, Math.min(iw - drag.sx, ih - drag.sy, drag.ss + Math.max(dx, dy)));
        } else if (drag.mode === 'tl') {
          const cap = Math.min(drag.sx + drag.ss, drag.sy + drag.ss);
          newSize = Math.max(40, Math.min(cap, drag.ss - Math.min(dx, dy)));
          newX = drag.sx + drag.ss - newSize;
          newY = drag.sy + drag.ss - newSize;
        } else if (drag.mode === 'tr') {
          const cap = Math.min(iw - drag.sx, drag.sy + drag.ss);
          newSize = Math.max(40, Math.min(cap, drag.ss + Math.max(dx, -dy)));
          newY = drag.sy + drag.ss - newSize;
        } else if (drag.mode === 'bl') {
          const cap = Math.min(drag.sx + drag.ss, ih - drag.sy);
          newSize = Math.max(40, Math.min(cap, drag.ss + Math.max(-dx, dy)));
          newX = drag.sx + drag.ss - newSize;
        }
        bs = newSize;
        bx = clamp(newX, 0, iw - bs);
        by = clamp(newY, 0, ih - bs);
      }
      applyBox();
    }

    function onUp() { drag = null; }

    // box(이동) + handle(리사이즈) 양쪽에 down 등록 — bubble 만 의존 X
    box.addEventListener('mousedown', onDown);
    box.addEventListener('touchstart', onDown, { passive: false });
    overlay.querySelectorAll('.crop-handle').forEach(h => {
      h.addEventListener('mousedown', onDown);
      h.addEventListener('touchstart', onDown, { passive: false });
    });
    // move/up 은 document 에 — 손가락이 박스 밖으로 나가도 이벤트 받음
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
    document.addEventListener('touchcancel', onUp);

    // 창 리사이즈 시 박스 위치 보정 (이미지 크기 바뀜)
    window.addEventListener('resize', initBox);

    // 확인 / 취소
    function cleanup(result) {
      window.removeEventListener('resize', initBox);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('touchcancel', onUp);
      document.body.style.overflow = '';
      overlay.remove();
      resolve(result);
    }
    overlay.querySelector('[data-act="cancel"]').onclick = () => cleanup(null);
    overlay.querySelector('[data-act="ok"]').onclick = () => {
      // 화면 박스 → 원본 이미지 좌표 변환
      const scale = img.naturalWidth / iw;
      cleanup({
        x: Math.round(bx * scale),
        y: Math.round(by * scale),
        size: Math.round(bs * scale),
      });
    };
    // ESC = 취소
    function onKey(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); cleanup(null); }
    }
    document.addEventListener('keydown', onKey);
  });
}

function uploadPhoto(id) {
  if (!getEditToken()) { alert('편집 모드에서만 사진을 변경할 수 있습니다. 헤더의 "🔒 편집" 을 눌러주세요.'); return; }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const img = await fileToImage(file);
      const region = await openCropDialog(img);
      if (!region) return;  // 사용자 취소
      const dataUrl = cropToDataUrl(img, region);
      const p = findPerson(id);
      if (!p) return;
      p.photo = dataUrl;
      saveLocal();
      render();
    } catch (err) {
      alert('이미지 처리 실패: ' + err.message);
    }
  };
  input.click();
}

function setPerspective(value) {
  state.perspective = value;
  saveLocal();
  render();
}

// ── 부모 지정 / 변경 모드 ─────────────────────────
function getDescendantIds(rootId) {
  const ids = new Set();
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop();
    for (const x of state.people) {
      if (x.parents.includes(cur) && !ids.has(x.id)) {
        ids.add(x.id);
        stack.push(x.id);
      }
    }
  }
  return ids;
}

function enterParentMode(childId) {
  const p = findPerson(childId);
  if (!p) return;
  const blocked = getDescendantIds(childId);
  blocked.add(childId);  // 자기 자신도 차단
  parentMode = { childId, selected: [...p.parents], blocked };
  document.body.classList.add('parent-mode');
  ensureParentBar();
  applyParentModeClasses();
}

function exitParentMode() {
  parentMode = null;
  document.body.classList.remove('parent-mode');
  document.querySelector('.parent-mode-bar')?.remove();
  applyParentModeClasses();
}

function togglePickParent(personId) {
  if (!parentMode) return;
  if (parentMode.blocked.has(personId)) return;
  const sel = parentMode.selected;
  const idx = sel.indexOf(personId);
  if (idx >= 0) {
    sel.splice(idx, 1);
  } else {
    if (sel.length >= 2) {
      alert('부모는 최대 2명입니다. 기존 선택을 해제하고 다시 선택하세요.');
      return;
    }
    sel.push(personId);
  }
  ensureParentBar();
  applyParentModeClasses();
}

function commitParents() {
  if (!parentMode) return;
  const p = findPerson(parentMode.childId);
  if (!p) { exitParentMode(); return; }
  const newParents = [...parentMode.selected];

  p.parents = newParents;

  // 부모 2명 선택 시 서로 배우자로 묶음 (이미 묶여 있으면 그대로)
  if (newParents.length === 2) {
    const [a, b] = newParents.map(findPerson);
    if (a && b) {
      if (!a.spouses.includes(b.id)) a.spouses.push(b.id);
      if (!b.spouses.includes(a.id)) b.spouses.push(a.id);
    }
  }

  syncSpouseParents();
  saveLocal();
  exitParentMode();
  render();
}

function ensureParentBar() {
  let bar = document.querySelector('.parent-mode-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'parent-mode-bar';
    bar.innerHTML = `
      <span class="pm-text"></span>
      <span class="pm-count"></span>
      <button class="pm-done">완료</button>
      <button class="pm-cancel">취소</button>
    `;
    document.body.appendChild(bar);
    bar.querySelector('.pm-done').onclick   = commitParents;
    bar.querySelector('.pm-cancel').onclick = exitParentMode;
  }
  if (!parentMode) return;
  const p = findPerson(parentMode.childId);
  const label = p ? (p.name || p.title_a || p.title_b || '카드') : '카드';
  bar.querySelector('.pm-text').textContent  = `"${label}" 의 부모 선택 (다른 카드 클릭)`;
  bar.querySelector('.pm-count').textContent = `${parentMode.selected.length} / 2`;
}

function applyParentModeClasses() {
  // 모든 카드의 모드 관련 클래스 제거
  document.querySelectorAll('.card').forEach(c => {
    c.classList.remove('is-self', 'is-blocked', 'is-picked');
  });
  if (!parentMode) return;
  document.querySelectorAll('.card-wrapper').forEach(w => {
    const id = w.dataset.id;
    const card = w.querySelector('.card');
    if (!card) return;
    if (id === parentMode.childId)        card.classList.add('is-self');
    else if (parentMode.blocked.has(id))  card.classList.add('is-blocked');
    if (parentMode.selected.includes(id)) card.classList.add('is-picked');
  });
}

// ── 드래그앤드롭 ─────────────────────────────────
function startDrag(personId, e) {
  if (drag) return;
  drag = {
    id: personId,
    startX: e.clientX,
    startY: e.clientY,
    started: false,
    ghost: null,
    blocked: null,
    dropTarget: null,
    dropZone: null,
    zonesEl: null,
  };
  // 드래그 후보 — text selection 방지
  e.preventDefault();
}

function ensureDragStarted(e) {
  if (!drag || drag.started) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  drag.started = true;

  // blocked = 자기 자신 + 자손
  drag.blocked = getDescendantIds(drag.id);
  drag.blocked.add(drag.id);

  // 원본 wrapper dim
  const wrapper = document.querySelector(`.card-wrapper[data-id="${drag.id}"]`);
  if (wrapper) wrapper.classList.add('is-dragging');

  // ghost — 원본 카드 클론
  const sourceCard = wrapper?.querySelector('.card');
  if (sourceCard) {
    const ghost = sourceCard.cloneNode(true);
    ghost.classList.add('drag-ghost');
    // 클론된 카드 안 보조 버튼들 제거 (시각만 필요)
    ghost.querySelectorAll('.card-delete, .card-parents').forEach(el => el.remove());
    ghost.style.width  = sourceCard.offsetWidth  + 'px';
    ghost.style.height = sourceCard.offsetHeight + 'px';
    // 현재 zoom 반영
    ghost.style.transform = `scale(${zoom})`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.ghostW = sourceCard.offsetWidth  * zoom;
    drag.ghostH = sourceCard.offsetHeight * zoom;
  }
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';
}

function onDragMove(e) {
  if (!drag) return;
  ensureDragStarted(e);
  if (!drag.started) return;

  // ghost 따라다님
  if (drag.ghost) {
    drag.ghost.style.left = (e.clientX - drag.ghostW / 2) + 'px';
    drag.ghost.style.top  = (e.clientY - drag.ghostH / 2) + 'px';
  }

  // 마우스 아래 어떤 카드가 있는지 — ghost를 잠시 숨겨야 elementFromPoint가 ghost를 안 잡음
  let underWrapper = null;
  if (drag.ghost) drag.ghost.style.display = 'none';
  const elUnder = document.elementFromPoint(e.clientX, e.clientY);
  if (drag.ghost) drag.ghost.style.display = '';
  if (elUnder) underWrapper = elUnder.closest('.card-wrapper');

  // 이전 target 정리
  if (drag.dropTarget && drag.dropTarget !== underWrapper) {
    drag.dropTarget.querySelector('.drop-zones')?.remove();
    drag.dropTarget.querySelector('.card')?.classList.remove('drop-blocked');
    drag.dropTarget = null;
    drag.dropZone = null;
  }

  if (!underWrapper) return;
  const targetId = underWrapper.dataset.id;

  // 자기 자신/자손 → blocked 표시만, drop zone 없음
  if (drag.blocked.has(targetId)) {
    if (drag.dropTarget !== underWrapper) {
      underWrapper.querySelector('.card')?.classList.add('drop-blocked');
      drag.dropTarget = underWrapper;
      drag.dropZone = null;
    }
    return;
  }

  // 새 target — drop-zones overlay 생성
  if (drag.dropTarget !== underWrapper) {
    const cardEl = underWrapper.querySelector('.card');
    if (!cardEl) return;
    const zones = document.createElement('div');
    zones.className = 'drop-zones';
    zones.innerHTML = `
      <div class="drop-zone drop-zone-top"    data-zone="top"></div>
      <div class="drop-zone drop-zone-bottom" data-zone="bottom"></div>
      <div class="drop-zone drop-zone-left"   data-zone="left"></div>
      <div class="drop-zone drop-zone-right"  data-zone="right"></div>
    `;
    cardEl.appendChild(zones);
    drag.dropTarget = underWrapper;
    drag.zonesEl = zones;
  }

  // 현재 hit zone 결정
  const targetCard = underWrapper.querySelector('.card');
  const zone = getDropZone(targetCard, e.clientX, e.clientY);
  if (zone !== drag.dropZone) {
    drag.zonesEl?.querySelectorAll('.drop-zone').forEach(z => {
      z.classList.toggle('active', z.dataset.zone === zone);
      if (z.dataset.zone === zone) z.textContent = zoneLabel(zone, targetId);
      else z.textContent = '';
    });
    drag.dropZone = zone;
  }
}

function zoneLabel(zone, targetId) {
  if (zone === 'top')    return '부모';
  if (zone === 'bottom') return '자식';
  const t = findPerson(targetId);
  const hasSpouse = t && t.spouses.length > 0;
  return hasSpouse ? '형제' : '배우자';
}

function getDropZone(cardEl, mx, my) {
  const r = cardEl.getBoundingClientRect();
  const rx = (mx - r.left) / r.width;
  const ry = (my - r.top)  / r.height;
  // 중앙 50% × 50% 는 무효 → null
  // 4영역: top/bottom (가로 전체의 위/아래 25%), left/right (세로 전체의 좌/우 25%)
  if (ry < 0.25) return 'top';
  if (ry > 0.75) return 'bottom';
  if (rx < 0.25) return 'left';
  if (rx > 0.75) return 'right';
  return null;
}

function onDragEnd(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';

  if (d.ghost) d.ghost.remove();
  if (d.dropTarget) {
    d.dropTarget.querySelector('.drop-zones')?.remove();
    d.dropTarget.querySelector('.card')?.classList.remove('drop-blocked');
  }
  document.querySelectorAll('.card-wrapper.is-dragging').forEach(w => w.classList.remove('is-dragging'));

  if (!d.started) return;  // 단순 클릭이었음
  if (!d.dropTarget || !d.dropZone) return;

  const targetId = d.dropTarget.dataset.id;
  if (d.blocked.has(targetId)) return;

  applyDropRelation(d.id, targetId, d.dropZone);
}

function applyDropRelation(droppedId, targetId, zone) {
  const dropped = findPerson(droppedId);
  const target  = findPerson(targetId);
  if (!dropped || !target) return;

  if (zone === 'top') {
    // dropped가 target의 부모가 됨 → target.parents에 droppedId 추가
    // "이동·변경" 의미: target의 기존 부모 관계 정리 후 dropped 만 (+dropped 의 배우자 자동)
    target.parents = [droppedId, ...(dropped.spouses[0] ? [dropped.spouses[0]] : [])];
  }
  else if (zone === 'bottom') {
    // dropped가 target의 자식 → dropped.parents = [target, target.spouse]
    dropped.parents = [targetId, ...(target.spouses[0] ? [target.spouses[0]] : [])];
  }
  else if (zone === 'left' || zone === 'right') {
    if (target.spouses.length === 0) {
      // 배우자
      // dropped 기존 배우자 제거 (mutual)
      for (const sid of [...dropped.spouses]) {
        const s = findPerson(sid);
        if (s) s.spouses = s.spouses.filter(x => x !== dropped.id);
      }
      dropped.spouses = [targetId];
      if (!target.spouses.includes(droppedId)) target.spouses.push(droppedId);
      // 배우자가 되면 부모 관계는 일반적으로 별개. 기존 dropped.parents 유지.
    } else {
      // 형제
      if (target.parents.length === 0) {
        alert('부모 없는 카드의 형제는 만들 수 없습니다.');
        return;
      }
      dropped.parents = [...target.parents];
    }
  }
  else {
    return;
  }

  syncSpouseParents();
  saveLocal();
  render();
}

// ── 줌 / 화면 맞춤 ────────────────────────────────
function applyZoom() {
  const board   = document.getElementById('board');
  const scaleEl = document.getElementById('boardScale');
  if (!board || !scaleEl) return;
  const tw = parseFloat(board.style.width)  || 0;
  const th = parseFloat(board.style.height) || 0;

  if (autoFit && tw > 0 && th > 0) {
    const wrap = document.querySelector('.board-wrap');
    const aw = wrap.clientWidth  - 2;
    const ah = wrap.clientHeight - 2;
    const fit = Math.min(aw / tw, ah / th, 1);  // 1 이상으로 키우진 않음
    zoom = isFinite(fit) && fit > 0 ? fit : 1;
    const r = document.getElementById('zoomRange');
    if (r) r.value = Math.max(0.3, Math.min(2, zoom));
  }

  board.style.transform = `scale(${zoom})`;
  scaleEl.style.width  = (tw * zoom) + 'px';
  scaleEl.style.height = (th * zoom) + 'px';

  const lbl = document.getElementById('zoomLabel');
  if (lbl) lbl.textContent = Math.round(zoom * 100) + '%';
}

function setZoom(v) {
  autoFit = false;
  zoom = v;
  applyZoom();
}

function fitToScreen() {
  autoFit = true;
  applyZoom();
}

// ── 내보내기/불러오기/초기화 ───────────────────────
function exportJson() {
  const clean = JSON.parse(JSON.stringify(state));
  // 계산 임시값 제거
  for (const p of clean.people) { delete p._row; delete p._col; }
  const json = JSON.stringify(clean, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'family.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importJsonFile(file) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (!parsed || !Array.isArray(parsed.people)) throw new Error('형식이 올바르지 않아요');
      state = migrate(parsed);
      if (!state.perspective) state.perspective = 'A';
      const radio = document.querySelector(`input[name="perspective"][value="${state.perspective}"]`);
      if (radio) radio.checked = true;
      syncSpouseParents();
      saveLocal();
      render();
    } catch (err) {
      alert('JSON 파싱 실패: ' + err.message);
    }
  };
  reader.readAsText(file);
}

async function refreshFromServer() {
  const remote = await fetchFromServer();
  if (!remote) { alert('서버에서 데이터를 가져오지 못했어요. (오프라인이거나 서버 오류)'); return; }
  state = migrate(remote);
  if (!state.perspective) state.perspective = 'A';
  const radio = document.querySelector(`input[name="perspective"][value="${state.perspective}"]`);
  if (radio) radio.checked = true;
  syncSpouseParents();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  render();
  setSyncStatus(getEditToken() ? 'saved' : 'readonly');
}

function resetAll() {
  if (!confirm('모든 카드를 지우고 초기 상태(나·아내)로 돌아갈까요? localStorage 도 비웁니다.')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = INITIAL_STATE();
  document.querySelector('input[name="perspective"][value="A"]').checked = true;
  saveLocal();
  render();
}

// ── 부팅 ─────────────────────────────────────────
(async function init() {
  state = await loadInitial();
  if (!state.perspective) state.perspective = 'A';
  const radio = document.querySelector(`input[name="perspective"][value="${state.perspective}"]`);
  if (radio) radio.checked = true;
  // 기존 localStorage 데이터가 불일치 상태일 수 있으므로 동기화 한 번 수행 (예: 한쪽 부모만 가진 자식 → 양쪽 부모)
  syncSpouseParents();
  updateEditUI();
  // 로드 직후 saveLocal 호출 시 서버를 덮어쓰지 않도록 — 로컬만 저장하고 끝
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  render();

  document.querySelectorAll('input[name="perspective"]').forEach(r => {
    r.onchange = (e) => { if (e.target.checked) setPerspective(e.target.value); };
  });
  document.getElementById('btnExport').onclick = exportJson;
  document.getElementById('btnReset').onclick  = resetAll;
  document.getElementById('btnEdit').onclick   = promptEditToken;
  document.getElementById('btnRefresh').onclick = refreshFromServer;
  document.getElementById('fileImport').onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importJsonFile(f);
    e.target.value = '';
  };
  document.getElementById('zoomRange').oninput = (e) => setZoom(parseFloat(e.target.value));
  document.getElementById('btnFit').onclick    = fitToScreen;
  window.addEventListener('resize', () => { if (autoFit) applyZoom(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && parentMode) exitParentMode();
    if (e.key === 'Escape' && drag) {
      // 드래그 취소
      drag.dropTarget = null;
      drag.dropZone = null;
      onDragEnd(e);
    }
  });
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup',  onDragEnd);
})();
