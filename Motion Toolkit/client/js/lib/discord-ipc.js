// Talks directly to the local Discord desktop app over its IPC socket.
// No external packages - just Node's built-in net module, so nothing extra
// has to be bundled or npm-installed for this to work.
// Protocol reference: https://discord.com/developers/docs/topics/rpc
(() => {
  const OP_HANDSHAKE = 0;
  const OP_FRAME = 1;

  function candidatePaths() {
    const paths = [];
    if (process.platform === 'win32') {
      for (let i = 0; i < 10; i++) paths.push(`\\\\.\\pipe\\discord-ipc-${i}`);
      return paths;
    }
    const base =
      process.env.XDG_RUNTIME_DIR ||
      process.env.TMPDIR ||
      process.env.TMP ||
      process.env.TEMP ||
      '/tmp';
    for (let i = 0; i < 10; i++) paths.push(`${base}/discord-ipc-${i}`);
    return paths;
  }

  class DiscordIPC {
    constructor() {
      this.socket = null;
      this.connected = false;
      this.buffer = Buffer.alloc(0);
      this.onError = null;
      this.onClose = null;
      this._readyResolve = null;
    }

    connect(clientId) {
      return new Promise((resolve, reject) => {
        const net = require('net');
        const paths = candidatePaths();
        let index = 0;

        const tryNext = () => {
          if (index >= paths.length) {
            reject(new Error('Discord IPC socket not found'));
            return;
          }
          const path = paths[index++];
          let settled = false;
          const socket = net.createConnection(path);
          socket.setTimeout(600);

          socket.once('connect', () => {
            socket.setTimeout(0);
            this.socket = socket;
            this._attachSocketHandlers();
            this._readyResolve = (msg) => {
              if (msg && msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
                settled = true;
                this.connected = true;
                this._readyResolve = null;
                resolve();
              }
            };
            this._send(OP_HANDSHAKE, { v: 1, client_id: clientId });
          });

          socket.once('timeout', () => {
            if (!settled) {
              socket.destroy();
              tryNext();
            }
          });

          socket.once('error', () => {
            if (!settled) {
              socket.destroy();
              tryNext();
            }
          });
        };

        tryNext();
      });
    }

    _attachSocketHandlers() {
      this.socket.on('data', (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this._drain();
      });
      this.socket.on('close', () => {
        const wasConnected = this.connected;
        this.connected = false;
        if (wasConnected && this.onClose) this.onClose();
      });
      this.socket.on('error', (err) => {
        this.connected = false;
        if (this.onError) this.onError(err);
      });
    }

    _drain() {
      while (this.buffer.length >= 8) {
        const op = this.buffer.readInt32LE(0);
        const len = this.buffer.readInt32LE(4);
        if (this.buffer.length < 8 + len) return;
        const payload = this.buffer.slice(8, 8 + len);
        this.buffer = this.buffer.slice(8 + len);

        let msg = null;
        try {
          msg = JSON.parse(payload.toString('utf8'));
        } catch (err) {
          msg = null;
        }

        if (op === OP_FRAME && this._readyResolve && msg) {
          this._readyResolve(msg);
        }
      }
    }

    _send(op, payload) {
      if (!this.socket) return;
      const json = Buffer.from(JSON.stringify(payload), 'utf8');
      const header = Buffer.alloc(8);
      header.writeInt32LE(op, 0);
      header.writeInt32LE(json.length, 4);
      this.socket.write(Buffer.concat([header, json]));
    }

    setActivity(activity) {
      if (!this.connected) return;
      this._send(OP_FRAME, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity },
        nonce: Date.now().toString(16) + Math.random().toString(16).slice(2),
      });
    }

    clearActivity() {
      if (!this.connected) return;
      this._send(OP_FRAME, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity: null },
        nonce: Date.now().toString(16),
      });
    }

    disconnect() {
      this.connected = false;
      if (this.socket) {
        try {
          this.socket.removeAllListeners('close');
          this.socket.end();
        } catch (err) {
          // socket already gone - nothing to do
        }
      }
      this.socket = null;
    }
  }

  window.MotionToolkitDiscordIPC = DiscordIPC;
})();
