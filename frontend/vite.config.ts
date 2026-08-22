import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

const appBase = process.env.VITE_APP_BASE_PATH || "/";

export default defineConfig({
  base: appBase,
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss(), tsConfigPaths()],
  server: {
    host: "0.0.0.0",
    port: 8090,
    allowedHosts: ["bankstatement-converter.onrender.com", "staff.rmhadvisors.in"],
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: ["bankstatement-converter.onrender.com", "staff.rmhadvisors.in"],
  },
  build: {
    outDir: "dist",
  },
});
