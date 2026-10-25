/* ============================================================
   Генерация иконок приложения из скачанного SVG (assets/icons)
   Запуск:  npm run icons        (это electron tools/gen-icons.js)
   Результат: assets/icon.png, icon-32.png, icon-16.png, icon.ico
   ============================================================ */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ASSETS = path.join(__dirname, '..', 'assets');
const SIZE = 512;

// Вектор «искры» берём из скачанного набора Lucide (ISC)
function sparklesPaths() {
  const raw = fs.readFileSync(path.join(ASSETS, 'icons', 'sparkles.svg'), 'utf8');
  return raw
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>[\s\S]*$/, '')
    .trim();
}

function pageHTML() {
  const inner = sparklesPaths();
  const iconSize = 24;
  const scale = 14;
  const offset = (SIZE - iconSize * scale) / 2;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block}
  </style></head><body>
  <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0A84FF"/>
        <stop offset=".52" stop-color="#5E5CE6"/>
        <stop offset="1" stop-color="#BF5AF2"/>
      </linearGradient>
      <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".38"/>
        <stop offset=".55" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${SIZE}" height="${SIZE}" rx="118" fill="url(#g)"/>
    <rect width="${SIZE}" height="${SIZE}" rx="118" fill="url(#shine)"/>
    <rect x=".75" y=".75" width="${SIZE - 1.5}" height="${SIZE - 1.5}" rx="117.5"
          fill="none" stroke="#ffffff" stroke-opacity=".45" stroke-width="1.5"/>
    <g transform="translate(${offset},${offset}) scale(${scale})"
       fill="none" stroke="#ffffff" stroke-width="1.55"
       stroke-linecap="round" stroke-linejoin="round">${inner}</g>
  </svg></body></html>`;
}

/* ---- Упаковка PNG в .ico (Windows принимает PNG-контейнер, Vista+) ---- */
function pngToIco(pngBuffersWithSizes) {
  const count = pngBuffersWithSizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type = icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + count * 16;

  for (const { png, size } of pngBuffersWithSizes) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);   // width
    e.writeUInt8(size >= 256 ? 0 : size, 1);   // height
    e.writeUInt8(0, 2);                        // palette
    e.writeUInt8(0, 3);                        // reserved
    e.writeUInt16LE(1, 4);                     // color planes
    e.writeUInt16LE(32, 6);                    // bpp
    e.writeUInt32LE(png.length, 8);            // размер PNG
    e.writeUInt32LE(offset, 12);               // смещение
    entries.push(e);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...pngBuffersWithSizes.map((x) => x.png)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(60);

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pageHTML()));
  await new Promise((r) => setTimeout(r, 900));

  let image = await win.webContents.capturePage();

  // Запасной путь: растеризуем в реальном окне, если offscreen не отдал кадр
  if (image.isEmpty()) {
    win.webContents.setOffscreen(false);
    win.setSize(SIZE, SIZE);
    win.center();
    win.showInactive();
    await new Promise((r) => setTimeout(r, 900));
    image = await win.webContents.capturePage();
  }

  if (image.isEmpty()) {
    console.error('capturePage вернул пустое изображение');
    app.exit(1);
    return;
  }

  const big = image.resize({ width: SIZE, height: SIZE, quality: 'good' });
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), big.toPNG());

  const sizes = [256, 64, 48, 32, 16];
  const parts = [];
  for (const s of sizes) {
    const img = image.resize({ width: s, height: s, quality: 'good' });
    const png = img.toPNG();
    parts.push({ png, size: s });
    if (s === 32) fs.writeFileSync(path.join(ASSETS, 'icon-32.png'), png);
    if (s === 16) fs.writeFileSync(path.join(ASSETS, 'icon-16.png'), png);
  }

  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), pngToIco(parts));

  console.log('Иконки готовы:', sizes.join(', '), '+ icon.ico');
  win.destroy();
  app.exit(0);
});

app.on('window-all-closed', () => app.exit(0));
