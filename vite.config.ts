import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Ensure public folder assets are copied correctly
    copyPublicDir: true,
    rollupOptions: {
      output: {
        // Ensure images maintain their paths
        assetFileNames: (assetInfo) => {
          // Keep images in their original structure
          if (assetInfo.name && /\.(png|jpg|jpeg|svg|gif)$/.test(assetInfo.name)) {
            if (assetInfo.name.includes('images/')) {
              return 'images/[name][extname]'
            }
            return '[name][extname]'
          }
          return 'assets/[name]-[hash][extname]'
        }
      }
    }
  },
  // Ensure public folder is properly served
  publicDir: 'public'
})
