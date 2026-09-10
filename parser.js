const axios = require('axios');

// دالة فك تشفير Dean Edwards Packer بدون مكتبات خارجية
function unpackPacker(packedCode) {
  try {
    const reg = /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/;
    const match = packedCode.match(reg);
    if (!match) return null;

    const code = match[0];
    const argsMatch = code.match(/}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);

    if (!argsMatch) return null;

    let [_, payload, baseStr, countStr, keywordsStr] = argsMatch;
    let base = parseInt(baseStr, 10);
    let keywords = keywordsStr.split('|');

    function unbase(val, base) {
      const dict = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let res = 0;
      const chars = val.split('').reverse();
      for (let i = 0; i < chars.length; i++) {
        const index = dict.indexOf(chars[i]);
        if (index !== -1) {
          res += index * Math.pow(base, i);
        }
      }
      return res;
    }

    return payload.replace(/\b\w+\b/g, (word) => {
      const index = unbase(word, base);
      return keywords[index] || word;
    });
  } catch (e) {
    return null;
  }
}

async function getStreamData(targetUrl) {
  try {
    const urlObj = new URL(targetUrl);
    const domainOrigin = urlObj.origin;

    // طلب كود الصفحة مع هيدرز كاملة لتجاوز حظر 403
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': domainOrigin + '/',
        'Sec-Ch-Ua': '"Chromium";v="128", "Not=A?Brand";v="24", "Google Chrome";v="128"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    const htmlContent = response.data;

    // فك تشفير الكود بالذاكرة
    const unpackedCode = unpackPacker(htmlContent);
    const searchTarget = unpackedCode || htmlContent;

    // استخراج رابط m3u8
    const m3u8Match = searchTarget.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/);

    if (!m3u8Match || !m3u8Match[0]) {
      console.log('لم يتم العثور على رابط m3u8.');
      return;
    }

    const streamUrl = m3u8Match[0];
    const streamDomainObj = new URL(streamUrl);

    // صياغة المخرجات بنفس تنسيق الـ JSON المطلوب
    const resultJson = {
      "server_url": streamDomainObj.origin,
      "stream_url": streamUrl,
      "headers": {
        "Origin": domainOrigin,
        "sec-ch-ua": '"Chromium";v="128", "Not=A?Brand";v="24", "Google Chrome";v="128"',
        "sec-ch-ua-mobile": "?0",
        "Accept": "*/*",
        "sec-ch-ua-platform": '"Windows"',
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Referer": domainOrigin + "/"
      }
    };

    console.log(JSON.stringify(resultJson, null, 4));
    return resultJson;

  } catch (error) {
    console.error('حدث خطأ أثناء معالجة الطلب:', error.message);
  }
}

// تشغيل الدالة على الدومين المستهدف
getStreamData('https://mp4.okhd.site/embed-ucxfznd08o4y.html');
