const https = require('https');
const req = https.request("https://127.0.0.1:8420/v1/chat/render/abc", {
  method: 'GET',
  rejectUnauthorized: false,
  checkServerIdentity: () => null
}, (res) => {
  console.log("Status:", res.statusCode);
  res.on('data', d => console.log("Data size:", d.length));
});
req.on('error', e => console.log("Error:", e));
req.end();
