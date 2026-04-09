const https = require('https');
const req = https.request("https://127.0.0.1:8420/health", { rejectUnauthorized: false }, (res) => {
  console.log("Status:", res.statusCode);
  res.on('data', d => console.log(d.toString()));
});
req.on('error', e => console.error(e));
req.end();
