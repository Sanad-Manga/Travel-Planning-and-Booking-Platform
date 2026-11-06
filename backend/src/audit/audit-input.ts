import { BadRequestException } from '@nestjs/common';

/** Shared contract: caller authorizes the action and supplies its authenticated actor ID. */
export interface AuditLogInput {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
}

const sensitiveKey =
  /password|passwd|passphrase|credential|token|jwt|authorization|cookie|secret|apikey|privatekey|card(?:number|details|holder|exp|last|security)|creditcard|debitcard|primaryaccountnumber|securitycode|cvv|cvc|requestbody|rawbody/;
const sensitiveText =
  /\b(?:Bearer|Basic)\s+\S+|\beyJ[\w-]*\.[\w-]+\.[\w-]+\b|\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}|\b(?:sk|rk)_(?:live|test)_[\w]+|\bwhsec_[\w]+|mongodb(?:\+srv)?:\/\/|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:password|passwd|pwd|secret|token)\s*[:=]\s*\S+/i;

function containsCardNumber(text: string): boolean {
  const candidates = text.match(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, '');
    let total = 0;
    for (
      let i = digits.length - 1, doubled = false;
      i >= 0;
      i--, doubled = !doubled
    ) {
      let digit = Number(digits[i]);
      if (doubled) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
      total += digit;
    }
    return !/^0+$/.test(digits) && total % 10 === 0;
  });
}

/** Free-form JSON context, defensively copied; never accept credential/request snapshots. */
export function safeAuditDetails(
  details: unknown,
): Record<string, unknown> | undefined {
  if (details === undefined) return undefined;
  try {
    const active = new Set<object>();
    let nodes = 0;
    const copy = (value: unknown, depth: number): unknown => {
      if (++nodes > 1000 || depth > 10) throw new Error();
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        if (
          Buffer.byteLength(value, 'utf8') > 16384 ||
          sensitiveText.test(value) ||
          containsCardNumber(value)
        )
          throw new Error();
        return value;
      }
      if (!value || typeof value !== 'object' || active.has(value))
        throw new Error();
      active.add(value);
      let result: unknown;
      if (Array.isArray(value)) {
        result = value.map((item) => copy(item, depth + 1));
      } else {
        if (
          (Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null) ||
          Object.getOwnPropertySymbols(value).length
        )
          throw new Error();
        const descriptors = Object.getOwnPropertyDescriptors(value);
        result = Object.fromEntries(
          Object.entries(descriptors).map(([key, descriptor]) => {
            const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
            if (
              !('value' in descriptor) ||
              sensitiveKey.test(normalized) ||
              ['pwd', 'pan', 'card', 'headers', 'body'].includes(normalized) ||
              ['__proto__', 'constructor', 'prototype'].includes(
                key.toLowerCase(),
              ) ||
              key.startsWith('$') ||
              key.includes('.')
            )
              throw new Error();
            return [key, copy(descriptor.value, depth + 1)];
          }),
        );
      }
      active.delete(value);
      return result;
    };
    if (!details || typeof details !== 'object' || Array.isArray(details))
      throw new Error();
    const result = copy(details, 0) as Record<string, unknown>;
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 16384)
      throw new Error();
    return result;
  } catch {
    // Never include keys, values, validator targets or caught exceptions in the error.
    throw new BadRequestException(
      'Audit details contain sensitive, oversized or unsupported data',
    );
  }
}

export function prepareAuditInput(input: AuditLogInput): AuditLogInput {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Invalid audit input');
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(input),
  )) {
    if (!('value' in descriptor))
      throw new BadRequestException('Invalid audit input');
  }
  for (const key of ['actorId', 'action', 'targetType', 'targetId'] as const) {
    const value = input[key];
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > 1024 ||
      sensitiveText.test(value)
    ) {
      throw new BadRequestException(`Invalid audit ${key}`);
    }
  }
  const details = safeAuditDetails(input.details);
  // Explicit mapping ignores caller-supplied _id/timestamps and any unrelated fields.
  return {
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    ...(details !== undefined ? { details } : {}),
  };
}
