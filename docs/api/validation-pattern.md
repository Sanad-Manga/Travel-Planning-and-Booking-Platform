# Validation pattern (GEN-13)

The backend enforces every rule itself. The frontend may check too, but its checks are only for convenience: anyone can call the API directly (Swagger, curl), so a request is never trusted because "the form already checked it".

Three layers, each with one job:

| Layer | Where | What belongs here |
|---|---|---|
| Shape and format of the input | DTO class (`class-validator`) | types, required fields, lengths, email format, enums, password strength |
| Business rules | the service (`*.service.ts`) | duplicates, status checks, dates and limits, ownership, anything that needs the database |
| Who may call | guards (`@Roles`, global `JwtAuthGuard`) and the service for ownership | see `docs/contracts.md` section 4 |

## 1. Write a DTO

One DTO class per request body. Example: [`RegisterDto`](../../backend/src/auth/dto/register.dto.ts).

```ts
export class RegisterDto {
  @ApiProperty({ example: 'ali@example.com' })          // Swagger documentation
  @Transform(normalizeEmail)                             // runs first: trim + lowercase
  @IsEmail({}, { message: 'email must be valid' })       // then validated
  email: string;

  @ApiProperty({ example: 'Passw0rdOK' })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @Matches(/\p{L}/u, { message: 'password must contain at least one letter' })
  @Matches(/\d/, { message: 'password must contain at least one digit' })
  password: string;

  @Equals(true, { message: 'You must accept the terms and the privacy policy' })
  acceptTerms: boolean;
}
```

Rules:
- Every property needs at least one validator decorator. The global pipe uses `whitelist` + `forbidNonWhitelisted`, so a property **without** a decorator is treated as unknown and rejected.
- Give each constraint its own `message` that names the field (`password must contain at least one digit`).
- Use `@Transform` only to normalise input (trim, lowercase), never to apply business rules.
- Take the body with `@Body() dto: RegisterDto` and nothing else. Never read `req.body` directly.
- Never put fields a client must not control (`role`, `status`, `userId`, prices) in a DTO. The service sets them. This is why `{"role":"ADMIN"}` on register is rejected with 400.

## 2. How errors look

The global pipe and filter (`backend/src/common/`) turn every failure into the same shape from `docs/contracts.md` section 3. You do not build it by hand.

```json
POST /api/auth/register  { "name": "", "email": "x", "password": "a" }

400
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "details": [
    { "field": "name", "message": "name should not be empty" },
    { "field": "email", "message": "email must be valid" },
    { "field": "password", "message": "password must be at least 8 characters" },
    { "field": "password", "message": "password must contain at least one digit" },
    { "field": "acceptTerms", "message": "You must accept the terms and the privacy policy" }
  ],
  "path": "/api/auth/register",
  "timestamp": "2026-11-03T10:00:00.000Z"
}
```

- Every broken rule is reported at once (one `details` entry per rule, so a field can appear twice). Nested fields use dotted names (`passengers.0.name`).
- Status codes: 400 invalid input, 401 not logged in, 403 wrong role, 404 not found (also for someone else's private resource), 409 conflict.

## 3. Business rules in the service

When a rule needs the database or the user, check it in the service and throw a Nest exception. To keep the field-level shape, pass `details`:

```ts
// AuthService.register
if (await this.usersService.findByEmail(dto.email)) {
  throw new ConflictException({
    message: 'Email already registered',
    details: [{ field: 'email', message: 'email already exists' }],
  });
}
```

Notes:
- A DTO cannot see the database, so "email must be unique" can only live in the service. The unique index is the last line of defence: if two requests race, Mongo error 11000 is also turned into a 409 by the global filter.
- Ownership checks (`airlineId`, `userId`) also live in the service, not the controller.

## 4. Passwords

- Only salted bcrypt hashes are stored (`bcryptjs`, cost 10, see `BCRYPT_SALT_ROUNDS`). bcrypt creates a random salt on every call and stores it inside the hash string, so two users with the same password get different hashes.
- The schema field is `passwordHash` with `select: false`: queries do not load it unless they explicitly ask (`findByEmail(email, true)`, login only).
- Never return the hash or any token. Return a response DTO (`UserResponseDto`), not the Mongoose document.
- "Letter" means any Unicode letter (`/\p{L}/u`), so Arabic and other scripts count, not only A-Z.
- Passwords longer than 72 **bytes** (UTF-8) are rejected, using the `@MaxByteLength` validator. bcrypt ignores everything after byte 72, and non-English characters take 2 or more bytes each (an Arabic letter is 2), so counting characters with `@MaxLength` would let an over-long password through and silently truncate it.

## 5. Where this is tested

- Field-level errors, several fields at once, unknown field rejected: `backend/test/register.e2e-spec.ts` and `backend/test/errors.e2e-spec.ts`.
- Wrong types, unknown fields on other endpoints, identical passwords giving different hashes: `backend/test/validation.e2e-spec.ts`.
- Hash format and the plaintext never being stored: `backend/src/auth/auth.service.spec.ts`.

A checklist for your own endpoint: DTO with decorators on every field, Swagger `@ApiProperty` on every field, an `@ApiBadRequestResponse({ type: ErrorResponseDto })` on the route, business rules in the service, and one e2e test for a validation failure.
