export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ success: boolean }>;
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
    run(): Promise<{ success: boolean }>;
    first<T = unknown>(): Promise<T | null>;
    all<T = unknown>(): Promise<{ results: T[] }>;
  };
}

export interface ImageRow {
  id: number;
  slug: string;
  owner_email: string;
  file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string;
  deleted_at: string | null;
  blocked: number;
  view_count: number;
}