const axios = require('axios');
const unpacker = require('unpacker');

async function getDirectStream(embedUrl) {
  try {
    // 1. طلب كود الصفحة المباشر
    const response = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://vidoba.org/'
      }
    });

    const htmlContent = response.data;

    // 2. البحث عن كود eval المشفر باستخدام Regex
    const evalMatch = htmlContent.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\)\)/);

    if (!evalMatch) {
      console.log('لم يتم العثور على كود مشفر داخل الصفحة');
      return;
    }

    // 3. فك التشفير (Unpack) بلحظة واحدة بالذاكرة
    const unpackedCode = unpacker.unpack(evalMatch[0]);

    // 4. استخراج رابط m3u8 من الكود بعد فك ضغطه
    const m3u8Match = unpackedCode.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/);

    if (m3u8Match && m3u8Match[0]) {
      const streamUrl = m3u8Match[0];
      
      console.log('====================================');
      console.log(' تم استخراج الرابط المباشر بنجاح:');
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
      console.log('لم يتم العثور على رابط m3u8 داخل الكود المفكوك.');
    }

  } catch (error) {
    console.error('حدث خطأ أثناء جلب البيانات:', error.message);
  }
}

// تجربة الكود على الصفحة الخاصة بك
getDirectStream('https://vidoba.org/embed-qv4dnkegkys7.html');
