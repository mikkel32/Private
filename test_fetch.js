const https = require('https');
https.get("https://127.0.0.1:8420/v1/chat/render/abc", { rejectUnauthorized: false }, (res) => {
  console.log("Status:", res.statusCode);
  res.on('data', d => console.log(d.toString()));
});
