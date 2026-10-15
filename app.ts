import express from "express";
import path from "node:path";
import { uploadFromUrlRoute } from "./server/gofile/route.js";

export function createApplication() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use(express.urlencoded({ limit: "64kb", extended: true }));
  app.get("/api/health", (_request, response) => response.json({ status: "ok" }));
  app.post("/api/upload-from-url", async (request, response, next) => {
    try {
      await uploadFromUrlRoute(request, response);
    } catch (error) {
      next(error);
    }
  });

  const publicDirectory = path.resolve(process.cwd(), "public");
  app.use(express.static(publicDirectory, { index: false }));
  app.get("*", (request, response, next) => {
    if (request.path.startsWith("/api/")) return next();
    response.sendFile(path.join(publicDirectory, "index.html"), (error) => {
      if (error) next(error);
    });
  });
  return app;
}

const app = createApplication();
export default app;
