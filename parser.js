const axios = require('axios');

async function getFaselStreamData(targetUrl) {
  try {
    const urlObj = new URL(targetUrl);
    const domainOrigin = urlObj.origin;

    // 1. طلب نص الصفحة المباشر
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Referer': domainOrigin + '/'
      }
    });

    const html = response.data;

    // 2. فحص النص المباشر عن رابط m3u8 أولاً
    let streamUrlMatch = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/);
    let streamUrl = streamUrlMatch ? streamUrlMatch[0] : null;

    // 3. في حال كان الرابط مقسماً ومجمعاً داخل متغير videoSrc، نقوم بجمعه باستخدام Regex
    if (!streamUrl) {
      const videoSrcPartsMatch = html.match(/videoSrc\s*=\s*([^;]+);/);
      if (videoSrcPartsMatch) {
        const parts = videoSrcPartsMatch[1].match(/['"]([^'"]+)['"]/g);
        if (parts) {
          streamUrl = parts.map(p => p.replace(/['"]/g, '')).join('');
        }
      }
    }

    if (!streamUrl) {
      console.log('لم يتم العثور على رابط m3u8 في الصفحة.');
      return;
    }

    const streamDomainObj = new URL(streamUrl);

    // 4. بناء هيكلية الـ JSON المطلوبة
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
    console.error('حدث خطأ أثناء جلب الرابط:', error.message);
  }
}

// تجربة الكود على رابط فاصل إتش دي
getFaselStreamData('https://www.fasel-hd.co/video_player?player_token=OXVudUFOVnhzMXJKeVJ6am5ZYkkvSk1HU3VaS0hoZFNwUHVDRVk3QktSbmM5V3N1NDE2QTB0VVQ3MEQ0NFR1K2cvOXpscXIySEt4ZTZpMHZ6MGpLdGFmR3VpMERsczB2WHgxMVNERSthQWxKdGR2OVVxZXpkVlRPMGhRRytXYW8zYjBqQTBYUk1QcHU5SlNhQ1ExSk5TNGNQQ1ZJalZqMXBHRWw0bVl6Wmg5eldEYWhQVmlsaEhpYjFqSysraHJjUk15bkI0VU9tS1NqbnBpdG5DWmJwWnp3UWJEOU95dkRBTGRpVFhHMGRnMDlYbjlNazB5bUJQSWpFL0g2TDExVjo6lahF6AOml1x7y1nfMcd8kw%3D%3D');
