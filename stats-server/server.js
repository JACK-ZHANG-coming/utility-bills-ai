/**
 * 访问统计后端服务
 * 零依赖（纯 Node.js），数据存 SQLite
 * 端口: 3210 (通过 Nginx 反代 /api/* 到此服务)
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const Database = require('better-sqlite3');

// ---------- 配置 ----------
const PORT = 3210;
const DB_PATH = __dirname + '/analytics.db';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(16).toString('hex');
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';
if (!ACCESS_TOKEN) {
    console.error('[Stats] FATAL: ACCESS_TOKEN 环境变量未设置，服务拒绝启动。');
    console.error('[Stats] 请在 analytics.service 中配置 Environment=ACCESS_TOKEN=xxx');
    process.exit(1);
}

// ---------- 简易限流（防止 /api/track 被刷数据） ----------
const rateLimitMap = new Map(); // key: IP -> { count, resetAt }
const RATE_LIMIT_WINDOW = 60_000;  // 60 秒
const RATE_LIMIT_MAX = 30;         // 每窗口最多 30 条
setInterval(() => { // 定期清理过期条目
    if (rateLimitMap.size > 10000) rateLimitMap.clear();
}, 300_000);

// ---------- 数据库初始化 ----------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        event TEXT NOT NULL,
        vid TEXT NOT NULL,
        sid TEXT NOT NULL,
        url TEXT,
        path TEXT,
        title TEXT,
        referrer TEXT,
        source TEXT,
        device TEXT,
        browser TEXT,
        os TEXT,
        screen TEXT,
        lang TEXT,
        tz TEXT,
        dwell_time INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
    CREATE INDEX IF NOT EXISTS idx_events_event ON events(event);
    CREATE INDEX IF NOT EXISTS idx_events_vid ON events(vid);
    CREATE INDEX IF NOT EXISTS idx_events_sid ON events(sid);
    CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
`);

// 预编译常用 SQL
const insertEvent = db.prepare(`
    INSERT INTO events (ts, event, vid, sid, url, path, title, referrer, source, device, browser, os, screen, lang, tz, dwell_time)
    VALUES (@ts, @event, @vid, @sid, @url, @path, @title, @referrer, @source, @device, @browser, @os, @screen, @lang, @tz, @dwell_time)
`);

// ---------- CORS ----------
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ---------- 路由 ----------
const server = http.createServer((req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        return res.end();
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // ---- POST /api/track : 接收埋点数据 ----
    if (req.method === 'POST' && pathname === '/api/track') {
        // 限流检查
        const clientIP = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        const now = Date.now();
        let rl = rateLimitMap.get(clientIP);
        if (!rl || rl.resetAt < now) {
            rl = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
            rateLimitMap.set(clientIP, rl);
        }
        rl.count++;
        if (rl.count > RATE_LIMIT_MAX) {
            res.writeHead(429, { 'Content-Type': 'application/json', ...CORS_HEADERS });
            return res.end('{"error":"too many requests"}');
        }

        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
        req.on('end', () => {
            try {
                const d = JSON.parse(body);
                // 数据清洗
                const row = {
                    ts: Math.min(Number(d.timestamp) || Date.now(), Date.now() + 5000),
                    event: String(d.event || 'pageview').slice(0, 32),
                    vid: String(d.vid || '').slice(0, 64),
                    sid: String(d.sid || '').slice(0, 64),
                    url: String(d.url || '').slice(0, 2048),
                    path: String(d.path || '').slice(0, 512),
                    title: String(d.title || '').slice(0, 256),
                    referrer: String(d.referrer || '').slice(0, 2048),
                    source: String(d.source || 'direct').slice(0, 64),
                    device: String(d.device || 'unknown').slice(0, 16),
                    browser: String(d.browser || 'unknown').slice(0, 16),
                    os: String(d.os || 'unknown').slice(0, 16),
                    screen: String(d.screen || '').slice(0, 32),
                    lang: String(d.lang || 'zh-CN').slice(0, 16),
                    tz: String(d.tz || 'Asia/Shanghai').slice(0, 64),
                    dwell_time: Number(d.dwellTime) || 0,
                };
                insertEvent.run(row);
                res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
                res.end('{"ok":true}');
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json', ...CORS_HEADERS });
                res.end('{"error":"bad request"}');
            }
        });
        return;
    }

    // ---- GET /api/stats : 统计查询（需要 Bearer token） ----
    if (req.method === 'GET' && pathname === '/api/stats') {
        // 仅从 Authorization header 读取，不读 URL 参数（避免 token 泄露到日志）
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (token !== ACCESS_TOKEN) {
            res.writeHead(401, { 'Content-Type': 'application/json', ...CORS_HEADERS });
            return res.end('{"error":"unauthorized"}');
        }

        const days = Math.min(parseInt(url.searchParams.get('days')) || 7, 365);
        const now = Date.now();
        const since = now - days * 86400000;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayTs = todayStart.getTime();

        try {
            // 今日数据
            const todayPV = db.prepare('SELECT COUNT(*) as c FROM events WHERE event=? AND ts>=?').get('pageview', todayTs).c;
            const todayUV = db.prepare('SELECT COUNT(DISTINCT vid) as c FROM events WHERE event=? AND ts>=?').get('pageview', todayTs).c;

            // 总数据
            const totalPV = db.prepare('SELECT COUNT(*) as c FROM events WHERE event=?').get('pageview').c;
            const totalUV = db.prepare('SELECT COUNT(DISTINCT vid) as c FROM events WHERE event=?').get('pageview').c;

            // 每日趋势
            const dailyTrend = db.prepare(`
                SELECT date(ts/1000, 'unixepoch', 'localtime') as date,
                       COUNT(*) as pv,
                       COUNT(DISTINCT vid) as uv
                FROM events
                WHERE event='pageview' AND ts >= ?
                GROUP BY date ORDER BY date
            `).all(since);

            // 来源分布
            const sources = db.prepare(`
                SELECT source, COUNT(*) as pv, COUNT(DISTINCT vid) as uv
                FROM events
                WHERE event='pageview' AND ts >= ?
                GROUP BY source ORDER BY pv DESC
            `).all(since);

            // 设备分布
            const devices = db.prepare(`
                SELECT device, COUNT(*) as pv, COUNT(DISTINCT vid) as uv
                FROM events
                WHERE event='pageview' AND ts >= ?
                GROUP BY device ORDER BY pv DESC
            `).all(since);

            // 浏览器分布
            const browsers = db.prepare(`
                SELECT browser, COUNT(*) as pv, COUNT(DISTINCT vid) as uv
                FROM events
                WHERE event='pageview' AND ts >= ?
                GROUP BY browser ORDER BY pv DESC
            `).all(since);

            // 操作系统分布
            const oses = db.prepare(`
                SELECT os, COUNT(*) as pv, COUNT(DISTINCT vid) as uv
                FROM events
                WHERE event='pageview' AND ts >= ?
                GROUP BY os ORDER BY pv DESC
            `).all(since);

            // 平均停留时间（基于 dwell 事件）
            const avgDwell = db.prepare(`
                SELECT AVG(dwell_time) as avg, MAX(dwell_time) as max
                FROM events
                WHERE event='dwell' AND ts >= ? AND dwell_time > 0
            `).get(since);

            // 最近访问记录
            const recent = db.prepare(`
                SELECT ts, vid, event, source, device, browser, os, screen, referrer, url, dwell_time
                FROM events
                ORDER BY ts DESC
                LIMIT 50
            `).all();

            const result = {
                today: { pv: todayPV, uv: todayUV },
                total: { pv: totalPV, uv: totalUV },
                avgDwellTime: avgDwell.avg || 0,
                maxDwellTime: avgDwell.max || 0,
                dailyTrend,
                sources,
                devices,
                browsers,
                oses,
                recent: recent.map(r => ({
                    ...r,
                    ts: r.ts,
                    timeStr: new Date(r.ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
                    dwellSeconds: r.dwell_time ? Math.round(r.dwell_time / 1000) : 0,
                })),
            };

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS });
            res.end(JSON.stringify(result));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json', ...CORS_HEADERS });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // ---- GET /dashboard : 本地调试用，serve dashboard.html（同源避免 CORS） ----
    if (req.method === 'GET' && (pathname === '/dashboard' || pathname === '/dashboard.html')) {
        try {
            const html = fs.readFileSync(__dirname + '/dashboard.html');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS });
            return res.end(html);
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'dashboard.html not found: ' + e.message }));
        }
    }

    // ---- GET /api/health : 健康检查 ----
    if (req.method === 'GET' && pathname === '/api/health') {
        const count = db.prepare('SELECT COUNT(*) as c FROM events').get().c;
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        return res.end(JSON.stringify({ status: 'ok', events: count }));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Stats] Server running on http://127.0.0.1:${PORT}`);
    console.log(`[Stats] Admin token: ${ADMIN_TOKEN}`);
    console.log(`[Stats] Access token: ${ACCESS_TOKEN}`);
});
