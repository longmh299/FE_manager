import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";             // <── dòng này rất quan trọng
import { AuthProvider } from "./context/AuthContext";
import UpdateBanner from "./components/UpdateBanner"; // ✅ báo có bản mới sau khi deploy

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <UpdateBanner />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);