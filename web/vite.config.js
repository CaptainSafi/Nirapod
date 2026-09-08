import { sveltekit } from '@sveltejs/kit/vite';
export default {
  plugins: [sveltekit()],
  server: { proxy: { '/api': 'http://localhost:8787', '/data': 'http://localhost:8787' } },
};
