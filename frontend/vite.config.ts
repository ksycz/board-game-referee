import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.E2E_API_PORT ?? "8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
    },
  },
});
