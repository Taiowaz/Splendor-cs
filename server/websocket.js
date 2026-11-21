import { WebSocketServer } from 'ws';
import * as accounts from './accounts.js';
import { createGameServer } from './gameServer.js';

const game = createGameServer({
  accounts,
  debug: process.env.NODE_ENV !== 'production',
  graceMs: Number(process.env.GRACE_MS || 120000),
  roomHoldMs: Number(process.env.ROOM_HOLD_MS || 600000)
});

export const nameTaken = game.nameTaken;

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, maxPayload: 8192 });
  let timer;
  function schedule() {
    clearTimeout(timer);
    const deadline = game.nextDeadline();
    if (deadline == null) return;
    timer = setTimeout(() => {
      game.runDueTasks();
      schedule();
    }, Math.max(0, deadline - Date.now()));
  }
  wss.on('connection', ws => {
    game.connect(ws);
    ws.on('message', schedule);
    ws.on('close', schedule);
    ws.on('error', () => ws.close());
  });
  wss.on('close', () => clearTimeout(timer));
  return wss;
}
