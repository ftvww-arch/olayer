const express = require('express');
const axios = require('axios');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());

// إعدادات CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// دوال مساعدة لتشفير وفك تشفير الهيدرز لتمريرها في الروابط بأمان
function encodeHeaders(referer, userAgent) {
    const payload = JSON.stringify({ r: referer, ua: userAgent });
    return Buffer.from(payload).toString('base64url');
}

function decodeHeaders(token) {
    try {
        const payload = Buffer.from(token, 'base64url').toString('utf8');
        return JSON.parse(payload);
    } catch (e) {
        return null;
    }
}

// 1. مسار لجلب بيانات القناة وعرض مشغل الفيديو
app.get('/channel/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // جلب البيانات من الـ API الخاص بك
        const apiUrl = `https://website.fancy-water-8bf9.workers.dev/api/channel/${id}`;
        const response = await axios.get(apiUrl);
        
        const data = response.data.data && response.data.data[0];
        if (!data || !data.url) {
            return res.status(404).send('لم يتم العثور على بيانات البث لهذه القناة.');
        }

        const streamUrl = data.url;
        // استخراج الهيدرز
        const referer = data.headers?.Referer || data.referer || '';
        const userAgent = data.headers?.['User-Agent'] || data.user_agent || '';

        // تشفير الهيدرز لتمريرها للبروكسي
        const headerToken = encodeHeaders(referer, userAgent);

        const hostProtocol = req.protocol;
        const hostName = req.get('host');

        // إنشاء الرابط الخاص ببروكسي المانفيست
        const manifestProxyUrl = `${hostProtocol}://${hostName}/proxy/manifest.m3u8?url=${encodeURIComponent(streamUrl)}&h=${headerToken}`;

        // إرجاع صفحة HTML تحتوي على مشغل فيديو مدمج (Hls.js)
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
                    <p>رابط البث المعالج (يمكنك استخدامه في تطبيقات IPTV):</p>
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
                        hls.on(Hls.Events.MANIFEST_PARSED, function() {
                            video.play();
                        });
                    }
                    else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = videoSrc;
                        video.addEventListener('loadedmetadata', function() {
                            video.play();
                        });
                    }
                </script>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('API Error:', error.message);
        res.status(500).send('حدث خطأ أثناء جلب بيانات القناة.');
    }
});

// 2. بروكسي المانفيست (m3u8) - يقوم بجلب الملف الأساسي وتعديل الروابط داخله
app.get('/proxy/manifest.m3u8', async (req, res) => {
    const targetUrl = req.query.url;
    const headerToken = req.query.h;

    if (!targetUrl || !headerToken) return res.status(400).send('Missing parameters');

    const headersData = decodeHeaders(headerToken);
    if (!headersData) return res.status(400).send('Invalid token');

    try {
        const config = {
            headers: {
                'User-Agent': headersData.ua,
                'Referer': headersData.r,
                'Accept': '*/*'
            },
            maxRedirects: 5,
            validateStatus: status => status >= 200 && status < 500
        };

        const response = await axios.get(targetUrl, config);
        const finalUrl = response.request.res.responseUrl || targetUrl;

        let lines = response.data.split('\n');
        let rewrittenLines = lines.map(line => {
            let trimmed = line.trim();
            if (trimmed.startsWith('#') || !trimmed) return trimmed;

            // تحويل الروابط النسبية إلى روابط مطلقة بناءً على الرابط النهائي للمانفيست
            let absoluteLink = new URL(trimmed, finalUrl).href;

            const hostProtocol = req.protocol;
            const hostName = req.get('host');
            
            // إذا كان الرابط يشير لمانفيست فرعي (جودات متعددة)
            if (absoluteLink.includes('.m3u8')) {
                return `${hostProtocol}://${hostName}/proxy/manifest.m3u8?url=${encodeURIComponent(absoluteLink)}&h=${headerToken}`;
            } else {
                // إذا كان الرابط لقطعة فيديو (.ts) أو مفتاح تشفير
                return `${hostProtocol}://${hostName}/proxy/segment?url=${encodeURIComponent(absoluteLink)}&h=${headerToken}`;
            }
        });

        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(rewrittenLines.join('\n'));
    } catch (error) {
        console.error('Manifest Error:', error.message);
        res.status(500).send('Error fetching manifest');
    }
});

// 3. بروكسي قطع الفيديو (Segments) - يقوم بطلب الـ ts مع حقن الهيدرز 
app.get('/proxy/segment', async (req, res) => {
    const targetUrl = req.query.url;
    const headerToken = req.query.h;

    if (!targetUrl || !headerToken) return res.status(400).send('Missing parameters');

    const headersData = decodeHeaders(headerToken);
    if (!headersData) return res.status(400).send('Invalid token');

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': headersData.ua,
                'Referer': headersData.r,
                'Range': req.headers.range || 'bytes=0-' // لدعم التنقل داخل الفيديو
            },
            responseType: 'stream',
            validateStatus: status => status >= 200 && status < 500
        });

        res.set('Access-Control-Allow-Origin', '*');
        res.set('Content-Type', response.headers['content-type'] || 'video/MP2T');
        
        // تمرير هيدرز الرينج (Range) ليعمل المشغل بشكل صحيح
        if (response.headers['content-range']) res.set('Content-Range', response.headers['content-range']);
        if (response.headers['content-length']) res.set('Content-Length', response.headers['content-length']);
        if (response.headers['accept-ranges']) res.set('Accept-Ranges', response.headers['accept-ranges']);

        response.data.pipe(res);
    } catch (error) {
        console.error('Segment Error:', error.message);
        res.status(500).send('Error fetching segment');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
