import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins:[react(),tailwindcss()],
  server:{proxy:{'/api':{target:'http://localhost:8000',ws:true}}},
  build:{
    rollupOptions:{
      output:{
        // Preserve lazy imports and split prebuilt editor modules without pulling in their dependencies.
        onlyExplicitManualChunks:true,
        manualChunks(id){
          if(id.includes('/@excalidraw/excalidraw/dist/prod/')&&id.endsWith('.js')){
            return `excalidraw-${id.split('/').pop()!.replace(/\.js$/,'')}`;
          }
          if(id.includes('/mermaid/dist/chunks/mermaid.core/')&&id.endsWith('.mjs')){
            return `mermaid-${id.split('/').pop()!.replace(/\.mjs$/,'')}`;
          }
        },
      },
    },
  },
});
