/**
 * （責務）drizzle-kit 用の設定。マイグレーション先とスキーマの参照元。
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './backend/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite'
});