import type { Plugin } from 'vite';
import { handleMockApiRequest } from './mockMiddleware.ts';

export function viteMockApiPlugin(): Plugin {
  return {
    name: 'vite-plugin-mock-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleMockApiRequest(req, res, next);
      });
    },
  };
}

