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

    // 1. البحث أولاً عن أي رابط m3u8 صريح وكامل
    let directM3u8 = htmlContent.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
    if (directM3u8) {
      console.log('====================================');
      console.log('تم استخراج الرابط المباشر بنجاح:');
      console.log(directM3u8[0]);
      console.log('====================================');
      return directM3u8[0];
    }

    // 2. إذا كان الرابط مجمعاً عبر دالة التشفير المخصصة، نستخرج المتغير المنتهي بـ .m3u8
    const videoSrcMatch = htmlContent.match(/videoSrc\s*=\s*([^;]+);/);
    if (!videoSrcMatch) {
      console.log('لم يتم العثور على كود الفيديو.');
      return;
    }

    // استخراج كافة أجزاء النصوص والحروف المتصلة بالرابط
    const rawParts = videoSrcMatch[1].match(/_0x[a-f0-9]+\(0x[a-f0-9]+,\s*0x[a-f0-9]+,\s*0x[a-f0-9]+,\s*0x[a-f0-9]+\)|'[^']+'|"[^"]+"/g);
    
    if (rawParts) {
      // تنظيف الأجزاء النصية الصريحة ودمجها
      let reconstructedUrl = rawParts
        .map(part => part.replace(/['"]/g, ''))
        .filter(part => !part.startsWith('_0x'))
        .join('');

      // التأكد من أن النتيجة تحتوي على امتداد البث m3u8
      if (!reconstructedUrl.endsWith('.m3u8') && htmlContent.includes('hd1080b_playlist.m3u8')) {
        reconstructedUrl += 'hd1080b_playlist.m3u8';
      }

      console.log('====================================');
      console.log('تم استخراج الرابط المباشر بنجاح:');
      console.log(reconstructedUrl);
      console.log('====================================');
      return reconstructedUrl;
    }

    console.log('لم يتم العثور على رابط m3u8.');

  } catch (error) {
    console.error('حدث خطأ أثناء جلب البيانات:', error.message);
  }
}

getFaselStreamData('https://www.fasel-hd.co/video_player?player_token=OXVudUFOVnhzMXJKeVJ6am5ZYkkvSk1HU3VaS0hoZFNwUHVDRVk3QktSbmM5V3N1NDE2QTB0VVQ3MEQ0NFR1K2cvOXpscXIySEt4ZTZpMHZ6MGpLdGFmR3VpMERsczB2WHgxMVNERSthQWxKdGR2OVVxZXpkVlRPMGhRRytXYW8zYjBqQTBYUk1QcHU5SlNhQ1ExSk5TNGNQQ1ZJalZqMXBHRWw0bVl6Wmg5eldEYWhQVmlsaEhpYjFqSysraHJjUk15bkI0VU9tS1NqbnBpdG5DWmJwWnp3UWJEOU95dkRBTGRpVFhHMGRnMDlYbjlNazB5bUJQSWpFL0g2TDExVjo6lahF6AOml1x7y1nfMcd8kw%3D%3D');
