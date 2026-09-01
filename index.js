const express = require('express');
const axios = require('axios');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// الرابط الثابت للقناة الذي طلبته
const CHANNEL_ID = '445376';
const INITIAL_STREAM_URL = `http://orien.live/live/16304575049793/43581893985883/${CHANNEL_ID}.m3u8`;

// نظام كاش ذكي لتتبع وتحديث الـ Token والـ IP تلقائياً من السيرفر الأصلي
let manifestCache = { data: null, timestamp: 0 };
const CACHE_TTL = 4000; // تحديث كل 4 ثوانٍ لضمان بقاء البث متوافقاً مع التوكن المتجدد
let pendingManifestPromise = null;

async function fetchAndResolveManifest() {
    let currentUrl = INITIAL_STREAM_URL;
    let sessionCookies = '';

    // تتبع الـ Redirects لجلب الـ IP الحقيقي والـ Token تلقائياً
    for (let i = 0; i < 5; i++) {
        const config = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
                'Referer': 'http://orien.live/',
                'Range': 'bytes=0-'
            },
            maxRedirects: 0,
            validateStatus: status => status >= 200 && status < 400
        };

        if (sessionCookies) config.headers['Cookie'] = sessionCookies;

        const response = await axios.get(currentUrl, config);
        if (response.headers['set-cookie']) {
            sessionCookies = response.headers['set-cookie'].join('; ');
        }

        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const redirectLocation = response.headers['location'];
            if (!redirectLocation) break;
            currentUrl = new URL(redirectLocation, currentUrl).href;
        } else {
            return { data: response.data, finalUrl: currentUrl };
        }
    }

    const finalRes = await axios.get(currentUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'http://orien.live/',
            'Range': 'bytes=0-'
        }
    });
    return { data: finalRes.data, finalUrl: currentUrl };
}

// مسار البث الثابت والدائم
app.get(`/p/${CHANNEL_ID}`, async (req, res) => {
    const now = Date.now();

    if (manifestCache.data && (now - manifestCache.timestamp < CACHE_TTL)) {
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(manifestCache.data);
    }

    if (pendingManifestPromise) {
        try {
            const cachedData = await pendingManifestPromise;
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(cachedData);
        } catch (e) {
            return res.status(500).send('Stream Error');
        }
    }

    pendingManifestPromise = (async () => {
        try {
            const { data, finalUrl } = await fetchAndResolveManifest();
            const baseUrl = new URL(finalUrl).origin;

            let lines = data.split('\n');
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
            manifestCache = { data: finalManifest, timestamp: Date.now() };
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
        res.status(500).send('Stream temporarily unavailable');
    }
});

// مسار البروكسي لجلب قطع الفيديو .ts
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
                'Referer': 'http://orien.live/',
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

// الصفحة الرئيسية تعرض الرابط الثابت الجاهز
app.get('/', (req, res) => {
    const hostProtocol = req.protocol;
    const hostName = req.get('host');
    const permanentLink = `${hostProtocol}://${hostName}/p/${CHANNEL_ID}`;

    res.send(`
        <html dir="rtl" style="background:#0f172a;color:#fff;font-family:sans-serif;text-align:center;padding-top:40px;">
            <h3>رابط البث الثابت والدائم (24 ساعة):</h3>
            <input type="text" readonly value="${permanentLink}" style="width:80%;max-width:600px;padding:10px;background:#1e293b;border:1px solid #475569;color:#38bdf8;border-radius:6px;" onclick="this.select();">
            <div style="margin-top:20px;">
                <video id="player" width="640" controls autoplay playsinline style="border-radius:8px;background:#000;"></video>
            </div>
            <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
            <script>
                const video = document.getElementById('player');
                if (Hls.isSupported()) {
                    const hls = new Hls();
                    hls.loadSource('${permanentLink}');
                    hls.attachMedia(video);
                    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(()=>{}));
                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    video.src = '${permanentLink}';
                    video.play().catch(()=>{});
                }
            </script>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Streaming server running on port ${PORT}`);
});
