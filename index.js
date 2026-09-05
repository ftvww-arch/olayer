const express = require('express');
const axios = require('axios');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());

// إعدادات CORS للسماح للمشغل بالعمل من أي مكان
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// الهيدرز الدقيقة التي يطلبها الـ Worker الخاص بهم ليعمل بدون حظر
const WORKER_HEADERS = {
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9,ar-JO;q=0.8,ar;q=0.7,tr-TR;q=0.6,tr;q=0.5',
    'Origin': 'https://abody.optikl.ink',
    'Referer': 'https://abody.optikl.ink/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site'
};

// رابط البروكسي (الـ Worker) الخاص بهم
const WORKER_BASE_URL = 'https://website.fancy-water-8bf9.workers.dev/?stream=';

// 1. مسار جلب القناة وعرض المشغل
app.get('/channel/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // نجلب رابط الـ m3u8 الأساسي من الـ API الخاص بهم
        const apiUrl = `https://website.fancy-water-8bf9.workers.dev/api/channel/${id}`;
        const response = await axios.get(apiUrl, { headers: WORKER_HEADERS });
        
        const data = response.data.data && response.data.data[0];
        if (!data || !data.url) {
            return res.status(404).send('لم يتم العثور على البث.');
        }

        const streamUrl = data.url;
        const hostProtocol = req.protocol;
        const hostName = req.get('host');

        // نوجه الرابط الأساسي لبروكسي المانفيست الخاص بنا
        const manifestProxyUrl = `${hostProtocol}://${hostName}/proxy/manifest.m3u8?url=${encodeURIComponent(streamUrl)}`;

        res.send(`
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>مشغل القناة ${id}</title>
                <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
                <style>
                    body { background: #0f172a; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; font-family: sans-serif; }
                    video { width: 90%; max-width: 800px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); background: #000; }
                    .info { margin-bottom: 20px; text-align: center; color: #94a3b8; }
                    input { width: 100%; max-width: 600px; padding: 10px; margin-top: 10px; background: #1e293b; border: 1px solid #475569; color: #38bdf8; border-radius: 6px; text-align: left; direction: ltr;}
                </style>
            </head>
            <body>
                <div class="info">
                    <h2>بث القناة رقم: ${id}</h2>
                    <input type="text" readonly value="${manifestProxyUrl}" onclick="this.select();">
                </div>
                <video id="video" controls autoplay></video>
                <script>
                    const video = document.getElementById('video');
                    const videoSrc = "${manifestProxyUrl}";

                    if (Hls.isSupported()) {
                        const hls = new Hls();
                        hls.loadSource(videoSrc);
                        hls.attachMedia(video);
                        hls.on(Hls.Events.MANIFEST_PARSED, function() { video.play(); });
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = videoSrc;
                        video.addEventListener('loadedmetadata', function() { video.play(); });
                    }
                </script>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('API Error:', error.message);
        res.status(500).send('حدث خطأ أثناء جلب القناة.');
    }
});

// 2. بروكسي المانفيست (يعتمد على الـ Worker الخاص بهم في الجلب)
app.get('/proxy/manifest.m3u8', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url');

    try {
        // نطلب ملف الـ m3u8 من خلال الـ Worker الخاص بهم لنتخطى الحظر
        const fetchUrl = WORKER_BASE_URL + encodeURIComponent(targetUrl);
        
        const response = await axios.get(fetchUrl, {
            headers: WORKER_HEADERS,
            validateStatus: status => status >= 200 && status < 500
        });

        let lines = response.data.split('\n');
        let rewrittenLines = lines.map(line => {
            let trimmed = line.trim();
            // تجاهل التعليقات والأسطر الفارغة
            if (trimmed.startsWith('#') || !trimmed) return trimmed;

            // تحويل الروابط النسبية إلى مطلقة بناءً على الرابط المستهدف
            let absoluteLink;
            try {
                absoluteLink = new URL(trimmed, targetUrl).href;
            } catch (e) {
                absoluteLink = trimmed;
            }

            const hostProtocol = req.protocol;
            const hostName = req.get('host');
            
            // إعادة توجيه الروابط الداخلية (m3u8 أو js/ts) عبر البروكسي الخاص بنا
            if (absoluteLink.includes('.m3u8')) {
                return `${hostProtocol}://${hostName}/proxy/manifest.m3u8?url=${encodeURIComponent(absoluteLink)}`;
            } else {
                return `${hostProtocol}://${hostName}/proxy/segment?url=${encodeURIComponent(absoluteLink)}`;
            }
        });

        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(rewrittenLines.join('\n'));
    } catch (error) {
        console.error('Manifest Proxy Error:', error.message);
        res.status(500).send('Error proxying manifest');
    }
});

// 3. بروكسي قطع الفيديو (يطلب المقاطع بصيغة .js عبر الـ Worker الخاص بهم)
app.get('/proxy/segment', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url');

    try {
        // توجيه الطلب إلى الـ Worker الخاص بهم 
        const fetchUrl = WORKER_BASE_URL + encodeURIComponent(targetUrl);
        
        // تجهيز الهيدرز ودعم الـ Range للتنقل داخل الفيديو
        const headers = { ...WORKER_HEADERS };
        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        const response = await axios.get(fetchUrl, {
            headers: headers,
            responseType: 'stream',
            validateStatus: status => status >= 200 && status < 500
        });

        res.set('Access-Control-Allow-Origin', '*');
        res.set('Content-Type', response.headers['content-type'] || 'video/MP2T');
        
        if (response.headers['content-range']) res.set('Content-Range', response.headers['content-range']);
        if (response.headers['content-length']) res.set('Content-Length', response.headers['content-length']);
        if (response.headers['accept-ranges']) res.set('Accept-Ranges', response.headers['accept-ranges']);

        // دفق (Pipe) الفيديو للمشغل
        response.data.pipe(res);
    } catch (error) {
        console.error('Segment Proxy Error:', error.message);
        res.status(500).send('Error proxying segment');
    }
});

app.listen(PORT, () => {
    console.log(`Server running smoothly on port ${PORT}`);
});
