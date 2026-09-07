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

// الهيدرز المطابقة تماماً لطلب المتصفح الأصلي لتخطي حماية Cloudflare
const WORKER_HEADERS = {
    'Accept': '*/*',
    // إزالة accept-encoding من هنا وتركها افتراضية لتجنب مشاكل zstd في Node.js
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

// 1. مسار جلب القناة
app.get('/channel/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const apiUrl = `https://website.fancy-water-8bf9.workers.dev/api/channel/${id}`;
        
        const response = await axios.get(apiUrl, { headers: WORKER_HEADERS });
        const data = response.data?.data?.[0];
        
        if (!data || !data.url) {
            return res.status(404).send('لم يتم العثور على القناة أو البث متوقف.');
        }

        const hostProtocol = req.protocol;
        const hostName = req.get('host');
        
        // رابط المانفيست الموجه للبروكسي الخاص بنا
        const manifestProxyUrl = `${hostProtocol}://${hostName}/proxy/manifest.m3u8?url=${encodeURIComponent(data.url)}`;

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
                    <h2>بث القناة: ${id}</h2>
                    <input type="text" readonly value="${manifestProxyUrl}" onclick="this.select();">
                </div>
                <video id="video" controls autoplay></video>
                <script>
                    const video = document.getElementById('video');
                    const videoSrc = "${manifestProxyUrl}";

                    if (Hls.isSupported()) {
                        const hls = new Hls({
                            // إعدادات متقدمة لتخطي أخطاء التحميل
                            maxBufferLength: 30,
                            manifestLoadingTimeOut: 20000,
                            manifestLoadingMaxRetry: 3
                        });
                        hls.loadSource(videoSrc);
                        hls.attachMedia(video);
                        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(()=>{}));
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = videoSrc;
                        video.addEventListener('loadedmetadata', () => video.play().catch(()=>{}));
                    }
                </script>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('API Error:', error.message);
        res.status(500).send('تعذر الاتصال بـ API القنوات.');
    }
});

// 2. بروكسي المانفيست مع دعم مفاتيح التشفير
app.get('/proxy/manifest.m3u8', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url');

    try {
        const fetchUrl = WORKER_BASE_URL + encodeURIComponent(targetUrl);
        
        const response = await axios.get(fetchUrl, {
            headers: WORKER_HEADERS,
            responseType: 'text',
            validateStatus: status => status >= 200 && status < 500
        });

        // الحصول على الرابط النهائي بعد التحويلات (Redirects) إن وجدت
        const finalUrl = response.request?.res?.responseUrl || targetUrl;
        const hostProtocol = req.protocol;
        const hostName = req.get('host');

        let lines = response.data.split('\n');
        let rewrittenLines = lines.map(line => {
            let trimmed = line.trim();

            // معالجة مفاتيح التشفير (AES-128 Keys) الموجودة داخل الهشتاغ
            if (trimmed.startsWith('#')) {
                if (trimmed.includes('URI="')) {
                    return trimmed.replace(/URI="(.*?)"/g, (match, p1) => {
                        let absKeyUrl = new URL(p1, finalUrl).href;
                        let proxyKeyUrl = `${hostProtocol}://${hostName}/proxy/segment?url=${encodeURIComponent(absKeyUrl)}`;
                        return `URI="${proxyKeyUrl}"`;
                    });
                }
                return trimmed;
            }

            if (!trimmed) return trimmed;

            // معالجة روابط الفيديو والجودات
            let absoluteLink = new URL(trimmed, finalUrl).href;

            if (absoluteLink.includes('.m3u8')) {
                return `${hostProtocol}://${hostName}/proxy/manifest.m3u8?url=${encodeURIComponent(absoluteLink)}`;
            } else {
                return `${hostProtocol}://${hostName}/proxy/segment?url=${encodeURIComponent(absoluteLink)}`;
            }
        });

        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(rewrittenLines.join('\n'));
    } catch (error) {
        console.error('Manifest Error:', error.message);
        res.status(500).send('Error proxying manifest');
    }
});

// 3. بروكسي قطع الفيديو (Raw Stream Proxy) لتجنب أخطاء zstd و gzip
app.get('/proxy/segment', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url');

    try {
        const fetchUrl = WORKER_BASE_URL + encodeURIComponent(targetUrl);
        
        const headers = { ...WORKER_HEADERS };
        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        const response = await axios.get(fetchUrl, {
            headers: headers,
            responseType: 'stream',
            decompress: false, // [مهم جداً] إيقاف فك الضغط التلقائي لتجنب تلف القطع
            validateStatus: status => status >= 200 && status < 500
        });

        res.set('Access-Control-Allow-Origin', '*');
        
        // تمرير جميع الترويسات الهامة من السيرفر الأصلي كما هي للمشغل
        const headersToForward = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-encoding'];
        headersToForward.forEach(h => {
            if (response.headers[h]) {
                res.set(h, response.headers[h]);
            }
        });
        
        // إذا لم يكن هناك Content-Type، نفترض أنه فيديو TS
        if (!res.getHeader('content-type')) {
            res.set('Content-Type', 'video/MP2T');
        }

        response.data.pipe(res);
    } catch (error) {
        console.error('Segment Error:', error.message);
        res.status(500).send('Error proxying segment');
    }
});

app.listen(PORT, () => {
    console.log(`Server running like a charm on port ${PORT}`);
});
