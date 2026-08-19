import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Distinct from velocitygrid-positions (:5175) so both demos can run together
    // on the same machine (macOS or Windows).
    port: 5176,
    open: true,
  },
});
