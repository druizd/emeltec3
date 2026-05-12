/**
 * Helpers de paginación: offset y cursor.
 */
import { z } from 'zod';

export const offsetPaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(50),
});

export type OffsetPagination = z.infer<typeof offsetPaginationSchema>;

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(2500).default(500),
});

export type CursorPagination = z.infer<typeof cursorPaginationSchema>;

export function encodeCursor(value: { time: string; id?: string | number }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T = { time: string; id?: string | number }>(cursor: string): T | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}
