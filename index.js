const express = require('express');
const axios = require('axios');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// استخدام مكتبة compression تضمن إضافة الهيدرز:
// content-encoding: gzip
// transfer-encoding: chunked
app.use(compression());

// الرابط الأصلي المطلوب
const TARGET_URL = "https://afast-cdn1-liu.cdnz.quest/hls2/01/00070/k7i1jzwik4i0_,l,n,.urlset/master.m3u8?t=jJ9G2DIglFkj_fuNzklnzDyQt0kv7Qtrn-gfoq14BeM&s=1788238541&e=18000&v=169417097&i=0.3&sp=0";

// استخراج المسار الأساسي لضمان عمل ملفات .ts الفرعية (Segments)
const BASE_URL = TARGET_URL.substring(0, TARGET_URL.lastIndexOf('/') + 1);

app.get('/', async (req, res) => {
    try {
        // جلب ملف m3u8 من السيرفر الأصلي
        const response = await axios.get(TARGET_URL);
        let m3u8Content = response.data;

        // معالجة الملف: تحويل الروابط النسبية للـ ts إلى روابط مطلقة للسيرفر الأصلي
        m3u8Content = m3u8Content.split('\n').map(line => {
            if (line.trim() && !line.startsWith('#') && !line.startsWith('http')) {
                return BASE_URL + line.trim();
            }
            return line;
        }).join('\n');

        // حقن جميع الهيدرز المطلوبة
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=8640000, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Server', 'nginx');

        // تعيين التواريخ بشكل ديناميكي (بدل تثبيتها في الماضي لتجنب مشاكل المتصفح)
        const now = new Date();
        const expires = new Date(now.getTime() + 8640000 * 1000);
        res.setHeader('Date', now.toUTCString());
        res.setHeader('Expires', expires.toUTCString());
        res.setHeader('Last-Modified', now.toUTCString());

        // إرسال المحتوى النهائي للمشغل
        res.send(m3u8Content);

    } catch (error) {
        console.error('Error fetching stream:', error.message);
        res.status(500).send('فشل في جلب الرابط الأصلي');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
