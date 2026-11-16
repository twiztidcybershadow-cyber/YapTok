export type Theme = "light" | "dark";

export const THEME_KEY = "yaptok-theme";

/**
 * Runs in <head> before the first paint so the theme never flashes.
 * YapTok is dark unless the person picked light. Kept tiny and dependency
 * free on purpose.
 */
export const themeScript = `try{if(localStorage.getItem("${THEME_KEY}")!=="light")document.documentElement.classList.add("dark")}catch(e){document.documentElement.classList.add("dark")}`;

export function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or storage blocked: the theme still applies for this page.
  }
}
