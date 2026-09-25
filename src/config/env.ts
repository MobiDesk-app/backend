import "dotenv/config";

export interface Config {
  port: number;
  authToken: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config: Config = {
  port: Number(process.env.PORT ?? 8080),
  authToken: required("AUTH_TOKEN"),
};
