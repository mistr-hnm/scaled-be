
// ─── Types ────────────────────────────────────────────────
interface User {
  id: number;
  name: string;
  email: string;
  created_at: string;
}

interface CachedUser extends User {}