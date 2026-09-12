require('dotenv').config();
const cluster    = require('cluster');
const { request: undiciRequest, ProxyAgent } = require('undici');
const logger     = require(__dirname + '/util/logger');
const { connectGateway } = require(__dirname + '/util/gateway');
const fs         = require('fs');
const os         = require('os');

// ── CẤU HÌNH ─────────────────────────────────────────────────────────────────
const PROXY_FILE       = __dirname + '/proxies.txt';
const CODES_FILE       = __dirname + '/codes.json';
const CODE_LENGTH      = 16;
const NUM_CPUS         = os.cpus().length;
const WORKERS_PER_PROC = 300;
const REQ_TIMEOUT      = 800;
const PROXY_MAX_FAIL   = 10;
const STATS_INTERVAL   = 5000;
const SHOW_INVALID     = true;

// Discord bot config từ .env
const DISCORD_TOKEN      = process.env.DISCORD_TOKEN      || '';
const CHANNEL_ID         = process.env.CHANNEL_ID         || '';
const CHANNEL_INVALID_ID = process.env.CHANNEL_INVALID_ID || '';
const OWNER_ID           = process.env.OWNER_ID           || '';
const STATUS             = process.env.STATUS             || 'ONLINE';
const STATUS_NAME        = process.env.STATUS_NAME        || 'Nitro Generator by dzaycrazy';
const STATUS_ACTIVITY    = process.env.STATUS_ACTIVITY    || 'LISTENING';
// ─────────────────────────────────────────────────────────────────────────────

// ── Gửi message Discord qua REST ─────────────────────────────────────────────
async function sendDiscord(channelId, content) {
    if (!DISCORD_TOKEN || !channelId) return;
    try {
        await undiciRequest(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${DISCORD_TOKEN}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({ content }),
            bodyTimeout:    5000,
            headersTimeout: 5000,
        });
    } catch (e) {
        logger.error(`Discord send lỗi: ${e.message}`);
    }
}

// ── Buffer invalid — gộp gửi mỗi 3s vào CHANNEL_INVALID_ID ──────────────────
let invalidBuffer = [];
let invalidTimer  = null;

function queueInvalid(code) {
    invalidBuffer.push(code);
    if (!invalidTimer) {
        invalidTimer = setTimeout(async () => {
            const batch = invalidBuffer.splice(0);
            invalidTimer = null;
            if (!batch.length) return;
            const lines = batch.map(c => `- invalid: ${c}`).join('\n');
            await sendDiscord(CHANNEL_INVALID_ID, `\`\`\`diff\n${lines}\n\`\`\``);
        }, 3000);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
//  PRIMARY
// ══════════════════════════════════════════════════════════════════════════════
if (cluster.isPrimary) {
    logger.info('╔══════════════════════════════════════════════╗');
    logger.info('║     Nitro Checker — CLUSTER EDITION          ║');
    logger.info('╚══════════════════════════════════════════════╝');
    logger.info(`🖥  CPU: ${NUM_CPUS} threads | Processes: ${NUM_CPUS} | Concurrent/proc: ${WORKERS_PER_PROC}`);
    logger.info(`⚡  Tổng concurrent: ${(NUM_CPUS * WORKERS_PER_PROC).toLocaleString()}`);
    logger.info(`🤖  Bot token: ${DISCORD_TOKEN ? '✅ có' : '❌ chưa set'} | Found: ${CHANNEL_ID || 'chưa set'} | Invalid: ${CHANNEL_INVALID_ID || 'chưa set'}`);
    logger.info(`🎮  Status: ${STATUS} | Activity: ${STATUS_ACTIVITY} | Name: ${STATUS_NAME}`);

    // Kết nối Gateway để set presence
    connectGateway(DISCORD_TOKEN, STATUS, STATUS_ACTIVITY, STATUS_NAME);

    try {
        const count = fs.readFileSync(PROXY_FILE, 'utf8')
            .split('\n').map(l => l.trim()).filter(Boolean).length;
        logger.info(`Proxy: ${count.toLocaleString()} — mỗi process tự slice`);
    } catch { logger.warn('Không có proxies.txt'); }

    const working    = [];
    let totalChecked = 0, totalFound = 0, lastChecked = 0;
    const T0         = Date.now();
    const workerMeta = new Map();

    function spawnWorker(procIndex) {
        const w = cluster.fork({ PROC_INDEX: String(procIndex), NUM_CPUS: String(NUM_CPUS) });
        workerMeta.set(w.id, procIndex);
        w.on('message', async (msg) => {
            if (msg.type === 'stat') {
                totalChecked += msg.c;
                totalFound   += msg.f;
            }

            if (msg.type === 'invalid') {
                // In console local
                console.log(`\x1b[36mKhông hợp lệ: ${msg.code}\x1b[0m`);
                // Gửi Discord gộp batch
                queueInvalid(msg.code);
            }

            if (msg.type === 'found') {
                const link = msg.link;

                // Console local
                console.log('\x1b[42m\x1b[30m\x1b[1m%s\x1b[0m', `  ✅  HỢP LỆ: ${link}  `);
                console.log(JSON.stringify(msg.data, null, 2));

                // Lưu file
                working.push(link);
                fs.writeFileSync(CODES_FILE, JSON.stringify(working, null, 2));

                // Gửi Discord — ping owner + link vào CHANNEL_ID
                const mention = OWNER_ID ? `<@${OWNER_ID}>` : '';
                await sendDiscord(
                    CHANNEL_ID,
                    `${mention} 🎉 **TÌM THẤY NITRO!**\n` +
                    `\`\`\`diff\n+ ${link}\n\`\`\``
                );
            }
        });
    }

    for (let i = 0; i < NUM_CPUS; i++) spawnWorker(i);

    cluster.on('exit', (w, code) => {
        const idx = workerMeta.get(w.id) ?? 0;
        workerMeta.delete(w.id);
        logger.warn(`Worker [P${idx}] pid=${w.process.pid} chết (${code}) — restart ngay`);
        spawnWorker(idx);
    });

    setInterval(() => {
        const up  = Math.floor((Date.now() - T0) / 1000);
        const avg = (totalChecked / Math.max(1, up)).toFixed(1);
        const rps = ((totalChecked - lastChecked) / (STATS_INTERVAL / 1000)).toFixed(1);
        lastChecked = totalChecked;
        logger.info(`📊 Check: ${totalChecked.toLocaleString()} | ✅ Found: ${totalFound} | ⚡ ${rps}/s (avg ${avg}/s) | ⏱ ${up}s`);
    }, STATS_INTERVAL);

    process.on('SIGINT',  () => logger.warn('SIGINT — đang chạy tiếp...'));
    process.on('SIGTERM', () => logger.warn('SIGTERM — đang chạy tiếp...'));
    process.on('uncaughtException',  (e) => logger.error(`Primary uncaught: ${e.message}`));
    process.on('unhandledRejection', (e) => logger.error(`Primary rejection: ${e}`));

// ══════════════════════════════════════════════════════════════════════════════
//  WORKER
// ══════════════════════════════════════════════════════════════════════════════
} else {
    const procIndex = parseInt(process.env.PROC_INDEX || '0');
    const numCpus   = parseInt(process.env.NUM_CPUS   || '1');

    let proxies = [];
    try {
        const all = fs.readFileSync(PROXY_FILE, 'utf8')
            .split('\n').map(l => l.trim()).filter(Boolean);
        let rng = procIndex * 1000003 + 7;
        const lcg = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 0x100000000; };
        for (let i = all.length - 1; i > 0; i--) {
            const j = (lcg() * (i + 1)) | 0;
            [all[i], all[j]] = [all[j], all[i]];
        }
        const sz = Math.ceil(all.length / numCpus);
        proxies  = all.slice(procIndex * sz, (procIndex + 1) * sz);
    } catch {}

    let   proxyPtr  = 0;
    const failCount = Object.create(null);

    function nextProxy() {
        const n = proxies.length;
        if (!n) return null;
        for (let i = 0; i < n; i++) {
            const p = proxies[proxyPtr % n];
            proxyPtr++;
            if ((failCount[p] || 0) < PROXY_MAX_FAIL) return p;
        }
        // Full proxy → reset, quay lại từ đầu
        for (const k in failCount) failCount[k] = 0;
        proxyPtr = 0;
        return proxies[0];
    }
    function markFail(p) { failCount[p] = (failCount[p] || 0) + 1; }

    const agentCache = new Map();
    function getAgent(p) {
        if (!p) return undefined;
        if (!agentCache.has(p)) {
            try {
                agentCache.set(p, new ProxyAgent({
                    uri: `http://${p}`,
                    connectTimeout: REQ_TIMEOUT,
                    headersTimeout: REQ_TIMEOUT,
                    bodyTimeout:    REQ_TIMEOUT,
                }));
            } catch { return undefined; }
        }
        return agentCache.get(p);
    }
    function dropAgent(p) {
        if (!p || !agentCache.has(p)) return;
        try { agentCache.get(p).destroy(); } catch {}
        agentCache.delete(p);
    }

    let lc = 0, lf = 0;
    setInterval(() => {
        if (!lc) return;
        process.send({ type: 'stat', c: lc, f: lf });
        lc = 0; lf = 0;
    }, 1000);

    const DICT = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    function genCode() {
        let s = '';
        for (let i = 0; i < CODE_LENGTH; i++) s += DICT[(Math.random() * 62) | 0];
        return s;
    }

    const API = (code) =>
        `https://discord.com/api/v9/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true`;

    function runSlot() {
        const code  = genCode();
        const proxy = nextProxy();
        const agent = getAgent(proxy);

        undiciRequest(API(code), {
            method: 'GET',
            dispatcher: agent,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            bodyTimeout:    REQ_TIMEOUT,
            headersTimeout: REQ_TIMEOUT,
            connectTimeout: REQ_TIMEOUT,
        }).then(async ({ statusCode, body }) => {
            lc++;
            const text = await body.text();

            if (statusCode === 429) {
                if (proxy) markFail(proxy);
                await new Promise(r => setTimeout(r, 400 + ((Math.random() * 600) | 0)));
                return;
            }

            let data;
            try { data = JSON.parse(text); } catch { return; }

            if (data.message === 'You are being rate limited.') {
                if (proxy) markFail(proxy);
                await new Promise(r => setTimeout(r, 400 + ((Math.random() * 600) | 0)));
                return;
            }

            if (data.message && data.message !== 'Unknown Gift Code') return;

            if (!data.message) {
                lf++;
                process.send({ type: 'found', link: `https://discord.gift/${code}`, data });
                return;
            }

            // Không hợp lệ
            if (SHOW_INVALID) {
                process.send({ type: 'invalid', code });
            }

        }).catch(() => {
            lc++;
            if (proxy) { markFail(proxy); dropAgent(proxy); }
        }).finally(() => {
            setImmediate(runSlot);
        });
    }

    process.on('uncaughtException',  (e) => logger.error(`[P${procIndex}] uncaught: ${e.message}`));
    process.on('unhandledRejection', (e) => logger.error(`[P${procIndex}] rejection: ${e}`));

    for (let i = 0; i < WORKERS_PER_PROC; i++) {
        setTimeout(runSlot, (i * 2) | 0);
    }
}
