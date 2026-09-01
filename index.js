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

const CHANNEL_ID = '445376';
const INITIAL_STREAM_URL = `http://orien.live/live/16304575049793/43581893985883/${CHANNEL_ID}.m3u8`;

// تخزين الرابط النهائي والـ Token بعد أول جلب فقط لتثبيته
let resolvedStreamUrl = null;
let manifestCache = { data: null, timestamp: 0 };
const CACHE_TTL = 4000;
let pendingManifestPromise = null;

async function getResolvedStreamUrl() {
    if (resolvedStreamUrl) return resolvedStreamUrl;

    let currentUrl = INITIAL_STREAM_URL;
    let sessionCookies = '';

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
            resolvedStreamUrl = currentUrl;
            return resolvedStreamUrl;
        }
    }

    resolvedStreamUrl = currentUrl;
    return resolvedStreamUrl;
}

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
            // جلب الرابط النهائي (مع التوكن) مرة واحدة وتثبيته
            const targetUrl = await getResolvedStreamUrl();
            const baseUrl = new URL(targetUrl).origin;

            const response = await axios.get(targetUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Range': 'bytes=0-'
                },
                validateStatus: status => status >= 200 && status < 500
            });

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
                    absoluteLink = new URL(trimmed, targetUrl).href;
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

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
