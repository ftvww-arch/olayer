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

// مسار توليد وتعديل ملف الـ M3u8 ليكون رابط مانفيست متوافق بالكامل
app.get('/manifest.m3u8', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    try {
        const config = {
            headers: {
                'Host': new URL(targetUrl).host,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Range': 'bytes=0-',
                'Referer': targetUrl
            },
            validateStatus: status => status >= 200 && status < 500
        };

        const response = await axios.get(targetUrl, config);
        const finalUrl = response.request.res.responseUrl || targetUrl;
        const baseUrl = new URL(finalUrl).origin;

        let lines = response.data.split('\n');
        let rewrittenLines = lines.map(line => {
            let trimmed = line.trim();
            if (trimmed.startsWith('#') || !trimmed) return logClean(trimmed);

            let absoluteLink = '';
            if (trimmed.startsWith('http')) {
                absoluteLink = trimmed;
            } else if (trimmed.startsWith('/')) {
                absoluteLink = baseUrl + trimmed;
            } else {
                absoluteLink = new URL(trimmed, finalUrl).href;
            }

            // توجيه قطع الـ ts عبر مسار البروكسي الخاص بنا
            const hostProtocol = req.protocol;
            const hostName = req.get('host');
            return `${hostProtocol}://${hostName}/proxy?url=${encodeURIComponent(absoluteLink)}`;
        });

        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(rewrittenLines.join('\n'));
    } catch (error) {
        console.error(`[Manifest Error]:`, error.message);
        res.status(500).send('Error generating manifest');
    }
});

function logClean(val) { return val; }

// مسار البروكسي لجلب قطع الفيديو .ts
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    try {
        const config = {
            headers: {
                'Host': new URL(targetUrl).host,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
                'Range': 'bytes=0-'
            },
            responseType: 'stream',
            validateStatus: status => status >= 200 && status < 500
        };

        const response = await axios.get(targetUrl, config);
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

// الصفحة الرئيسية تعرض رابط المانفيست وتشغل الفيديو
app.get('/', (req, res) => {
    const rawStream = 'http://89.33.13.177/live/16304575049793/43581893985883/585734.m3u8?token=aUdHbU.acXXydc.y.aUzdaby.yczHbdcU.X.y.TR.m3u8.400893ed4a1dcb1f9bc8504f26d7e5f13d29a85368613b78395517546617301c...b3JpZW4ubGl2ZQ==';
    
    // بناء رابط المانفيست الخاص بسيرفرك
    const manifestUrl = `${req.protocol}://${req.get('host')}/manifest.m3u8?url=${encodeURIComponent(rawStream)}`;

    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>مشغل البث المباشر</title>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <style>
        body { background: #0f172a; color: #fff; margin: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100vh; font-family: sans-serif; }
        .box { width: 90%; max-width: 960px; background: #1e293b; padding: 20px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        video { width: 100%; border-radius: 8px; background: #000; margin-top: 15px; }
        input { width: 100%; padding: 10px; background: #0f172a; border: 1px solid #475569; color: #38bdf8; border-radius: 6px; margin-top: 8px; }
    </style>
</head>
<body>
    <div class="box">
        <h3>رابط المانفيست الخاص بك (مباشر ومعدل):</h3>
        <input type="text" readonly value="${manifestUrl}" onclick="this.select();">
        <video id="videoPlayer" controls autoplay playsinline></video>
    </div>

    <script>
        const video = document.getElementById('videoPlayer');
        const streamSrc = '${manifestUrl}';

        if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true });
            hls.loadSource(streamSrc);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = streamSrc;
            video.play().catch(() => {});
        }
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
