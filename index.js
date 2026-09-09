const express = require('express');
const axios = require('axios');
const compression = require('compression');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const app = express();

// تفعيل trust proxy ليقرأ Express بروتوكول HTTPS بشكل صحيح على Railway
app.set('trust proxy', true);

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'my-super-secret-streaming-key-2026';
const TOKEN_EXPIRY_HOURS = 2;

// ==========================================
// 1. نظام الاتصالات
// ==========================================
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 20, keepAliveMsecs: 10000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20, keepAliveMsecs: 10000 });

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const axiosInstance = axios.create({
    httpAgent,
    httpsAgent,
    timeout: 10000,
    maxRedirects: 10,
});

// ==========================================
// 2. الكاش الذكي
// ==========================================
class SmartCache {
    constructor(maxItems = 300, defaultTtlMs = 60000) {
        this.maxItems = maxItems;
        this.defaultTtlMs = defaultTtlMs;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return null;
        const item = this.cache.get(key);
        if (Date.now() > item.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        this.cache.delete(key);
        this.cache.set(key, item);
        return item.data;
    }

    getStale(key) {
        if (!this.cache.has(key)) return null;
        return this.cache.get(key).data;
    }

    set(key, data, ttlMs = this.defaultTtlMs) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxItems) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
        this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
    }
}

const manifestCache = new SmartCache(50, 3000); 
const tsCache = new SmartCache(400, 45000);

const manifestPromises = new Map();
const tsPromises = new Map();
const cooldowns = new Map();

function isCoolingDown(url) {
    const until = cooldowns.get(url);
    if (!until) return false;
    if (Date.now() > until) {
        cooldowns.delete(url);
        return false;
    }
    return true;
}

function setCooldown(url, durationMs = 4000) {
    cooldowns.set(url, Date.now() + durationMs);
}

// ==========================================
// 3. الميدل وير وتسهيل مسارات الـ URLs
// ==========================================

app.use(compression({
    filter: (req, res) => {
        if (req.path.startsWith('/segment')) return false;
        return compression.filter(req, res);
    }
}));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
    res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// استخراج الرابط بالكامل
function extractTargetUrl(req) {
    const rawUrlIndex = req.originalUrl.indexOf('url=');
    if (rawUrlIndex !== -1) {
        let rawUrl = req.originalUrl.substring(rawUrlIndex + 4);
        try {
            return decodeURIComponent(rawUrl);
        } catch (e) {
            return rawUrl;
        }
    }
    return req.query.url || null;
}

function getHeadersForUrl(targetUrl, req = null) {
    try {
        const parsedUrl = new URL(targetUrl);
        const userAgent = (req && req.headers['user-agent'] && !req.headers['user-agent'].includes('node-fetch'))
            ? req.headers['user-agent']
            : DEFAULT_USER_AGENT;

        return {
            'User-Agent': userAgent,
            'Accept': '*/*',
            'Referer': `${parsedUrl.origin}/`,
            'Origin': parsedUrl.origin
        };
    } catch (e) {
        return { 'User-Agent': DEFAULT_USER_AGENT };
    }
}

// ترميز وفك تشفير مسارات قطع الفيديو لجعلها نظيفة مثل السيرفرات الأخرى
function encodeSegmentUrl(url) {
    return Buffer.from(url).toString('base64url');
}

function decodeSegmentUrl(encoded) {
    try {
        return Buffer.from(encoded, 'base64url').toString('utf8');
    } catch (e) {
        return null;
    }
}

// ==========================================
// 4. جلب وترجمة المانفيست
// ==========================================
async function fetchAndRewriteManifest(targetUrl, req) {
    const cachedData = manifestCache.get(targetUrl);
    if (cachedData) return cachedData;

    if (manifestPromises.has(targetUrl)) return manifestPromises.get(targetUrl);

    if (isCoolingDown(targetUrl)) {
        const stale = manifestCache.getStale(targetUrl);
        if (stale) return stale;
        throw new Error('Origin server on cooldown');
    }

    const promise = (async () => {
        try {
            const response = await axiosInstance.get(targetUrl, {
                headers: getHeadersForUrl(targetUrl, req),
                validateStatus: status => status >= 200 && status < 500
            });

            if (response.status >= 400 || typeof response.data !== 'string') {
                setCooldown(targetUrl, 3000);
                const stale = manifestCache.getStale(targetUrl);
                if (stale) return stale;
                throw new Error(`Origin error HTTP ${response.status}`);
            }

            const finalUrl = response.request.res.responseUrl || targetUrl;
            const parsedFinalUrl = new URL(finalUrl);
            const baseUrl = parsedFinalUrl.origin;
            const finalSearchParams = parsedFinalUrl.search;

            // تحديد البروتوكول الصحيح (إجبار https على Railway)
            const hostProtocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
            const hostName = req.get('host');

            let lines = response.data.split('\n');
            let rewrittenLines = lines.map(line => {
                let trimmed = line.trim();
                if (trimmed.startsWith('#') || !trimmed) return trimmed;

                let absoluteLink = trimmed.startsWith('http') ? trimmed 
                                 : trimmed.startsWith('/') ? baseUrl + trimmed 
                                 : new URL(trimmed, finalUrl).href;

                if (finalSearchParams && !absoluteLink.includes('?')) {
                    absoluteLink += finalSearchParams;
                }

                // إذا كان ملف m3u8 فرعي
                if (absoluteLink.includes('.m3u8')) {
                    return `${hostProtocol}://${hostName}/direct/manifest.m3u8?url=${encodeURIComponent(absoluteLink)}`;
                }

                // تحويل قطعة TS إلى رابط نظيف ومشفر بالكامل
                const encodedPath = encodeSegmentUrl(absoluteLink);
                return `${hostProtocol}://${hostName}/segment/${encodedPath}/video.ts`;
            });

            const finalManifest = rewrittenLines.join('\n');
            manifestCache.set(targetUrl, finalManifest, 3000); 
            return finalManifest;

        } catch (error) {
            setCooldown(targetUrl, 4000);
            const stale = manifestCache.getStale(targetUrl);
            if (stale) return stale;
            throw error;
        } finally {
            manifestPromises.delete(targetUrl);
        }
    })();

    manifestPromises.set(targetUrl, promise);
    return promise;
}

// ==========================================
// 5. جلب قطع الفيديو بمسار نظيف (/segment/:b64/video.ts)
// ==========================================
app.get('/segment/:encodedUrl/video.ts', async (req, res) => {
    const targetUrl = decodeSegmentUrl(req.params.encodedUrl);
    if (!targetUrl) return res.status(400).send('Invalid segment path');

    try {
        const headers = getHeadersForUrl(targetUrl, req);
        
        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        const response = await axiosInstance.get(targetUrl, {
            headers,
            responseType: 'arraybuffer',
            validateStatus: status => status >= 200 && status < 500
        });

        res.set({
            'Content-Type': response.headers['content-type'] || 'video/mp2t',
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
        });

        if (response.headers['content-range']) {
            res.set('Content-Range', response.headers['content-range']);
        }

        res.status(response.status).send(Buffer.from(response.data));

    } catch (error) {
        res.status(500).send('Segment Proxy Error');
    }
});

// ==========================================
// 6. المسارات الرئيسية
// ==========================================

app.get('/direct/manifest.m3u8', async (req, res) => {
    const targetUrl = extractTargetUrl(req);
    if (!targetUrl) return res.status(400).send('Please provide a ?url=...');

    try {
        const manifest = await fetchAndRewriteManifest(targetUrl, req);
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(manifest);
    } catch (error) {
        res.status(500).send('Direct fetch error');
    }
});

app.listen(PORT, () => {
    console.log(`Ultra Smart Proxy running on port ${PORT}`);
});
