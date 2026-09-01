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

// دالة مساعدة لتتبع روابط إعادة التوجيه وجلب الـ Manifest الحقيقي مع الـ Token تلقائياً
async function fetchStreamManifest(targetUrl) {
    let currentUrl = targetUrl;
    let sessionCookies = '';
    
    // محاولة تتبع الـ Redirects يدوياً لضمان التقاط الـ Token والكوكيز
    for (let i = 0; i < 5; i++) {
        const config = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Referer': 'http://orien.live/',
                'Origin': 'http://orien.live',
                'Range': 'bytes=0-'
            },
            maxRedirects: 0, // منع أكسيوس من التعامل التلقائي لكي نلتقط الكوكيز والـ Headers
            validateStatus: status => status >= 200 && status < 400
        };

        if (sessionCookies) config.headers['Cookie'] = sessionCookies;

        const response = await axios.get(currentUrl, config);

        if (response.headers['set-cookie']) {
            sessionCookies = response.headers['set-cookie'].join('; ');
        }

        // إذا حدث إعادة توجيه (Redirect)
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const redirectLocation = response.headers['location'];
            if (!redirectLocation) break;
            
            // التعامل مع الروابط النسبية أو المطلقة
            currentUrl = new URL(redirectLocation, currentUrl).href;
        } else {
            // وصلنا للرابط النهائي المستهدف
            return {
                data: response.data,
                finalUrl: currentUrl,
                cookies: sessionCookies
            };
        }
    }
    
    // Fallback في حال لم يحدث توجيه تقليدي
    const finalRes = await axios.get(currentUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'http://orien.live/'
        }
    });
    return { data: finalRes.data, finalUrl: currentUrl, cookies: sessionCookies };
}

// مسار توليد وتعديل المانفيست تلقائياً من رابط orien.live الأساسي
app.get('/manifest.m3u8', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    try {
        // جلب البيانات وتتبع الـ Token والـ IP الجديد أوتوماتيكياً
        const { data, finalUrl } = await fetchStreamManifest(targetUrl);
        const baseUrl = new URL(finalUrl).origin;

        let lines = typeof data === 'string' ? data.split('\n') : data.toString().split('\n');
        
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

            // توجيه قطع الـ ts عبر البروكسي
            const hostProtocol = req.protocol;
            const hostName = req.get('host');
            return `${hostProtocol}://${hostName}/proxy?url=${encodeURIComponent(absoluteLink)}`;
        });

        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(rewrittenLines.join('\n'));
    } catch (error) {
        console.error(`[Manifest Error] ${targetUrl}:`, error.message);
        res.status(500).send('Error resolving and generating manifest');
    }
});

// مسار البروكسي لجلب قطع الفيديو .ts
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    try {
        const config = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
                'Referer': 'http://orien.live/',
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

// الصفحة الرئيسية لتجربة الرابط الأساسي
app.get('/', (req, res) => {
    // الآن يمكنك وضع رابط orien.live الأساسي مباشرة هنا
    const rawStream = 'http://orien.live/live/16304575049793/43581893985883/585734.m3u8';
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
        <h3>رابط المانفيست المولد تلقائياً:</h3>
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
