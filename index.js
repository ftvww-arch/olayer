const express = require('express');
const axios = require('axios');
const compression = require('compression');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const SECRET_KEY = process.env.SECRET_KEY || 'my-super-secret-streaming-key-2026';
const TOKEN_EXPIRY_HOURS = 2; // صلاحية الساعتين

app.use(compression());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// دالة لتوليد توكن مشفر وموقع وآمن
function generateShortToken(targetUrl) {
    const expiresAt = Date.now() + (TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
    const payload = JSON.stringify({ url: targetUrl, exp: expiresAt });
    const base64Payload = Buffer.from(payload).toString('base64url');
    
    const signature = crypto
        .createHmac('sha256', SECRET_KEY)
        .update(base64Payload)
        .digest('hex');
        
    return `${base64Payload}.${signature}`;
}

// دالة فحص التوكن والتحقق من الصلاحية (الساعتين)
function decryptShortToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 2) return { error: 'Invalid' };
        
        const [base64Payload, signature] = parts;
        
        const expectedSignature = crypto
            .createHmac('sha256', SECRET_KEY)
            .update(base64Payload)
            .digest('hex');
            
        if (signature !== expectedSignature) {
            return { error: 'Invalid' };
        }
        
        const payloadJson = Buffer.from(base64Payload, 'base64url').toString('utf8');
        const { url, exp } = JSON.parse(payloadJson);
        
        if (Date.now() > exp) {
            return { error: 'Expired' };
        }
        
        return { targetUrl: url };
    } catch (e) {
        return { error: 'Invalid' };
    }
}

let manifestCache = { data: null, timestamp: 0, token: null };
const CACHE_TTL = 4000;
let pendingManifestPromise = null;

// مسار توليد الرابط المختصر
app.get('/generate', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Please provide a ?url=...');

    const token = generateShortToken(targetUrl);
    const hostProtocol = req.protocol;
    const hostName = req.get('host');
    const shortLink = `${hostProtocol}://${hostName}/play/${token}/manifest.m3u8`;

    res.send(`
        <html dir="rtl" style="background:#0f172a;color:#fff;font-family:sans-serif;text-align:center;padding-top:50px;">
            <h3>رابط البث المشفر والمؤقت (صالح لمدة ساعتين فقط):</h3>
            <input type="text" readonly value="${shortLink}" style="width:80%;max-width:600px;padding:10px;background:#1e293b;border:1px solid #475569;color:#38bdf8;border-radius:6px;" onclick="this.select();">
            <p style="color:#94a3b8;margin-top:10px;">هذا الرابط سيتوقف عن العمل تلقائياً بعد مرور ساعتين.</p>
        </html>
    `);
});

// مسار المشغل والمانفيست
app.get('/play/:token/manifest.m3u8', async (req, res) => {
    const { token } = req.params;
    const decrypted = decryptShortToken(token);

    if (decrypted.error === 'Expired') {
        return res.status(403).send('انتهت صلاحية هذا الرابط (عبر ساعتين).');
    }
    if (decrypted.error === 'Invalid' || !decrypted.targetUrl) {
        return res.status(400).send('رابط غير صالح.');
    }

    const targetUrl = decrypted.targetUrl;
    const now = Date.now();

    if (manifestCache.data && manifestCache.token === token && (now - manifestCache.timestamp < CACHE_TTL)) {
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(manifestCache.data);
    }

    if (pendingManifestPromise) {
        try {
            const cachedData = await pendingManifestPromise;
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(cachedData);
        } catch (e) {
            return res.status(500).send('Error in pending request');
        }
    }

    pendingManifestPromise = (async () => {
        try {
            const config = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
                    'Range': 'bytes=0-'
                },
                validateStatus: status => status >= 200 && status < 500
            };

            const response = await axios.get(targetUrl, config);
            const finalUrl = response.request.res.responseUrl || targetUrl;
            const baseUrl = new URL(finalUrl).origin;

            let lines = response.data.split('\n');
            let rewrittenLines = lines.map(line => {
                let trimmed = line.trim();
                if (trimmed.startsWith('#') || !trimmed) return trimmed;

                let absoluteLink = '';
                if (trimmed.startsWith('http')) {
                    absoluteLink = trimmed;
                } else if (trimmed.startsWith('/')) {
                    absoluteLink = baseUrl + trimmed;
                } else {
                    absoluteLink = new URL(trimmed, finalUrl).href;
                }

                const hostProtocol = req.protocol;
                const hostName = req.get('host');
                return `${hostProtocol}://${hostName}/proxy?url=${encodeURIComponent(absoluteLink)}`;
            });

            const finalManifest = rewrittenLines.join('\n');

            manifestCache = {
                data: finalManifest,
                timestamp: Date.now(),
                token: token
            };

            return finalManifest;
        } finally {
            pendingManifestPromise = null;
        }
    })();

    try {
        const result = await pendingManifestPromise;
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(result);
    } catch (error) {
        if (manifestCache.data) {
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(manifestCache.data);
        }
        res.status(500).send('Error fetching manifest');
    }
});

// مسار مباشر ودائم بدون توكن
app.get('/direct/manifest.m3u8', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Please provide a ?url=...');

    try {
        const config = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
                'Range': 'bytes=0-'
            },
            validateStatus: status => status >= 200 && status < 500
        };

        const response = await axios.get(targetUrl, config);
        const finalUrl = response.request.res.responseUrl || targetUrl;
        const baseUrl = new URL(finalUrl).origin;

        let lines = response.data.split('\n');
        let rewrittenLines = lines.map(line => {
            let trimmed = line.trim();
            if (trimmed.startsWith('#') || !trimmed) return trimmed;

            let absoluteLink = '';
            if (trimmed.startsWith('http')) {
                absoluteLink = trimmed;
            } else if (trimmed.startsWith('/')) {
                absoluteLink = baseUrl + trimmed;
            } else {
                absoluteLink = new URL(trimmed, finalUrl).href;
            }

            const hostProtocol = req.protocol;
            const hostName = req.get('host');
            return `${hostProtocol}://${hostName}/proxy?url=${encodeURIComponent(absoluteLink)}`;
        });

        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(rewrittenLines.join('\n'));
    } catch (error) {
        res.status(500).send('Error fetching manifest');
    }
});

// مسار البروكسي لقطع الفيديو .ts
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
                'Range': 'bytes=0-'
            },
            responseType: 'stream',
            validateStatus: status => status >= 200 && status < 500
        });

        res.set('Access-Control-Allow-Origin', '*');
        res.set('Content-Type', response.headers['content-type'] || 'video/MP2T');
        if (response.headers['content-range']) {
            res.set('Content-Range', response.headers['content-range']);
        }
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('Proxy Error');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
