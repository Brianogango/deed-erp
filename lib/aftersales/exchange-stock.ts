/**
 * Where customer-returned units land when a client exchange is completed.
 * Always With Issues (`shop`) — exchanged devices are assumed to have a
 * problem and must not re-enter Ready for Sale / warehouse automatically.
 */
export const EXCHANGE_RETURN_LOCATION = 'shop' as const

export type ExchangeReturnLocation = typeof EXCHANGE_RETURN_LOCATION
