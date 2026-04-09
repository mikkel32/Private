const { app, session } = require('electron');
const fs = require('fs');
app.whenReady().then(() => {
  const volSession = session.fromPartition('in-memory', { cache: false });
  const props = Object.getOwnPropertyNames(volSession.__proto__);
  fs.writeFileSync("methods.txt", props.join('\n'));
  app.quit();
});
