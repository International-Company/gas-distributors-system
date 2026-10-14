export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "REAUTH_REQUIRED"
  | "PASSWORD_CHANGE_REQUIRED"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INVALID_STATE"
  | "IDENTITY_MISMATCH";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  REAUTH_REQUIRED: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INVALID_STATE: 409,
  IDENTITY_MISMATCH: 409,
};

/** خطأ متوقع برسالة عربية آمنة للعرض على المستخدم. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

/** «غير موجود/موجودة» حسب الاسم: المنتهي بتاء مربوطة مؤنث (الجرة، الدورة، المحطة). */
export const notFound = (what = "العنصر") => new AppError("NOT_FOUND", `${what} غير ${/ة$/.test(what) ? "موجودة" : "موجود"}`);
export const forbidden = () => new AppError("FORBIDDEN", "لا تملك صلاحية تنفيذ هذه العملية");
