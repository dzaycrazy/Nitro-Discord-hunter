// ── Discord Gateway — chỉ dùng để set presence/status ────────────────────────
// Không cần discord.js, dùng ws thuần
const WebSocket = require('ws');

// Map string → Discord activity type number
const ACTIVITY_TYPE = {
    PLAYING:   0,
    STREAMING: 1,
    LISTENING: 2,
    WATCHING:  3,
    COMPETING: 5,
};

// Map string → Discord status string
const STATUS_MAP = {
    ONLINE:  'online',
    IDLE:    'idle',
    DND:     'dnd',
    OFFLINE: 'invisible',
};

function connectGateway(token, status, activityType, activityName) {
    if (!token) return;

    const statusStr   = STATUS_MAP[status?.toUpperCase()] || 'online';
    const actTypeNum  = ACTIVITY_TYPE[activityType?.toUpperCase()] ?? 2;

    let heartbeatInterval = null;
    let ws = null;

    function connect() {
        ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');

        ws.on('message', (raw) => {
            const payload = JSON.parse(raw);
            const { op, d, t } = payload;

            // Op 10 — Hello → start heartbeat + identify
            if (op === 10) {
                const interval = d.heartbeat_interval;
                heartbeatInterval = setInterval(() => {
                    ws.send(JSON.stringify({ op: 1, d: null }));
                }, interval);

                // Identify
                ws.send(JSON.stringify({
                    op: 2,
                    d: {
                        token,
                        intents: 0,
                        properties: {
                            os:      'linux',
                            browser: 'disco',
                            device:  'disco',
                        },
                        presence: {
                            status: statusStr,
                            afk:    false,
                            since:  null,
                            activities: [{
                                name: activityName,
                                type: actTypeNum,
                            }],
                        },
                    },
                }));
            }
        });

        ws.on('close', () => {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            // Reconnect sau 5s
            setTimeout(connect, 5000);
        });

        ws.on('error', () => {
            ws.terminate();
        });
    }

    connect();
}

module.exports = { connectGateway };
