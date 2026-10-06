// The old default-database bootstrap is not valid in a multitenant application.
// A company-issued one-time setup code is required, including on this legacy URL.
export { POST } from '../tenant/route'
