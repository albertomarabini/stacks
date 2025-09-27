;; Minimal SIP-010-style FT for local testing with sbtc-payment.clar.
;; NOTE: SIP-010 uses `transfer` (no "?"). This contract implements only the parts
;; the payment contract needs for tests.  :contentReference[oaicite:3]{index=3}
(impl-trait .sbtc-payment.ft-trait)

;; --------------------------- State ---------------------------------------
(define-data-var owner (optional principal) none)
(define-data-var total-supply uint u0)

(define-map balances
  { account: principal }
  { balance: uint }
)

;; --------------------------- Errors --------------------------------------
(define-constant ERR-NO-OWNER     u100)  ;; owner not bootstrapped
(define-constant ERR-NOT-OWNER    u101)  ;; caller is not owner (admin ops)
(define-constant ERR-ZERO-AMOUNT  u102)
(define-constant ERR-INSUFFICIENT u103)
(define-constant ERR-SAME-ACCOUNT u104)
(define-constant ERR-NOT-SENDER   u105)  ;; transfer requires tx-sender == sender

;; --------------------------- Admin ---------------------------------------
(define-public (bootstrap-owner)
  (if (is-none (var-get owner))
      (begin (var-set owner (some tx-sender)) (ok true))
      (err ERR-NO-OWNER))
)

(define-public (mint (to principal) (amount uint))
  (let ((own? (var-get owner)))
    (begin
      (asserts! (is-some own?) (err ERR-NO-OWNER))
      (asserts! (is-eq (unwrap-panic own?) tx-sender) (err ERR-NOT-OWNER))
      (asserts! (> amount u0) (err ERR-ZERO-AMOUNT))
      (let ((prev (default-to u0 (get balance (map-get? balances { account: to })))))
        (map-set balances { account: to } { balance: (+ prev amount) })
        (var-set total-supply (+ (var-get total-supply) amount))
        (ok true)
      )
    )
  )
)

;; --------------------------- SIP-010 core --------------------------------
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (> amount u0) (err ERR-ZERO-AMOUNT))
    (asserts! (is-eq tx-sender sender) (err ERR-NOT-SENDER))
    (if (is-eq sender recipient)
        (err ERR-SAME-ACCOUNT)
        (let (
              (from-bal (default-to u0 (get balance (map-get? balances { account: sender }))))
              (to-bal   (default-to u0 (get balance (map-get? balances { account: recipient }))))
             )
          (begin
            (asserts! (>= from-bal amount) (err ERR-INSUFFICIENT))
            (map-set balances { account: sender }    { balance: (- from-bal amount) })
            (map-set balances { account: recipient } { balance: (+ to-bal amount) })
            (ok true)
          )
        )
    )
  )
)

;; --------------------------- Read-only helpers ---------------------------
(define-read-only (get-balance (who principal))
  (default-to u0 (get balance (map-get? balances { account: who })))
)

(define-read-only (get-total-supply)
  (var-get total-supply)
)
