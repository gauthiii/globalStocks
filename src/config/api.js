// Base URL for the AI analysis backend.
// Priority: explicit VITE_API_URL override > localhost when running locally > deployed Render backend.
const isLocalhost =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const API_URL =
  import.meta.env.VITE_API_URL ||
  (isLocalhost ? 'http://localhost:8000' : 'https://globalstocks.onrender.com');
