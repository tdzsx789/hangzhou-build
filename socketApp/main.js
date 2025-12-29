const { app, BrowserWindow } = require('electron');
const net = require('net');
const path = require('path');
const fs = require('fs');
const PORT = Number(process.env.PORT) || 5260;

function hasServer() {
  return fs.existsSync(path.join(__dirname, 'server', 'index.js'));
}

function startServer() {
  process.env.PORT = String(PORT);
  require(path.join(__dirname, 'server', 'index.js'));
}

function waitForPort(port, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryOnce() {
      const socket = net.createConnection({ port }, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error('port wait timeout'));
        } else {
          setTimeout(tryOnce, 300);
        }
      });
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
      enableRemoteModule: false
    },
    autoHideMenuBar: true
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  if (hasServer()) {
    startServer();
    try {
      await waitForPort(PORT);
      console.log('[app] ws server ready on', PORT);
    } catch (err) {
      console.error('[app] ws server ready wait failed', err.message);
    }
  }
  createWindow();
});

app.on('before-quit', () => { });
