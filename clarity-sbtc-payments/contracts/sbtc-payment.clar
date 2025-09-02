;; ---------- Trait (reference signature for SIP-010 transfer) -----------
(define-trait ft-trait
  (
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
  )
)

;; ------------------------------ State -----------------------------------
(define-data-var admin (optional principal) none)
;; Store only the token contract principal (traits cant be stored)
(define-data-var sbtc-token (optional principal) none)

(define-map merchants
  { merchant: principal }
  { active: bool, name: (optional (buff 34)) }
)

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
    payer: (optional principal),
    expired: bool
  }
)

(define-map subscriptions
  { id: (buff 32) }
  {
    merchant: principal,
    subscriber: principal,
    amount: uint,
    interval: uint,
    last-paid: (optional uint),
    next-due: uint,
    active: bool
  }
)

;; --------------------------- Public fns ----------------------------------

(define-public (bootstrap-admin)
  (if (is-none (var-get admin))
      (begin (var-set admin (some tx-sender)) (ok true))
      (err u1))
)

;; Set by admin; accept a trait-typed arg and store its contract principal
(define-public (set-sbtc-token (ft <ft-trait>))
  (let ((adm? (var-get admin)))
    (begin
      (asserts! (is-some adm?) (err u2))
      (asserts! (is-eq tx-sender (unwrap-panic adm?)) (err u3))
      (var-set sbtc-token (some (contract-of ft)))
      (ok true)
    )
  )
)

(define-public (register-merchant (who principal) (name (optional (buff 34))))
  (let ((adm (var-get admin)))
    (begin
      (asserts! (is-some adm) (err u400))                         ;; admin must be bootstrapped
      (asserts! (is-eq (unwrap-panic adm) tx-sender) (err u401))  ;; admin-only
      (asserts! (is-none (map-get? merchants { merchant: who })) (err u402)) ;; prevent duplicate
      (map-insert merchants { merchant: who } { active: true, name: name })
      (print { event: "merchant-registered", merchant: who, active: true, name: name })
      (ok true)
    )
  )
)

(define-public (set-merchant-active (merchant principal) (active bool))
  (let ((adm? (var-get admin)))
    (begin
      (asserts! (is-some adm?) (err u6))
      (asserts! (is-eq tx-sender (unwrap-panic adm?)) (err u7))
      (let ((m? (map-get? merchants { merchant: merchant })))
        (begin
          (asserts! (is-some m?) (err u608))
          (let ((m (unwrap-panic m?)))
            (map-set merchants { merchant: merchant } { active: active, name: (get name m) })
          )
        )
      )
      (print { event: "merchant-active-updated", merchant: merchant, active: active })
      (ok true)
    )
  )
)

(define-public (create-invoice (id (buff 32)) (amount uint) (memo (optional (buff 34))) (expires-at (optional uint)))
  (begin
    (asserts! (> amount u0) (err u100))
    ;; require token configured before any invoice is created
    (asserts! (is-some (var-get sbtc-token)) (err u105))
    (let ((m? (map-get? merchants { merchant: tx-sender })))
      (begin
        (asserts! (is-some m?) (err u101))
        (asserts! (is-eq true (get active (unwrap-panic m?))) (err u102))
        (asserts! (is-none (map-get? invoices { id: id })) (err u103))
        ;; if expiry provided, it must be in the future
        (if (is-some expires-at)
            (let ((exp (unwrap-panic expires-at)))
              (asserts! (> exp block-height) (err u104)))
            true)
        (map-insert invoices { id: id }
          {
            merchant: tx-sender,
            amount: amount,
            memo: memo,
            expires-at: expires-at,
            paid: false,
            canceled: false,
            refund-amount: u0,
            payer: none,
            expired: false
          })
        (print { event: "invoice-created", id: id, merchant: tx-sender, amount: amount, expiresAt: expires-at, memo: memo })
        (ok true)
      )
    )
  )
)

;; Require a trait-typed arg `ft`; verify it matches stored principal; then call.
(define-public (pay-invoice (id (buff 32)) (ft <ft-trait>))
  (let ((inv? (map-get? invoices { id: id })))
    (begin
      (asserts! (is-some inv?) (err u200))
      (let ((inv (unwrap-panic inv?)))
        (asserts! (is-eq false (get paid inv)) (err u201))
        (asserts! (is-eq false (get canceled inv)) (err u202))
        (asserts! (is-eq false (get expired inv)) (err u203))
        (if (is-some (get expires-at inv))
            (let ((exp (unwrap-panic (get expires-at inv))))
              (asserts! (< block-height exp) (err u203)))
            true)
        (let ((m? (map-get? merchants { merchant: (get merchant inv) })))
          (begin
            (asserts! (is-some m?) (err u204))
            (asserts! (is-eq true (get active (unwrap-panic m?))) (err u205))
            (let ((stored? (var-get sbtc-token)))
              (begin
                (asserts! (is-some stored?) (err u206))
                (asserts! (is-eq (unwrap-panic stored?) (contract-of ft)) (err u207))
                (match (contract-call? ft transfer (get amount inv) tx-sender (get merchant inv) (get memo inv))
                  okv (begin
                         (map-set invoices { id: id } (merge inv { paid: true, payer: (some tx-sender) }))
                         (print { event: "invoice-paid", id: id, payer: tx-sender, merchant: (get merchant inv), amount: (get amount inv) })
                         (ok true))
                  errv (err errv))
              )
            )
          )
        )
      )
    )
  )
)

(define-public (refund-invoice (id (buff 32)) (amount uint) (memo (optional (buff 34))) (ft <ft-trait>))
  (let ((inv? (map-get? invoices { id: id })))
    (begin
      (asserts! (is-some inv?) (err u300))
      (let ((inv (unwrap-panic inv?)))
        (asserts! (is-eq true (get paid inv)) (err u301))
        (asserts! (is-some (get payer inv)) (err u302))
        (asserts! (is-eq tx-sender (get merchant inv)) (err u303))
        (asserts! (> amount u0) (err u304))
        (let ((new-total (+ (get refund-amount inv) amount)))
          (begin
            (asserts! (<= new-total (get amount inv)) (err u305))
            (let ((stored? (var-get sbtc-token)))
              (begin
                (asserts! (is-some stored?) (err u306))
                (asserts! (is-eq (unwrap-panic stored?) (contract-of ft)) (err u307))
                (let ((payr (unwrap-panic (get payer inv))))
                  (match (contract-call? ft transfer amount tx-sender payr memo)
                    okv (begin
                           (map-set invoices { id: id } (merge inv { refund-amount: new-total }))
                           (print { event: "invoice-refunded", id: id, merchant: tx-sender, payer: payr, amount: amount, refundTotal: new-total, memo: memo })
                           (ok true))
                    errv (err errv)))
              )
            )
          )
        )
      )
    )
  )
)

(define-public (cancel-invoice (id (buff 32)))
  (let ((inv? (map-get? invoices { id: id })))
    (begin
      (asserts! (is-some inv?) (err u600))
      (let ((inv (unwrap-panic inv?)))
        (asserts! (not (get canceled inv)) (err u603))
        (let ((adm? (var-get admin)))
          (begin
            (asserts!
              (or (is-eq tx-sender (get merchant inv))
                  (and (is-some adm?) (is-eq tx-sender (unwrap-panic adm?))))
              (err u601))
            (asserts! (is-eq false (get paid inv)) (err u602))
            (map-set invoices { id: id } (merge inv { canceled: true }))
            (print { event: "invoice-canceled", id: id, merchant: (get merchant inv) })
            (ok true)
          )
        )
      )
    )
  )
)

(define-public (create-subscription
  (id (buff 32)) (merchant principal) (subscriber principal) (amount uint) (interval uint))
  (begin
    (asserts! (is-eq tx-sender merchant) (err u500))         ;; only merchant may create
    (asserts! (> interval u0) (err u501))                    ;; interval > 0

    (let ((m? (map-get? merchants { merchant: merchant })))
      (asserts! (is-some m?) (err u204))
      (asserts! (is-eq true (get active (unwrap-panic m?))) (err u205))
      (asserts! (is-none (map-get? subscriptions { id: id })) (err u502))

      (let ((first-due (+ block-height interval)))
        (map-insert subscriptions
          { id: id }
          {
            merchant: merchant,
            subscriber: subscriber,
            amount: amount,
            interval: interval,
            last-paid: none,
            next-due: first-due,
            active: true
          }
        )
        (print {
          event: "subscription-created",
          id: id,
          merchant: merchant,
          subscriber: subscriber,
          amount: amount,
          interval: interval,
          nextDue: first-due
        })
        (ok true)
      )
    )
  )
)

(define-public (pay-subscription (id (buff 32)) (ft <ft-trait>))
  (let ((sub? (map-get? subscriptions { id: id })))
    (begin
      (asserts! (is-some sub?) (err u500))
      (let ((sub (unwrap-panic sub?)))
        (asserts! (is-eq true (get active sub)) (err u504))          ;; must be active
        (asserts! (is-eq tx-sender (get subscriber sub)) (err u502)) ;; caller is subscriber

        (let ((due (get next-due sub)))
          (asserts! (>= block-height due) (err u503))                ;; EARLY PAY GUARD

          ;; merchant must still be active
          (let ((m? (map-get? merchants { merchant: (get merchant sub) })))
            (asserts! (is-some m?) (err u204))
            (asserts! (is-eq true (get active (unwrap-panic m?))) (err u205))

            ;; token principal must match configured sbtc-token
            (let ((stored? (var-get sbtc-token)))
              (begin
                (asserts! (is-some stored?) (err u206))
                (asserts! (is-eq (unwrap-panic stored?) (contract-of ft)) (err u207))

                (match (contract-call? ft transfer
                        (get amount sub) tx-sender (get merchant sub) none)
                  okv (let ((next (+ due (get interval sub))))        ;; advance from PRIOR due
                         (map-set subscriptions { id: id }
                           (merge sub {
                             last-paid: (some block-height),
                             next-due:  next
                           })
                         )
                         (print {
                           event: "subscription-paid",
                           id: id,
                           subscriber: tx-sender,
                           merchant: (get merchant sub),
                           amount: (get amount sub),
                           nextDue: next
                         })
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

(define-public (cancel-subscription (id (buff 32)))
  (let ((sub? (map-get? subscriptions { id: id })))
    (begin
      (asserts! (is-some sub?) (err u700))
      (let ((sub (unwrap-panic sub?)))
        (asserts! (get active sub) (err u702))
        (let ((adm? (var-get admin)))
          (begin
            (asserts!
              (or (is-eq tx-sender (get merchant sub))
                  (and (is-some adm?) (is-eq tx-sender (unwrap-panic adm?))))
              (err u701))
            (map-set subscriptions { id: id } (merge sub { active: false }))
            (print { event: "subscription-canceled", id: id, merchant: (get merchant sub) })
            (ok true)
          )
        )
      )
    )
  )
)

(define-public (mark-expired (id (buff 32)))
  (let ((inv? (map-get? invoices { id: id })))
    (begin
      (if (is-some inv?)
          (let ((inv (unwrap-panic inv?)))
            (if (and (not (get paid inv)) (not (get canceled inv)) (not (get expired inv)))
                (if (is-some (get expires-at inv))
                    (let ((exp (unwrap-panic (get expires-at inv))))
                      (if (>= block-height exp)
                          (begin
                            (map-set invoices { id: id } (merge inv { expired: true }))
                            (print { event: "invoice-expired", id: id, merchant: (get merchant inv), expiresAt: (some exp) })
                            true)
                          true))
                    true)
                true))
          true)
      (ok true)
    )
  )
)

;; --------------------------- Read-only -----------------------------------

(define-read-only (get-invoice (id (buff 32)))
  (map-get? invoices { id: id })
)

(define-read-only (is-paid (id (buff 32)))
  (let ((inv? (map-get? invoices { id: id })))
    (if (is-some inv?) (get paid (unwrap-panic inv?)) false))
)

(define-read-only (get-invoice-status (id (buff 32)))
  (let ((inv? (map-get? invoices { id: id })))
    (if (is-none inv?) "not-found"
        (let ((inv (unwrap-panic inv?))
              (h-exp (if (is-some (get expires-at inv))
                         (>= block-height (unwrap-panic (get expires-at inv)))
                         false)))
          (if (get paid inv) "paid"
              (if (get canceled inv) "canceled"
                  (if (or (get expired inv) h-exp) "expired" "unpaid")))))
))

;; 1) Wrapper for tuple { id }
(define-read-only (get-invoice-status-v2 (arg (tuple (id (buff 32)))))
  (get-invoice-status (get id arg))
)

;; 2) Wrapper for tuple { id, merchant }
(define-read-only (get-invoice-status-by (arg (tuple (id (buff 32)) (merchant principal))))
  (let ((inv? (map-get? invoices { id: (get id arg) })))
    (if (is-none inv?)
        "not-found"
        (let ((inv (unwrap-panic inv?)))
          (if (is-eq (get merchant inv) (get merchant arg))
              (get-invoice-status (get id arg))
              ;; choose your policy: "forbidden" | "not-found"
              "not-found"
          ))))
)

(define-read-only (get-subscription (id (buff 32)))
  (map-get? subscriptions { id: id })
)

(define-read-only (next-due (id (buff 32)))
  (let ((sub? (map-get? subscriptions { id: id })))
    (if (is-some sub?) (some (get next-due (unwrap-panic sub?))) none))
)

(define-read-only (get-merchant (who principal))
  (map-get? merchants { merchant: who })
)

(define-read-only (is-merchant-active (who principal))
  (let ((m? (map-get? merchants { merchant: who })))
    (if (is-some m?) (get active (unwrap-panic m?)) false))
)

(define-read-only (get-sbtc) (var-get sbtc-token))
(define-read-only (get-admin) (var-get admin))
