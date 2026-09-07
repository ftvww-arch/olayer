const express = require('express');
const axios = require('axios');
const compression = require('compression');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const SECRET_KEY = process.env.SECRET_KEY || 'my-super-secret-streaming-key-2026';
const TOKEN_EXPIRY_HOURS = 2; // صلاحية الساعتين

// إعدادات الكاش
const MANIFEST_CACHE_TTL = 4000; // 4 ثوانٍ لملفات m3u8 (لأن البث المباشر يتحدث باستمرار)
const TS_CACHE_TTL = 60000; // 60 ثانية لقطع الفيديو .ts (لأنها ثابتة ولا تتغير)
const MAX_TS_CACHE_ITEMS = 500; // الحد الأقصى لعدد قطع الفيديو في الذاكرة لحماية الرام

// خرائط التخزين المؤقت والطلبات المعلقة (Request Coalescing)
const manifestCache = new Map();     // لتخزين بيانات m3u8
const manifestPromises = new Map();  // لتخزين الطلبات التي قيد التنفيذ حالياً لـ m3u8

const tsCache = new Map();           // لتخزين بيانات قطع الفيديو (Buffers)
const tsPromises = new Map();        // لتخزين الطلبات التي قيد التنفيذ حالياً لـ ts

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

app.use(compression());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// دالة لتوليد توكن مشفر
function generateShortToken(targetUrl) {
    const expiresAt = Date.now() + (TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
    const payload = JSON.stringify({ url: targetUrl, exp: expiresAt });
    const base64Payload = Buffer.from(payload).toString('base64url');
    
    const signature = crypto
        .createHmac('sha256', SECRET_KEY)
        .update(base64Payload)
        .digest('hex');
        
    return `${base64Payload}.${signature}`;
}

// دالة فحص التوكن
function decryptShortToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 2) return { error: 'Invalid' };
        
        const [base64Payload, signature] = parts;
        
        const expectedSignature = crypto
            .createHmac('sha256', SECRET_KEY)
            .update(base64Payload)
            .digest('hex');
            
        if (signature !== expectedSignature) {
            return { error: 'Invalid' };
        }
        
        const payloadJson = Buffer.from(base64Payload, 'base64url').toString('utf8');
        const { url, exp } = JSON.parse(payloadJson);
        
        if (Date.now() > exp) {
            return { error: 'Expired' };
        }
        
        return { targetUrl: url };
    } catch (e) {
        return { error: 'Invalid' };
    }
}

// ==========================================
// قلب النظام: مدير جلب وتخزين ملفات Manifest
// ==========================================
async function fetchAndRewriteManifest(targetUrl, req) {
    // 1. هل النتيجة موجودة في الكاش وصالحة؟
    if (manifestCache.has(targetUrl)) {
        const cached = manifestCache.get(targetUrl);
        if (Date.now() < cached.expireTime) return cached.data;
    }

    // 2. هل هناك طلب يتم جلبه الآن؟ (لو 1000 شخص طلبوا معاً، 999 سينتظرون هنا)
    if (manifestPromises.has(targetUrl)) {
        return manifestPromises.get(targetUrl);
    }

    // 3. إنشاء طلب جديد للسيرفر الأصلي (سيتم تنفيذه مرة واحدة فقط)
    const promise = (async () => {
        try {
            const response = await axios.get(targetUrl, {
                headers: { 'User-Agent': USER_AGENT },
                maxRedirects: 10,
                validateStatus: status => status >= 200 && status < 500
            });

            if (typeof response.data !== 'string') throw new Error('Invalid manifest data');

            const finalUrl = response.request.res.responseUrl || targetUrl;
            const baseUrl = new URL(finalUrl).origin;

            let lines = response.data.split('\n');
            let rewrittenLines = lines.map(line => {
                let trimmed = line.trim();
                if (trimmed.startsWith('#') || !trimmed) return trimmed;

                let absoluteLink = trimmed.startsWith('http') ? trimmed 
                                 : trimmed.startsWith('/') ? baseUrl + trimmed 
                                 : new URL(trimmed, finalUrl).href;

                const hostProtocol = req.protocol;
                const hostName = req.get('host');
                return `${hostProtocol}://${hostName}/proxy?url=${encodeURIComponent(absoluteLink)}`;
            });

            const finalManifest = rewrittenLines.join('\n');
            
            // حفظ النتيجة في الكاش
            manifestCache.set(targetUrl, { data: finalManifest, expireTime: Date.now() + MANIFEST_CACHE_TTL });
            return finalManifest;
        } finally {
            // مسح الوعد بعد الانتهاء لكي يتم عمل طلب جديد عند انتهاء الكاش
            manifestPromises.delete(targetUrl);
        }
    })();

    manifestPromises.set(targetUrl, promise);
    return promise;
}

// ==========================================
// قلب النظام: مدير جلب وتخزين قطع الفيديو TS
// ==========================================
async function fetchSegment(targetUrl) {
    if (tsCache.has(targetUrl)) {
        const cached = tsCache.get(targetUrl);
        if (Date.now() < cached.expireTime) return cached;
    }

    if (tsPromises.has(targetUrl)) {
        return tsPromises.get(targetUrl);
    }

    const promise = (async () => {
        try {
            const response = await axios.get(targetUrl, {
                headers: { 'User-Agent': USER_AGENT },
                responseType: 'arraybuffer', // تحميل الملف بالكامل إلى الذاكرة
                maxRedirects: 5,
                validateStatus: status => status >= 200 && status < 500
            });

            const result = {
                buffer: Buffer.from(response.data),
                contentType: response.headers['content-type'] || 'video/MP2T'
            };

            // حماية الذاكرة (RAM): إذا زاد الكاش عن الحد، نحذف أقدم ملف
            if (tsCache.size >= MAX_TS_CACHE_ITEMS) {
                const oldestKey = tsCache.keys().next().value;
                tsCache.delete(oldestKey);
            }

            tsCache.set(targetUrl, { ...result, expireTime: Date.now() + TS_CACHE_TTL });

            // حذف الملف من الذاكرة تلقائياً بعد مرور الوقت
            setTimeout(() => { tsCache.delete(targetUrl); }, TS_CACHE_TTL);

            return result;
        } finally {
            tsPromises.delete(targetUrl);
        }
    })();

    tsPromises.set(targetUrl, promise);
    return promise;
}

// ==========================================
// المسارات (Routes)
// ==========================================

app.get('/generate', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Please provide a ?url=...');

    const token = generateShortToken(targetUrl);
    const shortLink = `${req.protocol}://${req.get('host')}/play/${token}/manifest.m3u8`;

    res.send(`
        <html dir="rtl" style="background:#0f172a;color:#fff;font-family:sans-serif;text-align:center;padding-top:50px;">
            <h3>رابط البث المشفر والمؤقت (صالح لمدة ساعتين فقط):</h3>
            <input type="text" readonly value="${shortLink}" style="width:80%;max-width:600px;padding:10px;background:#1e293b;border:1px solid #475569;color:#38bdf8;border-radius:6px;" onclick="this.select();">
            <p style="color:#94a3b8;margin-top:10px;">هذا الرابط سيتوقف عن العمل تلقائياً بعد مرور ساعتين.</p>
        </html>
    `);
});

// مسار المشغل والمانفيست (بالتوكن)
app.get('/play/:token/manifest.m3u8', async (req, res) => {
    const { token } = req.params;
    const decrypted = decryptShortToken(token);

    if (decrypted.error === 'Expired') return res.status(403).send('انتهت صلاحية هذا الرابط (عبر ساعتين).');
    if (decrypted.error === 'Invalid' || !decrypted.targetUrl) return res.status(400).send('رابط غير صالح.');

    try {
        const manifest = await fetchAndRewriteManifest(decrypted.targetUrl, req);
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(manifest);
    } catch (error) {
        res.status(500).send('Error fetching manifest');
    }
});

// مسار مباشر ودائم بدون توكن
app.get('/direct/manifest.m3u8', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Please provide a ?url=...');

    try {
        const manifest = await fetchAndRewriteManifest(targetUrl, req);
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(manifest);
    } catch (error) {
        res.status(500).send('Error fetching direct manifest');
    }
});

// مسار البروكسي لقطع الفيديو .ts (مع الكاش!)
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    try {
        const segment = await fetchSegment(targetUrl);
        res.set('Content-Type', segment.contentType);
        // نرسل البيانات مباشرة من الذاكرة
        res.send(segment.buffer);
    } catch (error) {
        res.status(500).send('Proxy Error');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
