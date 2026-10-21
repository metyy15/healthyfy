import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// The dev server rejects requests whose Host header it does not
// recognise, which is what a tunnel or a LAN address arrives as.
// Set ALLOWED_HOSTS=true (or a comma separated list of hostnames)
// only when the app is being shared deliberately.
const allowedHostsEnv = process.env.ALLOWED_HOSTS;
const allowedHosts: true | string[] | undefined = allowedHostsEnv
  ? allowedHostsEnv === 'true'
    ? true
    : allowedHostsEnv.split(',').map((h) => h.trim()).filter(Boolean)
  : undefined;

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      allowedHosts,
    },
  };
});
