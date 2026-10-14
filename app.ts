import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { uploadFromUrlRoute } from "./server/gofile/route";
import { createContext } from "./server/_core/context";
import { registerOAuthRoutes } from "./server/_core/oauth";
import { publicPlatformScript } from "./server/_core/publicConfig";
import { appRouter } from "./server/routers";

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
  return app;
}

const app = createApplication();
export default app;
