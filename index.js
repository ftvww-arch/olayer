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

// ذاكرة مؤقتة لتخزين محتوى المانفيست آخر جلب (Cache)
let manifestCache = {
    data: null,
    finalUrl: null,
    timestamp: 0
};
const CACHE_TTL = 4000; // مدة التخزين المؤقت بالمللي ثانية (4 ثوانٍ تقريباً لتحديث البث المباشر)

app.get('/manifest.m3u8', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    const now = Date.now();
    // استخدام الكاش إذا كان حديثاً لتجنب الطلبات المتكررة للسيرفر الخارجي
    if (manifestCache.data && (now - manifestCache.timestamp < CACHE_TTL)) {
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(manifestCache.data);
    }

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

        // تحديث الكاش
        manifestCache = {
            data: finalManifest,
            finalUrl: finalUrl,
            timestamp: now
        };

        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(finalManifest);
    } catch (error) {
        // إذا حدث خطأ، يتم إرجاع آخر نسخة مخزنة تفادياً لتوقف البث المفاجئ
        if (manifestCache.data) {
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(manifestCache.data);
        }
        res.status(500).send('Error fetching manifest');
    }
});

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
