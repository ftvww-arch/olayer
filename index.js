const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

// الرابط الأساسي للبث
const INITIAL_STREAM_URL = 'http://orien.live/live/16304575049793/43581893985883/585734.m3u8';

// إنشاء مسار البروكسي لمعالجة الـ m3u8 وقطع الـ ts
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    try {
        // إعدادات الطلب لتبدو كمتصفح حقيقي لتجاوز الحماية
        const config = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Referer': 'http://orien.live/'
            }
        };

        // إذا كان الطلب لملف m3u8
        if (targetUrl.includes('.m3u8')) {
            const response = await axios.get(targetUrl, config);
            
            // استخراج الرابط النهائي بعد الـ Redirect (لالتقاط الـ IP والـ Token)
            const finalUrl = response.request.res.responseUrl || targetUrl;
            const baseUrl = new URL(finalUrl).origin; // سيستخرج http://89.33.13.177

            let lines = response.data.split('\n');
            let rewrittenLines = lines.map(line => {
                // تجاهل الأسطر الخاصة بإعدادات HLS أو الأسطر الفارغة
                if (line.startsWith('#') || !line.trim()) return line;

                // بناء الرابط الكامل لملف الـ ts
                let absoluteLink = '';
                if (line.startsWith('http')) {
                    absoluteLink = line;
                } else if (line.startsWith('/')) {
                    absoluteLink = baseUrl + line; // دمج الـ IP مع المسار مثل /hlsr/...
                } else {
                    absoluteLink = new URL(line, finalUrl).href;
                }

                // إعادة توجيه الرابط ليمر عبر البروكسي الخاص بنا
                return `/proxy?url=${encodeURIComponent(absoluteLink)}`;
            });

            // إرسال الملف المعدل للمتصفح
            res.set('Access-Control-Allow-Origin', '*');
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            res.send(rewrittenLines.join('\n'));
        } 
        // إذا كان الطلب لقطعة فيديو .ts
        else {
            const response = await axios({
                ...config,
                method: 'GET',
                url: targetUrl,
                responseType: 'stream' // استخدام نظام Stream لعدم استهلاك ذاكرة السيرفر
            });
            
            res.set('Access-Control-Allow-Origin', '*');
            res.set('Content-Type', response.headers['content-type'] || 'video/MP2T');
            // تمرير الفيديو مباشرة إلى المتصفح
            response.data.pipe(res);
        }
    } catch (error) {
        console.error('Proxy Error for:', targetUrl, error.message);
        res.status(500).send('Proxy Error');
    }
});

// الصفحة الرئيسية التي تحتوي على المشغل
app.get('/', (req, res) => {
    // نمرر الرابط الأساسي إلى البروكسي الخاص بنا
    const proxyStreamUrl = `/proxy?url=${encodeURIComponent(INITIAL_STREAM_URL)}`;

    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>مشغل البث المباشر (Proxy HLS)</title>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background-color: #0f172a; display: flex; justify-content: center; align-items: center; min-height: 100vh; font-family: system-ui, sans-serif; }
        .player-wrapper { width: 90%; max-width: 960px; background: #1e293b; padding: 16px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        video { width: 100%; height: auto; border-radius: 8px; display: block; background: #000; }
    </style>
</head>
<body>

<div class="player-wrapper">
    <video id="videoPlayer" controls autoplay playsinline muted></video>
</div>

<script>
    const video = document.getElementById('videoPlayer');
    const streamSrc = '${proxyStreamUrl}';

    if (Hls.isSupported()) {
        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true
        });
        hls.loadSource(streamSrc);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(e => console.log('Autoplay blocked:', e));
        });
        hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS Error:', data);
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamSrc;
        video.addEventListener('loadedmetadata', () => {
            video.play().catch(e => console.log('Autoplay blocked:', e));
        });
    }
</script>

</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`Streaming Server is running on http://localhost:${PORT}`);
});
