const axios = require('axios');

// دالة فك تشفير Dean Edwards Packer بدون مكتبات خارجية
function unpackPacker(packedCode) {
  try {
    const reg = /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/;
    const match = packedCode.match(reg);
    if (!match) return null;

    // استخراج المكونات من داخل دالة eval
    const code = match[0];
    const argsMatch = code.match(/}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);

    if (!argsMatch) return null;

    let [_, payload, baseStr, countStr, keywordsStr] = argsMatch;
    let base = parseInt(baseStr, 10);
    let count = parseInt(countStr, 10);
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

    // استبدال الكلمات التابعة لجدول التشفير
    return payload.replace(/\b\w+\b/g, (word) => {
      const index = unbase(word, base);
      return keywords[index] || word;
    });
  } catch (e) {
    return null;
  }
}

async function getDirectStream(embedUrl) {
  try {
    const response = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://vidoba.org/'
      }
    });

    const htmlContent = response.data;

    // فك الضغط
    const unpackedCode = unpackPacker(htmlContent);

    if (!unpackedCode) {
      console.log('فشل في فك الضغط التلقائي، جاري الفحص عبر التعبيرات النمطية...');
    }

    // البحث عن رابط m3u8 سواء من النص المفكوك أو النص الاصلي
    const searchTarget = unpackedCode || htmlContent;
    const m3u8Match = searchTarget.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/);

    if (m3u8Match && m3u8Match[0]) {
      const streamUrl = m3u8Match[0];
      
      console.log('====================================');
      console.log('تم استخراج الرابط المباشر بنجاح:');
      console.log(streamUrl);
      console.log('====================================');

      return {
        streamUrl: streamUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://vidoba.org/'
        }
      };
    } else {
      console.log('لم يتم العثور على رابط m3u8.');
    }

  } catch (error) {
    console.error('حدث خطأ أثناء جلب البيانات:', error.message);
  }
}

getDirectStream('https://mp4.okhd.site/embed-e5envbtzwebs.html');
