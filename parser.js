const axios = require('axios');

function parseFaselHD(htmlContent) {
  try {
    // 1. البحث عن مصفوفة النصوص الأساسية
    const arrayMatch = htmlContent.match(/var _0x1ca549=\[([\s\S]*?)\];/);
    if (!arrayMatch) return null;

    // تحويل المصفوفة النصية إلى Array حقيقي
    const rawArray = arrayMatch[1]
      .split(',')
      .map(item => item.trim().replace(/^['"]|['"]$/g, ''));

    // 2. دالة فك تشفير Base64 الخاصة بـ fasel-hd
    function decodeBase64(str) {
      return Buffer.from(str, 'base64').toString('utf8');
    }

    // 3. استخراج القيم المباشرة للرابط من الكود
    const hexMatches = htmlContent.match(/_0x(?:4205ad|423af7)\(0x[a-f0-9]+,\s*0x[a-f0-9]+,\s*0x[a-f0-9]+,\s*0x[a-f0-9]+\)/g);
    
    // استخراج أجزاء الرابط النصية الصريحة المحيطة بالدوال
    const videoSrcLine = htmlContent.match(/var videoSrc=([\s\S]*?);/);
    if (!videoSrcLine) return null;

    const parts = videoSrcLine[1].split('+');
    let fullUrl = '';

    for (let part of parts) {
      part = part.trim();
      if (part.startsWith("'") || part.startsWith('"')) {
        // جزء نصي عادي
        fullUrl += part.replace(/^['"]|['"]$/g, '');
      } else {
        // استخراج أرقام الـ Offset من استدعاء الدالة
        const args = part.match(/0x[a-f0-9]+/g);
        if (args && args.length >= 3) {
          const num1 = parseInt(args[0], 16);
          const num3 = parseInt(args[2], 16);
          // حساب الـ Index داخل المصفوفة
          const index = num3 - num1 - 0x1f;
          if (rawArray[index]) {
            try {
              fullUrl += decodeBase64(rawArray[index]);
            } catch (e) {
              fullUrl += rawArray[index];
            }
          }
        }
      }
    }

    return fullUrl.includes('.m3u8') ? fullUrl : null;
  } catch (err) {
    return null;
  }
}

async function getFaselStreamData(targetUrl) {
  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.fasel-hd.co/'
      }
    });

    const htmlContent = response.data;

    // 1. فحص وجود رابط مباشر صريح
    let directMatch = htmlContent.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/);
    let streamUrl = directMatch ? directMatch[0] : parseFaselHD(htmlContent);

    if (streamUrl) {
      console.log('====================================');
      console.log('تم استخراج الرابط المباشر بنجاح:');
      console.log(streamUrl);
      console.log('====================================');
      return streamUrl;
    } else {
      console.log('لم يتم العثور على رابط m3u8.');
    }

  } catch (error) {
    console.error('حدث خطأ أثناء جلب البيانات:', error.message);
  }
}

getFaselStreamData('https://www.fasel-hd.co/video_player?player_token=OXVudUFOVnhzMXJKeVJ6am5ZYkkvSk1HU3VaS0hoZFNwUHVDRVk3QktSbmM5V3N1NDE2QTB0VVQ3MEQ0NFR1K2cvOXpscXIySEt4ZTZpMHZ6MGpLdGFmR3VpMERsczB2WHgxMVNERSthQWxKdGR2OVVxZXpkVlRPMGhRRytXYW8zYjBqQTBYUk1QcHU5SlNhQ1ExSk5TNGNQQ1ZJalZqMXBHRWw0bVl6Wmg5eldEYWhQVmlsaEhpYjFqSysraHJjUk15bkI0VU9tS1NqbnBpdG5DWmJwWnp3UWJEOU95dkRBTGRpVFhHMGRnMDlYbjlNazB5bUJQSWpFL0g2TDExVjo6lahF6AOml1x7y1nfMcd8kw%3D%3D');
