// src/wire-summary.js
// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-23 THE WIRE COMES HOME (the founder: "Complete the separation now -
// all three"). This is Farmline's OWN wire computation — the faithful port of
// the monitor that lived in zypparserver since 2026-10-09. Until today
// zypparserver held Farmline's DATABASE CREDENTIALS to read this data for the
// CommandCenter card; from today Farmline computes and serves its own story,
// and the cross-platform database credential is RETIRED. The payload shape is
// byte-compatible with the card the CommandCenter already renders.
//
// THE GATE: x-ringaid must be one of WIRE_COMMANDER_IDS (farmline-server/.env)
// — the same commander-identity gate the Zyppar side used, now held HERE.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { conn } = require('./models');
const { farmDay, farmMidnight } = require('./time'); // 2026-10-25 THE UNIFIED FARM TIME — the wire's day keys and the logged-today boundary

// THE CRAWLER CLASSIFICATION (ported from zypparserver's crawlerDetect — the
// same table, so the two platforms' human counts agree).
const CRAWLER_UA_TABLE = [
    [/meta-externalagent/i, 'Meta AI'],
    [/facebookexternalhit/i, 'Facebook'],
    [/GPTBot/i, 'GPTBot (OpenAI)'],
    [/OAI-SearchBot/i, 'OAI-SearchBot (OpenAI)'],
    [/ChatGPT-User/i, 'ChatGPT (OpenAI)'],
    [/Googlebot/i, 'Googlebot'],
    [/bingbot|adidxbot|bingpreview/i, 'Bing'],
    [/Twitterbot/i, 'X (Twitter)'],
    [/LinkedInBot/i, 'LinkedIn'],
    [/Slackbot/i, 'Slack'],
    [/TelegramBot/i, 'Telegram'],
    [/WhatsApp/i, 'WhatsApp'],
    [/Applebot/i, 'Apple'],
    [/YandexBot|YandexMobileBot/i, 'Yandex'],
    [/DuckDuckBot/i, 'DuckDuckGo'],
    [/Amazonbot/i, 'Amazon'],
    [/PerplexityBot/i, 'Perplexity'],
    [/ClaudeBot|Claude-Web/i, 'Claude (Anthropic)'],
    [/Bytespider/i, 'Bytespider (ByteDance)'],
    [/PetalBot/i, 'PetalBot (Huawei)'],
    [/semrush/i, 'Semrush'],
    [/ahrefs/i, 'Ahrefs'],
    [/mj12bot/i, 'Majestic'],
    [/dotbot/i, 'DotBot'],
];
const CRAWLER_UA_MONGO_REGEX = new RegExp(CRAWLER_UA_TABLE.map(([re]) => `(?:${re.source})`).join('|'), 'i');
const CRAWLER_IP_MONGO_REGEX = new RegExp('^(?:57\\.141\\.20\\.|66\\.249\\.(?:6[4-9]|[78][0-9]|9[0-5])\\.)');
const botUa = (ua) => /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|python|curl|wget|headless|monitor/i.test(String(ua || ''));

function _maskIp(ip) {
    const t = String(ip || '');
    return t.includes('.') ? t.split('.').slice(0, 3).join('.') + '.x' : (t.includes(':') ? t.split(':').slice(0, 3).join(':') + '::x' : 'x');
}

// THE DEVICE-ORIGIN REGION (ported verbatim — the audience is East-Africa-heavy).
const TZ_REGION_MAP = [
    [/^Africa\/(Nairobi|Dar_es_Salaam|Kampala|Kigali|Bujumbura|Addis_Ababa|Asmara|Djibouti|Mogadishu|Juba)/, 'East Africa'],
    [/^Africa\/(Kinshasa|Lubumbashi|Bangui|Brazzaville|Libreville|Douala|Malabo|Bata|Luanda)/, 'Central Africa'],
    [/^Africa\/(Lagos|Accra|Abidjan|Dakar|Bamako|Ouagadougou|Niamey|Lome|Cotonou|Conakry|Freetown|Monrovia|Banjul|Nouakchott|Bissau|Sao_Tome)/, 'West Africa'],
    [/^Africa\/(Cairo|Algiers|Tunis|Casablanca|Tripoli|Khartoum|Nouadhibou)/, 'North Africa'],
    [/^Africa\/(Johannesburg|Harare|Lusaka|Gaborone|Windhoek|Maseru|Mbabane|Maputo)/, 'Southern Africa'],
    [/^Africa\//, 'Africa (other)'],
    [/^Europe\//, 'Europe'],
    [/^Asia\//, 'Asia'],
    [/^America\//, 'Americas'],
    [/^Australia\/|^Pacific\//, 'Oceania'],
    [/^Indian\//, 'Indian Ocean'],
];
function regionFromTz(tz) {
    const t = String(tz || '');
    if (!t) return '';
    for (const [re, name] of TZ_REGION_MAP) if (re.test(t)) return name;
    return '';
}

async function computeWireSummary() {
    const now = Date.now();
    const d24 = new Date(now - 24 * 3600 * 1000);
    const d7 = new Date(now - 7 * 86400000);

    const sources = { ledger: 'ok', nginx: 'ok', vision: 'ok', funnel: 'ok', money: 'ok' };

    let byKind = [];
    let uniquesLedger = [];
    let recentVisits = [];
    try {
        const V = conn.db.collection('visits');
        byKind = await V.aggregate([
            { $group: { _id: '$kind', all: { $sum: 1 }, d24: { $sum: { $cond: [{ $gte: ['$at', d24] }, 1, 0] } }, d7: { $sum: { $cond: [{ $gte: ['$at', d7] }, 1, 0] } } } },
            { $sort: { all: -1 } },
        ]).toArray();
        uniquesLedger = await V.aggregate([
            { $group: { _id: { $ifNull: ['$identityId', '$ip'] } } }, { $count: 'n' },
        ]).toArray();
        recentVisits = await V.find({}).project({ at: 1, kind: 1, ip: 1, identityId: 1, ua: 1, ref: 1, countryHint: 1, tz: 1 }).sort({ at: -1 }).limit(24).toArray();
    } catch (e) {
        sources.ledger = 'unreachable';
        console.warn('[farmline-wire] the farmline ledger could not be read:', e?.message || String(e));
    }

    // (b) the nginx shell loads
    const shellByDay = {};
    const shellIps = new Set();
    const shellRefs = {};
    const shellSrcs = {};
    let shellLoads7d = 0;
    const pathsByIp = {};
    const countryOfIp = {};
    const parseLine = (line) => {
        const m = line.match(/^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*"(?: \d+ \d+ "[^"]*" "[^"]*")?/) || line.match(/^(\S+) .+ "(\S+) (\S+)[^"]*"/);
        if (!m) return;
        const ip = m[1];
        const req = m[3] && m[4] ? (m[3] + ' ' + m[4]) : (m[2] || '');
        if (!req.startsWith('GET ')) return;
        const pth = (m[4] || m[2] || '').split(' ')[0];
        if (!/^\/farmline(\/|$|\?)/.test(pth)) return;
        if (/\.(js|css|map|png|jpe?g|svg|gif|woff2?|ttf|json|webmanifest|ico)(\?|$)/i.test(pth)) return;
        shellLoads7d++;
        shellIps.add(ip);
        {
            const tail = line.match(/"([^"]*)"\s*$/);
            const c = tail && /^[A-Za-z]{2}$/.test(tail[1]) ? tail[1].toUpperCase() : '';
            if (c) countryOfIp[ip] = c;
        }
        {
            const clean = (pth.split('?')[0] || '').replace(/^\/farmline/, '') || '/';
            const trail = (pathsByIp[ip] = pathsByIp[ip] || []);
            if (trail[trail.length - 1] !== clean && !trail.includes(clean) && trail.length < 14) trail.push(clean);
        }
        const day = farmDay();
        shellByDay[day] = (shellByDay[day] || 0) + 1;
        const ref = (line.match(/"([^"]*)"[^"]*$/) || [])[1] || '';
        if (ref && ref !== '-') shellRefs[ref.slice(0, 80)] = (shellRefs[ref.slice(0, 80)] || 0) + 1;
        const srcM = pth.match(/[?&]src=([A-Za-z0-9_-]+)/);
        if (srcM) shellSrcs[srcM[1]] = (shellSrcs[srcM[1]] || 0) + 1;
    };
    try {
        const logDir = '/var/log/nginx';
        const files = fs.readdirSync(logDir)
            .filter((f) => f === 'access.log' || /^access\.log-\d{8}\.gz$/.test(f) || /^access\.log\.\d+(\.gz)?$/.test(f))
            .sort().slice(-3);
        for (const f of files.reverse()) {
            const full = path.join(logDir, f);
            if (f.endsWith('.gz')) {
                try {
                    const zlib = require('zlib');
                    const txt = zlib.gunzipSync(fs.readFileSync(full)).toString('utf8');
                    for (const line of txt.split('\n')) if (line.includes('/farmline')) parseLine(line);
                } catch { /* unreadable archive — skip */ }
            } else {
                const txt = fs.readFileSync(full, 'utf8');
                for (const line of txt.split('\n')) if (line.includes('/farmline')) parseLine(line);
            }
        }
    } catch (e) {
        sources.nginx = 'unreadable';
    }

    // (c) the demo vision spend
    let visionSpend = null;
    try {
        const day = farmDay();
        const mc = await conn.db.collection('metacounters').findOne({ key: 'vision-demo' });
        const today = mc && mc.day === day ? (mc.count || 0) : 0;
        const threshold = Number(process.env.FARMLINE_VISION_DEMO_THRESHOLD || '20') || 20;
        visionSpend = { today, threshold, day };
    } catch { sources.vision = 'unavailable'; }

    // (d) the funnel and the ladder
    let funnel = null;
    let money = null;
    try {
        const d7ago = new Date(now - 7 * 86400000);
        const d30ago = new Date(now - 30 * 86400000);
        const midnight = farmMidnight();
        const today = farmDay();
        const dbIdentity = {
            name: String(conn.db?.databaseName || conn.name || ''),
            host: String(conn.host || '') + (conn.port ? ':' + conn.port : ''),
        };
        const F = conn.db.collection('farms');
        const L = conn.db.collection('logs');
        const Z = conn.db.collection('zuclaims');
        const G = conn.db.collection('ledgers');
        const Vv = conn.db.collection('visits');

        const [byRung, paidLive, lapsed, farmTotal, uniqueKinds, botByKind, everLoggedAgg, logged7dAgg] = await Promise.all([
            F.aggregate([{ $match: { isDemo: { $ne: true } } }, { $group: { _id: '$rung', n: { $sum: 1 } } }]).toArray(),
            F.countDocuments({ isDemo: { $ne: true }, rung: { $gt: 2 }, rungPaidUntil: { $gt: new Date(now) } }),
            F.countDocuments({
                isDemo: { $ne: true },
                rung: { $gt: 2 },
                rungPaidUntil: { $not: { $gt: new Date(now) } },
                rungProvisionalUntil: { $not: { $gt: new Date(now) } },
            }),
            F.countDocuments({ isDemo: { $ne: true } }),
            Vv.aggregate([
                { $match: { at: { $gte: d30ago }, $nor: [{ ua: CRAWLER_UA_MONGO_REGEX }, { ip: CRAWLER_IP_MONGO_REGEX }] } },
                { $group: { _id: { kind: '$kind', person: { $ifNull: ['$identityId', '$ip'] } } } },
                { $group: { _id: '$_id.kind', n: { $sum: 1 } } },
            ]).toArray(),
            Vv.aggregate([
                { $match: { at: { $gte: d30ago }, $or: [{ ua: CRAWLER_UA_MONGO_REGEX }, { ip: CRAWLER_IP_MONGO_REGEX }] } },
                { $group: { _id: '$kind', n: { $sum: 1 } } },
                { $sort: { n: -1 } },
            ]).toArray(),
            L.aggregate([{ $match: { estimated: { $ne: true } } }, { $group: { _id: '$farmId' } }, { $count: 'n' }]).toArray(),
            L.aggregate([
                { $match: { at: { $gte: d7ago }, estimated: { $ne: true } } },
                { $group: { _id: '$farmId' } }, { $count: 'n' },
            ]).toArray(),
        ]);

        const u = (k) => (uniqueKinds.find((x) => x._id === k)?.n || 0);
        const RATE_FLOOR = 5;
        const pct = (a, b) => (b >= RATE_FLOOR ? Math.round((a / b) * 1000) / 10 : null);

        // (e-1) the share pulse
        let pulse = [];
        let pulseError = null;
        try {
            const [srcSets, regIps] = await Promise.all([
                Vv.aggregate([
                    { $match: { at: { $gte: d30ago }, src: { $nin: ['', null] } } },
                    { $group: { _id: { src: '$src', person: { $ifNull: ['$identityId', '$ip'] } } } },
                    { $group: { _id: '$_id.src', ips: { $addToSet: { $toString: '$_id.person' } } } },
                ]).toArray(),
                Vv.aggregate([
                    { $match: { kind: 'register', at: { $gte: d30ago } } },
                    { $group: { _id: { $ifNull: ['$identityId', '$ip'] } } },
                ]).toArray(),
            ]);
            const regSet = new Set((regIps || []).filter(Boolean).map((x) => String(x._id !== undefined ? x._id : x)));
            pulse = (srcSets || []).map((r) => {
                const ips = (r.ips || []).filter(Boolean).map((x) => String(x));
                const regs = ips.filter((ip) => regSet.has(ip)).length;
                return {
                    src: String(r._id || ''),
                    opens: ips.length,
                    registered: regs,
                    rate: ips.length >= RATE_FLOOR ? Math.round((regs / ips.length) * 1000) / 10 : null,
                };
            }).sort((a, b) => b.opens - a.opens);
        } catch (e) {
            pulse = null;
            pulseError = String(e?.message || e).slice(0, 90);
        }

        // (e-2) THE PERSON-LEVEL SHARE PULSE (Round 4): a share link carries
        // `?by=<sharer identity id>` and the receiver's boot beacon stores it
        // as `refId` — so the wire can say "Jane's share moved 3 people",
        // not just "3 arrivals via share-line". Keyed on the sharer's identity.
        let referrers = null;
        let referrersError = null;
        try {
            const refMatch = { at: { $gte: d30ago }, refId: { $exists: true, $nin: ['', null] } };
            const [arrAgg, regAgg] = await Promise.all([
                Vv.aggregate([
                    { $match: refMatch },
                    { $group: { _id: '$refId', arrivals: { $addToSet: { $toString: { $ifNull: ['$identityId', '$ip'] } } } } },
                ]).toArray(),
                Vv.aggregate([
                    { $match: { ...refMatch, kind: 'register' } },
                    { $group: { _id: '$refId', registered: { $addToSet: { $toString: { $ifNull: ['$identityId', '$ip'] } } } } },
                ]).toArray(),
            ]);
            const map = new Map();
            for (const r of arrAgg || []) {
                map.set(String(r._id), { arrivals: (r.arrivals || []).filter(Boolean).length, registered: 0 });
            }
            for (const r of regAgg || []) {
                const e = map.get(String(r._id));
                if (e) e.registered = (r.registered || []).filter(Boolean).length;
            }
            const ids = [...map.keys()]
                .map((x) => { try { return new (require('mongodb').ObjectId)(x); } catch { return null; } })
                .filter(Boolean);
            const idDocs = ids.length
                ? await conn.db.collection('visitoridentities').find({ _id: { $in: ids } })
                    .project({ deviceId: 1, isGuest: 1, memberId: 1 }).toArray()
                : [];
            const memberIds = idDocs.map((d) => d.memberId).filter(Boolean);
            const memberDocs = memberIds.length
                ? await conn.db.collection('members').find({ _id: { $in: memberIds } })
                    .project({ name: 1 }).toArray()
                : [];
            const memberName = new Map((memberDocs || []).map((m) => [String(m._id), String(m.name || '')]));
            const idMeta = new Map((idDocs || []).map((d) => [String(d._id), d]));
            referrers = [...map.entries()].map(([id, e]) => {
                const doc = idMeta.get(id) || {};
                return {
                    refId: id.slice(-6),
                    name: memberName.get(String(doc.memberId || '')) || null,
                    isGuest: doc.isGuest !== false,
                    device: String(doc.deviceId || '').slice(-6),
                    arrivals: e.arrivals,
                    registered: e.registered,
                    rate: e.arrivals >= RATE_FLOOR ? Math.round((e.registered / e.arrivals) * 1000) / 10 : null,
                };
            }).sort((a, b) => b.arrivals - a.arrivals).slice(0, 20);
        } catch (e) {
            referrers = null;
            referrersError = String(e?.message || e).slice(0, 90);
        }

        // (d-3) who came, and where they went
        const deviceOf = (ua) => {
            const uu = String(ua || '');
            if (!uu) return 'unknown device';
            const os = /Android/i.test(uu) ? 'Android' : /iPhone|iPad|iPod/i.test(uu) ? 'iOS'
                : /Windows/i.test(uu) ? 'Windows' : /Mac OS X|Macintosh/i.test(uu) ? 'Mac'
                    : /Linux/i.test(uu) ? 'Linux' : 'other';
            const br = /Edg\//i.test(uu) ? 'Edge' : /OPR\//i.test(uu) ? 'Opera' : /Chrome\//i.test(uu) ? 'Chrome'
                : /Firefox\//i.test(uu) ? 'Firefox' : /Safari\//i.test(uu) ? 'Safari' : '?';
            return os + ' / ' + br;
        };

        let visitors = [];
        let visitorsError = null;
        try {
            let people = [];
            try {
                const [mem, cus] = await Promise.all([
                    conn.db.collection('members').find({ createdAt: { $gte: d30ago } })
                        .project({ phone: 1, name: 1, createdAt: 1 }).limit(400).toArray(),
                    conn.db.collection('customers').find({ createdAt: { $gte: d30ago } })
                        .project({ phone: 1, name: 1, createdAt: 1 }).limit(400).toArray(),
                ]);
                people = [
                    ...(mem || []).map((m) => ({ kind: 'farmer', phone: String(m.phone || ''), name: String(m.name || ''), at: m.createdAt ? new Date(m.createdAt).getTime() : 0 })),
                    ...(cus || []).map((c) => ({ kind: 'buyer', phone: String(c.phone || ''), name: String(c.name || ''), at: c.createdAt ? new Date(c.createdAt).getTime() : 0 })),
                ].filter((p) => p.at);
            } catch { /* the join is a bonus */ }

            const agg = await Vv.aggregate([
                { $match: { at: { $gte: d30ago } } },
                { $sort: { at: 1 } },
                {
                    $group: {
                        _id: { $ifNull: ['$identityId', '$ip'] },
                        first: { $min: '$at' }, last: { $max: '$at' }, n: { $sum: 1 },
                        kinds: { $push: '$kind' },
                        times: { $push: '$at' },
                        src: { $last: '$src' }, ref: { $last: '$ref' },
                        ua: { $last: '$ua' }, ip: { $last: '$ip' },
                        countryHint: { $last: '$countryHint' }, tz: { $last: '$tz' }, locale: { $last: '$locale' },
                    },
                },
                { $sort: { last: -1 } },
                { $limit: 40 },
            ]).toArray();
            visitors = (agg || []).map((r) => {
                const isIdentity = !!r._id && typeof r._id !== 'string' && !!r._id.toHexString;
                const identity = isIdentity ? String(r._id) : '';
                const ip = String((r.ip) || (isIdentity ? '' : r._id) || '');
                const ua = String((r.ua) || '');
                const kinds = (r.kinds || []).map((k) => String(k || ''));
                const doors = [];
                for (const k of kinds) if (doors[doors.length - 1] !== k) doors.push(k);
                return {
                    ip: ip || '(unknown)',
                    identity,
                    country: countryOfIp[ip] || '',
                    countryHint: String(r.countryHint || ''),
                    tz: String(r.tz || ''),
                    locale: String(r.locale || ''),
                    region: regionFromTz(String(r.tz || '')),
                    person: (() => {
                        if (!kinds.length) return null;
                        const WINDOW = 20 * 60000;
                        for (let i = 0; i < kinds.length; i++) {
                            const k = kinds[i];
                            if (k !== 'register' && k !== 'login' && k !== 'customer') continue;
                            const t = (r.times && r.times[i]) ? new Date(r.times[i]).getTime() : 0;
                            if (!t) continue;
                            let best = null, bestMs = Infinity, within = 0;
                            for (const p of people) {
                                const d = Math.abs(p.at - t);
                                if (d <= WINDOW) { within++; if (d < bestMs) { bestMs = d; best = p; } }
                            }
                            if (best) return { name: best.name, phone: best.phone, kind: best.kind, minutesApart: Math.round(bestMs / 60000), ambiguous: within > 1, windowMin: 20 };
                        }
                        return null;
                    })(),
                    device: deviceOf(ua),
                    bot: botUa(ua),
                    first: r.first, last: r.last, arrivals: r.n,
                    doors: doors.slice(0, 10),
                    doorsMore: doors.length > 10,
                    doorsTotal: doors.length,
                    paths: (pathsByIp[ip] || []).slice(0, 12),
                    src: String(r.src || ''), ref: String(r.ref || '').slice(0, 60),
                    registered: kinds.includes('register'),
                    demo: kinds.includes('demo'),
                    survey: kinds.some((k) => k.indexOf('meeting-') === 0),
                    buyer: kinds.includes('customer'),
                };
            });
        } catch (e) {
            visitors = [];
            visitorsError = String(e?.message || e).slice(0, 90);
        }

        // (d-2) the prior window
        const d14ago = new Date(now - 14 * 86400000);
        let priorByKind = [];
        try {
            priorByKind = await Vv.aggregate([
                { $match: { at: { $gte: d14ago, $lt: d7ago }, $nor: [{ ua: CRAWLER_UA_MONGO_REGEX }, { ip: CRAWLER_IP_MONGO_REGEX }] } },
                { $group: { _id: '$kind', n: { $sum: 1 } } },
            ]).toArray();
        } catch { priorByKind = []; }

        const rungN = (r) => (byRung.find((x) => (x._id || 0) === r)?.n || 0);

        // (d-4) the wire integrity markers
        let newFarms7d = null;
        try {
            newFarms7d = await F.countDocuments({ isDemo: { $ne: true }, createdAt: { $gte: d7ago } });
        } catch { newFarms7d = null; }
        let d7return = null;
        try {
            const [cohortIps, activeIps] = await Promise.all([
                Vv.distinct('ip', { kind: 'register', at: { $lte: d7ago } }),
                Vv.distinct('ip', { at: { $gte: d7ago } }),
            ]);
            const active = new Set((activeIps || []).filter(Boolean).map((x) => String(x)));
            const cohortList = (cohortIps || []).filter(Boolean).map((x) => String(x));
            const returned = cohortList.filter((ip) => active.has(ip)).length;
            d7return = { cohort: cohortList.length, returned, rate: pct(returned, cohortList.length) };
        } catch { d7return = null; }

        // (d-4) the device origin facet
        let origin = { countries: [], regions: [], byTz: [], note: '' };
        try {
            const [cAgg, tzAgg] = await Promise.all([
                Vv.aggregate([
                    { $match: { at: { $gte: d7 }, countryHint: { $exists: true, $nin: ['', null] }, $nor: [{ ua: CRAWLER_UA_MONGO_REGEX }, { ip: CRAWLER_IP_MONGO_REGEX }] } },
                    { $group: { _id: '$countryHint', n: { $sum: 1 } } },
                    { $sort: { n: -1 } }, { $limit: 14 },
                ]).toArray(),
                Vv.aggregate([
                    { $match: { at: { $gte: d7 }, tz: { $exists: true, $nin: ['', null] }, $nor: [{ ua: CRAWLER_UA_MONGO_REGEX }, { ip: CRAWLER_IP_MONGO_REGEX }] } },
                    { $group: { _id: '$tz', n: { $sum: 1 } } },
                    { $sort: { n: -1 } }, { $limit: 14 },
                ]).toArray(),
            ]);
            const regionCounts = {};
            for (const r of (tzAgg || [])) {
                const reg = regionFromTz(String(r._id || ''));
                if (reg) regionCounts[reg] = (regionCounts[reg] || 0) + (r.n || 0);
            }
            origin = {
                countries: (cAgg || []).map((r) => ({ country: String(r._id || ''), n: r.n || 0 })),
                regions: Object.entries(regionCounts).map(([region, n]) => ({ region, n })).sort((a, b) => b.n - a.n),
                byTz: (tzAgg || []).map((r) => ({ tz: String(r._id || ''), n: r.n || 0 })),
                note: 'device-declared (OS locale subtag + IANA timezone) — human devices, 7 days; old rows predate the fields',
            };
        } catch { origin = { countries: [], regions: [], byTz: [], note: 'the origin read failed — reported, never a zero' }; }

        funnel = {
            farms: farmTotal,
            db: dbIdentity,
            byRung: [0, 1, 2, 3, 4, 5, 6].map((r) => ({ rung: r, n: rungN(r) })),
            paidRungsLive: paidLive,
            lapsedRungs: lapsed,
            everLogged: everLoggedAgg[0]?.n || 0,
            logged7d: logged7dAgg[0]?.n || 0,
            loggedToday: await L.aggregate([
                { $match: { at: { $gte: midnight }, estimated: { $ne: true } } },
                { $group: { _id: '$farmId' } }, { $count: 'n' },
            ]).toArray().then((a) => a[0]?.n || 0),
            unique: { shell: u('shell'), demo: u('demo'), registered: u('register'), buyers: u('customer') },
            bots: {
                rows: botByKind.reduce((a, r) => a + (r.n || 0), 0),
                byKind: botByKind.map((r) => ({ kind: r._id || 'unknown', n: r.n || 0 })),
            },
            uniqueNote: 'human devices only — crawlers excluded here and counted separately',
            pulse,
            pulseError,
            referrers,
            referrersError,
            prior: {
                byKind: priorByKind.map((r) => ({ kind: r._id || 'unknown', n: r.n || 0 })),
                note: 'the 7 days before the current 7 — human only, so a crawler surge cannot look like growth',
            },
            visitors,
            visitorsError,
            origin,
            rateFloor: RATE_FLOOR,
            rate: {
                shellToRegister: pct(u('register'), u('shell')),
                demoToRegister: pct(u('register'), u('demo')),
                activatedPct: pct((everLoggedAgg[0]?.n || 0), farmTotal),
                active7dPct: pct((logged7dAgg[0]?.n || 0), farmTotal),
            },
            reconcile: {
                farms: farmTotal,
                registerEventsAll: (byKind.find((k) => k.kind === 'register')?.all) || 0,
                registerDevices30d: u('register'),
                note: 'farms = the farms collection (demo excluded) · register events = the visits ledger, all time — events ≠ farms (retries, repeat devices) · devices = unique human registering devices, 30d',
            },
            arrivals24h: byKind.reduce((a, r) => a + (Number(r.d24) || 0), 0),
            newFarms7d,
            d7return,
        };

        // (e) the money
        const [claimAgg, credited, spent, allowances, paidRungs, oldestWaiting] = await Promise.all([
            Z.aggregate([{ $group: { _id: '$status', n: { $sum: 1 }, zu: { $sum: '$zu' } } }]).toArray(),
            G.aggregate([{ $match: { createdAt: { $gte: d7ago }, status: 'settled', direction: 'in' } }, { $group: { _id: null, zu: { $sum: '$amountZU' } } }]).toArray(),
            G.aggregate([{ $match: { createdAt: { $gte: d7ago }, status: 'settled', direction: 'out' } }, { $group: { _id: null, zu: { $sum: '$amountZU' } } }]).toArray(),
            G.countDocuments({ dailyKey: today }),
            F.countDocuments({ isDemo: { $ne: true }, rungPaidUntil: { $gt: new Date(now) } }),
            Z.find({ status: 'claimed' }).sort({ createdAt: 1 }).limit(1).toArray(),
        ]);
        const [creditsPrior, spendsPrior] = await Promise.all([
            G.aggregate([{ $match: { createdAt: { $gte: d14ago, $lt: d7ago }, status: 'settled', direction: 'in' } }, { $group: { _id: null, zu: { $sum: '$amountZU' } } }]).toArray(),
            G.aggregate([{ $match: { createdAt: { $gte: d14ago, $lt: d7ago }, status: 'settled', direction: 'out' } }, { $group: { _id: null, zu: { $sum: '$amountZU' } } }]).toArray(),
        ]);
        const c = (st) => claimAgg.find((x) => x._id === st)?.n || 0;
        const czu = (st) => claimAgg.find((x) => x._id === st)?.zu || 0;
        const pending = c('claimed');

        money = {
            claims: { pending, confirmed: c('confirmed'), rejected: c('rejected'), zuConfirmed: czu('confirmed') },
            zuCredited7d: credited[0]?.zu || 0,
            zuCredited7dPrior: creditsPrior[0]?.zu || 0,
            zuSpent7dPrior: spendsPrior[0]?.zu || 0,
            zuSpent7d: spent[0]?.zu || 0,
            allowancesToday: allowances,
            paidRungsLive: paidRungs,
            awaitingConfirm: pending,
            oldestWaitHours: oldestWaiting[0]?.createdAt
                ? Math.round((now - new Date(oldestWaiting[0].createdAt).getTime()) / 3600000)
                : null,
        };
    } catch (e) {
        sources.funnel = 'unreachable';
        sources.money = 'unreachable';
        console.warn('[farmline-wire] the funnel/money blocks could not be read:', e?.message || String(e));
    }

    return {
        ok: Object.values(sources).some((v) => v === 'ok'),
        sources,
        ledger: {
            byKind: byKind.map((r) => ({ kind: r._id || 'unknown', all: r.all, d24: r.d24, d7: r.d7 })),
            uniques: uniquesLedger[0]?.n || 0,
            recent: recentVisits.map((r) => ({
                at: r.at, kind: r.kind, ip: _maskIp(r.ip),
                ua: String(r.ua || '').slice(0, 60), ref: String(r.ref || '').slice(0, 100),
            })),
        },
        shell: {
            loads: shellLoads7d,
            uniques: shellIps.size,
            byDay: Object.entries(shellByDay).map(([day, n]) => ({ day, n })),
            refs: Object.entries(shellRefs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([ref, n]) => ({ ref, n })),
            srcs: Object.entries(shellSrcs).sort((a, b) => b[1] - a[1]).map(([src, n]) => ({ src, n })),
        },
        visionSpend,
        funnel,
        money,
    };
}

/** THE GATE: x-ringaid must be one of WIRE_COMMANDER_IDS (farmline-server/.env).
 *  2026-10-24 FIX: read through the config's envVar — the process env does NOT
 *  carry the .env values on this host (the config reads the env FILES itself),
 *  so the raw process.env read 403'd every caller. The config helper resolves
 *  process.env first, then the env files — the same path the mongo URI uses. */
/** THE VISITOR TRAIL (2026-10-25, the founder's directive #3, verbatim: "At
 *  this early stage I should see where they came from, where they went and
 *  all details looged by just tapping their line item") — ONE person's full
 *  beacon trail. The key is the wire's OWN person key: an identity id (the
 *  deviceId-cut person) or an ip (the ip-era rows). Same commander gate as
 *  the wire; the identity doc rides along so the tap answers WHO it is (the
 *  deviceId's last six, the guest state, the adopted feedback thread, the
 *  member/customer join). Never fabricates: an unknown key reads empty.
 */
async function visitorTrailHandler(req, res) {
    const allowed = String(require('./config').envVar('WIRE_COMMANDER_IDS') || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
    const caller = String((req.headers && (req.headers['x-ringaid'] || req.headers['X-Ringaid'])) || '');
    if (!allowed.length || !allowed.includes(caller)) {
        return res.status(403).json({ ok: false, error: 'not a wire commander' });
    }
    try {
        const { ObjectId } = require('mongodb');
        const idHex = String((req.query && req.query.id) || '').trim();
        const ipQ = String((req.query && req.query.ip) || '').trim();
        if (!idHex && !ipQ) return res.status(400).json({ ok: false, error: 'no person key given' });
        const isId = !!idHex && /^[0-9a-f]{24}$/i.test(idHex);
        const V = conn.db.collection('visits');
        const filter = isId ? { identityId: new ObjectId(idHex) } : { identityId: null, ip: ipQ.slice(0, 64) };
        const rows = await V.find(filter)
            .project({ at: 1, kind: 1, ip: 1, ua: 1, ref: 1, src: 1, tz: 1, locale: 1, countryHint: 1 })
            .sort({ at: 1 }).limit(300).toArray();
        let person = null;
        if (isId) {
            const doc = await conn.db.collection('visitoridentities').findOne({ _id: new ObjectId(idHex) });
            if (doc) {
                person = {
                    id: String(doc._id),
                    deviceId: String(doc.deviceId || '').slice(-6), // the card's convention: last six only
                    isGuest: doc.isGuest !== false,
                    feedbackId: String(doc.feedbackId || ''),
                    memberId: doc.memberId ? String(doc.memberId) : null,
                    customerId: doc.customerId ? String(doc.customerId) : null,
                    locale: String(doc.locale || ''), tz: String(doc.tz || ''),
                    createdAt: doc.createdAt || null, lastSeenAt: doc.lastSeenAt || null,
                };
            }
        }
        return res.status(200).json({ ok: true, key: isId ? ('id:' + idHex.slice(-6)) : ('ip:' + ipQ), person, trail: rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: 'the trail could not be read', detail: String(e?.message || e).slice(0, 120) });
    }
}

async function wireSummaryHandler(req, res) {
    const allowed = String(require('./config').envVar('WIRE_COMMANDER_IDS') || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
    const caller = String((req.headers && (req.headers['x-ringaid'] || req.headers['X-Ringaid'])) || '');
    if (!allowed.length || !allowed.includes(caller)) {
        return res.status(403).json({ ok: false, error: 'not a wire commander' });
    }
    try {
        const payload = await computeWireSummary();
        return res.status(200).json(payload);
    } catch (e) {
        return res.status(500).json({ ok: false, error: 'the wire could not be computed', detail: String(e?.message || e).slice(0, 120) });
    }
}

module.exports = { wireSummaryHandler, visitorTrailHandler };
