import express from "express";
import path from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { uploadFromUrlRoute } from "./server/gofile/route.js";
import { createContext } from "./server/_core/context.js";
import { registerOAuthRoutes } from "./server/_core/oauth.js";
import { publicPlatformScript } from "./server/_core/publicConfig.js";
import { appRouter } from "./server/routers.js";

export function createApplication() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use(express.urlencoded({ limit: "64kb", extended: true }));
  app.get("/api/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_request, response) => {
    response.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  app.post("/api/upload-from-url", uploadFromUrlRoute);
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );
  const publicDirectory = path.resolve(process.cwd(), "public");
  app.use(express.static(publicDirectory, { index: false }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(publicDirectory, "index.html"), (error) => {
      if (error) next(error);
    });
  });
  return app;
}

const app = createApplication();
export default app;
