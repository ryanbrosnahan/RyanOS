export type UUID = string;
export type ISODateString = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export function nowIso(): ISODateString {
  return new Date().toISOString();
}

export function addDaysIso(value: ISODateString | Date, days: number): ISODateString {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function isIsoDateString(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && value.length >= 10;
}

export function createId(prefix = ""): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

