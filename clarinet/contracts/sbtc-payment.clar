;; contracts/sbtc-payment.clar

;; Minimal SIP-010-like fungible token trait needed for transfers
(define-trait ft-trait
  (
    ;; transfer? amount sender recipient memo(opt)
    (transfer? (uint principal principal (optional (buff 34))) (response bool uint))
  )
)

;; Admin (set once via bootstrap-admin)
(define-data-var admin (optional principal) none)

;; sBTC token contract (must implement ft-trait)
(define-data-var sbtc-token (optional (contract-of ft-trait)) none)

;; Merchant registry
(define-map merchants
  { merchant: principal }
  { active: bool, name: (optional (buff 34)) }
)

;; Invoices map
(define-map invoices
  { id: (buff 32) }
  {
    merchant: principal,
    amount: uint,
    memo: (optional (buff 34)),
    expires-at: (optional uint),
    paid: bool,
    canceled: bool,
    refund-amount: uint,
    payer: (optional principal)
  }
)

;; Subscriptions map
(define-map subscriptions
  { id: (buff 32) }
  {
    merchant: principal,
    subscriber: principal,
    amount: uint,
    interval: uint,
    active: bool,
    next-due: uint
  }
)

;; ----------------------------
;; Public functions
;; ----------------------------

;; One-time admin bootstrap
(define-public (bootstrap-admin)
  (begin
    (if (is-none (var-get admin))
        (begin
          (var-set admin (some tx-sender))
          (ok true)
        )
        (err u1) ;; already-initialized
    )
  )
)

;; Admin-only: set sBTC token contract principal (must satisfy ft-trait)
(define-public (set-sbtc-token (token (contract-of ft-trait)))
  (let ((adm? (var-get admin)))
    (begin
      (asserts! (is-some adm?) (err u2))
      (asserts! (is-eq tx-sender (unwrap-panic adm?)) (err u3))
      (var-set sbtc-token (some token))
      (ok true)
    )
  )
)

;; Admin-only: register or upsert merchant (active=true)
(define-public (register-merchant (merchant principal) (name (optional (buff 34))))
  (let ((adm? (var-get admin)))
    (begin
      (asserts! (is-some adm?) (err u4))
      (asserts! (is-eq tx-sender (unwrap-panic adm?)) (err u5))
      (map-set merchants { merchant: merchant } { active: true, name: name })
      (print { event: "merchant-registered", merchant: merchant, active: true, name: name })
      (ok true)
    )
  )
)

;; Admin-only: set merchant active flag (upsert preserving name if exists)
(define-public (set-merchant-active (merchant principal) (active bool))
  (let ((adm? (var-get admin)))
    (begin
      (asserts! (is-some adm?) (err u6))
      (asserts! (is-eq tx-sender (unwrap-panic adm?)) (err u7))
      (let ((m? (map-get? merchants { merchant: merchant })))
        (map-set merchants
          { merchant: merchant }
          {
            active: active,
            name: (match m?
                    m (get name m)
                    none)
          }
        )
      )
      (print { event: "merchant-active-updated", merchant: merchant, active: active })
      (ok true)
    )
  )
)

;; Merchant-only: create an invoice
(define-public (create-invoice (id (buff 32)) (amount uint) (memo (optional (buff 34))) (expires-at (optional uint)))
  (begin
    (asserts! (> amount u0) (err u100)) ;; invalid amount
    (let ((m? (map-get? merchants { merchant: tx-sender })))
      (begin
        (asserts! (is-some m?) (err u101)) ;; merchant not registered
        (asserts! (is-eq true (get active (unwrap-panic m?))) (err u102)) ;; merchant inactive
        (asserts! (is-none (map-get? invoices { id: id })) (err u103)) ;; duplicate id
        (map-set invoices
          { id: id }
          {
            merchant: tx-sender,
            amount: amount,
            memo: memo,
            expires-at: expires-at,
            paid: false,
            canceled: false,
            refund-amount: u0,
            payer: none
          }
        )
        (print { event: "invoice-created", id: id, merchant: tx-sender, amount: amount, expiresAt: expires-at, memo: memo })
        (ok true)
      )
    )
  )
)

;; Payer: pay invoice in full via sBTC transfer
(define-public (pay-invoice (id (buff 32)))
  (let ((inv? (map-get? invoices { id: id })))
    (begin
      (asserts! (is-some inv?) (err u200)) ;; not found
      (let ((inv (unwrap-panic inv?)))
        (asserts! (is-eq false (get paid inv)) (err u201))     ;; already paid
        (asserts! (is-eq false (get canceled inv)) (err u202)) ;; canceled
        (if (is-some (get expires-at inv))
            (asserts! (< block-height (unwrap-panic (get expires-at inv))) (err u203)) ;; expired
            true
        )
        (let ((m? (map-get? merchants { merchant: (get merchant inv) })))
          (begin
            (asserts! (is-some m?) (err u204))
            (asserts! (is-eq true (get active (unwrap-panic m?))) (err u205))
            (let ((tok? (var-get sbtc-token)))
              (begin
                (asserts! (is-some tok?) (err u206)) ;; token not set
                (let ((tok (unwrap-panic tok?)))
                  (match (contract-call? tok transfer? (get amount inv) tx-sender (get merchant inv) none)
                    okv
                      (begin
                        (map-set invoices { id: id } (merge inv { paid: true, payer: (some tx-sender) }))
                        (print { event: "invoice-paid", id: id, payer: tx-sender, merchant: (get merchant inv), amount: (get amount inv) })
                        (ok true)
                      )
                    errv (err errv)
                  )
                )
              )
            )
          )
        )
      )
    )
  )
)

;; Merchant: refund invoice amount (cumulative cap)
(define-public (refund-invoice (id (buff 32)) (amount uint) (memo (optional (buff 34))))
  (let ((inv? (map-get? invoices { id: id })))
    (begin
      (asserts! (is-some inv?) (err u300)) ;; not found
      (let ((inv (unwrap-panic inv?)))
        (asserts! (is-eq true (get paid inv)) (err u301))      ;; not paid
        (asserts! (is-some (get payer inv)) (err u302))        ;; no payer
        (asserts! (is-eq tx-sender (get merchant inv)) (err u303)) ;; not merchant
        (asserts! (> amount u0) (err u304))                    ;; amount zero
        (let ((new-total (+ (get refund-amount inv) amount)))
          (begin
            (asserts! (<= new-total (get amount inv)) (err u305)) ;; cap exceed
            (let ((tok? (var-get sbtc-token)))
              (begin
                (asserts! (is-some tok?) (err u306))
                (let (
                      (tok (unwrap-panic tok?))
                      (payr (unwrap-panic (get payer inv)))
                    )
                  (match (contract-call? tok transfer? amount tx-sender payr memo)
                    okv
                      (begin
                        (map-set invoices { id: id } (merge inv { refund-amount: new-total }))
                        (print { event: "invoice-refunded", id: id, merchant: tx-sender, payer: payr, amount: amount, refundTotal: new-total, memo: memo })
                        (ok true)
                      )
                    errv (err errv)
                  )
                )
              )
            )
          )
        )
      )
    )
  )
)

;; Merchant or Admin: cancel unpaid invoice
(define-public (cancel-invoice (id (buff 32)))
  (let ((inv? (map-get? invoices { id: id })))
    (begin
      (asserts! (is-some inv?) (err u600)) ;; not found
      (let ((inv (unwrap-panic inv?)))
        (let ((adm? (var-get admin)))
          (begin
            (asserts!
              (or (is-eq tx-sender (get merchant inv))
                  (and (is-some adm?) (is-eq tx-sender (unwrap-panic adm?))))
              (err u601)
            )
            (asserts! (is-eq false (get paid inv)) (err u602)) ;; cannot cancel paid
            (map-set invoices { id: id } (merge inv { canceled: true }))
            (print { event: "invoice-canceled", id: id, merchant: (get merchant inv) })
            (ok true)
          )
        )
      )
    )
  )
)

;; Merchant: create subscription
(define-public (create-subscription (id (buff 32)) (merchant principal) (subscriber principal) (amount uint) (interval uint))
  (begin
    (asserts! (is-eq tx-sender merchant) (err u400)) ;; caller must be merchant
    (asserts! (> amount u0) (err u401))
    (asserts! (> interval u0) (err u402))
    (let ((m? (map-get? merchants { merchant: merchant })))
      (begin
        (asserts! (is-some m?) (err u403))
        (asserts! (is-eq true (get active (unwrap-panic m?))) (err u404))
        (asserts! (is-none (map-get? subscriptions { id: id })) (err u405))
        (let ((nd (+ block-height interval)))
          (begin
            (map-set subscriptions
              { id: id }
              {
                merchant: merchant,
                subscriber: subscriber,
                amount: amount,
                interval: interval,
                active: true,
                next-due: nd
              }
            )
            (print { event: "subscription-created", id: id, merchant: merchant, subscriber: subscriber, amount: amount, interval: interval, nextDue: nd })
            (ok true)
          )
        )
      )
    )
  )
)

;; Subscriber: pay subscription when due
(define-public (pay-subscription (id (buff 32)))
  (let ((sub? (map-get? subscriptions { id: id })))
    (begin
      (asserts! (is-some sub?) (err u500))
      (let ((sub (unwrap-panic sub?)))
        (asserts! (is-eq true (get active sub)) (err u501))
        (asserts! (is-eq tx-sender (get subscriber sub)) (err u502))
        (asserts! (>= block-height (get next-due sub)) (err u503))
        ;; ✳️ Ensure merchant is still active at pay time
        (let ((m? (map-get? merchants { merchant: (get merchant sub) })))
          (begin
            (asserts! (is-some m?) (err u504))
            (asserts! (is-eq true (get active (unwrap-panic m?))) (err u505))
            (let ((tok? (var-get sbtc-token)))
              (begin
                (asserts! (is-some tok?) (err u506))
                (let ((tok (unwrap-panic tok?)))
                  (match (contract-call? tok transfer? (get amount sub) tx-sender (get merchant sub) none)
                    okv
                      (let ((new-next (+ (get next-due sub) (get interval sub))))
                        (begin
                          (map-set subscriptions { id: id } (merge sub { next-due: new-next }))
                          (print { event: "subscription-paid", id: id, merchant: (get merchant sub), subscriber: tx-sender, amount: (get amount sub), nextDue: new-next })
                          (ok true)
                        )
                      )
                    errv (err errv)
                  )
                )
              )
            )
          )
        )
      )
    )
  )
)

;; Merchant or Admin: cancel subscription (set active=false)
(define-public (cancel-subscription (id (buff 32)))
  (let ((sub? (map-get? subscriptions { id: id })))
    (begin
      (asserts! (is-some sub?) (err u700))
      (let ((sub (unwrap-panic sub?)))
        (let ((adm? (var-get admin)))
          (begin
            (asserts!
              (or (is-eq tx-sender (get merchant sub))
                  (and (is-some adm?) (is-eq tx-sender (unwrap-panic adm?))))
              (err u701)
            )
            (map-set subscriptions { id: id } (merge sub { active: false }))
            (print { event: "subscription-canceled", id: id, merchant: (get merchant sub) })
            (ok true)
          )
        )
      )
    )
  )
)

;; Helper: emit invoice-expired if chain-height reached; no state change
(define-public (mark-expired (id (buff 32)))
  (let ((inv? (map-get? invoices { id: id })))
    (begin
      (if (is-some inv?)
          (let ((inv (unwrap-panic inv?)))
            ;; ✳️ Don't emit for paid/canceled
            (if (and (is-eq false (get paid inv)) (is-eq false (get canceled inv)))
                (if (is-some (get expires-at inv))
                    (let ((exp (unwrap-panic (get expires-at inv))))
                      (if (>= block-height exp)
                          (print { event: "invoice-expired", id: id, merchant: (get merchant inv), expiresAt: (some exp) })
                          true
                      )
                    )
                    true
                )
                true
            )
          )
          true
      )
      (ok true)
    )
  )
)

;; ----------------------------
;; Read-only helpers (zero side effects)
;; ----------------------------

(define-read-only (get-invoice (id (buff 32)))
  (map-get? invoices { id: id })
)

(define-read-only (is-paid (id (buff 32)))
  (let ((inv? (map-get? invoices { id: id })))
    (if (is-some inv?)
        (get paid (unwrap-panic inv?))
        false
    )
  )
)

;; Status precedence: not-found → paid → canceled → expired → unpaid
(define-read-only (get-invoice-status (id (buff 32)))
  (let ((inv? (map-get? invoices { id: id })))
    (if (is-none inv?)
        "not-found"
        (let ((inv (unwrap-panic inv?)))
          (if (get paid inv)
              "paid"
              (if (get canceled inv)
                  "canceled"
                  (if (is-some (get expires-at inv))
                      (let ((exp (unwrap-panic (get expires-at inv))))
                        (if (>= block-height exp) "expired" "unpaid")
                      )
                      "unpaid"
                  )
              )
          )
        )
    )
  )
)

(define-read-only (get-subscription (id (buff 32)))
  (map-get? subscriptions { id: id })
)

(define-read-only (next-due (id (buff 32)))
  (let ((sub? (map-get? subscriptions { id: id })))
    (if (is-some sub?)
        (some (get next-due (unwrap-panic sub?)))
        none
    )
  )
)

(define-read-only (get-sbtc)
  (var-get sbtc-token)
)

(define-read-only (get-admin)
  (var-get admin)
)
