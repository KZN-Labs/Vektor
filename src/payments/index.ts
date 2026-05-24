/**
 * Payment Requests — generate shareable payment links.
 * When recipient opens the link, Vektor pre-fills the payment intent.
 */

import { createPayment, getPayment, markPaymentPaid, type PaymentRequest } from '../db/store.js'

const BASE_URL = process.env.VEKTOR_URL ?? 'http://localhost:5173'

export interface PaymentLink {
  payment:  PaymentRequest
  link:     string
  qrData:   string  // same as link, for QR generation
}

export function createPaymentRequest(
  creatorWallet: string,
  token:         string,
  amount:        number,
  description?:  string,
): PaymentLink {
  const payment = createPayment({ creatorWallet, token, amount, description })
  const link    = `${BASE_URL}?pay=${payment.id}`
  return { payment, link, qrData: link }
}

export function getPaymentStatus(id: string): PaymentRequest | null {
  return getPayment(id) ?? null
}

export function fulfillPayment(id: string, paidBy: string): void {
  markPaymentPaid(id, paidBy)
}

/** Parse a payment ID from the URL query string (?pay=<id>) */
export function parsePaymentFromUrl(url: string): string | null {
  try {
    const u  = new URL(url)
    return u.searchParams.get('pay')
  } catch {
    const match = url.match(/[?&]pay=([a-f0-9-]{36})/)
    return match?.[1] ?? null
  }
}
