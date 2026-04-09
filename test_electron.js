const { app, net } = require('electron');
app.commandLine.appendSwitch('ignore-certificate-errors', 'true');
app.whenReady().then(() => {
  const req = net.request({
    url: 'https://127.0.0.1:8420/v1/chat/render/abc',
    method: 'GET'
  });
  req.on('response', (res) => {
    console.log("Status:", res.statusCode);
    res.on('data', d => console.log("Data size:", d.length));
    res.on('end', () => app.quit());
  });
  req.on('error', e => {
    console.log("Error:", e);
    app.quit();
  });
  req.end();
});
