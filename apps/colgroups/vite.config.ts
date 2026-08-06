import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Distinct from cgrid-positions (:5175) so both demos can run together
    // on the same machine (macOS or Windows).
    port: 5176,
    open: true,
  },
});
