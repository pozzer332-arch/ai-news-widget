/* ============================================================
   AI News Widget — главный процесс Electron
   • Безрамочное «стеклянное» окно-виджет поверх рабочего стола
   • Загрузка новостей ИИ из RSS (без CORS — идёт из main)
   • Кэш, автообновление, трей, светлая/тёмная тема
   ============================================================ */

const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeTheme, nativeImage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const isWin = process.platform === 'win32';
const REFRESH_MS = 10 * 60 * 1000;      // автообновление раз в 10 минут
const FEED_TIMEOUT = 9000;               // таймаут на один источник
const MAX_PER_FEED = 15;
const MAX_ITEMS = 60;

/* ---------------------------------------------------------- */
/* Источники новостей                                          */
/* ---------------------------------------------------------- */
const FEEDS = [
  { name: 'Google AI',        host: 'blog.google',        url: 'https://blog.google/technology/ai/rss/', cat: 'industry' },
  { name: 'OpenAI',           host: 'openai.com',         url: 'https://openai.com/news/rss.xml',       cat: 'models'   },
  { name: 'TechCrunch',       host: 'techcrunch.com',     url: 'https://techcrunch.com/category/artificial-intelligence/feed/', cat: 'business' },
  { name: 'VentureBeat',      host: 'venturebeat.com',    url: 'https://venturebeat.com/category/ai/feed/', cat: 'industry' },
  { name: 'MIT Tech Review',  host: 'technologyreview.com', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed/', cat: 'research' },
  { name: 'The Verge',        host: 'theverge.com',       url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', cat: 'tools' },
  { name: 'WIRED',            host: 'wired.com',          url: 'https://www.wired.com/feed/tag/ai/latest/rss', cat: 'industry' },
  { name: 'Ars Technica',     host: 'arstechnica.com',    url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', cat: 'research' },
  { name: 'arXiv · cs.AI',    host: 'arxiv.org',          url: 'http://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=15', cat: 'research' },
  { name: 'Interconnects',    host: 'interconnects.ai',   url: 'https://www.interconnects.ai/feed',      cat: 'models'   },
  { name: 'Hacker News',      host: 'news.ycombinator.com', url: 'https://hnrss.org/newest?q=AI+OR+LLM&points=50', cat: 'industry' },
  { name: 'Хабр',             host: 'habr.com',           url: 'https://habr.com/ru/rss/hubs/artificial_intelligence/all/?fl=ru', cat: 'industry' },
];

/* ---------------------------------------------------------- */
/* Категории                                                   */
/* ---------------------------------------------------------- */
const CATEGORIES = {
  models:    { label: 'Модели',       words: ['llm','gpt','claude','gemini','llama','deepseek','qwen','mistral','model','r1','open-weight','parameter','token','diffusion','sora','midjourney','neural','нейросет','модель','языковая'] },
  research:  { label: 'Исследования', words: ['research','paper','study','arxiv','scientist','benchmark','agi','algorithm','university','study finds','исследован','учён','научн','бенчмарк'] },
  business:  { label: 'Бизнес',       words: ['funding','raises','startup','revenue','layoff','acquisition','acquires','invest','million','billion','valuation','ceo','ipo','partner','deal','стартап','инвестиц','миллиард','миллион'] },
  tools:     { label: 'Инструменты',  words: ['launch','launches','app','feature','plugin','tool','api','release','update','available','integrat','extension','assistant','copilot','сервис','приложени','функция','инструмент'] },
  industry:  { label: 'Индустрия',    words: [] },
};

/* ---------------------------------------------------------- */
/* Настройки (сохраняются между запусками)                     */
/* ---------------------------------------------------------- */
let prefs = { theme: 'system', pinned: true, compact: false };

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
const cacheFile = () => path.join(app.getPath('userData'), 'news-cache.json');

function loadPrefs() {
  try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; } catch (_) {}
}
function savePrefs() {
  try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2)); } catch (_) {}
}

/* ---------------------------------------------------------- */
/* Утилиты разбора RSS/Atom                                     */
/* ---------------------------------------------------------- */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', rsquo: '\u2019',
  lsquo: '\u2018', ldquo: '\u201C', rdquo: '\u201D', copy: '\u00A9',
};

function decode(str) {
  if (!str) return '';
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCode(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, k) => (NAMED[k.toLowerCase()] !== undefined ? NAMED[k.toLowerCase()] : m));
}
function safeCode(n) {
  try { return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  catch (_) { return ''; }
}
function stripTags(html) {
  return decode(String(html || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}
function tag(block, name) {
  const re = new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}
function attr(block, tagRe, attr) {
  const m = block.match(new RegExp('<' + tagRe + '[^>]*' + attr + '=["\']([^"\']+)["\']', 'i'));
  return m ? m[1].trim() : '';
}
function normalizeTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '');
}
function classify(text) {
  const t = String(text || '').toLowerCase();
  let best = 'industry';
  let bestScore = 0;
  for (const [key, def] of Object.entries(CATEGORIES)) {
    if (key === 'industry' || !def.words.length) continue;
    let score = 0;
    for (const w of def.words) if (t.includes(w)) score++;
    if (score > bestScore) { bestScore = score; best = key; }
  }
  return bestScore ? best : 'industry';
}
function pickImage(block, description) {
  const candidates = [
    attr(block, 'media:content', 'url'),
    attr(block, 'media:thumbnail', 'url'),
    attr(block, 'enclosure', 'url'),
    attr(block, 'itunes:image', 'href'),
    (description.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1],
    (description.match(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^\s"'<>]*)?/i) || [])[1],
  ].filter(Boolean);

  for (let u of candidates) {
    if (u.startsWith('//')) u = 'https:' + u;
    if (/^https?:\/\//i.test(u) && !/pixel|tracking|spacer|1x1|sprite/i.test(u)) return u;
  }
  return null;
}

function parseFeed(xml, feed) {
  const out = [];
  let blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];

  for (const raw of blocks.slice(0, MAX_PER_FEED * 3)) {
    const title = stripTags(tag(raw, 'title'));
    if (!title) continue;

    let link = stripTags(tag(raw, 'link'));
    if (!link) link = attr(raw, 'link', 'href');          // Atom: <link href="…"/>
    if (!link) {
      const m = raw.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (m) link = m[1];
    }
    link = String(link || '').trim();
    if (link.startsWith('//')) link = 'https:' + link;
    if (!/^https?:\/\//i.test(link)) {
      const m2 = raw.match(/https?:\/\/[^\s"'<>]+/);
      link = m2 ? m2[0] : '';
    }

    const description = tag(raw, 'description') || tag(raw, 'summary') || tag(raw, 'content') || tag(raw, 'content:encoded');
    const dateStr = tag(raw, 'pubDate') || tag(raw, 'published') || tag(raw, 'updated') ||
                    tag(raw, 'dc:date') || tag(raw, 'date') || tag(raw, 'dc:issued');
    const ts = Date.parse(stripTags(dateStr));

    const snippet = stripTags(description).slice(0, 240);
    const source = stripTags(tag(raw, 'source')) || feed.name;

    out.push({
      id: normalizeTitle(title).slice(0, 60) + '|' + (Number.isFinite(ts) ? ts : 0),
      title: title.slice(0, 200),
      link,
      snippet: snippet.length >= 230 ? snippet.slice(0, 237).trimEnd() + '…' : snippet,
      ts: Number.isFinite(ts) ? ts : Date.now(),
      source,
      host: feed.host,
      cat: feed.cat === 'industry' ? classify(title + ' ' + snippet) : feed.cat,
      image: pickImage(raw, description),
    });

    if (out.length >= MAX_PER_FEED) break;
  }
  return out;
}

/* ---------------------------------------------------------- */
/* Загрузка новостей                                           */
/* ---------------------------------------------------------- */
async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    signal: AbortSignal.timeout(FEED_TIMEOUT),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const xml = await res.text();
  if (!/<(item|entry)[\s>]/i.test(xml)) throw new Error('не RSS');
  return parseFeed(xml, feed);
}

let inFlight = null;

async function loadNews(force = false) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const results = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f)));
    const items = [];
    const failed = [];
    let ok = 0;

    results.forEach((r, i) => {
      if (r.status === 'fulfilled') { ok++; items.push(...r.value); }
      else failed.push(FEEDS[i].name);
    });

    // Дедупликация по нормализованному заголовку
    const seen = new Map();
    for (const it of items) {
      const key = normalizeTitle(it.title).slice(0, 80);
      if (!key) continue;
      const prev = seen.get(key);
      if (!prev || it.ts > prev.ts) seen.set(key, it);
    }

    const merged = [...seen.values()]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, MAX_ITEMS);

    const payload = { items: merged, updatedAt: Date.now(), ok, failed, total: items.length };

    // Если все источники упали — отдаём кэш
    if (!merged.length) {
      const cached = readCache();
      if (cached && cached.items.length) {
        return { ...cached, stale: true, failed };
      }
      return payload;   // кэша нет — не затираем ничего пустым
    }

    writeCache(payload);
    return payload;
  })();

  try { return await inFlight; } finally { inFlight = null; }
}

function readCache() {
  try { return JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch (_) { return null; }
}
function writeCache(data) {
  try { fs.writeFileSync(cacheFile(), JSON.stringify(data)); } catch (_) {}
}

/* ---------------------------------------------------------- */
/* Окно виджета                                                */
/* ---------------------------------------------------------- */
const NORMAL = { w: 424, h: 664 };
const COMPACT = { w: 340, h: 356 };

let win = null;
let tray = null;
let timer = null;
let quitting = false;

function windowPosition(size) {
  const d = screen.getPrimaryDisplay();
  const margin = 24;
  return {
    x: Math.round(d.workArea.x + d.workArea.width - size.w - margin),
    y: Math.round(d.workArea.y + margin),
  };
}

function createWindow() {
  const size = prefs.compact ? COMPACT : NORMAL;
  const pos = windowPosition(size);

  win = new BrowserWindow({
    width: size.w,
    height: size.h,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',   // чтобы окно не мигало белым при старте
    alwaysOnTop: !!prefs.pinned,
    title: 'AI News Widget',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  // В режиме виджета крестик прячет окно в трей, а не закрывает приложение
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); }
  });
}

/* Плавное изменение размера при переключении компактного режима */
let animating = false;
function resizeAnimated(to) {
  if (!win || animating) return;
  animating = true;
  const from = win.getBounds();
  const steps = 14;
  let i = 0;
  const timerId = setInterval(() => {
    i++;
    const t = easeOut(i / steps);
    const w = Math.round(from.width + (to.w - from.width) * t);
    const h = Math.round(from.height + (to.h - from.height) * t);
    win.setBounds({ x: from.x + Math.round((to.x - from.x) * t), y: from.y + Math.round((to.y - from.y) * t), width: w, height: h });
    if (i >= steps) { clearInterval(timerId); animating = false; }
  }, 16);
}
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

/* ---------------------------------------------------------- */
/* Трей                                                        */
/* ---------------------------------------------------------- */
function iconImage(file) {
  const p = path.join(__dirname, 'assets', file);
  try {
    if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  } catch (_) {}
  return nativeImage.createEmpty();
}

function createTray() {
  const img = iconImage('icon-32.png');
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('AI News Widget');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Показать виджет', click: () => showWindow() },
    { label: 'Обновить новости', click: () => pushNews(true) },
    { type: 'separator' },
    { label: 'Поверх всех окон', type: 'checkbox', checked: !!prefs.pinned, click: (mi) => setPinned(mi.checked) },
    { label: 'Компактный режим', type: 'checkbox', checked: !!prefs.compact, click: (mi) => toggleCompact(mi.checked) },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => showWindow());
}

function showWindow() {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function setPinned(value) {
  prefs.pinned = !!value;
  savePrefs();
  if (win) win.setAlwaysOnTop(!!value);
  broadcast('prefs:changed', prefs);
}

function toggleCompact(force) {
  const next = typeof force === 'boolean' ? force : !prefs.compact;
  if (next === prefs.compact) return;
  prefs.compact = next;
  savePrefs();
  const size = next ? COMPACT : NORMAL;
  const pos = windowPosition(size);
  resizeAnimated({ ...size, x: pos.x, y: pos.y });
  broadcast('prefs:changed', prefs);
}

function broadcast(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

/* ---------------------------------------------------------- */
/* Каталог моделей ИИ (models.json)                            */
/* ---------------------------------------------------------- */
function readModels() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'models.json'), 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.items)) return data;
  } catch (err) {
    console.error('models.json:', err.message);
  }
  return { updated: '', note: '', categories: [], items: [] };
}

/* ---------------------------------------------------------- */
/* Курс USD → RUB (несколько открытых источников + фоллбэк)    */
/* ---------------------------------------------------------- */
const FX_SOURCES = [
  'https://open.er-api.com/v6/latest/USD',
  'https://api.exchangerate-api.com/v4/latest/USD',
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
];
const FX_FALLBACK = 81;
const FX_TTL = 12 * 3600 * 1000;
const rateFile = () => path.join(app.getPath('userData'), 'rate.json');

let rateCache = null;

function readRateFile() {
  try { return JSON.parse(fs.readFileSync(rateFile(), 'utf8')); } catch (_) { return null; }
}
function writeRateFile(data) {
  try { fs.writeFileSync(rateFile(), JSON.stringify(data)); } catch (_) {}
}

async function fetchRate() {
  for (const url of FX_SOURCES) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      if (!res.ok) continue;
      const j = await res.json();
      const rate = (j.rates && j.rates.RUB) || (j.usd && j.usd.rub);
      if (rate && isFinite(rate) && rate > 1) {
        return { rate: Number(rate), at: Date.now(), live: true, src: new URL(url).hostname };
      }
    } catch (_) { /* пробуем следующий источник */ }
  }
  return null;
}

async function getRate(force = false) {
  if (!rateCache) rateCache = readRateFile();
  if (rateCache && force === false && Date.now() - rateCache.at < FX_TTL) return rateCache;

  const fresh = await fetchRate();
  if (fresh) { rateCache = fresh; writeRateFile(fresh); return rateCache; }

  if (rateCache && rateCache.rate) return rateCache;          // старый кэш
  rateCache = { rate: FX_FALLBACK, at: Date.now(), live: false, src: 'default' };
  return rateCache;
}

/* ---------------------------------------------------------- */
/* IPC                                                         */
/* ---------------------------------------------------------- */
function registerIpc() {
  ipcMain.handle('assets:icons', async () => {
    const dir = path.join(__dirname, 'assets', 'icons');
    // Готовый JSON быстрее, чем читать десятки файлов
    try {
      const json = JSON.parse(fs.readFileSync(path.join(dir, 'icons.json'), 'utf8'));
      if (json && Object.keys(json).length) return json;
    } catch (_) {}
    const map = {};
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.svg')) map[f.replace('.svg', '')] = fs.readFileSync(path.join(dir, f), 'utf8');
      }
    } catch (_) {}
    return map;
  });

  ipcMain.handle('news:load', async (_e, opts = {}) => {
    const data = await loadNews(!!opts.force);
    return data;
  });

  ipcMain.handle('prefs:get', () => prefs);

  ipcMain.handle('assets:models', async () => readModels());
  ipcMain.handle('rates:get', async (_e, opts = {}) => getRate(!!opts.force));
  ipcMain.handle('prefs:set', (_e, patch) => {
    prefs = { ...prefs, ...patch };
    savePrefs();
    if ('pinned' in patch && win) win.setAlwaysOnTop(!!prefs.pinned);
    if ('theme' in patch) applyTheme();
    return prefs;
  });

  ipcMain.handle('win:minimize', () => win && win.minimize());
  ipcMain.handle('win:close', () => win && win.hide());
  ipcMain.handle('win:set-bounds', (_e, b) => win && win.setBounds(b));

  ipcMain.handle('win:toggle-compact', () => toggleCompact());

  ipcMain.handle('win:open', async (_e, url) => {
    if (/^https?:\/\//i.test(String(url))) await shell.openExternal(url);
  });

  ipcMain.handle('win:copy', async (_e, text) => {
    try { await require('electron').clipboard.writeText(String(text)); return true; }
    catch (_) { return false; }
  });
}

/* ---------------------------------------------------------- */
/* Тема                                                        */
/* ---------------------------------------------------------- */
function applyTheme() {
  nativeTheme.themeSource = prefs.theme === 'system' ? 'system' : prefs.theme;
  broadcast('theme:changed', prefs.theme);
}

/* ---------------------------------------------------------- */
/* Жизненный цикл                                              */
/* ---------------------------------------------------------- */
async function pushNews(force = false) {
  try {
    const data = await loadNews(force);
    broadcast('news:update', data);
    return data;
  } catch (err) {
    console.error('news load failed:', err);
    return null;
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    if (isWin) app.setAppUserModelId('com.pozze.ai-news-widget');

    loadPrefs();
    applyTheme();
    registerIpc();
    createWindow();
    createTray();

    getRate(false).catch(() => {});   // прогреваем курс в фоне

    // Первичная загрузка (кэш отдаётся мгновенно, затем фоновое обновление)
    const cached = readCache();
    if (cached && cached.items.length) broadcast('news:update', { ...cached, cached: true });
    pushNews(false);

    timer = setInterval(() => pushNews(false), REFRESH_MS);

    nativeTheme.on('updated', () => broadcast('system-theme', nativeTheme.shouldUseDarkColors));
  });

  app.on('before-quit', () => { quitting = true; if (timer) clearInterval(timer); });
  app.on('window-all-closed', () => { /* виджет живёт в трее */ });
}
