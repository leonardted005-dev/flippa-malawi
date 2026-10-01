export type CurrencyCode = string;

/** Thrown when a monetary operation would violate integrity (e.g. mixing currencies). */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * Immutable money value object.
 *
 * The amount is an integer number of MINOR units held as `bigint` (e.g. kobo,
 * ngwee, cents). Money is NEVER a floating-point value and NEVER stores a
 * locale-formatted string. Currency is an ISO-4217 code.
 *
 * This is a Phase-1 foundational primitive only: it contains no marketplace
 * business rules (no fees, no pricing, no tax).
 */
export class Money {
  private constructor(
    public readonly amountMinor: bigint,
    public readonly currency: CurrencyCode,
  ) {}

  static of(amountMinor: bigint | number, currency: CurrencyCode): Money {
    const amount = typeof amountMinor === 'bigint' ? amountMinor : BigInt(amountMinor);
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new MoneyError(`Invalid ISO-4217 currency code: "${currency}"`);
    }
    return new Money(amount, currency);
  }

  static zero(currency: CurrencyCode): Money {
    return Money.of(0n, currency);
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new MoneyError(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor - other.amountMinor, this.currency);
  }

  isZero(): boolean {
    return this.amountMinor === 0n;
  }

  isNegative(): boolean {
    return this.amountMinor < 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor;
  }

  /**
   * DISPLAY ONLY. Never use the output for arithmetic or persistence.
   */
  toDisplayString(locale = 'en-ZM', minorUnits = 2): string {
    const divisor = 10n ** BigInt(minorUnits);
    const major = Number(this.amountMinor) / Number(divisor);
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency,
    }).format(major);
  }
}
