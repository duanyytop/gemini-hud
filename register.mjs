/**
 * ESM Loader entry point.
 * Usage: node --import /path/to/register.mjs $(which gemini)
 *
 * Registers our custom loader that intercepts @google/gemini-cli's Footer.js
 * and replaces it with the HUD-enhanced version.
 */
import { register } from 'node:module';

register(new URL('./loader.mjs', import.meta.url));
