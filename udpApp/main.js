const { app, BrowserWindow } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');

const UDP_PORT = Number(process.env.UDP_PORT) || 6000;
const HTTP_PORT = Number(process.env.HTTP_PORT) || 5280;

function hasServer() {
  return fs.existsSync(path.join(__dirname, 'server', 'index.js'));
}

function startServer() {
  process.env.UDP_PORT = String(UDP_PORT);
  process.env.HTTP_PORT = String(HTTP_PORT);
  require(path.join(__dirname, 'server', 'index.js'));
}

function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryOnce() {
      const req = http.get({ host: '127.0.0.1', port: HTTP_PORT, path: '/health' }, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          res.resume();
          retry();
        }
      });
      req.on('error', retry);
      function retry() {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('health wait timeout'));
        } else {
          setTimeout(tryOnce, 300);
        }
      }
    }
    tryOnce();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: true,
    kiosk: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  if (hasServer()) {
    startServer();
    try {
      await waitForHealth();
      console.log('[app] udp/http server ready on', { UDP_PORT, HTTP_PORT });
    } catch (err) {
      console.error('[app] server health wait failed', err.message);
    }
  }
  createWindow();
});

app.on('before-quit', () => {});
