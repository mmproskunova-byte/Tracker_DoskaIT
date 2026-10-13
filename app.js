'use strict';

/* ============================================================
   FlowBoard — трекер задач команды (MVP)
   Роли, канбан-доска, правила переходов, уведомления
   ============================================================ */

/* ---------- Справочники ---------- */

const ROLE_LABELS = {
  pm: 'PM (администратор)',
  dev: 'Разработчик',
  qa: 'Тестировщик',
  client: 'Заказчик',
};

const ROLE_SHORT = { pm: 'PM', dev: 'Разработчик', qa: 'Тестировщик', client: 'Заказчик' };

const COLUMNS = [
  { id: 'backlog', title: 'Бэклог', hint: 'без исполнителя и срока' },
  { id: 'work', title: 'В работе', hint: 'исполнитель и срок' },
  { id: 'review', title: 'На ревью', hint: 'ждёт проверки PM' },
  { id: 'testing', title: 'Тестирование', hint: 'передано тестировщику' },
  { id: 'done', title: 'Готово', hint: 'протестировано и принято' },
];

const PRIORITIES = {
  high: { label: 'Высокий', cls: 'prio-high' },
  mid: { label: 'Средний', cls: 'prio-mid' },
  low: { label: 'Низкий', cls: 'prio-low' },
};

/* Правила переходов (ТЗ, раздел 4).
   roles: 'pm' | 'qa' | 'assignee' (только исполнитель задачи)       */
const TRANSITIONS = [
  { from: 'backlog', to: 'work',    roles: ['pm'],             backward: false, needAssignee: true,
    label: 'В работу',        denied: 'Только PM назначает исполнителя' },
  { from: 'work',    to: 'review',  roles: ['assignee'],       backward: false,
    label: 'На ревью',        denied: 'Только исполнитель задачи' },
  { from: 'review',  to: 'testing', roles: ['pm'],             backward: false,
    label: 'В тестирование',  denied: 'Доступно только PM' },
  { from: 'testing', to: 'done',    roles: ['qa'],             backward: false,
    label: 'Принять (готово)', denied: 'Доступно только тестировщику' },
  { from: 'testing', to: 'work',    roles: ['qa', 'pm'],       backward: true, bug: true,
    label: 'Вернуть с багом', denied: 'Доступно тестировщику и PM' },
  { from: 'review',  to: 'work',    roles: ['pm', 'assignee'], backward: true,
    label: 'Вернуть на доработку', denied: 'Доступно PM и исполнителю' },
  { from: 'work',    to: 'backlog', roles: ['pm'],             backward: true,
    label: 'Вернуть в бэклог', denied: 'Доступно только PM' },
  { from: 'done',    to: 'testing', roles: ['pm', 'qa'],       backward: true,
    label: 'Вернуть в тестирование', denied: 'Доступно PM и тестировщику' },
];

const STORAGE_KEY = 'flowboard_v1';

/* ---------- Иконки (тонкие линейные, stroke 1.5) ---------- */

const ICON_PATHS = {
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
};

function icon(name, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

/* ---------- Состояние ---------- */

let state = null;
let searchQuery = '';

function seedState() {
  const day = 86400000;
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const stamp = (daysAgo, hour = 10) => {
    const d = new Date(now - daysAgo * day);
    d.setHours(hour, 24, 0, 0);
    return d.toISOString();
  };

  const users = [
    { id: 'u1', name: 'Анна Смирнова', role: 'pm' },
    { id: 'u2', name: 'Игорь Петров', role: 'dev' },
    { id: 'u3', name: 'Мария Волкова', role: 'dev' },
    { id: 'u4', name: 'Олег Кузнецов', role: 'qa' },
    { id: 'u5', name: 'Сергей Директор', role: 'client' },
  ];

  const tasks = [
    { id: 1, title: 'Рефакторинг модуля авторизации', desc: 'Перевести сессии на новые токены, убрать legacy-код.',
      priority: 'high', assigneeId: 'u2', deadline: iso(now + 3 * day), column: 'work',
      createdAt: stamp(4), comments: [] },
    { id: 2, title: 'Дизайн-макеты онбординга', desc: 'Три экрана первого запуска по гайдлайнам.',
      priority: 'mid', assigneeId: 'u3', deadline: iso(now + 1 * day), column: 'work',
      createdAt: stamp(5), comments: [] },
    { id: 3, title: 'Настроить CI/CD пайплайн', desc: 'Автосборка и автотесты на каждый pull request.',
      priority: 'high', assigneeId: 'u2', deadline: iso(now - 1 * day), column: 'work',
      createdAt: stamp(8), comments: [] },
    { id: 4, title: 'Личный кабинет: API', desc: 'CRUD для профиля и список обращений.',
      priority: 'mid', assigneeId: 'u3', deadline: iso(now + 2 * day), column: 'review',
      createdAt: stamp(7), comments: [] },
    { id: 5, title: 'Регрессионное тестирование релиза 1.4', desc: 'Проверить критичные сценарии оплаты.',
      priority: 'mid', assigneeId: 'u4', deadline: iso(now + 2 * day), column: 'testing',
      createdAt: stamp(6), comments: [] },
    { id: 6, title: 'Мобильная адаптация таблиц', desc: 'Сломался скролл на iOS Safari.',
      priority: 'high', assigneeId: 'u4', deadline: iso(now + 1 * day), column: 'testing',
      createdAt: stamp(9),
      comments: [{ id: 'c1', authorId: 'u4', text: 'Баг: горизонтальный скролл таблицы не работает на iOS 17, контент обрезается. Шаги: открыть раздел «Отчёты” → повернуть экран.',
        bug: true, at: stamp(1, 15) }] },
    { id: 7, title: 'Редизайн лендинга', desc: 'Новый герой-блок и секция с тарифами.',
      priority: 'mid', assigneeId: 'u3', deadline: iso(now - 4 * day), column: 'done',
      createdAt: stamp(15), comments: [] },
    { id: 8, title: 'Релиз 1.3', desc: 'Пакет исправлений и обновление документации.',
      priority: 'low', assigneeId: 'u2', deadline: iso(now - 7 * day), column: 'done',
      createdAt: stamp(20), comments: [] },
    { id: 9, title: 'Интеграция с 1С: выгрузка счетов', desc: 'Формат обмена пока не согласован.',
      priority: 'low', assigneeId: null, deadline: null, column: 'backlog',
      createdAt: stamp(3), comments: [] },
    { id: 10, title: 'Чат-бот в Telegram для уведомлений', desc: '',
      priority: 'low', assigneeId: null, deadline: null, column: 'backlog',
      createdAt: stamp(2), comments: [] },
    { id: 11, title: 'Расширенная аналитика по задачам', desc: 'Воронка по колонкам и время в работе.',
      priority: 'mid', assigneeId: null, deadline: null, column: 'backlog',
      createdAt: stamp(1), comments: [] },
  ];

  return {
    users,
    tasks,
    notifications: [
      { id: 'n1', userId: 'u1', text: 'Мария Волкова: задача «Личный кабинет: API» отправлена на ревью.', taskId: 4, at: stamp(0, 9), read: false },
      { id: 'n2', userId: 'u1', text: 'Олег Кузнецов: в задаче «Мобильная адаптация таблиц» оставлен баг-репорт.', taskId: 6, at: stamp(1, 15), read: false },
    ],
    nextTaskId: 12,
    currentUserId: 'u1',
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.tasks) && Array.isArray(parsed.users)) { state = parsed; return; }
    }
  } catch (e) { /* повреждённые данные — пересоздаём */ }
  state = seedState();
  save();
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* приватный режим */ }
}

function resetDemo() {
  state = seedState();
  save();
  renderAll();
  toast('Демо-данные сброшены', 'ok');
}

/* ---------- Утилиты ---------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function currentUser() {
  return state.users.find((u) => u.id === state.currentUserId) || state.users[0];
}

function userById(id) { return state.users.find((u) => u.id === id) || null; }

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function columnTitle(id) {
  const c = COLUMNS.find((x) => x.id === id);
  return c ? c.title : id;
}

function fmtDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr + (isoStr.length === 10 ? 'T00:00:00' : ''));
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** Сколько дней осталось до дедлайна (0 — сегодня, <0 — просрочен) */
function daysLeft(deadline) {
  if (!deadline) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dl = new Date(deadline + 'T00:00:00');
  return Math.round((dl - today) / 86400000);
}

/** Подсветка красным: за 1 день до дедлайна или просрочен (ТЗ, раздел 5) */
function dueInfo(task) {
  if (!task.deadline || task.column === 'done') return { due: false };
  const left = daysLeft(task.deadline);
  if (left > 1) return { due: false, left };
  let label;
  if (left < 0) label = left === -1 ? 'просрочен 1 день' : `просрочен ${-left} дн.`;
  else if (left === 0) label = 'дедлайн сегодня';
  else label = 'дедлайн завтра';
  return { due: true, left, label };
}

/* ---------- Права и видимость ---------- */

/** Видит ли пользователь задачу */
function canSee(user, task) {
  switch (user.role) {
    case 'pm':
      return true;
    case 'client':
      return task.column === 'done';   // заказчик видит только «Готово» + сводку
    case 'dev':
      return task.assigneeId === user.id || (task.column === 'backlog' && !task.assigneeId);
    case 'qa':
      return task.column === 'testing' || task.assigneeId === user.id;
    default:
      return false;
  }
}

/** Колонки, показываемые пользователю */
function visibleColumns(user) {
  return user.role === 'client' ? COLUMNS.filter((c) => c.id === 'done') : COLUMNS;
}

function matchesSearch(task) {
  if (!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  return task.title.toLowerCase().includes(q) || (task.desc || '').toLowerCase().includes(q);
}

function visibleTasks(user) {
  return state.tasks.filter((t) => canSee(user, t) && matchesSearch(t));
}

function tasksInColumn(user, colId) {
  return visibleTasks(user).filter((t) => t.column === colId);
}

/** Проверка права на конкретный переход */
function checkTransition(user, task, tr) {
  if (user.role === 'client') return { allowed: false, reason: 'Заказчик может только просматривать доску' };

  const isAssignee = !!task.assigneeId && task.assigneeId === user.id;
  const roleOk = tr.roles.includes(user.role) || (tr.roles.includes('assignee') && isAssignee);

  if (!roleOk) {
    if (tr.roles.includes('assignee')) return { allowed: false, reason: 'Только исполнитель этой задачи' };
    if (tr.roles.includes('pm')) return { allowed: false, reason: 'Только PM' };
    if (tr.roles.includes('qa')) return { allowed: false, reason: 'Только тестировщик' };
    return { allowed: false, reason: tr.denied || 'Нет прав на этот переход' };
  }
  return { allowed: true };
}

/** Есть ли у пользователя хотя бы один доступный переход из колонки задачи */
function canDrag(user, task) {
  return TRANSITIONS.some((tr) => tr.from === task.column && checkTransition(user, task, tr).allowed);
}

function canComment(user, task) {
  if (user.role === 'client') return false;
  return canSee(user, task);
}

function canEdit(user) { return user.role === 'pm'; }

/* ---------- Уведомления ---------- */

function notify(userId, text, taskId) {
  state.notifications.unshift({
    id: 'n' + Date.now() + Math.random().toString(36).slice(2, 6),
    userId, text, taskId: taskId ?? null, at: new Date().toISOString(), read: false,
  });
}

/** Уведомить всех, кроме текущего пользователя; текущему — тост */
function notifyOthers(userIds, text, taskId) {
  const me = state.currentUserId;
  const targets = [...new Set(userIds)].filter(Boolean).filter((id) => id !== me);
  targets.forEach((id) => notify(id, text, taskId));
  if (targets.length) {
    const names = targets.map((id) => (userById(id) || {}).name).join(', ');
    toast(`Уведомление отправлено: ${names}`, 'ok');
  }
}

/** Напоминание о дедлайне (за 1 день) — один раз на срок */
function checkDeadlineNotifications() {
  let changed = false;
  const today = new Date().toISOString().slice(0, 10);
  state.tasks.forEach((t) => {
    if (!t.deadline || t.column === 'done') return;
    const left = daysLeft(t.deadline);
    if (left > 1) return;
    if (t.dueNotified === t.deadline + '@' + today) return;
    t.dueNotified = t.deadline + '@' + today;
    changed = true;
    const label = left < 0 ? 'дедлайн просрочен' : left === 0 ? 'дедлайн сегодня' : 'дедлайн завтра';
    const targets = [t.assigneeId, state.users.find((u) => u.role === 'pm')?.id];
    targets.filter(Boolean).forEach((id) =>
      notify(id, `Приближается дедлайн: «${t.title}» — ${label} (${fmtDate(t.deadline)}).`, t.id));
  });
  if (changed) save();
}

function unreadCount() {
  return state.notifications.filter((n) => n.userId === state.currentUserId && !n.read).length;
}

/* ---------- Тосты ---------- */

function toast(text, type = 'info') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'info' ? '' : ' ' + type);
  el.textContent = text;
  el.title = 'Нажмите, чтобы закрыть';
  el.addEventListener('click', () => el.remove());
  box.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/* ============================================================
   РЕНДЕР
   ============================================================ */

function renderAll() {
  renderHeader();
  renderSummary();
  renderToolbar();
  renderBoard();
}

function renderHeader() {
  const user = currentUser();
  document.getElementById('userAvatar').textContent = initials(user.name);
  document.getElementById('userName').textContent = user.name;
  document.getElementById('userRole').textContent = ROLE_SHORT[user.role];

  const badge = document.getElementById('bellBadge');
  const unread = unreadCount();
  badge.hidden = unread === 0;
  badge.textContent = unread > 9 ? '9+' : String(unread);
}

function renderSummary() {
  const user = currentUser();
  // Заказчику и PM — сводка по всем задачам; остальным — по видимым
  const scope = (user.role === 'client' || user.role === 'pm')
    ? state.tasks : visibleTasks(user);

  const overdue = scope.filter((t) => {
    const d = dueInfo(t);
    return d.due && d.left < 0;
  }).length;

  const chips = COLUMNS.map((c) => {
    const n = scope.filter((t) => t.column === c.id).length;
    return `<span class="chip chip-${c.id}"><span class="dot"></span>${esc(c.title)} <b>${n}</b></span>`;
  }).join('');

  const overdueChip = overdue
    ? `<span class="chip is-overdue"><span class="dot"></span>Просрочено <b>${overdue}</b></span>` : '';

  document.getElementById('summary').innerHTML =
    `<span class="summary-label">Сводка по статусам</span>${chips}${overdueChip}`;
}

function renderToolbar() {
  const user = currentUser();
  const hints = {
    pm: 'Вы видите все задачи, колонки и пользователей. Создавайте задачи, назначайте исполнителей, ведите доску.',
    dev: 'Вы видите свои задачи и общий бэклог. Свою задачу из «В работе» можно отправить «На ревью».',
    qa: 'Вы видите задачи в колонке «Тестирование» и назначенные вам. Возврат с багом — только с комментарием.',
    client: 'Режим просмотра: колонка «Готово» и сводка по статусам. Редактирование недоступно.',
  };
  document.getElementById('roleHint').textContent = hints[user.role];
  document.getElementById('newTaskBtn').hidden = user.role !== 'pm';
}

function cardHTML(task, user) {
  const p = PRIORITIES[task.priority] || PRIORITIES.mid;
  const d = dueInfo(task);
  const assignee = userById(task.assigneeId);
  const commentCount = task.comments.filter((c) => !c.bug).length;
  const bugCount = task.comments.filter((c) => c.bug).length;

  const assigneeHTML = assignee
    ? `<span class="card-assignee"><span class="avatar sm">${esc(initials(assignee.name))}</span>${esc(assignee.name)}</span>`
    : `<span class="card-assignee">${icon('user', 14)}Не назначен</span>`;

  const deadlineHTML = task.deadline
    ? `<span class="meta${d.due ? ' due' : ''}">${icon('calendar', 14)}${fmtDate(task.deadline)}${d.due ? ' · ' + d.label : ''}</span>`
    : `<span class="meta">${icon('calendar', 14)}Без срока</span>`;

  const commentsHTML = (commentCount || bugCount)
    ? `<span class="meta">${icon('message', 14)}${commentCount + bugCount}${bugCount ? ` <span style="color:var(--prio-high)">(${bugCount} баг)</span>` : ''}</span>`
    : '';

  return `
    <article class="card${d.due ? ' is-due' : ''}" data-task="${task.id}"
             draggable="${canDrag(user, task)}" tabindex="0"
             aria-label="${esc(task.title)}">
      <div class="card-top">
        <span class="prio ${p.cls}"><span class="dot"></span>${p.label}</span>
        <span class="card-id">ФБ-${task.id}</span>
      </div>
      <h3 class="card-title">${esc(task.title)}</h3>
      ${task.desc ? `<p class="card-desc">${esc(task.desc)}</p>` : ''}
      <div class="card-meta">
        ${assigneeHTML}
        ${deadlineHTML}
        ${commentsHTML}
      </div>
    </article>`;
}

function renderBoard() {
  const user = currentUser();
  const cols = visibleColumns(user);
  const board = document.getElementById('board');

  board.innerHTML = cols.map((col) => {
    const list = tasksInColumn(user, col.id);
    const cards = list.length
      ? list.map((t) => cardHTML(t, user)).join('')
      : `<div class="column-empty">${searchQuery ? 'Ничего не найдено' : 'Пока пусто'}</div>`;
    return `
      <section class="column" data-col="${col.id}">
        <div class="column-head">
          <span class="column-title">${esc(col.title)}</span>
          <span class="column-count">${list.length}</span>
        </div>
        <div class="column-cards">${cards}</div>
      </section>`;
  }).join('');

  wireBoard();
}

/* ---------- Drag & Drop ---------- */

function wireBoard() {
  const board = document.getElementById('board');

  board.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', () => openTaskModal(Number(card.dataset.task)));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTaskModal(Number(card.dataset.task)); }
    });
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.task);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });

  board.querySelectorAll('.column').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-active'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop-active'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drop-active');
      const id = Number(e.dataTransfer.getData('text/plain'));
      const task = state.tasks.find((t) => t.id === id);
      if (task) attemptMove(task, col.dataset.col);
    });
  });
}

/* ============================================================
   ПЕРЕХОДЫ МЕЖДУ КОЛОНКАМИ
   ============================================================ */

function attemptMove(task, toCol) {
  if (task.column === toCol) return;
  const user = currentUser();
  const tr = TRANSITIONS.find((t) => t.from === task.column && t.to === toCol);

  if (!tr) { toast('Такой переход не предусмотрен правилами', 'error'); return; }

  const res = checkTransition(user, task, tr);
  if (!res.allowed) { toast(res.reason, 'error'); return; }

  if (tr.needAssignee && !task.assigneeId) { openAssignModal(task, tr); return; }
  if (tr.backward) { openCommentModal(task, tr); return; }

  applyMove(task, tr, null);
}

function applyMove(task, tr, comment) {
  const user = currentUser();
  const from = task.column;
  const colFrom = columnTitle(from);
  const colTo = columnTitle(tr.to);

  if (comment) {
    task.comments.push({
      id: 'c' + Date.now(), authorId: user.id, text: comment.text,
      bug: !!comment.bug, at: new Date().toISOString(),
    });
  }

  task.column = tr.to;

  // «Бэклог» по определению — без исполнителя и срока
  if (tr.to === 'backlog') { task.assigneeId = null; task.deadline = null; }

  const title = `«${task.title}»`;
  const pm = state.users.find((u) => u.role === 'pm');

  if (tr.from === 'backlog') {
    // назначение исполнителя — уведомление пользователю (ТЗ, раздел 5)
    notifyOthers([task.assigneeId], `Вам назначена задача ${title} — колонка «${colTo}», срок ${fmtDate(task.deadline)}.`, task.id);
  } else if (tr.to === 'done') {
    notifyOthers([task.assigneeId, pm?.id], `Задача ${title} принята и закрыта.`, task.id);
  } else if (tr.bug) {
    notifyOthers([task.assigneeId, pm?.id], `Задача ${title} возвращена из «${colFrom}» в «${colTo}» с багом.`, task.id);
  } else if (tr.to === 'review') {
    notifyOthers([pm?.id], `Задача ${title} отправлена на ревью (исполнитель: ${user.name}).`, task.id);
  } else if (tr.to === 'testing') {
    const qa = state.users.filter((u) => u.role === 'qa').map((u) => u.id);
    notifyOthers([...qa, task.assigneeId], `Задача ${title} передана в тестирование.`, task.id);
  } else if (tr.backward) {
    notifyOthers([task.assigneeId, pm?.id], `Задача ${title} перемещена: «${colFrom}» → «${colTo}».`, task.id);
  }

  save();
  renderAll();
  toast(`Задача перемещена: ${colFrom} → ${colTo}`, 'ok');
}

/* ============================================================
   МОДАЛЬНЫЕ ОКНА
   ============================================================ */

const overlay = document.getElementById('overlay');
const dialog = document.getElementById('dialog');

function openDialog(html, onMount, tone) {
  dialog.innerHTML = html;
  dialog.dataset.tone = tone || '';      // оттенок колонки для окна задачи
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeDialog));
  if (onMount) onMount(dialog);
  const first = dialog.querySelector('input, textarea, select, button:not([data-close])');
  if (first) first.focus();
}

function closeDialog() {
  overlay.hidden = true;
  dialog.innerHTML = '';
  dialog.dataset.tone = '';
  document.body.style.overflow = '';
}

overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeDialog(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeDialog(); closePopovers(); }
});

function headHTML(kicker, title) {
  return `
    <div class="dialog-head">
      <div>
        <div class="dialog-kicker">${kicker}</div>
        <h2>${esc(title)}</h2>
      </div>
      <button class="icon-btn" data-close aria-label="Закрыть">${icon('x', 18)}</button>
    </div>`;
}

/* ---------- Форма задачи (создание / редактирование) ---------- */

function taskFormFields(task) {
  const assigneeOptions = state.users
    .filter((u) => u.role !== 'client')
    .map((u) => `<option value="${u.id}" ${task.assigneeId === u.id ? 'selected' : ''}>${esc(u.name)} — ${ROLE_SHORT[u.role]}</option>`)
    .join('');

  return `
    <div class="field">
      <label for="fTitle">Название <span class="req">*</span></label>
      <input id="fTitle" type="text" maxlength="120" value="${esc(task.title)}" placeholder="Что нужно сделать">
    </div>
    <div class="field">
      <label for="fDesc">Описание</label>
      <textarea id="fDesc" maxlength="2000" placeholder="Детали, ссылки, критерии готовности (необязательно)">${esc(task.desc)}</textarea>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="fPrio">Приоритет</label>
        <select id="fPrio">
          ${Object.entries(PRIORITIES).map(([k, v]) =>
            `<option value="${k}" ${task.priority === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="fDeadline">Дедлайн</label>
        <input id="fDeadline" type="date" value="${task.deadline || ''}">
        <div class="help">Без дедлайна задача останется в бэклоге.</div>
      </div>
    </div>
    <div class="field">
      <label for="fAssignee">Исполнитель</label>
      <select id="fAssignee">
        <option value="">— не назначен (бэклог) —</option>
        ${assigneeOptions}
      </select>
      <div class="help">С исполнителем и сроком задача сразу уйдёт в «В работу» — пользователь получит уведомление.</div>
    </div>
    <div class="form-error" id="formError" hidden></div>`;
}

function readTaskForm() {
  return {
    title: document.getElementById('fTitle').value.trim(),
    desc: document.getElementById('fDesc').value.trim(),
    priority: document.getElementById('fPrio').value,
    assigneeId: document.getElementById('fAssignee').value || null,
    deadline: document.getElementById('fDeadline').value || null,
  };
}

function showFormError(msg) {
  const box = document.getElementById('formError');
  box.textContent = msg;
  box.hidden = false;
}

function openCreateModal() {
  const draft = { title: '', desc: '', priority: 'mid', assigneeId: null, deadline: null };
  openDialog(`
    ${headHTML('Новая задача', 'Создание задачи')}
    <form id="taskForm" novalidate>${taskFormFields(draft)}</form>
    <div class="dialog-actions">
      <button class="btn btn-ghost" data-close type="button">Отмена</button>
      <button class="btn btn-primary" id="saveBtn" type="button">Создать задачу</button>
    </div>`, (root) => {
    root.querySelector('#saveBtn').addEventListener('click', () => {
      const data = readTaskForm();
      if (!data.title) { showFormError('Название задачи — обязательно.'); return; }
      if (!!data.assigneeId !== !!data.deadline) {
        showFormError('Укажите и исполнителя, и дедлайн вместе — либо оставьте оба поля пустыми (тогда задача останется в бэклоге).');
        return;
      }
      const task = {
        id: state.nextTaskId++, ...data,
        column: data.assigneeId ? 'work' : 'backlog',
        createdAt: new Date().toISOString(), comments: [],
      };
      state.tasks.push(task);
      if (task.assigneeId) {
        notifyOthers([task.assigneeId],
          `Вам назначена задача «${task.title}» — колонка «${columnTitle(task.column)}», срок ${fmtDate(task.deadline)}.`, task.id);
      }
      save(); closeDialog(); renderAll();
      toast(`Задача ФБ-${task.id} создана`, 'ok');
    });
  });
}

function openEditModal(task) {
  openDialog(`
    ${headHTML(`Редактирование · ФБ-${task.id}`, task.title)}
    <form id="taskForm" novalidate>${taskFormFields(task)}</form>
    <div class="dialog-actions">
      <button class="btn btn-ghost" data-close type="button">Отмена</button>
      <button class="btn btn-primary" id="saveBtn" type="button">Сохранить</button>
    </div>`, (root) => {
    root.querySelector('#saveBtn').addEventListener('click', () => {
      const data = readTaskForm();
      if (!data.title) { showFormError('Название задачи — обязательно.'); return; }
      if (!!data.assigneeId !== !!data.deadline) {
        showFormError('Укажите и исполнителя, и дедлайн вместе — либо оставьте оба поля пустыми.');
        return;
      }
      const assigneeChanged = task.assigneeId !== data.assigneeId;
      Object.assign(task, data);

      // Колонка следует за наличием исполнителя и срока
      if (!data.assigneeId) task.column = 'backlog';
      else if (task.column === 'backlog') task.column = 'work';

      if (assigneeChanged && data.assigneeId) {
        notifyOthers([data.assigneeId],
          `Вам назначена задача «${task.title}» — колонка «${columnTitle(task.column)}», срок ${fmtDate(task.deadline)}.`, task.id);
      }
      save(); closeDialog(); renderAll();
      toast('Задача обновлена', 'ok');
    });
  });
}

function openDeleteModal(task) {
  openDialog(`
    ${headHTML(`Удаление · ФБ-${task.id}`, 'Удалить задачу?')}
    <p class="dialog-sub">Задача «${esc(task.title)}» и её комментарии будут удалены безвозвратно.</p>
    <div class="dialog-actions">
      <button class="btn btn-ghost" data-close type="button">Отмена</button>
      <button class="btn btn-danger-ghost" id="delBtn" type="button">${icon('trash')} Удалить</button>
    </div>`, (root) => {
    root.querySelector('#delBtn').addEventListener('click', () => {
      state.tasks = state.tasks.filter((t) => t.id !== task.id);
      save(); closeDialog(); renderAll();
      toast('Задача удалена', 'ok');
    });
  });
}

/* ---------- Назначение исполнителя при переходе «Бэклог → В работу» ---------- */

function openAssignModal(task, tr) {
  const assigneeOptions = state.users
    .filter((u) => u.role === 'dev' || u.role === 'qa')
    .map((u) => `<option value="${u.id}">${esc(u.name)} — ${ROLE_SHORT[u.role]}</option>`)
    .join('');

  openDialog(`
    ${headHTML(`ФБ-${task.id} · Бэклог → В работу`, task.title)}
    <p class="dialog-sub">По правилам только PM назначает исполнителя. Укажите исполнителя и срок — задача перейдёт в «В работу».</p>
    <div class="field">
      <label for="fAssignee">Исполнитель <span class="req">*</span></label>
      <select id="fAssignee"><option value="">— выберите —</option>${assigneeOptions}</select>
    </div>
    <div class="field">
      <label for="fDeadline">Дедлайн <span class="req">*</span></label>
      <input id="fDeadline" type="date" value="${task.deadline || ''}">
    </div>
    <div class="form-error" id="formError" hidden></div>
    <div class="dialog-actions">
      <button class="btn btn-ghost" data-close type="button">Отмена</button>
      <button class="btn btn-primary" id="assignBtn" type="button">Назначить и переместить</button>
    </div>`, (root) => {
    root.querySelector('#assignBtn').addEventListener('click', () => {
      const assigneeId = root.querySelector('#fAssignee').value;
      const deadline = root.querySelector('#fDeadline').value;
      if (!assigneeId || !deadline) { showFormError('Исполнитель и дедлайн обязательны для колонки «В работе».'); return; }
      task.assigneeId = assigneeId;
      task.deadline = deadline;
      closeDialog();
      applyMove(task, tr, null);
    });
  }, tr.to);
}

/* ---------- Обязательный комментарий при возврате назад ---------- */

function openCommentModal(task, tr) {
  const isBug = !!tr.bug;
  openDialog(`
    ${headHTML(`ФБ-${task.id} · Возврат`, `${columnTitle(tr.from)} → ${columnTitle(tr.to)}`)}
    <p class="dialog-sub">Возврат назад требует обязательного комментария${isBug ? ' с описанием бага' : ''}.</p>
    <div class="field">
      <label for="fComment">Комментарий <span class="req">*</span></label>
      <textarea id="fComment" maxlength="2000"
        placeholder="${isBug ? 'Опишите баг: что произошло, шаги воспроизведения, ожидаемое поведение' : 'Причина возврата'}"></textarea>
    </div>
    <div class="form-error" id="formError" hidden></div>
    <div class="dialog-actions">
      <button class="btn btn-ghost" data-close type="button">Отмена</button>
      <button class="btn btn-primary" id="moveBtn" type="button">${esc(tr.label)}</button>
    </div>`, (root) => {
    root.querySelector('#moveBtn').addEventListener('click', () => {
      const text = root.querySelector('#fComment').value.trim();
      if (!text) { showFormError('Комментарий обязателен при возврате назад.'); return; }
      closeDialog();
      applyMove(task, tr, { text, bug: isBug });
    });
  }, tr.to);
}

/* ---------- Просмотр задачи ---------- */

function openTaskModal(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const user = currentUser();
  if (!canSee(user, task)) { toast('Задача вам недоступна', 'error'); return; }

  const p = PRIORITIES[task.priority] || PRIORITIES.mid;
  const assignee = userById(task.assigneeId);
  const d = dueInfo(task);

  const moves = TRANSITIONS.filter((tr) => tr.from === task.column).map((tr) => {
    const res = checkTransition(user, task, tr);
    if (res.allowed) {
      return `<button class="btn btn-ghost move-btn" data-move="${tr.to}">${esc(tr.label)} ${icon('arrow', 15)}</button>`;
    }
    return `<div class="move-item locked">
        <button class="btn btn-ghost" disabled>${icon('lock', 15)} ${esc(tr.label)}</button>
        <span class="help">${esc(res.reason)}</span>
      </div>`;
  }).join('');

  const commentForm = canComment(user, task) ? `
    <div class="comment-form">
      <textarea id="cText" maxlength="2000" placeholder="Добавить комментарий…"></textarea>
      <div class="row">
        <button class="btn btn-primary" id="cSend" type="button">Отправить</button>
        <span class="help">Комментарии видят все участники задачи.</span>
      </div>
    </div>` : `<p class="dialog-sub" style="margin-top:10px">${user.role === 'client' ? 'Просмотр без редактирования.' : ''}</p>`;

  const commentsHTML = task.comments.length
    ? task.comments.map((c) => {
        const a = userById(c.authorId);
        return `
          <div class="comment${c.bug ? ' bug' : ''}">
            <span class="avatar sm">${esc(initials(a ? a.name : '?'))}</span>
            <div class="comment-body">
              <div class="comment-head">
                <b>${esc(a ? a.name : 'Удалённый пользователь')}</b>
                <time>${fmtDateTime(c.at)}</time>
                ${c.bug ? `<span class="prio prio-high"><span class="dot"></span>баг</span>` : ''}
              </div>
              <p>${esc(c.text)}</p>
            </div>
          </div>`;
      }).join('')
    : '<p class="dialog-sub">Комментариев пока нет.</p>';

  openDialog(`
    ${headHTML(`ФБ-${task.id} · ${esc(columnTitle(task.column))}`, task.title)}
    <div class="detail-grid">
      <div class="detail-cell">
        <label>Приоритет</label>
        <div class="value"><span class="prio ${p.cls}"><span class="dot"></span>${p.label}</span></div>
      </div>
      <div class="detail-cell">
        <label>Исполнитель</label>
        <div class="value">${assignee
          ? `<span class="avatar sm">${esc(initials(assignee.name))}</span>${esc(assignee.name)}`
          : 'Не назначен'}</div>
      </div>
      <div class="detail-cell">
        <label>Дедлайн</label>
        <div class="value${d.due ? ' due' : ''}">${icon('calendar', 15)}${task.deadline ? fmtDate(task.deadline) : '—'}${d.due ? ` · ${d.label}` : ''}</div>
      </div>
      <div class="detail-cell">
        <label>Создано</label>
        <div class="value">${icon('clock', 15)}${fmtDateTime(task.createdAt)}</div>
      </div>
    </div>

    <div class="detail-desc${task.desc ? '' : ' empty'}">${task.desc ? esc(task.desc) : 'Описание не заполнено'}</div>

    ${user.role !== 'client' ? `<div class="section-title">Переместить</div><div class="moves">${moves}</div>` : ''}

    <div class="section-title">Комментарии</div>
    ${commentsHTML}
    ${commentForm}

    <div class="dialog-actions">
      ${canEdit(user) ? `
        <button class="btn btn-ghost spacer" id="editBtn" type="button">${icon('edit')} Редактировать</button>
        <button class="btn btn-danger-ghost" id="delBtn" type="button">${icon('trash')} Удалить</button>` : ''}
      <button class="btn btn-ghost" data-close type="button">Закрыть</button>
    </div>`, (root) => {

    root.querySelectorAll('[data-move]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const to = btn.dataset.move;
        closeDialog();
        attemptMove(task, to);
      });
    });

    const send = root.querySelector('#cSend');
    if (send) {
      send.addEventListener('click', () => {
        const box = root.querySelector('#cText');
        const text = box.value.trim();
        if (!text) { toast('Комментарий не может быть пустым', 'error'); return; }
        task.comments.push({ id: 'c' + Date.now(), authorId: user.id, text, bug: false, at: new Date().toISOString() });
        save();
        openTaskModal(task.id);   // перерисовываем то же окно
        renderBoard();
        renderSummary();
      });
    }

    const editBtn = root.querySelector('#editBtn');
    if (editBtn) editBtn.addEventListener('click', () => openEditModal(task));

    const delBtn = root.querySelector('#delBtn');
    if (delBtn) delBtn.addEventListener('click', () => openDeleteModal(task));
  }, task.column);
}

/* ============================================================
   ВЫПАДАЮЩИЕ ПАНЕЛИ: УВЕДОМЛЕНИЯ И ПОЛЬЗОВАТЕЛИ
   ============================================================ */

const bellBtn = document.getElementById('bellBtn');
const bellPop = document.getElementById('bellPop');
const userBtn = document.getElementById('userBtn');
const userPop = document.getElementById('userPop');

function closePopovers() {
  bellPop.hidden = true; userPop.hidden = true;
  bellBtn.setAttribute('aria-expanded', 'false');
  userBtn.setAttribute('aria-expanded', 'false');
}

function renderBell() {
  const list = state.notifications
    .filter((n) => n.userId === state.currentUserId)
    .slice(0, 12);

  const items = list.length ? list.map((n) => `
    <button class="pop-item" data-notif="${n.id}" data-task="${n.taskId ?? ''}">
      <span class="notif-dot${n.read ? ' read' : ''}"></span>
      <span class="pop-item-body">
        <small>${esc(n.text)}</small>
        <small style="margin-top:4px">${fmtDateTime(n.at)}</small>
      </span>
    </button>`).join('')
    : '<div class="pop-empty">Уведомлений пока нет</div>';

  bellPop.innerHTML = `
    <div class="pop-head">Уведомления</div>
    ${items}
    ${list.some((n) => !n.read) ? `<button class="pop-item" id="readAll"><span class="pop-item-body"><b>Прочитать все</b></span></button>` : ''}`;

  bellPop.querySelectorAll('[data-notif]').forEach((el) => {
    el.addEventListener('click', () => {
      const n = state.notifications.find((x) => x.id === el.dataset.notif);
      if (n) { n.read = true; save(); }
      closePopovers();
      renderHeader();
      if (el.dataset.task) openTaskModal(Number(el.dataset.task));
    });
  });

  const readAll = bellPop.querySelector('#readAll');
  if (readAll) readAll.addEventListener('click', () => {
    state.notifications.forEach((n) => { if (n.userId === state.currentUserId) n.read = true; });
    save(); renderHeader(); renderBell();
  });
}

function renderUserPop() {
  userPop.innerHTML = `
    <div class="pop-head">Войти как</div>
    ${state.users.map((u) => `
      <button class="pop-item${u.id === state.currentUserId ? ' is-current' : ''}" data-user="${u.id}">
        <span class="avatar sm">${esc(initials(u.name))}</span>
        <span class="pop-item-body">
          <b>${esc(u.name)}</b>
          <small>${ROLE_LABELS[u.role]}</small>
        </span>
        ${u.id === state.currentUserId ? icon('check', 16) : ''}
      </button>`).join('')}
    <button class="pop-item" id="resetBtn">
      <span class="pop-item-body"><b>Сбросить демо-данные</b><small>Вернуть исходное состояние доски</small></span>
    </button>`;

  userPop.querySelectorAll('[data-user]').forEach((el) => {
    el.addEventListener('click', () => {
      state.currentUserId = el.dataset.user;
      save(); closePopovers(); renderAll();
      const u = currentUser();
      toast(`Вы вошли как ${u.name} — ${ROLE_LABELS[u.role]}`, 'ok');
    });
  });

  userPop.querySelector('#resetBtn').addEventListener('click', () => {
    closePopovers();
    resetDemo();
  });
}

bellBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = bellPop.hidden;
  closePopovers();
  if (willOpen) { renderBell(); bellPop.hidden = false; bellBtn.setAttribute('aria-expanded', 'true'); }
});

userBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = userPop.hidden;
  closePopovers();
  if (willOpen) { renderUserPop(); userPop.hidden = false; userBtn.setAttribute('aria-expanded', 'true'); }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.pop-wrap')) closePopovers();
});

/* ---------- Прочие обработчики ---------- */

document.getElementById('newTaskBtn').addEventListener('click', openCreateModal);

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  renderBoard();
});

/* ---------- Запуск ---------- */

load();
checkDeadlineNotifications();
renderAll();
