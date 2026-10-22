# BR Insight Console

## Run with VS Code Live Server

1. In PowerShell, open this folder and run `npm.cmd install` once, then
   `npm.cmd start`. The API will be available at `http://localhost:3000`.
2. Keep that terminal running. In VS Code, open `frontend/index.html` with Live
   Server. The frontend automatically sends local API requests to port 3000.
3. To enable live AI responses, create a `.env` file in this folder and set
   `GROQ_API_KEY=your_key`. Without a key, the executive diagnosis uses the
   built-in localized fallback; chat requires the configured key.

Alternatively, open `http://localhost:3000` after starting the server to serve
the frontend and API from the same origin.
