#!/usr/bin/env node
import { main } from './cli.js';

// A long-running monitor must log unexpected errors and keep going, not exit silently.
process.on('unhandledRejection', (e: unknown) => {
  console.error(`${new Date().toISOString()} ERROR   Unexpected: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
});

main().then(
  (code) => {
    if (code !== undefined) process.exit(code);
  },
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
