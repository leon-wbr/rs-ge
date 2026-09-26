import { describe, expect, it } from 'vitest';
import { redact } from '../src/soap.ts';

describe('redact', () => {
  it('masks every password spelling rs.ge uses, keeping user names', () => {
    const xml =
      '<su>a:1</su><sp>x</sp><password>x</password><Password>x</Password><inPassword>x</inPassword><user_password>x</user_password><ns:sp a="1">x</ns:sp><inUserName>a</inUserName>';
    expect(redact(xml)).toBe(
      '<su>a:1</su><sp>***</sp><password>***</password><Password>***</Password><inPassword>***</inPassword><user_password>***</user_password><ns:sp a="1">***</ns:sp><inUserName>a</inUserName>',
    );
  });

  it('leaves unrelated elements alone', () => {
    expect(redact('<spec>1</spec><speed>2</speed>')).toBe('<spec>1</spec><speed>2</speed>');
  });
});
