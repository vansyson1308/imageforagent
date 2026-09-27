/**
 * Loads secrets for CLI scripts: `.env.local` first (git-ignored, holds the
 * keys), then `.env`. Values are never printed. Import this module FIRST.
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });
