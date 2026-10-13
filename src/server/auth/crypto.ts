import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

// Argon2id (الافتراضي في @node-rs/argon2) بمعاملات توصيات OWASP.
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashSecret = (plain: string) => hash(plain, ARGON_OPTS);

export async function verifySecret(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

// تجزئة ثابتة تُستخدم عند عدم وجود المستخدم حتى لا يكشف زمن الاستجابة وجود الحساب.
let dummyHash: Promise<string> | null = null;
export async function verifyDummy(plain: string) {
  dummyHash ??= hashSecret("dummy-password-for-timing");
  await verifySecret(await dummyHash, plain);
}

export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
