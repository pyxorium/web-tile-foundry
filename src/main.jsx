import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import { ensureLoopbackAddress } from "./auth/auth.js";

// Sign-in on this computer needs the page at 127.0.0.1 rather than "localhost".
if (ensureLoopbackAddress()) createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
