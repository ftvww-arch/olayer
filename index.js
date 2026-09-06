const express = require('express');
const axios = require('axios');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// تفعيل Trust Proxy لدعم HTTPS على منصات مثل Render
app.enable('trust proxy');

app.use(compression());

// إعدادات CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ذاكرة التخزين المؤقت (الكاش)
const manifestCache = new Map();
const segmentCache = new Map();
const activeRequests = new Map();

// الترويسات الخاصة بتخطي الحماية
const WORKER_HEADERS = {
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9,ar-JO;q=0.8,ar;q=0.7',
    'Origin': 'https://abody.optikl.ink',
    'Referer': 'https://abody.optikl.ink/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'Priority': 'u=1, i',
    'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site'
};

const WORKER_BASE_URL = 'https://website.fancy-water-8bf9.workers.dev/?stream=';

// دالة مساعدة للحصول على رابط السيرفر الصحيح (HTTP/HTTPS)
function getBaseUrl(req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    return `${protocol}://${host}`;
}

// 1. رابط مختصر ومباشر للبث (تأكد من وضع التوكين الكامل هنا بدون ...)
app.get('/my-live-stream.m3u8', (req, res) => {
    const targetUrl = 'http://89.33.13.177/live/16304575049793/43581893985883/405949.m3u8?token=aUdHbU.fHydHUc.y.fdyzyzz.yczHbdcU.X.y.TR.m3u8.0162a828a5a29c1ac98634a2c8d976ed220e4745eae144c9ea2f4d217fea4fb8...b3JpZW4ubGl2ZQ==';
    res.redirect(`/proxy/manifest.m3u8?url=${encodeURIComponent(targetUrl)}`);
});

// 2. بروكسي المانفيست مع الكاش
app.get('/proxy/manifest.m3u8', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url');

    if (manifestCache.has(targetUrl)) {
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(manifestCache.get(targetUrl));
    }

    if (activeRequests.has(targetUrl)) {
        try {
            const data = await activeRequests.get(targetUrl);
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(data);
        } catch (e) {
            return res.status(500).send('Error fetching manifest');
        }
    }

    const fetchPromise = (async () => {
        try {
            const fetchUrl = WORKER_BASE_URL + encodeURIComponent(targetUrl);
            const response = await axios.get(fetchUrl, {
                headers: WORKER_HEADERS,
                responseType: 'text',
                validateStatus: status => status >= 200 && status < 500
            });

            if (response.status !== 200) {
                throw new Error(`Upstream manifest status: ${response.status}`);
            }

            const finalUrl = response.request?.res?.responseUrl || targetUrl;
            const baseUrl = getBaseUrl(req);

            let lines = response.data.split('\n');
            let rewrittenLines = lines.map(line => {
                let trimmed = line.trim();
                if (trimmed.startsWith('#')) {
                    if (trimmed.includes('URI="')) {
                        return trimmed.replace(/URI="(.*?)"/g, (match, p1) => {
                            let absKeyUrl = new URL(p1, finalUrl).href;
                            return `URI="${baseUrl}/proxy/segment?url=${encodeURIComponent(absKeyUrl)}"`;
                        });
                    }
                    return trimmed;
                }
                if (!trimmed) return trimmed;

                let absoluteLink = new URL(trimmed, finalUrl).href;
                if (absoluteLink.includes('.m3u8')) {
                    return `${baseUrl}/proxy/manifest.m3u8?url=${encodeURIComponent(absoluteLink)}`;
                } else {
                    return `${baseUrl}/proxy/segment?url=${encodeURIComponent(absoluteLink)}`;
                }
            });

            const processedManifest = rewrittenLines.join('\n');
            manifestCache.set(targetUrl, processedManifest);
            setTimeout(() => manifestCache.delete(targetUrl), 3000);

            return processedManifest;
        } finally {
            activeRequests.delete(targetUrl);
        }
    })();

    activeRequests.set(targetUrl, fetchPromise);

    try {
        const data = await fetchPromise;
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(data);
    } catch (error) {
        console.error('Manifest Error:', error.message);
        res.status(500).send('Error proxying manifest');
    }
});

// 3. بروكسي قطع الفيديو مع الكاش
app.get('/proxy/segment', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url');

    if (segmentCache.has(targetUrl)) {
        const cached = segmentCache.get(targetUrl);
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Content-Type', cached.contentType || 'video/MP2T');
        return res.send(cached.data);
    }

    if (activeRequests.has(targetUrl)) {
        try {
            const cached = await activeRequests.get(targetUrl);
            res.set('Access-Control-Allow-Origin', '*');
            res.set('Content-Type', cached.contentType || 'video/MP2T');
            return res.send(cached.data);
        } catch (e) {
            return res.status(500).send('Error fetching segment');
        }
    }

    const fetchPromise = (async () => {
        try {
            const fetchUrl = WORKER_BASE_URL + encodeURIComponent(targetUrl);
            const response = await axios.get(fetchUrl, {
                headers: WORKER_HEADERS,
                responseType: 'arraybuffer',
                validateStatus: status => status >= 200 && status < 500
            });

            if (response.status !== 200) {
                throw new Error(`Upstream segment status: ${response.status}`);
            }

            const contentType = response.headers['content-type'] || 'video/MP2T';
            const bufferData = Buffer.from(response.data);
            const result = { data: bufferData, contentType };

            segmentCache.set(targetUrl, result);
            setTimeout(() => segmentCache.delete(targetUrl), 60000);

            return result;
        } finally {
            activeRequests.delete(targetUrl);
        }
    })();

    activeRequests.set(targetUrl, fetchPromise);

    try {
        const cached = await fetchPromise;
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Content-Type', cached.contentType);
        res.send(cached.data);
    } catch (error) {
        console.error('Segment Error:', error.message);
        res.status(500).send('Error proxying segment');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
