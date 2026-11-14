import { INestApplication } from '@nestjs/common';
import request from 'supertest';

const PASSWORD = 'Passw0rdOK';

export const setCookieHeaders = (res: request.Response): string[] => (res.headers['set-cookie'] as unknown as string[]) ?? [];
export const cookieNamed = (res: request.Response, name: string): string => setCookieHeaders(res).find((c) => c.startsWith(`${name}=`)) ?? '';
const valueOf = (cookie: string): string => cookie.split(';')[0].split('=')[1];

/**
 * The attributes of one Set-Cookie header that decide whether a browser treats it as "the same cookie":
 * Path, HttpOnly, SameSite and Secure, lower-cased and sorted. The name=value pair and the lifetime
 * (Expires / Max-Age: a set cookie lives 15 or 30 minutes, a cleared one is already expired) are left out.
 */
export function identityAttributes(setCookie: string): string[] {
  return setCookie
    .split(';')
    .slice(1)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '' && !part.startsWith('expires=') && !part.startsWith('max-age='))
    .sort();
}

export interface CookieFlow {
  login: request.Response;
  logout: request.Response;
  deactivate: request.Response;
}

/** Registers a user, then records the raw responses of login (cookies set), logout and DELETE /users/me (cookies cleared). */
export async function recordCookieFlow(app: INestApplication, email: string): Promise<CookieFlow> {
  const http = () => request(app.getHttpServer());
  await http().post('/api/auth/register').send({ name: 'Cookie Tester', email, password: PASSWORD, acceptTerms: true }).expect(201);
  const login = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  const logout = await http().post('/api/auth/logout').set('Cookie', `refresh_token=${valueOf(cookieNamed(login, 'refresh_token'))}`).expect(200);
  // Logout only revokes the refresh token, so the access cookie from the same login is still valid for the deactivation.
  const deactivate = await http()
    .delete('/api/users/me')
    .set('Cookie', `access_token=${valueOf(cookieNamed(login, 'access_token'))}`)
    .send({ confirm: true })
    .expect(200);
  return { login, logout, deactivate };
}

/** Expectations shared by both cookie tests (secure on and off). `secure` is what COOKIE_SECURE says. */
export function expectSameCookieIdentity(flow: CookieFlow, secure: boolean): void {
  const paths: Record<string, string> = { access_token: 'path=/', refresh_token: 'path=/api/auth' };
  for (const name of ['access_token', 'refresh_token']) {
    const set = cookieNamed(flow.login, name);
    const clearedByLogout = cookieNamed(flow.logout, name);
    const clearedByDeactivate = cookieNamed(flow.deactivate, name);

    expect(clearedByDeactivate).toMatch(new RegExp(`^${name}=;`)); // emptied
    expect(clearedByDeactivate).toMatch(/Expires=Thu, 01 Jan 1970/i); // and already expired

    const expected = ['httponly', 'samesite=lax', paths[name], ...(secure ? ['secure'] : [])].sort();
    expect(identityAttributes(set)).toEqual(expected);
    expect(identityAttributes(clearedByLogout)).toEqual(expected);
    expect(identityAttributes(clearedByDeactivate)).toEqual(expected);
    // Deactivation clears the cookie exactly the way logout does (and the way login set it).
    expect(identityAttributes(clearedByDeactivate)).toEqual(identityAttributes(clearedByLogout));
    expect(identityAttributes(clearedByDeactivate)).toEqual(identityAttributes(set));
  }
}
