const configuredApiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");
let hasConfiguredApiUrl = false;
try {
  const parsedApiUrl = new URL(configuredApiUrl);
  hasConfiguredApiUrl =
    ["http:", "https:"].includes(parsedApiUrl.protocol) &&
    !parsedApiUrl.hostname.startsWith("your-") &&
    !parsedApiUrl.hostname.includes("placeholder");
} catch {
  hasConfiguredApiUrl = false;
}

export const apiBaseUrl = hasConfiguredApiUrl
  ? configuredApiUrl
  : import.meta.env.DEV
    ? "http://localhost:4000"
    : "";

export function apiUrl(path) {
  if (!apiBaseUrl) {
    throw new Error(
      "The backend API is not configured. Set VITE_API_URL to your deployed API URL.",
    );
  }
  return `${apiBaseUrl}${path}`;
}
