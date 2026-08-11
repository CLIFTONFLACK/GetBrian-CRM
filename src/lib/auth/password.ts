import bcrypt from "bcryptjs";

// bcryptjs over native `bcrypt`: these functions only ever run in Server
// Actions / Route Handlers (Node runtime, never edge — see src/lib/auth's
// module doc), so native bcrypt's node-gyp requirement would technically
// work here. bcryptjs is chosen anyway because it's pure JS with zero native
// build step, which removes a cross-platform risk (Windows dev machine ->
// Linux Vercel serverless) for an operation that's called rarely
// (sign-up/sign-in, never a hot path) — the performance cost is negligible
// for that call volume. It also verifies the same $2a$/$2b$ bcrypt hash
// format that supabase/seeds' `crypt(pw, gen_salt('bf'))` already produces,
// so seeded demo users keep working unchanged.
const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// A fixed, valid $2a$12 bcrypt hash (computed once at module load — the
// plaintext is irrelevant) used only to burn an equivalent round of bcrypt work
// on the user-not-found path. Without it, a missing email returns instantly
// while a wrong password runs a full ~cost-12 compare, and that timing gap lets
// an attacker enumerate which emails have accounts.
const TIMING_EQUALIZER_HASH = bcrypt.hashSync("not-a-real-secret", SALT_ROUNDS);

/** Run a throwaway bcrypt compare (always returns false) to match the timing of
 *  a real verifyPassword, for the branch where no user row was found. */
export async function verifyPasswordDummy(password: string): Promise<false> {
  await bcrypt.compare(password, TIMING_EQUALIZER_HASH);
  return false;
}
