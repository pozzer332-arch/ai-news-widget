/* ================================================================
   AI Widget — логика интерфейса
   Вкладка AI → [ Новости | Модели ]
   ================================================================ */

/* --- Режим предпросмотра: если открыть renderer/index.html
       в обычном браузере (без Electron), подставляем мок-API. --- */
if (typeof window.api === 'undefined') window.api = buildPreviewApi();

function buildPreviewApi() {
  const now = Date.now();
  const mk = (o) => Object.assign({ image: null, snippet: '' }, o);
  const DEMO = [
    mk({ id: '1', title: 'OpenAI показала GPT-5.2 с расширенной долгопамятью',
         snippet: 'Обновление увеличивает контекст до 512K токенов и добавляет устойчивую память между сессиями.',
         source: 'OpenAI', host: 'openai.com', link: 'https://openai.com/', ts: now - 12 * 60000, cat: 'models' }),
    mk({ id: '2', title: 'Учёные из MIT добились 98% точности прогнозирования структуры белков',
         snippet: 'Модель объединяет эволюционные данные и диффузионную генерацию — результаты опубликованы в Nature.',
         source: 'MIT Tech Review', host: 'technologyreview.com', link: 'https://www.technologyreview.com/', ts: now - 3 * 3600000, cat: 'research' }),
    mk({ id: '3', title: 'Стартапы в области ИИ привлекли $18,4 млрд за квартал — рекорд с 2021 года',
         snippet: 'Больше половины инвестиций ушло в инфраструктуру для обучения моделей.',
         source: 'TechCrunch', host: 'techcrunch.com', link: 'https://techcrunch.com/', ts: now - 5 * 3600000, cat: 'business' }),
  ];
  const data = () => ({ items: DEMO, updatedAt: Date.now(), ok: 11, failed: [], total: DEMO.length, stale: false });

  return {
    icons: async () => {
      try { return await (await fetch('../assets/icons/icons.json')).json(); } catch (_) { return {}; }
    },
    models: async () => {
      try {
        const r = await fetch('../models.json', { cache: 'no-store' });
        if (r.ok) return await r.json();
      } catch (_) {}
      return { updated: '', note: '', categories: [], items: [] };
    },
    rate: async () => ({ rate: 81.14, at: Date.now(), live: false, src: 'preview' }),
    news: data,
    refresh: data,
    onNews: () => {},
    getPrefs: async () => ({ theme: 'system', pinned: true, compact: false }),
    setPrefs: async (p) => p,
    onTheme: () => {},
    win: {
      minimize: () => { document.body.style.opacity = '.4'; setTimeout(() => (document.body.style.opacity = ''), 500); },
      close: () => { document.querySelector('.glass').style.animation = 'glassIn .4s reverse'; },
      toggleCompact: () => {
        const next = !document.documentElement.classList.contains('is-compact');
        document.documentElement.classList.toggle('is-compact', next);
        if (typeof state !== 'undefined') { state.compact = next; render(); }
      },
      setBounds: () => {},
      open: (url) => { if (url) window.open(url, '_blank', 'noopener'); },
      copy: async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch (_) { return false; } },
    },
    platform: 'preview',
  };
}

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------------- Категории новостей ---------------- */
const CATS = {
  all:      { label: 'Все',          color: '#64D2FF' },
  new:      { label: 'Новинки',      color: '#FF375F' },
  models:   { label: 'Модели',       color: '#0A84FF' },
  research: { label: 'Исследования', color: '#30D158' },
  business: { label: 'Бизнес',       color: '#FF9F0A' },
  tools:    { label: 'Инструменты',  color: '#BF5AF2' },
  industry: { label: 'Индустрия',    color: '#98989D' },
};
const NEWS_ORDER = ['all', 'new', 'models', 'research', 'business', 'tools'];
const ALL_COLOR = '#64D2FF';

const state = {
  icons: {},
  view: 'news',            // 'news' | 'models'
  filter: 'all',           // активный чип (общий для обеих вкладок)
  q: '',
  // новости
  items: [],
  updatedAt: 0,
  failed: [],
  okSources: 0,
  loading: true,
  stale: false,
  // модели
  models: [],
  modelCats: [],
  modelsUpdated: '',
  modelsNote: '',
  rate: 81,
  rateLive: false,
  // прочее
  theme: 'system',
  compact: false,
  pinned: true,
  heroIndex: 0,
};

/* ---------------- Утилиты ---------------- */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function two(n) { return n < 10 ? '0' + n : '' + n; }

function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return m + ' ' + plural(m, ['мин', 'мин', 'мин']);
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' ' + plural(h, ['ч', 'ч', 'ч']);
  const d = Math.floor(h / 24);
  if (d === 1) return 'вчера';
  if (d < 7) return d + ' ' + plural(d, ['день', 'дня', 'дней']);
  const dt = new Date(ts);
  return dt.getDate() + ' ' + MONTHS_SHORT[dt.getMonth()];
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (_) { return ''; }
}

/* Денежные форматы: USD — точные, RUB — округлённо, как в ценниках */
function money(n) {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  let s;
  if (v >= 1000) s = v.toFixed(0);
  else if (v >= 10) s = v.toFixed(1);
  else if (v >= 1) s = v.toFixed(2);
  else s = v.toFixed(4);
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
function rub(n) {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  if (v >= 10000) return v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  if (v >= 10) return v.toFixed(0);
  if (v >= 1) return v.toFixed(1).replace(/\.0$/, '');
  return v.toFixed(2);
}

/* ---------------- Иконки ---------------- */
function svg(name) {
  const raw = state.icons[name];
  if (!raw) return '';
  return raw.replace(/\swidth="[^"]*"/, '').replace(/\sheight="[^"]*"/, '');
}
function injectIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => {
    if (el.dataset.done) return;
    const s = svg(el.dataset.icon);
    if (!s) return;
    el.innerHTML = s;
    el.dataset.done = '1';
  });
}

/* ---------------- Тема ---------------- */
function applyTheme(mode) {
  state.theme = mode;
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = mode === 'dark' || (mode !== 'light' && sysDark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const btn = $('#btnTheme');
  btn.innerHTML = `<span data-icon="${dark ? 'sun' : 'moon'}"></span>`;
  btn.classList.toggle('is-on', mode === 'dark');
  btn.title = dark ? 'Светлая тема' : 'Тёмная тема';
  injectIcons(btn);
}

/* ---------------- Вкладки ---------------- */
function setView(view) {
  if (view !== 'news' && view !== 'models') return;
  if (view === state.view) return;
  state.view = view;
  state.filter = 'all';
  state.heroIndex = 0;
  state.q = '';
  const inp = $('#searchInput');
  if (inp) inp.value = '';
  $('#searchWrap').classList.remove('is-open');

  $('#segmented').dataset.active = view;
  $$('.seg').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));

  renderChips();
  render();
}

function chipList() {
  if (state.view === 'models') {
    return [{ id: 'all', label: 'Все', color: ALL_COLOR },
      ...state.modelCats.map((c) => ({ id: c.id, label: c.label, color: c.color }))];
  }
  return NEWS_ORDER.map((id) => ({ id, label: CATS[id].label, color: CATS[id].color }));
}

function renderChips() {
  const list = chipList();
  const wide = (list.length % 3 === 1) ? list.length - 1 : -1;
  $('#chips').innerHTML = list.map((c, i) => {
    const cls = [
      'chip',
      c.id === state.filter ? 'is-active' : '',
      i === wide ? 'wide' : '',
    ].filter(Boolean).join(' ');
    return `<button class="${cls}" data-cat="${c.id}"><i class="dot" style="--c:${c.color}"></i>${esc(c.label)}</button>`;
  }).join('');
}

function setFilter(id) {
  if (state.filter === id) return false;
  state.filter = id;
  renderChips();
  const feed = $('#feed');
  if (feed) feed.scrollTop = 0;
  state.heroIndex = 0;
  render();
  return true;
}

function stepFilter(dir) {
  const list = chipList();
  const i = list.findIndex((c) => c.id === state.filter);
  const next = list[(i + dir + list.length) % list.length];
  if (setFilter(next.id)) toast(next.label, 1300);
}

/* ---------------- Данные ---------------- */
function apply(data) {
  if (!data || !Array.isArray(data.items)) return;
  state.items = data.items;
  state.updatedAt = data.updatedAt || Date.now();
  state.failed = data.failed || [];
  state.okSources = data.ok || 0;
  state.stale = !!data.stale;
  state.loading = false;
  state.heroIndex = 0;
}

function applyModels(data) {
  if (!data || !Array.isArray(data.items)) return;
  state.models = data.items.slice().sort((a, b) => a.rank - b.rank);
  state.modelCats = (data.categories || []).map((c) => ({ id: c.id, label: c.label, color: c.color }));
  state.modelsUpdated = data.updated || '';
  state.modelsNote = data.note || '';
}

function applyRate(r) {
  if (r && isFinite(r.rate)) {
    state.rate = Number(r.rate);
    state.rateLive = !!r.live;
  }
}

/* ---------------- Выборка ---------------- */
function visible() {
  const q = state.q.trim().toLowerCase();
  const hasQ = q.length > 1;

  if (state.view === 'models') {
    let list = state.models;
    if (state.filter !== 'all') list = list.filter((m) => (m.cats || []).includes(state.filter));
    if (hasQ) list = list.filter((m) =>
      m.name.toLowerCase().includes(q) ||
      (m.vendor || '').toLowerCase().includes(q) ||
      (m.best || []).join(' ').toLowerCase().includes(q));
    return list;
  }

  let list = state.items;
  if (state.filter === 'new') list = list.filter((i) => Date.now() - i.ts <= 86400000);
  else if (state.filter !== 'all') list = list.filter((i) => i.cat === state.filter);
  if (hasQ) list = list.filter((i) =>
    i.title.toLowerCase().includes(q) ||
    (i.snippet || '').toLowerCase().includes(q) ||
    (i.source || '').toLowerCase().includes(q));
  return list;
}

function skeletons(n = 5) {
  return Array.from({ length: n }, (_, i) => `
    <div class="skel" style="--i:${i}">
      <div class="sk row" style="width:38%"></div>
      <div class="sk t1"></div>
      <div class="sk t2"></div>
      <div class="sk b1"></div>
      <div class="sk b2"></div>
    </div>`).join('');
}

/* ---------------- Новости: разметка ---------------- */
function favHTML(host) {
  if (!host) return `<span class="fav" style="background:${CATS.industry.color}"></span>`;
  return `<img class="fav" referrerpolicy="no-referrer" alt="" data-host="${esc(host)}"
    src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64">`;
}

function newsHTML(it, i, top) {
  const cat = CATS[it.cat] || CATS.industry;
  const badge = top
    ? `<span class="badge top">Главное</span>`
    : `<span class="badge" style="--bc:${cat.color}">${cat.label}</span>`;

  const thumb = it.image && i < 12
    ? `<img class="thumb" referrerpolicy="no-referrer" loading="lazy" alt="" src="${esc(it.image)}">`
    : '';

  return `
  <article class="card${top ? ' is-top' : ''}" style="--i:${Math.min(i, 8)}"
           data-url="${esc(it.link)}" data-id="${esc(it.id)}">
    <div class="card-head">
      ${favHTML(hostOf(it.link))}
      <span class="src">${esc(it.source)}</span>
      <span class="sep"></span>
      <span class="time" data-ts="${it.ts}">${timeAgo(it.ts)}</span>
      <span class="head-spacer"></span>
      ${badge}
    </div>
    <h3>${esc(it.title)}</h3>
    ${it.snippet && !thumb ? `<p>${esc(it.snippet)}</p>` : ''}
    ${thumb}
    <div class="card-foot">
      <span class="host"><span data-icon="globe"></span>${esc(hostOf(it.link) || it.host || '')}</span>
      <span class="foot-spacer"></span>
      <button class="ghost-btn" data-act="copy" data-url="${esc(it.link)}" title="Скопировать ссылку">
        <span data-icon="copy"></span>
      </button>
      <button class="ghost-btn primary" data-act="open" data-url="${esc(it.link)}">
        Открыть <span data-icon="arrow-up-right"></span>
      </button>
    </div>
  </article>`;
}

/* ---------------- Модели: разметка ---------------- */
function priceHTML(m) {
  const p = m.pricing || {};
  const rate = state.rate || 81;

  if (typeof p.in === 'number' && typeof p.out === 'number') {
    return `<div class="price">
      <span class="p-usd">$${money(p.in)} / $${money(p.out)}</span>
      <span class="p-arrow">→</span>
      <span class="p-rub">${rub(p.in * rate)} ₽ / ${rub(p.out * rate)} ₽</span>
      <span class="p-unit">вход / выход за ${esc(p.unit || '1M токенов')}</span>
    </div>`;
  }
  if (typeof p.amount === 'number') {
    return `<div class="price">
      <span class="p-usd">$${money(p.amount)}</span>
      <span class="p-arrow">→</span>
      <span class="p-rub">${rub(p.amount * rate)} ₽</span>
      <span class="p-unit">за ${esc(p.unit || 'единицу')}</span>
    </div>`;
  }
  if (p.free) {
    return `<div class="price">
      <span class="p-usd">Бесплатно</span>
      <span class="p-arrow">→</span>
      <span class="p-rub">0 ₽</span>
      <span class="p-unit">${esc(p.text || 'open-weight')} · платите только железом</span>
    </div>`;
  }
  return `<div class="price">
    <span class="p-usd">${esc(p.text || '—')}</span>
    <span class="p-unit">${esc(p.unit || '')}</span>
  </div>`;
}

function modelHTML(m, i) {
  const cats = m.cats || [];
  const primary = state.modelCats.find((c) => c.id === cats[0]) || { label: '', color: ALL_COLOR };
  const mini = cats
    .map((id) => { const c = state.modelCats.find((x) => x.id === id); return c ? `<i style="--c:${c.color}"></i>` : ''; })
    .join('');
  const bf = (m.best || []).slice(0, 2).map((b) => `<span class="bf">${esc(b)}</span>`).join('');
  const list = (a) => (a && a.length ? `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');

  const meta = [
    m.vendor,
    m.ctx ? 'контекст ' + m.ctx : '',
    m.rel ? m.rel : '',
  ].filter(Boolean).join(' · ');

  return `
  <article class="model${i === 0 ? ' is-top' : ''}" style="--i:${Math.min(i, 8)}" data-mid="${esc(m.id)}">
    <div class="model-top">
      <span class="rank">#${m.rank}</span>
      <div class="model-id">
        <h3>${esc(m.name)}</h3>
        <span class="vendor">${esc(meta)}</span>
      </div>
      <span class="badge" style="--bc:${primary.color}">${esc(primary.label)}</span>
    </div>
    ${priceHTML(m)}
    ${bf ? `<div class="best-for">${bf}</div>` : ''}
    <div class="disc">
      <button class="disc-btn" type="button">
        <span>Сильные и слабые стороны</span>
        <span class="chev"><span data-icon="chevron-down"></span></span>
      </button>
      <div class="disc-body"><div class="disc-inner">
        <section class="blk pros">
          <h4><span data-icon="circle-check"></span>Сильные стороны</h4>${list(m.strengths)}
        </section>
        <section class="blk cons">
          <h4><span data-icon="circle-x"></span>Слабые стороны</h4>${list(m.weaknesses)}
        </section>
        <section class="blk best">
          <h4><span data-icon="target"></span>Для чего лучше всего</h4>${list(m.best)}
        </section>
        ${m.site ? `<a class="model-link" data-act="site" data-url="${esc(m.site)}">
            Сайт и документация <span data-icon="arrow-up-right"></span></a>` : ''}
      </div></div>
    </div>
  </article>`;
}

/* ---------------- Отрисовка ---------------- */
function render() {
  state.view === 'models' ? renderModels() : renderNews();
  renderHero(visible());
  updateMeta(visible().length);
}

function renderNews() {
  const feed = $('#feed');

  if (state.loading && !state.items.length) { feed.innerHTML = skeletons(5); return; }

  const list = visible();
  if (!list.length) {
    feed.innerHTML = emptyState(
      state.q ? 'search' : 'wifi-off',
      state.q ? 'Ничего не найдено' : 'Лента пуста',
      state.q ? 'Попробуйте другой запрос или смените категорию.' : 'Не удалось загрузить новости. Проверьте подключение к сети.',
      'Обновить');
    injectIcons(feed);
    $('#retryBtn')?.addEventListener('click', () => refresh(true));
    return;
  }

  const useTop = state.filter === 'all' && state.q.length <= 1;
  feed.innerHTML = list.map((it, i) => newsHTML(it, i, useTop && i === 0)).join('');
  injectIcons(feed);
  $$('.thumb', feed).forEach(setupThumb);
  $$('.fav', feed).forEach(setupFavicon);
}

function renderModels() {
  const feed = $('#feed');

  if (!state.models.length) {
    feed.innerHTML = emptyState('brain', 'Каталог не загружен', 'Не удалось прочитать models.json.', 'Повторить');
    injectIcons(feed);
    $('#retryBtn')?.addEventListener('click', () => refresh(true));
    return;
  }

  const list = visible();
  if (!list.length) {
    feed.innerHTML = emptyState('search', 'Ничего не найдено',
      'В этой категории нет моделей по вашему запросу.', null);
    injectIcons(feed);
    return;
  }

  feed.innerHTML = list.map((m, i) => modelHTML(m, i)).join('');
  injectIcons(feed);
}

function emptyState(icon, title, text, btn) {
  return `
    <div class="empty">
      <div class="ico"><span data-icon="${icon}"></span></div>
      <h4>${esc(title)}</h4>
      <p>${esc(text)}</p>
      ${btn ? `<button id="retryBtn">${esc(btn)}</button>` : ''}
    </div>`;
}

function renderHero(list) {
  const hero = $('#hero');
  if (!state.compact || !list || !list.length) { hero.hidden = true; hero.innerHTML = ''; return; }
  if (state.heroIndex >= list.length) state.heroIndex = 0;
  const idx = state.heroIndex;

  const dots = list.slice(0, 6)
    .map((_, i) => `<i class="${i === idx ? 'on' : ''}" data-dot="${i}"></i>`).join('');

  if (state.view === 'models') {
    const m = list[idx];
    const cats = (m.cats || []).map((id) => state.modelCats.find((c) => c.id === id)).filter(Boolean);
    const primary = cats[0] || { label: '', color: ALL_COLOR };
    hero.hidden = false;
    hero.innerHTML = `
      <div class="hero-badge">
        <span class="badge" style="--bc:${primary.color}">${esc(primary.label)}</span>
        <span class="sep"></span>
        <span class="src">${esc(m.vendor)}</span>
        <span class="head-spacer"></span>
        <span class="rank">#${m.rank}</span>
      </div>
      <h2>${esc(m.name)}</h2>
      ${priceHTML(m)}
      <div class="hero-foot">
        ${m.site ? `<button class="ghost-btn primary" data-act="site" data-url="${esc(m.site)}">
            Сайт <span data-icon="arrow-up-right"></span></button>` : ''}
        <button class="ghost-btn" data-act="next" title="Следующая модель">
          <span data-icon="chevron-right"></span>
        </button>
        <div class="hero-dots">${dots}</div>
      </div>`;
    injectIcons(hero);
    return;
  }

  const it = list[idx];
  const cat = CATS[it.cat] || CATS.industry;
  const top = idx === 0;
  hero.hidden = false;
  hero.innerHTML = `
    <div class="hero-badge">
      ${top ? '<span class="badge top">Главное</span>'
            : `<span class="badge" style="--bc:${cat.color}">${cat.label}</span>`}
      <span class="sep"></span>
      <span class="src">${esc(it.source)}</span>
      <span class="head-spacer"></span>
      <span class="time" data-ts="${it.ts}">${timeAgo(it.ts)}</span>
    </div>
    <h2 data-url="${esc(it.link)}">${esc(it.title)}</h2>
    <p>${esc(it.snippet || '')}</p>
    <div class="hero-foot">
      <button class="ghost-btn primary" data-act="open" data-url="${esc(it.link)}">
        Читать <span data-icon="arrow-up-right"></span>
      </button>
      <button class="ghost-btn" data-act="next" title="Следующая новость">
        <span data-icon="chevron-right"></span>
      </button>
      <div class="hero-dots">${dots}</div>
    </div>`;
  injectIcons(hero);
}

function updateMeta(count) {
  const d = new Date();
  $('#brandDate').textContent = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;

  if (state.view === 'models') {
    const n = state.models.length;
    const upd = String(state.modelsUpdated || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1');
    $('#brandMeta').textContent = `${n} ${plural(n, ['модель', 'модели', 'моделей'])}${upd ? ' · ' + upd : ''}`;
    $('#statusText').textContent =
      `Курс USD/RUB ${Number(state.rate).toFixed(2)} ₽ · ${state.rateLive ? 'живой' : 'ориентировочный'}`;
    $('#statusMeta').textContent = `${count} в выборке`;
    const dot = $('#liveDot');
    dot.classList.remove('is-stale', 'is-off');
    return;
  }

  const n = count || 0;
  const total = state.items.length;
  const upd = state.updatedAt ? new Date(state.updatedAt) : null;
  const updStr = upd ? `${two(upd.getHours())}:${two(upd.getMinutes())}` : '—';

  $('#brandMeta').textContent = state.loading
    ? 'Обновляем ленту…'
    : `${n} ${plural(n, ['новость', 'новости', 'новостей'])} · ${updStr}`;

  $('#statusText').textContent = state.stale
    ? 'Нет сети — показаны сохранённые новости'
    : state.failed.length
      ? `Автообновление 10 мин · недоступно: ${state.failed.length}`
      : 'Автообновление каждые 10 мин';
  $('#statusMeta').textContent = total
    ? `${state.okSources}/${state.okSources + state.failed.length}` : '';

  const dot = $('#liveDot');
  dot.classList.toggle('is-stale', state.stale);
  dot.classList.toggle('is-off', !state.items.length);
}

/* ---------------- Загрузка ---------------- */
async function refresh(force = true) {
  const btn = $('#btnRefresh');
  btn.classList.add('is-loading');
  try {
    const [news, rate] = await Promise.all([
      force ? window.api.refresh() : window.api.news(),
      window.api.rate ? window.api.rate(force).catch(() => null) : Promise.resolve(null),
    ]);
    if (news) apply(news);
    applyRate(rate);
    state.loading = false;
    render();
  } catch (e) {
    state.loading = false;
    render();
    toast('Не удалось обновить данные');
  } finally {
    btn.classList.remove('is-loading');
  }
}

let toastTimer;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), ms);
}

/* ---------------- Картинки с фоллбэками ---------------- */
function setupThumb(img) {
  img.addEventListener('error', () => {
    const ph = document.createElement('div');
    ph.className = 'thumb thumb-ph';
    ph.innerHTML = '<span data-icon="image"></span>';
    img.replaceWith(ph);
    injectIcons(ph);
  }, { once: true });
}

function setupFavicon(img) {
  let stage = 0;
  const host = img.dataset.host || '';
  img.addEventListener('error', () => {
    stage++;
    if (stage === 1 && host) { img.src = `https://icons.duckduckgo.com/ip3/${host}.ico`; return; }
    const span = document.createElement('span');
    span.className = 'fav';
    span.style.cssText =
      'display:grid;place-items:center;font-size:10px;font-weight:800;color:#fff;border-radius:5px;' +
      'background:linear-gradient(140deg,#0A84FF,#BF5AF2)';
    span.textContent = (host || 'i').charAt(0).toUpperCase();
    img.replaceWith(span);
  }, { once: false });
}

/* ---------------- События ---------------- */
function bind() {
  // Лента: новости — открытие/копирование, модели — раскрытие карточки
  $('#feed').addEventListener('click', async (e) => {
    const site = e.target.closest('[data-act="site"]');
    if (site) { e.stopPropagation(); window.api.win.open(site.dataset.url); return; }

    const act = e.target.closest('[data-act]');
    if (act) {
      e.stopPropagation();
      const url = act.dataset.url;
      if (act.dataset.act === 'copy') {
        const ok = await window.api.win.copy(url);
        toast(ok ? 'Ссылка скопирована' : 'Не удалось скопировать');
      } else if (act.dataset.act === 'open') {
        window.api.win.open(url);
      }
      return;
    }

    const card = e.target.closest('.card');
    if (card?.dataset.url) { window.api.win.open(card.dataset.url); return; }

    const model = e.target.closest('.model');
    if (model) model.classList.toggle('is-open');
  });

  // Компактный герой
  $('#hero').addEventListener('click', async (e) => {
    const dot = e.target.closest('[data-dot]');
    if (dot) { state.heroIndex = +dot.dataset.dot; renderHero(visible()); return; }
    const act = e.target.closest('[data-act]');
    if (act?.dataset.act === 'next') {
      const list = visible();
      state.heroIndex = (state.heroIndex + 1) % Math.max(list.length, 1);
      renderHero(list);
      return;
    }
    if (act?.dataset.act === 'site' || act?.dataset.act === 'open') {
      window.api.win.open(act.dataset.url); return;
    }
    const h = e.target.closest('[data-url]');
    if (h) window.api.win.open(h.dataset.url);
  });

  // Переключение вкладок Новости / Модели
  $('#segmented').addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (seg) setView(seg.dataset.view);
  });

  // Вкладка AI (пока единственная — показывает, что мы внутри раздела)
  $('#tabAI').addEventListener('click', () => toast('Вы в разделе AI', 1200));

  // Фильтры: клик по чипу
  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) setFilter(chip.dataset.cat);
  });

  // Фильтры: колесо мыши по шапке (не по ленте)
  let wheelLock = 0;
  const glass = $('.glass');
  if (glass) {
    glass.addEventListener('wheel', (e) => {
      if (e.target.closest('.feed') || e.target.closest('.searchwrap')) return;
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (Math.abs(delta) < 3) return;
      e.preventDefault();
      const now = Date.now();
      if (now - wheelLock < 170) return;
      wheelLock = now;
      stepFilter(delta > 0 ? 1 : -1);
    }, { passive: false });
  }

  // Поиск
  const wrap = $('#searchWrap');
  const input = $('#searchInput');
  const toggleSearch = (open) => {
    const next = open ?? !wrap.classList.contains('is-open');
    wrap.classList.toggle('is-open', next);
    if (next) setTimeout(() => input.focus(), 180);
    else { input.value = ''; state.q = ''; render(); }
  };
  $('#btnSearch').addEventListener('click', () => toggleSearch());
  $('#searchClear').addEventListener('click', () => { input.value = ''; state.q = ''; render(); input.focus(); });
  let deb;
  input.addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(() => { state.q = input.value; state.heroIndex = 0; render(); }, 140);
  });

  // Управление окном
  $('#btnClose').addEventListener('click', () => window.api.win.close());
  $('#btnMin').addEventListener('click', () => window.api.win.minimize());
  $('#btnZoom').addEventListener('click', () => window.api.win.toggleCompact());
  $('#btnRefresh').addEventListener('click', () => refresh(true));
  $('#btnTheme').addEventListener('click', async () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    await window.api.setPrefs({ theme: next });
    applyTheme(next);
  });
  $('#btnPin').addEventListener('click', async () => {
    const next = !state.pinned;
    await window.api.setPrefs({ pinned: next });
    state.pinned = next;
    $('#btnPin').classList.toggle('is-on', next);
    toast(next ? 'Виджет поверх всех окон' : 'Обычный режим окна');
  });

  // Клавиатура
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault(); toggleSearch(true);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault(); refresh(true);
    } else if (e.key === 'Escape') {
      if (wrap.classList.contains('is-open')) toggleSearch(false);
    } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      setView(e.key === 'ArrowLeft' ? 'news' : 'models');
    }
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme === 'system') applyTheme('system');
  });
}

/* ---------------- Инициализация ---------------- */
async function init() {
  applyTheme('system');
  renderChips();
  injectIcons();

  const [icons, prefs, models, rate] = await Promise.all([
    window.api.icons().catch(() => ({})),
    window.api.getPrefs().catch(() => ({})),
    window.api.models ? window.api.models().catch(() => null) : Promise.resolve(null),
    window.api.rate ? window.api.rate().catch(() => null) : Promise.resolve(null),
  ]);

  state.icons = icons || {};
  state.pinned = prefs.pinned !== false;
  state.compact = !!prefs.compact;
  state.theme = prefs.theme || 'system';
  applyModels(models);
  applyRate(rate);

  injectIcons();          // теперь SVG на руках — проставляем их в разметке
  renderChips();
  bind();
  render();
  refresh(false);

  window.api.onNews((data) => { apply(data); render(); });
  window.api.onTheme((m) => applyTheme(m));

  // Относительное время + ротация в компактном режиме
  setInterval(() => {
    $$('.time[data-ts]').forEach((el) => { el.textContent = timeAgo(+el.dataset.ts); });
    if (state.view === 'news' && state.updatedAt && !state.loading) updateMeta(visible().length);
  }, 30000);

  setInterval(() => {
    if (!state.compact) return;
    const list = visible();
    if (list.length < 2) return;
    state.heroIndex = (state.heroIndex + 1) % list.length;
    renderHero(list);
  }, 9000);
}

document.addEventListener('DOMContentLoaded', init);
