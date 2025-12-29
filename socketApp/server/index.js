const WebSocket = require('ws');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 5260;
const GAME_COUNT = Number(process.env.GAME_COUNT) || 5;
const STAGE = {
  WAITING: 'waiting',
  PREPARE: 'prepare',
  PHOTO: 'photo',
  GAMING: 'gaming',
  ELECTION: 'election',
  COMPLETE: 'complete',
};
const METHODS = [
  '背箱法',
  '豆选法',
  '喊选法',
  '举手法',
  '票选法',
  '烧洞法',
  '投纸团法',
];

const server = new WebSocket.Server({ port: PORT });
const clients = new Set();
const readyPlayers = new Set();
const photoPlayers = new Set();
const photoDonePlayers = new Set();
const humanPlayers = new Set();
const npcPlayers = new Set();
let startWindowActive = false;
let startWindowTimer = null;
let waitingCountdown = 0;
let waitingInterval = null;
let photoTimer = null;
let completeTimer = null;
let gamingTimer = null;
let electionTimer = null;
let championPlayerId = '';

let currentStage = STAGE.WAITING;

console.log(`[ws] server listening on ws://localhost:${PORT}`);

server.on('connection', (ws, request) => {
  const { role, playerId } = parseContext(request);
  const client = { ws, role, playerId };
  clients.add(client);

  console.log(`[ws] client connected role=${role} id=${playerId || '-'}`);

  ws.on('message', (data) => {
    const message = safeParse(data);
    if (message) {
      handleMessage(client, message);
      return;
    }
    if (Buffer.isBuffer(data)) {
      handleBinaryMessage(client, data);
    }
  });

  ws.on('close', () => {
    clients.delete(client);
    if (client.role === 'game' && client.playerId) {
      readyPlayers.delete(client.playerId);
      photoPlayers.delete(client.playerId);
      photoDonePlayers.delete(client.playerId);
      broadcastReadyList();
    }
    console.log(
      `[ws] client disconnected role=${client.role} id=${client.playerId || '-'}`,
    );
  });

  ws.on('error', (err) => {
    console.error('[ws] client error', err.message);
  });

  sendStateSnapshot(ws);
});

function handleMessage(client, message) {
  const type = message.type;
  console.log('type', type)
  switch (type) {
    case 'game:start':
      handleGameStart(client, message);
      break;
    case 'game:photo':
      handleGamePhoto(client, message);
      break;
    case 'game:photoDone':
      handleGamePhotoDone(client, message);
      break;
    case 'game:reset':
      handleGameReset(client, message);
      break;
    case 'client:reload':
      handleClientReload();
      break;
    case 'admin:reset':
      resetState();
      break;
    case 'gaming:show':
      handleGamingShow(client, message);
      break;
    case 'champion:update':
      handleChampionUpdate(client, message);
      break;
    default:
      console.warn('[ws] unknown message type', type);
  }
}

function handleGameStart(client, message) {
  const playerId = getPlayerId(client, message);
  if (!playerId) return;
  if (currentStage === STAGE.WAITING) {
    readyPlayers.add(playerId);
    humanPlayers.add(playerId);
    npcPlayers.delete(playerId);
    
    // 立即填充NPC
    for (let i = 1; i <= GAME_COUNT; i++) {
      const pid = String(i);
      if (!humanPlayers.has(pid)) {
        npcPlayers.add(pid);
      }
    }
    
    broadcastReadyList();
    broadcastRoles();

    // 即使跳过PREPARE，也生成播放列表以保持一致性
    const order = generatePlaylist();
    broadcast({ type: 'playlist:update', payload: { methods: order } });
    
    // 直接进入拍照阶段，不再等待
    updateStage(STAGE.PHOTO);
  } else if (currentStage === STAGE.PHOTO) {
    // PHOTO阶段也允许加入并成为人类玩家
    readyPlayers.add(playerId);
    humanPlayers.add(playerId);
    npcPlayers.delete(playerId);
    photoPlayers.delete(playerId); // 重置拍照状态，等待新的人类玩家拍照
    
    broadcastReadyList();
    broadcastRoles();
  } else {
    readyPlayers.add(playerId);
    photoPlayers.delete(playerId);
    broadcastReadyList();
  }
}

function handleGamePhoto(client, message) {
  const playerId = getPlayerId(client, message);
  if (!playerId) return;
  if (currentStage !== STAGE.PREPARE && currentStage !== STAGE.PHOTO) return;
  photoPlayers.add(playerId);

  if (photoPlayers.size >= GAME_COUNT && currentStage !== STAGE.PHOTO) {
    updateStage(STAGE.PHOTO);
  }
}

function handleGamePhotoDone(client, message) {
  const playerId = getPlayerId(client, message);
  if (!playerId) return;
  if (currentStage !== STAGE.PHOTO) return;
  photoDonePlayers.add(playerId);

  if (photoDonePlayers.size >= GAME_COUNT) {
    updateStage(STAGE.GAMING);
  }
}

function handleGameReset(client, message) {
  const playerId = getPlayerId(client, message);
  if (!playerId) return;
  resetState();
}

function handleGamingShow(client, message) {
  const playerId = getPlayerId(client, message);
  if (!playerId) return;
  broadcast({ type: 'gaming:show', payload: { playerId } });
}

function handleClientReload() {
  if (
    currentStage !== STAGE.WAITING ||
    readyPlayers.size > 0 ||
    photoPlayers.size > 0 ||
    photoDonePlayers.size > 0
  ) {
    resetState();
  }
}

function updateStage(nextStage) {
  if (photoTimer) {
    clearInterval(photoTimer);
    photoTimer = null;
  }

  if (completeTimer) {
    clearTimeout(completeTimer);
    completeTimer = null;
  }
  if (gamingTimer) {
    clearTimeout(gamingTimer);
    gamingTimer = null;
  }
  if (electionTimer) {
    clearTimeout(electionTimer);
    electionTimer = null;
  }

  currentStage = nextStage;

  if (nextStage === STAGE.WAITING) {
    readyPlayers.clear();
    photoPlayers.clear();
    photoDonePlayers.clear();
    humanPlayers.clear();
    npcPlayers.clear();
    championPlayerId = '';
    if (startWindowTimer) {
      clearTimeout(startWindowTimer);
      startWindowTimer = null;
    }
    startWindowActive = false;
    waitingCountdown = 0;
    if (waitingInterval) {
      clearInterval(waitingInterval);
      waitingInterval = null;
    }
    broadcastRoles();
    broadcast({ type: 'champion:update', payload: { playerId: championPlayerId } });
  }

  if (nextStage === STAGE.PREPARE) {
    const order = generatePlaylist();
    broadcast({ type: 'playlist:update', payload: { methods: order } });
    broadcastRoles();
  }

  if (nextStage === STAGE.PHOTO) {
    photoDonePlayers.clear();
    let photoCountdown = 10;
    
    // 立即广播一次初始倒计时
    broadcast({ type: 'photo:countdown', payload: { seconds: photoCountdown } });

    // 清除旧的倒计时定时器（如果有）
    if (photoTimer) {
      clearInterval(photoTimer); // 注意这里改为 clearInterval
      photoTimer = null;
    }

    photoTimer = setInterval(() => {
      photoCountdown--;
      broadcast({ type: 'photo:countdown', payload: { seconds: photoCountdown } });
      
      if (photoCountdown <= 0) {
        clearInterval(photoTimer);
        photoTimer = null;
        updateStage(STAGE.GAMING);
      }
    }, 1000);
  }

  if (nextStage === STAGE.GAMING) {
    gamingTimer = setTimeout(() => {
      updateStage(STAGE.ELECTION);
    }, 6000);
  }

  if (nextStage === STAGE.ELECTION) {
    electionTimer = setTimeout(() => {
      updateStage(STAGE.COMPLETE);
    }, 10000);
  }

  if (nextStage === STAGE.COMPLETE) {
    completeTimer = setTimeout(() => {
      console.log('[ws] complete timer expired, auto resetting to waiting');
      resetState();
    }, 15000);
    console.log('[ws] complete timer started, will reset in 15s');
  }

  if (nextStage !== STAGE.PHOTO) {
    photoPlayers.clear();
    photoDonePlayers.clear();
  }

  broadcastStage();
}

function broadcastStage() {
  const message = {
    type: 'stage:update',
    payload: { stage: currentStage },
  };
  broadcast(message);
  console.log('[ws] stage ->', currentStage, 'broadcasted to', clients.size, 'clients');
}

function generatePlaylist() {
  const arr = METHODS.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const must = '豆选法';
  const idx = arr.indexOf(must);
  if (idx !== -1 && idx >= GAME_COUNT) {
    const target = 0;
    [arr[target], arr[idx]] = [arr[idx], arr[target]];
  }
  return arr;
}

function broadcastReadyList() {
  broadcast({
    type: 'game:ready:list',
    payload: { playerIds: Array.from(readyPlayers) },
  });
}

function sendStateSnapshot(ws) {
  ws.send(
    JSON.stringify({
      type: 'stage:update',
      payload: { stage: currentStage },
    }),
  );
  ws.send(
    JSON.stringify({
      type: 'game:ready:list',
      payload: { playerIds: Array.from(readyPlayers) },
    }),
  );
  ws.send(
    JSON.stringify({
      type: 'players:roles',
      payload: {
        humans: Array.from(humanPlayers),
        npcs: Array.from(npcPlayers),
      },
    }),
  );
  ws.send(
    JSON.stringify({
      type: 'champion:update',
      payload: { playerId: championPlayerId },
    }),
  );
  if (startWindowActive) {
    ws.send(
      JSON.stringify({
        type: 'waiting:countdown',
        payload: { seconds: waitingCountdown },
      }),
    );
  }
}

function handleChampionUpdate(client, message) {
  const pid = getPlayerId(client, message);
  championPlayerId = String(pid || '');
  broadcast({ type: 'champion:update', payload: { playerId: championPlayerId } });
}

function resetState() {
  console.log('[ws] resetState called, currentStage:', currentStage);
  if (completeTimer) {
    clearTimeout(completeTimer);
    completeTimer = null;
    console.log('[ws] complete timer cleared in resetState');
  }
  // 直接调用 updateStage，它会处理定时器清除、状态更新和广播
  updateStage(STAGE.WAITING);
  broadcastReadyList();
  broadcastRoles();
  console.log('[ws] reset state completed, stage should be waiting');
}

function parseContext(request) {
  try {
    const url = new URL(request.url, 'http://localhost');
    return {
      role: url.searchParams.get('role') || 'guest',
      playerId: url.searchParams.get('playerId') || '',
    };
  } catch (err) {
    return { role: 'guest', playerId: '' };
  }
}

function getPlayerId(client, message) {
  return (
    message.playerId ||
    message.payload?.playerId ||
    client.playerId ||
    ''
  );
}

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function broadcastRoles() {
  broadcast({
    type: 'players:roles',
    payload: {
      humans: Array.from(humanPlayers),
      npcs: Array.from(npcPlayers),
    },
  });
}

function handleBinaryMessage(client, data) {
  try {
    if (!Buffer.isBuffer(data) || data.length < 4) return;
    const headerLen = data.readUInt32BE(0);
    const start = 4;
    const end = start + headerLen;
    if (end > data.length) return;
    const headerBuf = data.slice(start, end);
    const headerStr = headerBuf.toString();
    const header = JSON.parse(headerStr);
    if (!header || header.type !== 'photo:bin') return;
    for (const c of clients) {
      if (c.role === 'screen' && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(data);
      }
    }
  } catch (_) {}
}


function safeParse(buffer) {
  try {
    return JSON.parse(buffer.toString());
  } catch (err) {
    console.warn('[ws] JSON parse error', err.message);
    return null;
  }
}
