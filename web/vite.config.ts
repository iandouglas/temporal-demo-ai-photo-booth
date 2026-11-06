import { defineConfig } from 'vite';
export default defineConfig({
  server: { host: '127.0.0.1', proxy: {
    '/api': process.env.HOLODECK_API ?? 'http://localhost:8600',
    '/media': process.env.HOLODECK_API ?? 'http://localhost:8600',
  }},
});
