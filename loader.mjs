/**
 * ESM Loader Hook — resolve phase.
 *
 * Intercepts the import of Footer.js from @google/gemini-cli and redirects
 * it to our enhanced hud-footer.mjs component.
 *
 * Also ensures that imports originating from hud-footer.mjs that reference
 * @google/gemini-cli or @google/gemini-cli-core are resolved against the
 * actual gemini-cli installation (not our project directory).
 *
 * If Gemini CLI restructures its paths, only the FOOTER_PATTERN below needs
 * to be updated.
 */

const FOOTER_PATTERN = /[\\/]@google[\\/]gemini-cli[\\/].*[\\/]ui[\\/]components[\\/]Footer\.js$/;

const HUD_FOOTER_URL = new URL('./hud-footer.mjs', import.meta.url).href;

// We'll capture the parent URL that originally imported Footer.js so we can
// use it as the resolution base for our hud-footer's gemini imports.
let geminiParentURL = null;

/**
 * resolve hook — called for every import specifier.
 */
export async function resolve(specifier, context, nextResolve) {
  // First, try to resolve normally
  let resolved;
  try {
    resolved = await nextResolve(specifier, context);
  } catch (err) {
    // If resolution fails and the import comes from our hud-footer, retry
    // with the captured gemini parent URL as the base
    if (
      geminiParentURL &&
      context.parentURL === HUD_FOOTER_URL
    ) {
      return nextResolve(specifier, {
        ...context,
        parentURL: geminiParentURL,
      });
    }
    throw err;
  }

  // Intercept Footer.js → hud-footer.mjs
  if (FOOTER_PATTERN.test(resolved.url)) {
    // Remember who imported Footer so we can resolve gemini packages later
    geminiParentURL = context.parentURL;
    return {
      ...resolved,
      url: HUD_FOOTER_URL,
    };
  }

  return resolved;
}
