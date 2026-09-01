const express = require('express');
const app = express();
const PORT = 3000;

const STREAM_URL = 'http://orien.live/live/16304575049793/43581893985883/445377.m3u8';

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>مشغل البث المباشر</title>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            background-color: #0f172a;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            font-family: system-ui, -apple-system, sans-serif;
        }
        .player-wrapper {
            width: 90%;
            max-width: 960px;
            background: #1e293b;
            padding: 16px;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
        }
        video {
            width: 100%;
            height: auto;
            border-radius: 8px;
            display: block;
        }
    </style>
</head>
<body>

<div class="player-wrapper">
    <video id="videoPlayer" controls autoplay playsinline muted></video>
</div>

<script>
    const video = document.getElementById('videoPlayer');
    const streamSrc = '${STREAM_URL}';

    if (Hls.isSupported()) {
        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true
        });
        hls.loadSource(streamSrc);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(err => console.log('Autoplay blocked:', err));
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamSrc;
        video.addEventListener('loadedmetadata', () => {
            video.play().catch(err => console.log('Autoplay blocked:', err));
        });
    }
</script>

</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
