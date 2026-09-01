const express = require('express');
const axios = require('axios');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// تفعيل الضغط بناءً على الاعتماديات في package.json
app.use(compression());

// 1. معالجة طلبات Preflight (OPTIONS) الضرورية لتشغيل hls.js في المتصفحات بدون أخطاء CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// متغير لتخزين الكوكيز (بعض السيرفرات تضع كوكيز عند توليد الـ Token)
let sessionCookies = '';

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    try {
        const config = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Referer': 'http://orien.live/',
                'Origin': 'http://orien.live',
                'Accept': '*/*'
            }
        };

        // إرفاق الكوكيز إذا تم استلامها من السيرفر في الطلبات السابقة
        if (sessionCookies) config.headers['Cookie'] = sessionCookies;

        // 2. معالجة قوائم التشغيل (.m3u8) سواء الأساسية أو الفرعية
        if (targetUrl.includes('.m3u8')) {
            const response = await axios.get(targetUrl, config);
            
            // التقاط الجلسة/الكوكيز بعد إعادة التوجيه (Redirect)
            if (response.headers['set-cookie']) {
                sessionCookies = response.headers['set-cookie'].join('; ');
            }

            const finalUrl = response.request.res.responseUrl || targetUrl;
            const baseUrl = new URL(finalUrl).origin;

            let lines = response.data.split('\n');
            let rewrittenLines = lines.map(line => {
                let trimmed = line.trim();
                if (trimmed.startsWith('#') || !trimmed) return line;

                let absoluteLink = '';
                if (trimmed.startsWith('http')) {
                    absoluteLink = trimmed;
                } else if (trimmed.startsWith('/')) {
                    absoluteLink = baseUrl + trimmed;
                } else {
                    absoluteLink = new URL(trimmed, finalUrl).href;
                }

                // ترميز الرابط لضمان عدم ضياع المتغيرات (مثل Tokens) عند تمريرها
                return `/proxy?url=${encodeURIComponent(absoluteLink)}`;
            });

            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(rewrittenLines.join('\n'));
        } 
        // 3. معالجة قطع الفيديو (.ts) وبثها مباشرة (Streaming) لتجنب استهلاك الذاكرة
        else {
            const response = await axios({
                ...config,
                method: 'GET',
                url: targetUrl,
                responseType: 'stream'
            });
            
            res.set('Content-Type', response.headers['content-type'] || 'video/MP2T');
            return response.data.pipe(res);
        }
    } catch (error) {
        console.error(`[Proxy Error] ${targetUrl}:`, error.message);
        res.status(500).send('Proxy Error');
    }
});

// واجهة المشغل
app.get('/', (req, res) => {
    // تمرير الرابط إلى البروكسي
    const initialStream = 'http://orien.live/live/16304575049793/43581893985883/585734.m3u8';
    const proxyStreamUrl = `/proxy?url=${encodeURIComponent(initialStream)}`;

    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>مشغل البث</title>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <style>
        body { background: #0f172a; margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
        video { width: 90%; max-width: 960px; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); background: #000; }
    </style>
</head>
<body>
    <video id="videoPlayer" controls autoplay playsinline></video>
    <script>
        const video = document.getElementById('videoPlayer');
        const streamSrc = '${proxyStreamUrl}';

        if (Hls.isSupported()) {
            // إعدادات إضافية لتحسين استقرار البث
            const hls = new Hls({ 
                maxBufferLength: 30, 
                maxMaxBufferLength: 60,
                enableWorker: true
            });
            hls.loadSource(streamSrc);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
            hls.on(Hls.Events.ERROR, (e, data) => console.error('HLS Error:', data));
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
    console.log(`Server is running on http://localhost:${PORT}`);
});
