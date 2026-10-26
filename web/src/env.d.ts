// Vite replaces process.env.NODE_ENV, which some registry components read
declare const process: { env: { NODE_ENV: string } }
