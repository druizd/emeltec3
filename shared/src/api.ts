export interface ApiResponse<T> {
  ok: boolean;
  data: T;
  count?: number;
  message?: string;
  error?: string;
}

export interface ApiError {
  ok: false;
  error: string;
  message?: string;
}
