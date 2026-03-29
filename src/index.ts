#!/usr/bin/env node

import { startServer } from "./server.js";

startServer().catch((err) => {
  process.stderr.write(`Fatal: ${String(err)}\n`);
  process.exit(1);
});
