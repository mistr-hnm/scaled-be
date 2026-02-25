export interface User {
  id: number;
  name: string;
  email: string;
  created_at: string;
}

export interface CachedUser extends User {}

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}
