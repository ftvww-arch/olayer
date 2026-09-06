// --- إعدادات الكاش ---
const manifestCache = new Map(); // لتخزين المانفيست
const segmentCache = new Map(); // لتخزين قطع الفيديو
const activeRequests = new Map(); // لمنع تكرار الطلب للمصدر في نفس اللحظة (Cache Stampede)

// 2. بروكسي المانفيست مع دعم مفاتيح التشفير (محدث مع كاش)
app.get('/proxy/manifest.m3u8', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url');

    // التحقق إذا كان المانفيست موجود في الكاش (صالح لمدة ثانيتين للبث المباشر)
    if (manifestCache.has(targetUrl)) {
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(manifestCache.get(targetUrl));
    }

    // إذا كان هناك طلب جاري حالياً لنفس الرابط، انتظر حتى ينتهي
    if (activeRequests.has(targetUrl)) {
        const data = await activeRequests.get(targetUrl);
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(data);
    }

    const fetchPromise = (async () => {
        try {
            const fetchUrl = WORKER_BASE_URL + encodeURIComponent(targetUrl);
            const response = await axios.get(fetchUrl, {
                headers: WORKER_HEADERS,
                responseType: 'text',
                validateStatus: status => status >= 200 && status < 500
            });

            const finalUrl = response.request?.res?.responseUrl || targetUrl;
            const hostProtocol = req.protocol;
            const hostName = req.get('host');

            let lines = response.data.split('\n');
            let rewrittenLines = lines.map(line => {
                let trimmed = line.trim();
                if (trimmed.startsWith('#')) {
                    if (trimmed.includes('URI="')) {
                        return trimmed.replace(/URI="(.*?)"/g, (match, p1) => {
                            let absKeyUrl = new URL(p1, finalUrl).href;
                            return `URI="${hostProtocol}://${hostName}/proxy/segment?url=${encodeURIComponent(absKeyUrl)}"`;
                        });
                    }
                    return trimmed;
                }
                if (!trimmed) return trimmed;

                let absoluteLink = new URL(trimmed, finalUrl).href;
                if (absoluteLink.includes('.m3u8')) {
                    return `${hostProtocol}://${hostName}/proxy/manifest.m3u8?url=${encodeURIComponent(absoluteLink)}`;
                } else {
                    return `${hostProtocol}://${hostName}/proxy/segment?url=${encodeURIComponent(absoluteLink)}`;
                }
            });

            const processedManifest = rewrittenLines.join('\n');
            
            // حفظ في الكاش لمدة 3 ثواني (المانفيست يتحدث باستمرار في البث المباشر)
            manifestCache.set(targetUrl, processedManifest);
            setTimeout(() => manifestCache.delete(targetUrl), 3000);

            return processedManifest;
        } finally {
            activeRequests.delete(targetUrl); // إزالة القفل بعد الانتهاء
        }
    })();

    activeRequests.set(targetUrl, fetchPromise);
    
    try {
        const data = await fetchPromise;
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(data);
    } catch (error) {
        console.error('Manifest Error:', error.message);
        res.status(500).send('Error proxying manifest');
    }
});

// 3. بروكسي قطع الفيديو (محدث مع كاش في الذاكرة لتخفيف الضغط)
app.get('/proxy/segment', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url');

    // التحقق من الكاش (القطع لا تتغير، لذا نحفظها لمدة أطول)
    if (segmentCache.has(targetUrl)) {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Content-Type', 'video/MP2T');
        return res.send(segmentCache.get(targetUrl));
    }

    // إذا كان المقطع يتم تحميله الآن بواسطة مستخدم آخر، اجعل هذا المستخدم ينتظر
    if (activeRequests.has(targetUrl)) {
        const data = await activeRequests.get(targetUrl);
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Content-Type', 'video/MP2T');
        return res.send(data);
    }

    const fetchPromise = (async () => {
        try {
            const fetchUrl = WORKER_BASE_URL + encodeURIComponent(targetUrl);
            
            // نستخدم arraybuffer لحفظ البيانات في الذاكرة بسهولة
            const response = await axios.get(fetchUrl, {
                headers: WORKER_HEADERS,
                responseType: 'arraybuffer', 
                decompress: false,
                validateStatus: status => status >= 200 && status < 500
            });

            const bufferData = Buffer.from(response.data);

            // حفظ المقطع في الكاش لمدة 60 ثانية (كافية جداً للبث المباشر)
            segmentCache.set(targetUrl, bufferData);
            setTimeout(() => segmentCache.delete(targetUrl), 60000);

            return bufferData;
        } finally {
            activeRequests.delete(targetUrl);
        }
    })();

    activeRequests.set(targetUrl, fetchPromise);

    try {
        const data = await fetchPromise;
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Content-Type', 'video/MP2T');
        res.send(data);
    } catch (error) {
        console.error('Segment Error:', error.message);
        res.status(500).send('Error proxying segment');
    }
});
