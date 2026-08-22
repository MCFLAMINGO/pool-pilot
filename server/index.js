'use strict';

const { createApp } = require('./app');

const port = Number(process.env.PORT || process.env.API_PORT || 8787);
const app = createApp();

app.listen(port, '0.0.0.0', () => {
  console.log(`Pool Pilot partner API on :${port} store=${process.env.DATABASE_URL ? 'postgres' : 'file'}`);
});
