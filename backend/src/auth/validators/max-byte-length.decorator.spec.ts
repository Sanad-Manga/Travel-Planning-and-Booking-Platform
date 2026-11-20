import { validateSync } from 'class-validator';
import { MaxByteLength } from './max-byte-length.decorator';

class Sample {
  @MaxByteLength(4)
  value: unknown;
}

const errorsFor = (value: unknown) => {
  const sample = new Sample();
  sample.value = value;
  return validateSync(sample);
};

describe('MaxByteLength', () => {
  it('accepts a string at or under the limit', () => {
    expect(errorsFor('abcd')).toHaveLength(0);
    expect(errorsFor('')).toHaveLength(0);
  });

  it('rejects a string over the limit', () => {
    expect(errorsFor('abcde')).toHaveLength(1);
  });

  it('counts bytes, not characters (2-byte Arabic letters)', () => {
    expect(errorsFor('عب')).toHaveLength(0); // 2 chars, 4 bytes
    expect(errorsFor('عبت')).toHaveLength(1); // 3 chars, 6 bytes
  });

  it('rejects non-string values', () => {
    for (const value of [undefined, null, 1234, ['abcd']]) {
      expect(errorsFor(value)).toHaveLength(1);
    }
  });

  it('uses a custom message when given', () => {
    class Custom {
      @MaxByteLength(1, { message: 'too long' })
      value = 'ab';
    }
    expect(validateSync(new Custom())[0].constraints).toEqual({ maxByteLength: 'too long' });
  });
});
