// pages/api/desktop-ws.js
// WebSocket endpoint for the Arena desktop app
// Bridges the desktop app and the Arena frontend

const clients = new Map(); // sessionId -> { desktop, browser }

export default function handler(req, res) {
  if (!res.socket.server.wss) {
    const { WebSocketServer } = require('ws');
    const wss = new WebSocketServer({ noServer: true });
    res.socket.server.wss = wss;

    res.socket.server.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });

    wss.on('connection', (ws, req) => {
      const isDesktop = req.headers['x-client']?.includes('KJCArenaDesktop');
      let sessionId = null;

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'REGISTER') {
            sessionId = msg.sessionId;
            if (!clients.has(sessionId)) clients.set(sessionId, {});
            if (isDesktop) {
              clients.get(sessionId).desktop = ws;
            } else {
              clients.get(sessionId).browser = ws;
            }
            ws.send(JSON.stringify({ type: 'REGISTERED', sessionId }));
            return;
          }

          if (msg.type === 'PING') {
            ws.send(JSON.stringify({ type: 'PONG', version: '1.0' }));
            return;
          }

          // Route messages between desktop and browser
          if (sessionId && clients.has(sessionId)) {
            const pair = clients.get(sessionId);
            const target = isDesktop ? pair.browser : pair.desktop;
            if (target?.readyState === 1) {
              target.send(data.toString());
            }
          }
        } catch (e) {
          console.error('WS message error:', e);
        }
      });

      ws.on('close', () => {
        if (sessionId && clients.has(sessionId)) {
          const pair = clients.get(sessionId);
          if (isDesktop) {
            delete pair.desktop;
            // Notify browser
            if (pair.browser?.readyState === 1) {
              pair.browser.send(JSON.stringify({ type: 'DESKTOP_DISCONNECTED' }));
            }
          } else {
            delete pair.browser;
          }
          if (!pair.desktop && !pair.browser) {
            clients.delete(sessionId);
          }
        }
      });

      ws.on('error', console.error);
    });
  }

  res.end();
}

export const config = { api: { bodyParser: false } };
