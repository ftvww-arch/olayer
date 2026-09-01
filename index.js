const express = require('express');
const axios = require('axios');
const app = express();

const CUSTOM_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': 'https://cdnz.quest/',
    'Origin': 'https://cdnz.quest'
};

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// استقبال رابط m3u8 ديناميكياً مباشرة من المسار
app.get('/url/*', async (req, res) => {
    // استخراج الرابط الكامل مع كافة المعلمات التابعة له (Query parameters)
    const targetUrl = req.originalUrl.replace(/^\/url\//, '');

    if (!targetUrl || !targetUrl.startsWith('http')) {
        return res.status(400).send('رابط غير صالح');
    }

    try {
        const response = await axios.get(targetUrl, {
            headers: CUSTOM_HEADERS,
            timeout: 10000
        });

        const lines = response.data.split('\n');
        const updatedLines = lines.map(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return line;

            // تحويل الروابط النسبية إلى روابط كاملة بناءً على رابط المصدر
            const absoluteUrl = new URL(trimmed, targetUrl).href;

            // إذا كانت القائمة تحتوي على ملف m3u8 فرعي أو شرائح ts
            if (absoluteUrl.includes('.m3u8')) {
                return `http://localhost:3000/url/${absoluteUrl}`;
            } else {
                return `http://localhost:3000/segment?url=${encodeURIComponent(absoluteUrl)}`;
            }
        });

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(updatedLines.join('\n'));
    } catch (error) {
        console.error('خطأ أثناء جلب الملف:', error.message);
        res.status(error.response?.status || 500).send('فشل جلب ملف m3u8');
    }
});

// تمرير شرائح البث (.ts)
app.get('/segment', async (req, res) => {
    const segmentUrl = req.query.url;
    if (!segmentUrl) return res.status(400).send('رابط الشريحة مفقود');

    try {
        const response = await axios({
            method: 'get',
            url: segmentUrl,
            headers: CUSTOM_HEADERS,
            responseType: 'stream'
        });

        res.setHeader('Content-Type', 'video/mp2t');
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('فشل جلب شريحة الفيديو');
    }
});

app.listen(3000, () => {
    console.log('Dynamic Proxy Server running on port 3000');
});
