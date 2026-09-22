import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react()],
    server: {
        host: "0.0.0.0",
        port: 3000,
        allowedHosts: [".internal", "localhost"],
        proxy: {
            "/api": { target: "http://localhost:8000", changeOrigin: true },
        },
    },
    build: {
        outDir: "dist",
        sourcemap: true,
        rollupOptions: {
            output: {
                // A stable vendor chunk so React does not re-download when a page changes.
                manualChunks: (id) => (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? "react" : undefined),
            },
        },
    },
});
