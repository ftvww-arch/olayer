const express = require('express');
const axios = require('axios');
const app = express();

const STREAM_URL = 'https://afast-cdn1-liu.cdnz.quest/hls2/01/00070/k7i1jzwik4i0_,l,n,.urlset/master.m3u8?t=uP7Q5_Wgw-GKceYusu-uDWmn9UIMkj6qL6iVMEqgnY4&s=1788239082&e=18000&v=169417097&i=0.3&sp=0';

// الترويسات المطلوبة لتجاوز حظر الـ CDN
const CUSTOM_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://cdnz.quest/',
    'Origin': 'https://cdnz.quest'
};

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// 1. جلب وتعديل قائمة M3U8
app.get('/manifest.m3u8', async (req, res) => {
    try {
        const response = await axios.get(STREAM_URL, { headers: CUSTOM_HEADERS });
        let data = response.data;

        // إعادة توجيه كافة روابط الشرائح والقوائم الفرعية عبر البروكسي
        data = data.replace(/(https?:\/\/[^\s]+)/g, (url) => {
            return `http://localhost:3000/segment?url=${encodeURIComponent(url)}`;
        });

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(data);
    } catch (error) {
        res.status(500).send('Error fetching playlist: ' + error.message);
    }
});

// 2. تمرير شرائح الفيديو (.ts) مع الترويسات
app.get('/segment', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing URL');

    try {
        const response = await axios({
            method: 'get',
            url: targetUrl,
            headers: CUSTOM_HEADERS,
            responseType: 'stream'
        });

        res.setHeader('Content-Type', 'video/mp2t');
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('Segment fetch failed');
    }
});

app.listen(3000, () => {
    console.log('Proxy running on http://localhost:3000/manifest.m3u8');
});
