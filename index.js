const express = require('express');
const axios = require('axios');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// تفعيل الضغط لحقن gzip و transfer-encoding: chunked
app.use(compression());

const TARGET_URL = "https://afast-cdn1-liu.cdnz.quest/hls2/01/00070/k7i1jzwik4i0_,l,n,.urlset/master.m3u8?t=jJ9G2DIglFkj_fuNzklnzDyQt0kv7Qtrn-gfoq14BeM&s=1788238541&e=18000&v=169417097&i=0.3&sp=0";

// دالة توحيد وحقن كافة الهيدرز المطلوبة
function injectCustomHeaders(res, contentType) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'public, max-age=8640000, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Server', 'nginx');

    const now = new Date();
    const expires = new Date(now.getTime() + 8640000 * 1000);
    res.setHeader('Date', now.toUTCString());
    res.setHeader('Expires', expires.toUTCString());
    res.setHeader('Last-Modified', now.toUTCString());
}

// 1. مشغل الفيديو (HTML + Hls.js) عند زيارة رابط Render الرئيسي مباشرة
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>مشغل الفيديو - HLS Stream</title>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { background-color: #0f0f0f; display: flex; justify-content: center; align-items: center; min-height: 100vh; font-family: sans-serif; }
            .player-container { width: 90%; max-width: 960px; background: #000; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            video { width: 100%; height: auto; display: block; aspect-ratio: 16/9; }
        </style>
    </head>
    <body>
        <div class="player-container">
            <video id="videoPlayer" controls autoplay playsinline></video>
        </div>
        <script>
            const video = document.getElementById('videoPlayer');
            const streamUrl = '/live.m3u8';

            if (Hls.isSupported()) {
                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true
                });
                hls.loadSource(streamUrl);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, function() {
                    video.play().catch(() => {});
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = streamUrl;
                video.addEventListener('loadedmetadata', function() {
                    video.play().catch(() => {});
                });
            }
        </script>
    </body>
    </html>
    `);
});

// 2. مسار جلب ملف m3u8 الرئيسي وتوجيه الروابط داخلية عبر البروكسي
app.get('/live.m3u8', async (req, res) => {
    try {
        const response = await axios.get(TARGET_URL, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            responseType: 'text'
        });

        const baseUrl = TARGET_URL.substring(0, TARGET_URL.lastIndexOf('/') + 1);
        const currentHost = `${req.protocol}://${req.get('host')}`;

        // تعديل روابط التشغيل الداخلية لكي تمر عبر مسار البروكسي وتفادي 404
        const modifiedManifest = response.data.split('\n').map(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const absoluteUrl = trimmed.startsWith('http') ? trimmed : baseUrl + trimmed;
                return `${currentHost}/proxy?url=${encodeURIComponent(absoluteUrl)}`;
            }
            return line;
        }).join('\n');

        injectCustomHeaders(res, 'application/vnd.apple.mpegurl');
        res.send(modifiedManifest);
    } catch (err) {
        res.status(500).send('فشل جلب ملف البث الرئيسي');
    }
});

// 3. بروكسي شامل لجلب ملفات .m3u8 الفرعية ومقاطع الـ .ts مع حشو الهيدرز
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('رابط غير مكتمل');

    try {
        const isPlaylist = targetUrl.includes('.m3u8');
        const response = await axios.get(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            responseType: isPlaylist ? 'text' : 'arraybuffer'
        });

        if (isPlaylist) {
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            const currentHost = `${req.protocol}://${req.get('host')}`;

            const modifiedSubManifest = response.data.split('\n').map(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const absoluteUrl = trimmed.startsWith('http') ? trimmed : baseUrl + trimmed;
                    return `${currentHost}/proxy?url=${encodeURIComponent(absoluteUrl)}`;
                }
                return line;
            }).join('\n');

            injectCustomHeaders(res, 'application/vnd.apple.mpegurl');
            return res.send(modifiedSubManifest);
        } else {
            const contentType = response.headers['content-type'] || 'video/MP2T';
            injectCustomHeaders(res, contentType);
            return res.send(response.data);
        }
    } catch (err) {
        res.status(500).send('فشل تحميل جزء الفيديو');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
