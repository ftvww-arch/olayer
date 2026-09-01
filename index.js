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

app.get('/proxy', async (req, res) => {
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
            // منع Axios من إطلاق خطأ تلقائي مع بعض أكواد الحالة غير القياسية إن وجدت
            validateStatus: function (status) {
                return status >= 200 && status < 500; 
            }
        };

        const response = await axios.get(targetUrl, config);

        if (response.status !== 200 && response.status !== 206) {
            console.error(`Target responded with status ${response.status} for URL: ${targetUrl}`);
            return res.status(response.status).send(`Target server error: ${response.status}`);
        }

        if (targetUrl.includes('.m3u8')) {
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

                return `/proxy?url=${encodeURIComponent(absoluteLink)}`;
            });

            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(rewrittenLines.join('\n'));
        } else {
            const streamResponse = await axios({
                method: 'GET',
                url: targetUrl,
                headers: config.headers,
                responseType: 'stream'
            });
            
            res.set('Content-Type', streamResponse.headers['content-type'] || 'video/MP2T');
            if (streamResponse.headers['content-range']) {
                res.set('Content-Range', streamResponse.headers['content-range']);
            }
            return streamResponse.data.pipe(res);
        }
    } catch (error) {
        console.error(`[Proxy Error] ${targetUrl}:`, error.message);
        res.status(500).send('Proxy Error');
    }
});

app.get('/', (req, res) => {
    // ضع رابط البث الكامل مع الـ Token هنا
    const initialStream = 'http://89.33.13.177/live/16304575049793/43581893985883/585734.m3u8?token=aUdHbU.acXXydc.y.aUzdaby.yczHbdcU.X.y.TR.m3u8.400893ed4a1dcb1f9bc8504f26d7e5f13d29a85368613b78395517546617301c...b3JpZW4ubGl2ZQ==';
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
