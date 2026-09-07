/** Service failure is neither an exhausted allowance nor a missing identity. */
export interface AdmissionUnavailable { error: 'admission_unavailable' }
export function admissionUnavailable(): AdmissionUnavailable {
  return { error: 'admission_unavailable' }
}
export function isAdmissionUnavailable(value: unknown): value is AdmissionUnavailable {
  return value !== null && typeof value === 'object' && 'error' in value && value.error === 'admission_unavailable'
}
export function admissionUnavailableResponse(): Response {
  return Response.json({ error: 'admission_unavailable', message: 'Accès temporairement indisponible. Réessayez plus tard.' }, {
    status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '30' },
  })
}
