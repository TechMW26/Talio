import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { validateSetupCode, clearTenantCache } from '@/lib/tenantContext'
import { provisionFirestoreAccount } from '@/lib/platform/firestoreProvisioning.server'

export async function GET(request) {
  try {
    const code = new URL(request.url).searchParams.get('code')
    if (!code) return NextResponse.json({ success: false, message: 'Setup code is required' }, { status: 400 })
    const result = await validateSetupCode(code)
    if (!result?.valid) return NextResponse.json({ success: false, message: result?.reason || 'Invalid setup code' }, { status: 400 })
    return NextResponse.json({ success: true, company: { name: result.company.name, slug: result.company.slug } })
  } catch (error) {
    return NextResponse.json({ success: false, message: 'Failed to validate setup code' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const input = await request.json()
    if (!input.setupCode || typeof input.setupCode !== 'string' || input.setupCode.length > 256) return NextResponse.json({ success: false, message: 'A valid company setup code is required' }, { status: 400 })
    if (!process.env.JWT_SECRET) throw new Error('JWT signing is not configured')
    const tokenId = randomUUID()
    const { user, employee, company } = await provisionFirestoreAccount(input, { setupCode: input.setupCode, tokenId })
    const token = await new SignJWT({ userId: user._id, email: user.email, role: user.role, companySlug: company.slug, companyName: company.name, databaseName: company.databaseName, authVersion: user.authVersion, tokenId })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(new TextEncoder().encode(process.env.JWT_SECRET))
    clearTenantCache(user.email)
    return NextResponse.json({
      success: true, message: 'Admin account created successfully', token,
      user: { id: user._id, email: user.email, role: user.role, firstName: employee.firstName, lastName: employee.lastName, fullName: `${employee.firstName} ${employee.lastName}`, employeeId: { _id: employee._id, firstName: employee.firstName, lastName: employee.lastName, email: user.email, employeeCode: employee.employeeCode } },
      company: { name: company.name, slug: company.slug },
    })
  } catch (error) {
    console.error('[TenantSetup] Failed:', error.code || error.name)
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to create admin account' }, { status: error.status || 500 })
  }
}
