# Running the Servers: Frontend & Backend Architecture

This document outlines the dual-server architecture of the Renko Strategy Explorer, how to start and stop the servers, and how to troubleshoot connection errors.

---

## 1. The Dual-Server Architecture

To facilitate both interactive charting and persistent data logging, the application uses a decoupled frontend and backend:

```
                  +-----------------------------------+
                  |        Browser (Client)           |
                  |     http://localhost:5173         |
                  +-----------------+-----------------+
                                    |
            Fetches UI assets       | Makes API requests
            & hot-reloads           | (GET/POST data)
                                    |
+-------------------+               |               +-------------------+
|  Vite Dev Server  |<--------------+-------------->| Node Express API  |
|  Port 5173 (UI)   |                               |  Port 5000 (Data) |
+-------------------+                               +---------+---------+
                                                              |
                                                     Reads & writes files
                                                              v
                                                    +-------------------+
                                                    |  /data Directory  |
                                                    |  (Charts & JSON)  |
                                                    +-------------------+
```

### Server A: Frontend Development Server (Vite)
* **Command**: `npm run dev` (run from the `frontend/` directory)
* **Port**: `http://localhost:5173`
* **Purpose**: Compiles React JSX and CSS, hosts the user interface, and handles Hot Module Replacement (HMR). When you edit UI code, Vite immediately pushes updates directly to the browser without requiring a full reload.

### Server B: Backend API Server (Node/Express)
* **Command**: `node server.js` (run from the `frontend/` directory)
* **Port**: `http://localhost:5000`
* **Purpose**: Accesses the local file system. It reads datasets and logs annotations to `/data/annotations.json`. The React app calls this backend via `fetch` requests.

---

## 2. Startup Guide

To start both servers, open two terminals and run the following commands:

### Terminal 1: Start the Backend API (Port 5000)
```bash
cd frontend
node server.js
```
*Expected Output:*
```
Server is running on http://localhost:5000
```

### Terminal 2: Start the Frontend UI (Port 5173)
```bash
cd frontend
npm run dev
```
*Expected Output:*
```
  VITE v5.x.x  ready in X ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Once both are running, open your browser and navigate to **`http://localhost:5173`**.

---

## 3. Troubleshooting Connection Refused (`ERR_CONNECTION_REFUSED`)

If you open the browser and see a loading spinner or notice that the left sidebar datasets list is missing, press `F12` to inspect the browser console. If you see the following errors:
```
Failed to load resource: net::ERR_CONNECTION_REFUSED (http://localhost:5000/api/charts)
Failed to fetch charts: TypeError: Failed to fetch
```
This means **Server B (the Node/Express backend)** is not running. 
* **Fix**: Go to your backend terminal and run `node server.js`. Refresh your browser, and the connection will re-establish.

---

## 4. Future Consolidation Plans

Running two terminals can be cumbersome. We have planned two paths to simplify this workflow:

### Path A: Single-Command Dev Mode (using `concurrently`)
We can configure the project to launch both servers with a single command by running:
```bash
npm install -D concurrently
```
And modifying the `package.json` scripts:
```json
"scripts": {
  "server": "node server.js",
  "client": "vite",
  "dev": "concurrently \"npm run server\" \"npm run client\""
}
```
In this setup, running `npm run dev` automatically spins up both Vite and Express in parallel within the same terminal window. Stopping the command shuts down both servers.

### Path B: Single-Server Production Mode
To run completely on a single port (5000) with zero development overhead:
1. Compile the React app into static files: `npm run build`.
2. Configure `server.js` to serve static assets from the `/dist` folder:
   ```javascript
   app.use(express.static(path.join(__dirname, 'dist')));
   ```
3. Run only `node server.js`. Your web application will be accessible at `http://localhost:5000` directly.
