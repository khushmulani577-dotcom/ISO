# ISO backend

The built-in Node HTTP server serves the static app, issues an HttpOnly session cookie, validates the ten prototype sign-ins, and proxies chat requests to Gemini or an OpenAI-compatible Chat Completions endpoint. The AI key stays on the server.

Set `AI_PROVIDER=gemini` and `AI_API_KEY`, and optionally `AI_MODEL` and `PORT`, in the backend process environment or the local ignored `.env` file. Gemini defaults to `gemini-3.8-flash`. To use another OpenAI-compatible provider, set `AI_PROVIDER=openai-compatible`, `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL`. No AI answers are generated locally; a missing or unavailable provider returns an error.

The fictional prototype accounts are held only in this server module and are not sent to the browser. This in-memory prototype is not production authentication: use a persistent identity system, salted password hashes, secure session storage, HTTPS, CSRF protections, request limits, and monitored rate limiting before deployment. Sessions are held in memory and end on server restart.
