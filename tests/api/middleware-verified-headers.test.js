jest.mock('next/server', () => ({
  NextResponse: {
    next: jest.fn((options = {}) => ({ type: 'next', options })),
    json: jest.fn((body, options = {}) => ({ type: 'json', body, options })),
    redirect: jest.fn((url, options = {}) => ({ type: 'redirect', url, options })),
  },
}))

jest.mock('jose', () => ({
  jwtVerify: jest.fn(),
}))

import { jwtVerify } from 'jose'
import { NextResponse } from 'next/server'
import { middleware } from '@/middleware'

const mockNext = NextResponse.next
const mockJson = NextResponse.json
const mockRedirect = NextResponse.redirect
const mockJwtVerify = jwtVerify

describe('middleware verified identity headers', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'middleware-test-secret-with-at-least-32-characters'
  })

  beforeEach(() => {
    mockNext.mockClear()
    mockJson.mockClear()
    mockRedirect.mockClear()
    mockJwtVerify.mockReset()
  })

  test('overwrites spoofed tenant headers with signed JWT claims', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        userId: 'signed-user',
        databaseName: 'talio_company_signed',
        email: 'signed@example.com',
        role: 'employee',
      },
    })

    const request = {
      headers: new Headers({
        authorization: 'Bearer signed-token',
        'x-verified-user-id': 'spoofed-user',
        'x-verified-database': 'talio_company_spoofed',
        'x-verified-role': 'admin',
      }),
      cookies: { get: () => undefined },
      nextUrl: {
        pathname: '/api/employees',
        search: '',
        searchParams: new URLSearchParams(),
      },
      url: 'https://app.talio.in/api/employees',
    }

    const response = await middleware(request)
    const forwardedHeaders = response.options.request.headers

    expect(forwardedHeaders.get('x-verified-user-id')).toBe('signed-user')
    expect(forwardedHeaders.get('x-verified-database')).toBe('talio_company_signed')
    expect(forwardedHeaders.get('x-verified-role')).toBe('employee')
    expect(forwardedHeaders.get('x-verified-email')).toBe('signed@example.com')
  })
})
