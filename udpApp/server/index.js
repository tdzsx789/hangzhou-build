const http = require('http');
const dgram = require('dgram');

const UDP_PORT = process.env.UDP_PORT || 6000;
const HTTP_PORT = process.env.HTTP_PORT || 5280;

const clients = new Set();

const httpServer = http.createServer((req, res) => {
  console.log('HTTP', req.method, req.url, req.socket.remoteAddress + ':' + req.socket.remotePort);
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('\n');
    res.write('data: CONNECTED\n\n');
    console.log('SSE client connected', req.socket.remoteAddress + ':' + req.socket.remotePort);
    clients.add(res);
    req.on('close', () => {
      console.log('SSE client disconnected', req.socket.remoteAddress + ':' + req.socket.remotePort);
      clients.delete(res);
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

httpServer.listen(HTTP_PORT, () => {
  console.log(`SSE listening http://localhost:${HTTP_PORT}/events`);
});
httpServer.on('error', (err) => {
  console.log('HTTP server error', err && err.message);
});

const udpServer = dgram.createSocket('udp4');

udpServer.on('message', (msg, rinfo) => {
  const text = msg.toString();
  console.log('UDP message', rinfo.address + ':' + rinfo.port, 'len=' + msg.length);
  for (const res of clients) {
    res.write(`data: ${text}\n\n`);
  }
  console.log(`[UDP] ${rinfo.address}:${rinfo.port} ${text}`);
});
udpServer.on('error', (err) => {
  console.log('UDP error', err && err.message);
});

udpServer.bind(UDP_PORT, () => {
  console.log(`UDP listening 0.0.0.0:${UDP_PORT}`);
});

