const axios = require('axios');

async function getFaselStreamData(targetUrl) {
  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.fasel-hd.co/'
      }
    });

    const htmlContent = response.data;

    // 1. البحث عن رابط m3u8 صريح داخل الصفحة
    let m3u8Match = htmlContent.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/);
    let streamUrl = m3u8Match ? m3u8Match[0] : null;

    // 2. إذا لم يكن الرابط صريحاً، يتم تجميعه من الأجزاء النصية للمتغير videoSrc
    if (!streamUrl) {
      const srcMatch = htmlContent.match(/videoSrc\s*=\s*([^;]+);/);
      if (srcMatch) {
        const stringParts = srcMatch[1].match(/['"]([^'"]+)['"]/g);
        if (stringParts) {
          streamUrl = stringParts.map(part => part.replace(/['"]/g, '')).join('');
        }
      }
    }

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
