import { defineConfig } from 'vitest/config';

/**
 * Configuración base de Vitest para el proyecto Angular.
 * El runner real usa @angular/build:unit-test (angular.json) que sobrescribe
 * las opciones críticas (environment, setupFiles, include) al invocar ng test.
 * Este archivo sirve como fallback para editores y validación de tipos.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@emeltec/shared': '../shared/src/index.ts',
    },
  },
});
