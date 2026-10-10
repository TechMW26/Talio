// Retired application data-plane entrypoint. Offline migration tools construct
// their explicit source client separately; runtime never connects to Firestore.
// Firebase Admin notification messaging is intentionally unaffected.
export function getTalioFirestore() {
  throw new Error('Firestore application data access is retired; use the verified MongoDB data plane')
}
