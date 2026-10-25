const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Ассеты (SVG-иконки скачаны в assets/icons, отдаёт главный процесс)
  icons: () => ipcRenderer.invoke('assets:icons'),

  // Каталог моделей ИИ + курс рубля
  models: () => ipcRenderer.invoke('assets:models'),
  rate: (force) => ipcRenderer.invoke('rates:get', { force: !!force }),

  // Новости
  news: () => ipcRenderer.invoke('news:load'),
  onNews: (cb) => ipcRenderer.on('news:update', (_e, data) => cb(data)),
  refresh: () => ipcRenderer.invoke('news:load', { force: true }),

  // Тема и настройки
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  onTheme: (cb) => ipcRenderer.on('theme:changed', (_e, mode) => cb(mode)),

  // Окно
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    close: () => ipcRenderer.invoke('win:close'),
    toggleCompact: () => ipcRenderer.invoke('win:toggle-compact'),
    setBounds: (b) => ipcRenderer.invoke('win:set-bounds', b),
    open: (url) => ipcRenderer.invoke('win:open', url),
    copy: (text) => ipcRenderer.invoke('win:copy', text),
  },

  platform: process.platform,
});
