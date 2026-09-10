const axios = require('axios');

// دالة فك تشفير Packer مخصصة وسريعة
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

    // 1. طلب كود الصفحة النصي
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': domainOrigin + '/'
      }
    });

    const htmlContent = response.data;

    // 2. فك التشفير برمجياً بالذاكرة
    const unpackedCode = unpackPacker(htmlContent);
    const searchTarget = unpackedCode || htmlContent;

    // 3. استخراج رابط البث الرئيسي m3u8
    const m3u8Match = searchTarget.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/);

    if (!m3u8Match || !m3u8Match[0]) {
      console.log('لم يتم العثور على رابط m3u8.');
      return;
    }

    const streamUrl = m3u8Match[0];
    const streamDomainObj = new URL(streamUrl);

    // 4. صياغة المخرجات بهيكلية الـ JSON المطلوبة
    const resultJson = {
      "server_url": streamDomainObj.origin,
      "stream_url": streamUrl,
      "headers": {
        "Origin": domainOrigin,
        "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "sec-ch-ua-mobile": "?0",
        "Accept": "*/*",
        "sec-ch-ua-platform": '"Windows"',
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": domainOrigin + "/"
      }
    };

    console.log(JSON.stringify(resultJson, null, 4));
    return resultJson;

  } catch (error) {
    console.error('حدث خطأ أثناء معالجة الطلب:', error.message);
  }
}

// تجربة الكود على الدومين الجديد
getStreamData('https://mp4.okhd.site/embed-ucxfznd08o4y.html');
