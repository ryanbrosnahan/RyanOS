import { buildApp } from "./app.js";

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.API_PORT ?? "4000", 10);

const app = buildApp();

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
